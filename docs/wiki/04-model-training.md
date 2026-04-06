# XGBoost Studio · 模型训练流程

> **版本对应**：v0.4.x（训练主路径不变；编排侧复用同步训练入口）  
> **最后更新**：2026-04-06  
> **对应代码**：`server/services/training_service.py`、`server/routers/training.py`、`client/src/pages/ModelTraining/`

---

## 一、训练全流程

```
选择数据集划分（split_id）
    │
    ▼
配置训练参数（手动 / 向导推荐 / 从调优结果导入）
    │
    ▼
可选：启用 K 折交叉验证（K=2～10，仅对训练集）
    │
    ▼
启动训练（POST /api/training/start）
    │
    ▼
SSE 实时进度推送（每轮迭代的 train/val 损失与指标）
    │
    ▼
早停触发 / 达到最大轮数
    │
    ▼
模型评估指标计算（train + test）
    │
    ▼
过拟合诊断（偏差量化 → low/medium/high）
    │
    ▼
模型注册（写入 SQLite models 表，生成运行档案）
    │
    ▼
activeModelId 更新 → 自动导航至评估页
```

---

## 二、数据集划分策略

### 随机划分（Random Split）

```
完整数据集（N 行）
    │
    ├──── 训练集（80% 默认，可配置）：随机抽样
    └──── 测试集（20%）：随机抽样
```

支持**分层采样**（`stratify=True`）：保持训练集/测试集中目标类别比例一致，适合不均衡分类任务。

### 时间序列划分（Time Series Split）

**使用场景**：当数据有时间属性，必须避免"用未来预测过去"的穿越问题。

```
按时间列升序排列数据
    │
    ├──── 训练集（前 80%）：时间较早的数据
    └──── 测试集（后 20%）：时间较晚的数据（模拟上线评分场景）
```

**关键配置**：需指定 `time_column`（可排序的时间/日期列名）。

时间序列划分还会标记 `split_strategy = "time_series"`，在评估页会显示"时间隔离划分"提示，提醒用户测试集代表未来时间窗口。

---

## 三、任务类型自动判断

| 目标列特征 | 判断结果 | 使用的 XGBoost 类 |
|-----------|----------|-------------------|
| 唯一值 ≤ 20（整数型） | 分类（classification） | `XGBClassifier` |
| 唯一值 > 20 或浮点型 | 回归（regression） | `XGBRegressor` |

任务类型影响：损失函数、评估指标、早停指标（`logloss` vs `rmse`）、基线模型类型。

---

## 四、K 折交叉验证

K 折仅在**训练集**上执行，用于评估模型在训练数据内的泛化能力（与最终的 hold-out 测试集评估互补）。

### 使用场景

- 训练集样本量较少，单次 hold-out 评估方差较大
- 需要获得更稳健的指标均值和方差（如用于论文或高置信度决策）
- 配合 `scale_pos_weight` 检验不均衡处理效果

### 核心输出

```json
{
  "cv_k": 5,
  "fold_metrics": [
    {"fold": 1, "accuracy": 0.82, "auc": 0.88},
    {"fold": 2, "accuracy": 0.79, "auc": 0.86},
    ...
  ],
  "summary": {
    "accuracy_mean": 0.81,
    "accuracy_std": 0.015,
    "auc_mean": 0.87,
    "auc_std": 0.012
  }
}
```

**>2σ 高亮规则**：某折指标与均值偏差超过 2 倍标准差时，界面高亮显示，提示该折可能包含分布异常的样本。

---

## 五、训练参数关键说明

### 树结构参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `n_estimators` | 200 | 树棵数上限（早停会提前终止） |
| `max_depth` | 6 | 单棵树最大深度，增大提升拟合力但增加过拟合风险 |
| `min_child_weight` | 1 | 叶节点最小样本权重和，增大防过拟合 |
| `gamma` | 0 | 节点分裂最小损失减少量，增大趋向保守树结构 |

### 学习参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `learning_rate` | 0.1 | 学习率（eta），与 `n_estimators` 成反比权衡 |
| `early_stopping_rounds` | 20 | 连续 N 轮验证指标无改善时停止训练 |

### 采样参数（防过拟合）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `subsample` | 0.8 | 每轮训练的行采样比例 |
| `colsample_bytree` | 0.8 | 每棵树的列采样比例 |

### 正则化参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `reg_alpha` | 0 | L1 正则化系数，趋向稀疏权重 |
| `reg_lambda` | 1 | L2 正则化系数，控制权重幅度 |

---

## 六、过拟合诊断

训练结束后自动计算训练集与测试集指标的偏差，并给出诊断结论：

```
训练集指标（accuracy/rmse）
测试集指标（accuracy/rmse）
    │
    ▼
偏差 gap = |train_score - test_score|
    │
    ├── gap < 0.05 → low（低风险）：模型泛化能力良好
    ├── gap 0.05～0.1 → medium（中等）：建议适当增加正则化
    └── gap > 0.1 → high（高风险）：明显过拟合，建议降低 max_depth / 增大正则化
```

**处置建议**（high 级别）：降低 `max_depth`、增大 `reg_lambda/reg_alpha`、提高 `subsample`、降低 `learning_rate + 增大 n_estimators`。

---

## 七、运行档案（Provenance）

每个训练完成的模型自动生成运行档案，记录完整的可复现信息：

```json
{
  "dataset_id": 1,
  "split_id": 1,
  "split_random_seed": 42,
  "split_strategy": "random",
  "params_final": { "n_estimators": 200, "max_depth": 6, ... },
  "metrics": { "accuracy": 0.83, "auc": 0.88 },
  "source": "training",
  "xgboost_version": "2.1.x",
  "python_version": "3.12.x"
}
```

通过 `GET /api/models/{id}/provenance` 可完整获取，满足审计与可复现性要求。

---

## 八、编排复用：`train_and_persist_sync`

向导 **Step 0 全自动建模（AutoML）** 与部分后台编排需要「一次调用内完成训练并写入 `models` 表」，且不依赖交互式 `TrainingTask` 记录。实现为 `training_service.train_and_persist_sync`（与常规 `POST /api/training/start` + SSE 路径共享核心拟合逻辑，持久化与指标口径一致）。

能力边界、API 与前端入口见 [`08-automl-wizard.md`](08-automl-wizard.md)。

---

## 九、SSE 进度事件格式

```typescript
// 每轮迭代推送
{
  "round": 50,
  "total": 200,
  "train_logloss": 0.312,
  "val_logloss": 0.345,
  "elapsed_s": 3.2
}

// 训练完成
{
  "completed": true,
  "model_id": 5,
  "metrics": { "accuracy": 0.83, "auc": 0.88 }
}
```

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.4.x | 新增 `train_and_persist_sync` 供 AutoML/编排同步落库；早停等与 XGBoost 3.x 参数方式对齐（见实现代码） |
| v0.3.0 | 无大变更（训练核心逻辑稳定） |
| v0.2.0 | G2-Auth-2：K折持久化 + `cv_*` 字段 + AC-6-03 通过；G2-Auth-1：运行档案（provenance）落地 |
