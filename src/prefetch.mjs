// 预热：这一轮该不该先备好旧事、备多少。
//
//   有把握（≥ fullMin）→ 把命中的块端上来
//   有点把握（≥ hintMin）→ 只丢一句「备好了，按需看」
//   否则 / 闲聊 / 还是刚才那个话题 → 不塞
//
// 每天第一次说话，先摆出「重要的事 + 昨天的记录」——这是定数，零检索、零风险。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './config.mjs'
import { bigrams, search } from './search.mjs'

const CHAT_WORDS = /^(哈哈|嗯+|哦+|好|好的|行|可以的|在吗|在不在|睡了|睡了吗|晚安|早安|午安|早|饿|饿了|困|好困|累|好累|想你了|我回来了|我回来啦|回来啦|我在|我在呢|我吃了|今天天气|天气不错)/
const SIGNAL = /(以前|上次|之前|那次|那天|当年|记得|说过|约定|愿望|答应|生日|哪年|几号|在哪|多大|几岁|今年|去年|明年|谁|怎么|为什么|啥|多少|哪个|哪|能不能|可不可以|帮我|查一下|找一下|原话|那时候|问题|毛病|坑)/

// 2026-11 拿 85 轮真实发言回放校准出来的闸：话里没有「旧事信号」，就别端整段旧事。
// 之前只要分数够就端，结果近一半端出来的段落人家根本用不上——端得太勤，比不端还糟。
const OLD_SIGNAL = /(以前|上次|上回|之前|那次|那天|当年|早先|记得|记不记得|还记得|说过|提过|约定|约好|约过|约了|说好|来着|答应|答应过|原话|第几版|第几次|多大|几岁|哪年|几号|生日|那时候)/
const STATUS_Q = /(还差什么|还有什么没做|还欠什么|下一步|接下来做什么|进度到哪|做到哪了)/

/** 这句话像不像在问旧事；不像就别去翻。 */
export function wantsOldStuff(q) {
  return OLD_SIGNAL.test(String(q || ''))
}

/** 「还差什么」这类问题：直接读状态文件的「还没做」段，零检索、零赌。 */
function statusText(cfg) {
  if (!cfg.statusFile || !existsSync(cfg.statusFile)) return ''
  try {
    const text = readFileSync(cfg.statusFile, 'utf8')
    const m = text.match(/##\s*(?:还没做|待办|下一步)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/)
    return m ? m[1].trim().slice(0, 600) : ''
  } catch { return '' }
}

/** 问候、情绪、日常动作：不该为这些去翻旧事。 */
export function isSmallTalk(q) {
  const t = String(q || '').replace(/[\s，。！？~～…]+/g, '')
  if (t.length <= 3) return true
  if (CHAT_WORDS.test(t)) return true
  if (!SIGNAL.test(t) && t.length <= 5) return true
  return false
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function readState(cfg) {
  const f = paths(cfg).prefetchState
  if (!existsSync(f)) return { sessions: {}, daily: {} }
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return { sessions: {}, daily: {} } }
}

/** 每日预热的内容：重要的事前 6 条 + 昨天的记录（若配了 digestDir）。 */
function dailyText(cfg, state) {
  const today = localDate()
  if (state.daily?.lastDate === today) return null
  const parts = []
  try {
    if (cfg.important && existsSync(cfg.important)) {
      const lines = readFileSync(cfg.important, 'utf8').split(/\r?\n/)
        .filter((l) => /^- /.test(l)).slice(0, 6)
        .map((l) => l.replace(/^-\s*/, '').replace(/\*\*/g, '').slice(0, 90))
      if (lines.length) parts.push('【重要的事】\n' + lines.map((l) => '- ' + l).join('\n'))
    }
  } catch {}
  try {
    if (cfg.digestDir && existsSync(cfg.digestDir)) {
      const y = new Date(Date.now() - 86_400_000)
      const file = join(cfg.digestDir, `${localDate(y)}.md`)
      if (existsSync(file)) {
        const t = readFileSync(file, 'utf8').replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 420)
        if (t) parts.push('【昨天的记录】\n' + t)
      }
    }
  } catch {}
  if (!parts.length) return null
  state.daily ||= {}
  state.daily.lastDate = today
  return parts.join('\n\n')
}

function writeState(cfg, state) {
  try {
    mkdirSync(cfg.home, { recursive: true })
    writeFileSync(paths(cfg).prefetchState, JSON.stringify(state))
  } catch {}
}

function logRow(cfg, row) {
  if (!cfg.log) return
  try {
    mkdirSync(cfg.home, { recursive: true })
    appendFileSync(paths(cfg).prefetchLog, JSON.stringify(row) + '\n')
  } catch {}
}

/**
 * @returns {{tier:'full'|'hint'|'none'|'status', reason:string, confidence:number,
 *            daily:{text:string}|null, block:string, candidates:Array, ms:number}}
 */
export async function prefetch(cfg, { say, session = 'default' } = {}) {
  const t0 = Date.now()
  const state = readState(cfg)
  state.sessions ||= {}
  const sess = (state.sessions[session] ||= { lastPaths: [] })
  const out = { tier: 'none', reason: '', confidence: 0, daily: null, block: '', candidates: [], ms: 0 }

  const daily = dailyText(cfg, state)
  if (daily) out.daily = { text: daily }

  // 问「还差什么 / 下一步」：直接搬状态文件那一段，不检索、不赌命中。
  if (STATUS_Q.test(String(say || ''))) {
    const st = statusText(cfg)
    if (st) {
      out.tier = 'status'
      out.reason = 'status-file'
      out.confidence = 1
      out.block = '【还没做，从状态文件搬的】\n' + st
      return finish(cfg, state, sess, out, t0, say, session)
    }
  }

  // 没在问旧事，就别端整段——一句也不多塞。
  if (!wantsOldStuff(say)) {
    out.reason = isSmallTalk(say) ? 'smalltalk' : 'no-old-signal'
    return finish(cfg, state, sess, out, t0, say, session)
  }

  if (isSmallTalk(say) && !daily) {
    out.reason = 'smalltalk'
    return finish(cfg, state, sess, out, t0, say, session)
  }

  const excluded = new Set((cfg.exclude || []).map(String))
  const { rows: allRows } = await search(cfg, say, { k: 5 })
  const rows = allRows.filter((r) => !excluded.has(String(r.path).split(/[\\/]/).pop()))
  out.confidence = +(rows[0]?.score ?? 0).toFixed(3)
  out.candidates = rows.map((r) => ({ path: r.path, heading: r.heading, score: +r.score.toFixed(3), text: r.text }))

  const paths_ = rows.map((r) => r.path + '#' + r.heading)
  const last = Array.isArray(sess.lastPaths) ? sess.lastPaths : []
  const overlap = paths_.length && last.length ? paths_.filter((p) => last.includes(p)).length / Math.max(paths_.length, last.length) : 0
  const sameTopic = overlap >= 0.6

  if (out.confidence >= cfg.fullMin) out.tier = 'full'
  else if (out.confidence >= cfg.hintMin) out.tier = 'hint'
  if (sameTopic) { out.tier = 'none'; out.reason = 'same-topic' }

  if (out.tier === 'full') {
    const top = out.candidates.slice(0, cfg.k)
    const lines = ['【这一轮先备着的旧事】']
    for (const c of top) lines.push(`- [${c.path}#${c.heading}] ${String(c.text).replace(/\s+/g, ' ').slice(0, 150)}`)
    lines.push(`要原话就跑：node bin/famr.mjs search "${String(say).slice(0, 30).replace(/"/g, '')}" --k 5`)
    out.block = lines.join('\n')
  } else if (out.tier === 'hint') {
    const c = out.candidates[0]
    if (c) out.block = `（备好了，按需看：${c.path}#${c.heading}——要细节再翻，不先塞进来）`
  }

  return finish(cfg, state, sess, out, t0, say, session)
}

function finish(cfg, state, sess, out, t0, say, session) {
  if (out.tier !== 'none' && out.candidates.length) {
    sess.lastPaths = out.candidates.slice(0, cfg.k).map((c) => c.path + '#' + c.heading)
    sess.lastAt = Date.now()
  }
  out.ms = Date.now() - t0
  writeState(cfg, state)
  logRow(cfg, {
    ts: Date.now(), session, say: String(say).slice(0, 80), tier: out.tier, reason: out.reason,
    confidence: out.confidence, daily: !!out.daily, block: out.block.slice(0, 120), ms: out.ms,
  })
  return out
}
