#!/usr/bin/env node
// 校准：用你自己的语料，看看「该命中的问句」和「闲聊」的检索分各落在哪，
// 再决定三档的线。默认的 0.52 / 0.48 是在一份中文语料上校出来的，不保证对谁都合适。
//
// 用法：
//   node bench/calibrate.mjs --notes=notes --set=bench/eval-set.json
// 输出：命中组与闲聊组的分布，以及一档建议线。
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
const CHAT = ['晚安呀', '在吗', '今天天气不错', '我吃了', '好困', '嗯嗯', '回来啦']

const scoreOf = async (q) => {
  const { rows } = await search(cfg, q, { k: 1 })
  return Number(rows[0]?.score || 0)
}

const hitScores = []
for (const it of set.items || []) hitScores.push({ q: it.q, s: await scoreOf(it.q) })
const chatScores = []
for (const q of CHAT) chatScores.push({ q, s: await scoreOf(q) })

const sorted = hitScores.map((x) => x.s).sort((a, b) => a - b)
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
const chatMax = Math.max(...chatScores.map((x) => x.s))
console.log('命中组：')
for (const x of hitScores) console.log(`  ${x.s.toFixed(3)}  ${x.q}`)
console.log(`命中组分布：p10 ${q(0.1).toFixed(3)} / p25 ${q(0.25).toFixed(3)} / p50 ${q(0.5).toFixed(3)} / max ${q(1).toFixed(3)}`)
console.log('\n闲聊组：')
for (const x of chatScores) console.log(`  ${x.s.toFixed(3)}  ${x.q}`)
console.log(`闲聊最高 ${chatMax.toFixed(3)}`)

console.log('\n分界建议（先别照抄；拿几天真实对话再回来调）：')
for (const t of [0.42, 0.45, 0.48, 0.5, 0.52, 0.55, 0.58, 0.6, 0.65]) {
  const above = sorted.filter((x) => x >= t).length
  const chatAbove = chatScores.filter((x) => x.s >= t).length
  console.log(`  ≥${t.toFixed(2)}：命中的留下 ${above}/${sorted.length}，闲聊误报 ${chatAbove}/${chatScores.length}`)
}
console.log('\n（默认 full 0.52 / hint 0.48 是这么来的：让闲聊基本不触发，同时留下大部分命中。）')
