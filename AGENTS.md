# Agent 说明（XGBoost Studio）

本文件给 **人类维护者** 与 **AI Agent** 共用：约定如何在本仓库里做 **长时间、可迭代的测试与 CI 看护**。

## 能力与配置（规则 / Skill / 提示词）

| 能力 | 作用 | 在本仓库中的位置 |
|------|------|------------------|
| **Plan + Harness 规则** | 多迭代/大需求时先 Plan，防范围蔓延 | `.cursor/rules/plan-mode-harness.mdc`（始终应用） |
| **测试专家规则** | 默认对话里也保持风险驱动、分层测试思维 | `.cursor/rules/testing-expert.mdc`（始终应用） |
| **CI/PR 看护** | 改 `.github` 或跟 PR 时遵循评论/冲突/绿循环 | `.cursor/rules/ci-pr-babysit.mdc` |
| **项目 Skill（测试日常）** | 测点、分层、CI 看护配合 | `.cursor/skills/xgboost-studio-testing/SKILL.md` |
| **项目 Skill（Harness 编排）** | 多迭代、路线图、每迭代 A/B/C、商用交付 | `.cursor/skills/xgboost-studio-pm-harness/SKILL.md` |
| **项目 Skill（项目经理）** | 排期、优先级、与六角色共评、防蔓延 | `.cursor/skills/xgboost-studio-role-project-manager/SKILL.md` |
| **项目 Skill（六角色评审）** | 汇总格式；迭代内仅审视冻结范围 | `.cursor/skills/xgboost-studio-multi-agent-review/SKILL.md` |
| **项目 Skill（六角色分角）** | 各角色独立小 Skill，见表下清单 | `.cursor/skills/xgboost-studio-role-*/SKILL.md` |
| **项目 Skill（研发实现）** | 指南后落地功能模块、衔接全量测试 | `.cursor/skills/xgboost-studio-rd-implementation/SKILL.md` |
| **项目 Skill（测试交付闭环）** | 分析→设计→自动化→全量执行→修缺陷 + DoD | `.cursor/skills/xgboost-studio-test-delivery/SKILL.md` |
| **可复制提示词** | Plan + PM + 多迭代 A/B/C（分段 0/A/B/C/D） | `.cursor/prompts/multi-agent-review-and-test.md` |
| **`.cursor` 索引** | Skill / Rule / Prompt 对照（含六角色目录全表） | `.cursor/README.md` |
| **编辑器设置** | 终端长日志、Python 测试发现（工作区） | `.vscode/settings.json` |

**六角色分角目录名**：`xgboost-studio-role-data-analytics`、`xgboost-studio-role-model-training`、`xgboost-studio-role-ai-student`、`xgboost-studio-role-product-design`、`xgboost-studio-role-architect`、`xgboost-studio-role-test-advisor`（审视用；测试落地仍用 `xgboost-studio-test-delivery`）。

全局 **babysit**、**create-rule**、**create-skill** 由 Cursor 安装在用户侧；本仓库用 **规则 + 项目 Skill + 本文** 与之一致，无需重复拷贝官方 Skill 正文。

## 建议命令（随工具链演进请更新）

- **后端（在 `server` 目录）**
  - 安装 **含开发组** 依赖（含 `pytest`、`httpx` 等，见 [`server/pyproject.toml`](server/pyproject.toml) 的 `[dependency-groups] dev`）：`uv sync --all-groups`（推荐）或等价方式安装 dev 组。
  - **API 自动化回归（无需先起服务）**：`uv run pytest`（默认不收集 `tests/acceptance_test.py`，见 `tests/conftest.py` 中 `collect_ignore`）。**G1 信任链**：`tests/test_trust_chain_contract.py`、`tests/test_authority_breast_cancer_pipeline.py`（见 [`docs/迭代章程-G1-信任链与权威数据.md`](docs/迭代章程-G1-信任链与权威数据.md)）。
  - **端到端验收**：需 **API 已监听**（端口以项目配置为准，验收脚本当前为 `18899`）：`python tests/acceptance_test.py`。
  - **有模型时的报告 PDF 快验**（可选）：`python tests/e2e_validate.py`（无模型时跳过报告步骤，见脚本文档字符串与 [`docs/验收追踪.md`](docs/验收追踪.md)）。
- **客户端**：`cd client && npm install && npm run test -- --run && npm run typecheck`（Vitest 最小集：`src/constants/reportSections.test.ts`）。
- **脚本式验收（需已起服务）**：亦可由 GitHub Actions **手动工作流** [`.github/workflows/acceptance.yml`](.github/workflows/acceptance.yml) 执行 `tests/acceptance_test.py`。
- **协作资产**：本仓库包含 [`.cursor/`](.cursor/)（规则、Skill、提示词索引），与本文一并克隆后即可在 Cursor 中共享同一套编排与测试上下文。
- **里程碑 / 发版检查**：[`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)（产品级全量命令与实测摘录模板）。
- **迭代计划 ↔ 验收映射**：[`docs/验收追踪.md`](docs/验收追踪.md)。

## 长时间稳定执行的习惯

- 先 **小范围测试** 再全量；失败保留日志片段与复现命令。
- 产品契约变更（API 字段、错误码）必须 **同步测例或 OpenAPI**。
- Windows 注意：**路径大小写、杀毒锁定 `node_modules` / `.venv`、防火墙首次放行 Node/Python。

## Cursor 中仍需你在 UI 里确认的设置

以下无法仅靠仓库文件替代：

- **信任本工作区**（Workspace Trust）。
- **Agent / 终端**：是否自动批准命令（Settings 里与 Agent 相关项）。
- **防火墙 / 杀毒排除**：按你之前与 Agent 约定的清单在系统里一次性配置。

将本文件与 `.cursor/rules`、`.cursor/skills` 一并提交后，任何克隆仓库的协作者都能共享同一套「测试专家 + 看护」上下文。
