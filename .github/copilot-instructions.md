# XGBoost Studio Project Guidelines

## Scope And Source Of Truth
- 这是本仓库唯一的工作区级 AI 指令文件。不要再新增 `AGENTS.md`，避免双重指令冲突。
- 需求与验收以 `需求文档.md`、`验收标准文档.md` 为准。
- 工程流程与提交规范以 `开发规范.md` 为准。
- 部署与环境问题优先参考 `docs/部署说明.md`。

## Architecture
- 本项目是桌面端三层结构：`client/electron`（Electron 主进程）+ `client/src`（React 渲染进程）+ `server`（FastAPI 服务）。
- 前端通过 HTTP/SSE 调用后端，默认地址 `127.0.0.1:18899`。
- 后端分层约束：`routers/` 只做路由与参数校验；业务逻辑放在 `services/`；数据模型在 `db/` 与 `schemas/`。
- 前端分层约束：页面在 `pages/`；HTTP 调用统一放在 `src/api/`；全局状态统一放在 `src/store/appStore.ts`。

## Build And Run
- 后端依赖与命令统一使用 `uv`：
  - 安装依赖：`cd server && uv sync`
  - 启动服务：`cd server && uv run python main.py`
  - 生成测试数据：`cd server && uv run python tests/create_fixtures.py`
  - 模块导入验证：`cd server && uv run python -c "from db.database import init_db; from routers import datasets, params, training, models, tuning, reports, prediction; print('所有模块导入成功')"`
- 前端命令：
  - 安装依赖：`cd client && npm install`
  - 开发运行：`cd client && npm run dev`
- 打包命令（仓库根目录）：
  - 全量打包：`./scripts/build-all.ps1`
  - 后端打包：`./scripts/build-server.ps1`
  - 前端打包：`./scripts/build-client.ps1`

## Coding Conventions
- 修改后端时保持 FastAPI + SQLAlchemy 2.0 + Pydantic 既有模式，不引入并行的新框架。
- 修改前端时保持 React + TypeScript + Zustand + axios 的既有调用路径，不在页面组件中直接散落请求实现。
- 优先最小改动，不重排无关文件，不擅自重命名现有模块。
- 新增 API 时，按现有模块风格同步更新：路由、服务、schema、前端 `src/api` 与 `src/types`。

## Pitfalls
- 不要直接运行 `python ...`，统一使用 `uv run python ...`。
- 开发联调时通常先启动后端，再启动前端，避免前端健康检查失败。
- 端口 `18899` 为默认后端端口，若需变更需同时检查 Electron 侧 server manager 与前端 API 基础地址。
- 运行时数据位于 `%APPDATA%/XGBoostStudio`，排查“数据还在/数据库锁”问题时优先检查该目录。

## Link-First References
- 总览与快速开始：`README.md`
- 开发流程与提交规范：`开发规范.md`
- 功能规格：`需求文档.md`
- 验收标准：`验收标准文档.md`
- 部署、镜像与常见问题：`docs/部署说明.md`
- 历史自动化上下文（仅参考，不作为当前事实来源）：`AGENT_PROMPT.md`