# `.cursor` 目录说明

本目录为 **Cursor Agent / 规则 / 项目 Skill** 的仓库内配置，可随 git 共享。

## 迭代方向怎么选能力？（必读索引）

向 PM 指定 **产品研发 / 质量专项 / 体验优化 / PM 流程 / 需求梳理 / 运维 / 文档 / 发版** 等方向时，先打开 **[`迭代方向与能力映射.md`](迭代方向与能力映射.md)**：内有 **方向 → Subagent / Skill** 速查、**运维专项归口**、**复合方向** 建议。配套 Skill：**`xgboost-studio-iteration-intents`**（分流时 `@`）。

## Rules（`.cursor/rules/`）

| 文件 | 作用 |
|------|------|
| `plan-mode-harness.mdc` | **始终**：多迭代/Harness/大需求时 **先 Plan**，防单上下文吞全量 |
| `testing-expert.mdc` | 始终应用：风险驱动测试思维与分层原则 |
| `ci-pr-babysit.mdc` | 编辑 `.github` 时：PR/CI 看护循环 |

## Skills（`.cursor/skills/`）

### 编排与 Harness

| 目录 | 用途 |
|------|------|
| `xgboost-studio-pm-harness` | **Harness 式多迭代**：路线图、每迭代 A/B/C、商用交付、Agent 切分 |
| `xgboost-studio-role-project-manager` | **项目经理**：排期、优先级、防范围蔓延、与五领域共评 |

### 流程（单迭代内 A→B→C）

| 目录 | 用途 |
|------|------|
| `xgboost-studio-multi-agent-review` | **五领域** 汇总格式；迭代内范围须收缩为 **章程冻结项** |
| `xgboost-studio-rd-implementation` | **研发实现**（输入：指南或 **迭代章程**） |
| `xgboost-studio-testing` | 日常测点、分层、与 [`AGENTS.md`](AGENTS.md) 命令对齐 |
| `xgboost-studio-test-delivery` | **测试闭环** + DoD（可 **子集+回归** 按章程） |
| `xgboost-studio-doc-steward` | **`docs/` 文档管家**：目录/命名/链接对齐 [`CONVENTIONS.md`](../docs/CONVENTIONS.md) |
| `xgboost-studio-release-versioning` | **产品版本号 × 迭代 ID**：SemVer、发布记录、与发版清单衔接 |
| `xgboost-studio-iteration-intents` | **迭代方向分流**：研发/质量/体验/流程/需求/运维等 → Subagent 与 Skill 选路 |

### 五领域 Subagent（审视用；省会话）

| 目录 | 领域 |
|------|------|
| `xgboost-studio-role-data-reproducibility` | 数据与可复现 |
| `xgboost-studio-role-modeling-eval` | 建模与评估 |
| `xgboost-studio-role-product-experience` | 产品体验（流程 + 可学性，合并旧产品与「用户视角」） |
| `xgboost-studio-role-systems-contract` | 系统与契约 |
| `xgboost-studio-role-quality-gate` | 质量门禁（审视；执行闭环见 test-delivery） |

与 `docs/` 签核表列名映射见下表 **「签核列名映射」**。

## Prompts（`.cursor/prompts/`）

| 文件 | 用途 |
|------|------|
| `multi-agent-review-and-test.md` | **Plan + PM + 多迭代 A/B/C** 一体式可复制提示词（含分段 0/A/B/C/D） |

## Commands（`.cursor/commands/`）

| 文件 | 用途 |
|------|------|
| `pm-迭代启动.md` | 斜杠命令：**给项目经理一个方向** → 路线图 + 章程骨架 + **Subagent 执行表**（先规划、默认不写业务代码） |

在 Cursor 命令面板中运行该命令后，在参数区填入 **产品迭代方向**；模型将按 `pm-harness` / PM Skill 拆分任务并强调 **多会话、省 Token**。

## Subagents（`.cursor/agents/*.md`，[官方格式](https://cursor.com/docs/agent/subagents)）

根目录下每个 **带 YAML frontmatter** 的 `.md` 即一个可委派子代理：`name`、`description`、`model`（`inherit` \| `fast`）、`readonly` 等。对话中可用 **`/子代理名`** 显式调用（如 `/pm`、`/data-reproducibility`）。

| 文件 | `/name` | 职责 | model |
|------|---------|------|--------|
| `pm.md` | `pm` | 路线图（可一次多行迭代）、章程、范围冻结、Subagent 排期 | inherit |
| `data-reproducibility.md` | `data-reproducibility` | 数据与可复现审视 | fast |
| `modeling-eval.md` | `modeling-eval` | 建模与评估审视 | fast |
| `product-experience.md` | `product-experience` | 产品体验审视 | inherit |
| `systems-contract.md` | `systems-contract` | 系统与契约审视 | fast |
| `quality-gate.md` | `quality-gate` | 质量门禁审视（非执行 pytest） | fast |
| `consensus-review.md` | `consensus-review` | A 阶段五领域并行编排 | inherit |
| `implementation.md` | `implementation` | B 阶段研发实现 | inherit |
| `test-delivery.md` | `test-delivery` | C 阶段测试与 DoD 证据 | fast |
| `iteration-verifier.md` | `iteration-verifier` | 迭代完成 skeptical 核验 | fast |
| `doc-steward.md` | `doc-steward` | `docs/` 结构、CONVENTIONS、链接与迭代目录 | fast |

**签核列名映射（`docs/`）**

| 习惯列名 | 领域 Subagent | Skill |
|----------|-----------------|--------|
| 数据分析 | `/data-reproducibility` | `xgboost-studio-role-data-reproducibility` |
| 模型训练 | `/modeling-eval` | `xgboost-studio-role-modeling-eval` |
| 产品设计 / 用户可学性 | `/product-experience` | `xgboost-studio-role-product-experience` |
| 架构 | `/systems-contract` | `xgboost-studio-role-systems-contract` |
| 测试顾问 / QA | `/quality-gate`（审视）+ `/test-delivery`（执行） | `xgboost-studio-role-quality-gate` / `xgboost-studio-test-delivery` |

**并行**：A 阶段可对五个领域各开子代理或一次消息内多委派；无关领域由 PM 标 **跳过**。**Token**：子代理正文已要求短输出、`@` 单文件、禁整本 `docs/`。

## 推荐工作流

1. **大需求**：Plan 模式 → **`pm-harness`** + **`role-project-manager`** →《迭代路线图》（可一次多迭代；拆分启发式见 PM Skill）；或运行命令 **`/pm-迭代启动`** 并输入方向。  
2. **每迭代**：范围冻结 → **A**（五领域，**优先 5 子代理 + 汇总**，可用 `/consensus-review` 编排；无关领域由 PM 标 **跳过**）→ **B**（`/implementation`）→ **C**（`/test-delivery`，命令=子集+回归）。  
3. **小需求**：新 **Agent 会话** 一条 backlog；避免单上下文跨多迭代。  
4. 命令与约定见 **[`AGENTS.md`](AGENTS.md)**（本目录）。  
5. **方向与能力总表**：[**`迭代方向与能力映射.md`**](迭代方向与能力映射.md)（与 `xgboost-studio-iteration-intents` 一致）。
