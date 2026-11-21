# 本地嵌入服务 · 只吃文本、吐向量
#
# 用法：
#   pip install -r embed/requirements.txt
#   python embed/server.py            # 默认端口 8791，模型从 HuggingFace 拉（可放本地路径）
#   FAMR_MODEL=/path/to/bge-small-zh python embed/server.py
#
# 为什么单开一个服务：模型加载一次要几秒，检索每次都要用向量。
# 服务常驻，检索就只剩一次前向的开销；服务没起，famr 会自己退回字面检索。
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = os.environ.get("FAMR_MODEL") or os.environ.get("BGE_MODEL") or "BAAI/bge-small-zh-v1.5"
PORT = int(os.environ.get("FAMR_EMBED_PORT", "8791"))

import torch  # noqa: E402
from transformers import AutoModel, AutoTokenizer  # noqa: E402

tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
model = AutoModel.from_pretrained(MODEL, trust_remote_code=True)
model.eval()
torch.set_num_threads(max(1, (os.cpu_count() or 4) // 2))


def encode(texts, batch=32):
    import numpy as np

    out = []
    with torch.no_grad():
        for i in range(0, len(texts), batch):
            b = texts[i:i + batch]
            enc = tok(b, padding=True, truncation=True, max_length=256, return_tensors="pt")
            o = model(**enc)
            v = torch.nn.functional.normalize(o.last_hidden_state[:, 0], dim=1)
            out.append(v.cpu().numpy())
    return np.concatenate(out, axis=0)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL, "dim": 512})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            texts = body.get("texts") or []
            if not texts:
                return self._json(400, {"error": "texts required"})
            vecs = encode(texts)
            return self._json(200, {"vectors": [[round(float(x), 5) for x in row] for row in vecs]})
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": str(e)})


if __name__ == "__main__":
    print(f"famr embed server on 127.0.0.1:{PORT} model={MODEL}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
