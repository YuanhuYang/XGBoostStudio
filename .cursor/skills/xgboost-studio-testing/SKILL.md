---
name: xgboost-studio-testing
description: >-
  XGBoost Studio 全栈测试专家流程：测点清单、后端 API 验收、前端/Electron 策略、
  CI 迭代与 babysit。在编写测试、分析覆盖率缺口、修 CI 或做回归清单时使用。
---

# XGBoost Studio — 测试专家 Skill

## 何时使用

- 需要 **系统列出测点**（新功能或回归）。
- 补充/重构 **自动化测试**（Python 服务端、客户端脚本或未来 Vitest/Playwright）。
- **CI 失败** 或 PR 需要多轮修复时，与 `AGENTS.md` 中的看护流程一致执行。

若用户要求 **全量测试、必须跑命令证明、防假完成**，同时遵循 **`xgboost-studio-test-delivery`**（完成定义 DoD 以该 Skill 为准）。

## 仓库事实（维护时更新本节若结构变化）

- **后端**：`server/`，FastAPI，`main.py` 入口；开发依赖见 `server/pyproject.toml`。
- **客户端**：`client/`，Electron + React + Vite；`npm run dev` / `dev:web` / `preview:web`。
- **现有验收**：`server/tests/acceptance_test.py` 依赖本机已启动的 API（默认 `http://127.0.0.1:18899`），脚本内 `cd server` 后路径相对 `tests/fixtures/`。

## 标准工作流

1. **读变更**：从 PR/需求提炼用户可见行为与 API 契约。
2. **测点表**：按模块列出 功能 / 边界 / 错误 / 非功能（性能、并发、Windows）。
3. **映射到层**：能单测则单测；需 HTTP 则用 **TestClient 或 pytest + 子进程起服务**（二选一，与团队约定）；UI 关键路径再上 E2E。
4. **实现**：测试名表达行为；固定随机种子；测试数据放 `server/tests/fixtures/` 或 `client` 侧约定目录。
5. **执行**：在 `server` 下跑 Python 测试；客户端按 `package.json` scripts；记录 **一条可复制** 的全量命令写入 `AGENTS.md`。
6. **迭代**：失败先最小复现；修产品或修测试要写明原因；避免无断言的「烟雾」滥用。

## PR / CI 看护（与 babysit 对齐）

- 先 **CI 日志与失败 job**，再改代码。
- 每次推送后假设仍需 **下一轮** 检查，直到绿且评论处理完。

## 自检清单（提交前）

- [ ] 新逻辑有关键断言，而非仅 `status_code == 200`。
- [ ] 不依赖本机绝对路径；临时文件用 `tmp_path` 或固定相对路径。
- [ ] 重任务有超时或标记为慢测（若引入 pytest markers）。
- [ ] 文档：`AGENTS.md` 中的命令仍正确。
