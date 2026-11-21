#!/usr/bin/env node
// demo：零依赖、零模型、断网可跑。
// 用一份假日记做最朴素的字面检索，看看「记忆层」把旧事挑出来是什么感觉。
// 真项目里的检索还会加本地向量、三层注入、每轮预热——这里只演示思路。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(root, 'bench', 'fixtures', 'demo-diary.md'), 'utf8')

// 按 ## 小节切块（真实现会做话题块合并；这里够用）
const chunks = []
let cur = { heading: '开头', lines: [] }
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^##\s+(.+)$/)
  if (m) {
    if (cur.lines.join('').trim()) chunks.push(cur)
    cur = { heading: m[1].trim(), lines: [] }
  } else {
    cur.lines.push(line)
  }
}
if (cur.lines.join('').trim()) chunks.push(cur)
const docs = chunks
  .map((c) => ({ heading: c.heading, text: c.lines.join('\n').trim() }))
  .filter((d) => d.heading !== '开头' && d.text.length >= 10)

// 中文按 2-gram 切，算朴素的字面重合度
const STOP = /[\s，。！？、；：""''（）()【】《》~～…—\-·0-9]+/g
const grams = (s) => {
  const t = String(s).replace(STOP, '')
  const set = new Set()
  for (let i = 0; i + 2 <= t.length; i++) set.add(t.slice(i, i + 2))
  return set
}
const index = docs.map((d) => ({ ...d, g: grams(d.heading + '\n' + d.text) }))

const queries = ['我们约好周五怎么着来着', '她那只猫叫什么来着', '上次说头疼那事后来呢']

console.log('fish always remember you · demo')
console.log(`假日记 ${docs.length} 个话题块，零模型、零联网\n`)

for (const q of queries) {
  const qg = grams(q)
  const scored = index
    .map((d) => {
      let hit = 0
      for (const g of qg) if (d.g.has(g)) hit++
      return { ...d, score: hit / (qg.size || 1) }
    })
    .filter((d) => d.score >= 0.06)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  console.log(`问：${q}`)
  if (!scored.length) {
    console.log('  （记忆里没有，诚实地空着）\n')
    continue
  }
  for (const d of scored) {
    console.log(`  ${d.score.toFixed(2)}  [${d.heading}]  ${d.text.replace(/\s+/g, ' ').slice(0, 64)}…`)
  }
  console.log('')
}

console.log('（真项目里的检索会加本地向量，还会把结果分三档、每轮开头先备好——见 README。）')
