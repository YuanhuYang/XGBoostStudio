"""
全自动建模 API：创建任务、SSE 进度、获取结果（内存任务，进程重启丢失）。
"""
from __future__ import annotations

import asyncio
import json
import queue
import threading
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from db.database import SessionLocal
from services import automl_service

router = APIRouter(prefix="/api/automl", tags=["automl"])

JOBS: dict[str, dict[str, Any]] = {}


class StartAutoMLJobBody(BaseModel):
    dataset_id: int
    target_column: str | None = None
    train_ratio: float = Field(0.8, ge=0.1, le=0.95)
    random_seed: int = 42
    max_tuning_trials: int = Field(12, ge=0, le=50)
    skip_tuning: bool = False


@router.post("/jobs")
def start_automl_job(body: StartAutoMLJobBody) -> dict[str, str]:
    job_id = automl_service.new_job_id()
    q: queue.Queue[tuple[str, Any]] = queue.Queue()
    result_holder: dict[str, Any] = {}

    def runner() -> None:
        db = SessionLocal()
        try:

            def emit(ev: dict[str, Any]) -> None:
                q.put(("event", ev))

            res = automl_service.run_automl_job(
                dataset_id=body.dataset_id,
                db=db,
                emit=emit,
                target_column=body.target_column,
                train_ratio=body.train_ratio,
                random_seed=body.random_seed,
                max_tuning_trials=body.max_tuning_trials,
                skip_tuning=body.skip_tuning,
            )
            result_holder["result"] = res
        except Exception as e:  # noqa: BLE001 — 编排层汇总错误
            q.put(("error", str(e)))
        finally:
            q.put(("done", None))
            db.close()

    threading.Thread(target=runner, daemon=True).start()
    JOBS[job_id] = {
        "queue": q,
        "result_holder": result_holder,
        "status": "running",
        "error": None,
        "result": None,
    }
    return {"job_id": job_id}


@router.get("/jobs/{job_id}/progress")
async def automl_job_progress(job_id: str) -> StreamingResponse:
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="任务不存在")
    jq = JOBS[job_id]["queue"]

    async def gen():
        while True:
            kind, data = await asyncio.to_thread(jq.get)
            if kind == "event":
                yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
            elif kind == "error":
                yield f"data: {json.dumps({'error': data}, ensure_ascii=False)}\n\n"
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["error"] = data
                continue
            elif kind == "done":
                rh = JOBS[job_id]["result_holder"]
                if "result" in rh:
                    JOBS[job_id]["result"] = rh["result"]
                    JOBS[job_id]["status"] = "completed"
                yield "event: done\ndata: {}\n\n"
                return

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/result")
def automl_job_result(job_id: str) -> dict[str, Any]:
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="任务不存在")
    st = JOBS[job_id].get("status")
    if st == "failed":
        raise HTTPException(status_code=400, detail=JOBS[job_id].get("error") or "任务失败")
    if st != "completed" or JOBS[job_id].get("result") is None:
        raise HTTPException(status_code=400, detail="任务未完成或结果暂不可用")
    return JOBS[job_id]["result"]
