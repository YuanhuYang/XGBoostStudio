# XGBoost Studio 开发者指南

本文档面向参与项目开发的工程师，包含环境配置、代码规范、提交流程、跨平台注意事项。

---

## 📋 目录

1. [开发环境配置](#开发环境配置)
2. [项目结构](#项目结构)
3. [代码规范](#代码规范)
4. [分支与提交](#分支与提交)
5. [跨平台开发](#跨平台开发)
6. [测试与调试](#测试与调试)
7. [常见问题](#常见问题)

---

## 开发环境配置

### Windows 开发环境

#### 1. 安装 Python 3.12

推荐使用 [pyenv-win](https://github.com/pyenv-win/pyenv-win) 或官方 python.org 安装。

```bash
# 验证 Python 版本
python --version  # Python 3.12.x 或更高

# 安装 uv 包管理器
pip install uv
uv --version
```

#### 2. 安装 Node.js 和 npm

从 [nodejs.org](https://nodejs.org) 下载 LTS 版本。

```bash
node --version   # v18+ 或更高
npm --version    # 9+

# 清理 npm 缓存（首次安装）
npm cache clean --force
```

#### 3. 安装 Git

从 [git-scm.com](https://git-scm.com) 下载安装。

```bash
git --version
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

#### 4. 克隆仓库并安装依赖

```bash
git clone https://github.com/YuanhuYang/XGBoostStudio.git
cd XGBoostStudio

# 后端依赖
cd server && uv sync && cd ..

# 前端依赖
cd client && npm install
```

### macOS 开发环境

使用 `brew` 包管理器简化安装：

```bash
# 安装 Homebrew（如尚未安装）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装依赖
brew install python@3.12 node git

# 验证版本
python3 --version  # Python 3.12.x 或更高
npm --version      # 9+

# 安装 uv
pip3 install uv

# 克隆和依赖安装（同上 Windows 步骤 4）
```

### Linux 开发环境（Ubuntu/Debian）

```bash
# 更新包管理器
sudo apt update && sudo apt upgrade -y

# 安装依赖
sudo apt install -y python3.12 python3.12-venv python3-pip node npm git

# 验证版本
python3 --version   # Python 3.12.x 或更高
npm --version       # 9+

# 安装 uv
pip3 install uv

# 克隆和依赖安装（同上 Windows 步骤 4）
```

---

## 项目结构

```
XGBoostStudio/
├── client/                    # 前端（Electron + React + Vite）
│   ├── electron/              # Electron 主进程与配置
│   │   ├── main.ts            # 主窗口创建、IPC 设置
│   │   ├── server-manager.ts  # 后端服务生命周期管理
│   │   └── preload.ts         # 预加载脚本（IPC 上下文隔离）
│   ├── src/
│   │   ├── api/               # HTTP API 客户端（axios）
│   │   ├── pages/             # 页面：Welcome、Documentation、SmartWorkflow、双工作台、各业务页等
│   │   ├── components/        # MainLayout（四模式）、ModeSwitcher、…
│   │   ├── store/             # Zustand appStore（workflowMode 等）
│   │   ├── docs/docSources.ts # 应用内文档打包（glob）
│   │   ├── constants/docsManifest.ts
│   │   ├── types/
│   │   └── styles/
│   ├── package.json
│   └── electron.vite.config.ts
│
├── server/                    # 后端（FastAPI + SQLAlchemy）
│   ├── main.py                # 应用入口，FastAPI 服务器 @ 18899
│   ├── db/
│   ├── routers/               # datasets, params, training, models, tuning, reports, prediction, wizard, automl
│   ├── services/
│   ├── schemas/
│   ├── cli/                   # xs-studio REPL / run
│   ├── tests/
│   └── pyproject.toml
│
├── scripts/                   # Windows 构建：build-all.ps1、build-server.ps1、build-client.ps1 等
│
├── docs/                      # 工程文档（详见 docs/README.md）
│   ├── wiki/                  # 产品/架构知识库（v0.5.x，与代码同步）
│   ├── guides/                # quick-start、本文件、开发规范、部署说明、xs-studio-cli …
│   ├── iterations/            # 迭代章程与执行记录
│   └── archive/legacy-product/  # 历史需求与验收
│
├── README.md
├── .github/copilot-instructions.md
└── .gitignore
```

产品模式与导航细节见 [`docs/wiki/01-product-overview.md`](../wiki/01-product-overview.md)、[`docs/wiki/02-architecture.md`](../wiki/02-architecture.md)。

---

## 代码规范

### Python 后端规范

#### 文件与模块命名
- 文件名：`snake_case`（例：`dataset_service.py`）
- 模块导入：按标准库 → 第三方库 → 本地模块的顺序组织

#### 函数与变量
- 函数：`snake_case`
- 类：`PascalCase`
- 常量：`UPPER_SNAKE_CASE`
- 私有方法/变量：前缀 `_`

#### 类型注解与文档
```python
from typing import Optional, List
from dataclasses import dataclass

@dataclass
class DatasetResponse:
    """数据集响应体"""
    id: str
    name: str
    row_count: int
    columns: List[str]

def process_dataset(
    dataset_id: str,
    method: str = "drop"
) -> DatasetResponse:
    """
    处理数据集中的缺失值。
    
    Args:
        dataset_id: 数据集唯一 ID
        method: 处理方法 ('drop' | 'mean' | 'median')
    
    Returns:
        处理后的数据集响应
    
    Raises:
        ValueError: 如果 method 不被支持
    """
    ...
```

#### 代码风格
- 使用 **4 个空格**缩进
- 每行最长 100 字符
- 导入排序：`isort`
- 格式检查：`black`（可选）

### TypeScript/React 前端规范

#### 文件与组件命名
- 组件文件：`PascalCase`（例：`PDFViewer.tsx`）
- Hook 文件：`camelCase`（例：`useDatasetColumns.ts`）
- 工具函数：`camelCase`（例：`formatDate.ts`）

#### 组件编写
```typescript
import { FC } from 'react'
import styles from './MyComponent.module.css'

interface MyComponentProps {
  title: string
  count?: number
  onClose?: () => void
}

export const MyComponent: FC<MyComponentProps> = ({
  title,
  count = 0,
  onClose
}) => {
  return (
    <div className={styles.container}>
      <h1>{title}</h1>
      <p>Count: {count}</p>
      {onClose && <button onClick={onClose}>Close</button>}
    </div>
  )
}
```

#### Hook 编写
```typescript
import { useEffect, useState } from 'react'

export const useDatasetColumns = (datasetId?: string) => {
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!datasetId) return

    setLoading(true)
    fetchColumns(datasetId)
      .then(setColumns)
      .finally(() => setLoading(false))
  }, [datasetId])

  return { columns, loading }
}
```

#### API 客户端
```typescript
// src/api/datasets.ts
import axios from 'axios'

const API_BASE = 'http://127.0.0.1:18899'

export const getDatasets = async () => {
  const response = await axios.get(`${API_BASE}/datasets`)
  return response.data
}
```

---

## 分支与提交

### Git 工作流

遵循 [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) 模式：

```
main (生产分支)
  ↑
release/* (发布分支)
  ↑
develop (开发分支)
  ↑
feature/*, bugfix/* (功能/修复分支)
```

### 分支命名

- **功能分支**：`feature/功能名` 如 `feature/pdf-viewer`
- **修复分支**：`bugfix/issue名` 如 `bugfix/font-rendering`
- **发布分支**：`release/版本号` 如 `release/0.2.0`

### 提交消息格式

遵循 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### 示例

```
feat(pdf-viewer): 实现 PDF 查看器组件

添加 react-pdf 依赖，实现前端 PDF 预览功能：
- 支持页码导航
- 支持缩放和下载
- 集成到 Report 页面

Closes #123
```

#### Type 类型

- `feat` - 新功能
- `fix` - 修复 bug
- `docs` - 文档更改
- `style` - 格式、缩进（无逻辑变化）
- `refactor` - 代码重构
- `perf` - 性能优化
- `test` - 添加或修改测试
- `chore` - 构建脚本、依赖更新等

#### Scope 示例

- `pdf-viewer`、`report-page`、`dataset-service`、`build-script` 等

### Pull Request 流程

1. 从 `develop` 创建功能分支
2. 定期提交，保持提交历史清晰
3. 完成后推送至远程，创建 PR 至 `develop`
4. 至少 1 人审核，检查：
   - 代码质量与规范
   - 是否有测试覆盖
   - 提交消息是否清晰
5. 通过审核后 Squash 合并至 `develop`

---

## 跨平台开发

### 平台检测

#### Python 后端
```python
import sys

if sys.platform == "win32":
    # Windows 特定处理
    pass
elif sys.platform == "darwin":
    # macOS 特定处理
    pass
else:
    # Linux 特定处理
    pass
```

#### TypeScript/Electron
```typescript
// Electron 主进程
if (process.platform === 'win32') {
  // Windows 特定处理
}

// React 组件
import { is } from '@electron-toolkit/utils'
if (is.dev) {
  // 开发模式
}
```

### 路径处理（关键！）

**❌ 不要硬编码路径分隔符：**
```typescript
// 错：Windows 仅
const path = 'C:\\Users\\data\\app'
```

**✅ 使用 Node.js `path` 模块：**
```typescript
import { join } from 'path'

const basePath = process.env.APPDATA || process.env.HOME
const appDataPath = join(basePath, 'XGBoostStudio')
```

**✅ Python 使用 `pathlib.Path`：**
```python
from pathlib import Path

# 自动处理分隔符
app_data_dir = Path.home() / "XGBoostStudio" / "data"
```

### 数据目录约定

| 平台 | 数据目录 |
|------|---------|
| Windows | `%APPDATA%\XGBoostStudio\` |
| macOS | `~/.xgbooststudio/` |
| Linux | `~/.xgbooststudio/` |

每个平台的目录下结构统一：
```
XGBoostStudio/
├── app.db              # SQLite 数据库
├── datasets/           # 上传的 CSV/Excel 文件
├── models/             # 训练保存的 XGBoost 模型
├── reports/            # 生成的 PDF 报告
└── logs/               # 应用日志
```

---

## 测试与调试

### 启动开发环境

```bash
# 终端 1：后端
python scripts/dev.py --server

# 终端 2：前端（浏览器）
python scripts/dev.py --client

# 终端 3（可选）：Electron（Windows 当前）
cd client && npm run dev
```

### 后端调试

#### FastAPI 自动文档

启动后端后，访问 `http://127.0.0.1:18899/docs` 查看 Swagger UI，可测试所有 API。

#### 添加日志
```python
import logging

logger = logging.getLogger(__name__)

@app.get("/datasets")
def get_datasets():
    logger.info(f"获取数据集列表")
    return {"datasets": []}
```

#### 单元测试
```bash
cd server
uv run pytest tests/
```

#### xs-studio 命令行（AutoML REPL）

一键启后端并进入交互式 CLI，或与已运行的 API 配合使用；详见专用文档：[xs-studio-cli.md](./xs-studio-cli.md)。

```bash
cd server
uv run python -m cli.main
uv run python -m cli.main run ./path/to/data.csv --skip-tuning
```

### 前端调试

#### Chrome DevTools

在浏览器按 F12 打开开发者工具：
- **Console** - 查看 JavaScript 错误和日志
- **Network** - 监控 HTTP 请求（后端 API 调用）
- **Sources** - 设置断点调试 React 代码

#### React DevTools

安装浏览器扩展 [React Developer Tools](https://react-devtools-tutorial.vercel.app/)。

#### Zustand 全局状态调试
```typescript
import { appStore } from '@/store/appStore'

// 手动在控制台查看
console.log(appStore.getState())

// 或使用 Redux DevTools（可选）
```

---

## 常见问题

### Q: 后端启动时"字体未找到"

**原因**：`report_service.py` 字体注册失败（非 Windows 系统）。

**解决**：
1. 确保系统已安装中文字体（macOS：方正黑体、仓颉；Linux：文泉驿）
2. 或使用 Pillow 文本渲染替代（见代码注释）

### Q: 前端无法访问 http://localhost:5173

**检查**：
1. Vite 是否成功启动（控制台无错误）
2. 防火墙是否阻止了端口 5173
3. 试试 `http://127.0.0.1:5173`

### Q: Electron 启动失败

**常见原因**：
1. Node 版本过低，更新至 18+
2. npm 依赖损坏，运行 `npm install` 重装
3. UPX（压缩工具）未安装，仅 Windows 打包需要

### Q: "端口 18899 已占用"

```bash
# 找到占用的进程
# Windows:
netstat -ano | findstr :18899

# macOS/Linux:
lsof -i :18899

# 杀死进程或改用其他端口（见 server/main.py）
```

### Q: 数据库锁定错误 `database is locked`

**原因**：SQLite 在 Windows 网络路径或 USB 驱动器上不稳定。

**解决**：
1. 确保数据目录在本地磁盘（非网络路径）
2. 单进程访问数据库（避免多个 Python 实例）
3. 重启应用

---

## 参考资源

- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2.0](https://docs.sqlalchemy.org/20/)
- [React 官方文档](https://react.dev/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)
- [Electron 安全最佳实践](https://www.electronjs.org/docs/latest/tutorial/security)
- [XGBoost 官方文档](https://xgboost.readthedocs.io/)
