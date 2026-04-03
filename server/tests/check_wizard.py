"""验收测试脚本"""
import sys
sys.path.insert(0, '.')

from routers import datasets, params, training, models, tuning, reports, prediction, wizard
from services import wizard_service, params_service

required_fields = ['impact_up','impact_down','overfitting_risk','beginner_hide','learn_more','math_note','tuning_tips']
schema = params_service.PARAM_SCHEMA
failed = []
for p in schema:
    missing = [f for f in required_fields if f not in p]
    if missing:
        failed.append(f"FAIL {p['name']} missing: {missing}")
    else:
        print(f"  OK  {p['name']}")

print(f"\nPARAM_SCHEMA: {len(schema)} params checked")
if failed:
    for f in failed:
        print(f)
    sys.exit(1)
else:
    print("All PARAM_SCHEMA entries have required fields.")
    print("All modules import OK.")
