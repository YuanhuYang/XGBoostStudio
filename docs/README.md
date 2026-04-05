# 文档索引（`docs/`）

- **规范**（必读）：[`CONVENTIONS.md`](CONVENTIONS.md) — 目录结构、迭代 ID、固定文件名、禁止日期文件名等。  
- **文档管家（Cursor）**：`@xgboost-studio-doc-steward` 或 `/doc-steward`。

## 产品 / 计划 / 验收基线 → [`product/`](product/)

| 文件 | 说明 |
|------|------|
| [`需求文档.md`](product/需求文档.md) | 功能规格（What） |
| [`验收标准文档.md`](product/验收标准文档.md) | AC 与验证步骤 |
| [`迭代计划.md`](product/迭代计划.md) | 路线图与验收门禁 |
| [`功能需求与验收状态.md`](product/功能需求与验收状态.md) | 实现与验收状态表 |
| [`验收追踪.md`](product/验收追踪.md) | 实现# ↔ 自动化 |
| [`验收-AC证据矩阵.md`](product/验收-AC证据矩阵.md) | AC 证据 |
| [`RELEASE_CHECKLIST.md`](product/RELEASE_CHECKLIST.md) | 发版检查 |
| [`项目管理术语-五领域.md`](product/项目管理术语-五领域.md) | 签核与领域术语 |
| [`迭代规划-G2+.md`](product/迭代规划-G2+.md) | G2+ 模型权威性路线图 |
| [`版本与发布.md`](product/版本与发布.md) | 产品版本号（SemVer）与迭代 ID 的关联、发布记录表 |

## 工程与上手 → [`guides/`](guides/)

| 文件 | 说明 |
|------|------|
| [`quick-start.md`](guides/quick-start.md) | 快速开始 |
| [`部署说明.md`](guides/部署说明.md) | 部署 |
| [`开发规范.md`](guides/开发规范.md) | 分支与提交 |
| [`developers-guide.md`](guides/developers-guide.md) | 开发者指南 |
| [`AGENT_PROMPT.md`](guides/AGENT_PROMPT.md) | 历史自动化提示（参考） |

## 按迭代的过程文档 → [`iterations/`](iterations/)

索引与说明：**[`iterations/README.md`](iterations/README.md)**。每个子目录名 = **迭代 ID**；目录内优先 **`章程.md`**、**`设计.md`**、**`执行记录.md`**（见 CONVENTIONS）。

| 目录 | 说明 |
|------|------|
| [`G1/`](iterations/G1/) | 信任链与权威数据 |
| [`G1-quality/`](iterations/G1-quality/) | 全量验收对齐（质量轨证据） |
| [`G2-R1/`](iterations/G2-R1/) | 报告数据关系与叙事 |
| [`G2-Auth-1/`](iterations/G2-Auth-1/) … | 各 Auth 专项 |
| [`harness-D2/`](iterations/harness-D2/) | Harness 抽样与双轨记录 |
| … | 详见 `iterations/` 下列表 |

## 最佳实践示例 → [`best-practices/`](best-practices/)

| 目录 | 说明 |
|------|------|
| [`README.md`](best-practices/README.md) | 最佳实践索引 |
| [01-titanic-survival.md](best-practices/01-titanic-survival.md) | 泰坦尼克号生还预测（二分类） |
| [02-boston-housing.md](best-practices/02-boston-housing.md) | 波士顿房价预测（回归） |
| [03-iris-classification.md](best-practices/03-iris-classification.md) | 鸢尾花分类（多分类） |

## 跨迭代证据 → [`evidence/`](evidence/)

| 文件 | 说明 |
|------|------|
| [`抽样-F3-分模块.md`](evidence/抽样-F3-分模块.md) | F3 分模块抽样 |
