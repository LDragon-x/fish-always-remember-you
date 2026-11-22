#!/usr/bin/env node
// 搬家回归：建一本假日记 → 打包 → 校验 → 还原 → 核对；再故意弄坏一份，确认它会拒绝。
// 用法：node bench/portable.mjs
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CLI = join(ROOT, 'bin', 'famr.mjs')
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
let bad = 0
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`PASS  ${name}`)
  else { bad++; console.log(`FAIL  ${name}${extra ? '  ← ' + extra : ''}`) }
}
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
const out = (r) => `${r.stdout || ''}${r.stderr || ''}`

const a = mkdtempSync(join(tmpdir(), 'famr-port-'))
const b = mkdtempSync(join(tmpdir(), 'famr-port-'))
try {
  // 1) 假日记
  mkdirSync(join(a, 'notes', 'sub'), { recursive: true })
  writeFileSync(join(a, 'notes', 'one.md'), '# 一\n\n她喜欢在周五晚上散步，谁提工作谁请火锅。\n\n# 二\n\n猫叫豆子，四岁，橘的。\n')
  writeFileSync(join(a, 'notes', 'sub', 'two.md'), '# 三\n\n头疼那天她只睡了两小时，后来是先去睡了。\n')
  writeFileSync(join(a, 'famr.config.json'), JSON.stringify({ home: '.famr', notes: 'notes' }, null, 2))

  let r = run(['index', '--home=.famr', '--notes=notes'], a)
  ok('建索引', r.status === 0, out(r).slice(0, 160))

  // 2) 导出
  r = run(['export', '--out=packed', '--home=.famr', '--notes=notes'], a)
  ok('导出', r.status === 0 && existsSync(join(a, 'packed', 'manifest.json')), out(r).slice(0, 160))
  const mf = JSON.parse(readFileSync(join(a, 'packed', 'manifest.json'), 'utf8'))
  ok('清单有逐文件 sha256', mf.schemaVersion === 1 && mf.files.length >= 3, JSON.stringify(mf.files?.length))
  ok('清单里带正文与库', mf.files.some((f) => f.path === 'notes/one.md') && mf.files.some((f) => f.path === '.famr/memory.db'))
  const conf = JSON.parse(readFileSync(join(a, 'packed', 'famr.config.json'), 'utf8'))
  ok('配置路径改成相对', conf.notes === 'notes' && conf.home === '.famr', JSON.stringify(conf))

  // 3) 导入到新目录
  r = run(['import', join(a, 'packed'), '--into=' + b], ROOT)
  ok('导入', r.status === 0, out(r).slice(0, 200))
  ok('正文原样', sha(join(a, 'notes', 'one.md')) === sha(join(b, 'notes', 'one.md')) &&
    sha(join(a, 'notes', 'sub', 'two.md')) === sha(join(b, 'notes', 'sub', 'two.md')))
  ok('库也搬过去了', existsSync(join(b, '.famr', 'memory.db')))
  const db = new DatabaseSync(join(b, '.famr', 'memory.db'))
  const n = db.prepare('SELECT COUNT(*) n FROM chunks').get().n
  db.close()
  ok('还原后库里有段', n > 0, `段数 ${n}`)

  // 4) 弄坏一份，必须拒绝
  writeFileSync(join(a, 'packed', 'notes', 'one.md'), '被人改过一个字\n')
  const c = mkdtempSync(join(tmpdir(), 'famr-port-'))
  r = run(['import', join(a, 'packed'), '--into=' + c], ROOT)
  ok('坏包被拒', r.status === 1, out(r).slice(0, 160))
  ok('坏包一个文件都不写', !existsSync(join(c, 'notes')))
  rmSync(c, { recursive: true, force: true })
} finally {
  rmSync(a, { recursive: true, force: true })
  rmSync(b, { recursive: true, force: true })
}

console.log(`\n${bad ? `${bad} 项没过` : '全过'}`)
process.exit(bad ? 1 : 0)
