# Agent 说明（XGBoost Studio）

> 与 Cursor 相关的规则、Skill、Commands 同目录；**不在仓库根目录** 放置 `AGENTS.md`，以便你使用其他 Vibe Coding 工具时在根目录自由放置其约定文件（如各工具官方推荐的文件名）。

本文件给 **人类维护者** 与 **AI Agent** 共用：约定如何在本仓库里做 **长时间、可迭代的测试与 CI 看护**。

**迭代方向分流**（研发 / 质量 / 体验 / PM 流程 / 需求 / 运维 / 文档等 → 用哪个 Subagent）：见 **[`迭代方向与能力映射.md`](迭代方向与能力映射.md)**，Skill **`xs-iteration-intents`**。

## 文档与默认上下文（索引）

- **日常研发 / 下一迭代**：优先 [`需求文档.md`](../docs/product/需求文档.md)、[`验收标准文档.md`](../docs/product/验收标准文档.md)、[`迭代计划.md`](../docs/product/迭代计划.md)（按需）、[`功能需求与验收状态.md`](../docs/product/功能需求与验收状态.md)、[`验收-AC证据矩阵.md`](../docs/product/验收-AC证据矩阵.md)、[`验收追踪.md`](../docs/product/验收追踪.md)；**签核与多视角术语**见 [`项目管理术语-五领域.md`](../docs/product/项目管理术语-五领域.md)；章程见 **`docs/iterations/<迭代ID>/章程.md`**（只打开与当期任务相关的迭代子目录）。
- **执行记录**（各迭代目录下的 **`执行记录.md`**）、**跨迭代抽样**（[`抽样-F3-分模块.md`](../docs/evidence/抽样-F3-分模块.md)）为 **审计与全量验收留痕**；若配置了 Cursor 忽略规则，可避免默认索引整树 `docs/`，需要时仍用 **`@`** 精确路径打开。

## 能力与配置（规则 / Skill / 提示词）

| 能力 | 作用 | 在本仓库中的位置 |
|------|------|------------------|
| **Plan + Harness 规则** | 多迭代/大需求时先 Plan，防范围蔓延 | `.cursor/rules/plan-mode-harness.mdc`（始终应用） |
| **测试专家规则** | 默认对话里也保持风险驱动、分层测试思维 | `.cursor/rules/testing-expert.mdc`（始终应用） |
| **CI/PR 看护** | 改 `.github` 或跟 PR 时遵循评论/冲突/绿循环 | `.cursor/rules/ci-pr-babysit.mdc` |
| **项目 Skill（测试日常）** | 测点、分层、CI 看护配合 | `.cursor/skills/xs-testing/SKILL.md` |
| **项目 Skill（Harness 编排）** | 多迭代、路线图、每迭代 A/B/C、商用交付 | `.cursor/skills/xs-pm-harness/SKILL.md` |
| **项目 Skill（项目经理）** | 排期、优先级、与五领域共评、防蔓延 | `.cursor/skills/xs-role-project-manager/SKILL.md` |
| **项目 Skill（多领域评审）** | 汇总格式；迭代内仅审视冻结范围 | `.cursor/skills/xs-multi-agent-review/SKILL.md` |
| **项目 Skill（五领域分角）** | 各领域独立 Skill，见 `.cursor/README.md` 表 | `.cursor/skills/xs-role-*/SKILL.md` |
| **项目 Skill（研发实现）** | 指南后落地功能模块、衔接全量测试 | `.cursor/skills/xs-rd-implementation/SKILL.md` |
| **项目 Skill（测试交付闭环）** | 分析→设计→自动化→全量执行→修缺陷 + DoD | `.cursor/skills/xs-test-delivery/SKILL.md` |
| **项目 Skill（文档管家）** | `docs/` 目录结构、命名、链接与迭代目录对齐 [`CONVENTIONS.md`](../docs/CONVENTIONS.md) | `.cursor/skills/xs-doc-steward/SKILL.md` |
| **项目 Skill（版本与发布）** | 产品版本号（SemVer）与迭代 ID、[`版本与发布.md`](../docs/product/版本与发布.md) | `.cursor/skills/xs-release-versioning/SKILL.md` |
| **项目 Skill（迭代方向分流）** | 方向意图 → Subagent / Skill 选路 | `.cursor/skills/xs-iteration-intents/SKILL.md` |
| **项目 Skill（流程闸口）** | 防文档-only 空转、算法误改、架构无 ADR、UTF-8/首屏损坏 | `.cursor/skills/xs-skill-guardrails/SKILL.md` |
| **可复制提示词** | Plan + PM + 多迭代 A/B/C（分段 0/A/B/C/D） | `.cursor/prompts/multi-agent-review-and-test.md` |
| **`.cursor` 索引** | Skill / Rule / Prompt / Commands / Subagent 手卡 | `.cursor/README.md` |
| **斜杠命令：PM 迭代启动** | 给项目经理一个方向 → 路线图 + 章程骨架 + Subagent 执行表 | `.cursor/commands/pm-迭代启动.md` |
| **Subagents** | 官方 YAML 子代理列表与 `/name`、签核映射 | `.cursor/README.md` § Subagents |
| **编辑器设置** | 终端长日志、Python 测试发现（工作区） | `.vscode/settings.json` |

**五领域分角目录名**（审视用；签核表旧列名映射见 `.cursor/README.md` § Subagents）：`xs-role-data-reproducibility`、`xs-role-modeling-eval`、`xs-role-product-experience`、`xs-role-systems-contract`、`xs-role-quality-gate`（测试落地仍用 `xs-test-delivery`）。

全局 **babysit**、**create-rule**、**create-skill** 由 Cursor 安装在用户侧；本仓库用 **规则 + 项目 Skill + 本文** 与之一致，无需重复拷贝官方 Skill 正文。

## 建议命令（随工具链演进请更新）

- **后端（在 `server` 目录）**
  - 安装 **含开发组** 依赖（含 `pytest`、`httpx` 等，见 [`server/pyproject.toml`](../server/pyproject.toml) 的 `[dependency-groups] dev`）：`uv sync --all-groups`（推荐）或等价方式安装 dev 组。
  - **API 自动化回归（无需先起服务）**：`uv run pytest`（默认不收集 `tests/acceptance_test.py`，见 `server/tests/conftest.py` 中 `collect_ignore`）。**G1 信任链**：`tests/test_trust_chain_contract.py`、`tests/test_authority_breast_cancer_pipeline.py`（章程：[`章程.md`](../docs/iterations/G1/章程.md)，按需查阅）。
  - **端到端验收**：需 **API 已监听**（端口以项目配置为准，验收脚本当前为 `18899`）：`python tests/acceptance_test.py`。
  - **有模型时的报告 PDF 快验**（可选）：`python tests/e2e_validate.py`（无模型时跳过报告步骤，见脚本文档字符串与 [`验收追踪.md`](../docs/product/验收追踪.md)）。
- **客户端**：`cd client && npm install && npm run test -- --run && npm run typecheck`（Vitest 最小集：`src/constants/reportSections.test.ts`）。
- **脚本式验收（需已起服务）**：亦可由 GitHub Actions **手动工作流** [`.github/workflows/acceptance.yml`](../.github/workflows/acceptance.yml) 执行 `tests/acceptance_test.py`。
- **协作资产**：本目录（`.cursor/`）含规则、Skill、提示词、**Commands**、**Subagents**（`.cursor/agents/*.md`，见 [`.cursor/README.md`](README.md) § Subagents）；与仓库文档一并克隆后，在 Cursor 中可共享同一套编排与测试上下文。
- **一页迭代启动**：在 Cursor 运行命令 **`/pm-迭代启动`**（或打开 [`.cursor/commands/pm-迭代启动.md`](commands/pm-迭代启动.md)），在参数中写入 **产品方向**；项目经理角色将拉通 Harness 流程并给出 **按会话拆分的 Subagent 表**，五领域审视建议 **5 次短会话 + 1 次汇总**（无关领域可跳过，见 [`.cursor/agents/consensus-review.md`](agents/consensus-review.md)），以控制上下文与 Token。
- **里程碑 / 发版检查**：[`RELEASE_CHECKLIST.md`](../docs/product/RELEASE_CHECKLIST.md)（产品级全量命令与实测摘录模板）。
- **迭代计划 ? 验收映射**：[`验收追踪.md`](../docs/product/验收追踪.md)。

## 长时间稳定执行的习惯

- 先 **小范围测试** 再全量；失败保留日志片段与复现命令。
- 产品契约变更（API 字段、错误码）必须 **同步测例或 OpenAPI**。
- Windows 注意：**路径大小写、杀毒锁定 `node_modules` / `.venv`、防火墙首次放行 Node/Python**。

## Cursor 中仍需你在 UI 里确认的设置

以下无法仅靠仓库文件替代：

- **信任本工作区**（Workspace Trust）。
- **Agent / 终端**：是否自动批准命令（Settings 里与 Agent 相关项）。
- **防火墙 / 杀毒排除**：按你之前与 Agent 约定的清单在系统里一次性配置。

将 `.cursor/`（含本文件、`rules/`、`skills/` 等）与 `docs/` 一并提交后，任何克隆仓库的协作者都能共享同一套「测试专家 + 看护」上下文。
