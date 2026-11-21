// 本地嵌入客户端。
//
// 嵌入服务是一个独立的小 HTTP 服务（见 embed/server.py）：只吃文本、吐向量，
// 模型在本地，断网也能跑。服务没起的时候，调用方应该退回字面检索，而不是报错。
export async function embedTexts(texts, url, signal) {
  const r = await fetch(`${url.replace(/\/$/, '')}/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts }),
    signal,
  })
  if (!r.ok) throw new Error(`embed ${r.status}`)
  const j = await r.json()
  return j.vectors
}

export async function embedOne(text, url, signal) {
  const [v] = await embedTexts([text], url, signal)
  return v
}

/** 服务在不在（装配前问一句，别等检索时才炸）。 */
export async function embedAlive(url, timeoutMs = 800) {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok
  } catch {
    return false
  }
}
