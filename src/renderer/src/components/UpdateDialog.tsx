import { useEffect, useState } from 'react'
import { api, UpdateCheck } from '../api'
import { getState, setState, toast, useStore } from '../store'

type View =
  | { kind: 'checking' }
  | { kind: 'none'; current: string }
  | { kind: 'available'; info: UpdateCheck }
  | { kind: 'installing'; info: UpdateCheck; done: number; total: number | null }
  | { kind: 'error'; message: string }

const DAY = 86_400_000
const LAST_CHECK = 'pd2ss.updateCheck'

/** Desktop app: a quiet update check at most once a day; a newer version is announced, never installed unasked. */
export function startUpdateCheck(): void {
  if (!window.api) return // browser test harness
  let last = 0
  try {
    last = Number(localStorage.getItem(LAST_CHECK)) || 0
  } catch {
    /* per-viewer convenience only */
  }
  if (Date.now() - last < DAY) return
  setTimeout(() => {
    api
      .checkUpdate()
      .then((u) => {
        try {
          localStorage.setItem(LAST_CHECK, String(Date.now()))
        } catch {
          /* ignore */
        }
        if (u.latest) {
          setState({ update: u })
          toast(`PD2 Sprite Studio ${u.latest.version} is available: Settings › Check for updates`)
        }
      })
      .catch(() => undefined)
  }, 4000)
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** Check for updates: finds a newer GitHub release and installs it (or links to it). */
export function UpdateDialog() {
  const show = useStore((s) => s.showUpdate)
  const [view, setView] = useState<View>({ kind: 'checking' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!show) return
    // The startup check's result is reused only when it can install; otherwise look again (the installer may be up now)
    const pending = getState().update
    if (pending?.canInstall && attempt === 0) return setView({ kind: 'available', info: pending })
    setView({ kind: 'checking' })
    api
      .checkUpdate()
      .then((info) => {
        setState({ update: info.latest ? info : null })
        setView(info.latest ? { kind: 'available', info } : { kind: 'none', current: info.current })
      })
      .catch((e) => setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) }))
  }, [show, attempt])

  if (!show) return null
  const close = () => view.kind !== 'installing' && setState({ showUpdate: false })
  const install = async (info: UpdateCheck) => {
    setView({ kind: 'installing', info, done: 0, total: null })
    api.onUpdateProgress?.((p) => setView({ kind: 'installing', info, done: p.done, total: p.total }))
    try {
      await api.installUpdate() // the app closes and restarts into the new version
    } catch (e) {
      setView({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  const current = view.kind === 'none' ? view.current : view.kind === 'available' || view.kind === 'installing' ? view.info.current : null
  const latest = view.kind === 'available' || view.kind === 'installing' ? view.info.latest! : null

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Check for updates
          <button className="x" onClick={close} aria-label="Close" disabled={view.kind === 'installing'}>
            ×
          </button>
        </div>
        <div className="export-body">
          {current && (
            <p className="small">
              You have <b>{current}</b>.
            </p>
          )}
          {view.kind === 'checking' && <p className="muted small">Checking GitHub…</p>}
          {view.kind === 'none' && <p className="small">You&apos;re up to date.</p>}
          {view.kind === 'error' && <p className="small error-text">Couldn&apos;t check for updates: {view.message}. You can look at the releases page instead.</p>}
          {latest && (
            <>
              <p className="small">
                <b>{latest.version}</b> is available{latest.date ? ` (released ${new Date(latest.date).toLocaleDateString()})` : ''}.
              </p>
              {latest.notes && <pre className="release-notes">{latest.notes}</pre>}
              {view.kind === 'available' && !view.info.canInstall && <p className="muted small">{view.info.why ?? 'Download the new version from the release page.'}</p>}
              {view.kind === 'installing' && (
                <div className="update-progress">
                  <div className="update-bar">
                    <span style={{ width: view.total ? `${Math.min(100, (view.done / view.total) * 100)}%` : '8%' }} />
                  </div>
                  <span className="small muted">
                    {view.total ? `Downloading ${mb(view.done)} of ${mb(view.total)}…` : 'Starting the download…'} The app restarts by itself when it's installed.
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-actions">
          {(view.kind === 'error' || latest) && (
            <button className="btn" disabled={view.kind === 'installing'} onClick={() => api.openRepoPage(latest?.url ?? `${REPO_RELEASES}`).catch((e) => toast(String(e)))}>
              Release page
            </button>
          )}
          {(view.kind === 'none' || view.kind === 'error') && (
            <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
              Check again
            </button>
          )}
          {view.kind === 'available' && view.info.canInstall ? (
            <button className="primary-btn" onClick={() => install(view.info)}>
              Install {view.info.latest!.version} and restart
            </button>
          ) : (
            <button className="primary-btn" disabled={view.kind === 'installing'} onClick={close}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const REPO_RELEASES = 'https://github.com/RoofooEvazan/pd2-sprite-studio/releases'
