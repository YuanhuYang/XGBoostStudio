# XGBoost Studio · 5 阶段分层调优

> **版本对应**：v0.5.x（5 阶段主路径不变；新增 AutoML 预算内轻量搜索入口）  
> **最后更新**：2026-04-06  
> **对应代码**：`server/services/tuning_service.py`、`client/src/pages/ModelTuning/`

---

## 设计理念

XGBoost Studio 的调优**不是暴力搜索**，而是**遵循专家级调优逻辑的分层搜索**：

- 每次只调一组参数，其余固定，大幅缩减搜索空间
- 每阶段结束后锁定最优参数传入下一阶段，决策链完整可追溯
- 5 阶段顺序对应 XGBoost 参数间的依赖关系（先确定规模，再优化结构，再控方差，再控过拟合）

**核心价值**：任何人拿到调优记录，都能 100% 还原"为什么选这个参数值"的决策逻辑。

---

## 一、5 阶段总览

```
阶段 1：迭代次数与学习率基准调优
    │  参数：n_estimators, learning_rate
    │  目标：确定基础收敛轮数和学习率，建立调优基准线
    │  结束后：锁定最优 n_estimators + learning_rate ──►
    │
阶段 2：树结构复杂度调优
    │  参数：max_depth, min_child_weight, gamma
    │  目标：平衡偏差与方差，优化模型表达能力
    │  结束后：在阶段1基础上锁定最优树结构参数 ──►
    │
阶段 3：采样策略调优
    │  参数：subsample, colsample_bytree, colsample_bylevel
    │  目标：降低模型方差，提升泛化能力
    │  结束后：在前两阶段基础上锁定最优采样参数 ──►
    │
阶段 4：正则化参数调优
    │  参数：reg_alpha（L1）, reg_lambda（L2）
    │  目标：控制过拟合，减少权重幅度
    │  结束后：在前三阶段基础上锁定最优正则化参数 ──►
    │
阶段 5：精细化收尾调优
       参数：n_estimators（更宽范围）, learning_rate（更小范围 0.001-0.05）
       目标：降低学习率后重新确定最优迭代轮数，通常带来 0.5-2% 额外提升
       结束后：全局最优参数确定，训练最终模型
```

---

## 二、每阶段详细说明

### 阶段 1：迭代次数与学习率基准调优

**搜索空间**：
- `n_estimators`: [50, 500]
- `learning_rate`: [0.05, 0.3]（log scale）

**背景**：`learning_rate` 和 `n_estimators` 是 XGBoost 最核心的权衡关系——学习率越小，需要的树越多，最终精度可能更高但训练更慢。此阶段确定一个合理的基准组合，避免后续阶段在错误的规模上优化。

**典型结论**：`n_estimators = 150, learning_rate = 0.1` 在验证集上达到最优。

---

### 阶段 2：树结构复杂度调优

**搜索空间**：
- `max_depth`: [3, 10]
- `min_child_weight`: [1, 10]
- `gamma`: [0.0, 1.0]

**背景**：
- `max_depth` 控制树的表达能力（偏差-方差权衡的核心）
- `min_child_weight` 防止在稀疏区域过拟合
- `gamma` 减小"伪分裂"（分裂后增益极小的无效分裂）

**典型结论**：`max_depth=5, min_child_weight=3, gamma=0.1` 在 CV 指标上最优。

---

### 阶段 3：采样策略调优

**搜索空间**：
- `subsample`: [0.5, 1.0]
- `colsample_bytree`: [0.5, 1.0]
- `colsample_bylevel`: [0.5, 1.0]

**背景**：随机采样是梯度提升中防止过拟合的重要手段。固定树结构后，采样参数可以进一步降低模型方差，提升在 OOT 集上的泛化能力。

**典型结论**：`subsample=0.8, colsample_bytree=0.7` 在测试集上相比阶段2提升 AUC 0.008。

---

### 阶段 4：正则化参数调优

**搜索空间**：
- `reg_alpha` (L1): [0.0, 2.0]
- `reg_lambda` (L2): [0.5, 3.0]

**背景**：
- L1 正则（`reg_alpha`）趋向稀疏解，对有大量噪声特征的数据集有帮助
- L2 正则（`reg_lambda`）控制权重幅度，常规防过拟合手段
- XGBoost 默认 `reg_lambda=1`（与线性回归的岭回归类似）

**典型结论**：`reg_alpha=0.1, reg_lambda=1.5` 防止了轻微过拟合（train-test gap 从 0.08 降至 0.04）。

---

### 阶段 5：精细化收尾调优

**搜索空间**：
- `n_estimators`: [100, 1000]（更宽范围）
- `learning_rate`: [0.001, 0.05]（更小范围，log scale）

**背景**：使用更小的学习率通常能在精细搜索中找到更优的收敛点，但需要更多迭代轮数平衡。此阶段固定阶段2-4的结构参数，专注于学习率-迭代次数的最优组合。

**典型结论**：`learning_rate=0.02, n_estimators=500` 比阶段1的基准提升 AUC 0.012。

---

## 三、调优记录格式

每个阶段的完整记录以 JSON 格式保存，可通过 `GET /api/tuning/{task_id}/result` 获取：

```json
{
  "phase_records": [
    {
      "phase_id": 1,
      "phase_name": "迭代次数与学习率基准调优",
      "phase_goal": "固定其他基础参数，通过早停机制确定基础迭代轮数...",
      "params_tuned": ["n_estimators", "learning_rate"],
      "param_ranges": {
        "n_estimators": [50, 500],
        "learning_rate": [0.05, 0.3]
      },
      "n_trials": 10,
      "n_completed": 10,
      "n_failed": 0,
      "best_score": 0.8612,
      "best_params": { "n_estimators": 150, "learning_rate": 0.1 },
      "effect_improvement": null,
      "selection_rationale": "选择得分最优的参数组合（maximize方向，评分0.8612），固定传入下一阶段",
      "trials": [
        {"trial": 1, "score": 0.8401, "best_so_far": 0.8401, "params": {...}},
        {"trial": 2, "score": 0.8612, "best_so_far": 0.8612, "params": {...}},
        ...
      ]
    },
    ...
  ]
}
```

### `effect_improvement` 字段说明

- 阶段 1：`null`（无前序基准）
- 阶段 2～5：本阶段最优分 - 前一阶段最优分
  - 正值 → 本阶段带来了性能提升
  - 负值 → 本阶段参数与前序参数有冲突，需检查

---

## 四、SSE 进度事件（前端接收）

调优过程中，前端通过 `EventSource` 接收以下类型的事件：

```typescript
// 阶段开始（仅 phase_start = true 的事件）
{
  "phase_start": true,
  "phase_id": 2,
  "phase_name": "树结构复杂度调优",
  "phase_goal": "平衡模型偏差与方差...",
  "params_to_tune": ["max_depth", "min_child_weight", "gamma"],
  "phase_trials": 10,
  "global_trial_start": 11,
  "total_trials": 50
}

// 普通 trial 进度
{
  "trial": 12,
  "total": 50,
  "phase_id": 2,
  "phase_name": "树结构复杂度调优",
  "score": 0.8724,
  "params": {"max_depth": 5, "min_child_weight": 3, "gamma": 0.1},
  "best_score": 0.8724,
  "elapsed_s": 18.3
}

// 阶段结束
{
  "phase_end": true,
  "phase_id": 2,
  "best_score": 0.8724,
  "best_params": {"max_depth": 5, "min_child_weight": 3, "gamma": 0.1},
  "effect_improvement": 0.0112,
  "n_completed": 10
}

// 全部完成
{
  "completed": true,
  "best_params": { ... },
  "best_score": 0.8891,
  "model_id": 8,
  "phases_completed": 5
}
```

---

## 五、调优配置建议

| 场景 | `n_trials` 建议 | 说明 |
|------|----------------|------|
| 快速验证 | 25（每阶段5次） | 快速看收益趋势，不追求精度 |
| 常规调优 | 50（每阶段10次） | 默认推荐，平衡质量与时间 |
| 精细调优 | 100（每阶段20次） | 重要项目，对时间不敏感 |
| 生产级模型 | 200（每阶段40次） | 最高精度，耗时约 30-60 分钟 |

---

## 六、与单次 Optuna 搜索的区别

| 维度 | 传统单轮搜索 | XGBoost Studio 5 阶段分层调优 |
|------|-------------|-------------------------------|
| 搜索空间 | 全量 7 个参数同时搜索 | 每阶段 2-3 个参数，空间小 3-4 倍 |
| 可解释性 | 黑盒，仅得最优参数 | 每阶段完整记录，100% 可解释 |
| 收敛效率 | 需要更多 trial 才能覆盖高维空间 | 按依赖顺序逐步收窄，效率更高 |
| 决策追溯 | 无法说明"为何选这个值" | 每步有 `selection_rationale` 记录 |
| 中断恢复 | 全部重来 | 可停在任意阶段查看已完成结果 |

---

## 七、AutoML 内的轻量联合搜索（`run_lite_tuning_best_params`）

**页面调优**仍走上述 5 阶段分层流程与 `POST /api/tuning/...` SSE。

**全自动建模**在固定 `max_tuning_trials` 预算内，可调用 `tuning_service.run_lite_tuning_best_params` 做缩小范围的联合搜索，得到一组参数后再由 `train_and_persist_sync` 落库。与完整 5 阶段调优的关系：前者强调**可等待、有上限**的自动化；后者强调**可解释、分阶段**的专家路径。详见 [`08-automl-wizard.md`](08-automl-wizard.md)。

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.5.0 | 全文「版本对应」与产品 v0.5.x 对齐；5 阶段调优主路径无破坏性变更 |
| v0.4.x | 新增 `run_lite_tuning_best_params`，供 AutoML 候选 C 在试验预算内联合搜参（非替代 5 阶段 UI 调优） |
| v0.3.0 | G3-B：tuning_service.py 完整重构为 5 阶段分层调优；ModelTuning 页面新增阶段步骤卡、阶段着色轨迹图、各阶段折叠详情表 |
| v0.2.0 | 单轮 Optuna TPE/随机搜索落地，G2-Auth-3：trial 失败可审计 |
