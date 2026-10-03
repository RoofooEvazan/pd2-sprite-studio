// Update check against GitHub Releases (like DS1 Studio / PD2 Planner): the release's notes come from the GitHub API,
// and electron-updater downloads the new installer (sha512 from latest.yml), runs it silently and restarts the app.

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

export const REPO = 'RoofooEvazan/pd2-sprite-studio'
export const REPO_URL = `https://github.com/${REPO}`

export interface UpdateInfo {
  current: string
  /** null when this is the newest version */
  latest: { version: string; notes: string; date?: string; url: string } | null
  /** true when this install can download and install the update itself */
  canInstall: boolean
  /** why it can't install itself, when canInstall is false */
  why?: string
}

/** Dotted version comparison ("1.10.0" > "1.9.3"); a leading "v" is ignored. */
export function newerThan(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

async function latestRelease(): Promise<{ version: string; notes: string; date?: string; url: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `PD2-Sprite-Studio/${appVersion()}` }
  })
  if (res.status === 404) return null // no releases yet
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const r = (await res.json()) as { tag_name: string; body?: string; published_at?: string; html_url: string }
  return { version: r.tag_name.replace(/^v/, ''), notes: r.body ?? '', date: r.published_at, url: r.html_url }
}

/** This app's version (development runs read package.json: Electron can report its own version there). */
export function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version
  } catch {
    return app.getVersion()
  }
}

let readyToDownload = false

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = appVersion()
  const rel = await latestRelease()
  if (!rel || !newerThan(rel.version, current)) return { current, latest: null, canInstall: false }
  if (!app.isPackaged) return { current, latest: rel, canInstall: false, why: 'This is a development build: update it from the source instead.' }
  try {
    const r = await autoUpdater.checkForUpdates()
    readyToDownload = !!r && newerThan(r.updateInfo.version, current)
    if (readyToDownload) return { current, latest: rel, canInstall: true }
    return { current, latest: rel, canInstall: false, why: 'Its installer is still being uploaded (this takes a few minutes after a release appears). Check again shortly and it will install itself.' }
  } catch (e) {
    return { current, latest: rel, canInstall: false, why: `This install can't update itself (${e instanceof Error ? e.message : String(e)}): download the new version from the release page.` }
  }
}

export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = null

  ipcMain.handle('app:info', () => ({ version: appVersion(), repoUrl: REPO_URL, packaged: app.isPackaged }))
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:install', async () => {
    if (!readyToDownload) await checkForUpdate()
    if (!readyToDownload) throw new Error('No update is ready to install')
    const onProgress = (p: { transferred: number; total: number }) => getWindow()?.webContents.send('update:progress', { done: p.transferred, total: p.total || null })
    autoUpdater.on('download-progress', onProgress)
    try {
      await autoUpdater.downloadUpdate()
    } finally {
      autoUpdater.off('download-progress', onProgress)
    }
    // Silent install, then start the new version
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  })
  // Only our own GitHub pages (release notes, downloads) are opened from the update dialog
  ipcMain.handle('shell:openRepo', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith(`${REPO_URL}/`)) return shell.openExternal(url)
    throw new Error('Not a PD2 Sprite Studio page')
  })
}
