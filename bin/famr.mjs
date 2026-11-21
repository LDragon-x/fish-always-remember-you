#!/usr/bin/env node
// famr · 一条命令管一本日记：建索引、查、看三层注入、看预热决定。
//
//   node bin/famr.mjs index                   建索引（正文改动后重跑）
//   node bin/famr.mjs search "上次那个约定"    只查
//   node bin/famr.mjs brief "上次那个约定"     看这一轮该给模型看什么
//   node bin/famr.mjs prefetch --say "..."     看热身的档位（full/hint/none）
//   node bin/famr.mjs status                  看索引状态
//
// 通用参数：--home=、--notes=、--embed=、--k=、--session=、--json
import { existsSync, mkdirSync } from 'node:fs'
import { loadConfig, paths } from '../src/config.mjs'
import { buildBlocks, ingest, openDb } from '../src/store.mjs'
import { fillVectors } from '../src/search.mjs'
import { search } from '../src/search.mjs'
import { renderBrief } from '../src/brief.mjs'
import { prefetch } from '../src/prefetch.mjs'
import { embedAlive } from '../src/embed.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] || 'help'

function parseFlags(args) {
  const out = {}
  for (const a of args) {
    const m = a.match(/^--([a-zA-Z]+)=(.*)$/)
    if (m) { out[m[1]] = m[2]; continue }
    if (a.startsWith('--')) { out[a.slice(2)] = true }
  }
  return out
}
const flags = parseFlags(argv.slice(1))
const ov = {}
for (const key of ['home', 'notes', 'embedUrl', 'identity', 'important', 'digestDir']) if (flags[key] !== undefined) ov[key] = flags[key]
if (flags.embed) ov.embedUrl = flags.embed
if (flags.k) ov.k = Number(flags.k)
const cfg = loadConfig(process.cwd(), ov)
const text = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim()

const say = () => {
  console.log('famr · fish always remember you\n')
  console.log('  index                     建索引（正文改了就重跑）')
  console.log('  search "…" [--k=3]        只查')
  console.log('  brief "…"                 这一轮该给模型看什么（三层）')
  console.log('  prefetch --say="…"        热身的档位（full / hint / none）')
  console.log('  status                    索引状态')
  console.log('\n参数：--home= .famr / --notes= notes / --embed= http://127.0.0.1:8791')
}

async function cmdIndex() {
  if (!existsSync(cfg.notes)) {
    console.error(`正文目录不存在：${cfg.notes}（用 --notes= 指一个）`)
    process.exit(1)
  }
  const { db, files, chunks } = ingest(cfg)
  console.log(`入库 ${files} 个文件 / ${chunks} 段`)
  const alive = await embedAlive(cfg.embedUrl)
  if (alive) {
    const { filled, cached } = await fillVectors(cfg, db)
    const blocks = buildBlocks(db)
    console.log(`向量：补 ${filled} 条、缓存命中 ${cached} 条；话题块 ${blocks} 个`)
  } else {
    console.log('（嵌入服务没起：只建了字面索引。起服务后重跑 index 即可补向量）')
    buildBlocks(db)
  }
  db.close()
  console.log(`索引在 ${paths(cfg).db}`)
}

async function cmdSearch() {
  if (!text) { console.error('给个问句：search "…"'); process.exit(1) }
  const { mode, rows } = await search(cfg, text, { k: Number(flags.k) || cfg.k })
  if (flags.json) { console.log(JSON.stringify(rows)); return }
  console.log(`查「${text}」（${mode === 'vector' ? '向量' : '字面兜底'}）→ ${rows.length} 条\n`)
  for (const r of rows) console.log(`${r.score.toFixed(3)}  ${r.path}  #${r.heading}\n       ${String(r.text).replace(/\s+/g, ' ').slice(0, 110)}…`)
}

async function cmdBrief() {
  if (!text) { console.error('给个问句：brief "…"'); process.exit(1) }
  const r = await renderBrief(cfg, text, { k: Number(flags.k) || cfg.k, session: String(flags.session || 'cli') })
  if (flags.json) { console.log(JSON.stringify(r)); return }
  if (!r.text) { console.log('（没有新东西可塞，这一轮不注入）'); return }
  console.log(r.text)
  console.log(`\n（${r.chars} 字 ≈ ${r.tokens} token）`)
}

async function cmdPrefetch() {
  if (!flags.say) { console.error('用法：prefetch --say="他刚才那句话"'); process.exit(1) }
  const r = await prefetch(cfg, { say: String(flags.say), session: String(flags.session || 'cli') })
  if (flags.json) { console.log(JSON.stringify(r)); return }
  console.log(`tier=${r.tier}  conf=${r.confidence}  reason=${r.reason || '-'}  ${r.ms}ms`)
  if (r.daily) console.log('\n【每日预热】\n' + r.daily.text)
  if (r.block) console.log('\n' + r.block)
  if (r.tier === 'none' && !r.daily) console.log('（这一轮不备）')
}

function cmdStatus() {
  const db = openDb(cfg)
  const chunks = db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n
  const withVec = db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE vec IS NOT NULL').get().n
  const blocks = db.prepare('SELECT COUNT(*) AS n FROM blocks').get().n
  db.close()
  console.log(`主页：${cfg.home}`)
  console.log(`正文：${cfg.notes}`)
  console.log(`段 ${chunks}（有向量 ${withVec}）/ 话题块 ${blocks}`)
  console.log(`三档：full ≥${cfg.fullMin} / hint ≥${cfg.hintMin}`)
  if (!cfg.identity && !cfg.important) console.log('提示：在 famr.config.json 里配 identity / important，常驻层才有内容（示例见 famr.config.example.json）')
}

switch (cmd) {
  case 'index': await cmdIndex(); break
  case 'search': await cmdSearch(); break
  case 'brief': await cmdBrief(); break
  case 'prefetch': await cmdPrefetch(); break
  case 'status': cmdStatus(); break
  case '--help':
  case 'help':
  default: say(); break
}
