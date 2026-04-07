# XGBoost Studio · 知识库

> **版本对应**：本目录内容与产品版本 **v0.5.x** 同步，每次产品迭代后增量更新。  
> **阅读入口**：根据你的角色选择对应文档，所有文档互有交叉引用，可按需跳转。

---

## 文档索引

| 文件 | 内容摘要 | 适合读者 |
|------|----------|----------|
| [`01-product-overview.md`](01-product-overview.md) | 产品定位、用户画像、**四种**体验模式（智能向导 / 数据处理 / 模型调优 / 专家分析）、顶栏划分·主模型·对比与教学 UI 策略 | 产品经理、新入职成员、商务 |
| [`02-architecture.md`](02-architecture.md) | 技术栈全景、模块划分、进程模型、数据存储、API 契约边界 | 后端/前端工程师、架构师 |
| [`03-data-analysis.md`](03-data-analysis.md) | XGBoost专属数据分析全流程：标签分析、特征效力、PSI、单调性、泄露检测 | 数据分析师、算法工程师 |
| [`04-model-training.md`](04-model-training.md) | 模型训练流程：划分策略、训练执行、K折交叉验证、过拟合防控 | 算法工程师 |
| [`05-auto-tuning.md`](05-auto-tuning.md) | 5阶段分层调优方法论：每阶段目标、参数范围、调优轨迹解读 | 算法工程师、数据科学家 |
| [`06-model-evaluation.md`](06-model-evaluation.md) | 模型评估全维度：准确性、泛化能力、可解释性、鲁棒性、公平性 | 算法工程师、风险合规 |
| [`07-pdf-report.md`](07-pdf-report.md) | PDF报告12章结构、4种预设模板、品牌定制、内容自动生成逻辑 | 产品经理、数据分析师、合规审计 |
| [`08-automl-wizard.md`](08-automl-wizard.md) | 全自动建模（AutoML）：能力边界、`/api/automl`、向导 Step 0、**命令行 xs-studio**、SSE 交互 | 产品、全栈、算法（编排复用训练/调优服务） |
| [`09-data-quality-unified-and-smart-clean.md`](09-data-quality-unified-and-smart-clean.md) | **统一质量分**（工作台=向导）、**智能清洗**启发式、`preprocessing_log_json` 与 PDF 审计链路、白皮书摘要 | 产品、算法、合规审计、全栈 |
| [`10-windows-distribution.md`](10-windows-distribution.md) | **Windows 分发**：NSIS 安装包与 portable 免安装版、一键构建产物位置、安装步骤、内置后端、FAQ | 研发、运维、终端用户（安装说明） |
| [`11-mac-linux-distribution.md`](11-mac-linux-distribution.md) | **macOS 桌面包** + **Linux 无 Electron**（Release 后端 tar、浏览器、CLI）、[`scripts/build-all.sh`](../../scripts/build-all.sh)、与 Windows 差异 | 研发、运维、终端用户 |

本目录共 **11 篇** Markdown（`01`–`11`）。**应用内文档中心**（v0.5）左侧目录由 [`client/src/constants/docsManifest.ts`](../../client/src/constants/docsManifest.ts) 的 `DOCS_MANIFEST` 决定：当前收录 Wiki **`01`–`09`** 与多篇 guides；**`10` / `11` 未在 manifest 中**，请在仓库或 GitHub 打开本篇。

---

## 快速导航

- **我是新用户，想快速上手** → [`01-product-overview.md`](01-product-overview.md)（**四种模式** + 向导 6 步 + 默认教学能力说明）
- **我要一键自动建模** → [`08-automl-wizard.md`](08-automl-wizard.md)（UI 见 §2.1；命令行见 §2.2） · 实操命令见 [`../guides/xs-studio-cli.md`](../guides/xs-studio-cli.md)
- **我要做数据分析** → [`03-data-analysis.md`](03-data-analysis.md)
- **我要训练并调优模型** → [`04-model-training.md`](04-model-training.md) + [`05-auto-tuning.md`](05-auto-tuning.md)
- **我要生成专业报告** → [`07-pdf-report.md`](07-pdf-report.md) · 质量分与清洗审计口径 → [`09-data-quality-unified-and-smart-clean.md`](09-data-quality-unified-and-smart-clean.md)
- **我要了解系统架构** → [`02-architecture.md`](02-architecture.md)
- **我要在 Windows 上安装或使用免安装版 / 打包发布** → [`10-windows-distribution.md`](10-windows-distribution.md)
- **我要在 macOS 上装桌面包，或在 Linux 上用 Release 后端 + 浏览器** → [`11-mac-linux-distribution.md`](11-mac-linux-distribution.md)

---

## 更新规范

- 文档以**中文**撰写，技术术语保留英文（如 `XGBoostClassifier`、`SHAP`）
- 每次产品迭代后在相关文档顶部更新 `版本对应` 字段，并在文档末尾 `## 版本历史` 追加一行变更摘要
- **新增独立 Wiki 文件**仅在有清晰新功能域时进行（如 v0.4 的 AutoML → `08-automl-wizard.md`）；其余变更优先在现有文档内增章节
- 图表以 Mermaid 流程图为主，复杂数据用表格，代码示例用代码块
