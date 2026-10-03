import { useEffect, useState } from 'react'
import { IconDownload, IconRefresh, IconSettings } from '@tabler/icons-react'
import { TransferDialog } from './components/TransferDialog'
import { ExportDialog } from './components/ExportDialog'
import { RampDialog } from './components/RampDialog'
import { OutlineDialog } from './components/OutlineDialog'
import { RenderImportDialog } from './components/RenderImportDialog'
import { startUpdateCheck, UpdateDialog } from './components/UpdateDialog'
import { Editor } from './editor/Editor'
import { Home } from './screens/Home'
import { UnitPicker } from './screens/UnitPicker'
import { ItemPicker } from './screens/ItemPicker'
import { Studio3D } from './studio/Studio'
import { TileMaker } from './studio/TileMaker'
import { IconButton, Kbd } from './ui'
import { api, McpInfo } from './api'
import { facingOrder } from './names'
import { startMcpBridge } from './mcp'
import {
  cancelFloating,
  changeLocation,
  clearSelection,
  commitFloating,
  copySelection,
  cutSelection,
  deleteSelection,
  directions,
  flipFloating,
  getState,
  goTo,
  init,
  moveFloating,
  pasteClip,
  redo,
  selectAll,
  setState,
  stepFrame,
  Tool,
  undo,
  useStore
} from './store'

const KEYS: Record<string, Tool> = {
  b: 'pencil',
  e: 'eraser',
  d: 'shade',
  g: 'fill',
  i: 'picker',
  l: 'line',
  u: 'rect',
  r: 'replace',
  j: 'ramp',
  s: 'select',
  a: 'lasso',
  w: 'wand',
  m: 'move'
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return
      const s = getState()
      if (s.prompt || s.showExport || s.showTransfer || s.rampDialog || s.showOutline || s.renderImport) {
        if (e.key === 'Escape') setState({ showExport: false, showTransfer: false, rampDialog: null, showOutline: false, renderImport: null })
        return
      }
      if (s.screen !== 'editor' || !s.doc) return
      const k = e.key.toLowerCase()
      if (k === '\\') return setState({ showOriginal: true })
      if (e.ctrlKey && k === 'z') return (e.preventDefault(), e.shiftKey ? redo() : undo())
      if (e.ctrlKey && k === 'y') return (e.preventDefault(), redo())
      if (e.ctrlKey && k === 'c') return (e.preventDefault(), copySelection())
      if (e.ctrlKey && k === 'x') return (e.preventDefault(), cutSelection())
      if (e.ctrlKey && k === 'v') return (e.preventDefault(), pasteClip())
      if (e.ctrlKey && k === 'a') return (e.preventDefault(), selectAll())
      if (e.ctrlKey && k === 'd') return (e.preventDefault(), clearSelection())
      if (e.ctrlKey) return
      if (k === 'enter') return commitFloating()
      if (k === 'escape') return s.floating ? cancelFloating() : setState({ selection: null, version: s.version + 1 })
      if (k === 'delete' || k === 'backspace') return deleteSelection()
      if (s.floating && k.startsWith('arrow')) {
        e.preventDefault()
        const n = e.shiftKey ? 10 : 1
        return moveFloating(k === 'arrowleft' ? -n : k === 'arrowright' ? n : 0, k === 'arrowup' ? -n : k === 'arrowdown' ? n : 0)
      }
      if ((s.floating || s.selection) && (k === 'h' || k === 'v')) return flipFloating(k)
      if (k === ',' || k === 'arrowleft') return (setState({ playing: false }), stepFrame(-1))
      if (k === '.' || k === 'arrowright') return (setState({ playing: false }), stepFrame(1))
      if (k === 'arrowup' || k === 'arrowdown') {
        e.preventDefault()
        const order = facingOrder(directions())
        const i = order.indexOf(s.dir)
        return setState({ dir: order[(i + (k === 'arrowup' ? -1 : 1) + order.length) % order.length] })
      }
      if (k === ' ') return (e.preventDefault(), setState({ playing: !s.playing }))
      if (k === 'x') return setState({ primary: s.secondary, secondary: s.primary })
      if (k === 'o') return setState({ view: { ...s.view, onion: !s.view.onion }, version: s.version + 1 })
      if (k === 't' && s.doc?.kind === 'anim') return setState({ showTransfer: true })
      if (k === '+' || k === '=') return setState({ zoom: Math.min(32, s.zoom + 1) })
      if (k === '-') return setState({ zoom: Math.max(1, s.zoom - 1) })
      if (k === 'g' && e.shiftKey) return setState({ tool: 'fillAll' })
      if (k === 'u' && e.shiftKey) return setState({ tool: 'rectFill' })
      if (KEYS[k]) setState({ tool: KEYS[k] })
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') setState({ showOriginal: false })
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])
}

const SHORTCUTS: [string, string][] = [
  ['B', 'Draw'],
  ['E', 'Erase'],
  ['D', 'Shade'],
  ['J', 'Recolour a material'],
  ['R', 'Recolour one colour'],
  ['G', 'Fill'],
  ['S / A / W', 'Select: box, lasso, magic wand'],
  ['I', 'Pick a colour'],
  ['L / U', 'Line / box'],
  ['M', 'Move the frame'],
  ['X', 'Swap your two colours'],
  ['Space', 'Play / pause'],
  ['← →', 'Previous / next frame'],
  ['↑ ↓', 'Turn the character'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+C / X / V', 'Copy / cut / paste'],
  ['H / V', 'Flip the selection'],
  ['Enter / Esc', 'Place / cancel moved pixels'],
  ['\\ (hold)', 'Compare with the original'],
  ['Alt+click', 'Choose the “only paint on” colour'],
  ['T', 'Copy changes to other frames'],
  ['Ctrl+wheel', 'Zoom']
]

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mcp-snippet">
      <div className="mcp-snippet-head">
        <span>{label}</span>
        <button
          className="chip-btn"
          onClick={() => {
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="mono small">{value}</pre>
    </div>
  )
}

/** Turn the MCP server on/off and show how to connect AI assistants to it. */
function McpSettings() {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [port, setPort] = useState('')
  useEffect(() => {
    api.mcpInfo().then((i) => {
      setInfo(i)
      setPort(String(i.port))
    })
  }, [])
  if (!info) return null
  const apply = async (enabled: boolean) => {
    const p = parseInt(port, 10)
    setInfo(await api.mcpConfigure({ enabled, port: p > 0 ? p : info.port }))
  }
  const desktop = JSON.stringify({ mcpServers: { 'pd2-sprite-studio': { command: info.bridge.command, args: info.bridge.args, env: info.bridge.env } } }, null, 2)
  return (
    <section>
      <h4>AI assistants (MCP)</h4>
      <label className="check-row">
        <input type="checkbox" checked={info.enabled} onChange={(e) => apply(e.target.checked)} /> Let AI assistants use PD2 Sprite Studio
      </label>
      <div className="insp-help">
        Assistants like Claude can then open sprites, recolour and draw, carry edits across frames, build Tile Maker scenes and export, while you watch. Every
        change is a normal undo step. While this is on, programs on this computer can control the app, so turn it off when you're not using it.
      </div>
      <div className="row mcp-status">
        <span className={`mcp-dot${info.running ? ' on' : ''}`} />
        <span className="small">{info.running ? `Running at ${info.url}` : info.enabled ? `Not running${info.error ? `: ${info.error}` : ''}` : 'Off'}</span>
        <span className="flex" />
        <span className="small muted">Port</span>
        <input type="number" value={port} onChange={(e) => setPort(e.target.value)} onBlur={() => info.enabled && String(info.port) !== port && apply(true)} style={{ width: 80 }} />
      </div>
      {info.enabled && (
        <>
          <CopyBlock label="Claude Code: run in a terminal" value={`claude mcp add --transport http pd2-sprite-studio ${info.url}`} />
          <CopyBlock label="Claude Desktop: add to claude_desktop_config.json, then restart Claude" value={desktop} />
          <div className="insp-help">Other MCP clients: connect to {info.url} (Streamable HTTP), or launch the bridge above over stdio.</div>
        </>
      )}
    </section>
  )
}

function UpdatesSection() {
  const [version, setVersion] = useState('')
  const update = useStore((s) => s.update)
  useEffect(() => {
    api.appInfo().then((i) => setVersion(i.version)).catch(() => undefined)
  }, [])
  return (
    <section>
      <h4>Updates</h4>
      <div className="row update-row">
        <span className="small">
          PD2 Sprite Studio <b>{version || '…'}</b>
          {update?.latest && <span className="update-pill">{update.latest.version} available</span>}
        </span>
        <span className="flex" />
        <button className="chip-btn" onClick={() => setState({ showUpdate: true })}>
          <IconRefresh size={15} /> Check for updates
        </button>
      </div>
      <div className="insp-help">The app also checks GitHub by itself once a day and tells you when a new version is out. It never installs one without asking.</div>
    </section>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const status = useStore((s) => s.status)
  const [d2Dir, setD2] = useState(status?.location.d2Dir ?? '')
  const [pd2Dir, setPd2] = useState(status?.location.pd2Dir ?? '')
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Settings
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="export-body">
          <section>
            <h4>Game folders</h4>
            <label className="field">
              <span>Diablo II folder</span>
              <div className="row">
                <input className="full" value={d2Dir} onChange={(e) => setD2(e.target.value)} />
                <button className="chip-btn" onClick={async () => (await api.pickDir('Diablo II folder').then((p) => p && setD2(p)))}>
                  Browse…
                </button>
              </div>
            </label>
            <label className="field">
              <span>Project Diablo 2 folder</span>
              <div className="row">
                <input className="full" value={pd2Dir} onChange={(e) => setPd2(e.target.value)} />
                <button className="chip-btn" onClick={async () => (await api.pickDir('ProjectD2 folder').then((p) => p && setPd2(p)))}>
                  Browse…
                </button>
              </div>
            </label>
            <div className="insp-help">
              {status?.loaded.length ?? 0} game archives loaded.
              {status?.missing.length ? ` Missing: ${status.missing.join(', ')}` : ''}
            </div>
            <div className="modal-actions">
              <button
                className="primary-btn"
                onClick={() => {
                  onClose()
                  changeLocation({ d2Dir, pd2Dir })
                }}
              >
                Apply and reload
              </button>
            </div>
          </section>
          <UpdatesSection />
          <McpSettings />
          <section>
            <h4>Keyboard shortcuts</h4>
            <div className="shortcut-grid">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="sc-row">
                  <Kbd>{k}</Kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4>Tips</h4>
            <button
              className="chip-btn"
              onClick={() => {
                try {
                  localStorage.removeItem('pd2ss.tipsSeen')
                } catch {
                  /* ignore */
                }
                onClose()
              }}
            >
              Show the quick tour again
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

function PromptModal() {
  const prompt = useStore((s) => s.prompt)
  const [v, setV] = useState('')
  useEffect(() => setV(prompt?.value ?? ''), [prompt])
  if (!prompt) return null
  return (
    <div className="modal-back" onMouseDown={() => prompt.resolve(null)}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{prompt.title}</div>
        <form
          className="pad"
          onSubmit={(e) => {
            e.preventDefault()
            prompt.resolve(v)
          }}
        >
          <input className="full" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && prompt.resolve(null)} />
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => prompt.resolve(null)}>
              Cancel
            </button>
            <button type="submit" className="primary-btn">
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function App() {
  const screen = useStore((s) => s.screen)
  const doc = useStore((s) => s.doc)
  const loadingMsg = useStore((s) => s.loadingMsg)
  const toastMsg = useStore((s) => s.toast)
  const update = useStore((s) => s.update)
  const [settings, setSettings] = useState(false)
  useShortcuts()
  useEffect(() => {
    init()
    startMcpBridge()
    startUpdateCheck()
  }, [])
  const inEditor = screen === 'editor' && !!doc
  const in3d = screen === '3d' || screen === 'tiles'

  return (
    <div className="app">
      {!inEditor && !in3d && (
        <header className="app-header">
          <button className="brand" onClick={() => goTo('home')}>
            <span className="brand-mark">PD2</span> Sprite Studio
          </button>
          <span className="flex" />
          {update?.latest ? (
            <button className="update-pill btn-like" onClick={() => setState({ showUpdate: true })} data-tip="Install the new version">
              <IconDownload size={14} /> Update to {update.latest.version}
            </button>
          ) : (
            <IconButton icon={IconRefresh} label="Check for updates" onClick={() => setState({ showUpdate: true })} />
          )}
          <IconButton icon={IconSettings} label="Settings" onClick={() => setSettings(true)} />
        </header>
      )}
      <main className="app-main">
        {screen === 'tiles' ? (
          <TileMaker />
        ) : in3d ? (
          <Studio3D />
        ) : inEditor ? (
          <Editor onSettings={() => setSettings(true)} />
        ) : screen === 'chars' ? (
          <UnitPicker base="chars" />
        ) : screen === 'monsters' ? (
          <UnitPicker base="monsters" />
        ) : screen === 'objects' ? (
          <UnitPicker base="objects" />
        ) : screen === 'items' ? (
          <ItemPicker />
        ) : (
          <Home />
        )}
      </main>
      {loadingMsg && doc && <div className="loading-bar">{loadingMsg}</div>}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {settings && <Settings onClose={() => setSettings(false)} />}
      <TransferDialog />
      <ExportDialog />
      <RampDialog />
      <OutlineDialog />
      <RenderImportDialog />
      <UpdateDialog />
      <PromptModal />
    </div>
  )
}
