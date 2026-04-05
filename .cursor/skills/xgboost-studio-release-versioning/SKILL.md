---
name: xgboost-studio-release-versioning
description: >-
  XGBoost Studio 产品版本号（SemVer）与工程迭代 ID 的关联：发布记录、版本文件同步、
  与项目经理路线图及 RELEASE_CHECKLIST 的衔接。在发版、bump 版本、启动迭代需对齐版本线时使用。
---

# XGBoost Studio — 发布与版本号 Skill

## 必读

- **[`docs/product/版本与发布.md`](../../../docs/product/版本与发布.md)**（概念 + 发布记录表）
- **[`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) §7**

## 核心规则

1. **两个命名空间**：**产品版本号** = 对用户/契约（`package.json` / `pyproject.toml`）；**迭代 ID** = 对工程与 `docs/iterations/<ID>/`。互不嵌套命名。
2. **关联方式**：用 **`docs/product/版本与发布.md`** 里的表登记「某版本包含哪些迭代」；允许多迭代合并发版、或一迭代跨多补丁。
3. **单一真相**：发版前 **客户端与后端 `version` 字段一致**（或团队明确以一侧为准并写进 `版本与发布.md` 备注）。
4. **Git 标签**（可选）：`vX.Y.Z` 与产品版本对齐，便于回溯。

## 何时 @ 本 Skill

- 用户问「这轮迭代对应哪个产品版本」。
- 准备 **发版** 或 **bump SemVer**。
- **`/pm-迭代启动`** 后需补充 **目标版本线** 或「不发版」的声明。

## 不负责（边界）

- **不** 替代项目经理做商业排期与范围冻结。
- **不** 替代 `xgboost-studio-test-delivery` 的测试 DoD；发版仍走 **[`RELEASE_CHECKLIST.md`](../../../docs/product/RELEASE_CHECKLIST.md)**。

## 自检（发版相关改动后）

- [ ] `client/package.json` 与 `server/pyproject.toml` 版本一致（或备注例外）。
- [ ] `docs/product/版本与发布.md` 表已追加或更新。
- [ ] README 徽章等若展示版本，与上表一致（避免漂移）。
