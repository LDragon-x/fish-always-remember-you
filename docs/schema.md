# 存储：SQLite 里到底存了什么

一句话：**正文永远是你的文件，数据库只是索引**。库删了能重建，日记删了就没了。

## 三张表

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,   -- 相对 notes/ 的文件路径
  heading TEXT,         -- 属于哪个 ## 标题（'(开头)' 表示第一个标题之前）
  text TEXT NOT NULL,   -- 这一段的原文（约 380 字，太长会再切）
  mtime INTEGER,        -- 文件修改时间（秒）
  vec BLOB              -- 向量（Float32 拼成的二进制）；没起嵌入服务时为 NULL
);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  heading TEXT,
  ids TEXT,             -- 拼成这个块的 chunks.id，逗号分隔
  text TEXT,
  vec BLOB
);

CREATE TABLE vec_cache (
  hash TEXT PRIMARY KEY, -- 文本的哈希
  vec BLOB               -- 算过的向量，重跑不重算
);
```

为什么分两张：

- `chunks` 是**段**——按标题切、太长再按字数切，用来精确定位「哪一段」；
- `blocks` 是**话题块**——同一个文件里相邻且向量相近（≥0.72）的段拼起来，检索时先找块、再回段。
  没有向量时（字面模式）不拼，一段一块。

`vec_cache` 只为了省钱：文本不变就不重算向量。

## 自己看一眼

有 `sqlite3` 就直接开：

```bash
sqlite3 .famr/memory.db "SELECT COUNT(*) FROM chunks;"                # 多少段
sqlite3 .famr/memory.db "SELECT COUNT(*) FROM chunks WHERE vec IS NOT NULL;"  # 多少段有向量
sqlite3 .famr/memory.db "SELECT path, COUNT(*) FROM chunks GROUP BY path ORDER BY 2 DESC LIMIT 10;"
sqlite3 .famr/memory.db "SELECT heading, substr(text,1,40) FROM chunks ORDER BY id DESC LIMIT 5;"
```

没有 `sqlite3` 也不要紧，Node 22.5+ 自带 `node:sqlite`：

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('.famr/memory.db'); console.log(db.prepare('SELECT COUNT(*) n FROM chunks').get())"
```

或者直接 `node bin/famr.mjs status`，它替你数。

## 索引可以随便重建

```bash
rm -rf .famr/memory.db          # 不要了
node bin/famr.mjs index         # 从 notes/ 重建
```

重建后检索质量一样——**正文才是真相**。所以：升级、换模型、换机器，都可以先删库再重建。

## 搬家（导出 / 导入）

索引能重建，但「状态」（预热日志、上一轮端过什么）和正文要一起走：

```bash
# 打包：正文 + 索引 + 配置 + 逐文件 sha256 清单
node bin/famr.mjs export --out=famr-export-20261122

# 到新地方：先校验，再落盘；有一个字节对不上就一个文件都不写
node bin/famr.mjs import famr-export-20261122 --into=D:\新的日记本
```

导出的目录长这样：

```
famr-export-20261122/
  notes/              ← 正文（你的 md/txt，原样）
  .famr/              ← memory.db + prefetch-state.json
  famr.config.json    ← 路径已改成相对，换机仍指得着
  manifest.json       ← schemaVersion、创建时间、每个文件的 sha256 与大小
```

`manifest.json` 是搬家的底线：先核对再写盘，坏了的包不会污染新机器。

## 别做的事

- 别手动改 `memory.db`：索引是一致性算出来的，改了就错。
- 别把 `notes/` 之外的路径塞进配置当正文目录：建议正文永远在一个可备份的目录里。
- 别把密钥写进 `famr.config.json`：它会被一起导出。嵌入服务地址写成 `http://127.0.0.1:8791` 就好。
