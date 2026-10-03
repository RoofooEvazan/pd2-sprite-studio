import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { MpqVfs } from '../core/mpq'
import { buildCatalog, Catalog } from '../core/catalog'
import { defaultGameLocation, GameLocation, openGameVfs } from './nodeMpq'
import { DEFAULT_MCP_PORT, McpServer, ToolResult } from './mcpServer'

interface Settings {
  location: GameLocation
  exportRoot: string
  /** AI assistant connection (MCP); off until the user turns it on */
  mcp: { enabled: boolean; port: number }
}

// Automation hook (tests): keep settings in a throwaway folder
if (process.env.PD2SS_USER_DATA) app.setPath('userData', process.env.PD2SS_USER_DATA)

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings(): Settings {
  const def: Settings = { location: defaultGameLocation(), exportRoot: path.join(app.getPath('documents'), 'PD2 Sprite Studio', 'export'), mcp: { enabled: false, port: DEFAULT_MCP_PORT } }
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    return def
  }
}

function saveSettings(s: Settings): void {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2))
}

let settings: Settings
let vfs: MpqVfs | null = null
let status = { loaded: [] as string[], missing: [] as string[] }
let catalog: Catalog | null = null

function openVfs(): void {
  const r = openGameVfs(settings.location)
  vfs = r.vfs
  status = { loaded: r.loaded, missing: r.missing }
  catalog = null
}

function getCatalog(): Catalog {
  if (!vfs) throw new Error('Game archives not loaded')
  if (!catalog) {
    const files: string[] = []
    for (const a of vfs.archives) {
      try {
        files.push(...a.listfile())
      } catch {
        /* archive without readable listfile */
      }
    }
    const v = vfs
    catalog = buildCatalog(files, (n) => v.read(`data\\global\\excel\\${n}.txt`))
  }
  return catalog
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#15130f',
    title: 'PD2 Sprite Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // Tool calls wait until the page has registered its handler again after any (re)load
  win.webContents.on('did-start-loading', () => (rendererReady = null))
}

// ------------------------------------------------------------------ AI assistant connection (MCP)

const pendingCalls = new Map<number, (r: ToolResult) => void>()
let nextCall = 1
/** Resolves once the renderer listens for tool calls; null while the page is (re)loading. */
let rendererReady: Promise<void> | null = null
let markReady: (() => void) | null = null

function whenRendererReady(): Promise<void> {
  if (!rendererReady) rendererReady = new Promise((r) => (markReady = r))
  return rendererReady
}

/** Run a tool in the renderer (where the open sprite / scene lives) and wait for its result. */
async function callRenderer(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const win = mainWindow
  if (!win) throw new Error('The PD2 Sprite Studio window is closed')
  const ready = await Promise.race([whenRendererReady().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30_000))])
  if (!ready) throw new Error('PD2 Sprite Studio is still starting up; try again in a moment')
  const id = nextCall++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error(`${name} timed out`))
    }, 180_000)
    pendingCalls.set(id, (r) => {
      clearTimeout(timer)
      resolve(r)
    })
    win.webContents.send('mcp:call', { id, name, args })
  })
}

const mcp = new McpServer(() => mainWindow, callRenderer, app.getVersion())

/** How an MCP client launches the stdio bridge (for clients that only speak stdio, like Claude Desktop). */
function bridgeLaunch(): { command: string; args: string[]; env: Record<string, string> } {
  // Packaged: resources/mcp-bridge.cjs next to app.asar. Development: <repo>/resources (this file runs from out/main)
  const script = app.isPackaged ? path.join(process.resourcesPath, 'mcp-bridge.cjs') : path.join(__dirname, '..', '..', 'resources', 'mcp-bridge.cjs')
  return { command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1', PD2SS_MCP_PORT: String(settings.mcp.port) } }
}

function mcpInfo() {
  return {
    enabled: settings.mcp.enabled,
    port: settings.mcp.port,
    running: mcp.running,
    error: mcp.error,
    url: `http://127.0.0.1:${settings.mcp.port}/mcp`,
    bridge: bridgeLaunch()
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i
const MODEL_EXT = /\.(glb|gltf|fbx|obj)$/i

/** A model file plus the textures / buffers next to it (and in a textures/ subfolder), so loaders can resolve them. */
export function readModelWithSiblings(file: string): { name: string; data: Uint8Array; siblings: { name: string; data: Uint8Array }[] } {
  const dir = path.dirname(file)
  const exts = /\.(png|jpe?g|tga|bmp|gif|webp|bin|mtl)$/i
  const siblings: { name: string; data: Uint8Array }[] = []
  let total = 0
  const scan = (d: string, prefix: string) => {
    if (!fs.existsSync(d)) return
    for (const n of fs.readdirSync(d)) {
      const full = path.join(d, n)
      if (!exts.test(n) || !fs.statSync(full).isFile()) continue
      const size = fs.statSync(full).size
      if (total + size > 200 * 1024 * 1024) return
      total += size
      siblings.push({ name: prefix + n, data: new Uint8Array(fs.readFileSync(full)) })
    }
  }
  scan(dir, '')
  for (const sub of ['textures', 'Textures', 'tex', 'maps']) scan(path.join(dir, sub), `${sub}/`)
  return { name: path.basename(file), data: new Uint8Array(fs.readFileSync(file)), siblings }
}

/** All PNG renders in a folder plus the optional d2_render.json written by the render scripts. */
export function readRenderFolder(dir: string): { dir: string; files: { name: string; data: Uint8Array }[]; manifest: unknown } {
  const names = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n))
  const files = names.map((name) => ({ name, data: new Uint8Array(fs.readFileSync(path.join(dir, name))) }))
  let manifest: unknown = null
  const mf = path.join(dir, 'd2_render.json')
  if (fs.existsSync(mf)) {
    try {
      manifest = JSON.parse(fs.readFileSync(mf, 'utf8'))
    } catch {
      manifest = null
    }
  }
  return { dir, files, manifest }
}

function safeRel(rel: string): string {
  const norm = path.normalize(rel.replace(/\\/g, path.sep)).replace(/^([/\\])+/, '')
  if (norm.startsWith('..')) throw new Error(`Invalid export path: ${rel}`)
  return norm
}

app.whenReady().then(() => {
  settings = loadSettings()
  try {
    openVfs()
  } catch (e) {
    status = { loaded: [], missing: [String(e)] }
  }

  ipcMain.handle('game:status', () => ({ location: settings.location, exportRoot: settings.exportRoot, ...status }))

  ipcMain.handle('game:setLocation', (_e, loc: GameLocation) => {
    settings.location = loc
    saveSettings(settings)
    openVfs()
    return { location: settings.location, exportRoot: settings.exportRoot, ...status }
  })

  ipcMain.handle('game:pickDir', async (_e, title: string) => {
    const r = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('game:catalog', () => getCatalog())

  ipcMain.handle('game:read', (_e, p: string) => {
    if (!vfs) return null
    const data = vfs.read(p)
    return data ? { data, source: vfs.sourceOf(p) } : null
  })

  ipcMain.handle('game:readMany', (_e, paths: string[]) => {
    const out: Record<string, Uint8Array | null> = {}
    for (const p of paths) out[p] = vfs?.read(p) ?? null
    return out
  })

  ipcMain.handle('file:save', async (_e, opts: { defaultName: string; data: Uint8Array; filters: { name: string; extensions: string[] }[] }) => {
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('pictures'), opts.defaultName), filters: opts.filters })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, opts.data)
    return r.filePath
  })

  ipcMain.handle('file:open', async (_e, filters: { name: string; extensions: string[] }[]) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters })
    if (r.canceled || !r.filePaths[0]) return null
    return { name: path.basename(r.filePaths[0]), data: new Uint8Array(fs.readFileSync(r.filePaths[0])) }
  })

  ipcMain.handle('file:openRenderFolder', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose the folder with your 3D renders', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return readRenderFolder(r.filePaths[0])
  })

  ipcMain.handle('file:open3d', async () => {
    // Automation hook (screenshot capture script): open this model without a dialog
    if (process.env.PD2SS_OPEN3D) return readModelWithSiblings(process.env.PD2SS_OPEN3D)
    const r = await dialog.showOpenDialog({
      title: 'Open a 3D model',
      properties: ['openFile'],
      filters: [{ name: '3D models', extensions: ['fbx', 'glb', 'gltf', 'obj'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return readModelWithSiblings(r.filePaths[0])
  })

  ipcMain.handle('file:saveRenderFolder', async (_e, files: { name: string; data: Uint8Array }[]) => {
    const r = await dialog.showOpenDialog({ title: 'Choose a folder for the rendered PNGs', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], path.basename(f.name)), f.data)
    return r.filePaths[0]
  })

  ipcMain.handle('file:saveText', async (_e, opts: { defaultName: string; text: string }) => {
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('documents'), opts.defaultName) })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, opts.text)
    return r.filePath
  })

  ipcMain.handle('export:pickRoot', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose export root (files are written under data\\global\\...)', defaultPath: settings.exportRoot, properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    settings.exportRoot = r.filePaths[0]
    saveSettings(settings)
    return settings.exportRoot
  })

  ipcMain.handle('export:pd2', (_e, files: { rel: string; data: Uint8Array }[]) => {
    const written: string[] = []
    for (const f of files) {
      const full = path.join(settings.exportRoot, safeRel(f.rel))
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, f.data)
      written.push(full)
    }
    return { root: settings.exportRoot, written }
  })

  ipcMain.handle('shell:reveal', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.on('mcp:ready', () => {
    whenRendererReady()
    markReady?.()
  })
  ipcMain.on('mcp:result', (_e, msg: { id: number; result: ToolResult }) => {
    pendingCalls.get(msg.id)?.(msg.result)
    pendingCalls.delete(msg.id)
  })
  ipcMain.handle('mcp:info', () => mcpInfo())
  ipcMain.handle('mcp:configure', async (_e, cfg: { enabled: boolean; port?: number }) => {
    settings.mcp = { enabled: cfg.enabled, port: Math.max(1024, Math.min(65535, Math.round(cfg.port ?? settings.mcp.port))) }
    saveSettings(settings)
    if (settings.mcp.enabled) await mcp.start(settings.mcp.port)
    else mcp.stop()
    return mcpInfo()
  })
  // Files an AI assistant names by path (images to import, models for the Tile Maker)
  ipcMain.handle('mcp:readFile', (_e, p: string, kind: 'image' | 'model') => {
    if (!path.isAbsolute(p) || !fs.existsSync(p)) throw new Error(`File not found: ${p}`)
    if (kind === 'image') {
      if (!IMAGE_EXT.test(p)) throw new Error('Only PNG, JPEG, GIF, BMP or WebP images can be imported')
      return { name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)), siblings: [] }
    }
    if (!MODEL_EXT.test(p)) throw new Error('Only GLB, glTF, FBX or OBJ models can be imported')
    return readModelWithSiblings(p)
  })
  if (settings.mcp.enabled) mcp.start(settings.mcp.port)

  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
