#!/usr/bin/env node
// 评测：拿一组问句和期望关键词，量「找得回、延迟多少」。
// 这是关键词判分，不等于「真的答对」——但它便宜、可复跑，适合当回归线。
//
// 用法：node bench/eval.mjs [--notes=notes] [--set=bench/eval-set.json] [--home=.famr]
import { readFileSync } from 'node:fs'
import { loadConfig } from '../src/config.mjs'
import { search } from '../src/search.mjs'

const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)
const cfg = loadConfig(process.cwd(), flags)
const set = JSON.parse(readFileSync(flags.set || 'bench/eval-set.json', 'utf8'))
const items = set.items || []

let hit = 0
let hit3 = 0
const lat = []
for (const it of items) {
  const t0 = Date.now()
  const { mode, rows } = await search(cfg, it.q, { k: 5 })
  lat.push(Date.now() - t0)
  const top = String(rows[0]?.text || '')
  const top3 = rows.slice(0, 3).map((r) => r.text).join('\n')
  const ok = top.includes(it.expect)
  const ok3 = top3.includes(it.expect)
  if (ok) hit++
  if (ok3) hit3++
  console.log(`${ok ? 'PASS' : 'MISS'}  ${it.q}  （${mode}）${ok ? '' : ` ← 期望「${it.expect}」`}`)
}
lat.sort((a, b) => a - b)
const p = (x) => lat[Math.min(lat.length - 1, Math.floor(lat.length * x))]
console.log(`\ntop1 命中 ${hit}/${items.length}；top3 命中 ${hit3}/${items.length}`)
console.log(`检索延迟 p50 ${p(0.5)}ms / p95 ${p(0.95)}ms（含嵌入一次前向）`)
process.exit(hit === items.length ? 0 : 1)
