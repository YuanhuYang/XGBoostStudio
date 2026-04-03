"""上传测试数据集并验收 wizard API"""
import pathlib
import sys

import requests

sys.path.insert(0, '.')

BASE = "http://127.0.0.1:18899"

# 1. 上传数据集
f = pathlib.Path("tests/fixtures/titanic_train.csv")
r = requests.post(f"{BASE}/api/datasets/upload",
                  files={"file": ("titanic_train.csv", f.open("rb"), "text/csv")})
assert r.status_code == 200, f"Upload failed: {r.text}"
ds = r.json()
ds_id = ds["id"]
print(f"[1/5] 数据集上传成功 ID={ds_id}  rows={ds['rows']}  cols={ds['cols']}")

# 2. 设置目标列
r2 = requests.patch(f"{BASE}/api/datasets/{ds_id}", json={"target_column": "Survived"})
print(f"[2/5] 设置目标列: {r2.status_code}")

# 3. 向导数据集摘要
r3 = requests.get(f"{BASE}/api/wizard/dataset-summary/{ds_id}")
assert r3.status_code == 200, f"dataset-summary failed: {r3.text}"
s = r3.json()
print(f"[3/5] dataset-summary: quality_score={s['quality_score']}  task_type={s['task_type']}  recs={len(s['recommendations'])}")
assert "quality_score" in s
assert "task_type" in s

# 4. 数据集划分
r4 = requests.post(f"{BASE}/api/datasets/{ds_id}/split",
                   json={"train_ratio": 0.8, "random_seed": 42, "stratify": False, "target_column": "Survived"})
assert r4.status_code == 200, f"split failed: {r4.text}"
split_id = r4.json()["split_id"]
print(f"[4/5] 数据划分: split_id={split_id}  train_rows={r4.json()['train_rows']}")

# 5. 向导快速参数推荐
r5 = requests.post(f"{BASE}/api/wizard/quick-config", json={"split_id": split_id})
assert r5.status_code == 200, f"quick-config failed: {r5.text}"
cfg = r5.json()
print(f"[5/5] quick-config: params={list(cfg['params'].keys())}  explanations={list(cfg.get('explanations', {}).keys())[:3]}")
assert "params" in cfg
assert "explanations" in cfg, "explanations field missing!"
assert len(cfg["explanations"]) > 0, "explanations is empty!"

# 6. 参数 schema 新字段验证
r6 = requests.get(f"{BASE}/api/params/schema")
schema = r6.json()
required = ["impact_up","impact_down","overfitting_risk","beginner_hide","learn_more","math_note","tuning_tips"]
for p in schema:
    missing = [f for f in required if f not in p]
    if missing:
        print(f"  FAIL [{p['name']}] 缺少: {missing}")
        sys.exit(1)
print(f"[6/6] PARAM_SCHEMA: {len(schema)} 个参数全部 7 个新字段验证通过")

print("\n✅ 所有验收测试通过！")
