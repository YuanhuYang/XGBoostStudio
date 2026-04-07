"""
数据集业务逻辑服务
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
from fastapi import HTTPException
from sklearn.impute import KNNImputer  # type: ignore
from sklearn.model_selection import train_test_split  # type: ignore
from sqlalchemy.orm import Session

from db.database import DATA_DIR
from db.models import Dataset, DatasetSplit


@dataclass(frozen=True)
class BuiltinSampleSpec:
    key: str
    filename: str
    title: str
    task: str
    difficulty: str
    scenario: str
    suggested_target: Optional[str] = None


# 顺序即下拉展示顺序；CSV 与 server/tests/data 一致，离线可用
BUILTIN_SAMPLE_SPECS: tuple[BuiltinSampleSpec, ...] = (
    BuiltinSampleSpec(
        "titanic", "titanic.csv", "Titanic", "二分类", "入门", "生存预测", "Survived"
    ),
    BuiltinSampleSpec(
        "iris", "iris.csv", "Iris", "多分类", "入门", "经典花种分类", "species"
    ),
    BuiltinSampleSpec(
        "boston",
        "boston_housing.csv",
        "Boston Housing",
        "回归",
        "入门",
        "房价回归（教学用）",
        "medv",
    ),
    BuiltinSampleSpec(
        "wine",
        "wine.csv",
        "Wine 化学成分",
        "多分类",
        "进阶",
        "酿酒化学特征多分类",
        "class",
    ),
    BuiltinSampleSpec(
        "german_credit",
        "german_credit.csv",
        "German Credit",
        "二分类",
        "进阶",
        "信贷评分 / 风控表格",
        "class",
    ),
    BuiltinSampleSpec(
        "bank_marketing",
        "bank_marketing.csv",
        "Bank Marketing",
        "二分类",
        "进阶",
        "营销响应（类流失场景）",
        "y",
    ),
    BuiltinSampleSpec(
        "credit_card_default",
        "credit_card_default.csv",
        "信用卡违约",
        "二分类",
        "进阶",
        "循环授信违约预测",
        "default_payment_next_month",
    ),
    BuiltinSampleSpec(
        "adult_income",
        "adult_income.csv",
        "Adult Income",
        "二分类",
        "挑战",
        "人口统计收入（高基数类别、混合类型）",
        "income",
    ),
    BuiltinSampleSpec(
        "uci_automobile_price",
        "uci_automobile_price.csv",
        "UCI 汽车价格（1985 Imports）",
        "回归",
        "挑战",
        "UCI 公开集：车型与规格预测标价（美元；离散制造/成品定价类比）",
        "price",
    ),
    BuiltinSampleSpec(
        "mfg_assembly_price",
        "manufacturing_assembly_price.csv",
        "产线组装定价（合成）",
        "回归",
        "挑战",
        "演示用合成：零部件成本与产线特征预测单价（仓库内生成，非 UCI 镜像）",
        "finished_unit_price",
    ),
)

SAMPLE_DATASET_FILES: dict[str, str] = {s.key: s.filename for s in BUILTIN_SAMPLE_SPECS}


def list_builtin_samples_payload() -> list[dict[str, Any]]:
    """供 API 与 CLI 使用的内置示例目录（单一事实来源）。"""
    return [
        {
            "key": s.key,
            "title": s.title,
            "task": s.task,
            "difficulty": s.difficulty,
            "scenario": s.scenario,
            "suggested_target": s.suggested_target,
        }
        for s in BUILTIN_SAMPLE_SPECS
    ]


def _sample_data_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "tests" / "data"


def import_sample_dataset(sample_key: str, db: Session) -> Dataset:
    """从本地 tests/data 复制示例 CSV 并创建数据集（无需联网）。"""
    key = sample_key.strip().lower()
    if key not in SAMPLE_DATASET_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"未知示例类型: {sample_key}，可选: {', '.join(SAMPLE_DATASET_FILES.keys())}",
        )
    filename = SAMPLE_DATASET_FILES[key]
    src = _sample_data_dir() / filename
    if not src.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"示例文件缺失: {filename}（请确认应用资源完整）",
        )
    content = src.read_bytes()
    return save_upload_file(content, filename, None, db)


# ── 内部工具 ──────────────────────────────────────────────────────────────────

def _dataset_path(filename: str) -> Path:
    return DATA_DIR / filename


def _detect_encoding(path: Path) -> str:
    """尝试多种编码，依次回退，返回可成功读取文件头的编码"""
    candidates = ["utf-8-sig", "utf-8", "gbk", "gb18030", "gb2312", "latin-1"]
    for enc in candidates:
        try:
            with open(path, encoding=enc, errors="strict") as f:
                f.read(4096)  # 只读前 4KB 用于探测
            return enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    return "latin-1"  # 最终回退，latin-1 不会抛出解码错误


def _load_df(dataset: Dataset) -> pd.DataFrame:
    """从磁盘加载数据集"""
    path = DATA_DIR / dataset.path
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"数据文件不存在: {dataset.path}")
    if dataset.file_type in ("xlsx", "xls"):
        return pd.read_excel(path, sheet_name=dataset.sheet_name or 0)
    enc = _detect_encoding(path)
    return pd.read_csv(path, encoding=enc, on_bad_lines='skip')


def _save_df(df: pd.DataFrame, filename: str) -> str:
    """保存 DataFrame 到 CSV，返回相对路径。
    xlsx/xls 自动转为同名 .csv，避免将 CSV 内容写入 xlsx 路径
    导致后续 pd.read_excel() 解析失败（特征工程 Network Error 根因）。"""
    stem = Path(filename).stem
    csv_filename = f"{stem}.csv"
    path = DATA_DIR / csv_filename
    df.to_csv(path, index=False, encoding="utf-8-sig")
    return csv_filename


# ── 上传 ──────────────────────────────────────────────────────────────────────
def save_upload_file(
    file_bytes: bytes,
    original_filename: str,
    sheet_name: Optional[str],
    db: Session,
) -> Dataset:
    """保存上传的数据文件并创建数据集记录。"""
    ext = original_filename.rsplit(".", 1)[-1].lower()
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail="仅支持 CSV / XLSX / XLS 格式，不支持其他文件类型")

    # 200MB 大小限制
    max_bytes = 200 * 1024 * 1024
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大（{len(file_bytes)//1024//1024}MB），最大支持 200MB",
        )

    unique_name = f"{uuid.uuid4().hex}.{ext}"
    save_path = DATA_DIR / unique_name
    save_path.write_bytes(file_bytes)

    # 读取基本信息并清理列名
    try:
        if ext in ("xlsx", "xls"):
            df = pd.read_excel(save_path, sheet_name=sheet_name or 0)
        else:
            enc = _detect_encoding(save_path)
            df = pd.read_csv(save_path, encoding=enc, on_bad_lines='skip')
    except Exception as e:
        save_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"文件解析失败，请确认文件格式正确且首行为标题行: {e}") from e

    # 清理列名：特殊字符和空格替换为下划线
    df.columns = [re.sub(r'[^\w]+', '_', str(c)).strip('_') for c in df.columns]
    if ext == 'csv':
        df.to_csv(save_path, index=False, encoding='utf-8-sig')

    dataset = Dataset(
        name=original_filename.rsplit(".", 1)[0],
        original_filename=original_filename,
        path=unique_name,
        file_type=ext,
        sheet_name=sheet_name,
        rows=len(df),
        cols=len(df.columns),
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 预览 ──────────────────────────────────────────────────────────────────────

def get_preview(dataset: Dataset, page: int, page_size: int) -> dict[str, Any]:
    """返回数据集分页预览结果。"""
    df = _load_df(dataset)
    total = len(df)
    start = (page - 1) * page_size
    end = start + page_size
    chunk = df.iloc[start:end]
    # 替换 NaN 为 None 以便 JSON 序列化
    records = chunk.where(pd.notnull(chunk), None).to_dict(orient="records")
    return {
        "columns": list(df.columns),
        "data": records,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ── 统计 ──────────────────────────────────────────────────────────────────────

def get_stats(dataset: Dataset) -> dict[str, Any]:
    """返回数据集列统计信息。"""
    df = _load_df(dataset)
    columns = []
    for col in df.columns:
        series = df[col]
        non_null = int(series.notna().sum())
        missing = int(series.isna().sum())
        is_numeric = pd.api.types.is_numeric_dtype(series)
        stat: dict[str, Any] = {
            "name": col,
            "dtype": str(series.dtype),
            "non_null": non_null,
            "missing": missing,
            "missing_rate": round(missing / len(df), 4) if len(df) > 0 else 0,
            "unique": int(series.nunique()),
        }
        if is_numeric:
            desc = series.describe()
            stat["mean"] = round(float(desc.get("mean", 0)), 4)
            stat["median"] = round(float(series.median()), 4)
            stat["std"] = round(float(desc.get("std", 0)), 4)
            stat["min"] = round(float(desc.get("min", 0)), 4)
            stat["max"] = round(float(desc.get("max", 0)), 4)
        columns.append(stat)
    return {"rows": len(df), "cols": len(df.columns), "columns": columns}


# ── 分布 ──────────────────────────────────────────────────────────────────────

def get_distribution(dataset: Dataset, column: str) -> dict[str, Any]:
    """返回指定列的分布数据（数值直方图或类别柱状图）。"""
    df = _load_df(dataset)
    if column not in df.columns:
        raise HTTPException(status_code=404, detail=f"列不存在: {column}")
    series = df[column].dropna()
    if pd.api.types.is_numeric_dtype(series):
        counts, bin_edges = np.histogram(series, bins=min(50, max(10, len(series) // 20)))
        return {
            "type": "histogram",
            "bins": [round(float(b), 4) for b in bin_edges],
            "counts": [int(c) for c in counts],
        }
    vc = series.value_counts().head(30)
    return {
        "type": "bar",
        "bins": list(vc.index.astype(str)),
        "counts": [int(c) for c in vc.values],
    }


# ── 缺失值热力图 ──────────────────────────────────────────────────────────────

def get_missing_pattern(dataset: Dataset) -> dict[str, Any]:
    """返回缺失值模式矩阵（最多抽样 200 行）。"""
    df = _load_df(dataset)
    sample = df if len(df) <= 200 else df.sample(200, random_state=42)
    matrix = sample.isna().astype(int).values.tolist()
    return {"columns": list(df.columns), "matrix": matrix}


# ── 预处理审计（持久化到 datasets.preprocessing_log_json）──────────────────────


def _append_preprocessing_log(dataset: Dataset, entry: dict[str, Any]) -> None:
    """追加一条预处理审计记录；调用方须在随后 db.commit 中一并提交。"""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    row = {"ts": ts, **entry}
    log: list[Any] = []
    raw = dataset.preprocessing_log_json
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                log = parsed
        except json.JSONDecodeError:
            pass
    log.append(row)
    dataset.preprocessing_log_json = json.dumps(log, ensure_ascii=False)


# ── 处理缺失值 ────────────────────────────────────────────────────────────────

def handle_missing(dataset: Dataset, config: dict[str, Any], db: Session) -> Dataset:
    """按列配置批量处理缺失值并持久化。"""
    df = _load_df(dataset)
    applied: dict[str, dict[str, Any]] = {}
    for col, cfg in config.items():
        if col not in df.columns:
            continue
        strategy = cfg.get("strategy", "none")
        fill_value = cfg.get("fill_value")
        if strategy == "none":
            continue
        if strategy == "mean":
            df[col] = df[col].fillna(df[col].mean())
        elif strategy == "median":
            df[col] = df[col].fillna(df[col].median())
        elif strategy == "mode":
            df[col] = df[col].fillna(df[col].mode().iloc[0] if not df[col].mode().empty else None)
        elif strategy == "constant":
            df[col] = df[col].fillna(fill_value)
        elif strategy == "drop":
            df = df.dropna(subset=[col])
        elif strategy == "knn":
            # KNN 填充（仅对数值列有效）
            try:
                numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
                if col in numeric_cols:
                    imputer = KNNImputer(n_neighbors=5)
                    df[numeric_cols] = imputer.fit_transform(df[numeric_cols])
            except (ImportError, ValueError, TypeError):
                fallback = (
                    df[col].mean()
                    if pd.api.types.is_numeric_dtype(df[col])
                    else (df[col].mode().iloc[0] if not df[col].mode().empty else None)
                )
                df[col] = df[col].fillna(fallback)
        else:
            continue
        applied[col] = {"strategy": strategy, "fill_value": fill_value}
    if applied:
        _append_preprocessing_log(
            dataset,
            {
                "kind": "missing_values",
                "summary": f"缺失值处理：已配置 {len(applied)} 列",
                "detail": {"per_column": applied, "rows_after": len(df)},
            },
        )
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.rows = len(df)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 异常值 ────────────────────────────────────────────────────────────────────

def get_outliers(dataset: Dataset) -> list[dict[str, Any]]:
    """检测并返回数值列异常值（3σ + IQR，最多 500 条）。"""
    df = _load_df(dataset)
    result = []
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 10:
            continue
        # 3σ
        mu, sigma = series.mean(), series.std()
        mask_sigma = (df[col] < mu - 3 * sigma) | (df[col] > mu + 3 * sigma)
        # IQR
        q1, q3 = series.quantile(0.25), series.quantile(0.75)
        iqr = q3 - q1
        mask_iqr = (df[col] < q1 - 1.5 * iqr) | (df[col] > q3 + 1.5 * iqr)
        mask = mask_sigma | mask_iqr
        for idx in df[mask].index:
            result.append({
                "row_index": int(idx),
                "column": col,
                "value": float(df.at[idx, col]),
                "reason": "3σ" if mask_sigma.iloc[idx] else "IQR",
            })
    return result[:500]  # 最多返回 500 条


def handle_outliers(dataset: Dataset, action: str, row_indices: list[int], db: Session) -> Dataset:
    """按行索引处理异常值（当前支持删除行）。"""
    df = _load_df(dataset)
    n_before = len(df)
    if action == "drop":
        valid_indices = [i for i in row_indices if i < len(df)]
        df = df.drop(index=valid_indices).reset_index(drop=True)
        _append_preprocessing_log(
            dataset,
            {
                "kind": "outliers_drop_rows",
                "summary": f"按索引删除疑似异常行：{len(valid_indices)} 行",
                "detail": {
                    "action": action,
                    "row_indices_sample": valid_indices[:80],
                    "rows_before": n_before,
                    "rows_after": len(df),
                },
            },
        )
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.rows = len(df)
    db.commit()
    db.refresh(dataset)
    return dataset


def handle_outliers_by_strategy(dataset: Dataset, strategy: str, db: Session) -> Dataset:
    """按策略（clip/drop/mean）批量处理全部数值列的异常值（IQR 方法）"""
    df = _load_df(dataset)
    n_before = len(df)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if strategy == "clip":
        for col in numeric_cols:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            df[col] = df[col].clip(lower=q1 - 1.5 * iqr, upper=q3 + 1.5 * iqr)
    elif strategy == "drop":
        masks = []
        for col in numeric_cols:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            mask = (df[col] < q1 - 1.5 * iqr) | (df[col] > q3 + 1.5 * iqr)
            masks.append(mask)
        if masks:
            combined = masks[0]
            for m in masks[1:]:
                combined = combined | m
            df = df[~combined].reset_index(drop=True)
    elif strategy == "mean":
        for col in numeric_cols:
            q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
            iqr = q3 - q1
            mask = (df[col] < q1 - 1.5 * iqr) | (df[col] > q3 + 1.5 * iqr)
            df.loc[mask, col] = df[col].mean()
    _append_preprocessing_log(
        dataset,
        {
            "kind": "outliers_strategy",
            "summary": f"数值列异常值（IQR）：策略 {strategy}",
            "detail": {
                "strategy": strategy,
                "numeric_columns": numeric_cols,
                "rows_before": n_before,
                "rows_after": len(df),
            },
        },
    )
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.rows = len(df)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 重复行 ────────────────────────────────────────────────────────────────────

def get_duplicates(dataset: Dataset) -> dict[str, Any]:
    """返回重复行数量及其索引。"""
    df = _load_df(dataset)
    dup_mask = df.duplicated()
    return {"count": int(dup_mask.sum()), "indices": df[dup_mask].index.tolist()}


def drop_duplicates(dataset: Dataset, db: Session) -> Dataset:
    """删除重复行并保存更新后的数据集。"""
    df = _load_df(dataset)
    n_before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    n_drop = n_before - len(df)
    if n_drop > 0:
        _append_preprocessing_log(
            dataset,
            {
                "kind": "drop_duplicates",
                "summary": f"删除完全重复行：{n_drop} 行",
                "detail": {"rows_before": n_before, "rows_after": len(df)},
            },
        )
    new_path = _save_df(df, dataset.path)
    dataset.path = new_path
    dataset.file_type = 'csv'
    dataset.rows = len(df)
    db.commit()
    db.refresh(dataset)
    return dataset


# ── 质量评分 ──────────────────────────────────────────────────────────────────

def get_quality_score(dataset: Dataset) -> dict[str, Any]:
    """计算数据质量评分及改进建议。"""
    df = _load_df(dataset)
    missing_rate = float(df.isna().mean().mean())
    dup_rate = float(df.duplicated().mean())
    # 异常值率（简单估算）
    numeric_df = df.select_dtypes(include=[np.number])
    if not numeric_df.empty:
        z_scores = ((numeric_df - numeric_df.mean()) / (numeric_df.std() + 1e-9)).abs()
        outlier_rate = float((z_scores > 3).any(axis=1).mean())
    else:
        outlier_rate = 0.0

    score = 100.0
    score -= missing_rate * 40
    score -= outlier_rate * 30
    score -= dup_rate * 30
    score = max(0.0, min(100.0, round(score, 1)))

    suggestions = []
    if missing_rate > 0.05:
        suggestions.append(f"缺失率 {missing_rate:.1%}，建议处理缺失值")
    if outlier_rate > 0.05:
        suggestions.append(f"异常值率 {outlier_rate:.1%}，建议检查并处理异常值")
    if dup_rate > 0.01:
        suggestions.append(f"重复率 {dup_rate:.1%}，建议删除重复行")
    if not suggestions:
        suggestions.append("数据质量良好")

    return {
        "score": score,
        "missing_rate": round(missing_rate, 4),
        "outlier_rate": round(outlier_rate, 4),
        "duplicate_rate": round(dup_rate, 4),
        "suggestions": suggestions,
    }


# ── 数据集划分 ────────────────────────────────────────────────────────────────

def split_dataset(
    dataset: Dataset,
    train_ratio: float,
    random_seed: int,
    stratify: bool,
    target_column: str,
    db: Session,
    split_strategy: str = "random",
    time_column: str | None = None,
) -> DatasetSplit:
    """按配置划分训练/测试集并落盘，返回划分记录。"""
    # pylint: disable=too-many-arguments,too-many-positional-arguments,too-many-locals

    df = _load_df(dataset)
    if target_column not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列不存在: {target_column}")

    if split_strategy == "time_series":
        if not time_column or time_column not in df.columns:
            raise HTTPException(
                status_code=400,
                detail="时间序列划分必须指定存在于数据表中的 time_column",
            )
        df = df.sort_values(by=time_column, na_position="first").reset_index(drop=True)
        n = len(df)
        if n < 10:
            raise HTTPException(status_code=400, detail="样本量过少，无法进行时间序列划分")
        n_train = max(1, int(n * train_ratio))
        n_train = min(n_train, n - 1)
        train_df = df.iloc[:n_train].copy()
        test_df = df.iloc[n_train:].copy()
    else:
        stratify_col = df[target_column] if stratify else None
        if stratify_col is not None:
            if pd.api.types.is_float_dtype(stratify_col) or (
                pd.api.types.is_integer_dtype(stratify_col) and stratify_col.nunique() > 20
            ):
                stratify_col = None
        try:
            train_df, test_df = train_test_split(
                df,
                train_size=train_ratio,
                random_state=random_seed,
                stratify=stratify_col,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"数据划分失败: {e}") from e

    base = dataset.path.rsplit(".", 1)[0]
    train_filename = f"{base}_train_{uuid.uuid4().hex[:8]}.csv"
    test_filename = f"{base}_test_{uuid.uuid4().hex[:8]}.csv"
    _save_df(train_df, train_filename)
    _save_df(test_df, test_filename)

    # 更新数据集目标列
    dataset.target_column = target_column
    db.commit()

    split = DatasetSplit(
        dataset_id=dataset.id,
        train_path=train_filename,
        test_path=test_filename,
        train_ratio=train_ratio,
        random_seed=random_seed,
        stratify=stratify,
        train_rows=len(train_df),
        test_rows=len(test_df),
        split_strategy=split_strategy,
        time_column=time_column if split_strategy == "time_series" else None,
    )
    db.add(split)
    db.commit()
    db.refresh(split)
    return split


def get_split_test_row(split_id: int, row_index: int, db: Session) -> dict[str, Any]:
    """
    读取划分对应测试集中一行，特征列与 training_service 一致：
    去掉目标列后的数值列，且取 train/test 数值列交集。
    """
    sp = db.query(DatasetSplit).filter(DatasetSplit.id == split_id).first()
    if not sp:
        raise HTTPException(status_code=404, detail=f"划分 {split_id} 不存在")
    dataset = db.query(Dataset).filter(Dataset.id == sp.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="数据集不存在")

    train_path = DATA_DIR / sp.train_path
    test_path = DATA_DIR / sp.test_path
    if not train_path.exists() or not test_path.exists():
        raise HTTPException(status_code=404, detail="训练/测试文件不存在")

    train_df = pd.read_csv(train_path, encoding="utf-8-sig")
    test_df = pd.read_csv(test_path, encoding="utf-8-sig")

    target_col = dataset.target_column
    if not target_col or target_col not in train_df.columns:
        target_col = train_df.columns[-1]

    total = len(test_df)
    if row_index < 0 or row_index >= total:
        raise HTTPException(
            status_code=400,
            detail=f"index 越界：有效范围为 0～{total - 1}" if total else "测试集为空",
        )

    X_train = train_df.drop(columns=[target_col]).select_dtypes(include=[np.number])
    X_test = test_df.drop(columns=[target_col], errors="ignore").select_dtypes(include=[np.number])
    common_cols = X_train.columns.intersection(X_test.columns)
    if len(common_cols) == 0:
        raise HTTPException(status_code=400, detail="训练/测试无数值特征列交集")

    X_test = X_test[list(common_cols)].fillna(0)
    feat_row = X_test.iloc[row_index]
    features = {str(k): float(feat_row[k]) for k in common_cols}

    target_val: Any = None
    if target_col in test_df.columns:
        raw = test_df.iloc[row_index][target_col]
        if pd.notna(raw):
            if isinstance(raw, (np.integer, np.floating)):
                target_val = float(raw)
            elif isinstance(raw, (int, float)):
                target_val = float(raw) if isinstance(raw, float) else int(raw)
            else:
                target_val = str(raw)

    return {
        "row_index": row_index,
        "total_rows": total,
        "features": features,
        "target": target_val,
    }
