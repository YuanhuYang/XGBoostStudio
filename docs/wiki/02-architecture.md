# XGBoost Studio · 技术架构

> **版本对应**：v0.3.0  
> **最后更新**：2026-04-06

---

## 一、技术栈总览

### 整体架构：本地 C/S + Electron 封装

```
┌─────────────────────────────────────────────────────────────────────┐
│                         桌面应用（Electron 28）                       │
│                                                                     │
│  ┌─────────────────────────────────────┐  ┌────────────────────┐   │
│  │     渲染进程（Renderer Process）       │  │  主进程（Main）     │   │
│  │                                     │  │                    │   │
│  │  React 18 + TypeScript              │  │  electron-vite     │   │
│  │  Ant Design 5（UI 组件库）            │  │  server-manager    │   │
│  │  ECharts（图表）                      │  │  （管理后端进程）    │   │
│  │  Zustand（全局状态）                   │  │                    │   │
│  │  Axios（HTTP 客户端）                 │  └────────────────────┘   │
│  │  react-pdf（PDF 预览）                │                           │
│  └──────────────┬──────────────────────┘                           │
│                 │ HTTP REST + SSE（127.0.0.1:18899）                │
│  ┌──────────────▼──────────────────────┐                           │
│  │    API 服务进程（FastAPI + Uvicorn）  │                           │
│  │                                     │                           │
│  │  XGBoost 3.x（建模引擎）              │                           │
│  │  Optuna 4.x（超参数搜索）             │                           │
│  │  SHAP 0.5x（可解释性）               │                           │
│  │  Pandas / NumPy / Scipy             │                           │
│  │  Scikit-learn（基线/校准/学习曲线）    │                           │
│  │  Statsmodels（VIF/ANOVA/分布检验）    │                           │
│  │  ReportLab（PDF 生成）               │                           │
│  │  SQLite（元数据存储）                 │                           │
│  └─────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 进程模型说明

1. **Electron 主进程**（`client/electron/main.ts`）：负责窗口生命周期、本地文件系统访问、打包后的后端服务进程管理（`server-manager.ts`）。

2. **渲染进程**（`client/src/`）：纯前端 SPA，通过 `http://127.0.0.1:18899` 与后端通信。Electron `preload.ts` 提供安全的 IPC bridge。

3. **FastAPI 服务进程**（`server/`）：以子进程方式被主进程拉起（打包后为 `xgboost-server.exe` via PyInstaller），**独立进程，随应用启动/退出**。

---

## 二、前端模块结构

```
client/src/
├── pages/           # 十页功能模块（每页一个目录，index.tsx 主入口）
│   ├── Welcome/
│   ├── SmartWorkflow/       # 智能向导
│   ├── DataImport/          # 数据导入
│   ├── FeatureAnalysis/     # 特征分析（IV/KS/PSI/泄露检测）
│   ├── FeatureEngineering/  # 特征工程
│   ├── ParamConfig/         # 参数配置
│   ├── ModelTraining/       # 模型训练
│   ├── ModelEval/           # 模型评估（含 PDP/ICE/鲁棒性/公平性）
│   ├── ModelTuning/         # 超参数调优（5阶段）
│   ├── ModelManagement/     # 模型管理
│   ├── Report/              # 分析报告（12章 PDF）
│   └── Prediction/          # 交互式预测
├── store/
│   └── appStore.ts          # Zustand 全局状态（activeDatasetId / activeSplitId / activeModelId）
├── api/                     # 后端 API 调用封装
│   ├── client.ts            # Axios 实例（baseURL: 127.0.0.1:18899）
│   ├── datasets.ts
│   ├── training.ts
│   ├── models.ts
│   ├── tuning.ts
│   ├── reports.ts
│   └── ...
├── components/              # 共享组件
│   ├── HelpButton/
│   ├── PDFViewer/
│   ├── MainLayout/          # 侧边栏 + 路由分发
│   └── ...
└── constants/
    └── reportSections.ts    # 12章定义 + 4种模板 + 旧版章节（向后兼容）
```

### 全局状态流（Zustand appStore）

```
activeDatasetId ──► FeatureAnalysis / FeatureEngineering / DataImport
activeSplitId   ──► ModelTraining / ModelTuning / Prediction
activeModelId   ──► ModelEval / ModelTuning / Report / Prediction
```

三个 ID 跨页面自动传递，切换到任何模块时均预填当前活跃 ID，无需手动输入。

---

## 三、后端模块结构

```
server/
├── main.py              # FastAPI 应用入口，注册全部 Router
├── routers/             # HTTP 路由层
│   ├── datasets.py      # 数据集 + 特征分析（含 G3-A 新增路由）
│   ├── training.py      # 训练 + K折
│   ├── models.py        # 模型评估（含 G3-B PDP/OOT/鲁棒性/公平性）
│   ├── tuning.py        # 超参数调优（SSE 流式进度）
│   ├── reports.py       # PDF 报告生成（含 G3-C 12章/模板/品牌）
│   ├── prediction.py    # 预测（批量 + 单次）
│   ├── params.py        # 参数推荐/验证
│   └── wizard.py        # 智能向导 Pipeline
├── services/            # 业务逻辑层
│   ├── feature_service.py      # 分布/相关/VIF/PCA + G3-A: IV/KS/PSI/单调性/标签
│   ├── leakage_service.py      # G3-A: 三类泄露检测（时间穿越/标签/拟合）
│   ├── dataset_service.py      # 数据集 CRUD、预处理、划分
│   ├── dataset_narrative_service.py  # 数据叙事（G2-R1）
│   ├── training_service.py     # XGBoost 训练执行
│   ├── eval_service.py         # 评估 + G3-B: PDP/OOT/鲁棒性/坏样本/公平性
│   ├── tuning_service.py       # G3-B 重构: 5阶段分层调优（Optuna）
│   ├── report_service.py       # G3-C 重构: 12章 PDF（ReportLab）
│   ├── chart_service.py        # 图表生成（Matplotlib → bytes）
│   ├── prediction_service.py   # 预测 + SHAP 单样本
│   ├── provenance.py           # 模型运行档案（G2-Auth-1）
│   └── wizard_service.py       # 向导 Pipeline 编排
├── db/
│   ├── database.py      # SQLAlchemy 引擎 + Session 工厂
│   └── models.py        # ORM 数据模型
├── schemas/
│   ├── model.py         # Pydantic 请求/响应模型（含 BrandConfig, template_type）
│   ├── dataset.py
│   └── narrative.py
└── tests/               # pytest 测试套件
```

---

## 四、数据存储

### SQLite 数据库（`server/data/xgboost_studio.db`）

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `datasets` | id, name, path, target_column | 数据集元数据 |
| `dataset_splits` | id, dataset_id, train_path, test_path, split_strategy | 训练/测试划分（含时间序列划分） |
| `models` | id, name, task_type, params_json, metrics_json, provenance_json, cv_* | 模型注册表 |
| `training_tasks` | id, split_id, status, error_msg | 训练任务状态 |
| `tuning_tasks` | id, split_id, strategy, best_params_json, tuning_diagnostics_json | 调优任务（含5阶段phase_records） |
| `reports` | id, model_id, path, report_type | PDF 报告记录 |
| `report_templates` | id, name, sections, is_builtin | 用户自定义报告模板 |

### 文件系统（`server/data/`）

```
server/data/
├── uploads/     # 用户上传的原始数据集（CSV/XLSX）
├── processed/   # 经特征工程处理后的中间数据集
├── splits/      # 数据集划分结果（train.csv / test.csv）
├── models/      # XGBoost 模型文件（.ubj 格式）
└── reports/     # 生成的 PDF 报告文件
```

---

## 五、API 通信规范

### REST 接口

- 基础路径：`http://127.0.0.1:18899`
- 认证：无（纯本地，无网络暴露风险）
- 格式：`application/json`
- 错误码：遵循 HTTP 语义（400 参数错误 / 404 资源不存在 / 422 校验失败 / 500 内部错误）

### SSE（Server-Sent Events）

用于训练进度和调优进度的实时推送，前端用 `EventSource` 接收：

```typescript
// 训练进度
GET /api/training/{task_id}/progress → SSE 流

// 调优进度（5阶段，每个 trial + phase_start/phase_end 事件）
GET /api/tuning/{task_id}/progress → SSE 流
```

SSE 事件字段说明见 [`04-model-training.md`](04-model-training.md) 和 [`05-auto-tuning.md`](05-auto-tuning.md)。

---

## 六、打包与分发

- **客户端打包**：`electron-vite build + electron-builder`，输出 NSIS 安装包（Windows）
- **服务端打包**：`PyInstaller`，输出 `xgboost-server.exe`，内嵌在 Electron `extraResources` 中
- **版本对齐**：`client/package.json` 和 `server/pyproject.toml` 中的 `version` 字段须保持一致

---

## 版本历史

| 版本 | 变更摘要 |
|------|----------|
| v0.3.0 | G3-A：新增 leakage_service.py + feature_service 扩展；G3-B：tuning_service 重构为5阶段 + eval_service 扩展 PDP/ICE/OOT/鲁棒性；G3-C：report_service 重构为12章 + BrandConfig schema |
| v0.2.0 | 模型运行档案（provenance）、K折协议、数据叙事（G2-R1）落地 |
| v0.1.0 | 基础 C/S 架构搭建，六轮迭代核心功能落地 |
