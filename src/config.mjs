// 配置：一个项目只需要记住「记忆放哪、正文从哪读、嵌入服务在哪」。
// 别的都能从命令行或 famr.config.json 覆盖；没有配置文件也能跑。
//
// 海底没有回声，所以每一句都得记住。
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export const DEFAULTS = {
  home: '.famr', // 索引与状态放这（sqlite、去重状态、日志）
  notes: 'notes', // 要索引的正文目录（md/txt，递归）
  embedUrl: 'http://127.0.0.1:8791', // 本地嵌入服务；没起就退回字面检索
  chunkChars: 380, // 小段长度
  maxBytes: 400_000, // 单文件上限
  k: 3, // 每轮按需给几条
  fullMin: 0.52, // 三档：有把握
  hintMin: 0.48, // 三档：有点把握
  canon: [], // 正典文件名（命中时加权 1.25），例如 ["CORE.md"]
  identity: '', // 常驻层的身份一句；留空就跳过
  important: '', // 「重要的事」文件（- 开头的条目取前 6 条）
  digestDir: '', // 每日预热想带上「昨天的记录」时，指向按日期命名的 md 目录
  log: true,
}

export function loadConfig(cwd = process.cwd(), overrides = {}) {
  const file = join(cwd, 'famr.config.json')
  let fromFile = {}
  if (existsSync(file)) {
    try { fromFile = JSON.parse(readFileSync(file, 'utf8')) } catch {}
  }
  const cfg = { ...DEFAULTS, ...fromFile, ...overrides }
  cfg.home = isAbsolute(String(cfg.home)) ? cfg.home : resolve(cwd, String(cfg.home))
  cfg.notes = isAbsolute(String(cfg.notes)) ? cfg.notes : resolve(cwd, String(cfg.notes))
  cfg.identity = String(cfg.identity || '')
  cfg.important = cfg.important ? (isAbsolute(String(cfg.important)) ? String(cfg.important) : resolve(cwd, String(cfg.important))) : ''
  cfg.digestDir = cfg.digestDir ? (isAbsolute(String(cfg.digestDir)) ? String(cfg.digestDir) : resolve(cwd, String(cfg.digestDir))) : ''
  cfg.canon = Array.isArray(cfg.canon) ? cfg.canon.map(String) : []
  for (const key of ['chunkChars', 'maxBytes', 'k', 'fullMin', 'hintMin']) cfg[key] = Number(cfg[key]) || DEFAULTS[key]
  return cfg
}

/** 状态/索引文件的绝对路径 */
export const paths = (cfg) => ({
  db: join(cfg.home, 'memory.db'),
  inject: join(cfg.home, 'last-inject.json'),
  prefetchState: join(cfg.home, 'prefetch-state.json'),
  prefetchLog: join(cfg.home, 'prefetch.log.jsonl'),
})
