"""
G2-Auth-1：运行档案（Run Provenance）构建。

随机种子策略（与训练线程一致）：
- **划分**：`DatasetSplit.random_seed` 在创建划分时用于 `train_test_split`（或等价），决定 train/test 行集合。
- **XGBoost**：`merged_params["random_state"]` 来自默认 `_default_params`（42）或用户覆盖；控制树构建中的随机性。
- **numpy / Python random**：训练路径未在全局调用 `np.random.seed` / `random.seed`；可复现性依赖上述两者 + 固定依赖版本。
- **残余非确定性**：多线程 BLAS、浮点累加顺序等可能导致极小差异；档案中记录包版本以便对照。
"""
from __future__ import annotations

import json
import os
import sys
from importlib import metadata
from typing import Any, Literal

SourceKind = Literal["training", "tuning"]


def _pkg_ver(name: str) -> str:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return "unknown"


def build_training_provenance(
    *,
    dataset_id: int | None,
    split_id: int | None,
    split_random_seed: int | None,
    params_final: dict[str, Any],
    metrics: dict[str, Any],
    source: SourceKind,
    training_task_id: str | None = None,
    tuning_task_id: str | None = None,
    training_time_s: float | None = None,
) -> dict[str, Any]:
    """生成与 `params_json` / `metrics_json` 对齐的结构化运行档案。"""
    git_commit = os.environ.get("GIT_COMMIT") or os.environ.get("XGBOOST_STUDIO_GIT_COMMIT")
    prov: dict[str, Any] = {
        "schema_version": "1.0",
        "source": source,
        "dataset_id": dataset_id,
        "split_id": split_id,
        "split_random_seed": split_random_seed,
        "params_final": params_final,
        "metrics": metrics,
        "packages": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "xgboost": _pkg_ver("xgboost"),
            "sklearn": _pkg_ver("scikit-learn"),
            "pandas": _pkg_ver("pandas"),
            "numpy": _pkg_ver("numpy"),
        },
        "randomness": {
            "xgboost_random_state": params_final.get("random_state"),
            "split_seed_documented": split_random_seed is not None,
            "global_numpy_seed_set": False,
            "notes_zh": (
                "划分由 DatasetSplit.random_seed 固定；XGBoost 使用 params 中的 random_state。"
                "未在训练线程内设置全局 numpy.random.seed。"
            ),
        },
    }
    if git_commit:
        prov["git_commit"] = git_commit
    if training_task_id:
        prov["training_task_id"] = training_task_id
    if tuning_task_id:
        prov["tuning_task_id"] = tuning_task_id
    if training_time_s is not None:
        prov["training_time_s"] = training_time_s
    return prov


def provenance_to_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


def legacy_provenance_from_model_row(
    dataset_id: int | None,
    split_id: int | None,
    params_json: str | None,
    metrics_json: str | None,
) -> dict[str, Any]:
    """旧模型无 provenance_json 列时的降级展示。"""
    return {
        "schema_version": "1.0",
        "legacy": True,
        "legacy_note_zh": "此记录在运行档案功能上线前创建，无环境版本信息；以下为数据库中的已知字段。",
        "dataset_id": dataset_id,
        "split_id": split_id,
        "params_final": json.loads(params_json or "{}"),
        "metrics": json.loads(metrics_json or "{}"),
    }
