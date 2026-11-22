#!/usr/bin/env node
// 桥的回归：起一个真服务器（随机端口）→ /health → 问旧事 → 闲聊 → 关掉。
// 用法：node bench/bridge.mjs
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BRIDGE = join(ROOT, 'examples', 'bridge.mjs')
const CLI = join(ROOT, 'bin', 'famr.mjs')
let bad = 0
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`PASS  ${name}`)
  else { bad++; console.log(`FAIL  ${name}${extra ? '  ← ' + extra : ''}`) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = mkdtempSync(join(tmpdir(), 'famr-bridge-'))
let child = null
try {
  mkdirSync(join(dir, 'notes'), { recursive: true })
  writeFileSync(join(dir, 'notes', 'diary.md'), '# 约定\n\n周五晚上不加班，只吃饭和散步；谁提工作谁请火锅。\n\n# 猫\n\n猫叫豆子，四岁，橘的。\n')
  writeFileSync(join(dir, 'famr.config.json'), JSON.stringify({ home: '.famr', notes: 'notes' }))
  const idx = spawnSync(process.execPath, [CLI, 'index', '--home=.famr', '--notes=notes'], { cwd: dir, encoding: 'utf8' })
  ok('建索引', idx.status === 0, `${idx.stdout || ''}${idx.stderr || ''}`.slice(0, 160))

  let port = ''
  child = spawn(process.execPath, [BRIDGE, '--port=0'], { cwd: dir, encoding: 'utf8' })
  child.stdout.on('data', (d) => {
    const m = String(d).match(/127\.0\.0\.1:(\d+)\/prefetch/)
    if (m && !port) port = m[1]
  })
  for (let i = 0; i < 60 && !port; i++) await wait(100)
  ok('桥起来了', !!port, port ? '' : '没打印端口')

  const post = async (say) => {
    const r = await fetch(`http://127.0.0.1:${port}/prefetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ say, session: 'test' }),
    })
    return r.json()
  }

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json())
  ok('/health 通', health.ok === true)

  const old = await post('我们周五约好什么来着')
  // 没起嵌入服务时只走字面，命不中很正常；这里只验「过了旧事闸门、桥的接线对」
  ok('问旧事 → 过闸门', old.tier !== undefined && old.reason !== 'no-old-signal', JSON.stringify(old).slice(0, 160))

  const chat = await post('今天好累')
  ok('闲聊 → 不塞', chat.tier === 'none' && !chat.block, JSON.stringify(chat).slice(0, 120))

  const bad404 = await fetch(`http://127.0.0.1:${port}/nope`).then((r) => r.status)
  ok('别的路由 404', bad404 === 404, String(bad404))
} finally {
  if (child) child.kill()
  await wait(300)
  rmSync(dir, { recursive: true, force: true })
}
console.log(`\n${bad ? `${bad} 项没过` : '全过'}`)
process.exit(bad ? 1 : 0)
