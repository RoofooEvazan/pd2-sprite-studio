// MCP (Model Context Protocol) server: lets AI assistants (Claude Code, Claude Desktop via the stdio bridge, …)
// drive the open app. Streamable HTTP transport on 127.0.0.1, JSON responses only (no server-initiated streams).
// Tool calls run in the renderer, against whatever the user has open, so every change shows up live.

import http from 'node:http'
import { BrowserWindow } from 'electron'
import { MCP_INSTRUCTIONS, MCP_TOOLS } from '../core/mcpTools'

export const DEFAULT_MCP_PORT = 41730
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

type Json = Record<string, unknown>
interface RpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Json
}
export interface ToolResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  isError?: boolean
}

export class McpServer {
  private server: http.Server | null = null
  port = DEFAULT_MCP_PORT
  error: string | null = null

  constructor(
    private getWindow: () => BrowserWindow | null,
    private callRenderer: (name: string, args: Json) => Promise<ToolResult>,
    private version: string
  ) {}

  get running(): boolean {
    return !!this.server?.listening
  }

  start(port: number): Promise<void> {
    this.stop()
    this.port = port
    this.error = null
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => this.handle(req, res))
      srv.on('error', (e) => {
        this.error = (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${port} is already in use` : String(e)
        this.server = null
        resolve()
      })
      srv.listen(port, '127.0.0.1', () => {
        this.server = srv
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Only local pages/tools may connect (guards against DNS rebinding from websites)
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    const origin = req.headers.origin
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin))) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const path = (req.url ?? '').split('?')[0]
    if (path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('PD2 Sprite Studio MCP server: POST JSON-RPC to /mcp')
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      let body: RpcMessage | RpcMessage[]
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        this.reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
        return
      }
      const list = Array.isArray(body) ? body : [body]
      const out = (await Promise.all(list.map((m) => this.dispatch(m)))).filter((r): r is Json => r !== null)
      if (!out.length) res.writeHead(202).end()
      else this.reply(res, 200, Array.isArray(body) ? out : out[0])
    })
  }

  private reply(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
  }

  private async dispatch(m: RpcMessage): Promise<Json | null> {
    if (m.id === undefined || m.id === null) return null // notification (initialized, cancelled, …)
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result })
    const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } })
    switch (m.method) {
      case 'initialize': {
        const asked = String(m.params?.protocolVersion ?? '')
        return ok({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pd2-sprite-studio', title: 'PD2 Sprite Studio', version: this.version },
          instructions: MCP_INSTRUCTIONS
        })
      }
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: MCP_TOOLS })
      case 'tools/call': {
        const name = String(m.params?.name ?? '')
        const args = (m.params?.arguments ?? {}) as Json
        if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`)
        try {
          return ok(name === 'screenshot_app' ? await this.screenshot() : await this.callRenderer(name, args))
        } catch (e) {
          return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
        }
      }
      default:
        return fail(-32601, `Method not found: ${m.method}`)
    }
  }

  private async screenshot(): Promise<ToolResult> {
    const win = this.getWindow()
    if (!win) throw new Error('The app window is closed')
    const img = await win.webContents.capturePage()
    const size = img.getSize()
    // Keep images a sensible size for the model
    const scaled = size.width > 1600 ? img.resize({ width: 1600 }) : img
    return { content: [{ type: 'image', data: scaled.toPNG().toString('base64'), mimeType: 'image/png' }] }
  }
}
