# 五张图

前三张是**真跑一遍**截下来的：一个壳子 + 一本本地日记，两段对话 + 一次命令行。
第四张是**真实用过的一轮**，把那次会话日志里的调用原样拆出来。
第五张是他自己截的聊天原图——他让放的，不是脚本排的。

| 图 | 说明 | 来源 |
| --- | --- | --- |
| `fig1-diary.png` | 会话 A：他随口说三件事 → 左边对话，右边 `notes/日记.md` 里落下的原话 | `scene-transcript.txt` |
| `fig2-recall.png` | 会话 B：新窗口、空历史，只问一句「我家猫叫啥来着」→ 答对了，开口之前 `tier=full` | `scene-transcript.txt` |
| `fig3-swap-shell.png` | 同一句话：接记忆 / 不接记忆 → 不接的答不上来；不经过任何壳子，`famr search` 照样命中 | `scene-transcript.txt` |
| `fig4-real-turn.png` | 真问一句「我当时说了他什么」→ 她翻回你 11-18 的原话；右边是那一轮的 6 次调用和耗时 | `fig4-trace.txt`（真实会话日志摘录） |
| `fig5-real-chat.png` | 连续两问：「还记得我上次说老马的事吗」49 秒，「那老黄干了啥」42 秒——她翻旧账翻到具体日期和原话 | 他自己截的原图 |

场景那几张的逐字全文在 [`scene-transcript.txt`](scene-transcript.txt)——图里的每一句都能在里面找到，没有改过一个字。
第五张是原样贴的截图，没重排、没裁时间戳。

## 图 4 的说明

- 数据来自本机 DSH 会话日志（2026-11-22 23:01 那一轮），工具名、开始时间、耗时都是原始值，没估过。
- **隐私**：右边是她自己的回复节选，涉及另一个人的那段按他的意思隐去了（图上留了标记）；黄仁勋那段是他自己的原话，逐字保留。
- 这一张没法给别人一键复现——它用的是本机的历史会话。能复现的是前三张，第四张是证据，不是演示。
- 想自己拆一轮，思路在 `tmp/trace-session.mjs` 那种脚本里：读 `session.v4.jsonl.zstd`，按 `turn/start` 切，配 `tool/call` 和 `tool/result` 的时间戳。

## 复现（前三张）

```bash
# 1) 本地嵌入服务（没有它检索分上限 0.5，到不了 full 档）
pip install -r embed/requirements.txt
python embed/server.py

# 2) 一个 OpenAI 兼容的模型（你自己的）
export FAMR_CHAT_URL=https://api.deepseek.com
export FAMR_CHAT_KEY=sk-...
export FAMR_CHAT_MODEL=deepseek-chat

# 3) 真跑一遍 → 写出 transcript
node bench/scene.mjs

# 4) 排版 + 截图（要本机装了 Chrome，或者设 CHROME_PATH）
node docs/figures/make.mjs

# 5) 回归：图里的每一句都必须在 transcript 里
node docs/figures/make.test.mjs
```

Windows 把 `export` 换成 `set`；`--embed=` 可以换嵌入服务地址。

## 这一轮的数字（照抄，别当通用值）

- 模型 `deepseek-v4.1-flash`，温度 0.3；嵌入 `bge-small-zh`
- 会话 B：`tier=full  conf=0.531  12ms`（阈值 full ≥ 0.52 是仓库默认值，没为这张图改过）
- 问句里**不含答案**：问的是「我家猫叫啥来着」，答案「豆子」只在日记里
- 会话 A 三条是编的（拔智齿 / 猫叫豆子 / 被叫起床），没有真人、没有隐私

## 为什么不是「手机聊天软件」的样子

试过带头像、气泡、输入框的 IM 版，越像 IM 越假：头像只能是占位符，时间戳全落在同一分钟（一次跑完就是这样），反而招人怀疑。
现在这个样式就是它的本色——**一份可以逐字对照的对话日志**，和右边终端一个调子。

## 一个诚实的提醒

这次 `full` 是 0.531，刚过线。分数受语料影响很大：换一本日记、换语言、换嵌入模型，都可能要重新校准
（`bench/calibrate.mjs`）。别拿这一张图当「阈值通用」的证据。
