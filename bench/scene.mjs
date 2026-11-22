#!/usr/bin/env node
// scene：把三张图要的那件事真跑一遍——同一个壳子、同一本日记、两段对话。
//
//   会话 A 他随口说三件小事 → 壳子把原话写进日记（notes/日记.md）
//   建索引
//   会话 B 开新会话问一句旧事 → 开口前先预热，旧事进系统提示 → 他答得出来
//   会话 C 同样的问题，不接记忆 → 答不上来（对照）
//
// 用法（要一个 OpenAI 兼容的模型和本地嵌入服务，两个都不进仓库）：
//   set FAMR_CHAT_URL=https://api.deepseek.com
//   set FAMR_CHAT_KEY=sk-...
//   set FAMR_CHAT_MODEL=deepseek-chat
//   python embed/server.py            （另开一个窗口，默认 127.0.0.1:8791）
//   node bench/scene.mjs              （--embed= 换嵌入地址，--dir= 换工作目录）
//
// 输出：docs/figures/scene-transcript.txt（逐字），图就是从它生成的，不手工改字。
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.mjs'
import { ingest } from '../src/store.mjs'
import { fillVectors } from '../src/search.mjs'
import { embedAlive } from '../src/embed.mjs'
import { prefetch } from '../src/prefetch.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FLAGS = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=')
    return [k, v.length ? v.join('=') : true]
  }),
)

const DEFAULT_CHAT = {
  url: process.env.FAMR_CHAT_URL || 'https://api.openai.com/v1',
  key: process.env.FAMR_CHAT_KEY || '',
  model: process.env.FAMR_CHAT_MODEL || 'gpt-4o-mini',
}

/** 图里用到的一致行格式：`22:05  他 > 原话` */
export function lineOf(t, who, text) {
  return `${t}  ${who} > ${text}`
}

const clock = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const clockSec = (d = new Date()) => `${clock(d)}:${String(d.getSeconds()).padStart(2, '0')}`
const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const SEED_DIARY = `# 日记

## 2026-11-18 20:40

今天煮面放多了盐，倒掉半锅，说下次少一勺。

## 2026-11-20 22:15

这周都在赶东西，说周五终于能歇一天，谁都别安排事。

## 2026-11-21 23:30

翻出一部老片子，看到一半睡着了，说下周接着看。
`

/** 种一个干净的工作区：一本假日记 + 一份配置。已有的会被清掉。 */
export function buildWorkspace(dir) {
  const notes = join(dir, 'notes')
  mkdirSync(notes, { recursive: true })
  writeFileSync(join(notes, '日记.md'), SEED_DIARY, 'utf8')
  const cfg = {
    home: '.famr',
    notes: 'notes',
    chunkChars: 380,
    k: 3,
    identity: '你是她的陪伴体。说话短，像人，不用列表，不总结。',
    embedUrl: 'http://127.0.0.1:8791',
  }
  writeFileSync(join(dir, 'famr.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  return { dir, notes }
}

/** 壳子的记忆动作：他的原话逐字落盘，一条一节，带时间。 */
export function appendDiary(file, { at, say }) {
  mkdirSync(dirname(file), { recursive: true })
  const block = `## ${at}\n\n${say}\n\n`
  appendFileSync(file, block, 'utf8')
  return block
}

/** 调一次模型：OpenAI 兼容的 /chat/completions。 */
async function callChat(messages, chat = DEFAULT_CHAT) {
  if (!chat.key) throw new Error('没有模型 key：设 FAMR_CHAT_KEY（或把 chat 换成自己的实现）')
  const r = await fetch(`${chat.url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chat.key}` },
    body: JSON.stringify({ model: chat.model, messages, temperature: 0.3, max_tokens: 220 }),
  })
  if (!r.ok) throw new Error(`chat ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  return String(j.choices?.[0]?.message?.content || '').trim()
}

/** 模型这块既可以传一个函数（测试/自己接），也可以传一份配置（CLI 用）。 */
function chatFn(chat) {
  return typeof chat === 'function' ? chat : (messages) => callChat(messages, chat || DEFAULT_CHAT)
}

/**
 * 一轮对话：先预热（或故意不预热），把旧事拼进系统提示，再开口。
 * @returns {{say:string, reply:string, tier:string|null, confidence:number|null, ms:number|null, block:string}}
 */
export async function runTurn({ dir, say, session = 'A', memory = true, remember = false, chat, prefetchFn, embedUrl } = {}) {
  const ov = embedUrl ? { embedUrl } : {}
  const cfg = loadConfig(dir, ov)

  let pre = { tier: null, confidence: null, ms: null, block: '' }
  if (memory) {
    const r = await (prefetchFn || prefetch)(cfg, { say, session })
    pre = { tier: r.tier, confidence: r.confidence ?? null, ms: r.ms ?? null, block: r.block || '' }
  }

  if (remember) appendDiary(join(dir, 'notes', '日记.md'), { at: `${stamp()} ${clockSec()}`, say })

  const system = [cfg.identity, pre.block, '回复一两句，口语，别列清单。不知道就说不知道，别编。'].filter(Boolean).join('\n\n')
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: say },
  ]
  const reply = await chatFn(chat)(messages)
  return { say, reply, ...pre }
}

/** 把一轮写成 transcript 的三行（他说 / 她说 / 预热日志）。 */
export function turnLines(turn, at) {
  const lines = [lineOf(at, '他', turn.say), lineOf(at, '她', turn.reply)]
  if (turn.tier) {
    const conf = turn.confidence === null ? '-' : turn.confidence.toFixed(3)
    lines.push(`${at}  [预热] tier=${turn.tier}  conf=${conf}  ${turn.ms}ms`)
  }
  return lines
}

async function main() {
  if (FLAGS.help) {
    console.log(`用法：node bench/scene.mjs [--dir=工作区] [--embed=嵌入地址]

真跑一遍三张图的场景：会话 A 记三件事 → 建索引 → 会话 B 靠预热答出来 → 会话 C 不接记忆做对照。

要环境变量（都不进仓库）：
  FAMR_CHAT_URL    OpenAI 兼容的接口地址，默认 https://api.openai.com/v1
  FAMR_CHAT_KEY    模型 key
  FAMR_CHAT_MODEL  模型名，默认 gpt-4o-mini

还要本地嵌入服务（没起就只有字面检索，到不了 full 档）：python embed/server.py`)
    return
  }
  const dir = resolve(FLAGS.dir || join(ROOT, '_scene'))
  const embedUrl = String(FLAGS.embed || 'http://127.0.0.1:8791')
  const chat = { ...DEFAULT_CHAT }

  if (!(await embedAlive(embedUrl))) {
    console.error(`嵌入服务没起（${embedUrl}）。没它就只剩字面检索，分数上限 0.5，到不了 full 档。`)
    console.error('先另开一个窗口跑：python embed/server.py')
    process.exit(1)
  }
  if (!chat.key) {
    console.error('没有模型 key：设 FAMR_CHAT_KEY / FAMR_CHAT_URL / FAMR_CHAT_MODEL')
    process.exit(1)
  }

  rmSync(dir, { recursive: true, force: true })
  buildWorkspace(dir)
  const diaryFile = join(dir, 'notes', '日记.md')
  const diaryBefore = readFileSync(diaryFile, 'utf8').length
  const cfg = loadConfig(dir, { embedUrl })
  const out = []
  const at = () => clock()

  out.push(`# scene · ${new Date().toISOString()}`, `# 模型 ${chat.model} · 嵌入 ${embedUrl} · 工作区 ${dir}`, '')

  out.push(`══ 会话 A：他随口说的三件事 ══`)
  const sessionA = [
    '下周三要去拔智齿，有点怕疼。',
    '我家猫叫豆子，四岁了，胖得像一只会喘气的沙发。',
    '最烦被叫起床，周末千万别喊我。',
  ]
  for (const say of sessionA) {
    const turn = await runTurn({ dir, say, session: 'A', memory: true, remember: true, chat, embedUrl })
    out.push(...turnLines(turn, at()), '')
  }

  const { db, files, chunks } = ingest(cfg)
  const { filled } = await fillVectors(cfg, db)
  db.close()
  const indexLine = `[索引] ${files} 个文件 / ${chunks} 段，补向量 ${filled} 条`
  out.push(indexLine, '')
  out.push('══ 日记文件：他说的话已经落盘 ══', readFileSync(diaryFile, 'utf8').slice(diaryBefore).trim(), '')

  out.push(`══ 会话 B：开一个新会话，只问一句 ══`)
  const q = '我家猫叫啥来着'
  const b = await runTurn({ dir, say: q, session: 'B', memory: true, chat, embedUrl })
  out.push(...turnLines(b, at()), '')

  out.push(`══ 会话 C：同一句话，壳子不接记忆 ══`)
  const c = await runTurn({ dir, say: q, session: 'C', memory: false, chat, embedUrl })
  out.push(...turnLines(c, at()), '')

  // 换壳不丢：同一句话不进任何壳子，直接在命令行问那本日记。
  const cliArgs = ['bin/famr.mjs', 'search', q, '--k=3', `--home=${join(dir, '.famr')}`, `--notes=${join(dir, 'notes')}`, `--embed=${embedUrl}`]
  const cli = execFileSync(process.execPath, cliArgs, { cwd: ROOT, encoding: 'utf8' })
  out.push('══ 命令行：不经过任何壳子，直接问那本日记 ══', `$ node bin/famr.mjs search "${q}"`, cli.trim(), '')

  const file = join(ROOT, 'docs', 'figures', 'scene-transcript.txt')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, out.join('\n') + '\n', 'utf8')
  console.log(out.join('\n'))
  console.log(`\n逐字 transcript：${file}`)
  console.log(`日记：${join(dir, 'notes', '日记.md')}`)
}

const isMain = (() => {
  try {
    const me = fileURLToPath(import.meta.url).toLowerCase()
    return !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === me
  } catch { return false }
})()

if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
