// SQLite 存储：一段一段地存正文，整块整块地拼话题。
//
// 为什么是 SQLite：它是一个文件，能拷、能校验、能十年后打开。
// 索引可以随便删了重建，正文永远是你自己的文件。
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { paths } from './config.mjs'

export function openDb(cfg) {
  if (!existsSync(cfg.home)) mkdirSync(cfg.home, { recursive: true })
  const db = new DatabaseSync(paths(cfg).db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      heading TEXT,
      text TEXT NOT NULL,
      mtime INTEGER,
      vec BLOB
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      heading TEXT,
      ids TEXT,
      text TEXT,
      vec BLOB
    );
    CREATE TABLE IF NOT EXISTS vec_cache (hash TEXT PRIMARY KEY, vec BLOB);
  `)
  return db
}

export function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.(md|txt)$/i.test(e.name) && statSync(p).size <= 2_000_000) out.push(p)
  }
  return out
}

/** 按标题切小段；一段太长再按长度切。 */
export function chunkFile(path, chunkChars = 380) {
  const text = readFileSync(path, 'utf8')
  const out = []
  let heading = '(开头)'
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t.length >= 20) out.push({ heading, text: t })
    buf = ''
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(#{1,3})\s+(.+)$/)
    if (m) { flush(); heading = m[2].trim(); continue }
    buf += line + '\n'
    if (buf.length >= chunkChars) flush()
  }
  flush()
  return out
}

/** 入库：先清空重建（索引是可再生的）。 */
export function ingest(cfg) {
  const db = openDb(cfg)
  db.exec('DELETE FROM chunks; DELETE FROM blocks;')
  const ins = db.prepare('INSERT INTO chunks (path, heading, text, mtime, vec) VALUES (?, ?, ?, ?, NULL)')
  let files = 0
  let chunks = 0
  for (const f of walk(cfg.notes)) {
    const rel = relative(cfg.notes, f)
    const mt = Math.floor(statSync(f).mtimeMs / 1000)
    for (const c of chunkFile(f, cfg.chunkChars)) { ins.run(rel, c.heading, c.text, mt); chunks++ }
    files++
  }
  return { db, files, chunks }
}

/** 相邻小段、向量相近就拼成话题块（块级检索用）。
 *  没有向量时（字面模式）不拼，直接一条一段。 */
export function buildBlocks(db) {
  const rows = db.prepare('SELECT id, path, heading, text, vec FROM chunks WHERE vec IS NOT NULL ORDER BY id').all()
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
  const fromBlob = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const groups = []
  let cur = null
  for (const r of rows) {
    const v = fromBlob(r.vec)
    if (cur && cur.path === r.path && cur.rows.length < 6 && dot(cur.last, v) >= 0.72) {
      cur.rows.push(r); cur.last = v
    } else {
      cur = { path: r.path, rows: [r], last: v }
      groups.push(cur)
    }
  }
  const ins = db.prepare('INSERT INTO blocks (path, heading, ids, text, vec) VALUES (?, ?, ?, ?, ?)')
  for (const g of groups) {
    const dim = g.last.length
    const mean = new Float32Array(dim)
    for (const r of g.rows) { const v = fromBlob(r.vec); for (let i = 0; i < dim; i++) mean[i] += v[i] }
    let norm = 0
    for (let i = 0; i < dim; i++) { mean[i] /= g.rows.length; norm += mean[i] * mean[i] }
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < dim; i++) mean[i] /= norm
    const text = g.rows.map((r) => `${r.heading || ''}\n${r.text}`).join('\n').slice(0, 900)
    ins.run(g.path, `${g.rows[0].heading} … ${g.rows[g.rows.length - 1].heading}`, g.rows.map((r) => r.id).join(','), text, Buffer.from(mean.buffer))
  }
  // 没有向量的段也留个块，字面检索能用到
  if (!rows.length) {
    const all = db.prepare('SELECT id, path, heading, text FROM chunks').all()
    for (const r of all) ins.run(r.path, r.heading, String(r.id), `${r.heading || ''}\n${r.text}`, null)
  }
  return groups.length
}
