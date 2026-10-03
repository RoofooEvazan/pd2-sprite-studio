// LSB-first bit reader / writer used by the DCC codec.

export class BitReader {
  constructor(
    private readonly data: Uint8Array,
    public pos = 0 // in bits
  ) {}

  /** Read up to 32 bits (unsigned). */
  bits(n: number): number {
    if (n > 24) {
      const lo = this.bits(16)
      return lo + this.bits(n - 16) * 65536
    }
    let v = 0
    let got = 0
    while (got < n) {
      const byte = this.data[this.pos >>> 3] ?? 0
      const bit = this.pos & 7
      const take = Math.min(8 - bit, n - got)
      v |= ((byte >>> bit) & ((1 << take) - 1)) << got
      got += take
      this.pos += take
    }
    return v >>> 0
  }

  signed(n: number): number {
    if (n === 0) return 0
    const v = this.bits(n)
    return v >= 2 ** (n - 1) ? v - 2 ** n : v
  }

  alignByte(): void {
    this.pos = (this.pos + 7) & ~7
  }
}

export class BitWriter {
  private buf = new Uint8Array(1024)
  pos = 0

  private ensure(bits: number): void {
    const need = (bits + 7) >>> 3
    if (need <= this.buf.length) return
    let len = this.buf.length * 2
    while (len < need) len *= 2
    const nb = new Uint8Array(len)
    nb.set(this.buf)
    this.buf = nb
  }

  bits(value: number, n: number): void {
    if (n > 24) {
      this.bits(value % 65536, 16)
      this.bits(Math.floor(value / 65536), n - 16)
      return
    }
    this.ensure(this.pos + n)
    let put = 0
    while (put < n) {
      const bit = this.pos & 7
      const take = Math.min(8 - bit, n - put)
      this.buf[this.pos >>> 3] |= ((value >>> put) & ((1 << take) - 1)) << bit
      put += take
      this.pos += take
    }
  }

  signed(value: number, n: number): void {
    this.bits(value < 0 ? value + 2 ** n : value, n)
  }

  append(other: BitWriter): void {
    const r = new BitReader(other.bytes())
    let left = other.pos
    while (left > 0) {
      const n = Math.min(16, left)
      this.bits(r.bits(n), n)
      left -= n
    }
  }

  alignByte(): void {
    this.pos = (this.pos + 7) & ~7
    this.ensure(this.pos)
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, (this.pos + 7) >>> 3)
  }
}
