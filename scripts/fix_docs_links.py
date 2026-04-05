"""One-off / maintenance: rewrite old doc filenames to docs/CONVENTIONS layout (relative links)."""
from __future__ import annotations

import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOCS = REPO / "docs"

# Old basename / logical name -> path under docs/
OLD_TO_DOCS_REL: dict[str, str] = {
    "迭代章程-G1-信任链与权威数据.md": "iterations/G1/章程.md",
    "验收执行记录-信任链-G1-20260405.md": "iterations/G1/执行记录.md",
    "迭代章程-G2-Auth-1-可复现与运行档案.md": "iterations/G2-Auth-1/章程.md",
    "迭代章程-G2-Auth-2-评估与验证协议.md": "iterations/G2-Auth-2/章程.md",
    "迭代章程-G2-Auth-3-调优可信度.md": "iterations/G2-Auth-3/章程.md",
    "迭代章程-G2-Auth-4-报告方法论表述.md": "iterations/G2-Auth-4/章程.md",
    "迭代章程-G2-报告数据关系与叙事（无LLM优先）.md": "iterations/G2-R1/章程.md",
    "设计-G2-R1-数据叙事API与PDF线框.md": "iterations/G2-R1/设计.md",
    "验收执行记录-G2-Auth-1-20260405.md": "iterations/G2-Auth-1/执行记录.md",
    "验收执行记录-G2-Auth-2-20260405.md": "iterations/G2-Auth-2/执行记录.md",
    "验收执行记录-G2-Auth-3-4-20260406.md": "iterations/G2-Auth-3-4/执行记录.md",
    "验收执行记录-G2-R1-C.md": "iterations/G2-R1/执行记录.md",
    "验收执行记录-20260405.md": "iterations/harness-D2/执行记录.md",
    "验收执行记录-全量验收对齐-20260405.md": "iterations/G1-quality/执行记录.md",
    "迭代规划-G2+模型权威性与专业性.md": "product/迭代规划-G2+.md",
    "验收抽样-F3-分模块.md": "evidence/抽样-F3-分模块.md",
}

# After targets resolve: shorten `[`long-old-name`](relpath)` display text (targets stay unique by folder).
DISPLAY_TEXT = [
    ("[`迭代章程-G1-信任链与权威数据.md`]", "[`章程.md`]"),
    ("[`迭代章程-G2-Auth-1-可复现与运行档案.md`]", "[`章程.md`]"),
    ("[`迭代章程-G2-Auth-2-评估与验证协议.md`]", "[`章程.md`]"),
    ("[`迭代章程-G2-Auth-3-调优可信度.md`]", "[`章程.md`]"),
    ("[`迭代章程-G2-Auth-4-报告方法论表述.md`]", "[`章程.md`]"),
    ("[`迭代章程-G2-报告数据关系与叙事（无LLM优先）.md`]", "[`章程.md`]"),
    ("[`设计-G2-R1-数据叙事API与PDF线框.md`]", "[`设计.md`]"),
    ("[`验收执行记录-G2-Auth-1-20260405.md`]", "[`执行记录.md`]"),
    ("[`验收执行记录-G2-Auth-2-20260405.md`]", "[`执行记录.md`]"),
    ("[`验收执行记录-G2-Auth-3-4-20260406.md`]", "[`执行记录.md`]"),
    ("[`验收执行记录-G2-R1-C.md`]", "[`执行记录.md`]"),
    ("[`验收执行记录-信任链-G1-20260405.md`]", "[`执行记录.md`]"),
    ("[`验收执行记录-全量验收对齐-20260405.md`]", "[`执行记录.md`]"),
    ("[`迭代规划-G2+模型权威性与专业性.md`]", "[`迭代规划-G2+.md`]"),
    ("[`验收抽样-F3-分模块.md`]", "[`抽样-F3-分模块.md`]"),
    ("[`验收执行记录-20260405.md`]", "[`执行记录.md`]"),
]


def rel_to(from_file: Path, docs_under: str) -> str:
    target = (DOCS / docs_under).resolve()
    return os.path.relpath(target, from_file.parent.resolve()).replace("\\", "/")


def replace_old_targets(text: str, from_file: Path) -> str:
    keys = sorted(OLD_TO_DOCS_REL.keys(), key=len, reverse=True)
    for old in keys:
        doc_rel = OLD_TO_DOCS_REL[old]
        r = rel_to(from_file, doc_rel)
        text = text.replace(f"]({old})", f"]({r})")
        text = text.replace(f"](docs/{old})", f"]({r})")
    return text


def shorten_display(text: str) -> str:
    for old, new in DISPLAY_TEXT:
        text = text.replace(old, new)
    return text


BT_DOCS = re.compile(
    r"\[`docs/(product|iterations|evidence|guides)/([^`]+)`\]\(([^)]+)\)"
)


def shorten_backtick_doc_links(text: str, from_file: Path) -> str:
    def repl(m: re.Match[str]) -> str:
        cat, rest = m.group(1), m.group(2)
        target = m.group(3).replace("\\", "/")
        docs_under = f"{cat}/{rest}"
        r = rel_to(from_file, docs_under)
        basename = Path(rest).name
        if target == r or Path(target).name == basename:
            return f"[`{basename}`]({r})"
        return m.group(0)

    return BT_DOCS.sub(repl, text)


def iter_markdown_files() -> list[Path]:
    out: list[Path] = []
    out.extend(sorted(DOCS.rglob("*.md")))
    out.extend(sorted((REPO / ".cursor").rglob("*.md")))
    for name in ("README.md", "AGENTS.md"):
        p = REPO / name
        if p.is_file():
            out.append(p)
    return out


def main() -> None:
    changed = 0
    for path in iter_markdown_files():
        raw = path.read_text(encoding="utf-8")
        text = replace_old_targets(raw, path)
        text = shorten_display(text)
        text = shorten_backtick_doc_links(text, path)
        if text != raw:
            path.write_text(text, encoding="utf-8")
            changed += 1
            print("updated", path.relative_to(REPO))
    print("files changed:", changed)


if __name__ == "__main__":
    main()
