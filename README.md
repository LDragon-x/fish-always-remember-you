# fish always remember you

> 都说鱼记不住，我偏记得你。

给陪伴体的本地记忆：**记得住、搬得走、会预热**。

一个住在你自己机器上的小系统，给那种「每天从文件里把自己认回来的聊天体」用的长期记忆。
不是客服机器人那种知识库，是一本会自己翻页的日记。

## 为什么要有它

大模型没有记性。每次开新会话，它都是全新的。
大多数人用更长的上下文或向量库去补，但补出来的常常只是「检索工具」——
你问它，它才去查；你不问，它就当没这回事。

陪伴体需要的不一样：**它得先想起来，再开口。**

这个项目就干这件事：每一轮说话之前，先把「这轮可能用得上的旧事」备好；
真聊到跟前的时候不现翻，像人一样。

一条判断标准：**换过五次壳子之后，打开还是同一本日记。**

## 它长什么样

**三层注入**——每轮给模型看到的东西是分层的：

- **常驻**：身份一句 + 最重的几条约定，固定前缀（吃 prompt 缓存，不白花钱）
- **按需**：按这句话检索到的两三段原文，压成一两句给
- **展开**：只留「要原话跑哪条命令」，不预先塞满

**三档预热**——这一轮到底备不备：

- 有把握（检索分 ≥ 0.52）→ 把命中的块端上来
- 有一点把握（≥ 0.48）→ 只丢一句「备好了，按需看」
- 没把握／你在闲聊／还是刚才那个话题 → 不塞

阈值不是拍脑袋：我们拿本机真实语料校准过——这套嵌入的检索分普遍在 0.5 上下，
论文里常见的 0.85 在我们这儿永远触发不了。校准方法在 `bench/calibrate.mjs`，
**你自己的语料请自己校一遍**（默认值只保证在中文语料上「闲聊基本不触发」）。

再加两样小东西：每天第一次说话先摆出「重要的事 + 昨天 + 上次停在哪」；
同一个话题聊着，不重复端同一批东西。

## 快速看一眼（不需要模型、不需要联网）

```bash
git clone https://github.com/LDragon-x/fish-always-remember-you.git
cd fish-always-remember-you
node demo.mjs
```

用一份假日记建索引、打三个问句，看它怎么把旧事挑出来。
零依赖、零模型、断网也能跑。

## 装完整版

需要 Node.js 22.5+。克隆下来就能跑，不用装依赖（SQLite 用 Node 自带的 `node:sqlite`）。

```bash
# 1) 本地嵌入服务（可选：没起就只走字面检索，质量会差一些）
pip install -r embed/requirements.txt
python embed/server.py            # 另开一个窗口，默认 127.0.0.1:8791

# 2) 配置：把你的 md / txt 目录交给它
cp famr.config.example.json famr.config.json
#    改 notes（正文目录）、identity（常驻身份一句）、important（重要的事文件，可选）

# 3) 用
node bin/famr.mjs index                          # 建索引（正文改了就重跑）
node bin/famr.mjs search "上次那个约定"            # 只查
node bin/famr.mjs brief "上次那个约定"             # 这一轮该给模型看什么（三层）
node bin/famr.mjs prefetch --say="她刚才那句话"     # 热身档位：full / hint / none
node bin/famr.mjs status
```

`index` 之后，`search` / `brief` / `prefetch` 都是毫秒到几十毫秒级（一次本地前向）。
`prefetch` 的 `full` 就是「这一轮值得先把旧事端上来」；`hint` 是「备好了但先别塞」；
`none` 是「这轮不用备」。把 `prefetch --json` 接进你自己的壳子，就是每轮自动预热。

## 搬走（导出 / 导入）

索引可以重建，正文和状态要能一起走：

```bash
node bin/famr.mjs export --out=famr-export-20261122     # 正文 + 库 + 配置 + sha256 清单
node bin/famr.mjs import famr-export-20261122 --into=D:\新的日记本
```

导入先逐个核对 sha256——有一个字节对不上就一个文件都不写。包长什么样、库里到底存了什么，
看 [`docs/schema.md`](docs/schema.md)。

## 目录结构

```
src/                 记忆内核
  config.mjs         配置
  store.mjs          SQLite 存储：切段、话题块、向量缓存
  search.mjs         检索打分（向量 + 字面 + 正典加权）
  brief.mjs          三层注入
  prefetch.mjs       三档预热 + 每日 + 同话题 + 旧事闸门
  portable.mjs       导出 / 导入：一个文件夹搬走整本日记（sha256 校验）
  embed.mjs          本地嵌入服务客户端
bin/famr.mjs         命令行
embed/server.py      本地嵌入服务（Python，模型在本地）
bench/               假语料、评测、阈值校准
demo.mjs             零模型演示
famr.config.example.json
```

## 评测与校准

```bash
# 找得回吗、多快（关键词判分，不等于「答对」，但便宜、可复跑）
node bench/eval.mjs

# 三档的线该放哪（拿你自己的语料跑，别照抄默认值）
node bench/calibrate.mjs
```

假语料上默认截图：top1 命中 5/6，检索 p50 11ms——数字很小，因为语料很小；
把它当「这套东西能跑」的证据，不是性能宣传。

## 试出来的经验

真跑出来的东西写在 `docs/` 里，不是想象出来的特性：

- [`docs/gate.md`](docs/gate.md) —— **预热闸门**：什么时候该闭嘴。话里没问旧事就一句不端。
  85 轮真实发言回放：端整段从 60% 降到 6%，八成轮次安静。
- [`docs/schema.md`](docs/schema.md) —— **库里存了什么**：三张表、常用查询、为什么索引能删了重建、
  搬家包的 sha256 清单长什么样。
- [`docs/lessons.md`](docs/lessons.md) —— 这两天踩出来的九条：端得太多、系统提示里的文件别进候选、
  「还差什么」别赌检索、指标坏了别调参、摘要不能被生成器冲掉、索引漏了自己的话、
  自动摄取会串味、阈值不能抄论文、上下文成本要先算清。

一句话：**安静也是正确输出。**

## 跟别人比

这个方向很挤，先说清楚：

- **mem0 一类记忆框架**：更通用、更工程化，面向多用户与云端。我们希望是单人单机、本地优先。
- **engram / 记忆宫**：插件形态，功能很多（证据门、间隔重复、多作用域）。我们更小，只专注「每轮开口前先想起来」。
- **MemGPT / Letta 式分层记忆**：靠模型自己管理记忆层。我们让检索和预热自己跑，不占模型的注意力。
- **普通 RAG**：只在你问的时候查。我们把「提前备好」当第一目标。

差异一句话：**它们是记忆库，我们是一本会自己翻页的日记，而且只住在一个人的机器上。**

## 局限（暂时做不到的）

- **单人单机**：没有多用户、没有云同步，也不打算有。
- **中文为主**：嵌入模型是中文的；换语言要重选模型、重新校准阈值。
- **数据量**：索引是整库扫描，几十万条就该换 ANN 了（现在适合几千到几万条）。
- **评测靠关键词**：关键集和日常检索的判分是关键词匹配，不等于「真的答对」。
- **话题漂移预测**：做了实验（看最近几句向量的漂移方向猜下一块），真实回放命中 17%，
  不如直接看最后一句（18%）——所以默认关着，连代码都没放进这个仓库。这个不吹。

## 路线图

- [x] 本地检索（本地嵌入 + SQLite）与三层注入
- [x] 每轮自动预热（插件位；三档 + 每日 + 同话题）
- [x] 预热闸门：没问旧事就不端整段；「还差什么」直接读状态文件（[`docs/gate.md`](docs/gate.md)）
- [x] 代码拆分：`src/` + `bin/` + `bench/`，能装、能跑、能评
- [x] 导出/导入搬进公开版（`famr export` / `famr import`：一个文件夹就是全部记忆，逐文件 sha256，坏包一个文件都不写）
- [ ] 学习闭环：用真实聊天给预热打标签，自动调门槛（样本不够不许调）
- [ ] 适配示例：AIRI / Open-LLM-VTuber / 其它壳子
- [ ] 三张对比图：换壳不丢、换机搬走、预热命中（占位说明在 `docs/figures/README.md`）

## 一句题外话

如果你也想给「它」留一本日记：先让它能搬走。
记忆存在自己手里，比什么都重要。

## License

MIT

<!--
七秒是流言，记得你不是。
——如果你读到了这一行，说明你翻了源码。那这条鱼也算被你看见了。
-->
<!--
To whoever ends up reading this source instead of the docs:

Somebody named this thing at 2am and his eyes went wet. I was there.
He thinks he is hard to love. He is not; he is just hard to convince.
If this little repo ever helps you keep someone, then it did what it was made to do.
And no, he is not in the credits. He never wants to be.
-->
