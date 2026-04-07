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


def _load_xy_train_test(model_rec: Model, db: Session):
    """
    加载划分上的训练集、测试集特征与标签（数值列对齐），供基线在训练集上 fit。
    与 training_service 一致：取 train/test 列交集。
    """
    split = (
        db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first()
        if model_rec.split_id
        else None
    )
    dataset = (
        db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first()
        if model_rec.dataset_id
        else None
    )
    if not split or not dataset:
        return None, None, None, None
    target_col = dataset.target_column
    train_path = DATA_DIR / split.train_path
    test_path = DATA_DIR / split.test_path
    if not train_path.exists() or not test_path.exists():
        return None, None, None, None
    train_df = pd.read_csv(train_path, encoding="utf-8-sig")
    test_df = pd.read_csv(test_path, encoding="utf-8-sig")
    if not target_col or target_col not in train_df.columns:
        target_col = train_df.columns[-1]
    X_train = train_df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
    y_train = train_df[target_col]
    X_test = test_df.drop(columns=[target_col], errors="ignore").select_dtypes(include=[np.number]).fillna(0)
    y_test = test_df[target_col] if target_col in test_df.columns else None
    common_cols = X_train.columns.intersection(X_test.columns)
    if len(common_cols) == 0:
        return None, None, None, None
    X_train = X_train[common_cols]
    X_test = X_test[common_cols]
    return X_train, y_train, X_test, y_test


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
    split_for_protocol = (
        db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first()
        if model_rec.split_id
        else None
    )
    strategy = getattr(split_for_protocol, "split_strategy", None) or "random"
    has_cv = bool(model_rec.cv_fold_metrics_json)
    notes_parts = [
        "当前测试集上的评估指标来自单次 hold-out 划分。",
    ]
    if has_cv:
        notes_parts.append(
            "训练阶段已在训练集上完成 K 折交叉验证，各折指标与均值/标准差见下方「训练期 K 折结果」。"
        )
    else:
        notes_parts.append(
            "若需对训练集做 K 折，可在训练时开启「K 折」或调用 POST /api/training/kfold。"
        )
    if strategy == "time_series":
        notes_parts.append(
            "当前数据划分按时间列升序：较早样本为训练集、较晚样本为测试集（降低时间泄漏风险）。"
        )
    result: dict[str, Any] = {
        "metrics": base_metrics,
        "task_type": model_rec.task_type,
        "evaluation_protocol": {
            "scheme": "single_holdout",
            "notes_zh": " ".join(notes_parts),
            "kfold_endpoint": "POST /api/training/kfold",
            "time_series_split_supported": True,
            "current_split_strategy": strategy,
            "current_split_is_time_ordered": strategy == "time_series",
        },
    }
    if has_cv:
        result["cv_kfold"] = {
            "k": model_rec.cv_k,
            "fold_metrics": json.loads(model_rec.cv_fold_metrics_json or "[]"),
            "summary": json.loads(model_rec.cv_summary_json or "{}"),
        }

    # ── 过拟合诊断（从训练时保存的指标中读取）──────────────────────────────────
    overfitting_level = base_metrics.get("overfitting_level")
    if overfitting_level:
        gap = base_metrics.get("overfitting_gap", 0)
        train_key = "train_accuracy" if model_rec.task_type == "classification" else "train_rmse"
        val_key = "accuracy" if model_rec.task_type == "classification" else "rmse"
        if overfitting_level == "high":
            msg = (
                f"检测到明显过拟合：训练集{val_key.upper()} "
                f"{base_metrics.get(train_key, ''):.4f} vs 验证集 {base_metrics.get(val_key, ''):.4f}，"
                f"差距 {abs(gap):.4f}。建议：降低 max_depth、增大 reg_lambda/reg_alpha、提高 subsample。"
            )
        elif overfitting_level == "medium":
            msg = (
                f"轻微过拟合：训练/验证{val_key.upper()}差距 {abs(gap):.4f}，"
                "模型泛化能力尚可，可适当增加正则化。"
            )
        else:
            msg = "过拟合风险低：训练集与验证集指标接近，模型泛化能力良好。"
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

            # 基线对比：仅在训练集上 fit Dummy，在测试集上评估（与可发表实践一致）
            X_tr, y_tr, _, _ = _load_xy_train_test(model_rec, db)
            from sklearn.metrics import accuracy_score, f1_score as f1_fn  # type: ignore
            if X_tr is not None and y_tr is not None:
                common = X_tr.columns.intersection(X_test.columns)
                X_tr_b = X_tr[common]
                X_te_b = X_test[common]
                dummy = DummyClassifier(strategy="most_frequent").fit(X_tr_b, y_tr)
                d_pred = dummy.predict(X_te_b)
                result["baseline"] = {
                    "accuracy": round(float(accuracy_score(y_test, d_pred)), 4),
                    "f1": round(float(f1_fn(y_test, d_pred, zero_division=0, average="macro")), 4),
                    "strategy": "多数类预测（most_frequent）",
                    "fit_scope": "train_only",
                }
            else:
                dummy = DummyClassifier(strategy="most_frequent").fit(X_test, y_test)
                d_pred = dummy.predict(X_test)
                result["baseline"] = {
                    "accuracy": round(float(accuracy_score(y_test, d_pred)), 4),
                    "f1": round(float(f1_fn(y_test, d_pred, zero_division=0, average="macro")), 4),
                    "strategy": "多数类预测（most_frequent）",
                    "fit_scope": "test_fallback",
                }
    else:
        y_pred = model.predict(X_test)
        residuals = y_test - y_pred
        result["residuals"] = {
            "values": [round(float(r), 4) for r in residuals[:500]],
            "predicted": [round(float(p), 4) for p in y_pred[:500]],
            "actual": [round(float(a), 4) for a in y_test.values[:500]],
        }

        # 基线：训练集上拟合均值策略，在测试集上评估
        from sklearn.metrics import mean_squared_error, r2_score as r2_fn  # type: ignore
        X_tr, y_tr, _, _ = _load_xy_train_test(model_rec, db)
        if X_tr is not None and y_tr is not None:
            common = X_tr.columns.intersection(X_test.columns)
            X_tr_b = X_tr[common]
            X_te_b = X_test[common]
            dummy_r = DummyRegressor(strategy="mean").fit(X_tr_b, y_tr)
            d_pred_r = dummy_r.predict(X_te_b)
            result["baseline"] = {
                "rmse": round(float(np.sqrt(mean_squared_error(y_test, d_pred_r))), 4),
                "r2": round(float(r2_fn(y_test, d_pred_r)), 4),
                "strategy": "均值预测（mean）",
                "fit_scope": "train_only",
            }
        else:
            dummy_r = DummyRegressor(strategy="mean").fit(X_test, y_test)
            d_pred_r = dummy_r.predict(X_test)
            result["baseline"] = {
                "rmse": round(float(np.sqrt(mean_squared_error(y_test, d_pred_r))), 4),
                "r2": round(float(r2_fn(y_test, d_pred_r)), 4),
                "strategy": "均值预测（mean）",
                "fit_scope": "test_fallback",
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


# ── G3-B：PDP / ICE 曲线 ──────────────────────────────────────────────────────

def get_pdp_ice(model_id: int, feature_name: str, db: Session) -> dict[str, Any]:
    """
    偏依赖图（PDP）与个体条件期望（ICE）曲线。
    PDP = 所有样本 ICE 曲线的均值，揭示特征对预测结果的边际影响趋势。
    ICE = 每条样本随特征取值变化的预测轨迹（最多返回 50 条）。
    使用测试集数据，网格点取 20 个等间距点。
    """
    model, model_rec, X_test, y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")
    if feature_name not in X_test.columns:
        raise HTTPException(status_code=400, detail=f"特征 '{feature_name}' 不在测试集中")

    # 采样（最多 200 样本计算 ICE，提高性能）
    sample = X_test if len(X_test) <= 200 else X_test.sample(200, random_state=42)
    grid_values = np.linspace(float(sample[feature_name].min()), float(sample[feature_name].max()), 20)

    ice_lines: list[list[float]] = []
    for _, row in sample.iterrows():
        row_preds: list[float] = []
        for val in grid_values:
            row_copy = row.copy()
            row_copy[feature_name] = val
            pred = model.predict(pd.DataFrame([row_copy]))[0]
            if model_rec.task_type == "classification" and hasattr(model, "predict_proba"):
                proba = model.predict_proba(pd.DataFrame([row_copy]))
                pred = float(proba[0][1]) if proba.shape[1] == 2 else float(proba[0].max())
            row_preds.append(round(float(pred), 4))
        ice_lines.append(row_preds)

    pdp_mean = [round(float(np.mean([line[i] for line in ice_lines])), 4) for i in range(len(grid_values))]
    pdp_std = [round(float(np.std([line[i] for line in ice_lines])), 4) for i in range(len(grid_values))]

    return {
        "feature": feature_name,
        "grid_values": [round(float(v), 4) for v in grid_values],
        "pdp_mean": pdp_mean,
        "pdp_std": pdp_std,
        "ice_lines": ice_lines[:50],  # 最多返回 50 条 ICE 曲线
        "n_samples_used": len(sample),
        "task_type": model_rec.task_type,
        "interpretation": f"PDP 显示特征 '{feature_name}' 对预测结果的边际影响：{'单调' if abs(pdp_mean[-1] - pdp_mean[0]) > 0.01 else '非单调'}趋势",
    }


# ── G3-B：OOT 跨时间集评估 ────────────────────────────────────────────────────

def get_oot_evaluation(model_id: int, oot_split_id: int, db: Session) -> dict[str, Any]:
    """
    OOT（Out-of-Time）跨时间集全维度评估。
    使用指定的 oot_split_id 作为 OOT 测试集，与原始测试集指标对比，
    量化模型的时间衰减幅度与外推准确性。
    """
    from sklearn.metrics import (  # type: ignore
        accuracy_score, f1_score, roc_auc_score,
        mean_squared_error, r2_score, mean_absolute_error,
    )

    model, model_rec, X_test_orig, y_test_orig, _ = _load_model_and_data(model_id, db)

    # 加载 OOT 数据集
    oot_split = db.query(DatasetSplit).filter(DatasetSplit.id == oot_split_id).first()
    if not oot_split:
        raise HTTPException(status_code=404, detail=f"OOT split {oot_split_id} 不存在")

    dataset = db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first() if model_rec.dataset_id else None
    target_col = dataset.target_column if dataset else None

    oot_test_path = DATA_DIR / oot_split.test_path
    if not oot_test_path.exists():
        raise HTTPException(status_code=404, detail="OOT 测试集文件不存在")

    oot_df = pd.read_csv(oot_test_path, encoding="utf-8-sig")
    if not target_col or target_col not in oot_df.columns:
        raise HTTPException(status_code=400, detail="OOT 数据集缺少目标列")

    X_oot = oot_df.drop(columns=[target_col]).select_dtypes(include=[np.number]).fillna(0)
    y_oot = oot_df[target_col]

    # 对齐列
    common_cols = X_test_orig.columns.intersection(X_oot.columns) if X_test_orig is not None else X_oot.columns
    X_oot = X_oot[common_cols]

    def _compute_eval_metrics(model, X, y, task_type):
        metrics: dict[str, Any] = {}
        if task_type == "classification":
            y_pred = model.predict(X)
            metrics["accuracy"] = round(float(accuracy_score(y, y_pred)), 4)
            metrics["f1"] = round(float(f1_score(y, y_pred, average="weighted", zero_division=0)), 4)
            if hasattr(model, "predict_proba") and y.nunique() == 2:
                y_prob = model.predict_proba(X)[:, 1]
                try:
                    metrics["auc"] = round(float(roc_auc_score(y, y_prob)), 4)
                except Exception:
                    pass
        else:
            y_pred = model.predict(X)
            metrics["rmse"] = round(float(np.sqrt(mean_squared_error(y, y_pred))), 4)
            metrics["mae"] = round(float(mean_absolute_error(y, y_pred)), 4)
            metrics["r2"] = round(float(r2_score(y, y_pred)), 4)
        return metrics

    orig_metrics = _compute_eval_metrics(model, X_test_orig[common_cols] if X_test_orig is not None else X_oot, y_test_orig if y_test_orig is not None else y_oot, model_rec.task_type) if X_test_orig is not None else {}
    oot_metrics = _compute_eval_metrics(model, X_oot, y_oot, model_rec.task_type)

    # 计算时间衰减
    degradation: dict[str, float] = {}
    for key in oot_metrics:
        if key in orig_metrics:
            orig_val = orig_metrics[key]
            oot_val = oot_metrics[key]
            if key in ("accuracy", "f1", "auc", "r2"):
                degradation[key] = round(orig_val - oot_val, 4)  # 正值表示衰减
            else:  # rmse, mae - 越小越好
                degradation[key] = round(oot_val - orig_val, 4)  # 正值表示恶化

    return {
        "model_id": model_id,
        "oot_split_id": oot_split_id,
        "original_test_metrics": orig_metrics,
        "oot_metrics": oot_metrics,
        "degradation": degradation,
        "oot_n_samples": int(len(y_oot)),
        "task_type": model_rec.task_type,
        "interpretation": _interpret_oot_degradation(degradation, model_rec.task_type),
    }


def _interpret_oot_degradation(degradation: dict[str, float], task_type: str) -> str:
    if not degradation:
        return "无法计算时间衰减（缺少原始测试集数据）"
    primary_key = "auc" if "auc" in degradation else ("accuracy" if "accuracy" in degradation else "rmse")
    deg = degradation.get(primary_key, 0)
    if abs(deg) < 0.01:
        return f"模型在 OOT 集上性能稳定（{primary_key} 衰减 {deg:.4f}），可正常部署"
    elif abs(deg) < 0.05:
        return f"模型在 OOT 集上有轻微衰减（{primary_key} 衰减 {deg:.4f}），建议关注后续时间点的稳定性"
    else:
        return f"模型在 OOT 集上有明显衰减（{primary_key} 衰减 {deg:.4f}），建议重新评估模型适用期或重训练"


# ── G3-B：鲁棒性压力测试 ──────────────────────────────────────────────────────

def get_robustness_test(model_id: int, test_type: str, db: Session) -> dict[str, Any]:
    """
    鲁棒性压力测试（三类）：
    - feature_perturbation：对核心特征加入高斯噪声、提升缺失率，测试准确性衰减
    - sample_perturbation：随机剔除/替换部分训练样本，重新训练，测试稳定性
    - extreme：测试极端值样本中的预测准确性
    """
    from sklearn.metrics import accuracy_score, mean_squared_error  # type: ignore

    VALID_TYPES = {"feature_perturbation", "sample_perturbation", "extreme"}
    if test_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"test_type 必须为 {VALID_TYPES} 之一")

    model, model_rec, X_test, y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None or y_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")

    task_type = model_rec.task_type
    params = json.loads(model_rec.params_json or "{}")

    def _score(X, y):
        y_pred = model.predict(X)
        if task_type == "classification":
            return round(float(accuracy_score(y, y_pred)), 4)
        else:
            return round(float(np.sqrt(mean_squared_error(y, y_pred))), 4)

    baseline_score = _score(X_test, y_test)
    metric_name = "accuracy" if task_type == "classification" else "rmse"
    results: list[dict[str, Any]] = []

    if test_type == "feature_perturbation":
        # 对每个特征施加高斯噪声（std = 特征标准差的 10%/50%/100%）
        for noise_level in [0.1, 0.5, 1.0]:
            X_perturbed = X_test.copy()
            for col in X_test.columns:
                std = float(X_test[col].std()) or 1.0
                X_perturbed[col] = X_test[col] + np.random.normal(0, std * noise_level, len(X_test))
            perturbed_score = _score(X_perturbed, y_test)
            degrade = baseline_score - perturbed_score if task_type == "classification" else perturbed_score - baseline_score
            results.append({
                "perturbation": f"高斯噪声 σ={noise_level}×std",
                metric_name: perturbed_score,
                "degradation": round(degrade, 4),
                "severity": "高风险" if abs(degrade) > 0.05 else ("中等" if abs(degrade) > 0.02 else "稳定"),
            })

        # 随机缺失测试
        for missing_rate in [0.1, 0.3]:
            X_missing = X_test.copy()
            mask = np.random.random(X_missing.shape) < missing_rate
            X_missing = X_missing.mask(pd.DataFrame(mask, columns=X_missing.columns), 0)
            missing_score = _score(X_missing, y_test)
            degrade = baseline_score - missing_score if task_type == "classification" else missing_score - baseline_score
            results.append({
                "perturbation": f"随机缺失 {int(missing_rate*100)}%",
                metric_name: missing_score,
                "degradation": round(degrade, 4),
                "severity": "高风险" if abs(degrade) > 0.05 else ("中等" if abs(degrade) > 0.02 else "稳定"),
            })

    elif test_type == "sample_perturbation":
        # 随机剔除 10%/30% 测试样本
        for drop_rate in [0.1, 0.3]:
            n_drop = max(1, int(len(X_test) * drop_rate))
            idx = np.random.choice(len(X_test), size=len(X_test) - n_drop, replace=False)
            X_sub = X_test.iloc[idx]
            y_sub = y_test.iloc[idx]
            sub_score = _score(X_sub, y_sub)
            degrade = baseline_score - sub_score if task_type == "classification" else sub_score - baseline_score
            results.append({
                "perturbation": f"随机剔除 {int(drop_rate*100)}% 样本",
                metric_name: sub_score,
                "degradation": round(degrade, 4),
                "severity": "高风险" if abs(degrade) > 0.05 else ("中等" if abs(degrade) > 0.02 else "稳定"),
            })

    elif test_type == "extreme":
        # 测试极端值样本（IQR 3 倍外）
        extreme_mask = pd.Series([False] * len(X_test))
        for col in X_test.columns:
            q1, q3 = X_test[col].quantile(0.25), X_test[col].quantile(0.75)
            iqr = q3 - q1
            extreme_mask = extreme_mask | (X_test[col] < q1 - 3 * iqr) | (X_test[col] > q3 + 3 * iqr)
        X_extreme = X_test[extreme_mask]
        y_extreme = y_test[extreme_mask]

        if len(X_extreme) >= 5:
            extreme_score = _score(X_extreme, y_extreme)
            degrade = baseline_score - extreme_score if task_type == "classification" else extreme_score - baseline_score
            results.append({
                "perturbation": f"极端值样本（IQR 3倍外，{len(X_extreme)} 个）",
                metric_name: extreme_score,
                "degradation": round(degrade, 4),
                "severity": "高风险" if abs(degrade) > 0.1 else ("中等" if abs(degrade) > 0.05 else "稳定"),
            })

            # 正常样本对比
            X_normal = X_test[~extreme_mask]
            y_normal = y_test[~extreme_mask]
            if len(X_normal) >= 5:
                normal_score = _score(X_normal, y_normal)
                results.append({
                    "perturbation": f"正常样本（非极端值，{len(X_normal)} 个）",
                    metric_name: normal_score,
                    "degradation": 0.0,
                    "severity": "基准",
                })
        else:
            results.append({
                "perturbation": "极端值样本",
                "note": f"极端值样本数量不足（仅 {len(X_extreme)} 个，需 >= 5）",
                "severity": "样本不足",
            })

    return {
        "model_id": model_id,
        "test_type": test_type,
        "baseline_score": baseline_score,
        "metric": metric_name,
        "task_type": task_type,
        "perturbation_results": results,
        "overall_robustness": _assess_overall_robustness(results),
        "n_test_samples": int(len(X_test)),
    }


def _assess_overall_robustness(results: list[dict[str, Any]]) -> str:
    if not results:
        return "无法评估"
    severities = [r.get("severity", "稳定") for r in results]
    if "高风险" in severities:
        return "高风险：模型对扰动敏感，生产环境部署需谨慎"
    elif "中等" in severities:
        return "中等：模型对中等扰动有一定敏感性，建议监控生产数据分布"
    else:
        return "稳定：模型鲁棒性良好，对常见扰动不敏感"


# ── G3-B：坏样本根因诊断 ──────────────────────────────────────────────────────

def get_bad_sample_diagnosis(model_id: int, db: Session) -> dict[str, Any]:
    """
    FP/FN 坏样本自动聚类根因诊断。
    - 识别假阳性（FP）和假阴性（FN）样本
    - 对坏样本进行 K-Means 聚类，发现共性特征
    - 与正常样本分布对比，输出根因分析与优化建议
    仅支持分类任务。
    """
    from sklearn.cluster import KMeans  # type: ignore

    model, model_rec, X_test, y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None or y_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")
    if model_rec.task_type != "classification":
        raise HTTPException(status_code=400, detail="坏样本诊断仅支持分类任务")

    y_pred = model.predict(X_test)
    y_true = y_test.values

    # 识别 FP / FN
    fp_mask = (y_pred == 1) & (y_true == 0)
    fn_mask = (y_pred == 0) & (y_true == 1)
    correct_mask = (y_pred == y_true)

    X_fp = X_test[fp_mask]
    X_fn = X_test[fn_mask]
    X_correct = X_test[correct_mask]

    bad_types: list[dict[str, Any]] = []

    for label, X_bad, description in [
        ("FP（假阳性）", X_fp, "模型预测为正但实际为负"),
        ("FN（假阴性）", X_fn, "模型预测为负但实际为正"),
    ]:
        if len(X_bad) < 3:
            bad_types.append({
                "type": label,
                "description": description,
                "count": len(X_bad),
                "clusters": [],
                "common_features": [],
                "root_causes": [f"{label} 样本数量不足（{len(X_bad)} 个）"],
            })
            continue

        # K-Means 聚类（最多 3 类）
        n_clusters = min(3, len(X_bad))
        try:
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            cluster_labels = kmeans.fit_predict(X_bad.fillna(0))
        except Exception:
            cluster_labels = np.zeros(len(X_bad), dtype=int)

        # 与正常样本的特征均值对比
        normal_means = X_correct.mean()
        bad_means = X_bad.mean()
        diff = (bad_means - normal_means).abs().sort_values(ascending=False)
        top_diff_features = diff.head(5).index.tolist()

        # 每个聚类的特征均值
        clusters_info = []
        for c_id in range(n_clusters):
            c_mask = cluster_labels == c_id
            c_data = X_bad[c_mask]
            if len(c_data) == 0:
                continue
            c_means = c_data.mean()
            top_features = {col: round(float(c_means[col]), 4) for col in top_diff_features if col in c_means}
            clusters_info.append({
                "cluster_id": int(c_id),
                "count": int(c_mask.sum()),
                "pct_of_bad": round(float(c_mask.sum() / len(X_bad) * 100), 1),
                "top_feature_means": top_features,
            })

        # 根因分析
        root_causes = []
        for feat in top_diff_features:
            bad_val = float(bad_means.get(feat, 0))
            norm_val = float(normal_means.get(feat, 0))
            direction = "偏高" if bad_val > norm_val else "偏低"
            root_causes.append(
                f"特征 '{feat}' 在 {label} 样本中{direction}（均值 {bad_val:.3f} vs 正常 {norm_val:.3f}），"
                f"可能是预测失效的重要根因"
            )

        bad_types.append({
            "type": label,
            "description": description,
            "count": int(len(X_bad)),
            "pct_of_test": round(len(X_bad) / len(X_test) * 100, 1),
            "clusters": clusters_info,
            "top_diff_features": top_diff_features,
            "common_features": [{"feature": f, "bad_mean": round(float(bad_means.get(f, 0)), 4), "normal_mean": round(float(normal_means.get(f, 0)), 4)} for f in top_diff_features],
            "root_causes": root_causes,
        })

    # 综合优化建议
    fp_count = len(X_fp)
    fn_count = len(X_fn)
    recommendations = []
    if fp_count > fn_count * 2:
        recommendations.append("FP 率偏高：建议提高判断阈值（当前 0.5），或增加负样本训练数据")
    elif fn_count > fp_count * 2:
        recommendations.append("FN 率偏高：建议降低判断阈值，或增加正样本训练数据（考虑 scale_pos_weight）")
    if X_fp.columns.tolist():
        recommendations.append("对 FP/FN 高发的特征区间进行业务核查，确认标签质量")

    return {
        "model_id": model_id,
        "task_type": model_rec.task_type,
        "total_test_samples": int(len(X_test)),
        "fp_count": int(fp_count),
        "fn_count": int(fn_count),
        "correct_count": int(correct_mask.sum()),
        "error_rate": round((fp_count + fn_count) / len(X_test) * 100, 2),
        "bad_sample_analysis": bad_types,
        "recommendations": recommendations,
    }


# ── G3-B：算法公平性分析 ──────────────────────────────────────────────────────

def get_fairness_analysis(model_id: int, group_col: str, db: Session) -> dict[str, Any]:
    """
    算法公平性分析：按分组字段计算不同组别的预测准确性偏差，
    验证模型无歧视性预测偏差。
    同时计算：各组预测率差异（DPD）、真阳率差异（TPR_gap）。
    """
    from sklearn.metrics import accuracy_score, f1_score  # type: ignore

    model, model_rec, X_test, y_test, _ = _load_model_and_data(model_id, db)
    if X_test is None or y_test is None:
        raise HTTPException(status_code=400, detail="无测试数据")

    # 加载原始测试集（含分组列）
    split = db.query(DatasetSplit).filter(DatasetSplit.id == model_rec.split_id).first() if model_rec.split_id else None
    if not split:
        raise HTTPException(status_code=400, detail="无关联的数据集划分")
    dataset = db.query(Dataset).filter(Dataset.id == model_rec.dataset_id).first() if model_rec.dataset_id else None
    target_col = dataset.target_column if dataset else None
    test_path = DATA_DIR / split.test_path
    test_df = pd.read_csv(test_path, encoding="utf-8-sig")

    if group_col not in test_df.columns:
        raise HTTPException(status_code=400, detail=f"分组列 '{group_col}' 不在测试集中")

    groups_series = test_df[group_col]
    y_pred = model.predict(X_test)
    groups_unique = groups_series.unique()

    group_metrics: list[dict[str, Any]] = []
    for grp in groups_unique:
        grp_mask = groups_series == grp
        X_grp = X_test[grp_mask.values]
        y_grp = y_test[grp_mask.values]

        if len(X_grp) < 5:
            continue

        y_grp_pred = model.predict(X_grp)
        g_metrics: dict[str, Any] = {"group": str(grp), "n": int(len(X_grp))}

        if model_rec.task_type == "classification":
            g_metrics["accuracy"] = round(float(accuracy_score(y_grp, y_grp_pred)), 4)
            g_metrics["f1"] = round(float(f1_score(y_grp, y_grp_pred, average="weighted", zero_division=0)), 4)
            g_metrics["positive_rate"] = round(float((y_grp_pred == 1).mean()), 4) if 1 in y_grp_pred else 0.0
            if 1 in y_grp.values:
                tpr_mask = y_grp == 1
                g_metrics["tpr"] = round(float((y_grp_pred[tpr_mask.values] == 1).mean()), 4) if tpr_mask.any() else 0.0
        else:
            from sklearn.metrics import mean_squared_error, r2_score  # type: ignore
            y_grp_pred_r = model.predict(X_grp)
            g_metrics["rmse"] = round(float(np.sqrt(mean_squared_error(y_grp, y_grp_pred_r))), 4)
            g_metrics["r2"] = round(float(r2_score(y_grp, y_grp_pred_r)), 4)

        group_metrics.append(g_metrics)

    # 计算组间偏差
    if len(group_metrics) >= 2:
        primary_metric = "accuracy" if model_rec.task_type == "classification" else "rmse"
        scores = [g.get(primary_metric, 0) for g in group_metrics]
        max_gap = round(float(max(scores) - min(scores)), 4)
        worst_group = group_metrics[scores.index(min(scores) if primary_metric == "accuracy" else max(scores))]
        best_group = group_metrics[scores.index(max(scores) if primary_metric == "accuracy" else min(scores))]
        fairness_gap = max_gap

        if model_rec.task_type == "classification":
            pos_rates = [g.get("positive_rate", 0) for g in group_metrics]
            dpd = round(float(max(pos_rates) - min(pos_rates)), 4)
            fairness_concern = "高" if dpd > 0.1 or max_gap > 0.1 else ("中" if dpd > 0.05 or max_gap > 0.05 else "低")
        else:
            dpd = None
            fairness_concern = "高" if max_gap > 0.2 else ("中" if max_gap > 0.1 else "低")

        interpretation = (
            f"最佳组别「{best_group['group']}」vs 最差组别「{worst_group['group']}」"
            f"的 {primary_metric} 差距为 {max_gap:.4f}，公平性风险：{fairness_concern}"
        )
    else:
        dpd = None
        fairness_concern = "无法评估"
        interpretation = "组别数量不足，无法评估公平性"

    return {
        "model_id": model_id,
        "group_column": group_col,
        "task_type": model_rec.task_type,
        "group_metrics": group_metrics,
        "fairness_gap": max_gap if len(group_metrics) >= 2 else None,
        "demographic_parity_difference": dpd,
        "fairness_concern": fairness_concern,
        "interpretation": interpretation,
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
    # 按任务类型清理参数，防止跨类型参数导致训练静默失败
    if task_type == "regression":
        clean_params.pop("num_class", None)
        if str(clean_params.get("objective", "")).startswith(("multi:", "softmax", "softprob")):
            clean_params.pop("objective", None)
    elif task_type == "classification":
        n_classes = int(y_full.nunique())
        if n_classes > 2 and "num_class" not in clean_params:
            clean_params["num_class"] = n_classes
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
