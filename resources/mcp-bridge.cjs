#!/usr/bin/env node
// PD2 Sprite Studio MCP bridge: connects MCP clients that launch servers over stdio (e.g. Claude Desktop)
// to the running app's local MCP endpoint (http://127.0.0.1:<port>/mcp).
//
// Launched by the app's own executable in Node mode, so nothing else needs installing:
//   command: "<install dir>\PD2 Sprite Studio.exe", args: ["<install dir>\resources\mcp-bridge.cjs"],
//   env: { "ELECTRON_RUN_AS_NODE": "1", "PD2SS_MCP_PORT": "41730" }
'use strict'

const port = Number(process.env.PD2SS_MCP_PORT || 41730)
const url = `http://127.0.0.1:${port}/mcp`
const NOT_RUNNING = `PD2 Sprite Studio isn't reachable at ${url}. Open the app and turn on Settings › AI assistants (MCP).`

let buffer = ''
const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n')

async function forward(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  const ids = (Array.isArray(msg) ? msg : [msg]).filter((m) => m && m.id !== undefined && m.id !== null).map((m) => m.id)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: line
    })
    if (res.status === 202) return
    const body = await res.text()
    if (!body) return
    const out = JSON.parse(body)
    for (const m of Array.isArray(out) ? out : [out]) write(m)
  } catch (e) {
    for (const id of ids) write({ jsonrpc: '2.0', id, error: { code: -32000, message: NOT_RUNNING } })
    if (!ids.length) process.stderr.write(`${NOT_RUNNING} (${e && e.message})\n`)
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line) forward(line)
  }
})
process.stdin.on('end', () => process.exit(0))
