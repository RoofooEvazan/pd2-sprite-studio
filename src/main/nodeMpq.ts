import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ByteSource, MpqArchive, MpqVfs } from '../core/mpq'

class FileSource implements ByteSource {
  readonly size: number
  private fd: number
  constructor(file: string) {
    this.fd = fs.openSync(file, 'r')
    this.size = fs.fstatSync(this.fd).size
  }
  read(offset: number, length: number): Uint8Array {
    const buf = Buffer.alloc(length)
    fs.readSync(this.fd, buf, 0, length, offset)
    return new Uint8Array(buf.buffer, buf.byteOffset, length)
  }
}

const inflate = (data: Uint8Array) => new Uint8Array(zlib.inflateSync(data))

export function openArchive(file: string): MpqArchive {
  return new MpqArchive(path.basename(file), new FileSource(file), inflate)
}

/** Archive load order, lowest priority first. PD2 archives override vanilla. */
const VANILLA = ['d2data.mpq', 'd2char.mpq', 'd2exp.mpq', 'patch_d2.mpq']
const PD2 = ['patch_d2.mpq', 'pd2monchars.mpq', 'pd2maps.mpq', 'pd2assets.mpq', 'pd2data.mpq']

export interface GameLocation {
  d2Dir: string
  pd2Dir: string
}

export function defaultGameLocation(): GameLocation {
  const d2Dir = 'C:\\Program Files (x86)\\Diablo II'
  const alt = 'C:\\Program Files\\Diablo II'
  const base = fs.existsSync(path.join(alt, 'd2data.mpq')) ? alt : d2Dir
  return { d2Dir: base, pd2Dir: path.join(base, 'ProjectD2') }
}

export function openGameVfs(loc: GameLocation): { vfs: MpqVfs; loaded: string[]; missing: string[] } {
  const vfs = new MpqVfs()
  const loaded: string[] = []
  const missing: string[] = []
  const tryAdd = (dir: string, name: string, label: string) => {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) return missing.push(label)
    try {
      const a = openArchive(file)
      ;(a as { name: string }).name = label
      vfs.add(a)
      loaded.push(label)
    } catch (e) {
      missing.push(`${label} (${(e as Error).message})`)
    }
  }
  for (const n of VANILLA) tryAdd(loc.d2Dir, n, n)
  for (const n of PD2) tryAdd(loc.pd2Dir, n, `ProjectD2/${n}`)
  return { vfs, loaded, missing }
}
