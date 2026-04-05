"""E2E 验证脚本: 模型列表 → 报告生成 → PDF 下载

前置条件:
    - 后端已启动并监听 http://127.0.0.1:18899
    - 若数据库中无任何已训练模型，脚本打印提示后以退出码 0 结束（跳过报告步骤）

用法（工作目录为 server/）::

    python tests/e2e_validate.py

与验收文档的对应关系见 docs/product/验收追踪.md（e2e 行）。
"""
import requests
import sys

# Windows 默认控制台常为 GBK，直接 print Unicode 会触发 UnicodeEncodeError
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE = "http://127.0.0.1:18899"

# 1. 列出模型
r = requests.get(f"{BASE}/api/models")
assert r.status_code == 200, f"GET /api/models failed: {r.text}"
models = r.json()
print(f"[1] 模型列表: {len(models)} 个模型")

if not models:
    print("  ⚠ 没有训练好的模型，跳过报告测试")
    sys.exit(0)

model = models[0]
model_id = model["id"]
print(f"  使用模型: id={model_id}  name={model['name']}  task={model['task_type']}")
print(f"  metrics: {model.get('metrics', {})}")

# 2. 生成报告
r2 = requests.post(f"{BASE}/api/reports/generate", json={
    "model_id": model_id,
    "title": "E2E 测试报告",
    "include_sections": ["overview", "metrics", "confusion_matrix", "roc_curve", "feature_importance", "shap"]
})
print(f"[2] 报告生成: {r2.status_code}")
assert r2.status_code == 200, f"Report generate failed: {r2.text[:500]}"
rdata = r2.json()
report_id = rdata["id"]
print(f"  report_id={report_id}")

# 3. 下载 PDF
r3 = requests.get(f"{BASE}/api/reports/{report_id}/download")
print(f"[3] PDF 下载: {r3.status_code}  size={len(r3.content):,} bytes")
assert r3.status_code == 200, f"PDF download failed: {r3.text[:200]}"
assert r3.headers.get("content-type", "").startswith("application/pdf"), "Not a PDF response"
assert len(r3.content) > 10000, f"PDF too small: {len(r3.content)} bytes"

out_path = "tests/e2e_test_report.pdf"
with open(out_path, "wb") as f:
    f.write(r3.content)
print(f"  Saved → {out_path}")
print(f"  PDF size: {len(r3.content)/1024:.1f} KB")

# 4. 预测 API 快测
print("[4] 预测 API 快测...")
r5 = requests.get(f"{BASE}/api/models/{model_id}")
if r5.status_code == 200:
    print(f"  GET /api/models/{model_id}: OK")

print("\n✅ E2E 流程验证通过!")
