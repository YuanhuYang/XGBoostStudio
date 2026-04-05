"""上传测试数据集并验收 wizard API；含 G2-Auth-1 训练 SSE + 运行档案（需服务 18899）。"""
import pathlib
import sys

import requests

sys.path.insert(0, ".")

BASE = "http://127.0.0.1:18899"

# 1. 上传数据集
f = pathlib.Path("tests/fixtures/titanic_train.csv")
r = requests.post(
    f"{BASE}/api/datasets/upload",
    files={"file": ("titanic_train.csv", f.open("rb"), "text/csv")},
)
assert r.status_code == 200, f"Upload failed: {r.text}"
ds = r.json()
ds_id = ds["id"]
print(f"[1/8] 数据集上传成功 ID={ds_id}  rows={ds['rows']}  cols={ds['cols']}")

# 2. 设置目标列
r2 = requests.patch(f"{BASE}/api/datasets/{ds_id}", json={"target_column": "Survived"})
print(f"[2/8] 设置目标列: {r2.status_code}")

# 3. 向导数据集摘要
r3 = requests.get(f"{BASE}/api/wizard/dataset-summary/{ds_id}")
assert r3.status_code == 200, f"dataset-summary failed: {r3.text}"
s = r3.json()
print(
    f"[3/8] dataset-summary: quality_score={s['quality_score']}  "
    f"task_type={s['task_type']}  recs={len(s['recommendations'])}"
)
assert "quality_score" in s
assert "task_type" in s

# 4. 数据集划分
r4 = requests.post(
    f"{BASE}/api/datasets/{ds_id}/split",
    json={
        "train_ratio": 0.8,
        "random_seed": 42,
        "stratify": False,
        "target_column": "Survived",
    },
)
assert r4.status_code == 200, f"split failed: {r4.text}"
split_id = r4.json()["split_id"]
print(f"[4/8] 数据划分: split_id={split_id}  train_rows={r4.json()['train_rows']}")

# 5. 向导快速参数推荐
r5 = requests.post(f"{BASE}/api/wizard/quick-config", json={"split_id": split_id})
assert r5.status_code == 200, f"quick-config failed: {r5.text}"
cfg = r5.json()
print(
    f"[5/8] quick-config: params={list(cfg['params'].keys())}  "
    f"explanations={list(cfg.get('explanations', {}).keys())[:3]}"
)
assert "params" in cfg
assert "explanations" in cfg, "explanations field missing!"
assert len(cfg["explanations"]) > 0, "explanations is empty!"

# 6. 参数 schema 新字段验证
r6 = requests.get(f"{BASE}/api/params/schema")
schema = r6.json()
required = [
    "impact_up",
    "impact_down",
    "overfitting_risk",
    "beginner_hide",
    "learn_more",
    "math_note",
    "tuning_tips",
]
for p in schema:
    missing = [f for f in required if f not in p]
    if missing:
        print(f"  FAIL [{p['name']}] 缺少: {missing}")
        sys.exit(1)
print(f"[6/8] PARAM_SCHEMA: {len(schema)} 个参数全部 7 个新字段验证通过")

# 7. 训练（读完 SSE 直至 event: done）
r7 = requests.post(
    f"{BASE}/api/training/start",
    json={
        "split_id": split_id,
        "params": {"n_estimators": 6, "max_depth": 3, "learning_rate": 0.2},
    },
)
assert r7.status_code == 200, r7.text
task_id = r7.json()["task_id"]
with requests.get(
    f"{BASE}/api/training/{task_id}/progress", stream=True, timeout=180
) as pr:
    pr.raise_for_status()
    for raw in pr.iter_lines(decode_unicode=True):
        if raw and "event: done" in raw:
            break
r7b = requests.get(f"{BASE}/api/training/{task_id}/result")
assert r7b.status_code == 200, r7b.text
res = r7b.json()
assert res.get("status") == "completed", res
model_id = res["model_id"]
print(f"[7/8] 训练完成 model_id={model_id}  task_id={task_id}")

# 8. G2-Auth-1 运行档案
r8 = requests.get(f"{BASE}/api/models/{model_id}/provenance")
assert r8.status_code == 200, r8.text
pv = r8.json()
assert pv.get("schema_version") == "1.0"
assert pv.get("split_id") == split_id
assert pv.get("split_random_seed") == 42
assert "packages" in pv and pv["packages"].get("xgboost")
params_p = pv.get("params_final") or {}
r_md = requests.get(f"{BASE}/api/models/{model_id}")
assert r_md.status_code == 200
assert (r_md.json().get("params") or {}) == params_p
print(
    f"[8/8] provenance: xgb={pv['packages'].get('xgboost')} "
    f"source={pv.get('source')} random_state={pv.get('params_final', {}).get('random_state')}"
)

print("\n[OK] All acceptance checks passed.")
