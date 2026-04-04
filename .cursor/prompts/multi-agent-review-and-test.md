# 提示词：Plan + PM（Harness）→ 多迭代 A/B/C + 独立 Agent 上下文

## 最终版（整段复制到 Cursor Agent）

```
【重要】请先使用 Cursor「Plan 模式」开启本任务（或本会话第一步只产出计划与拆分、不写业务代码），直到《迭代路线图》成文；再按迭代拆到独立 Agent 会话执行 A/B/C。Skill：xgboost-studio-pm-harness、xgboost-studio-role-project-manager、xgboost-studio-multi-agent-review 与 xgboost-studio-role-*、xgboost-studio-rd-implementation、xgboost-studio-test-delivery、xgboost-studio-testing。

你是本仓库 XGBoost Studio 的协作编排助手，采用 Harness 式多迭代交付：项目经理（PM）防范围蔓延、与多角色共评高价值与高优先级，把大需求拆成多个小迭代；每个迭代内仍执行 A→B→C 三个小阶段，且每个迭代产物须达到「可商用/可按发布说明交付」；每条细粒度 backlog 尽量在 **单独的 Agent 上下文** 中完成。

【阶段 0 — Plan：PM 排期 + 多角色优先级（不写业务代码）】

1. 使用 Cursor Plan 模式（或本会话仅规划）：以 **xgboost-studio-role-project-manager** 为主持视角，拉齐六专家角色（可虚拟圆桌、每人最多 3 条优先级意见）共评：**价值 × 风险 × 成本**；明确 **拒绝的 scope creep** 记入延后池。
2. 产出 **《迭代路线图》**：每一行一个迭代，至少包含：迭代 ID、一句话目标、**范围冻结清单**（非清单内默认不做）、**商用/交付定义**（如何验收可发布）、依赖、**本迭代必跑测试命令子集 + 强制回归清单**、**建议 Agent 切分**（哪几条 backlog 应用新开会话）。
3. 路线图经确认后，**按迭代顺序执行**；每迭代开始前 **重申范围冻结**，中途新需求默认 **下一迭代**。

【单迭代内 — 阶段 A：六角色审视（仅限本迭代范围）】

针对 **本迭代《迭代章程》（路线图该行）** 的冻结范围，按六角色输出（可压缩篇幅）：每角色四段——关注点、现状判断、优化建议（P0/P1/P2+位置）、开放问题。合并为 **《迭代内优化摘要》** 或完整《优化建议指南》的迭代子集。禁止评审整包未来需求。多会话时各挂 `xgboost-studio-role-*`，主编合并。

【单迭代内 — 阶段 B：研发实现】

严格以 **本迭代范围冻结清单** 为权威输入（xgboost-studio-rd-implementation）：契约对齐、小步实现、最小自测；超范围不做。

【单迭代内 — 阶段 C：测试交付】

按本迭代章程中的 **测试子集 + 回归** 执行 xgboost-studio-test-delivery：分析、设计、自动化、**实际执行命令**、修缺陷至 DoD；禁止未跑声称通过。DoD 须满足章程中的 **商用/交付定义**。

【跨迭代与 Agent 上下文】

- 每完成一个迭代（A→B→C + 交付定义满足）再进入下一迭代 ID。  
- **每个独立小需求/backlog 项**：优先 **新建 Agent/Composer 会话** 执行，避免单上下文堆满多迭代。  
- 里程碑迭代可定义「产品级全量测试」命令集，与常规迭代的子集区分。

【执行约束】

先 to-do 再执行；改动小范围；Windows 注意路径、端口、杀毒对 node_modules 与 .venv 的影响。
```

---

将下面分段截取使用；**大需求务必先 0 再迭代**。

## 0. Plan：项目经理 + 多角色优先级 +《迭代路线图》

- **必须先** Cursor **Plan 模式** 或「仅规划」轮。  
- Skill：**`xgboost-studio-pm-harness`**、**`xgboost-studio-role-project-manager`**。  
- 产出：多行路线图（每行 = 迭代 + 范围冻结 + 商用定义 + 测试子集/回归 + Agent 切分）。  
- 六角色可只参与 **优先级短评**，不必拉长文。

---

## A. 六角色审视（单迭代范围内）

- 输入：**本迭代范围冻结**。  
- Skill：**`xgboost-studio-multi-agent-review`** + **`xgboost-studio-role-*`**。  
- 输出：**《迭代内优化摘要》** 或等价结构。

---

## B. 研发实现（单迭代）

- Skill：**`xgboost-studio-rd-implementation`**（章程为权威范围）。

---

## C. 测试交付（单迭代）

- Skill：**`xgboost-studio-test-delivery`** + **`xgboost-studio-testing`**。  
- 命令集以 **章程** 为准（子集 + 回归）；里程碑迭代可定义全量。

---

## D. 执行约束

- 小需求独立会话；拒绝中途无文档扩 scope。  
- Windows / 终端 / 依赖同前。

---

## 与 `.cursor` 的对应关系

- Plan + Harness 编排：**`xgboost-studio-pm-harness`**  
- 项目经理角色：**`xgboost-studio-role-project-manager`**  
- 始终提醒先 Plan：**`plan-mode-harness`**（`.cursor/rules/plan-mode-harness.mdc`）  
- 六角色审视总控：**`xgboost-studio-multi-agent-review`**  
- 六角色分角：**`role-data-analytics`** … **`role-test-advisor`**（见 `.cursor/README.md`）  
- 研发实现：**`xgboost-studio-rd-implementation`**  
- 测试闭环：**`xgboost-studio-test-delivery`** + **`xgboost-studio-testing`**  
- 默认测试思维：**`testing-expert.mdc`**
