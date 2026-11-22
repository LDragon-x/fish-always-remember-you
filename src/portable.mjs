// 搬家：整本日记打包成一个文件夹——能拷、能校验、能还原。
//
// 导出的不是「数据库」，是两样东西：
//   1. 正文（notes/，你自己的 md/txt，永远是你自己的文件）；
//   2. 索引与状态（.famr/，可以扔了重建）。
// 外加一份 manifest.json：每个文件的 sha256。搬过去先校验，少一个字节都不算搬完。
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MANIFEST = 'manifest.json'
export const SCHEMA_VERSION = 1

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

function walkFiles(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walkFiles(p))
    else out.push(p)
  }
  return out
}

function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 配置里能带走的部分：绝对路径改相对（相对当前工作区），换机后仍然指得着。 */
function portableConfig(cfg, cwd) {
  const rel = (p) => {
    if (!p) return ''
    const abs = resolve(cwd, String(p))
    const r = relative(cwd, abs)
    return r.startsWith('..') || isAbsolute(r) ? String(p) : r.split('\\').join('/')
  }
  const keep = {}
  for (const key of ['notes', 'home', 'identity', 'important', 'digestDir', 'statusFile', 'canon', 'exclude', 'k', 'fullMin', 'hintMin', 'chunkChars', 'embedUrl']) {
    if (cfg[key] !== undefined) keep[key] = cfg[key]
  }
  keep.notes = rel(cfg.notes)
  keep.home = rel(cfg.home)
  if (keep.important) keep.important = rel(cfg.important)
  if (keep.digestDir) keep.digestDir = rel(cfg.digestDir)
  if (keep.statusFile) keep.statusFile = rel(cfg.statusFile)
  keep.notes = keep.notes || 'notes'
  keep.home = keep.home || '.famr'
  return keep
}

/**
 * 导出：把正文 + 索引状态 + 配置 + 校验清单打包进一个文件夹。
 * @returns {{dir:string, files:number, bytes:number}}
 */
export function exportDiary(cfg, outDir = '') {
  const cwd = process.cwd()
  const dir = resolve(cwd, outDir || `famr-export-${stamp()}`)
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`目标不是空目录：${dir}`)
  mkdirSync(dir, { recursive: true })

  const notesDest = join(dir, 'notes')
  const homeDest = join(dir, '.famr')
  const notesSrc = cfg.notes
  const homeSrc = cfg.home

  let files = 0
  let bytes = 0
  const entries = []
  const copyInto = (src, dest) => {
    for (const f of walkFiles(src)) {
      const r = relative(src, f)
      const target = join(dest, r)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(f, target)
      const st = statSync(f)
      files++
      bytes += st.size
      entries.push({ path: relative(dir, target).split('\\').join('/'), sha256: sha256(target), bytes: st.size })
    }
  }
  copyInto(notesSrc, notesDest)
  // 索引状态里只带走能还原的：库 + 预热状态（last-inject 是一次性的，不带）
  mkdirSync(homeDest, { recursive: true })
  for (const name of ['memory.db', 'prefetch-state.json']) {
    const f = join(homeSrc, name)
    if (!existsSync(f)) continue
    copyFileSync(f, join(homeDest, name))
    const st = statSync(f)
    files++
    bytes += st.size
    entries.push({ path: `.famr/${name}`, sha256: sha256(join(homeDest, name)), bytes: st.size })
  }

  const conf = portableConfig(cfg, cwd)
  writeFileSync(join(dir, 'famr.config.json'), JSON.stringify(conf, null, 2) + '\n', 'utf8')
  entries.push({ path: 'famr.config.json', sha256: sha256(join(dir, 'famr.config.json')), bytes: statSync(join(dir, 'famr.config.json')).size })

  const manifest = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), from: cwd, files: entries }
  writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { dir, files: entries.length, bytes }
}

/**
 * 导入：校验清单→逐文件核对 sha256→写进目标目录。
 * @returns {{dir:string, files:number, missing:string[], mismatch:string[]}}
 */
export function importDiary(archive, intoDir = '', { force = false } = {}) {
  const src = resolve(archive)
  const dest = resolve(intoDir || process.cwd())
  const mf = join(src, MANIFEST)
  if (!existsSync(mf)) throw new Error(`不是导出目录（找不到 ${MANIFEST}）：${src}`)
  const manifest = JSON.parse(readFileSync(mf, 'utf8'))
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`清单版本 ${manifest.schemaVersion} 与当前程序 ${SCHEMA_VERSION} 不匹配`)

  const missing = []
  const mismatch = []
  for (const e of manifest.files) {
    const f = join(src, e.path)
    if (!existsSync(f)) { missing.push(e.path); continue }
    if (sha256(f) !== e.sha256) mismatch.push(e.path)
  }
  if (missing.length || mismatch.length) {
    return { dir: dest, files: 0, missing, mismatch }
  }

  if (existsSync(dest) && readdirSync(dest).length && !force) {
    throw new Error(`目标目录不是空的：${dest}（确认要覆盖就加 --force）`)
  }
  mkdirSync(dest, { recursive: true })
  for (const e of manifest.files) {
    const target = join(dest, e.path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(src, e.path), target)
  }
  return { dir: dest, files: manifest.files.length, missing: [], mismatch: [] }
}
