"""
模型评估业务逻辑
"""
from __future__ import annotations

import json
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from fastapi import HTTPException
from sqlalchemy.orm import Session

from db.database import DATA_DIR, MODELS_DIR
from db.models import Model, DatasetSplit, Dataset


def _load_model_and_data(model_id: int, db: Session):
    model_rec = db.query(Model).filter(Model.id == model_id).first()
    if not model_rec:
        raise HTTPException(status_code=404, detail="模型不存在")

    model_path = MODELS_DIR / model_rec.path
    if not model_path.exists():
        raise HTTPException(status_code=404, detail="模型文件不存在")

    if model_rec.task_type == "classification":
        model = xgb.XGBClassifier()
    else:
        model = xgb.XGBRegressor()
    model.load_model(str(model_path))

    # 加载测试集
    split = db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first() if model_rec.split_id else None
    dataset = db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first() if model_rec.dataset_id else None
    target_col = dataset.target_column if dataset else None

    X_test, y_test = None, None
    if split:
        test_path = DATA_DIR / split.test_path
        if test_path.exists():
            test_df = pd.read_csv(test_path, encoding="utf-8-sig")
            if target_col and target_col in test_df.columns:
                X_test = test_df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
                y_test = test_df[target_col]

    return model, model_rec, X_test, y_test, target_col


def get_evaluation(model_id: int, db: Session) -> dict[str, Any]:
    from sklearn.metrics import (  # type: ignore
        confusion_matrix, roc_curve, auc,
        precision_recall_curve, average_precision_score,
    )
    from sklearn.calibration import calibration_curve  # type: ignore
    from sklearn.dummy import DummyClassifier, DummyRegressor  # type: ignore

    model, model_rec, X_test, y_test, _target_col = _load_model_and_data(model_id, db)
    base_metrics = json.loads(model_rec.metrics_json or "{}")
    result: dict[str, Any] = {"metrics": base_metrics, "task_type": model_rec.task_type}

    # ── 过拟合诊断（从训练时保存的指标中读取）──────────────────────────────────
    overfitting_level = base_metrics.get("overfitting_level")
    if overfitting_level:
        gap = base_metrics.get("overfitting_gap", 0)
        train_key = "train_accuracy" if model_rec.task_type == "classification" else "train_rmse"
        val_key = "accuracy" if model_rec.task_type == "classification" else "rmse"
        if overfitting_level == "high":
            msg = (
                f"⚠️ 检测到明显过拟合：训练集{val_key.upper()} "
                f"{base_metrics.get(train_key, ''):.4f} vs 验证集 {base_metrics.get(val_key, ''):.4f}，"
                f"差距 {abs(gap):.4f}。建议：降低 max_depth、增大 reg_lambda/reg_alpha、提高 subsample。"
            )
        elif overfitting_level == "medium":
            msg = (
                f"📊 轻微过拟合：训练/验证{val_key.upper()}差距 {abs(gap):.4f}，"
                "模型泛化能力尚可，可适当增加正则化。"
            )
        else:
            msg = "✅ 过拟合风险低：训练集与验证集指标接近，模型泛化能力良好。"
        result["overfitting_diagnosis"] = {
            "level": overfitting_level,
            "gap": gap,
            "message": msg,
            "early_stopped": base_metrics.get("early_stopped", False),
            "best_round": base_metrics.get("best_round"),
        }

    if X_test is None or y_test is None:
        return result

    if model_rec.task_type == "classification":
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)
        classes = model.classes_

        cm = confusion_matrix(y_test, y_pred)
        result["confusion_matrix"] = {
            "labels": [str(c) for c in classes],
            "matrix": cm.tolist(),
        }

        # ROC 曲线（二分类）
        if len(classes) == 2:
            fpr, tpr, _ = roc_curve(y_test, y_prob[:, 1])
            result["roc_curve"] = {
                "fpr": [round(float(x), 4) for x in fpr],
                "tpr": [round(float(x), 4) for x in tpr],
                "auc": round(float(auc(fpr, tpr)), 4),
            }

            # PR 曲线
            prec, rec, _ = precision_recall_curve(y_test, y_prob[:, 1])
            ap = float(average_precision_score(y_test, y_prob[:, 1]))
            result["pr_curve"] = {
                "precision": [round(float(v), 4) for v in prec],
                "recall": [round(float(v), 4) for v in rec],
                "ap": round(ap, 4),
            }

            # 校准曲线（5 桶）
            try:
                frac_pos, mean_pred = calibration_curve(y_test, y_prob[:, 1], n_bins=10)
                from sklearn.metrics import brier_score_loss  # type: ignore
                brier = float(brier_score_loss(y_test, y_prob[:, 1]))
                result["calibration"] = {
                    "mean_predicted": [round(float(v), 4) for v in mean_pred],
                    "fraction_positive": [round(float(v), 4) for v in frac_pos],
                    "brier_score": round(brier, 4),
                }
            except (ValueError, ImportError):
                pass

            # 阈值敏感性（Precision/Recall/F1 vs threshold）
            from sklearn.metrics import precision_score, recall_score, f1_score  # type: ignore
            thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
            thr_rows = []
            for thr in thresholds:
                y_t = (y_prob[:, 1] >= thr).astype(int)
                thr_rows.append({
                    "threshold": thr,
                    "precision": round(float(precision_score(y_test, y_t, zero_division=0)), 4),
                    "recall": round(float(recall_score(y_test, y_t, zero_division=0)), 4),
                    "f1": round(float(f1_score(y_test, y_t, zero_division=0)), 4),
                })
            result["threshold_metrics"] = thr_rows

            # 基线对比 (DummyClassifier most_frequent)
            dummy = DummyClassifier(strategy="most_frequent").fit(X_test, y_test)
            d_pred = dummy.predict(X_test)
            from sklearn.metrics import accuracy_score, f1_score as f1_fn  # type: ignore
            result["baseline"] = {
                "accuracy": round(float(accuracy_score(y_test, d_pred)), 4),
                "f1": round(float(f1_fn(y_test, d_pred, zero_division=0, average="macro")), 4),
                "strategy": "多数类预测（most_frequent）",
            }
    else:
        y_pred = model.predict(X_test)
        residuals = y_test - y_pred
        result["residuals"] = {
            "values": [round(float(r), 4) for r in residuals[:500]],
            "predicted": [round(float(p), 4) for p in y_pred[:500]],
            "actual": [round(float(a), 4) for a in y_test.values[:500]],
        }

        # 基线对比 (DummyRegressor mean)
        from sklearn.metrics import mean_squared_error, r2_score as r2_fn  # type: ignore
        dummy_r = DummyRegressor(strategy="mean").fit(X_test, y_test)
        d_pred_r = dummy_r.predict(X_test)
        result["baseline"] = {
            "rmse": round(float(np.sqrt(mean_squared_error(y_test, d_pred_r))), 4),
            "r2": round(float(r2_fn(y_test, d_pred_r)), 4),
            "strategy": "均值预测（mean）",
        }

    # SHAP 摘要（top-20）
    try:
        import shap  # type: ignore
        explainer = shap.TreeExplainer(model)
        sample = X_test if len(X_test) <= 200 else X_test.sample(200, random_state=42)
        shap_values = explainer.shap_values(sample)
        if isinstance(shap_values, list):
            shap_values = shap_values[1] if len(shap_values) > 1 else shap_values[0]
        importance = np.abs(shap_values).mean(axis=0)
        top_idx = np.argsort(importance)[::-1][:20]
        result["shap_summary"] = [
            {"feature": X_test.columns[i], "importance": round(float(importance[i]), 4)}
            for i in top_idx
        ]
    except (ImportError, ValueError, AttributeError):
        # SHAP 计算失败时用内置特征重要性
        try:
            fi = model.feature_importances_
            top_idx = np.argsort(fi)[::-1][:20]
            result["shap_summary"] = [
                {"feature": X_test.columns[i], "importance": round(float(fi[i]), 4)}
                for i in top_idx
            ]
        except (AttributeError, IndexError):
            pass

    return result


def compare_models(model_ids: list[int], db: Session) -> dict[str, Any]:
    """多模型对比，包含 McNemar 检验（二分类）"""
    models_data = []
    for mid in model_ids:
        rec = db.query(Model).filter(Model.id == mid).first()
        if not rec:
            continue
        models_data.append({
            "id": rec.id,
            "name": rec.name,
            "task_type": rec.task_type,
            "metrics": json.loads(rec.metrics_json or "{}"),
            "params": json.loads(rec.params_json or "{}"),
        })

    result: dict[str, Any] = {"models": models_data}

    # McNemar 检验：仅对二分类、正好两个模型有效
    if len(model_ids) == 2:
        try:
            r1 = db.query(Model).filter(Model.id == model_ids[0]).first()
            r2 = db.query(Model).filter(Model.id == model_ids[1]).first()
            if r1 and r2 and r1.task_type == "classification" == r2.task_type:
                m1, _, X1, y1, _ = _load_model_and_data(model_ids[0], db)
                m2, _, X2, _y2, _ = _load_model_and_data(model_ids[1], db)
                if X1 is not None and y1 is not None and X2 is not None:
                    common = X1.columns.intersection(X2.columns)
                    p1 = m1.predict(X1[common])
                    p2 = m2.predict(X2[common])
                    correct1 = (p1 == y1.values)
                    correct2 = (p2 == y1.values)
                    b = int(np.sum(correct1 & ~correct2))  # m1 对 m2 错
                    c = int(np.sum(~correct1 & correct2))  # m1 错 m2 对
                    n = b + c
                    if n > 0:
                        # McNemar 检验（刚性校正）
                        chi2 = (abs(b - c) - 1) ** 2 / n
                        # P 値近伧4：chi2分布（df=1），使用 survival function 近伧4
                        import math
                        p_value = round(math.exp(-chi2 / 2), 4)  # 近伧4公式
                        try:
                            from scipy.stats import chi2 as chi2_dist  # type: ignore
                            p_value = round(float(chi2_dist.sf(chi2, df=1)), 4)
                        except ImportError:
                            pass
                        better = models_data[0]["name"] if b < c else models_data[1]["name"]
                        result["mcnemar"] = {
                            "b": b, "c": c, "n": n,
                            "chi2": round(float(chi2), 4),
                            "p_value": p_value,
                            "significant": p_value < 0.05,
                            "interpretation": (
                                f"两模型预测差异{'\u663e\u8457' if p_value < 0.05 else '\u4e0d\u663e\u8457'}"
                                f"（p={p_value:.4f}）。"
                                + (f"建议选择「{better}」效果更佳。" if p_value < 0.05 else "")
                            ),
                        }
        except Exception:  # noqa
            pass

    return result


def get_shap_detail(model_id: int, db: Session) -> dict[str, Any]:
    import shap  # type: ignore

    model, _model_rec, X_test, _y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")

    sample = X_test if len(X_test) <= 100 else X_test.sample(100, random_state=42)
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(sample)
    if isinstance(shap_values, list):
        sv = shap_values[1] if len(shap_values) > 1 else shap_values[0]
    else:
        sv = shap_values

    return {
        "features": list(X_test.columns),
        "shap_values": sv.tolist(),
        "data": sample.values.tolist(),
        "base_value": float(explainer.expected_value) if not isinstance(explainer.expected_value, list)
                      else float(explainer.expected_value[1]),
    }


def get_learning_curve(model_id: int, db: Session) -> dict[str, Any]:
    """
    学习曲线：用存储的参数在不同训练集规模（20%~100%）下重新训练，
    返回 train_score 和 val_score 随样本量的变化趋势。
    仅使用训练集数据，交叉验证用 20% 内部验证集。
    """
    from sklearn.metrics import accuracy_score, mean_squared_error  # type: ignore

    model_rec = db.query(Model).filter(Model.id == model_id).first()
    if not model_rec:
        raise HTTPException(status_code=404, detail="模型不存在")

    split = db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first() if model_rec.split_id else None
    dataset = db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first() if model_rec.dataset_id else None
    if not split or not dataset:
        raise HTTPException(status_code=400, detail="无关联的数据集拆分信息")

    target_col = dataset.target_column
    train_path = DATA_DIR / split.train_path
    if not train_path.exists():
        raise HTTPException(status_code=400, detail="训练集文件不存在")

    df = pd.read_csv(train_path, encoding="utf-8-sig")
    if target_col not in df.columns:
        raise HTTPException(status_code=400, detail=f"目标列 {target_col} 不存在")

    X_full = df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
    y_full = df[target_col]

    params = json.loads(model_rec.params_json or "{}")
    # 去除内部字段和训练时用的冲突字段
    _SKIP = {"early_stopping_rounds", "eval_metric", "verbosity", "use_label_encoder"}
    clean_params = {k: v for k, v in params.items() if k not in _SKIP}

    task_type = model_rec.task_type
    train_sizes = [0.2, 0.4, 0.6, 0.8, 1.0]
    train_scores: list[float] = []
    val_scores: list[float] = []
    sample_counts: list[int] = []

    n = len(X_full)
    for frac in train_sizes:
        n_samples = max(10, int(n * frac))
        # 内部 80/20 划分
        idx = np.random.default_rng(42).permutation(n_samples)
        split_pt = int(n_samples * 0.8)
        tr_idx, vl_idx = idx[:split_pt], idx[split_pt:]

        X_tr = X_full.iloc[tr_idx]
        y_tr = y_full.iloc[tr_idx]
        X_vl = X_full.iloc[vl_idx]
        y_vl = y_full.iloc[vl_idx]

        if task_type == "classification":
            m = xgb.XGBClassifier(**clean_params, verbosity=0, eval_metric="logloss")
        else:
            m = xgb.XGBRegressor(**clean_params, verbosity=0, eval_metric="rmse")

        try:
            m.fit(X_tr, y_tr, eval_set=[(X_vl, y_vl)], verbose=False)
        except (TypeError, ValueError, RuntimeError):
            train_scores.append(0.0)
            val_scores.append(0.0)
            sample_counts.append(n_samples)
            continue

        if task_type == "classification":
            ts = float(accuracy_score(y_tr, m.predict(X_tr)))
            vs = float(accuracy_score(y_vl, m.predict(X_vl)))
        else:
            ts = float(np.sqrt(mean_squared_error(y_tr, m.predict(X_tr))))
            vs = float(np.sqrt(mean_squared_error(y_vl, m.predict(X_vl))))

        train_scores.append(round(ts, 4))
        val_scores.append(round(vs, 4))
        sample_counts.append(n_samples)

    metric_name = "Accuracy" if task_type == "classification" else "RMSE"
    return {
        "sample_counts": sample_counts,
        "train_sizes_pct": [int(f * 100) for f in train_sizes],
        "train_scores": train_scores,
        "val_scores": val_scores,
        "metric": metric_name,
        "task_type": task_type,
    }
