# 验收 AC ↔ 证据矩阵（全量验收对齐）

> **维护**：测试顾问（QA）。**更新频率**：每增删自动化用例或完成一批手工 AC 后更新「最后证据日期」列。  
> **门禁**：对外宣称「迭代计划范围已验收通过」仍须满足 [`功能需求与验收状态.md`](功能需求与验收状态.md) §二 + §四；本表是 **执行抓手**，不替代签核。  
> **本期口径**：见 [`功能需求与验收状态.md`](功能需求与验收状态.md) §二 **「当期发布口径（项目经理冻结 · 2026-04-05）」**。  
> **G1 信任链（AC 冻结 + 自动化/豁免 100%）**：见 [`迭代章程-G1-信任链与权威数据.md`](迭代章程-G1-信任链与权威数据.md)；下表每行 **必须** 有 pytest 或豁免编号。

## G1 信任链冻结 AC（v2026-04-05）

| AC 编号 | 自动化用例（`server/tests/`） | 豁免编号 / 手工模板 |
|---------|------------------------------|---------------------|
| AC-1-01 | `test_upload_iris_list_and_get`、`test_upload_rejects_non_tabular` | — |
| AC-3-05 | `test_trust_titanic_split_for_quick_config`、`test_split_and_training_start` | — |
| AC-4-03 | `test_trust_quick_config_params_pass_validate_api` | — |
| AC-4-01 | — | **EXEMPT-G1-401**（参数表单纯 UI；手工：截图 + 执行记录 §UI） |
| AC-5-01 | `test_titanic_ac001_api_pipeline_report_pdf`、`test_split_and_training_start` | — |
| AC-6-01 | `test_eval_api_matches_model_metrics_after_train` | — |
| AC-9-09 | `test_titanic_ac001_api_pipeline_report_pdf` | — |
| AC-9-11～AC-9-15 | `test_data_narrative.py`（按用例名） | — |
| AC-7-01 | — | **EXEMPT-G1-701**（Optuna 全链路本期不验；专项迭代再冻结） |
| 权威数据增强 | `test_authority_breast_cancer_sklearn_pipeline` | — |
| 推荐 API 同源 | `test_trust_recommend_params_endpoint_matches_quick_config_shape` | — |
| 报告不改变指标 | `test_evaluation_stable_after_report_generate` | — |
| 叙事行数 ≤ 训练行 | `test_trust_narrative_row_count_bounded_by_train` | — |

| 最后更新 | 结论 |
|----------|------|
| 2026-04-05 | 上表自动化列或豁免列均已填满；CI `pytest` 含本批用例 |

## G2-Auth-1 运行档案（章程 · [`迭代章程-G2-Auth-1-可复现与运行档案.md`](迭代章程-G2-Auth-1-可复现与运行档案.md)）

| AC / 范围 | 自动化用例（`server/tests/`） | 豁免编号 / 手工模板 |
|-----------|------------------------------|---------------------|
| §2.1：`GET /api/models/{id}/provenance` 与 `params`/`metrics` 同源 | `test_provenance_after_training_matches_model_record` | — |
| §2.1：未知 `model_id` → 404 | `test_provenance_404_unknown_model` | — |
| §2.1：需已起服务的 HTTP 验收链 | `tests/acceptance_test.py` 步骤 7～8（端口 `18899`） | CI：`.github/workflows/acceptance.yml` **手动触发** |

| 最后更新 | 结论 |
|----------|------|
| 2026-04-05 | pytest 两行已绿；`acceptance_test.py` 含训练 SSE + provenance 断言；执行记录 [`验收执行记录-G2-Auth-1-20260405.md`](验收执行记录-G2-Auth-1-20260405.md) |

## G2-Auth-2 评估协议（章程 · [`迭代章程-G2-Auth-2-评估与验证协议.md`](迭代章程-G2-Auth-2-评估与验证协议.md)）

| AC / 范围 | 自动化用例（`server/tests/`） | 豁免编号 / 手工模板 |
|-----------|------------------------------|---------------------|
| §2.1：`evaluation_protocol` + 基线 `fit_scope=train_only` | `test_evaluation_has_protocol_and_baseline_train_only` | — |
| §2.1：`POST /api/training/kfold` JSON Body | `test_kfold_post_json_body` | — |
| AC-6-03：训练期 K 折持久化 + `cv_kfold` | `test_ac603_cv_persisted_when_use_kfold_cv` | 模型评估页表/箱线图/高亮：手工对照 [`ModelEval`](../client/src/pages/ModelEval/index.tsx) |
| §2.1：PDF「模型评估结果」含协议与指标摘要段落 | `test_report_pdf_evaluation_section_generates` | — |

| 最后更新 | 结论 |
|----------|------|
| 2026-04-05 | `test_eval_protocol_g2_auth2.py` 全绿（含 `test_ac603_*`）；执行记录 [`验收执行记录-G2-Auth-2-20260405.md`](验收执行记录-G2-Auth-2-20260405.md)；GAP-G2-AUTH-002 已关 |

## G2-Auth-3 调优可信度（章程 · [`迭代章程-G2-Auth-3-调优可信度.md`](迭代章程-G2-Auth-3-调优可信度.md)）

| AC / 范围 | 自动化用例（`server/tests/`） | 豁免编号 / 手工模板 |
|-----------|------------------------------|---------------------|
| §2.1：`diagnostics`、失败可审计、`search_space_documentation` | `test_tuning_g2_auth3.py` | 调优页曲线：[`ModelTuning`](../client/src/pages/ModelTuning/index.tsx) |

| 最后更新 | 结论 |
|----------|------|
| 2026-04-06 | 见 [`验收执行记录-G2-Auth-3-4-20260406.md`](验收执行记录-G2-Auth-3-4-20260406.md) |

## G2-Auth-4 报告方法论表述（章程 · [`迭代章程-G2-Auth-4-报告方法论表述.md`](迭代章程-G2-Auth-4-报告方法论表述.md)）

| AC / 范围 | 自动化用例（`server/tests/`） | 豁免编号 / 手工模板 |
|-----------|------------------------------|---------------------|
| §2.1：PDF `methodology` 章节 + 条件化业务建议 | `test_report_g2_auth4.py` | 双签摘录见执行记录 |

| 最后更新 | 结论 |
|----------|------|
| 2026-04-06 | 见 [`验收执行记录-G2-Auth-3-4-20260406.md`](验收执行记录-G2-Auth-3-4-20260406.md) |

## 列说明

| 列 | 含义 |
|----|------|
| AC / 范围 | [`验收标准文档.md`](验收标准文档.md) 编号或模块范围 |
| 自动化 | `pytest` 用例 id（`server/tests/`）或 `—` |
| 手工索引 | 执行记录章节、截图目录、或 `—` |
| 最后证据日期 | ISO 日期；自动化可取合并日，手工以记录为准 |
| 结论 | 通过 / 未执行 / N/A本期 / 阻塞（附缺陷） |

---

## P0：本期口径优先模块

| AC / 范围 | 自动化 | 手工索引 | 最后证据日期 | 结论 |
|-----------|--------|----------|--------------|------|
| 模块 0 · AC-0-01（全流程） | `test_titanic_ac001_api_pipeline_report_pdf`（HTTP 等效） | SmartWorkflow UI 仍须单独记录 | 2026-04-05 | 自动化通过；UI **未** |
| 模块 1 · 导入/非法类型 | `test_upload_rejects_non_tabular` | AC-1-01 其余 | 2026-04-05 | 部分 |
| 模块 1 · 划分 + 预览 | `test_split_and_training_start`、`test_upload_iris_list_and_get` | 大文件/Excel 多 sheet 等 | 2026-04-05 | 部分 |
| 模块 0/1 · 向导摘要 | `test_wizard_dataset_summary` | AC-0-02～08 等 | 2026-04-05 | 部分 |
| 模块 5 · 训练启动 | `test_split_and_training_start`、`test_titanic_*` SSE | AC-5-01～03 UI | 2026-04-05 | 部分 |
| 模块 6 · 评估 | 随训练结果 `GET /api/models/{id}/evaluation`（间接） | 看板 UI AC-6-xx | — | **未** |
| 模块 9 · PDF / 章节 | `test_titanic_ac001_*`、`test_report_*`、`test_data_narrative.py` | PDF 评分表 10 条 | 2026-04-05 | 部分 |
| 模块 9 · AC-9-11～15 | `test_data_narrative.py` 全文件 | — | 2026-04-05 | 自动化通过 |
| 模块 8 · 列表/对比 | `test_models_api.py` | 模型管理页全量 | 2026-04-05 | 部分 |
| **G2-Auth-1** · 运行档案 | `test_provenance_g2_auth1.py`；`acceptance_test.py` [7/8]～[8/8] | [`验收执行记录-G2-Auth-1-20260405.md`](验收执行记录-G2-Auth-1-20260405.md) | 2026-04-05 | 自动化通过 |
| **G2-Auth-2** · 评估协议 | `test_eval_protocol_g2_auth2.py` | [`验收执行记录-G2-Auth-2-20260405.md`](验收执行记录-G2-Auth-2-20260405.md) | 2026-04-05 | 自动化通过 |
| **G2-Auth-3** · 调优可信度 | `test_tuning_g2_auth3.py` | [`验收执行记录-G2-Auth-3-4-20260406.md`](验收执行记录-G2-Auth-3-4-20260406.md) | 2026-04-06 | 自动化通过 |
| **G2-Auth-4** · 报告方法论 | `test_report_g2_auth4.py` | [`验收执行记录-G2-Auth-3-4-20260406.md`](验收执行记录-G2-Auth-3-4-20260406.md) | 2026-04-06 | 自动化通过 |
| 全局 · 422 校验 | `test_api_robustness.py`（训练体、`/reports/compare` 体） | — | 2026-04-05 | 抽样自动化 |

---

## P1 / P2（本期口径外或未全覆盖）

| AC / 范围 | 自动化 | 备注 |
|-----------|--------|------|
| 模块 10 · 预测 | `test_prediction_batch_summary_unknown_task` 等 | 批量主路径须补 |
| 模块 2～4、7、11～13 | — | 标 **N/A本期** 直至纳入发布口径 |
| `tests/acceptance_test.py` | 需已起服务 `18899`（含 G2-Auth-1 训练 + provenance） | CI：**手动工作流** [`.github/workflows/acceptance.yml`](../.github/workflows/acceptance.yml) |
| `tests/e2e_validate.py` | 持久库 + 服务 | 见 [`验收追踪.md`](验收追踪.md) |

---

## 前端（契约 / 最小单测）

| 范围 | 自动化 | 最后证据日期 |
|------|--------|--------------|
| 报告章节选项与 G2 令牌一致 | `client` `npm run test` → `reportSections.test.ts` | 2026-04-05 |
