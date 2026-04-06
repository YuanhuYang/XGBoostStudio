"""通过 HTTP 调用后端 API（支持长超时与 AutoML SSE）。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

import httpx

EmitCallback = Callable[[dict[str, Any]], None]


class StudioHttpClient:
    def __init__(self, base_url: str, *, client: httpx.Client | None = None) -> None:
        self._base = base_url.rstrip("/")
        timeout = httpx.Timeout(connect=30.0, read=3600.0, write=120.0, pool=30.0)
        self._client = client or httpx.Client(base_url=self._base, timeout=timeout)
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> StudioHttpClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def get_json(self, path: str) -> Any:
        r = self._client.get(path)
        r.raise_for_status()
        return r.json()

    def upload_dataset(self, file_path: Path, sheet_name: str | None = None) -> dict[str, Any]:
        path = file_path.expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"文件不存在: {path}")
        data: dict[str, str] = {}
        if sheet_name:
            data["sheet_name"] = sheet_name
        suffix = path.suffix.lower()
        mime = (
            "text/csv"
            if suffix == ".csv"
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if suffix == ".xlsx"
            else "application/vnd.ms-excel"
        )
        with path.open("rb") as f:
            files = {"file": (path.name, f, mime)}
            r = self._client.post("/api/datasets/upload", data=data, files=files)
        r.raise_for_status()
        return r.json()

    def import_sample(self, key: str) -> dict[str, Any]:
        r = self._client.post("/api/datasets/import-sample", params={"key": key})
        r.raise_for_status()
        return r.json()

    def list_datasets(self) -> list[dict[str, Any]]:
        return self.get_json("/api/datasets")

    def start_automl_job(self, body: dict[str, Any]) -> str:
        r = self._client.post("/api/automl/jobs", json=body)
        r.raise_for_status()
        return str(r.json()["job_id"])

    def consume_automl_sse(self, job_id: str, on_event: EmitCallback | None = None) -> None:
        """读取 SSE 直到 event: done。"""
        pending_event: str | None = None
        with self._client.stream(
            "GET",
            f"/api/automl/jobs/{job_id}/progress",
            headers={"Accept": "text/event-stream"},
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if line is None:
                    continue
                s = line.strip()
                if not s:
                    continue
                if s.startswith("event:"):
                    pending_event = s[6:].strip()
                    continue
                if s.startswith("data:"):
                    payload = s[5:].lstrip()
                    if payload:
                        try:
                            obj = json.loads(payload)
                        except json.JSONDecodeError:
                            if on_event:
                                on_event({"_parse_error": payload})
                            pending_event = None
                            continue
                        if isinstance(obj, dict) and "error" in obj:
                            raise RuntimeError(str(obj["error"]))
                        if on_event:
                            on_event(obj)
                    if pending_event == "done":
                        return
                    pending_event = None

    def get_automl_result(self, job_id: str) -> dict[str, Any]:
        r = self._client.get(f"/api/automl/jobs/{job_id}/result")
        r.raise_for_status()
        return r.json()

    def generate_report(self, model_id: int, title: str | None = None) -> dict[str, Any]:
        body = {
            "model_id": model_id,
            "title": title or f"CLI 报告 - 模型 {model_id}",
            "notes": "由 xs-studio CLI 生成",
        }
        r = self._client.post("/api/reports/generate", json=body)
        r.raise_for_status()
        return r.json()

    def compare_reports(self, model_ids: list[int], title: str | None = None) -> dict[str, Any]:
        body = {"model_ids": model_ids, "title": title or "CLI 多模型对比"}
        r = self._client.post("/api/reports/compare", json=body)
        r.raise_for_status()
        return r.json()
