// Update check end to end, as an older install sees it: build a packaged copy that calls itself 1.1.9, start it,
// and ask (through Chrome DevTools) whether it finds the latest GitHub release and can install it. Installs nothing.
// Usage: node --experimental-websocket scripts/testUpdate.cjs   (Node 22+: the flag isn't needed)
const { execSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'out-test', 'update-test')
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  execSync(`npx electron-builder --win --dir --publish never --config.extraMetadata.version=1.1.9 --config.directories.output="${OUT}"`, { cwd: ROOT, stdio: 'ignore' })
  const exe = path.join(OUT, 'win-unpacked', 'PD2 Sprite Studio.exe')
  // --dir builds skip the updater config that the installer build writes (same contents): add it like an install has it
  const cfg = path.join(OUT, 'win-unpacked', 'resources', 'app-update.yml')
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, 'owner: RoofooEvazan\nrepo: pd2-sprite-studio\nprovider: github\nreleaseType: release\nupdaterCacheDirName: pd2-sprite-studio-updater\n')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-updtest-'))
  const app = spawn(exe, [`--remote-debugging-port=${PORT}`], { env: { ...process.env, PD2SS_USER_DATA: userData }, stdio: 'ignore' })
  try {
    let page
    for (let i = 0; i < 60 && !page; i++) {
      await sleep(500)
      page = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page'), () => null)
    }
    if (!page) throw new Error('the app did not start')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    const evaluate = (expression) =>
      new Promise((resolve) => {
        ws.onmessage = (m) => resolve(JSON.parse(m.data).result)
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      })
    await sleep(2000)
    const r = await evaluate('window.api.checkUpdate()')
    const u = r?.result?.value
    console.log(JSON.stringify(u ? { ...u, latest: u.latest && { ...u.latest, notes: `${u.latest.notes.length} chars` } } : r, null, 1))
    const ok = u && u.current === '1.1.9' && u.latest && u.canInstall
    console.log(ok ? 'PASS an older install finds the release and can install it in place' : 'FAIL')
    ws.close()
    process.exitCode = ok ? 0 : 1
  } finally {
    app.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
