---
name: xgboost-studio-doc-steward
description: >-
  XGBoost Studio 文档管家：`docs/` 目录结构、迭代子目录、固定文件名、相对链接与
  迁移后索引一致性。在整理文档树、新开迭代目录、批量修 Markdown 链接、对齐 CONVENTIONS 时使用。
---

# XGBoost Studio — 文档管家 Skill

## 唯一规范来源

- 先读并遵守 **[`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md)**（顶层目录、`iterations/<迭代ID>/`、固定文件名、禁止用日期作主文件名等）。
- 人类与 Agent 入口：**[`docs/README.md`](../../../docs/README.md)**。

## 何时使用

- **新开迭代**：项目经理给出 **迭代 ID** → 在 `docs/iterations/<ID>/` 下创建 **`章程.md`**（必选），按需 **`设计.md`**、**`执行记录.md`**。
- **搬迁或重命名** 文档后：全仓库更新 **Markdown 相对链接**（可用仓库内 `scripts/fix_docs_links.py` 作基线，再人工扫一遍）。
- **审查**：某路径是否应落在 `product/` vs `guides/` vs `iterations/` vs `evidence/`。
- **禁止**：把需求营销名、口语全称写进 **文件名**；需求标题写在 **文件内章节**。

## 工作流

1. **对照 CONVENTIONS** 确认目标路径与固定文件名。
2. **移动或新增文件** 后，从引用方更新链接：优先 **相对路径**（同目录、跨 `../`）。
3. **链接显示文本**：迭代内文档在正文里用稳定短名（如 `` `章程.md` ``、`` `执行记录.md` ``），用 **路径** 区分不同迭代。
4. **产品基线**（`product/`）里引用迭代资产时，使用 `` [`章程.md`](../iterations/<ID>/章程.md) `` 等形式。
5. 若有批量旧文件名（历史带日期）：目标统一为 **`执行记录.md`** 落在对应迭代目录；日期写在 **正文或 Git 历史**，不写回文件名。

## 与项目经理的配合

- **`/pm`** 或 **`/pm-迭代启动`** 产出迭代 ID 后，文档管家可 **仅创建空骨架文件**（Front matter 可选）并回链到 `docs/product/迭代计划.md` 若项目经理要求。
- **产品版本号** 与迭代的对应由项目经理决策；表格式见 **[`docs/product/版本与发布.md`](../../../docs/product/版本与发布.md)**。可按 PM 指示 **追加发布记录行**，细则 **`xgboost-studio-release-versioning`**。
- 不向对话粘贴整棵 `docs/`；只给 **路径 + 章节**。

## 自检（提交前）

- [ ] 无 `docs/` 根目录堆积「一次性长文件名」（除 CONVENTIONS 已列例外）。
- [ ] 无断链：在 VS Code / CI 若有 markdown 检查则通过；至少抽点 `product/迭代计划.md`、`product/功能需求与验收状态.md`。
- [ ] `docs/README.md` 索引表与真实文件一致（若新增顶层类文档）。
