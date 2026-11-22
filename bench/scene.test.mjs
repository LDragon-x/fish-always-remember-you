#!/usr/bin/env node
// 场景回归：三张图背后的三件事——记得住（写日记）、记得起（新会话靠预热）、换壳也记得（命令行）。
// 纯离线：模型调用和预热都用桩替掉；真跑一遍（要嵌入服务 + 真模型）用 node bench/scene.mjs。
// 用法：node bench/scene.test.mjs
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendDiary, buildWorkspace, runTurn, lineOf } from './scene.mjs'

let bad = 0
const ok = (cond, name, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  <- ' + extra : ''}`)
}

const dir = mkdtempSync(join(tmpdir(), 'famr-scene-'))

// 1) 写日记：他的原话逐字落盘，一条一节，带时间
buildWorkspace(dir)
appendDiary(join(dir, 'notes', '日记.md'), { at: '2026-11-23 00:12', say: '我家猫叫豆子，四岁了' })
appendDiary(join(dir, 'notes', '日记.md'), { at: '2026-11-23 00:13', say: '最烦被叫起床' })
const diary = readFileSync(join(dir, 'notes', '日记.md'), 'utf8')
ok(diary.includes('## 2026-11-23 00:12'), '日记：按条分节，带时间')
ok(diary.includes('我家猫叫豆子，四岁了'), '日记：他的原话逐字保留')
ok((diary.match(/^## /gm) || []).length >= 3, '日记：新的一条不覆盖旧的')

// 2) 工作区：种一份假日记 + 配置
ok(existsSync(join(dir, 'famr.config.json')), '工作区：写下 famr.config.json')
ok(readFileSync(join(dir, 'notes', '日记.md'), 'utf8').includes('## '), '工作区：notes/日记.md 有种子内容')

// 3) 没记忆那趟：系统提示里不许有旧事块
let seen = null
const fakeChat = async (messages) => { seen = messages; return '（假装回答）' }
const off = await runTurn({
  dir, say: '我家猫叫啥来着', session: 'C', memory: false, chat: fakeChat,
  prefetchFn: async () => ({ tier: 'full', confidence: 0.99, ms: 1, block: '【这一轮先备着的旧事】\n- 豆子' }),
})
ok(off.tier === null, '没记忆：不调用预热，tier 为空')
ok(!seen[0].content.includes('先备着的旧事'), '没记忆：系统提示里没有旧事块')
ok(seen.at(-1).content === '我家猫叫啥来着', '没记忆：他只说了那一句')

// 4) 有记忆那趟：旧事块进系统提示，tier / 分数 / 毫秒一起带回来
const full = await runTurn({
  dir, say: '我家猫叫啥来着', session: 'B', memory: true, chat: fakeChat,
  prefetchFn: async () => ({ tier: 'full', confidence: 0.533, ms: 12, block: '【这一轮先备着的旧事】\n- 我家猫叫豆子，四岁了' }),
})
ok(full.tier === 'full', '有记忆：接住 full 档', String(full.tier))
ok(full.confidence === 0.533, '有记忆：分数原样带回来', String(full.confidence))
ok(seen[0].content.includes('我家猫叫豆子'), '有记忆：旧事进了系统提示')

// 5) --help 要能问，别一上来就报「嵌入服务没起」
const help = spawnSync(process.execPath, [join(import.meta.dirname, 'scene.mjs'), '--help'], { encoding: 'utf8' })
ok(help.status === 0, '--help：退出码 0', String(help.status))
ok(/用法/.test(help.stdout + help.stderr), '--help：给出用法', (help.stdout + help.stderr).split('\n')[0])

// 6) 模型可以传函数，也可以传一份配置；没 key 要当场说清楚，别等跑到一半
let refused = ''
try {
  await runTurn({ dir, say: '在吗', session: 'X', memory: false, chat: { url: 'https://example.invalid', key: '', model: 'x' } })
} catch (e) { refused = String(e.message || e) }
ok(/key/i.test(refused), '模型配置缺 key：当场报错，不假装跑', refused.slice(0, 40))

// 7) 图要用的一致行格式：时间 + 谁 + 原话
ok(lineOf('00:12', '他', '我家猫叫豆子') === '00:12  他 > 我家猫叫豆子', '行格式：时间 + 他 > 原话')
ok(lineOf('00:13', '她', '记得') .startsWith('00:13  她 > '), '行格式：她 > 回复')

console.log(`\n${bad ? `${bad} 项没过` : '全过'}`)
process.exit(bad ? 1 : 0)
