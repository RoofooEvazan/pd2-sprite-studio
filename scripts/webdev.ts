// Browser test harness: serves the renderer with Vite and exposes the Electron main-process API over HTTP.
// Usage: npx tsx scripts/webdev.ts   (then open http://localhost:5198)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { buildCatalog, Catalog } from '../src/core/catalog'
import { defaultGameLocation, openGameVfs } from '../src/main/nodeMpq'

const API_PORT = 5199
const WEB_PORT = 5198
const SAVE_DIR = path.resolve('out-test/web-saves')
const EXPORT_ROOT = path.resolve('out-test/pd2-export')

const location = defaultGameLocation()
const { vfs, loaded, missing } = openGameVfs(location)
let catalog: Catalog | null = null

const enc = (v: unknown): unknown => {
  if (v instanceof Uint8Array) return { __b64: Buffer.from(v).toString('base64') }
  if (Array.isArray(v)) return v.map(enc)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]))
  return v
}
const dec = (v: unknown): unknown => {
  if (v && typeof v === 'object' && '__b64' in (v as object)) return new Uint8Array(Buffer.from((v as { __b64: string }).__b64, 'base64'))
  if (Array.isArray(v)) return v.map(dec)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]))
  return v
}

const status = () => ({ location, exportRoot: EXPORT_ROOT, loaded, missing })
let harnessMcpOn = false
const harnessMcpInfo = () => ({
  enabled: harnessMcpOn,
  port: 41730,
  running: false,
  error: 'Browser test harness: no MCP server here',
  url: 'http://127.0.0.1:41730/mcp',
  bridge: { command: 'PD2 Sprite Studio.exe', args: ['resources\mcp-bridge.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', PD2SS_MCP_PORT: '41730' } }
})
const handlers: Record<string, (...a: never[]) => unknown> = {
  status,
  setLocation: () => status(),
  pickDir: () => null,
  catalog: () => {
    if (!catalog) {
      const files: string[] = []
      for (const a of vfs.archives) files.push(...a.listfile())
      catalog = buildCatalog(files, (n) => vfs.read(`data\\global\\excel\\${n}.txt`))
    }
    return catalog
  },
  read: (p: string) => {
    const data = vfs.read(p)
    return data ? { data, source: vfs.sourceOf(p) } : null
  },
  readMany: (paths: string[]) => Object.fromEntries(paths.map((p) => [p, vfs.read(p)])),
  saveFile: (o: { defaultName: string; data: Uint8Array }) => {
    fs.mkdirSync(SAVE_DIR, { recursive: true })
    const f = path.join(SAVE_DIR, o.defaultName)
    fs.writeFileSync(f, o.data)
    return f
  },
  // Test stand-in for the open dialog: returns the first file in out-test/web-open/
  openFile: () => {
    const dir = path.resolve('out-test/web-open')
    const name = fs.existsSync(dir) ? fs.readdirSync(dir)[0] : undefined
    return name ? { name, data: new Uint8Array(fs.readFileSync(path.join(dir, name))) } : null
  },
  // Test stand-ins: first model in out-test/models/, renders saved to out-test/web-saves/renders/
  open3d: () => {
    const dir = path.resolve('out-test/models')
    const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => /\.(fbx|glb|gltf|obj)$/i.test(n)) : undefined
    if (!name) return null
    const siblings = fs
      .readdirSync(dir)
      .filter((n) => /\.(png|jpe?g|bin|mtl)$/i.test(n))
      .map((n) => ({ name: n, data: new Uint8Array(fs.readFileSync(path.join(dir, n))) }))
    return { name, data: new Uint8Array(fs.readFileSync(path.join(dir, name))), siblings }
  },
  saveRenderFolder: (files: { name: string; data: Uint8Array }[]) => {
    const dir = path.join(SAVE_DIR, 'renders')
    fs.mkdirSync(dir, { recursive: true })
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.data)
    return dir
  },
  // Test stand-in for the folder picker: out-test/renders/
  openRenderFolder: () => {
    const dir = path.resolve('out-test/renders')
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n)).map((name) => ({ name, data: new Uint8Array(fs.readFileSync(path.join(dir, name))) }))
    const mf = path.join(dir, 'd2_render.json')
    return { dir, files, manifest: fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null }
  },
  saveText: (o: { defaultName: string; text: string }) => {
    fs.mkdirSync(SAVE_DIR, { recursive: true })
    const f = path.join(SAVE_DIR, o.defaultName)
    fs.writeFileSync(f, o.text)
    return f
  },
  pickExportRoot: () => EXPORT_ROOT,
  exportPd2: (files: { rel: string; data: Uint8Array }[]) => {
    const written = files.map((f) => {
      const full = path.join(EXPORT_ROOT, f.rel.replace(/\\/g, path.sep))
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, f.data)
      return full
    })
    return { root: EXPORT_ROOT, written }
  },
  reveal: () => null,
  // AI assistant file access (mirrors the main process's mcp:readFile)
  mcpReadFile: (p: string, kind: 'image' | 'model') => {
    const siblings =
      kind === 'model'
        ? fs
            .readdirSync(path.dirname(p))
            .filter((n) => /\.(png|jpe?g|bin|mtl)$/i.test(n))
            .map((n) => ({ name: n, data: new Uint8Array(fs.readFileSync(path.join(path.dirname(p), n))) }))
        : []
    return { name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)), siblings }
  },
  // Update stand-ins: the harness is never updated in place
  appInfo: () => ({ version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version, repoUrl: 'https://github.com/RoofooEvazan/pd2-sprite-studio', packaged: false }),
  checkUpdate: () => ({ current: JSON.parse(fs.readFileSync('package.json', 'utf8')).version, latest: null, canInstall: false }),
  installUpdate: () => {
    throw new Error('The browser test harness cannot install updates')
  },
  openRepoPage: () => null,
  mcpInfo: () => harnessMcpInfo(),
  mcpConfigure: (cfg: { enabled: boolean }) => {
    harnessMcpOn = cfg.enabled
    return harnessMcpInfo()
  }
}

http
  .createServer((req, res) => {
    const name = (req.url ?? '').replace(/^\/api\//, '')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const args = dec(body ? JSON.parse(body) : []) as never[]
        const out = handlers[name]?.(...args)
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(enc(out ?? null)))
      } catch (e) {
        res.statusCode = 500
        res.end(String(e))
      }
    })
  })
  .listen(API_PORT)

createServer({
  root: path.resolve('src/renderer'),
  plugins: [react()],
  server: { port: WEB_PORT, strictPort: true, proxy: { '/api': `http://localhost:${API_PORT}` } }
})
  .then((server) => server.listen())
  .then(() => console.log(`web harness on http://localhost:${WEB_PORT} (archives: ${loaded.length})`))
