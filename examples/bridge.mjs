#!/usr/bin/env node
// 桥：给任何壳子用的最小 HTTP 入口——开口之前问一句「这轮要不要备旧事」。
//
//   node examples/bridge.mjs [--port=8787] [--home=.famr] [--notes=notes]
//
// 壳子每轮生成前 POST 一次：
//   POST http://127.0.0.1:8787/prefetch
//   {"say":"她刚才那句话","session":"某个会话名"}
// 返回：
//   {"tier":"full|hint|none|status","block":"…","daily":{"text":"…"}|null,"confidence":0.61,"ms":12}
//
// 把 block（和 daily）拼到这一轮的系统提示里，然后照常调模型。
// 只监听 127.0.0.1，不往外网开。
import { createServer } from 'node:http'
import { prefetch } from '../src/prefetch.mjs'
import { loadConfig } from '../src/config.mjs'

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)
const port = Number(flags.port) || 8787
const cfg = loadConfig(process.cwd(), flags.home || flags.notes ? { home: flags.home, notes: flags.notes } : {})

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' })
    return res.end()
  }
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, home: cfg.home, notes: cfg.notes })

  if (req.method === 'POST' && req.url === '/prefetch') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
    req.on('end', async () => {
      try {
        const { say = '', session = 'default' } = JSON.parse(body || '{}')
        const r = await prefetch(cfg, { say: String(say), session: String(session) })
        send(200, { tier: r.tier, reason: r.reason, block: r.block, daily: r.daily, confidence: r.confidence, ms: r.ms })
      } catch (e) {
        send(400, { error: String(e && e.message || e) })
      }
    })
    return
  }
  send(404, { error: 'only GET /health and POST /prefetch' })
})

server.listen(port, '127.0.0.1', () => {
  const actual = server.address().port
  console.log(`famr bridge: http://127.0.0.1:${actual}/prefetch`)
  console.log(`正文：${cfg.notes}\n索引：${cfg.home}`)
})
