# XGBoost Studio

<p align="center">
  <strong>XGBoost 垂直领域专业建模平台 — 无需编写代码，全流程可视化完成 XGBoost 建模、调优、解释与预测</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.5.0-blue" />
  <img src="https://img.shields.io/badge/platform-Windows%20✓-success" />
  <img src="https://img.shields.io/badge/platform-macOS-yellowgreen" />
  <img src="https://img.shields.io/badge/platform-Linux-yellowgreen" />
  <img src="https://img.shields.io/badge/python-3.12-3776AB" />
  <img src="https://img.shields.io/badge/XGBoost-3.x-orange" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

## ✨ 功能亮点

| 模块 | 能力 |
|------|------|
| 🤖 **智能向导** | 6 步全流程引导 + 自动参数推荐 + 一键生成专业 PDF 报告 |
| ⚡ **全自动建模（AutoML）** | 选定数据集后一键：目标列启发式、划分、`recommend_params`、多候选训练（规则基线 / 保守正则 / 可选轻量 Optuna）与过拟合惩罚排序；`POST /api/automl/jobs` + SSE 进度 |
| 📥 **数据工作台** | 拖拽上传 CSV/Excel，自动质量评分（0-100），智能去重与缺失检测；侧栏在「数据处理」模式下亦称数据工作台 |
| 🔬 **XGBoost专属分析** | IV/KS/PSI 特征效力排名、单调性分析（`monotone_constraints` 依据）、`scale_pos_weight` 自动推荐 |
| 🛡 **数据泄露检测** | 三类泄露自动识别：标签泄露 / 时间穿越泄露 / 特征工程拟合泄露，输出风险等级 + 修复方案 |
| 🛠 **特征工程** | 缺失值填充、异常值处理、编码、缩放、PCA、**时间序列划分**（防穿越） |
| ⚙️ **参数配置** | 核心超参可视化配置 + 规则推荐引擎 + 教学卡片（智能向导、数据处理与模型调优默认开启；专家分析模式不提供该页） |
| 🚀 **模型训练** | 实时 SSE 进度流 + 训练/验证曲线 + 过拟合预警 + K 折交叉验证 |
| 📊 **全维度评估** | 混淆矩阵/ROC/PR/校准 + **PDP/ICE 边际效应** + **OOT 跨时间集评估** + **鲁棒性压力测试** + **坏样本根因诊断** + **公平性分析** |
| 🎯 **5阶段分层调优** | 专家级调优逻辑：迭代基准 → 树结构 → 采样策略 → 正则化 → 精细收尾，全程可追溯 |
| 🗂 **模型管理** | 注册表、多版本对比（McNemar 检验）、运行档案（可复现） |
| 📄 **12章专业PDF报告** | 4 种预设模板（管理层/业务/技术/合规）+ 企业品牌定制 + 水印 |
| 🤔 **交互预测** | 单样本表单 + SHAP 实时解释 + 批量文件预测 |
| 📚 **应用内文档中心** | 构建期打包 `docs/wiki`、`docs/guides` 与根目录 `README`：左侧目录分组、GFM 排版、Mermaid、右侧 h2/h3 锚点导航；文内 `.md` 互链在应用内跳转（离线可读） |

---

## 🎯 四种用户体验（v0.5 当前版本）

| 模式（`workflowMode`） | 适用人群 | 核心特点 |
|------------------------|----------|----------|
| 🎯 **智能向导** `guided` | 业务分析师、非技术背景用户 | 侧栏仅 **向导工作台** + 6 步进度；全流程引导 + 默认教学（`showTeachingUi`） |
| 🧩 **数据处理** `preprocess` | 希望按菜单分步完成导入、分析、划分、再进入建模的用户 | 侧栏 **数据工作台 / 特征分析 / 特征工程**；离开这三页去其他模块会确认；同样默认教学 UI |
| 🔧 **模型调优** `learning` | 已有数据集、要在固定划分上训练与调参的用户 | 进入前须已激活数据集；侧栏 **调优工作台** + **参数配置 / 模型训练 / 超参数调优 / 模型管理**；默认教学 UI（状态键仍为 `learning`） |
| 📊 **专家分析** `expert` | 侧重评估、对比、报告与预测交付的用户 | 侧栏 **模型工作台** + **模型评估 / 模型管理 / 分析报告 / 交互预测**（**不含**参数配置、训练、超参调优及数据处理向导页）；**不展示**教学类入口；Ctrl+K 仅列出本模式可达页面 |

**顶栏（各模式共通）**：**训练划分**、**主模型** 为下拉选择（全局展示，非「每模式一枚 Tag」）；**专家分析** 模式额外提供 **对比模型** 多选（与报告页对比规模一致）。数据集上下文在数据工作台 / 向导内管理。

四种模式**共享同一套后端与数据流**，顶部 Segmented **四态**切换，模式与进度 localStorage 持久化，全局 `activeDatasetId` / `activeSplitId` / `activeModelId` 在切换时保留。

---

## 🆕 v0.5.0 新增与优化

**应用内文档与知识库**
- 新页面「文档中心」：内容与 [`client/src/constants/docsManifest.ts`](client/src/constants/docsManifest.ts) 一致——根 `README`、Wiki `01`–`09`、常用 `docs/guides/*.md` 等；另有一篇 [`docs/wiki/10-windows-distribution.md`](docs/wiki/10-windows-distribution.md) 仅在仓库/网页阅读，未列入内置 manifest。顶栏 **文档**、欢迎页 **打开文档中心**、Ctrl+K **产品文档** 均可进入
- Web 部署时可通过深链直达：`https://你的域名/?xsPage=documentation`（需已配置前端路由与后端就绪逻辑，与现有 `xsPage` 引导一致）
- 仓库内 Markdown 仍可在 GitHub / 本地直接打开；与客户端内排版版内容同源（构建时 `import.meta.glob` 打入前端包）
- **版本对齐**：`client/package.json` 与 `server/pyproject.toml` 均为 **0.5.0**，Windows 安装包文件名为 `XGBoost-Studio-Setup-0.5.0.exe`

---

## v0.4.0 新增能力（I6 三模式交互架构；后续 v0.5 演进见下）

**全局模式切换器（I6 初版为三态）**
- 顶部 Header Segmented，localStorage 持久化；**v0.5** 起为 **四态**（增加 **数据处理**），顶栏改为 **训练划分 / 主模型** 下拉及专家模式 **对比模型**（以当前 [`MainLayout.tsx`](client/src/components/MainLayout.tsx) 为准）
- 模式首次进入展示新手引导弹窗（ModeOnboardingModal）
- SSE 训练进行中切换模式时保护提示，训练不中断

**向导模式体验完善**
- 侧边栏极简化：仅显示「向导工作台」+ 底部 6 步进度圆点 + Logo 下方步骤文字
- 点击非向导菜单项弹出「是否暂离向导？」确认（进度已自动保存）
- Step 5 结果页一键「切换到专家模式继续分析」
- **Step 0 全自动建模**：一键调用后端 AutoML（快速模式可跳过轻量调优）、SSE 展示进度、多模型候选 Radio 选择主模型并同步全局 `dataset/split/model` 状态

**数据处理模式（v0.5+）**  
侧栏仅限 **数据工作台 / 特征分析 / 特征工程**；从这三页前往其他功能模块时弹出「离开数据处理？」确认；顶栏划分与主模型选择与全局 store 同步保留。

**教学增强体系（智能向导 + 数据处理 + 模型调优默认；专家分析关闭）**  
由 `client/src/utils/teachingUi.ts` 的 `showTeachingUi` 统一控制（`guided` / `preprocess` / `learning` 为 true，`expert` 为 false）。
- `LearningPanel`：算法直觉 + 调大/调小效果双栏 + 过拟合风险色阶条
- `ParamLabModal`：参数对比实验（SmartWorkflow Step 3、ParamConfig）
- `ModelTraining` 收敛解释卡：基于 train/val gap 自动生成分析文字
- `FeatureAnalysis` IV/KS/PSI 概念 Popover：含判断阈值和计算原理
- `ModelEval` 指标解释 Tooltip：AUC/KS/F1 等指标的自然语言解释

**模型调优模式**
- 切换到「调优」前须已激活数据集，否则提示并保持当前模式
- 侧栏：**调优工作台** + 参数配置 / 模型训练 / 超参数调优 / 模型管理；持久化恢复时默认进入调优工作台

**专家分析模式（交付与对比）**
- 侧栏：**模型工作台** + 模型评估 / 模型管理 / 分析报告 / 交互预测（训练与超参调优在「模型调优」或向导中完成）
- `ModelManagement` 对比表 AUC 差值 / KS 差值列；顶栏可选 **对比模型** 多选以配合报告与评估
- Ctrl+K：仅列出本模式可达页面（不含数据处理与训练类页）

---

## v0.3.0 新增能力（G3 三域重构）

**域一：XGBoost专属数据分析**
- `IV / KS / 单特征AUC` — 特征效力排名（替代通用互信息重要性）
- `PSI` — 特征时序稳定性（基准期 vs 对比期分布漂移检测）
- `monotone_constraints` 建议 — 从数据中自动发现单调性约束方向
- `scale_pos_weight` 自动计算 — 二分类不均衡场景一键推荐
- **三类泄露检测** — 标签泄露、时间穿越、拟合泄露，输出根因 + 修复方案

**域二：XGBoost模型结果分析**
- **5 阶段分层调优** — 告别黑盒搜索，每阶段参数决策完整留痕
- **PDP / ICE 曲线** — 特征边际效应可视化，支持业务单调性校验
- **OOT 跨时间集评估** — 量化模型时间衰减幅度
- **鲁棒性压力测试** — 特征扰动 / 样本扰动 / 极端值三类测试
- **坏样本根因诊断** — FP/FN K-Means 聚类 + 共性特征分析
- **算法公平性分析** — 分组预测偏差 + 人口统计公平差异（DPD）

**域三：12章专业PDF报告**
- 12 个固定章节，逻辑闭环（业务目标 → 数据 → 建模 → 评估 → 可解释 → 结论）
- 4 种预设模板：管理层简报 / 业务执行 / 技术专家 / 合规审计
- 企业品牌定制：水印文字 / 企业名称 / 主色调

---

## 🚀 使用方式

### ① Windows 用户（推荐）
```
1. 下载 XGBoost-Studio-Setup-0.5.0.exe
2. 双击安装（自动内置 Python + 全部依赖，完全离线）
3. 从桌面快捷方式启动
```

### ② 开发者（源码运行）

**前置软件（只需安装一次）**

| 软件 | 用途 | 安装 |
|------|------|------|
| [Git](https://git-scm.com/) | 版本控制 | 官网下载 |
| [uv](https://docs.astral.sh/uv/) | Python 版本 + 依赖管理（自动下载 Python 3.12） | 见下方命令 |
| [Node.js 18+](https://nodejs.org/) | 前端运行时 | 官网 LTS 版本 |

**安装 uv**

```bash
# Windows PowerShell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

**🇨🇳 国内开发者：配置镜像加速（推荐，仅需一次）**

```bash
# npm 配置淘宝镜像
npm config set registry https://registry.npmmirror.com

# uv 配置清华 PyPI 镜像（Windows PowerShell）
$Env:UV_DEFAULT_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"

# macOS / Linux（加入 ~/.zshrc 或 ~/.bashrc）
export UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
```

**克隆并安装依赖**

```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio

# 安装后端依赖（uv 自动下载 Python 3.12 + 全部包，含开发组）
cd server && uv sync --all-groups && cd ..

# 安装前端依赖
cd client && npm install && cd ..
```

**启动开发环境**

```bash
# 终端 1：启动后端（端口 18899）
cd server
uv run uvicorn main:app --host 127.0.0.1 --port 18899 --reload

# 终端 2：启动前端（Electron + Vite）
cd client
npm run dev
```

或启动纯 Web 模式（无 Electron）：
```bash
cd client && npm run dev:web
# 浏览器访问 http://localhost:5173
```

---

## ⌨️ 命令行 AutoML（xs-studio）

在 **`server`** 目录可启动交互式 CLI：自动拉起后端、进入 REPL，与浏览器前端共用同一 API/数据库；支持 `run` 一键上传并跑 AutoML。

```bash
cd server
uv sync
uv run python -m cli.main              # 交互
uv run python -m cli.main run ./data.csv --skip-tuning
```

完整说明（PowerShell / macOS / Linux、深链、`detach` 等）见 [**xs-studio CLI 指南**](docs/guides/xs-studio-cli.md)。

---

## 🧪 运行测试

```bash
# 后端单元测试（含 G3 新增测试套件）
cd server
uv run pytest -q

# 前端单元测试
cd client
npm run test:unit

# 前端类型检查
cd client
npm run typecheck
```

当前测试覆盖：后端含 G3-A/B/C 与 **AutoML**（`tests/test_automl.py`）等套件 + 前端含 `appStore` 四模式、`teachingUi` 与文档中心等相关测试；具体数量以本地 `pytest` / `npm run test:unit` 为准。

---

## 📚 文档

**阅读方式**
- **在应用内（推荐）**：顶栏 **文档** → 左侧选篇目，支持目录、搜索（Ctrl+K → 产品文档）、表格与 Mermaid；内容随安装包 / Web 构建一并分发，无需单独联网拉取文档站。
- **在仓库中**：下表链接在 GitHub / Gitee 网页上会打开对应 `.md` 渲染页，便于评审与分享单篇。

| 文档 | 内容 |
|------|------|
| [📑 Wiki 索引与快速导航](docs/wiki/README.md) | 知识库总目录、按角色跳转、更新规范 |
| [📖 产品概览](docs/wiki/01-product-overview.md) | 产品定位、四类体验模式与用户画像、功能模块总览 |
| [🏗 技术架构](docs/wiki/02-architecture.md) | 进程模型、前后端结构、数据存储、API 规范 |
| [🔬 数据分析](docs/wiki/03-data-analysis.md) | IV/KS/PSI/单调性/泄露检测设计思路与判读规则 |
| [🚀 模型训练](docs/wiki/04-model-training.md) | 训练流程、划分策略、K折、过拟合诊断 |
| [🎯 5阶段调优](docs/wiki/05-auto-tuning.md) | 调优方法论、每阶段参数背景、SSE 事件格式 |
| [📊 模型评估](docs/wiki/06-model-evaluation.md) | OOT/PDP/ICE/鲁棒性/坏样本/公平性分析 |
| [📄 PDF报告](docs/wiki/07-pdf-report.md) | 12章结构、4种模板、品牌定制、自动生成逻辑 |
| [⚡ 全自动建模与向导](docs/wiki/08-automl-wizard.md) | AutoML API、编排步骤、能力边界、向导 Step 0 入口说明 |
| [🧹 数据质量与智能清洗](docs/wiki/09-data-quality-unified-and-smart-clean.md) | 统一质量分、智能清洗启发式、`preprocessing_log_json` 与 PDF 审计口径 |
| [🪟 Windows 分发](docs/wiki/10-windows-distribution.md) | 安装包 / portable、构建产物、FAQ（未列入应用内文档 manifest，见仓库） |
| [⚡ 快速开始](docs/guides/quick-start.md) | 三种启动方式 + 常见问题 |
| [👨‍💻 开发者指南](docs/guides/developers-guide.md) | 环境配置、代码规范、跨平台开发 |
| [⌨️ xs-studio CLI](docs/guides/xs-studio-cli.md) | 交互式 AutoML REPL、`run` 子命令、与前端并行 |
| [📋 报告解读](docs/guides/report-interpretation.md) | PDF 报告结论解读方法 |

---

## 🏗 技术栈

**前端**：Electron 28 + React 18 + TypeScript + Ant Design 5 + ECharts 5 + Zustand + react-pdf；文档阅读（react-markdown、remark-gfm、rehype-slug、Mermaid）  
**后端**：Python 3.12 + FastAPI + XGBoost 3.x + Optuna 4.x + SHAP + Pandas + Scipy + Statsmodels + ReportLab  
**存储**：SQLite（元数据）+ 本地文件系统（模型 .ubj + PDF 报告）  
**打包**：electron-builder（客户端）+ PyInstaller（服务端 exe）

---

## 🌍 平台支持

| 特性 | Windows | macOS | Linux |
|------|---------|-------|-------|
| Electron 桌面应用 | ✅ | 🔄 进行中 | 🔄 进行中 |
| Web 浏览器模式 | ✅ | ✅ | ✅ |
| 后端 API 服务 | ✅ | ✅ | ✅ |
| PDF 生成（中文） | ✅ | ✅ | ✅ |

---

## 💡 FAQ

**Q: 无需安装 Python 吗？**  
A: ✅ Windows 安装包用户无需。开发者只需安装 `uv`，会自动下载并管理 Python 3.12。

**Q: 数据和模型存在哪里？**  
A: 完全本地存储，路径为 `server/data/`（源码运行）。数据不会上传到任何服务器。

**Q: 支持 GPU 加速吗？**  
A: **当前版本不提供可用的 GPU 训练能力。** 训练与分层调优默认在 CPU 上执行（`tree_method=hist`）。依赖中的 XGBoost 为常规发行构建，产品侧也未做 GPU 检测、CUDA 环境说明或一键切换。若未来正式支持，会在 README 与 wiki 中单独说明。

**Q: 可以处理多大的数据集？**  
A: 建议 100 万行以内。特征分析（IV/PSI）超过 5 万行自动采样，保证性能。

**Q: 支持多用户协作吗？**  
A: 目前为单机本地应用。可修改源码切换数据库为 PostgreSQL 实现多用户。

更多 → [快速开始 FAQ](docs/guides/quick-start.md)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请遵循 [开发规范](docs/guides/开发规范.md) 与 [开发者指南](docs/guides/developers-guide.md)。

---

## 📄 许可证

MIT License — 自由使用、修改、分发

---

**GitHub**: [YuanhuYang/XGBoostStudio](https://github.com/YuanhuYang/XGBoostStudio)
**Version**: v0.5.0 | **Updated**: 2026-04-07
