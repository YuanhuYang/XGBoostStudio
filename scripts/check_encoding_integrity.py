#!/usr/bin/env python3
"""Scan repository files for potential encoding corruption before committing."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_EXCLUDE_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
}

BINARY_EXTENSIONS = {
    ".7z",
    ".a",
    ".avi",
    ".bmp",
    ".class",
    ".dll",
    ".dylib",
    ".eot",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jar",
    ".jpeg",
    ".jpg",
    ".lib",
    ".lock",
    ".m4a",
    ".mov",
    ".mp3",
    ".mp4",
    ".o",
    ".obj",
    ".otf",
    ".pdf",
    ".png",
    ".pyc",
    ".pyd",
    ".pyo",
    ".so",
    ".svgz",
    ".tar",
    ".ttf",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".xz",
    ".zip",
}

TEXT_EXTENSIONS = {
    ".bat",
    ".c",
    ".cc",
    ".cfg",
    ".cmd",
    ".conf",
    ".cpp",
    ".css",
    ".csv",
    ".env",
    ".gitignore",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".ini",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".ps1",
    ".py",
    ".pyi",
    ".rb",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".svg",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

MOJIBAKE_TOKENS = (
    "\u00c3",
    "\u00c2",
    "\u00e2\u20ac",
    "\u00e2\u20ac\u201d",
    "\u00e2\u20ac\u201c",
    "\u00e2\u20ac\u0153",
    "\u00e2\u20ac\u009d",
    "\u00f0\u0178",
    "\u00ef\u00bb\u00bf",
)


@dataclass
class Issue:
    path: Path
    kind: str
    detail: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check files for encoding corruption (UTF-8 decode errors, mojibake hints)."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Project root to scan (default: current directory).",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=1_000_000,
        help="Skip files larger than this many bytes (default: 1000000).",
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include hidden directories/files that are excluded by default.",
    )
    return parser.parse_args()


def should_skip_path(path: Path, root: Path, include_hidden: bool) -> bool:
    try:
        relative_parts = path.relative_to(root).parts
    except ValueError:
        return True

    for part in relative_parts:
        if part in DEFAULT_EXCLUDE_DIRS:
            return True
        if not include_hidden and part.startswith(".") and part not in {".github"}:
            return True
    return False


def is_likely_binary(raw: bytes) -> bool:
    if not raw:
        return False
    if b"\x00" in raw:
        return True

    control_count = 0
    for byte in raw:
        if byte in (9, 10, 13):
            continue
        if byte < 32 or byte == 127:
            control_count += 1
    return control_count / len(raw) > 0.3


def detect_line(text: str, marker: str) -> int | None:
    idx = text.find(marker)
    if idx == -1:
        return None
    return text.count("\n", 0, idx) + 1


def has_c1_control_chars(text: str) -> int | None:
    for index, ch in enumerate(text):
        codepoint = ord(ch)
        if 0x80 <= codepoint <= 0x9F:
            return text.count("\n", 0, index) + 1
    return None


def check_text_file(path: Path, raw: bytes, root: Path) -> list[Issue]:
    issues: list[Issue] = []

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        issues.append(
            Issue(
                path=path.relative_to(root),
                kind="non-utf8",
                detail=f"无法按 UTF-8 解码: byte={exc.start}",
            )
        )
        return issues

    if "\ufffd" in text:
        line = detect_line(text, "\ufffd")
        detail = "包含替换字符 U+FFFD（通常意味着已经发生过乱码转换）"
        if line:
            detail += f"，line={line}"
        issues.append(Issue(path=path.relative_to(root), kind="replacement-char", detail=detail))

    c1_line = has_c1_control_chars(text)
    if c1_line:
        issues.append(
            Issue(
                path=path.relative_to(root),
                kind="c1-control",
                detail=f"包含 C1 控制字符（0x80-0x9F），line={c1_line}",
            )
        )

    for token in MOJIBAKE_TOKENS:
        if token in text:
            line = detect_line(text, token)
            detail = f"检测到疑似 mojibake 片段 '{token}'"
            if line:
                detail += f"，line={line}"
            issues.append(Issue(path=path.relative_to(root), kind="mojibake-hint", detail=detail))
            break

    return issues


def iter_candidate_files(root: Path, include_hidden: bool) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if should_skip_path(path, root, include_hidden):
            continue
        if path.is_file():
            files.append(path)
    return files


def check_repository(root: Path, max_bytes: int, include_hidden: bool) -> tuple[list[Issue], int, int]:
    issues: list[Issue] = []
    scanned = 0
    skipped = 0

    for path in iter_candidate_files(root, include_hidden):
        suffix = path.suffix.lower()
        if suffix in BINARY_EXTENSIONS:
            skipped += 1
            continue

        size = path.stat().st_size
        if size > max_bytes:
            skipped += 1
            continue

        raw = path.read_bytes()

        if suffix not in TEXT_EXTENSIONS and is_likely_binary(raw):
            skipped += 1
            continue

        scanned += 1
        issues.extend(check_text_file(path, raw, root))

    return issues, scanned, skipped


def main() -> int:
    args = parse_args()
    root = args.root.resolve()

    if not root.exists() or not root.is_dir():
        print(f"[错误] 扫描路径不存在或不是目录: {root}")
        return 2

    issues, scanned, skipped = check_repository(root, args.max_bytes, args.include_hidden)

    print(f"[信息] 扫描目录: {root}")
    print(f"[信息] 已检查文本文件: {scanned}")
    print(f"[信息] 已跳过文件: {skipped}")

    if not issues:
        print("[结果] 未发现明显编码损坏问题。")
        return 0

    print(f"[结果] 发现 {len(issues)} 个疑似编码问题:")
    for issue in issues:
        print(f" - {issue.path}: [{issue.kind}] {issue.detail}")

    print("[建议] 提交前先修复以上文件，避免 GitHub 展示乱码。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
