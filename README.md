# XGBoost Studio

<p align="center">
  <strong>XGBoost 垂直领域专业建模平台 — 无需编写代码，全流程可视化完成 XGBoost 建模、调优、解释与预测</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.0-blue" />
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
| 📥 **数据导入** | 拖拽上传 CSV/Excel，自动质量评分（0-100），智能去重与缺失检测 |
| 🔬 **XGBoost专属分析** | IV/KS/PSI 特征效力排名、单调性分析（`monotone_constraints` 依据）、`scale_pos_weight` 自动推荐 |
| 🛡 **数据泄露检测** | 三类泄露自动识别：标签泄露 / 时间穿越泄露 / 特征工程拟合泄露，输出风险等级 + 修复方案 |
| 🛠 **特征工程** | 缺失值填充、异常值处理、编码、缩放、PCA、**时间序列划分**（防穿越） |
| ⚙️ **参数配置** | 核心超参可视化配置 + 规则推荐引擎 + 学习模式教学卡片 |
| 🚀 **模型训练** | 实时 SSE 进度流 + 训练/验证曲线 + 过拟合预警 + K 折交叉验证 |
| 📊 **全维度评估** | 混淆矩阵/ROC/PR/校准 + **PDP/ICE 边际效应** + **OOT 跨时间集评估** + **鲁棒性压力测试** + **坏样本根因诊断** + **公平性分析** |
| 🎯 **5阶段分层调优** | 专家级调优逻辑：迭代基准 → 树结构 → 采样策略 → 正则化 → 精细收尾，全程可追溯 |
| 🗂 **模型管理** | 注册表、多版本对比（McNemar 检验）、运行档案（可复现） |
| 📄 **12章专业PDF报告** | 4 种预设模板（管理层/业务/技术/合规）+ 企业品牌定制 + 水印 |
| 🤔 **交互预测** | 单样本表单 + SHAP 实时解释 + 批量文件预测 |

---

## 🎯 三种用户体验

| 模式 | 适用人群 | 核心特点 |
|------|----------|----------|
| 🎯 **向导模式** | 业务分析师、非技术背景用户 | 6 步引导 + 自动推荐 + 自然语言结论 + 一键报告，零门槛 |
| 📚 **学习模式** | 成长期研究者（在校生、算法自学者） | 每个参数附教学卡片（算法直觉 + 调参效果 + 过拟合风险条）+ 参数实验室 |
| ⚙️ **专家模式** | 数据科学家、算法工程师 | 完整十页侧边栏 + 全局 ID 自动传递 + 5阶段调优 + 多模型对比 |

三种模式**共享同一套后端与数据流**，可随时切换，已完成步骤的状态完整保留。

---

## 🆕 v0.3.0 新增能力（G3 三域重构）

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
1. 下载 XGBoost-Studio-Setup-0.3.0.exe
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

当前测试覆盖：162 passed（含 G3-A 数据分析、G3-B 模型分析、G3-C 报告生成测试套件）。

---

## 📚 文档

| 文档 | 内容 |
|------|------|
| [📖 产品概览](docs/wiki/01-product-overview.md) | 产品定位、三类用户画像、功能模块总览 |
| [🏗 技术架构](docs/wiki/02-architecture.md) | 进程模型、前后端结构、数据存储、API 规范 |
| [🔬 数据分析](docs/wiki/03-data-analysis.md) | IV/KS/PSI/单调性/泄露检测设计思路与判读规则 |
| [🚀 模型训练](docs/wiki/04-model-training.md) | 训练流程、划分策略、K折、过拟合诊断 |
| [🎯 5阶段调优](docs/wiki/05-auto-tuning.md) | 调优方法论、每阶段参数背景、SSE 事件格式 |
| [📊 模型评估](docs/wiki/06-model-evaluation.md) | OOT/PDP/ICE/鲁棒性/坏样本/公平性分析 |
| [📄 PDF报告](docs/wiki/07-pdf-report.md) | 12章结构、4种模板、品牌定制、自动生成逻辑 |
| [⚡ 快速开始](docs/guides/quick-start.md) | 三种启动方式 + 常见问题 |
| [👨‍💻 开发者指南](docs/guides/developers-guide.md) | 环境配置、代码规范、跨平台开发 |
| [📋 报告解读](docs/guides/report-interpretation.md) | PDF 报告结论解读方法 |

---

## 🏗 技术栈

**前端**：Electron 28 + React 18 + TypeScript + Ant Design 5 + ECharts 5 + Zustand + react-pdf  
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
A: 支持。确保已安装 CUDA 驱动后，在参数配置中设置 `device=cuda` 即可。

**Q: 可以处理多大的数据集？**  
A: 建议 100 万行以内。特征分析（IV/PSI）超过 5 万行自动采样，保证性能。

**Q: 支持多用户协作吗？**  
A: 目前为单机本地应用。可修改源码切换数据库为 PostgreSQL 实现多用户。

更多 → [快速开始 FAQ](docs/guides/quick-start.md)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请遵循 [开发规范](docs/guides/developers-guide.md)。

---

## 📄 许可证

MIT License — 自由使用、修改、分发

---

**GitHub**: [YuanhuYang/XGBoostStudio](https://github.com/YuanhuYang/XGBoostStudio)  
**Version**: v0.3.0 | **Updated**: 2026-04-06
