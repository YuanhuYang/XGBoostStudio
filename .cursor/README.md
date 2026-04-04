# `.cursor` 目录说明

本目录为 **Cursor Agent / 规则 / 项目 Skill** 的仓库内配置，可随 git 共享。

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
| `xgboost-studio-role-project-manager` | **项目经理**：排期、优先级、防范围蔓延、与六角色共评 |

### 流程（单迭代内 A→B→C）

| 目录 | 用途 |
|------|------|
| `xgboost-studio-multi-agent-review` | **六角色** 汇总格式；迭代内范围须收缩为 **章程冻结项** |
| `xgboost-studio-rd-implementation` | **研发实现**（输入：指南或 **迭代章程**） |
| `xgboost-studio-testing` | 日常测点、分层、与 `AGENTS.md` 命令对齐 |
| `xgboost-studio-test-delivery` | **测试闭环** + DoD（可 **子集+回归** 按章程） |

### 六专家角色（审视用）

| 目录 | 角色 |
|------|------|
| `xgboost-studio-role-data-analytics` | 数据分析专家 |
| `xgboost-studio-role-model-training` | 模型训练专家 |
| `xgboost-studio-role-ai-student` | AI 专业学生（用户视角） |
| `xgboost-studio-role-product-design` | 产品设计专家 |
| `xgboost-studio-role-architect` | 架构师 |
| `xgboost-studio-role-test-advisor` | 测试专家（审视；执行闭环见 test-delivery） |

## Prompts（`.cursor/prompts/`）

| 文件 | 用途 |
|------|------|
| `multi-agent-review-and-test.md` | **Plan + PM + 多迭代 A/B/C** 一体式可复制提示词（含分段 0/A/B/C/D） |

## 推荐工作流

1. **大需求**：Plan 模式 → **`pm-harness`** + **`role-project-manager`** →《迭代路线图》。  
2. **每迭代**：范围冻结 → **A**（六角色，限本迭代）→ **B**（`rd-implementation`）→ **C**（`test-delivery`，命令=子集+回归）。  
3. **小需求**：新 **Agent 会话** 一条 backlog；避免单上下文跨多迭代。  
4. 命令与约定见仓库根目录 **`AGENTS.md`**。
