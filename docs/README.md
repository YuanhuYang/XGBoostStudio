# 文档索引：`docs/` 目录

本文档是 XGBoost Studio 项目文档的导览与索引表。

## 一、 快速导览

- **文档规范（必读）**：[`CONVENTIONS.md`](CONVENTIONS.md) — 目录结构、迭代 ID 格式、固定文件名、禁止日期文件名等。**凡新建或修改文档**必须先读。

## 二、 历史产品规格与验收（归档）

> **`docs/product/` 目录不再存放文件**：下列材料已迁至 [`archive/legacy-product/`](archive/legacy-product/)，供审计与历史对照；**日常产品与导航以 [`wiki/01-product-overview.md`](wiki/01-product-overview.md)、[`wiki/02-architecture.md`](wiki/02-architecture.md) 及当前代码为准**。

| 文件 | 说明 |
|------|------|
| [`archive/legacy-product/需求文档.md`](archive/legacy-product/需求文档.md) | 历史功能规格（What） |
| [`archive/legacy-product/验收标准文档.md`](archive/legacy-product/验收标准文档.md) | 历史 AC 验证步骤 |
| [`archive/legacy-product/迭代计划.md`](archive/legacy-product/迭代计划.md) | 历史路线图 |
| [`archive/legacy-product/功能需求与验收状态.md`](archive/legacy-product/功能需求与验收状态.md) | 历史实现与验收状态表 |
| [`archive/legacy-product/验收追踪.md`](archive/legacy-product/验收追踪.md) | 历史实现# → 自动化映射 |
| [`archive/legacy-product/验收-AC证据矩阵.md`](archive/legacy-product/验收-AC证据矩阵.md) | 历史 AC 证据矩阵 |
| [`archive/legacy-product/迭代规划-G2+.md`](archive/legacy-product/迭代规划-G2+.md) | G2+ 路线图规划 |
| [`archive/legacy-product/版本与发布.md`](archive/legacy-product/版本与发布.md) | 版本号与迭代 ID 关联 |
| [`archive/legacy-product/RELEASE_CHECKLIST.md`](archive/legacy-product/RELEASE_CHECKLIST.md) | 发版检查表 |
| [`archive/legacy-product/项目管理术语-五领域.md`](archive/legacy-product/项目管理术语-五领域.md) | 术语与领域说明 |

## 三、 工程与上手 → [`guides/`](guides/)

面向不同角色的工程操作指南：

| 文件 | 说明 | 受众 |
|------|------|------|
| [`quick-start.md`](guides/quick-start.md) | 快速开始 | 所有用户 |
| [`部署说明.md`](guides/部署说明.md) | DevOps / 运维 | 运维人员 |
| [`开发规范.md`](guides/开发规范.md) | 分支与提交 | 开发人员 |
| [`developers-guide.md`](guides/developers-guide.md) | 开发者指南 | 开发人员 |
| [`xs-studio-cli.md`](guides/xs-studio-cli.md) | **xs-studio 命令行**：AutoML REPL、`run`、与前端并行 | 开发人员 / 自动化 |
| [`report-interpretation.md`](guides/report-interpretation.md) | 报告解读：常见问题解答 | 用户 / 数据分析师 |
| [`frontend-ui-automation-testing.md`](guides/frontend-ui-automation-testing.md) | QA / 测试专家 | 前端 UI 自动化测试方案调研与实施指南 |
| [`AGENT_PROMPT.md`](guides/AGENT_PROMPT.md) | AI 提示词 | 历史自动化提示（已更新为与 v0.5 主干一致的结构说明） |

## 四、 按迭代的过程文档 → [`iterations/`](iterations/)

按迭代 ID 组织，每个子目录对应一个迭代周期，内部优先包含 **`章程.md`**、**`设计.md`**、**`执行记录.md`**（见 CONVENTIONS）。

详细索引说明：**[`iterations/README.md`](iterations/README.md)**

| 目录 | 说明 |
|------|------|
| [`G1/`](iterations/G1/) | 信任链与权威数据 |
| [`G1-quality/`](iterations/G1-quality/) | 全量验收对齐（质量证据）|
| [`G2-R1/`](iterations/G2-R1/) | 报告数据关系与叙事 |
| [`G2-Auth-1/`](iterations/G2-Auth-1/) 至 [`G2-Auth-4/`](iterations/G2-Auth-4/) | Auth 专项迭代 |
| [`harness-D2/`](iterations/harness-D2/) | Harness 抽样与双轨记录 |
| [`I1-CompetitorAnalysis/`](iterations/I1-CompetitorAnalysis/) | 竞品分析 |
| [`I2-UX-Redesign/`](iterations/I2-UX-Redesign/) | UX 重设计 |
| [`I3-Report-Enhancement/`](iterations/I3-Report-Enhancement/) | 报告增强 |
| [`I4-Commercialization/`](iterations/I4-Commercialization/) | 商业化迭代 |
| [`I5-Frontend-Test-Infra/`](iterations/I5-Frontend-Test-Infra/) | 前端测试基础设施 |
| [`I6-ThreeModeUX/`](iterations/I6-ThreeModeUX/) | **I6 交付三模式**（向导 / 模型调优 / 专家）；**v0.5+** 已演进为 **四模式**（增加数据处理）、专家侧栏收窄、顶栏划分/主模型/对比模型，以 Wiki **01 / 02** 与代码为准 |
| [`SkillOpt-I1/`](iterations/SkillOpt-I1/) | Skill 优化迭代 1 |
| [`CQ-1/`](iterations/CQ-1/) 至 [`CQ-2/`](iterations/CQ-2/) | 代码质量迭代 |

详细命名规范见 [`CONVENTIONS.md`](CONVENTIONS.md) 查阅：
- `章程.md` 是 迭代目标和 DoD
- `设计.md` 是 技术方案和架构决策
- `执行记录.md` 是 测试记录和验收

## 五、 跨迭代证据 → [`evidence/`](evidence/)

跨迭代质量验证数据：

| 文件 | 说明 |
|------|------|
| [`抽样-F3-分模块.md`](evidence/抽样-F3-分模块.md) | F3 分模块抽样证据 |

## 六、 最佳实践 → [`best-practices/`](best-practices/)

最佳实践案例文档

## 七、 图片资源 → [`assets/`](assets/)

文档中引用的图片和 GIF 资源

## 八、 产品知识库（Wiki）→ [`wiki/`](wiki/)

面向产品能力与架构的专题说明（与根目录 `README` 文档表一致）：

| 入口 | 说明 |
|------|------|
| [`wiki/README.md`](wiki/README.md) | Wiki 总索引与快速导航 |
| [`wiki/01-product-overview.md`](wiki/01-product-overview.md) | 产品概览与**四种**体验模式 |
| [`wiki/02-architecture.md`](wiki/02-architecture.md) | 技术架构与 API 边界 |
| [`wiki/08-automl-wizard.md`](wiki/08-automl-wizard.md) | 全自动建模（AutoML）：向导 Step 0 + **命令行 xs-studio** |

---

## 九、 AI 使用说明

使用 Cursor AI 管理文档时，使用 `xs-doc-steward` Skill 进行文档操作和检查：
- `@xgboost-studio-doc-steward` 或 `/doc-steward` 触发
- 自动检查文档格式和编码规范

---

**最后更新**：2026-04-07 | **XGBoostStudio v0.5.x**（四模式导航、文档中心、产品规格归档路径修正）
