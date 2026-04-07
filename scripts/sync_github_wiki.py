#!/usr/bin/env python3
"""
Export docs/wiki to a flat tree for github.com/<owner>/<repo>.wiki.git.

- Copies each docs/wiki/*.md into --out (except README.md is mirrored as Home.md only).
- Rewrites links: in-wiki .md -> wiki page name (no .md); repo files outside wiki -> github.com/.../blob/... URLs.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import quote

LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")


def blob_url(repo: str, branch: str, repo_rel: str) -> str:
    parts = repo_rel.replace("\\", "/").split("/")
    enc = "/".join(quote(p, safe="") for p in parts)
    return f"https://github.com/{repo}/blob/{branch}/{enc}"


def wiki_page_name(md_basename: str) -> str:
    return md_basename[:-3] if md_basename.lower().endswith(".md") else md_basename


def resolve_target(source_file: Path, target: str, repo_root: Path) -> tuple[Path | None, str]:
    """Returns (absolute resolved path under repo, anchor) or (None, anchor)."""
    anchor = ""
    if "#" in target:
        target, frag = target.split("#", 1)
        anchor = "#" + frag
    if not target or target.startswith(("http://", "https://", "mailto:")):
        return None, anchor
    if target.startswith("#"):
        return None, anchor
    src_dir = source_file.parent
    try:
        resolved = (src_dir / target).resolve()
    except OSError:
        return None, anchor
    try:
        resolved.relative_to(repo_root)
    except ValueError:
        return None, anchor
    return resolved, anchor


def rewrite_markdown(
    text: str,
    source_in_repo: Path,
    repo_root: Path,
    wiki_dir: Path,
    repo: str,
    branch: str,
) -> str:
    wiki_dir = wiki_dir.resolve()
    repo_root = repo_root.resolve()

    def repl(m: re.Match[str]) -> str:
        label, target = m.group(1), m.group(2)
        if target.strip().startswith("#"):
            return m.group(0)
        path_part, anchor = resolve_target(source_in_repo, target, repo_root)
        if path_part is None:
            return m.group(0)
        try:
            rel = path_part.relative_to(repo_root)
        except ValueError:
            return m.group(0)
        rel_s = rel.as_posix()
        if rel_s.startswith("docs/wiki/") and rel.suffix.lower() == ".md":
            name = wiki_page_name(rel.name)
            return f"[{label}]({name}{anchor})"
        return f"[{label}]({blob_url(repo, branch, rel_s)}{anchor})"

    return LINK_RE.sub(repl, text)


def sidebar_md(repo: str, branch: str) -> str:
    tree = blob_url(repo, branch, "docs/wiki")
    lines = [
        "### 知识库导航",
        "",
        f"源码与编辑入口：[docs/wiki]({tree})（CI 同步，勿在 Wiki 直接改正文）",
        "",
        "- [首页](Home)",
        "- [01 产品概览](01-product-overview)",
        "- [02 架构与技术栈](02-architecture)",
        "- [03 数据分析](03-data-analysis)",
        "- [04 模型训练](04-model-training)",
        "- [05 自动调优](05-auto-tuning)",
        "- [06 模型评估](06-model-evaluation)",
        "- [07 PDF 报告](07-pdf-report)",
        "- [08 AutoML 向导](08-automl-wizard)",
        "- [09 数据质量与智能清洗](09-data-quality-unified-and-smart-clean)",
        "- [10 Windows 分发](10-windows-distribution)",
        "- [11 macOS / Linux 分发](11-mac-linux-distribution)",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(description="Prepare GitHub Wiki tree from docs/wiki.")
    p.add_argument("--repo", required=True, help="owner/name, e.g. YuanhuYang/XGBoostStudio")
    p.add_argument("--branch", default="main", help="branch for blob links (default: main)")
    p.add_argument(
        "--out",
        type=Path,
        required=True,
        help="output directory (wiki repo root)",
    )
    p.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="repository root (default: parent of scripts/)",
    )
    args = p.parse_args()

    script_dir = Path(__file__).resolve().parent
    repo_root = (args.repo_root or script_dir.parent).resolve()
    wiki_src = repo_root / "docs" / "wiki"
    if not wiki_src.is_dir():
        raise SystemExit(f"missing wiki source: {wiki_src}")

    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    notice = (
        f"> **同步说明**：正文以主仓库 [`docs/wiki`]({blob_url(args.repo, args.branch, 'docs/wiki')}) 为编辑来源；"
        "本 Wiki 由 GitHub Actions 推送，请勿在 Wiki 网页上直接修改正文（会被覆盖）。\n\n"
    )

    for path in sorted(wiki_src.glob("*.md")):
        if path.name == "README.md":
            continue
        rel = path.relative_to(repo_root)
        text = path.read_text(encoding="utf-8")
        text = rewrite_markdown(text, path, repo_root, wiki_src, args.repo, args.branch)
        (out / path.name).write_text(text, encoding="utf-8", newline="\n")

    readme = wiki_src / "README.md"
    home_body = rewrite_markdown(
        readme.read_text(encoding="utf-8"),
        readme,
        repo_root,
        wiki_src,
        args.repo,
        args.branch,
    )
    (out / "Home.md").write_text(notice + home_body, encoding="utf-8", newline="\n")

    (out / "_Sidebar.md").write_text(sidebar_md(args.repo, args.branch), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
