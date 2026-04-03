"""
数据集路由（模块1-3：数据导入、特征分析、特征工程）
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Dataset
from schemas.dataset import (
    DatasetResponse, DatasetStatsResponse, PreviewResponse,
    QualityScoreResponse, SplitResponse,
    HandleMissingRequest, HandleOutliersRequest, SplitRequest,
    EncodeRequest, ScaleRequest, BoxCoxRequest, PCARequest, SelectFeaturesRequest,
)
import services.dataset_service as svc
import services.feature_service as feat_svc

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _get_dataset(dataset_id: int, db: Session) -> Dataset:
    ds = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail=f"数据集 {dataset_id} 不存在")
    return ds


# ── 上传 ──────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=DatasetResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    dataset = svc.save_upload_file(content, file.filename or "upload", sheet_name, db)
    return dataset


# ── 列表 / 详情 / 删除 ────────────────────────────────────────────────────────

@router.get("", response_model=list[DatasetResponse])
def list_datasets(db: Session = Depends(get_db)):
    return db.query(Dataset).order_by(Dataset.created_at.desc()).all()


@router.get("/{dataset_id}", response_model=DatasetResponse)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    return _get_dataset(dataset_id, db)


@router.patch("/{dataset_id}")
def update_dataset(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    """更新数据集属性（如目标列）"""
    ds = _get_dataset(dataset_id, db)
    if "target_column" in body:
        ds.target_column = body["target_column"]
    if "name" in body:
        ds.name = body["name"]
    db.commit()
    return {"id": ds.id, "name": ds.name, "target_column": ds.target_column}


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    db.delete(ds)
    db.commit()
    return {"message": "已删除"}


# ── 预览 / 统计 ───────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/preview", response_model=PreviewResponse)
def preview_dataset(
    dataset_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    ds = _get_dataset(dataset_id, db)
    return svc.get_preview(ds, page, page_size)


@router.get("/{dataset_id}/stats", response_model=DatasetStatsResponse)
def get_stats(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_stats(ds)


# ── 分布 ──────────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/distribution/{column}")
def get_distribution(dataset_id: int, column: str, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_distribution(ds, column)


# ── 缺失值 ────────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/missing-pattern")
def get_missing_pattern(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_missing_pattern(ds)


@router.post("/{dataset_id}/handle-missing", response_model=DatasetResponse)
def handle_missing(
    dataset_id: int, body: HandleMissingRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return svc.handle_missing(ds, {k: v.model_dump() for k, v in body.config.items()}, db)


# ── 异常值 ────────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/outliers")
def get_outliers(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_outliers(ds)


@router.post("/{dataset_id}/handle-outliers", response_model=DatasetResponse)
def handle_outliers(
    dataset_id: int, body: HandleOutliersRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return svc.handle_outliers(ds, body.action, body.row_indices, db)


# ── 重复行 ────────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/duplicates")
def get_duplicates(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_duplicates(ds)


@router.post("/{dataset_id}/drop-duplicates", response_model=DatasetResponse)
def drop_duplicates(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.drop_duplicates(ds, db)


# ── 质量评分 ──────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/quality-score", response_model=QualityScoreResponse)
def quality_score(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_quality_score(ds)


# ── 特征分析（模块2） ─────────────────────────────────────────────────────────

@router.get("/{dataset_id}/feature-analysis/distribution")
def feature_distribution(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_feature_distributions(ds)


@router.get("/{dataset_id}/feature-analysis/correlation")
def feature_correlation(
    dataset_id: int,
    method: str = Query("pearson", description="pearson/spearman/kendall"),
    db: Session = Depends(get_db),
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_correlation(ds, method)


@router.get("/{dataset_id}/feature-analysis/target-relation")
def target_relation(
    dataset_id: int,
    target_column: str = Query(...),
    db: Session = Depends(get_db),
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_target_relation(ds, target_column)


@router.get("/{dataset_id}/feature-analysis/vif")
def vif_analysis(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_vif(ds)


@router.get("/{dataset_id}/feature-analysis/importance-preliminary")
def preliminary_importance(
    dataset_id: int,
    target_column: str = Query(...),
    db: Session = Depends(get_db),
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_mutual_info_importance(ds, target_column)


@router.get("/{dataset_id}/feature-analysis/multivariate-outliers")
def multivariate_outliers(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_mahalanobis_outliers(ds)


# ── 特征工程（模块3） ─────────────────────────────────────────────────────────

@router.post("/{dataset_id}/feature-engineering/encode", response_model=DatasetResponse)
def encode_features(
    dataset_id: int, body: EncodeRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.encode_features(ds, body.columns, body.method, body.target_column, db)


@router.post("/{dataset_id}/feature-engineering/scale", response_model=DatasetResponse)
def scale_features(
    dataset_id: int, body: ScaleRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.scale_features(ds, body.columns, body.method, db)


@router.post("/{dataset_id}/feature-engineering/box-cox", response_model=DatasetResponse)
def box_cox_transform(
    dataset_id: int, body: BoxCoxRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.box_cox_transform(ds, body.columns, db)


@router.post("/{dataset_id}/feature-engineering/pca", response_model=DatasetResponse)
def pca_transform(
    dataset_id: int, body: PCARequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.pca_transform(ds, body.columns, body.n_components, db)


@router.post("/{dataset_id}/feature-engineering/select", response_model=DatasetResponse)
def select_features(
    dataset_id: int, body: SelectFeaturesRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return feat_svc.select_features(ds, body.method, body.target_column,
                                    body.threshold, body.n_features, db)


# ── 数据集划分 ────────────────────────────────────────────────────────────────

@router.post("/{dataset_id}/split", response_model=SplitResponse)
def split_dataset(
    dataset_id: int, body: SplitRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    split = svc.split_dataset(ds, body.train_ratio, body.random_seed,
                              body.stratify, body.target_column, db)
    return SplitResponse(
        split_id=split.id,
        train_rows=split.train_rows or 0,
        test_rows=split.test_rows or 0,
        train_ratio=split.train_ratio,
    )

