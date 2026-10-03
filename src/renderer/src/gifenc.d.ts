declare module 'gifenc' {
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: number[][]; delay?: number; transparent?: boolean; transparentIndex?: number; repeat?: number; dispose?: number }
    ): void
    finish(): void
    bytes(): Uint8Array
  }
  export function GIFEncoder(opts?: { auto?: boolean }): Encoder
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: string; oneBitAlpha?: boolean | number }): number[][]
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array
}
