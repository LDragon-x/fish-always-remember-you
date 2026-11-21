// 三层注入：这一轮该让模型看见什么。
//
//   [常驻] 身份一句 + 最重的几条（固定前缀，吃 prompt 缓存）
//   [按需] 按这句话检索到的几条原文，压成一两句
//   [展开] 只告诉它「要原话跑哪条命令」，不预先塞满
//
// 同一个会话里重复的东西不塞第二遍——重复塞就是白花钱。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { paths } from './config.mjs'
import { bigrams, search } from './search.mjs'

const readState = (cfg) => {
  const f = paths(cfg).inject
  if (!existsSync(f)) return { sessions: {} }
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return { sessions: {} } }
}

/** 挑跟问句最像的 2–3 句，而不是从头截（截断会把关键细节切掉）。 */
function squeeze(text, qb, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').replace(/^[-*>\s]+/, '').trim()
  const sents = clean.split(/(?<=[。！？；])/).map((s) => s.trim()).filter((s) => s.length >= 6)
  const score = (s) => { let hit = 0; for (const g of qb) if (s.includes(g)) hit++; return hit / (qb.size || 1) }
  const picked = (sents.length ? sents : [clean]).sort((a, b) => score(b) - score(a)).slice(0, 3)
  return picked.join('').slice(0, max)
}

/** 「重要的事」里最重的几条：- 开头、带 ** 的行优先。 */
function importantLines(cfg, n = 6) {
  if (!cfg.important || !existsSync(cfg.important)) return []
  const lines = readFileSync(cfg.important, 'utf8').split(/\r?\n/)
  const bold = lines.filter((l) => /^- \*\*/.test(l))
  const plain = lines.filter((l) => /^- (?!\*)/.test(l))
  return [...bold, ...plain].slice(0, n).map((l) => l.replace(/^-\s*/, '').replace(/\*\*/g, '').slice(0, 90))
}

/**
 * @returns {{text:string, fresh:Array, chars:number, tokens:number}}
 *   fresh 为空表示这一轮没有新东西，调用方可以不注入。
 */
export async function renderBrief(cfg, q, { k = cfg.k, session = 'default' } = {}) {
  const dbRows = await search(cfg, q, { k: k + 3 })
  const qb = bigrams(q)
  const state = readState(cfg)
  const sess = (state.sessions[session] ||= { recent: [] })
  const keyOf = (r) => `${r.path}#${r.heading}`
  const seen = new Set(sess.recent)
  const fresh = dbRows.rows.filter((r) => !seen.has(keyOf(r))).slice(0, k)

  const lines = []
  if (cfg.identity) lines.push(`[常驻] ${cfg.identity}`)
  for (const l of importantLines(cfg)) lines.push(`- ${l}`)

  if (fresh.length) {
    lines.push('[按需]')
    for (const r of fresh) lines.push(`- [${r.path}|${r.heading}] ${squeeze(r.text, qb)}`)
    lines.push(`[展开] 要原话：node bin/famr.mjs search "${String(q).slice(0, 40).replace(/"/g, '')}"`)
  } else {
    return { text: '', fresh: [], chars: 0, tokens: 0 }
  }

  for (const r of dbRows.rows) {
    const kk = keyOf(r)
    if (!seen.has(kk)) { seen.add(kk); sess.recent.push(kk) }
  }
  sess.recent = sess.recent.slice(-40)
  try { writeFileSync(paths(cfg).inject, JSON.stringify(state)) } catch {}

  const text = lines.join('\n')
  return { text, fresh, chars: text.length, tokens: Math.round(text.length / 1.6) }
}
