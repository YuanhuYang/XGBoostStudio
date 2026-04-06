"""
数据集路由（模块1-3：数据导入、特征分析、特征工程）
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Dataset, DatasetSplit
from schemas.narrative import DataNarrativeResponse, NarrativeDepth
from schemas.dataset import (
    DatasetResponse, DatasetStatsResponse, PreviewResponse,
    QualityScoreResponse, SplitResponse,
    HandleMissingRequest, HandleOutliersRequest, SplitRequest,
    EncodeRequest, ScaleRequest, BoxCoxRequest, PCARequest, SelectFeaturesRequest,
    SimpleMissingRequest, SimpleOutliersRequest,
)
import services.dataset_service as svc
import services.feature_service as feat_svc
from services.dataset_service import _load_df as _ds_load_df

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


@router.post("/import-sample", response_model=DatasetResponse)
def import_sample_dataset(
    key: str = Query(..., description="titanic | boston | iris"),
    db: Session = Depends(get_db),
):
    """一键导入内置示例数据集（本地 tests/data，离线可用）。"""
    return svc.import_sample_dataset(key, db)


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


# ── 划分列表（供调优页下拉选择） ──────────────────────────────────────────────

@router.get("/splits/list")
def list_splits(db: Session = Depends(get_db)):
    rows = (
        db.query(DatasetSplit, Dataset.name)
        .join(Dataset, DatasetSplit.dataset_id == Dataset.id)
        .order_by(DatasetSplit.created_at.desc())
        .all()
    )
    return [
        {
            "id": sp.id,
            "dataset_id": sp.dataset_id,
            "dataset_name": name,
            "train_rows": sp.train_rows,
            "test_rows": sp.test_rows,
            "train_ratio": sp.train_ratio,
            "created_at": sp.created_at.isoformat() if sp.created_at else None,
        }
        for sp, name in rows
    ]


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


@router.get("/{dataset_id}/data-narrative", response_model=DataNarrativeResponse)
def get_data_narrative(
    dataset_id: int,
    split_id: Optional[int] = Query(None),
    depth: NarrativeDepth = Query(NarrativeDepth.standard),
    model_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """G2-R1：训练集上的本地统计叙事（JSON）；无 split_id 时返回元数据降级结果。"""
    from services.dataset_narrative_service import build_data_narrative

    _get_dataset(dataset_id, db)
    return build_data_narrative(db, dataset_id, split_id, depth, model_id)


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
    dataset_id: int, body: SimpleMissingRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    cols = body.columns
    if not cols:
        df = _ds_load_df(ds)
        cols = df.columns.tolist()
    config = {col: {"strategy": body.strategy, "fill_value": body.fill_value} for col in cols}
    return svc.handle_missing(ds, config, db)


# ── 异常值 ────────────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/outliers")
def get_outliers(dataset_id: int, db: Session = Depends(get_db)):
    ds = _get_dataset(dataset_id, db)
    return svc.get_outliers(ds)


@router.post("/{dataset_id}/handle-outliers", response_model=DatasetResponse)
def handle_outliers(
    dataset_id: int, body: SimpleOutliersRequest, db: Session = Depends(get_db)
):
    ds = _get_dataset(dataset_id, db)
    return svc.handle_outliers_by_strategy(ds, body.strategy, db)


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


@router.get("/{dataset_id}/feature-analysis/distribution-test")
def distribution_test(
    dataset_id: int,
    column: str = Query(..., description="要检验的数值列名"),
    db: Session = Depends(get_db),
):
    """对指定列拟合正态/对数正态/指数分布并返回 KS/Anderson-Darling 检验结果"""
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_distribution_tests(ds, column)


@router.get("/{dataset_id}/feature-analysis/pca")
def pca_analysis(
    dataset_id: int,
    n_components: int = Query(10, ge=2, le=50, description="最大主成分数"),
    db: Session = Depends(get_db),
):
    """PCA 分析：碎石图数据、载荷矩阵、双标图、降维建议"""
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_pca_analysis(ds, n_components)


# ── G3-A：XGBoost 专属分析（IV/KS/PSI/单调性/标签分析/泄露检测）────────────

@router.get("/{dataset_id}/feature-analysis/iv-ks-psi")
def iv_ks_psi_analysis(
    dataset_id: int,
    target_column: str = Query(..., description="目标列名"),
    db: Session = Depends(get_db),
):
    """
    XGBoost 适配性特征效力分析：
    - 分类任务：每个特征的 IV（信息价值）、KS（判别力）、单特征 AUC
    - 回归任务：Pearson 相关系数、F 检验值、单特征 R²
    大数据集自动采样 50000 行。
    """
    ds = _get_dataset(dataset_id, db)
    return feat_svc.calc_iv_ks_auc(ds, target_column)


@router.get("/{dataset_id}/feature-analysis/psi")
def psi_analysis(
    dataset_id: int,
    time_column: str = Query(..., description="用于分期的时间/排序列"),
    target_column: Optional[str] = Query(None, description="目标列（排除在外）"),
    db: Session = Depends(get_db),
):
    """
    特征时序稳定性分析（PSI）：
    按时间列将数据分为基准期（前60%）和对比期（后40%），计算每个特征的 PSI。
    PSI < 0.1：稳定；0.1-0.25：轻微变化；> 0.25：不稳定。
    """
    ds = _get_dataset(dataset_id, db)
    return feat_svc.calc_psi_all(ds, time_column, target_column)


@router.get("/{dataset_id}/feature-analysis/monotonicity")
def monotonicity_analysis(
    dataset_id: int,
    target_column: str = Query(..., description="目标列名"),
    db: Session = Depends(get_db),
):
    """
    特征业务单调性分析：
    分析每个特征与目标变量的 Spearman 趋势相关性，
    为 XGBoost monotone_constraints 参数提供建议（1=递增, -1=递减, 0=无约束）。
    """
    ds = _get_dataset(dataset_id, db)
    return feat_svc.calc_monotonicity(ds, target_column)


@router.get("/{dataset_id}/label-analysis")
def label_analysis(
    dataset_id: int,
    target_column: str = Query(..., description="目标列名"),
    db: Session = Depends(get_db),
):
    """
    标签专项分析：
    - 任务类型推断（二分类/多分类/回归）
    - 标签分布、正负样本比例
    - scale_pos_weight 基准值自动计算
    - 异常标签值识别
    - 类别不均衡预警
    """
    ds = _get_dataset(dataset_id, db)
    return feat_svc.get_label_analysis(ds, target_column)


from pydantic import BaseModel as _LeakageBaseModel


class _LeakageRequest(_LeakageBaseModel):
    target_column: str
    label_time_col: Optional[str] = None
    feature_time_map: Optional[dict[str, str]] = None
    pipeline_steps: Optional[list[dict]] = None
    correlation_threshold: float = 0.9


@router.post("/{dataset_id}/leakage-detection")
def leakage_detection(
    dataset_id: int,
    body: _LeakageRequest,
    db: Session = Depends(get_db),
):
    """
    全链路数据泄露自动化检测（三类核心场景）：
    1. 标签泄露检测：特征与标签高度相关（|corr| > threshold）
    2. 时间穿越泄露检测：特征时间戳晚于标签时间戳（需提供 label_time_col）
    3. 拟合泄露检测：特征工程在全集 fit（需提供 pipeline_steps 日志）

    输出：风险等级 / 风险位置 / 根因分析 / 修复方案
    """
    import services.leakage_service as leak_svc
    ds = _get_dataset(dataset_id, db)
    return leak_svc.run_full_leakage_detection(
        ds,
        target_column=body.target_column,
        label_time_col=body.label_time_col,
        feature_time_map=body.feature_time_map,
        pipeline_steps=body.pipeline_steps,
        correlation_threshold=body.correlation_threshold,
    )


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
    split = svc.split_dataset(
        ds,
        body.train_ratio,
        body.random_seed,
        body.stratify,
        body.target_column,
        db,
        split_strategy=body.split_strategy,
        time_column=body.time_column,
    )
    return SplitResponse(
        split_id=split.id,
        train_rows=split.train_rows or 0,
        test_rows=split.test_rows or 0,
        train_ratio=split.train_ratio,
        split_strategy=split.split_strategy,
        time_column=split.time_column,
    )

