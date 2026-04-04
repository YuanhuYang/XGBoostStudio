# XGBoost Studio

<p align="center">
  <strong>无需编写代码，全流程可视化完成 XGBoost 建模、调优、解释与预测</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" />
  <img src="https://img.shields.io/badge/platform-Windows%20✓-success" />
  <img src="https://img.shields.io/badge/platform-macOS-yellowgreen" />
  <img src="https://img.shields.io/badge/platform-Linux-yellowgreen" />
  <img src="https://img.shields.io/badge/python-3.12-3776AB" />
  <img src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

## ✨ 功能亮点

| 模块 | 能力 |
|------|------|
| 🤖 **智能向导** | 6 步全流程引导 + 自动参数推荐 + 一键生成 PDF 报告 |
| 📥 **数据导入** | 拖拽上传 CSV/Excel，自动质量评分，智能去重与缺失检测 |
| 🔍 **特征分析** | 分布检验、相关性热力图、多重共线性 VIF、目标关系分析 |
| 🛠 **特征工程** | 缺失值填充、异常值处理、编码、缩放、PCA 降维、数据划分 |
| ⚙️ **参数配置** | 9 个 XGBoost 核心超参可视化配置 + 规则推荐引擎 |
| 🚀 **模型训练** | 实时进度流 + 训练/验证曲线 + 过拟合预警 |
| 📊 **模型评估** | 混淆矩阵、ROC 曲线、残差散点、SHAP 重要性、学习曲线 |
| 🎯 **超参优化** | Optuna TPE/随机搜索 + 实时 Trial 监控 |
| 🗂 **模型管理** | 注册表、版本对比、导出 |
| 📄 **分析报告** | PDF 前端预览 + 下载 + 自定义章节 |
| 🤔 **交互预测** | 单样本表单 + 批量文件预测 |

---

## 🎯 三种用户体验

- **向导模式** 🎯 — 6 步完成全流程（业务人员）
- **学习模式** 📚 — 参数教学 + 实验对比（学生）
- **专家模式** ⚙️ — 完整侧边栏 + 精细控制（工程师）

---

## 🚀 使用方式

### ① Windows 用户（推荐）
```
1. 下载 XGBoost-Studio-Setup-x.x.x.exe
2. 双击安装（自动内置 Python + 全部依赖，完全离线）
3. 从桌面启动
```

### ② 开发者（源码）
```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio

# 方式 A：Python 脚本启动（跨平台）
python scripts/dev.py --all

# 方式 B：分别启动
# 终端 1: python scripts/dev.py --server  # 后端 (127.0.0.1:18899)
# 终端 2: python scripts/dev.py --client  # 前端 (localhost:5173)
```

### ③ Linux 容器部署
```bash
docker-compose up -d
# 访问 http://localhost:5000
```

详见 [📖 快速开始指南](docs/quick-start.md)

---

## 📚 核心文档

| 文档 | 读者 | 内容 |
|------|------|------|
| 🚀 [快速开始](docs/quick-start.md) | 所有人 | 三种启动方式 + 常见问题 |
| 👨‍💻 [开发者指南](docs/developers-guide.md) | 工程师 | 环境配置、代码规范、跨平台开发 |
| 📋 [功能需求](docs/requirements.md) | 产品 | 完整功能规格与 API 设计 |
| ✅ [验收标准](docs/acceptance-criteria.md) | QA | 测试用例与验收条件 |
| 🐳 [部署说明](docs/deployment.md) | DevOps | 生产部署、Docker、问题排查 |

---

## 🌍 支持平台进度

| 特性 | Windows | macOS | Linux |
|------|---------|-------|-------|
| Electron 应用 | ✅ | 🔄 进行中 | 🔄 进行中 |
| Web 浏览器 | ✅ | ✅ | ✅ |
| 后端服务 | ✅ | ✅ | ✅ |
| Docker 容器 | ✅ | ✅ | ✅ |
| PDF 前端预览 | ✅ | ✅ | ✅ |

---

## 🏗 技术栈

**前端**：Electron 28 + React 18 + TypeScript + Ant Design 5 + ECharts 5 + react-pdf  
**后端**：Python 3.12 + FastAPI + XGBoost + Optuna + SHAP + Pandas + reportlab  
**数据**：SQLite 本地存储

---

## 💡 FAQ

**Q: 无需安装 Python 吗？**  
A: ✅ Windows 用户无需。下载 exe 后双击安装，已内置全部依赖。

**Q: 数据存在哪里？**  
A: `%APPDATA%\XGBoostStudio\` (Windows) 或 `~/.xgbooststudio/` (macOS/Linux)

**Q: 支持多用户协作吗？**  
A: 目前为单机本地应用。可修改源码切换数据库为 PostgreSQL。

更多 → [快速开始FAQ](docs/quick-start.md#常见问题) 或 [开发者FAQ](docs/developers-guide.md#常见问题)

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请遵循 [开发规范](docs/developers-guide.md)

---

## 📄 许可证

MIT License — 自由使用、修改、分发

---

**GitHub**: [YuanhuYang/XGBoostStudio](https://github.com/YuanhuYang/XGBoostStudio)  
**Updated**: 2026-04-04 | **v0.2.0-alpha**
