import { contextBridge, ipcRenderer } from 'electron'

const api = {
  status: () => ipcRenderer.invoke('game:status'),
  setLocation: (loc: { d2Dir: string; pd2Dir: string }) => ipcRenderer.invoke('game:setLocation', loc),
  pickDir: (title: string) => ipcRenderer.invoke('game:pickDir', title),
  catalog: () => ipcRenderer.invoke('game:catalog'),
  read: (path: string) => ipcRenderer.invoke('game:read', path),
  readMany: (paths: string[]) => ipcRenderer.invoke('game:readMany', paths),
  saveFile: (opts: { defaultName: string; data: Uint8Array; filters: { name: string; extensions: string[] }[] }) => ipcRenderer.invoke('file:save', opts),
  openFile: (filters: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('file:open', filters),
  open3d: () => ipcRenderer.invoke('file:open3d'),
  saveRenderFolder: (files: { name: string; data: Uint8Array }[]) => ipcRenderer.invoke('file:saveRenderFolder', files),
  openRenderFolder: () => ipcRenderer.invoke('file:openRenderFolder'),
  saveText: (opts: { defaultName: string; text: string }) => ipcRenderer.invoke('file:saveText', opts),
  pickExportRoot: () => ipcRenderer.invoke('export:pickRoot'),
  exportPd2: (files: { rel: string; data: Uint8Array }[]) => ipcRenderer.invoke('export:pd2', files),
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  mcpInfo: () => ipcRenderer.invoke('mcp:info'),
  mcpConfigure: (cfg: { enabled: boolean; port?: number }) => ipcRenderer.invoke('mcp:configure', cfg),
  mcpReadFile: (path: string, kind: 'image' | 'model') => ipcRenderer.invoke('mcp:readFile', path, kind),
  onMcpCall: (handler: (msg: { id: number; name: string; args: Record<string, unknown> }) => void) => {
    ipcRenderer.removeAllListeners('mcp:call')
    ipcRenderer.on('mcp:call', (_e, msg) => handler(msg))
    ipcRenderer.send('mcp:ready')
  },
  mcpResult: (msg: { id: number; result: unknown }) => ipcRenderer.send('mcp:result', msg),
  appInfo: () => ipcRenderer.invoke('app:info'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (handler: (p: { done: number; total: number | null }) => void) => {
    ipcRenderer.removeAllListeners('update:progress')
    ipcRenderer.on('update:progress', (_e, p) => handler(p))
  },
  openRepoPage: (url: string) => ipcRenderer.invoke('shell:openRepo', url)
}

contextBridge.exposeInMainWorld('api', api)
