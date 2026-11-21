// 检索：给一句话，找回可能用得上的旧事。
//
// 打分 = 向量 0.7 + 字面 0.15 + 正典加权；向量服务没起就只走字面。
// 分数不是"把握"本身，但三档预热就是拿它当把握用的——阈值见 bench/calibrate.mjs。
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './config.mjs'
import { embedTexts } from './embed.mjs'

const fromBlob = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)

/** 两字切分 + 停用字符，用于字面分与压制句子。 */
export function bigrams(text) {
  const t = String(text || '').replace(/[\s，。！？、；：""''（）()【】《》~～…—\-·0-9a-zA-Z]+/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

const litScore = (qb, text) => {
  if (!qb.size) return 0
  let hit = 0
  for (const g of qb) if (text.includes(g)) hit++
  return hit / qb.size
}

const canonBoost = (cfg, path) => (cfg.canon.some((name) => String(path).toLowerCase().endsWith(String(name).toLowerCase())) ? 1.25 : 1)

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
const norm = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] / s; return o }

/** 补向量：vec_cache 按 (heading+text) 的 sha256 缓存，改过字的才重算。 */
export async function fillVectors(cfg, db) {
  const rows = db.prepare('SELECT id, heading, text FROM chunks WHERE vec IS NULL').all()
  if (!rows.length) return { filled: 0, cached: 0 }
  const upd = db.prepare('UPDATE chunks SET vec = ? WHERE id = ?')
  const getCache = db.prepare('SELECT vec FROM vec_cache WHERE hash = ?')
  const putCache = db.prepare('INSERT OR REPLACE INTO vec_cache (hash, vec) VALUES (?, ?)')
  const hashOf = (r) => createHash('sha256').update(`${r.heading || ''}\n${r.text}`).digest('hex')

  let cached = 0
  const pending = []
  for (const r of rows) {
    const h = hashOf(r)
    const hit = getCache.get(h)
    if (hit) { upd.run(hit.vec, r.id); cached++ } else pending.push({ r, h })
  }
  for (let i = 0; i < pending.length; i += 32) {
    const batch = pending.slice(i, i + 32)
    const vecs = await embedTexts(batch.map(({ r }) => `${r.heading || ''}\n${r.text}`), cfg.embedUrl)
    vecs.forEach((v, k) => {
      const blob = Buffer.from(new Float32Array(v).buffer)
      upd.run(blob, batch[k].r.id)
      putCache.run(batch[k].h, blob)
    })
  }
  return { filled: pending.length, cached }
}

/**
 * 检索。
 * @returns {{mode:'vector'|'literal', rows: Array<{path:string,heading:string,text:string,score:number}>}}
 */
export async function search(cfg, q, { k = cfg.k, level = 'chunks' } = {}) {
  const db = new DatabaseSync(paths(cfg).db, { readOnly: true })
  try {
    const qb = bigrams(q)
    let qv = null
    try { qv = (await embedTexts([q], cfg.embedUrl))[0] } catch { qv = null }

    if (level === 'blocks') {
      const rows = db.prepare('SELECT path, heading, text, vec FROM blocks').all()
      const scored = rows.map((r) => {
        const vec = r.vec ? fromBlob(r.vec) : null
        const cos = qv && vec ? dot(qv, vec) : 0
        const lit = litScore(qb, `${r.heading || ''} ${r.text || ''}`)
        const raw = qv && vec ? 0.7 * cos + 0.15 * lit : lit * 0.5
        return { path: r.path, heading: r.heading, text: r.text || '', score: raw * canonBoost(cfg, r.path), mode: qv && vec ? 'vector' : 'literal' }
      }).filter((r) => r.score > 0.2).sort((a, b) => b.score - a.score).slice(0, k)
      return { mode: qv ? 'vector' : 'literal', rows: scored }
    }

    const rows = db.prepare('SELECT path, heading, text, vec FROM chunks').all()
    const scored = rows.map((r) => {
      const vec = r.vec ? fromBlob(r.vec) : null
      const cos = qv && vec ? dot(qv, vec) : 0
      const lit = litScore(qb, `${r.heading || ''} ${r.text || ''}`)
      const raw = qv && vec ? 0.7 * cos + 0.15 * lit : lit * 0.5
      return { path: r.path, heading: r.heading, text: r.text || '', score: raw * canonBoost(cfg, r.path), mode: qv && vec ? 'vector' : 'literal' }
    }).filter((r) => r.score > 0.16).sort((a, b) => b.score - a.score).slice(0, k)
    return { mode: qv ? 'vector' : 'literal', rows: scored }
  } finally {
    db.close()
  }
}
