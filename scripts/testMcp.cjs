// End-to-end test of the AI assistant connection: launches the built app (npm run build first) with MCP on,
// in a throwaway settings folder, then talks to it over HTTP and through the stdio bridge like a real client.
// Usage: node scripts/testMcp.cjs
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.resolve(__dirname, '..')
const PORT = 41739
const URL = `http://127.0.0.1:${PORT}/mcp`
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'pd2ss-mcp-'))
const exportRoot = path.join(ROOT, 'out-test', 'mcp-export')
fs.writeFileSync(path.join(appData, 'settings.json'), JSON.stringify({ exportRoot, mcp: { enabled: true, port: PORT } }))

let failures = 0
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpc(method, params, id = Math.floor(Math.random() * 1e9)) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
  return res.json()
}
const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result
const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')

async function main() {
  // PD2SS_EXE=<path to the packaged app's exe> tests the installed build and its bundled bridge instead
  const packaged = process.env.PD2SS_EXE
  const electron = packaged || require(path.join(ROOT, 'node_modules', 'electron'))
  const bridgeScript = packaged ? path.join(path.dirname(packaged), 'resources', 'mcp-bridge.cjs') : path.join(ROOT, 'resources', 'mcp-bridge.cjs')
  const app = spawn(electron, packaged ? [] : ['.'], { cwd: ROOT, env: { ...process.env, PD2SS_USER_DATA: appData }, stdio: 'ignore' })
  try {
    // Wait for the server, then for the game archives to be indexed
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(500)
      up = await rpc('ping', {}).then(() => true, () => false)
    }
    check(up, 'server answers on ' + URL)
    if (!up) return

    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    check(init.result?.serverInfo?.name === 'pd2-sprite-studio' && init.result.protocolVersion === '2025-06-18', 'initialize negotiates 2025-06-18')
    const note = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    check(note.status === 202, 'notifications get 202')
    const list = await rpc('tools/list', {})
    check(list.result.tools.length >= 30, `tools/list returns ${list.result.tools.length} tools`)

    let state = ''
    for (let i = 0; i < 60; i++) {
      state = textOf(await call('get_state'))
      if (!state.includes('still indexing')) break
      await sleep(1000)
    }
    check(/archives: [1-9]/.test(state), 'get_state runs in the app window: ' + state.split('\n')[0])

    const found = textOf(await call('search_sprites', { query: 'cap', kind: 'items', limit: 3 }))
    check(found.includes('invcap.dc6'), 'search_sprites finds the cap')
    const opened = await call('open_item', { code: 'cap' })
    check(!opened.isError && opened.content.some((c) => c.type === 'image'), 'open_item returns a picture')
    const recol = await call('recolor_material', { from_index: index(textOf(await call('read_pixels', { width: 56, height: 56 }))), to_index: 150 })
    check(!recol.isError, 'recolor_material: ' + textOf(recol).slice(0, 80))
    const exp = await call('export_pd2')
    check(!exp.isError && fs.existsSync(path.join(exportRoot, 'data', 'global', 'items', 'invcap.dc6')), 'export_pd2 writes invcap.dc6')
    const shot = await rpc('tools/call', { name: 'screenshot_app', arguments: {} })
    check(shot.result.content[0]?.type === 'image' && shot.result.content[0].data.length > 10000, 'screenshot_app returns the window')

    // Website-style request (DNS rebinding) must be refused
    const evil = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{}' })
    check(evil.status === 403, 'requests from web pages are refused')

    // stdio bridge, as Claude Desktop launches it: the app's own executable in Node mode
    const bridge = spawn(electron, [bridgeScript], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PD2SS_MCP_PORT: String(PORT) } })
    const lines = []
    let buf = ''
    bridge.stdout.on('data', (d) => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buf.slice(0, nl)))
        buf = buf.slice(nl + 1)
      }
    })
    const send = (m) => bridge.stdin.write(JSON.stringify(m) + '\n')
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bridge-test', version: '1' } } })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_state', arguments: {} } })
    for (let i = 0; i < 40 && lines.length < 2; i++) await sleep(250)
    bridge.kill()
    check(lines.find((l) => l.id === 1)?.result?.serverInfo?.name === 'pd2-sprite-studio', 'bridge: initialize over stdio')
    check(String(lines.find((l) => l.id === 2)?.result?.content?.[0]?.text).startsWith('Screen:'), 'bridge: tool call over stdio')
  } finally {
    app.kill()
  }
}

/** Most common non-transparent index in a read_pixels dump (the cap's main material). */
function index(dump) {
  const counts = new Map()
  for (const line of dump.split('\n').slice(1)) for (const v of line.split(': ')[1]?.split(' ') ?? []) if (v !== '.') counts.set(v, (counts.get(v) ?? 0) + 1)
  return Number([...counts].sort((a, b) => b[1] - a[1])[0][0])
}

main().then(
  () => {
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
    process.exit(failures ? 1 : 0)
  },
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
