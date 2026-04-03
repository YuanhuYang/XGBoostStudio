# XGBoost Studio

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue" />
  <img src="https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey" />
  <img src="https://img.shields.io/badge/python-3.12-3776AB?logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/electron-28-47848F?logo=electron&logoColor=white" />
  <img src="https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/xgboost-3.2-FF6600" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

> **无需编写代码，全流程可视化完成 XGBoost 建模、调优、解释与预测。**  
> 面向数据分析师、算法工程师、科研人员，对标 JMP Pro 16 专业统计分析平台。

---

## ✨ 功能亮点

| 模块 | 核心能力 |
|------|----------|
| 📥 **数据导入** | CSV / Excel 拖拽上传，多 Sheet 选择，虚拟滚动预览 |
| 🔍 **特征分析** | 分布检验（Shapiro-Wilk）、Pearson/Spearman 相关热力图、VIF 多重共线性、ANOVA 目标关系 |
| 🛠 **特征工程** | 缺失值处理、异常值截断、Label/One-Hot 编码、StandardScaler/MinMax 缩放、PCA 降维、数据集划分 |
| ⚙️ **参数配置** | 13 个 XGBoost 超参数可视化配置面板，规则推荐引擎，实时合法性校验 |
| 🚀 **模型训练** | SSE 实时进度流，训练/验证曲线 ECharts 渲染，日志滚动 |
| 📊 **模型评估** | 混淆矩阵热力图、ROC 曲线（AUC）、残差散点图、SHAP Top-20 重要性 |
| 🎯 **超参数调优** | Optuna TPE/随机搜索，SSE 流式 Trial 进度，最优参数自动保存模型 |
| 🗂 **模型管理** | 模型注册表，重命名/标签/导出，多模型雷达图对比 |
| 📄 **分析报告** | 自动生成深色主题 HTML 报告，iframe 预览 + 一键下载 |
| 🤖 **交互预测** | 单样本 JSON 输入（含 SHAP 贡献）+ 批量文件预测 + CSV 结果下载 |

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────────────┐
│                  Electron 28 主进程                   │
│  ServerManager (server-manager.ts) 管理 Python 子进程  │
│       IPC ↔ contextBridge ↔ 渲染进程                  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP REST + SSE
┌──────────────────────▼──────────────────────────────┐
│            React 18 + Ant Design 5 前端               │
│  Zustand 状态管理 │ ECharts 5 图表 │ axios HTTP 客户端 │
└──────────────────────────────────────────────────────┘
                       │ 127.0.0.1:18899
┌──────────────────────▼──────────────────────────────┐
│         FastAPI 0.135+ 后端 (Python 3.12)             │
│  路由层: datasets / params / training / models        │
│          tuning / prediction / reports               │
│  服务层: dataset_service / feature_service            │
│          training_service / eval_service             │
│          tuning_service / prediction_service         │
│          params_service / report_service             │
│  数据层: SQLAlchemy 2.0 + SQLite                      │
│          XGBoost 3.2 │ SHAP 0.51 │ Optuna 4.8        │
└──────────────────────────────────────────────────────┘
```

**数据存储路径**（Windows）：`%APPDATA%\XGBoostStudio\`
- `app.db` — SQLite 元数据
- `datasets/` — 上传的数据集 CSV
- `models/` — 训练保存的 `.ubj` 模型文件
- `reports/` — 生成的 HTML 报告

---

## 🚀 快速开始

### 终端用户（零技术门槛）

1. 下载 `XGBoost Studio Setup x.x.x.exe`
2. 双击安装，按提示完成
3. 从桌面快捷方式启动，**无需安装 Python 或其他依赖**

> 详见 [docs/部署说明.md](docs/部署说明.md)

---

### 开发者环境搭建

#### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Python | 3.12 | 通过 `uv` 管理 |
| Node.js | 18+ | 前端构建 |
| uv | 最新 | Python 包管理器 |
| Git | 任意 | 版本控制 |

#### 1. 克隆仓库

```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio
```

#### 2. 启动后端

```powershell
cd server
uv sync                    # 安装所有 Python 依赖
uv run python main.py      # 启动 FastAPI，监听 127.0.0.1:18899
```

验证：访问 http://127.0.0.1:18899/health，返回 `{"status":"ok","version":"0.1.0"}`

#### 3. 启动前端

```powershell
cd client
npm install                # 安装 Node.js 依赖
npm run dev                # 启动 Electron + Vite 开发服务
```

#### 4. 生成测试数据（可选）

```powershell
cd server
uv run python tests/create_fixtures.py
```

生成 8 个测试数据集到 `server/tests/fixtures/`，涵盖分类、回归、缺失值、重复行、多 Sheet 等场景。

---

## 📦 一键构建（生产包）

```powershell
# 构建完整安装包（后端 exe + Electron 安装包）
.\scripts\build-all.ps1

# 仅构建后端
.\scripts\build-server.ps1

# 仅构建前端
.\scripts\build-client.ps1
```

产物：`client\dist\XGBoost Studio Setup x.x.x.exe`

---

## 📁 项目结构

```
XGBoostStudio/
├── server/                    # Python FastAPI 后端
│   ├── main.py                # 应用入口，端口 18899
│   ├── db/
│   │   ├── database.py        # SQLAlchemy 引擎 + 路径常量
│   │   └── models.py          # ORM 表定义
│   ├── routers/               # API 路由层（7 个模块）
│   │   ├── datasets.py        # 模块 1-3：数据 + 特征
│   │   ├── params.py          # 模块 4：参数配置
│   │   ├── training.py        # 模块 5：模型训练 SSE
│   │   ├── models.py          # 模块 6/8：评估 + 管理
│   │   ├── tuning.py          # 模块 7：Optuna 调优 SSE
│   │   ├── reports.py         # 模块 9：报告生成
│   │   └── prediction.py      # 模块 10：预测推断
│   ├── services/              # 业务逻辑层
│   │   ├── dataset_service.py
│   │   ├── feature_service.py
│   │   ├── training_service.py
│   │   ├── eval_service.py
│   │   ├── tuning_service.py
│   │   ├── params_service.py
│   │   ├── prediction_service.py
│   │   └── report_service.py
│   ├── schemas/               # Pydantic 请求/响应模型
│   ├── tests/                 # 测试夹具生成脚本
│   ├── build.spec             # PyInstaller 打包配置
│   └── pyproject.toml         # uv 依赖声明
├── client/                    # Electron + React 前端
│   ├── electron/
│   │   ├── main.ts            # Electron 主进程
│   │   ├── server-manager.ts  # Python 子进程生命周期管理
│   │   └── preload.ts         # contextBridge IPC
│   ├── src/
│   │   ├── pages/             # 10 个功能页面组件
│   │   ├── components/        # MainLayout、LoadingScreen
│   │   ├── api/               # axios 接口封装（8 个模块）
│   │   ├── store/             # Zustand 全局状态
│   │   └── types/             # TypeScript 类型定义
│   └── package.json
├── scripts/                   # 构建脚本
│   ├── build-all.ps1
│   ├── build-server.ps1
│   └── build-client.ps1
└── docs/
    └── 部署说明.md
```

---

## 🔌 主要 API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/datasets/upload` | 上传数据集 |
| `GET` | `/api/datasets/{id}/preview` | 分页预览数据 |
| `GET` | `/api/datasets/{id}/stats` | 列统计信息 |
| `POST` | `/api/datasets/{id}/split` | 划分训练/测试集 |
| `GET` | `/api/params/schema` | XGBoost 参数元数据 |
| `GET` | `/api/params/recommend` | 规则推荐参数 |
| `POST` | `/api/training/start` | 启动训练任务 |
| `GET` | `/api/training/{id}/progress` | SSE 训练进度流 |
| `GET` | `/api/models/{id}/evaluation` | 评估指标 + 图表数据 |
| `GET` | `/api/models/{id}/shap` | SHAP 详细分析 |
| `POST` | `/api/tuning/start` | 启动 Optuna 调优 |
| `GET` | `/api/tuning/{id}/progress` | SSE 调优进度流 |
| `POST` | `/api/prediction/single` | 单样本预测 |
| `POST` | `/api/prediction/batch` | 批量预测（文件上传）|
| `POST` | `/api/reports/generate` | 生成 HTML 报告 |

完整文档：启动后端后访问 http://127.0.0.1:18899/docs

---

## 🧪 测试数据集

| 编号 | 文件 | 行数 | 任务 | 用途 |
|------|------|------|------|------|
| DS-01 | `titanic_train.csv` | 891 | 二分类 | 分类主测试集 |
| DS-02 | `titanic_test.csv` | 418 | — | 批量预测测试 |
| DS-03 | `boston_housing.csv` | 506 | 回归 | 回归主测试集 |
| DS-04 | `iris.csv` | 150 | 多分类 | 多分类测试 |
| DS-05 | `large_100k.csv` | 100,000 | 回归 | 性能压力测试 |
| DS-06 | `missing_heavy.csv` | 500 | 二分类 | 缺失值处理（~30%缺失）|
| DS-07 | `multisheet.xlsx` | — | — | 多 Sheet 导入测试 |
| DS-08 | `duplicate_rows.csv` | 200 | — | 含 50 条重复行 |

生成命令：`cd server && uv run python tests/create_fixtures.py`

---

## 📋 开发规范

- **分支策略**：`main` 保持可发布状态，功能开发在 `feat/*` 分支
- **提交规范**：遵循 [Conventional Commits](https://www.conventionalcommits.org/)
- **Python**：`uv run` 执行所有命令，禁止直接调用 `python`
- **端口**：后端固定 `127.0.0.1:18899`，仅本地访问
- **代码风格**：Python 使用 ruff，TypeScript 使用 ESLint + Prettier

详见 [开发规范.md](开发规范.md)

---

## 📄 许可证

[MIT License](LICENSE)

---

<p align="center">Built with ❤️ using XGBoost · FastAPI · Electron · React</p>
