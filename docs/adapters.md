# 接到你自己的壳子上

这套东西不绑定任何聊天前端。规矩只有一条：

> **每轮生成之前，先问一句「这轮要不要备旧事」，把答案拼进系统提示。**

下面是三种接法，按省事程度排。诚实说明：**只有 CLI 和桥有回归测试**，
SillyTavern / Open-LLM-VTuber / AIRI 的具体接法我没在每个版本上实测过，写的是可落地的思路，
接线以你那个壳子的扩展文档为准。

## 最省事：用桥（推荐）

```bash
node examples/bridge.mjs --port=8787 --notes=notes --home=.famr
```

它给任何能发 HTTP 的壳子一个口子：

```bash
curl -s localhost:8787/prefetch -H 'content-type: application/json' \
  -d '{"say":"你上次说的那个约定是什么","session":"demo"}'
# → {"tier":"full","block":"【这一轮先备着的旧事】- [notes/…] …","daily":null,"confidence":0.61,"ms":12}
```

壳子那边每次生成前做三件事：

1. 把用户这句话 `POST /prefetch`；
2. 拿到 `daily.text`（每天第一条）和 `block`，拼到系统提示的开头或结尾；
3. 照常调模型。

伪代码（20 行之内）：

```js
const r = await fetch('http://127.0.0.1:8787/prefetch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ say: userText, session: sessionId }),
}).then((x) => x.json())

const extra = [r.daily?.text, r.block].filter(Boolean).join('\n\n')
const systemPrompt = extra ? `${baseSystem}\n\n${extra}` : baseSystem
```

`tier === 'none'` 是正常结果，说明这轮不需要备旧事，**别硬塞**。

## SillyTavern

思路：写一个本地扩展（`public/scripts/extensions/`），在生成之前调桥，把返回文本作为一条
system 消息插进这条请求。

- 扩展里可以用 `eventSource` 监听消息事件；在 `generate` 之前拿到 `chat` 最后一条内容；
- 调 `http://127.0.0.1:8787/prefetch`（浏览器对 localhost 的跨域请求，桥已经放开了 `access-control-allow-origin`）；
- 把 `block` 塞进 `extension_prompt` 或临时 system 消息，不要改角色卡。

注意：SillyTavern 自带世界书/记忆扩展，两者不冲突：世界书管设定，famr 管「你们之间发生过什么」。

## Open-LLM-VTuber

思路：它允许换 LLM 后端，在「给模型的请求」这一层插桩最容易。

- 在它构造 messages 的地方（或一个自定义 provider / 代理层）调 `/prefetch`；
- 把 `block` 作为 system 内容拼在最前面，再交给底层模型；
- 语音延迟敏感的话，把桥的 `ms` 记下来：本地字面检索 1–10ms，向量模式几十 ms，不会拖累对话。

## AIRI

思路同上：AIRI 的 LLM 调用是可插桩的，把「生成前调桥、拼 system」包一层。

- 单机自托管的话，甚至可以在最外面套一个极小的代理：接收 AIRI 的请求 → 调桥 → 改写 system → 转发给真模型；
- 好处是不用改 AIRI 源码，坏处是多一跳；对文字聊天完全够用。

## 不想要桥？

直接用 CLI 也行，适合一次性的壳子和脚本：

```bash
node bin/famr.mjs prefetch --say="她刚才那句话" --json
```

返回体里挑 `block` / `daily.text` 用；`--session` 传你的会话名，同话题抑制才生效。

## 一条底线

壳子换得越勤，这套东西越值钱，因为记忆不在壳子里。
**正文永远是你的 markdown**，索引删了能重建，搬家一个文件夹。
