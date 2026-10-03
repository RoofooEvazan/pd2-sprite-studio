// DC6: run-length encoded, palettized sprite format (items, UI, some objects).

import { Frame, Sprite } from './sprite'

export interface Dc6Meta {
  version: number
  flags: number
  encoding: number
  termination: number
}

export interface Dc6 extends Sprite {
  meta: Dc6Meta
}

export function decodeDc6(data: Uint8Array): Dc6 {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const meta: Dc6Meta = {
    version: dv.getInt32(0, true),
    flags: dv.getUint32(4, true),
    encoding: dv.getUint32(8, true),
    termination: dv.getUint32(12, true)
  }
  if (meta.version !== 6) throw new Error(`DC6: unexpected version ${meta.version}`)
  const directions = dv.getUint32(16, true)
  const framesPerDir = dv.getUint32(20, true)
  const frames: Frame[][] = []
  for (let d = 0; d < directions; d++) {
    const dir: Frame[] = []
    for (let f = 0; f < framesPerDir; f++) {
      const ptr = dv.getUint32(24 + (d * framesPerDir + f) * 4, true)
      const flip = dv.getUint32(ptr, true)
      const width = dv.getUint32(ptr + 4, true)
      const height = dv.getUint32(ptr + 8, true)
      const offsetX = dv.getInt32(ptr + 12, true)
      const offsetY = dv.getInt32(ptr + 16, true)
      const length = dv.getUint32(ptr + 28, true)
      const pixels = new Uint8Array(width * height)
      let p = ptr + 32
      const end = p + length
      let x = 0
      let row = 0
      const yOf = (r: number) => (flip ? r : height - 1 - r)
      while (p < end && row < height) {
        const b = data[p++]
        if (b === 0x80) {
          x = 0
          row++
        } else if (b & 0x80) {
          x += b & 0x7f
        } else {
          const y = yOf(row)
          for (let i = 0; i < b; i++, x++) {
            const v = data[p++]
            if (x < width) pixels[y * width + x] = v
          }
        }
      }
      // DC6 offsetY is the frame's bottom edge relative to the origin; store top-left in sprite space.
      dir.push({ width, height, offsetX, offsetY: offsetY - height, pixels })
    }
    frames.push(dir)
  }
  return { directions, framesPerDir, frames, meta }
}

function encodeFrameData(f: Frame): number[] {
  const out: number[] = []
  for (let r = 0; r < f.height; r++) {
    const y = f.height - 1 - r
    const row = f.pixels.subarray(y * f.width, (y + 1) * f.width)
    let last = row.length
    while (last > 0 && row[last - 1] === 0) last--
    let x = 0
    while (x < last) {
      if (row[x] === 0) {
        let n = 0
        while (x < last && row[x] === 0 && n < 0x7f) {
          x++
          n++
        }
        out.push(0x80 | n)
      } else {
        let n = 0
        const start = out.length
        out.push(0)
        while (x < last && row[x] !== 0 && n < 0x7f) {
          out.push(row[x])
          x++
          n++
        }
        out[start] = n
      }
    }
    out.push(0x80)
  }
  return out
}

export function encodeDc6(s: Sprite, meta?: Partial<Dc6Meta>): Uint8Array {
  const m: Dc6Meta = { version: 6, flags: 1, encoding: 0, termination: 0xeeeeeeee, ...meta }
  const termByte = m.termination & 0xff
  const frameList = s.frames.flat()
  const encoded = frameList.map(encodeFrameData)
  const headerSize = 24 + frameList.length * 4
  let size = headerSize
  for (const e of encoded) size += 32 + e.length + 3
  const out = new Uint8Array(size)
  const dv = new DataView(out.buffer)
  dv.setInt32(0, m.version, true)
  dv.setUint32(4, m.flags, true)
  dv.setUint32(8, m.encoding, true)
  dv.setUint32(12, m.termination, true)
  dv.setUint32(16, s.directions, true)
  dv.setUint32(20, s.framesPerDir, true)
  let p = headerSize
  frameList.forEach((f, i) => {
    dv.setUint32(24 + i * 4, p, true)
    const e = encoded[i]
    const next = p + 32 + e.length + 3
    dv.setUint32(p, 0, true)
    dv.setUint32(p + 4, f.width, true)
    dv.setUint32(p + 8, f.height, true)
    dv.setInt32(p + 12, f.offsetX, true)
    dv.setInt32(p + 16, f.offsetY + f.height, true)
    dv.setUint32(p + 20, 0, true)
    dv.setUint32(p + 24, next, true)
    dv.setUint32(p + 28, e.length, true)
    out.set(e, p + 32)
    out[next - 3] = out[next - 2] = out[next - 1] = termByte
    p = next
  })
  return out
}
