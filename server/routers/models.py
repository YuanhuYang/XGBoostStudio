"""
模型管理 & 评估路由（模块6/8）
GET    /api/models                      → 模型列表
GET    /api/models/{id}                 → 模型详情
DELETE /api/models/{id}                 → 删除模型
PUT    /api/models/{id}/rename          → 重命名
GET    /api/models/{id}/evaluation      → 评估指标 + 图表数据
GET    /api/models/{id}/provenance      → 运行档案（G2-Auth-1）
GET    /api/models/{id}/shap            → SHAP 详细值
GET    /api/models/compare?ids=1,2,3   → 多模型对比
POST   /api/models/{id}/export          → 导出模型文件
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db.database import get_db, MODELS_DIR
from db.models import DatasetSplit, Model
from services.eval_service import (
    get_evaluation, get_shap_detail, get_learning_curve,
    get_pdp_ice, get_oot_evaluation, get_robustness_test,
    get_bad_sample_diagnosis, get_fairness_analysis,
)
from services.provenance import legacy_provenance_from_model_row

router = APIRouter(prefix="/api/models", tags=["models"])


def _to_dict(m: Model) -> dict[str, Any]:
    return {
        "id": m.id,
        "name": m.name,
        "task_type": m.task_type,
        "metrics": json.loads(m.metrics_json or "{}"),
        "params": json.loads(m.params_json or "{}"),
        "dataset_id": m.dataset_id,
        "split_id": m.split_id,
        "tags": m.tags or "",
        "description": m.description or "",
        "notes": getattr(m, "notes", None) or "",
        "training_time_s": m.training_time_s,
        "is_deleted": getattr(m, "is_deleted", False) or False,
        "created_at": str(m.created_at),
    }


@router.get("")
def list_models(
    task_type: str | None = Query(None, description="过滤任务类型: classification/regression"),
    dataset_id: int | None = Query(None),
    min_auc: float | None = Query(None, description="最低AUC阈值"),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    q = db.query(Model).filter(Model.is_deleted == False)  # noqa: E712
    if task_type:
        q = q.filter(Model.task_type == task_type)
    if dataset_id:
        q = q.filter(Model.dataset_id == dataset_id)
    models = q.order_by(Model.created_at.desc()).all()
    if min_auc is not None:
        models = [
            m for m in models
            if json.loads(m.metrics_json or "{}").get("auc", 0) >= min_auc
        ]
    return [_to_dict(m) for m in models]


@router.get("/compare")
def compare_models(
    ids: str = Query(..., description="逗号分隔的模型ID列表"),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    id_list = [int(i.strip()) for i in ids.split(",") if i.strip().isdigit()]
    models = db.query(Model).filter(Model.id.in_(id_list)).all()
    return [_to_dict(m) for m in models]


@router.get("/{model_id}/provenance")
def get_model_provenance(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    """G2-Auth-1：导出运行档案（环境版本、划分种子、最终参数与指标摘要）。"""
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    if m.provenance_json:
        return json.loads(m.provenance_json)
    base = legacy_provenance_from_model_row(
        m.dataset_id, m.split_id, m.params_json, m.metrics_json
    )
    if m.split_id:
        sp = db.query(DatasetSplit).filter(DatasetSplit.id == m.split_id).first()
        if sp:
            base["split_random_seed"] = sp.random_seed
    return base


@router.get("/{model_id}")
def get_model(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    return _to_dict(m)


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    """软删除：设置 is_deleted=True，保留数据库记录"""
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    m.is_deleted = True
    db.commit()
    return {"status": "deleted"}


@router.patch("/{model_id}")
def patch_model(
    model_id: int,
    body: dict[str, Any],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """更新模型 name / tags / notes"""
    m = db.query(Model).filter(Model.id == model_id, Model.is_deleted == False).first()  # noqa: E712
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    if "name" in body:
        m.name = str(body["name"])
    if "tags" in body:
        m.tags = str(body["tags"])
    if "notes" in body:
        m.notes = str(body["notes"])
    if "description" in body:
        m.description = str(body["description"])
    db.commit()
    return _to_dict(m)


@router.get("/{model_id}/export")
def export_model_get(model_id: int, db: Session = Depends(get_db)) -> FileResponse:
    """GET 方式下载模型文件"""
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    path = MODELS_DIR / m.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")
    safe_name = m.name.replace(" ", "_")
    return FileResponse(path=str(path), filename=f"{safe_name}.ubj", media_type="application/octet-stream")


@router.put("/{model_id}/rename")
def rename_model(
    model_id: int, body: dict[str, Any], db: Session = Depends(get_db)
) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    m.name = body.get("name", m.name)
    db.commit()
    return _to_dict(m)


@router.post("/{model_id}/tag")
def tag_model(
    model_id: int, body: dict[str, Any], db: Session = Depends(get_db)
) -> dict[str, Any]:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    m.tags = body.get("tags", m.tags)
    m.description = body.get("description", m.description)
    db.commit()
    return _to_dict(m)


@router.get("/{model_id}/evaluation")
def evaluation(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_evaluation(model_id, db)


@router.get("/{model_id}/shap")
def shap_detail(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_shap_detail(model_id, db)


@router.get("/{model_id}/learning-curve")
def learning_curve(model_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return get_learning_curve(model_id, db)


# ── G3-B：新增评估端点 ────────────────────────────────────────────────────────

@router.get("/{model_id}/pdp-ice/{feature_name}")
def pdp_ice(
    model_id: int,
    feature_name: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    偏依赖图（PDP）与个体条件期望（ICE）曲线。
    揭示特征对预测结果的边际影响趋势，支持业务单调性一致性校验。
    """
    return get_pdp_ice(model_id, feature_name, db)


@router.post("/{model_id}/oot-evaluation")
def oot_evaluation(
    model_id: int,
    body: dict[str, Any],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    OOT（Out-of-Time）跨时间集全维度评估。
    body: {"oot_split_id": int}
    对比原始测试集与 OOT 集的全维度准确性指标，量化模型时间衰减幅度。
    """
    oot_split_id = body.get("oot_split_id")
    if not oot_split_id:
        raise HTTPException(status_code=422, detail="body 中必须提供 oot_split_id")
    return get_oot_evaluation(model_id, int(oot_split_id), db)


@router.post("/{model_id}/robustness-test")
def robustness_test(
    model_id: int,
    body: dict[str, Any],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    鲁棒性压力测试。
    body: {"test_type": "feature_perturbation" | "sample_perturbation" | "extreme"}
    - feature_perturbation：特征扰动（高斯噪声 + 随机缺失）
    - sample_perturbation：样本扰动（随机剔除部分测试样本）
    - extreme：极端值样本测试
    """
    test_type = body.get("test_type", "feature_perturbation")
    return get_robustness_test(model_id, test_type, db)


@router.get("/{model_id}/bad-sample-diagnosis")
def bad_sample_diagnosis(
    model_id: int,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    FP/FN 坏样本自动聚类根因诊断。
    仅支持分类任务。对错误预测样本进行 K-Means 聚类，输出共性特征与根因分析。
    """
    return get_bad_sample_diagnosis(model_id, db)


@router.post("/{model_id}/fairness-analysis")
def fairness_analysis(
    model_id: int,
    body: dict[str, Any],
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """
    算法公平性分析。
    body: {"group_col": str}
    按分组字段计算各子群的预测准确性偏差，输出人口统计公平差异（DPD）。
    """
    group_col = body.get("group_col")
    if not group_col:
        raise HTTPException(status_code=422, detail="body 中必须提供 group_col")
    return get_fairness_analysis(model_id, group_col, db)


@router.post("/{model_id}/export")
def export_model(model_id: int, db: Session = Depends(get_db)) -> FileResponse:
    m = db.query(Model).filter(Model.id == model_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="模型不存在")
    path = MODELS_DIR / m.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")
    safe_name = m.name.replace(" ", "_")
    return FileResponse(
        path=str(path),
        filename=f"{safe_name}.ubj",
        media_type="application/octet-stream",
    )
