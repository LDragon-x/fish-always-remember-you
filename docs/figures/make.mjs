#!/usr/bin/env node
// 把 scene-transcript.txt 逐字变成三张图。
//
// 不写字、不改字：图里的每一句都是从 transcript 里原样搬过来的；
// 这里只负责排版，以及用本机 Chrome 截一张 PNG。
//
// 用法：
//   node bench/scene.mjs                 先真跑一遍，写出 transcript
//   node docs/figures/make.mjs           再排版 + 截图（要本机装了 Chrome）
//
// 产物：docs/figures/fig{1,2,3}-*.png（2 倍分辨率，直接能贴）
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const TRANSCRIPT = join(HERE, 'scene-transcript.txt')
const BUILD = join(ROOT, '_figures-tmp')

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p))

/** 逐字解析：段（══ … ══）、对话（HH:MM 他/她 > …）、日志、命令行块。 */
export function parseTranscript(text) {
  const out = []
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^══\s*(.+?)\s*══\s*$/)
    if (sec) { cur = { title: sec[1], lines: [], messages: [], logs: [], term: [] }; out.push(cur); continue }
    if (!cur) continue
    // 命令行块一旦开头（$ 命令），后面的缩进都是它的输出，原样收进来
    if (cur.term.length) { cur.term.push(line); continue }
    const msg = line.match(/^(\d\d:\d\d)\s+(他|她)\s+>\s+(.*)$/)
    if (msg) { cur.messages.push({ t: msg[1], who: msg[2], text: msg[3] }); continue }
    const log = line.match(/^(\d\d:\d\d)\s+\[预热\]\s+(.*)$/)
    if (log) { cur.logs.push({ t: log[1], text: log[2] }); continue }
    if (line.startsWith('$ ')) { cur.term.push(line); continue }
    cur.lines.push(line)
  }
  for (const s of out) while (s.term.length && s.term.at(-1).trim() === '') s.term.pop()
  return out
}

/** 解析 fig4-trace.txt：一行一段，字段用 | 隔开。 */
export function parseTrace(text) {
  const out = { stats: '', him: [], her: [], calls: [] }
  let sec = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const secM = line.match(/^##\s*(.+)$/)
    if (secM) { sec = secM[1].trim(); continue }
    if (line.startsWith('#')) continue
    if (line.startsWith('stats:')) { out.stats = line.slice(6).trim(); continue }
    const parts = line.split('|')
    const body = parts.length > 1 ? parts[1].trim() : parts[0].trim()
    if (sec === '他') out.him.push({ t: parts[0].trim(), text: body })
    else if (sec === '她') out.her.push(body)
    else if (sec === '调用') out.calls.push({ t: parts[0].trim(), ms: parts[1].trim().replace(/s$/, ''), doing: (parts[2] || '').trim() })
  }
  return out
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CSS = `
  :root {
    --bg: #0a0e13; --win: #0f151d; --chat: #101821; --line: #1b2530;
    --ink: #e8eef5; --dim: #94a2b0; --cyan: #3ad0d8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--ink); padding: 30px 34px;
    font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { width: 840px; }
  .cap { color: var(--dim); font-size: 17px; line-height: 1.55; margin: 0 2px 16px; }
  .cap b { color: var(--cyan); font-weight: 600; }
  .win { background: var(--win); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: 0 18px 40px #04070a; }
  .bar { position: relative; display: flex; align-items: center; height: 44px; padding: 0 16px; background: #0c1219; border-bottom: 1px solid var(--line); }
  .lights { display: flex; gap: 7px; }
  .lights i { width: 11px; height: 11px; border-radius: 50%; background: #2a3642; }
  .lights i:nth-child(1) { background: #f2625a; opacity: .75; }
  .lights i:nth-child(2) { background: #f5bd4f; opacity: .6; }
  .lights i:nth-child(3) { background: #43c46a; opacity: .55; }
  .bar .name { position: absolute; left: 0; right: 0; text-align: center; font-size: 15px; color: #cbd6e2; letter-spacing: .02em; }
  .bar .meta { margin-left: auto; font-size: 12.5px; color: #5c6b79; font-family: ui-monospace, Consolas, monospace; }
  .chat { padding: 18px 22px 20px; background: var(--chat); }
  .ln { display: flex; gap: 12px; margin-bottom: 11px; align-items: baseline; }
  .ln:last-child { margin-bottom: 2px; }
  .ln .t { flex: 0 0 auto; font-size: 12.5px; color: #55636f; font-family: ui-monospace, Consolas, monospace; }
  .ln .n { flex: 0 0 auto; width: 18px; font-size: 15px; color: #8fa6b8; }
  .ln.her .n { color: var(--cyan); }
  .ln .x { flex: 1 1 auto; font-size: 17px; line-height: 1.6; color: #dfe9f2; text-wrap: pretty; }
  .ln.her .x { color: #eaf6f8; }
  .ln .ms { flex: 0 0 auto; font-size: 12.5px; color: #7d8b98; font-family: ui-monospace, Consolas, monospace; }
  .trace .ln { gap: 9px; margin-bottom: 9px; }
  .trace .ln .x { font-size: 14.5px; line-height: 1.5; }
  .total { margin-top: 10px; padding: 9px 12px; border-left: 2px solid var(--cyan); background: #0a1a1c; color: #7fe6ea;
    font-family: ui-monospace, Consolas, monospace; font-size: 13px; border-radius: 0 8px 8px 0; }
  .kpi { margin-top: 12px; padding: 12px 14px; background: #0a1a1c; border-radius: 10px; border: 1px solid #16343a; }
  .kpi-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .kpi-row .n { font-size: 21px; font-weight: 700; font-family: ui-monospace, Consolas, monospace; }
  .kpi-row .n.tool { color: var(--cyan); }
  .kpi-row .n.model { color: #f2f6fa; }
  .kpi-row .l { font-size: 12px; color: #6f7f8d; margin-left: 6px; }
  .kpi-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #14202a; }
  .kpi-bar i { display: block; background: var(--cyan); }
  .kpi-bar b { display: block; background: #b9c6d3; }
  .kpi-note { margin-top: 8px; font-size: 12.5px; color: #6f7f8d; font-family: ui-monospace, Consolas, monospace; }
  .log {
    margin: 12px 0 2px 0; padding: 10px 14px; border-left: 2px solid var(--cyan);
    background: #0a1a1c; color: #6ee7ea; font-family: ui-monospace, Consolas, monospace; font-size: 14.5px;
    border-radius: 0 8px 8px 0;
  }
  .log .k { color: #9df3f5; font-weight: 700; }
  .log .pre { font-size: 11.5px; color: #4f8f93; letter-spacing: .06em; margin-bottom: 4px; }
  .term { background: #0a1017; padding: 16px 18px; font-family: ui-monospace, Consolas, monospace;
    font-size: 13.5px; line-height: 1.72; color: #c3cfdb; white-space: pre; overflow: hidden; }
  .term .cmd { color: var(--cyan); }
  .cols { display: flex; gap: 20px; align-items: flex-start; }
  .col { flex: 1 1 0; min-width: 0; }
  .col .lbl { font-size: 14.5px; color: var(--dim); margin: 0 2px 10px; }
  .col .lbl b { color: #ffa3a3; font-weight: 600; }
  .col.ok .lbl b { color: var(--cyan); }
  .foot { color: #6b7885; font-size: 14px; margin: 16px 2px 0; }
`

function msgRow(m) {
  const her = m.who === '她'
  return `<div class="ln${her ? ' her' : ''}"><span class="t">${m.t}</span><span class="n">${m.who}</span><span class="x">${esc(m.text)}</span></div>`
}

function chatWin({ name, meta, messages, log }) {
  return `<div class="win">
    <div class="bar"><span class="lights"><i></i><i></i><i></i></span><span class="name">${esc(name)}</span><span class="meta">${esc(meta || '')}</span></div>
    <div class="chat">
      ${log ? `<div class="log"><div class="pre">开口之前 · 预热已经跑完</div>${log.t} · ${esc(log.text).replace(/tier=(\w+)/, 'tier=<span class="k">$1</span>')}</div>` : ''}
      ${messages.map(msgRow).join('')}
    </div>
  </div>`
}

function termWin({ name, meta, text, cmd }) {
  const body = cmd
    ? text.split('\n').map((l) => `<span class="${l.startsWith('$ ') ? 'cmd' : ''}">${esc(l)}</span>`).join('\n')
    : esc(text)
  return `<div class="win">
    <div class="bar"><span class="lights"><i></i><i></i><i></i></span><span class="name">${esc(name)}</span><span class="meta">${esc(meta || '')}</span></div>
    <div class="term">${body}</div>
  </div>`
}

const page = (title, body, width) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap"${width ? ` style="width:${width}px"` : ''}>${body}</div></body></html>`

function fig1(sections) {
  const a = sections.find((s) => s.title.startsWith('会话 A'))
  const d = sections.find((s) => s.title.startsWith('日记文件'))
  const diaryText = d ? d.lines.join('\n').trim() : ''
  const entries = diaryText.split(/\r?\n/).filter((l) => l.startsWith('## ')).length
  return page('图 1', `<div class="cap"><b>会话 A</b> · 他随口说的三件事，壳子把原话写进了一本本地日记</div>
    <div class="cols">
      <div class="col" style="flex:1.08 1 0">
        ${chatWin({ name: '会话 A', meta: `2026-11-22 ${a.messages[0].t}`, messages: a.messages })}
      </div>
      <div class="col">
        ${termWin({ name: 'notes/日记.md', meta: `${entries} 条`, text: diaryText })}
      </div>
    </div>
    <div class="foot">源文件：docs/figures/scene-transcript.txt</div>`, 1040)
}

function fig2(sections) {
  const b = sections.find((s) => s.title.startsWith('会话 B'))
  return page('图 2', `<div class="cap"><b>开一个新会话</b> · 它没有刚才那段对话，只有那本日记</div>
    ${chatWin({ name: '会话 B · 新窗口，空历史', meta: `2026-11-22 ${b.messages[0].t}`, messages: b.messages, log: b.logs[0] })}
    <div class="cap" style="margin:16px 2px 0">这一轮 <b>tier=full</b>：旧事在它开口<b>之前</b>就备好了，不是问了才去翻。</div>`)
}

function fig3(sections) {
  const c = sections.find((s) => s.title.startsWith('会话 C'))
  const t = sections.find((s) => s.term.length)
  return page('图 3', `<div class="cap"><b>同一句话，接记忆 / 不接记忆</b> · 记忆不在任何一个壳子里</div>
    <div class="cols">
      <div class="col">
        <div class="lbl">同一个壳子 · 只是没接记忆 · <b>答不上来</b></div>
        ${chatWin({ name: '会话 C · 空历史，没接记忆', messages: c.messages })}
      </div>
      <div class="col ok">
        <div class="lbl">同一本日记 · 命令行直接问 <b>照样命中</b></div>
        ${termWin({ name: 'terminal', meta: 'node bin/famr.mjs', text: t.term.join('\n'), cmd: true })}
      </div>
    </div>
    <div class="foot">换过五次壳子之后，打开还是同一本日记。</div>`, 1040)
}

function fig4(trace) {
  const him = trace.him[0] || { t: '', text: '' }
  const herHtml = trace.her.map(esc).join('<br>')
  const callsHtml = trace.calls.map((c) => `<div class="ln"><span class="t">${esc(c.t)}</span><span class="ms">${esc(c.ms)}s</span><span class="x">${esc(c.doing)}</span></div>`).join('')
  const num = (re) => { const m = trace.stats.match(re); return m ? Number(m[1]) : 0 }
  const total = num(/总\s*([\d.]+)s/)
  const tool = num(/工具跑了\s*([\d.]+)s/)
  const model = num(/模型生成\s*([\d.]+)s/)
  const pct = total ? Math.round((tool / total) * 100) : 0
  const kpi = `<div class="kpi">
      <div class="kpi-row"><span><span class="n tool">${tool.toFixed(1)}s</span><span class="l">工具（${pct}%）</span></span>
      <span><span class="n model">${model.toFixed(1)}s</span><span class="l">模型（${100 - pct}%）</span></span></div>
      <div class="kpi-bar"><i style="width:${pct}%"></i><b style="width:${100 - pct}%"></b></div>
      <div class="kpi-note">总 ${total.toFixed(1)}s · ${trace.calls.length} 次调用 · 慢的不是命令，是每步都要重新读一遍</div>
    </div>`
  return page('图 4', `<div class="cap"><b>同一句话，她自己翻回来</b> · 不是演示，是真跑的一轮（2026-11-22 23:01）</div>
    <div class="cols">
      <div class="col" style="flex:1.12 1 0">
        <div class="win">
          <div class="bar"><span class="lights"><i></i><i></i><i></i></span><span class="name">会话 · 23:01</span><span class="meta">turn 6</span></div>
          <div class="chat">
            <div class="ln"><span class="t">${esc(him.t)}</span><span class="n">他</span><span class="x">${esc(him.text)}</span></div>
            <div class="ln her"><span class="t">23:02:45</span><span class="n">她</span><span class="x">${herHtml}</span></div>
          </div>
        </div>
      </div>
      <div class="col">
        <div class="win">
          <div class="bar"><span class="lights"><i></i><i></i><i></i></span><span class="name">这一轮干了什么</span></div>
          <div class="chat trace">${callsHtml}${kpi}</div>
        </div>
      </div>
    </div>`, 1040)
}

function shoot(html, file, height, width) {
  const pagePath = join(BUILD, file.replace(/\.png$/, '.html'))
  writeFileSync(pagePath, html, 'utf8')
  const png = join(BUILD, file)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=2',
    `--user-data-dir=${join(BUILD, 'chrome-profile')}`,
    `--window-size=${width},${height}`,
    `--screenshot=${png}`,
    pathToFileURL(pagePath).href,
  ], { stdio: 'pipe' })
  if (!existsSync(png) || statSync(png).size < 5000) throw new Error(`截图失败：${png}`)
  return png
}

function main() {
  if (!CHROME) {
    console.error('找不到 Chrome。设 CHROME_PATH 指向 chrome.exe 再跑。')
    process.exit(1)
  }
  if (!existsSync(TRANSCRIPT)) {
    console.error(`没有 ${TRANSCRIPT}：先跑 node bench/scene.mjs`)
    process.exit(1)
  }
  const sections = parseTranscript(readFileSync(TRANSCRIPT, 'utf8'))
  rmSync(BUILD, { recursive: true, force: true })
  mkdirSync(BUILD, { recursive: true })

  const jobs = [
    ['fig1-diary.png', fig1(sections), 502, 1108],
    ['fig2-recall.png', fig2(sections), 386, 908],
    ['fig3-swap-shell.png', fig3(sections), 486, 1108],
    ['fig4-real-turn.png', fig4(parseTrace(readFileSync(join(HERE, 'fig4-trace.txt'), 'utf8'))), 556, 1108],
  ]
  for (const [name, html, h, w] of jobs) {
    const png = shoot(html, name, h, w)
    const out = join(HERE, name)
    copyFileSync(png, out)
    console.log(`${name}  ${(statSync(out).size / 1024).toFixed(0)} KB`)
  }
  console.log(`\n都放在 ${HERE}`)
}

const isMain = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
  } catch { return false }
})()
if (isMain) main()
