// PKWARE Data Compression Library "explode" decompressor.
// Port of Mark Adler's blast.c (zlib/contrib/blast), used by MPQ archives.

const MAXBITS = 13

interface Huffman {
  count: Int16Array
  symbol: Int16Array
}

function construct(rep: readonly number[]): Huffman {
  const length: number[] = []
  for (const b of rep) {
    let left = (b >> 4) + 1
    const len = b & 15
    while (left--) length.push(len)
  }
  const count = new Int16Array(MAXBITS + 1)
  const symbol = new Int16Array(length.length)
  for (const len of length) count[len]++
  const offs = new Int16Array(MAXBITS + 1)
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = offs[len] + count[len]
  for (let s = 0; s < length.length; s++) {
    if (length[s] !== 0) symbol[offs[length[s]]++] = s
  }
  return { count, symbol }
}

const LITLEN = [
  11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12,
  11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5,
  38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12,
  45, 12, 61, 12, 45, 44, 173
]
const LENLEN = [2, 35, 36, 53, 38, 23]
const DISTLEN = [2, 20, 53, 230, 247, 151, 248]
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264]
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]

let tables: { lit: Huffman; len: Huffman; dist: Huffman } | null = null

export function explode(input: Uint8Array, expectedSize: number): Uint8Array {
  if (!tables) tables = { lit: construct(LITLEN), len: construct(LENLEN), dist: construct(DISTLEN) }
  const { lit: litcode, len: lencode, dist: distcode } = tables

  let pos = 0
  let bitbuf = 0
  let bitcnt = 0
  const out = new Uint8Array(expectedSize)
  let outPos = 0

  const nextByte = (): number => {
    if (pos >= input.length) throw new Error('explode: input exhausted')
    return input[pos++]
  }

  const bits = (need: number): number => {
    let val = bitbuf
    while (bitcnt < need) {
      val |= nextByte() << bitcnt
      bitcnt += 8
    }
    bitbuf = val >>> need
    bitcnt -= need
    return val & ((1 << need) - 1)
  }

  const decode = (h: Huffman): number => {
    let bb = bitbuf
    let left = bitcnt
    let code = 0
    let first = 0
    let index = 0
    let len = 1
    let next = 1
    for (;;) {
      while (left--) {
        code |= (bb & 1) ^ 1
        bb >>>= 1
        const count = h.count[next++]
        if (code < first + count) {
          bitbuf = bb
          bitcnt = (bitcnt - len) & 7
          return h.symbol[index + (code - first)]
        }
        index += count
        first += count
        first <<= 1
        code <<= 1
        len++
      }
      left = MAXBITS + 1 - len
      if (left === 0) break
      bb = nextByte()
      if (left > 8) left = 8
    }
    throw new Error('explode: bad huffman code')
  }

  const litMode = bits(8)
  if (litMode > 1) throw new Error('explode: bad literal flag')
  const dict = bits(8)
  if (dict < 4 || dict > 6) throw new Error('explode: bad dictionary size')

  while (outPos < expectedSize) {
    if (bits(1)) {
      const sym = decode(lencode)
      const len = BASE[sym] + bits(EXTRA[sym])
      if (len === 519) break
      const s = len === 2 ? 2 : dict
      let dist = decode(distcode) << s
      dist += bits(s)
      dist++
      if (dist > outPos) throw new Error('explode: distance too far back')
      for (let i = 0; i < len && outPos < expectedSize; i++, outPos++) out[outPos] = out[outPos - dist]
    } else {
      out[outPos++] = litMode ? decode(litcode) : bits(8)
    }
  }
  return outPos === expectedSize ? out : out.subarray(0, outPos)
}
