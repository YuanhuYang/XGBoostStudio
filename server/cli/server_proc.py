"""子进程启动 uvicorn，供 CLI / REPL 使用。"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import IO


def server_root() -> Path:
    return Path(__file__).resolve().parent.parent


def start_uvicorn(
    *,
    host: str,
    port: int,
    cwd: Path | None = None,
    stdout: IO[str] | int | None = subprocess.DEVNULL,
    stderr: IO[str] | int | None = subprocess.DEVNULL,
) -> subprocess.Popen[bytes]:
    root = cwd or server_root()
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "main:app",
        "--host",
        host,
        "--port",
        str(port),
    ]
    creationflags = 0
    if sys.platform == "win32":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.Popen(
        cmd,
        cwd=str(root),
        stdout=stdout,
        stderr=stderr,
        env=os.environ.copy(),
        creationflags=creationflags,
    )


def stop_process(proc: subprocess.Popen[bytes] | None, *, timeout: float = 8.0) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()


def wait_health(base_url: str, *, timeout_s: float = 90.0, interval_s: float = 0.4) -> None:
    import httpx

    deadline = time.monotonic() + timeout_s
    last_err: str | None = None
    with httpx.Client(base_url=base_url.rstrip("/"), timeout=5.0) as client:
        while time.monotonic() < deadline:
            try:
                r = client.get("/health")
                if r.status_code == 200:
                    return
                last_err = f"HTTP {r.status_code}"
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
            time.sleep(interval_s)
    raise RuntimeError(f"后端在 {timeout_s:.0f}s 内未就绪: {last_err or 'unknown'}")
