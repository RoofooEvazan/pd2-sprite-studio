import type { Catalog } from '../../core/catalog'

export interface GameStatus {
  location: { d2Dir: string; pd2Dir: string }
  exportRoot: string
  loaded: string[]
  missing: string[]
}

interface Api {
  status(): Promise<GameStatus>
  setLocation(loc: { d2Dir: string; pd2Dir: string }): Promise<GameStatus>
  pickDir(title: string): Promise<string | null>
  catalog(): Promise<Catalog>
  read(path: string): Promise<{ data: Uint8Array; source: string } | null>
  readMany(paths: string[]): Promise<Record<string, Uint8Array | null>>
  saveFile(opts: { defaultName: string; data: Uint8Array; filters: { name: string; extensions: string[] }[] }): Promise<string | null>
  openFile(filters: { name: string; extensions: string[] }[]): Promise<{ name: string; data: Uint8Array } | null>
  open3d(): Promise<{ name: string; data: Uint8Array; siblings: { name: string; data: Uint8Array }[] } | null>
  saveRenderFolder(files: { name: string; data: Uint8Array }[]): Promise<string | null>
  openRenderFolder():Promise<{ dir: string; files: { name: string; data: Uint8Array }[]; manifest: unknown } | null>
  saveText(opts: { defaultName: string; text: string }): Promise<string | null>
  pickExportRoot(): Promise<string | null>
  exportPd2(files: { rel: string; data: Uint8Array }[]): Promise<{ root: string; written: string[] }>
  reveal(path: string): Promise<void>
  mcpInfo(): Promise<McpInfo>
  mcpConfigure(cfg: { enabled: boolean; port?: number }): Promise<McpInfo>
  mcpReadFile(path: string, kind: 'image' | 'model'): Promise<{ name: string; data: Uint8Array; siblings: { name: string; data: Uint8Array }[] }>
  /** Electron only: receive tool calls from AI assistants */
  onMcpCall?(handler: (msg: { id: number; name: string; args: Record<string, unknown> }) => void): void
  mcpResult?(msg: { id: number; result: unknown }): void
}

export interface McpInfo {
  enabled: boolean
  port: number
  running: boolean
  error: string | null
  url: string
  bridge: { command: string; args: string[]; env: Record<string, string> }
}

declare global {
  interface Window {
    api: Api
  }
}

// Browser test harness (scripts/webdev.ts) fallback when not running inside Electron
function httpApi(): Api {
  const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  const bytesToB64 = (b: Uint8Array) => {
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  }
  const enc = (v: unknown): unknown =>
    v instanceof Uint8Array
      ? { __b64: bytesToB64(v) }
      : Array.isArray(v)
        ? v.map(enc)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]))
          : v
  const dec = (v: unknown): unknown =>
    v && typeof v === 'object' && '__b64' in (v as object)
      ? b64ToBytes((v as { __b64: string }).__b64)
      : Array.isArray(v)
        ? v.map(dec)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]))
          : v
  return new Proxy({} as Api, {
    get: (_t, name: string) => async (...args: unknown[]) => {
      const r = await fetch(`/api/${name}`, { method: 'POST', body: JSON.stringify(enc(args)) })
      return dec(await r.json())
    }
  })
}

export const api: Api = window.api ?? httpApi()

const cache = new Map<string, Promise<Uint8Array | null>>()

/** Cached read of a game file (original archive contents). */
export function readGameFile(path: string): Promise<Uint8Array | null> {
  const key = path.toLowerCase()
  let p = cache.get(key)
  if (!p) {
    p = api.read(path).then((r) => r?.data ?? null)
    cache.set(key, p)
  }
  return p
}

/** Batch prefetch several files into the cache in one IPC round trip. */
export async function prefetch(paths: string[]): Promise<void> {
  const need = paths.filter((p) => !cache.has(p.toLowerCase()))
  if (!need.length) return
  const req = api.readMany(need)
  for (const p of need) cache.set(p.toLowerCase(), req.then((r) => r[p] ?? null))
  await req
}
