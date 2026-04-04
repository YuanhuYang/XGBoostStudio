# 验收 AC ↔ 证据矩阵（全量验收对齐）

> **维护**：测试顾问（QA）。**更新频率**：每增删自动化用例或完成一批手工 AC 后更新「最后证据日期」列。  
> **门禁**：对外宣称「迭代计划范围已验收通过」仍须满足 [`功能需求与验收状态.md`](功能需求与验收状态.md) §二 + §四；本表是 **执行抓手**，不替代签核。  
> **本期口径**：见 [`功能需求与验收状态.md`](功能需求与验收状态.md) §二 **「当期发布口径（项目经理冻结 · 2026-04-05）」**。

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
| 全局 · 422 校验 | `test_api_robustness.py`（训练体、`/reports/compare` 体） | — | 2026-04-05 | 抽样自动化 |

---

## P1 / P2（本期口径外或未全覆盖）

| AC / 范围 | 自动化 | 备注 |
|-----------|--------|------|
| 模块 10 · 预测 | `test_prediction_batch_summary_unknown_task` 等 | 批量主路径须补 |
| 模块 2～4、7、11～13 | — | 标 **N/A本期** 直至纳入发布口径 |
| `tests/acceptance_test.py` | 需已起服务 `18899` | CI：**手动工作流** [`.github/workflows/acceptance.yml`](../.github/workflows/acceptance.yml) |
| `tests/e2e_validate.py` | 持久库 + 服务 | 见 [`验收追踪.md`](验收追踪.md) |

---

## 前端（契约 / 最小单测）

| 范围 | 自动化 | 最后证据日期 |
|------|--------|--------------|
| 报告章节选项与 G2 令牌一致 | `client` `npm run test` → `reportSections.test.ts` | 2026-04-05 |
