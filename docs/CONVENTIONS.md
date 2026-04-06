# docs/ 文档与编码规范

> 适用范围：全仓库文本文件（包含 docs/、.cursor/、client/、server/、scripts/）。
> 最后更新：2026-04-06

## 1. 编码与换行（强制）

1. 所有文本文件必须使用 UTF-8（无 BOM）。
2. 禁止提交 GBK、GB2312、ANSI 等本地编码文件。
3. 所有文本文件统一 LF 换行，禁止 CRLF。
4. 二进制文件（图片、压缩包、字体、可执行文件等）不适用本节。

## 2. 目录结构（docs/）

| 目录 | 用途 | Cursor Skill @ 引用 |
|------|------|---------------------|
| product/ | 需求、规格、验收、发布文档 | - |
| guides/ | 工程指南与流程规范 | - |
| iterations/ | 按迭代 ID 组织的过程文档 | - |
| evidence/ | 跨迭代质量和验证证据 | - |

## 3. 文件命名

1. 新增文档文件名优先使用英文或拼音（推荐）。
2. 会议和日志建议使用日期命名，如 2026-04-01-meeting.md。
3. 历史中文文件名允许保留，不强制迁移；若迁移，必须同步修复仓库内链接。
4. docs/iterations/<ID>/ 下推荐使用：章程.md、设计.md、执行记录.md、证据.md。

## 4. 与 Agent Skill 配合

在文档中引用 Skill 时，建议使用明确动作映射，例如：

```markdown
| 操作名称 | Skill |
|----------|-------|
| 风险评审 | @xs-role-quality-gate |
```

## 5. 仓库落地配置（建议纳入代码库）

在仓库根目录添加 .gitattributes：

```gitattributes
*.md text eol=lf
*.mdc text eol=lf
*.py text eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.toml text eol=lf
*.sh text eol=lf
*.ps1 text eol=lf
```

## 6. 提交前检查（强制）

提交前必须执行：

```powershell
uv run python scripts/check_encoding_integrity.py --root .
```

判定规则：
1. 命令退出码为 0 才允许提交。
2. 若发现 non-utf8、replacement-char、mojibake-hint，必须先修复再提交。

## 7. CI 检查（强烈建议）

在 CI 中增加同一命令，作为 PR 必过检查项：

```bash
uv run python scripts/check_encoding_integrity.py --root .
```

## 8. 常见乱码排查

1. 先运行检查脚本定位具体文件和行号。
2. 在编辑器中将目标文件重新保存为 UTF-8（无 BOM）。
3. 再次运行检查脚本，确认结果为无异常。

## 9. 链接规范

1. 内部链接使用相对路径。
2. 避免使用本地绝对路径。
3. 文档迁移后必须修复所有受影响链接。
