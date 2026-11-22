#!/usr/bin/env node
// 闸门回归：哪些话该翻旧事、哪些不该。纯函数，不需要模型、不需要索引。
// 用法：node bench/gate.mjs
import { wantsOldStuff } from '../src/prefetch.mjs'

const SHOULD = [
  '你上次说的那个坑是什么',
  '还记得我说的约定吗',
  '以前我们在哪聊过这个',
  '那天的原话是怎么说的',
  '我们约好的事你还记得不',
  '第几版了',
  '我们周五约好什么来着',
  '说好的那件事呢',
]
const SHOULD_NOT = [
  '今天好累',
  '晚安',
  '嗯嗯',
  '在吗',
  '哈哈',
  '吃了吗',
  '写一张卡吧',
  '这段代码怎么改',
]

let bad = 0
for (const s of SHOULD) {
  const ok = wantsOldStuff(s)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  该翻  <- ${s}`)
}
for (const s of SHOULD_NOT) {
  const ok = !wantsOldStuff(s)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  不该翻 <- ${s}`)
}
console.log(`\n${SHOULD.length + SHOULD_NOT.length - bad}/${SHOULD.length + SHOULD_NOT.length} 过`)
process.exit(bad ? 1 : 0)
