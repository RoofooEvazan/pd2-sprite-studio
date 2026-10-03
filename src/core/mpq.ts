// Minimal read-only MPQ (v1) archive reader, sufficient for Diablo II / PD2 archives.
// Supports: hash/block tables, encrypted files (incl. FIX_KEY), single-unit and sectored files,
// PKWARE implode, zlib (via injected inflater) compression.

import { explode } from './explode'

export interface ByteSource {
  readonly size: number
  read(offset: number, length: number): Uint8Array
}

export type Inflater = (data: Uint8Array, expectedSize: number) => Uint8Array

const FLAG_IMPLODE = 0x00000100
const FLAG_COMPRESS = 0x00000200
const FLAG_ENCRYPTED = 0x00010000
const FLAG_FIX_KEY = 0x00020000
const FLAG_SINGLE_UNIT = 0x01000000
const FLAG_SECTOR_CRC = 0x04000000
const FLAG_EXISTS = 0x80000000

const CRYPT_TABLE = (() => {
  const t = new Uint32Array(0x500)
  let seed = 0x00100001
  for (let i = 0; i < 0x100; i++) {
    for (let j = 0, idx = i; j < 5; j++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab
      const t1 = (seed & 0xffff) << 16
      seed = (seed * 125 + 3) % 0x2aaaab
      const t2 = seed & 0xffff
      t[idx] = (t1 | t2) >>> 0
    }
  }
  return t
})()

export function hashString(str: string, type: number): number {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  const s = str.toUpperCase()
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i) & 0xff
    seed1 = (CRYPT_TABLE[type * 0x100 + ch] ^ ((seed1 + seed2) >>> 0)) >>> 0
    seed2 = (ch + seed1 + seed2 + ((seed2 << 5) >>> 0) + 3) >>> 0
  }
  return seed1
}

function decryptInPlace(u32: Uint32Array, key: number): void {
  let seed = 0xeeeeeeee
  for (let i = 0; i < u32.length; i++) {
    seed = (seed + CRYPT_TABLE[0x400 + (key & 0xff)]) >>> 0
    const ch = (u32[i] ^ ((key + seed) >>> 0)) >>> 0
    key = ((((~key << 21) >>> 0) + 0x11111111) >>> 0 | (key >>> 11)) >>> 0
    seed = (ch + seed + ((seed << 5) >>> 0) + 3) >>> 0
    u32[i] = ch
  }
}

/** Decrypt a byte buffer in place (only whole dwords are decrypted, as in Storm). */
function decryptBytes(buf: Uint8Array, key: number): void {
  const n = buf.length >>> 2
  if (!n) return
  const copy = new Uint8Array(n * 4)
  copy.set(buf.subarray(0, n * 4))
  const u32 = new Uint32Array(copy.buffer)
  decryptInPlace(u32, key)
  buf.set(copy, 0)
}

interface HashEntry {
  nameA: number
  nameB: number
  locale: number
  block: number
}

interface BlockEntry {
  offset: number
  csize: number
  size: number
  flags: number
}

export class MpqArchive {
  private base = 0
  private sectorSize = 4096
  private hashes: HashEntry[] = []
  private blocks: BlockEntry[] = []
  private hashMask = 0

  constructor(
    public readonly name: string,
    private readonly src: ByteSource,
    private readonly inflate: Inflater
  ) {
    this.readHeader()
  }

  private readHeader(): void {
    const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
    let off = 0
    for (; off < this.src.size; off += 512) {
      const sig = dv(this.src.read(off, 4)).getUint32(0, true)
      if (sig === 0x1a51504d) break // 'MPQ\x1A'
      if (sig === 0x1b51504d) {
        // user data header
        const ud = dv(this.src.read(off, 16))
        off += ud.getUint32(8, true)
        break
      }
    }
    if (off >= this.src.size) throw new Error(`${this.name}: not an MPQ archive`)
    this.base = off
    const h = dv(this.src.read(off, 32))
    this.sectorSize = 512 << h.getUint16(14, true)
    const hashPos = h.getUint32(16, true)
    const blockPos = h.getUint32(20, true)
    const hashCount = h.getUint32(24, true)
    const blockCount = h.getUint32(28, true)

    const readTable = (pos: number, count: number, key: string): Uint32Array => {
      const raw = this.src.read(this.base + pos, count * 16)
      const copy = new Uint8Array(count * 16)
      copy.set(raw)
      const u32 = new Uint32Array(copy.buffer)
      decryptInPlace(u32, hashString(key, 3))
      return u32
    }

    const ht = readTable(hashPos, hashCount, '(hash table)')
    for (let i = 0; i < hashCount; i++) {
      this.hashes.push({
        nameA: ht[i * 4],
        nameB: ht[i * 4 + 1],
        locale: ht[i * 4 + 2] & 0xffff,
        block: ht[i * 4 + 3]
      })
    }
    this.hashMask = hashCount - 1

    const bt = readTable(blockPos, blockCount, '(block table)')
    for (let i = 0; i < blockCount; i++) {
      this.blocks.push({ offset: bt[i * 4], csize: bt[i * 4 + 1], size: bt[i * 4 + 2], flags: bt[i * 4 + 3] })
    }
  }

  private findBlock(path: string): BlockEntry | null {
    const name = path.replace(/\//g, '\\')
    const start = hashString(name, 0) & this.hashMask
    const a = hashString(name, 1)
    const b = hashString(name, 2)
    let found: BlockEntry | null = null
    for (let i = start, n = 0; n <= this.hashMask; i = (i + 1) & this.hashMask, n++) {
      const e = this.hashes[i]
      if (e.block === 0xffffffff) break
      if (e.nameA === a && e.nameB === b && e.block !== 0xfffffffe) {
        const blk = this.blocks[e.block]
        if (blk && blk.flags & FLAG_EXISTS) {
          found = blk
          if (e.locale === 0) break // prefer neutral locale
        }
      }
    }
    return found
  }

  has(path: string): boolean {
    return this.findBlock(path) !== null
  }

  read(path: string): Uint8Array | null {
    const blk = this.findBlock(path)
    if (!blk) return null
    const name = path.replace(/\//g, '\\')
    let key = 0
    if (blk.flags & FLAG_ENCRYPTED) {
      const baseName = name.substring(name.lastIndexOf('\\') + 1)
      key = hashString(baseName, 3)
      if (blk.flags & FLAG_FIX_KEY) key = ((key + blk.offset) ^ blk.size) >>> 0
    }
    const pos = this.base + blk.offset

    if (blk.flags & FLAG_SINGLE_UNIT) {
      const data = this.src.read(pos, blk.csize).slice()
      if (key) decryptBytes(data, key)
      return this.decompress(data, blk.size, blk.flags)
    }

    const compressed = (blk.flags & (FLAG_IMPLODE | FLAG_COMPRESS)) !== 0
    const nSectors = Math.ceil(blk.size / this.sectorSize)
    let offsets: Uint32Array
    if (compressed) {
      const count = nSectors + 1 + (blk.flags & FLAG_SECTOR_CRC ? 1 : 0)
      const raw = this.src.read(pos, count * 4).slice()
      offsets = new Uint32Array(raw.buffer, 0, count)
      if (key) decryptInPlace(offsets, (key - 1) >>> 0)
    } else {
      offsets = new Uint32Array(nSectors + 1)
      for (let i = 0; i <= nSectors; i++) offsets[i] = Math.min(i * this.sectorSize, blk.size)
    }

    const out = new Uint8Array(blk.size)
    const all = this.src.read(pos, offsets[nSectors])
    for (let i = 0; i < nSectors; i++) {
      const sector = all.slice(offsets[i], offsets[i + 1])
      if (key) decryptBytes(sector, (key + i) >>> 0)
      const want = Math.min(this.sectorSize, blk.size - i * this.sectorSize)
      const dec = compressed ? this.decompress(sector, want, blk.flags) : sector
      out.set(dec.subarray(0, want), i * this.sectorSize)
    }
    return out
  }

  private decompress(data: Uint8Array, size: number, flags: number): Uint8Array {
    if (data.length >= size) return data.subarray(0, size)
    if (flags & FLAG_IMPLODE) return explode(data, size)
    if (flags & FLAG_COMPRESS) {
      const mask = data[0]
      let buf = data.subarray(1)
      // Decompression order for multi-compression: bzip2, implode, zlib, huffman, adpcm
      if (mask & 0x10) throw new Error('bzip2 compression not supported')
      if (mask & 0x08) buf = explode(buf, size)
      if (mask & 0x02) buf = this.inflate(buf, size)
      if (mask & 0xc1) throw new Error(`unsupported compression mask 0x${mask.toString(16)}`)
      return buf
    }
    return data
  }

  listfile(): string[] {
    const data = this.read('(listfile)')
    if (!data) return []
    return new TextDecoder('latin1')
      .decode(data)
      .split(/[\r\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

/** Layered virtual filesystem: later archives override earlier ones. */
export class MpqVfs {
  readonly archives: MpqArchive[] = []

  add(archive: MpqArchive): void {
    this.archives.push(archive)
  }

  read(path: string): Uint8Array | null {
    for (let i = this.archives.length - 1; i >= 0; i--) {
      try {
        const d = this.archives[i].read(path)
        if (d) return d
      } catch (e) {
        console.warn(`read ${path} from ${this.archives[i].name} failed:`, e)
      }
    }
    return null
  }

  has(path: string): boolean {
    return this.archives.some((a) => a.has(path))
  }

  /** Which archive a file is served from (highest priority). */
  sourceOf(path: string): string | null {
    for (let i = this.archives.length - 1; i >= 0; i--) if (this.archives[i].has(path)) return this.archives[i].name
    return null
  }
}
