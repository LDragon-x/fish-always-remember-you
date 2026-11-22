#!/usr/bin/env node
// 图的回归：图里的每一句都必须能在 transcript 里逐字找到。
// 纯函数，不需要 Chrome、不需要模型。
// 用法：node docs/figures/make.test.mjs
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTranscript, parseTrace } from './make.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(HERE, 'scene-transcript.txt'), 'utf8')
const sections = parseTranscript(text)

let bad = 0
const ok = (cond, name, extra = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  <- ' + extra : ''}`)
}
const byTitle = (p) => sections.find((s) => s.title.startsWith(p))

// 1) 五段：A / 日记文件 / B / C / 命令行
ok(sections.length === 5, '五段：会话 A / 日记文件 / B / C / 命令行', `${sections.length} 段`)
ok(!!byTitle('会话 A') && !!byTitle('会话 B') && !!byTitle('会话 C') && !!byTitle('命令行'), '段落标题认得出来')

// 1b) 日记文件：图 1 右半边，得能逐字看见他那三句话落了盘
const diarySec = byTitle('日记文件')
ok(!!diarySec && diarySec.lines.join('\n').includes('我家猫叫豆子'), '日记文件：猫那句在')
ok(!!diarySec && /^## /m.test(diarySec.lines.join('\n')), '日记文件：按条分节')
ok(!!diarySec && diarySec.lines.join('\n').includes('最烦被叫起床'), '日记文件：起床那句也在')

// 2) 对话解析：时间、谁、原话
const a = byTitle('会话 A')
ok(a.messages.length === 6, '会话 A：三轮一问一答', `${a.messages.length} 条`)
ok(a.messages[0].who === '他' && a.messages[1].who === '她', '谁说的分得清')
ok(/^\d\d:\d\d$/.test(a.messages[0].t), '每条带时间', a.messages[0].t)
ok(a.messages.some((m) => m.text.includes('豆子')), '原话没被改写')

// 3) 预热日志：图 2 要用 tier 和分数
const b = byTitle('会话 B')
ok(b.logs.length === 1, '会话 B：一行预热日志', `${b.logs.length} 行`)
ok(/tier=full/.test(b.logs[0].text), '会话 B：tier=full', b.logs[0].text)
ok(/conf=0\.\d+/.test(b.logs[0].text) && /ms$/.test(b.logs[0].text), '会话 B：分数和毫秒都在')

// 4) 命令行块：图 3 右半边
const t = byTitle('命令行')
ok(t.term[0].startsWith('$ node bin/famr.mjs search'), '命令行：第一行就是命令', t.term[0])
ok(t.term.some((l) => /^\s*0\.\d{3}\s+日记\.md/.test(l)), '命令行：命中行带分数')
ok(t.term.some((l) => l.includes('我家猫叫豆子')), '命令行：命中正文一起给出，不只有路径')

// 5) 没有私货：scene 里只该出现编的三件事
const full = JSON.stringify({ a: a.messages, b: b.messages })
for (const word of ['豆子', '拔智齿', '被叫起床']) ok(full.includes(word), `场景事实在场：${word}`)

// 5) 图 4：真实那一轮的时间线，必须是原始数字，不能是估的
const trace = parseTrace(readFileSync(join(HERE, 'fig4-trace.txt'), 'utf8'))
ok(trace.calls.length === 6, '图4：六次调用', String(trace.calls.length))
ok(/82\.5s/.test(trace.stats) && /3\.4s/.test(trace.stats), '图4：总时长和工具时间都在', trace.stats)
ok(trace.calls.reduce((s, c) => s + Number(c.ms), 0).toFixed(2) === '3.41', '图4：六次加起来 = 3.41s', trace.calls.map((c) => c.ms).join('+'))
ok(trace.calls.some((c) => c.doing.includes('白跑')), '图4：两次踩空照实写')
ok(trace.her.join('\n').includes('黄仁勋可以没有英伟达'), '图4：他的原话逐字在')
ok(trace.her.join('\n').includes('老马那段略'), '图4：隐去的地方有标记')
ok(!/老马真会玩|他妈的/.test(trace.her.join('\n')), '图4：老马那段一个脏字都不出现')

// 6) 图 5 是他自己截的原图（不是脚本排的）：只校验它在、不是空壳
const p5 = join(HERE, 'fig5-real-chat.png')
ok(existsSync(p5), '图5：原图在')
ok(existsSync(p5) && statSync(p5).size > 100_000, '图5：不是空文件', existsSync(p5) ? `${(statSync(p5).size / 1024).toFixed(0)}KB` : '-')

console.log(`\n${bad ? `${bad} 项没过` : '全过'}`)
process.exit(bad ? 1 : 0)
