"""交互式 REPL（cmd.Cmd）。"""
from __future__ import annotations

import cmd
import os
import shlex
import subprocess
from typing import Any

from cli.api_client import StudioHttpClient
from cli.deeplink import build_expert_workbench_query
from services.dataset_service import BUILTIN_SAMPLE_SPECS


def _parse_pdf_flags(tokens: list[str]) -> tuple[bool, bool, bool]:
    """返回 (do_compare, do_single, selected_only)。"""
    compare_only = False
    no_compare = False
    selected_only = False
    for t in tokens:
        if t == "--compare-only":
            compare_only = True
        elif t == "--no-compare":
            no_compare = True
        elif t == "--selected":
            selected_only = True
        else:
            raise ValueError(f"未知参数: {t}")
    if compare_only and no_compare:
        raise ValueError("--compare-only 与 --no-compare 互斥")
    if selected_only and compare_only:
        raise ValueError("--selected 与 --compare-only 互斥")
    do_compare = not no_compare and not selected_only
    do_single = not compare_only and not selected_only
    if selected_only:
        do_compare = False
        do_single = True
    return do_compare, do_single, selected_only


def _parse_automl_flags(tokens: list[str]) -> dict[str, Any]:
    body: dict[str, Any] = {}
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == "--skip-tuning":
            body["skip_tuning"] = True
            i += 1
        elif t == "--max-tuning-trials":
            i += 1
            if i >= len(tokens):
                raise ValueError("--max-tuning-trials 需要数值")
            body["max_tuning_trials"] = int(tokens[i])
            i += 1
        elif t == "--target":
            i += 1
            if i >= len(tokens):
                raise ValueError("--target 需要列名")
            body["target_column"] = tokens[i]
            i += 1
        elif t == "--train-ratio":
            i += 1
            if i >= len(tokens):
                raise ValueError("--train-ratio 需要数值")
            body["train_ratio"] = float(tokens[i])
            i += 1
        elif t == "--random-seed":
            i += 1
            if i >= len(tokens):
                raise ValueError("--random-seed 需要数值")
            body["random_seed"] = int(tokens[i])
            i += 1
        elif t == "--no-smart-clean":
            body["smart_clean"] = False
            i += 1
        else:
            raise ValueError(f"未知参数: {t}")
    return body


class StudioREPL(cmd.Cmd):
    prompt = "xs-studio> "
    doc_leader = ""

    def emptyline(self) -> bool:
        return False

    def __init__(
        self,
        client: StudioHttpClient,
        *,
        api_public_url: str,
        frontend_url: str,
        server_proc: subprocess.Popen[bytes] | None,
        keep_server: bool,
    ) -> None:
        super().__init__()
        self.c = client
        self.api_public_url = api_public_url.rstrip("/")
        self.frontend_url = frontend_url.rstrip("/")
        self.server_proc = server_proc
        self.keep_server = keep_server
        self.dataset_id: int | None = None
        self.dataset_name: str | None = None
        self.last_automl: dict[str, Any] | None = None
        self.preferred_model_id: int | None = None
        self.intro = self._make_intro()

    def _make_intro(self) -> str:
        lines = [
            "",
            "XGBoost Studio CLI — 输入 help 查看命令。",
            f"  API: {self.api_public_url}",
            f"  前端（浏览器）: {self.frontend_url}",
            "",
        ]
        return "\n".join(lines)

    def _split(self, arg: str) -> list[str]:
        arg = (arg or "").strip()
        if not arg:
            return []
        return shlex.split(arg, posix=os.name != "nt")

    def do_help(self, arg: str) -> None:
        if arg:
            return super().do_help(arg)
        print(
            """
命令:
  load <路径> [sheet]     上传 CSV/XLSX
  sample <key>            导入内置示例（无参列出全部 key）
  datasets                列出数据集
  automl [选项]           对当前数据集全自动建模
      --skip-tuning  --no-smart-clean  --max-tuning-trials N  --target COL  --train-ratio R  --random-seed N
  candidates / last       显示上次 AutoML 候选与推荐
  select <n>              按列表序号选用模型（从 1 开始）
  select_model <id>       按 model_id 选用（计划中的 select-model）
  pdf [选项]              生成 PDF；默认对比(≥2)+各候选单报告
      --compare-only 仅对比  --no-compare 跳过对比  --selected 仅当前选用模型
  detach                  之后 quit 时保留后端子进程（等同 --keep-server）
  urls                    打印前端深链与报告下载 URL 模板
  quit / exit             退出"""
        )

    def do_load(self, arg: str) -> None:
        """上传数据文件。"""
        parts = self._split(arg)
        if not parts:
            print("用法: load <文件路径> [sheet名称]")
            return
        from pathlib import Path

        path = Path(parts[0])
        sheet = parts[1] if len(parts) > 1 else None
        try:
            d = self.c.upload_dataset(path, sheet)
        except Exception as e:  # noqa: BLE001
            print(f"上传失败: {e}")
            return
        self.dataset_id = int(d["id"])
        self.dataset_name = d.get("name")
        print(f"已上传 dataset_id={self.dataset_id} name={self.dataset_name!r}")

    def do_upload(self, arg: str) -> None:
        """同 load。"""
        self.do_load(arg)

    def do_sample(self, arg: str) -> None:
        """导入内置示例数据集。"""
        key = (arg or "").strip()
        if not key:
            keys = ", ".join(s.key for s in BUILTIN_SAMPLE_SPECS)
            print(f"用法: sample <key>")
            print(f"可用: {keys}")
            return
        try:
            d = self.c.import_sample(key)
        except Exception as e:  # noqa: BLE001
            print(f"导入失败: {e}")
            return
        self.dataset_id = int(d["id"])
        self.dataset_name = d.get("name")
        print(f"已导入 dataset_id={self.dataset_id} name={self.dataset_name!r}")

    def do_datasets(self, arg: str) -> None:
        """列出数据集。"""
        try:
            rows = self.c.list_datasets()
        except Exception as e:  # noqa: BLE001
            print(f"请求失败: {e}")
            return
        for r in rows[:50]:
            print(f"  id={r.get('id')}  name={r.get('name')!r}  target={r.get('target_column')!r}")
        if len(rows) > 50:
            print(f"  … 共 {len(rows)} 条，仅显示前 50")

    def do_automl(self, arg: str) -> None:
        """运行全自动建模。"""
        if self.dataset_id is None:
            print("请先 load 或 sample 导入数据集。")
            return
        try:
            extra = _parse_automl_flags(self._split(arg))
        except ValueError as e:
            print(f"参数错误: {e}")
            return
        body: dict[str, Any] = {"dataset_id": self.dataset_id, **extra}
        try:
            job_id = self.c.start_automl_job(body)
        except Exception as e:  # noqa: BLE001
            print(f"创建任务失败: {e}")
            return

        def on_ev(ev: dict[str, Any]) -> None:
            step = ev.get("step", "")
            msg = ev.get("message")
            if msg:
                print(f"  [{step}] {msg}")

        print("AutoML 运行中（可与前端同时查看进度数据）…")
        try:
            self.c.consume_automl_sse(job_id, on_ev)
            res = self.c.get_automl_result(job_id)
        except Exception as e:  # noqa: BLE001
            print(f"AutoML 失败: {e}")
            return
        self.last_automl = res
        ch = res.get("chosen_recommendation") or {}
        self.preferred_model_id = int(ch["model_id"]) if ch.get("model_id") is not None else None
        print(f"完成。split_id={res.get('split_id')} 候选数={len(res.get('candidates') or [])}")
        print(f"系统推荐 model_id={self.preferred_model_id} — 可用 candidates 查看列表，select 改选。")

    def do_candidates(self, arg: str) -> None:
        """显示上次 AutoML 候选。"""
        self._print_candidates()

    def do_last(self, arg: str) -> None:
        """同 candidates。"""
        self._print_candidates()

    def _print_candidates(self) -> None:
        if not self.last_automl:
            print("尚无结果，请先 automl。")
            return
        res = self.last_automl
        ch = res.get("chosen_recommendation") or {}
        print(f"目标列: {res.get('target_column')}  task: {res.get('task_type')}")
        print(f"系统推荐: model_id={ch.get('model_id')} ({ch.get('name')})")
        for i, c in enumerate(res.get("candidates") or [], start=1):
            mid = c.get("model_id")
            score = c.get("score_for_rank")
            print(f"  [{i}] model_id={mid}  {c.get('name')!r}  score={score}  overfitting={c.get('overfitting_level')}")
        for w in res.get("warnings") or []:
            print(f"  ! {w}")

    def do_select(self, arg: str) -> None:
        """按序号选用模型（1..n）。"""
        if not self.last_automl:
            print("尚无 AutoML 结果。")
            return
        s = (arg or "").strip()
        if not s.isdigit():
            print("用法: select <序号>")
            return
        n = int(s)
        cands = self.last_automl.get("candidates") or []
        if n < 1 or n > len(cands):
            print("序号超出范围。")
            return
        c = cands[n - 1]
        self.preferred_model_id = int(c["model_id"])
        print(f"已选用 model_id={self.preferred_model_id} ({c.get('name')})。")
        print("前端请在模型管理中选择该模型，或使用 urls 中的深链。")

    def do_select_model(self, arg: str) -> None:
        """按 model_id 选用。"""
        s = (arg or "").strip()
        if not s.isdigit():
            print("用法: select_model <model_id>")
            return
        self.preferred_model_id = int(s)
        print(f"已记录首选 model_id={self.preferred_model_id}。")

    def do_pdf(self, arg: str) -> None:
        """生成 PDF 报告（对比 + 各候选单报告，支持选项）。"""
        if not self.last_automl:
            print("请先 automl。")
            return
        try:
            do_compare, do_single, selected_only = _parse_pdf_flags(self._split(arg))
        except ValueError as e:
            print(f"参数错误: {e}")
            return
        cands = self.last_automl.get("candidates") or []
        ids = [int(c["model_id"]) for c in cands if c.get("model_id") is not None]
        if selected_only:
            if self.preferred_model_id is None:
                print("请先用 select / select_model 选定模型。")
                return
            ids = [self.preferred_model_id]
        if do_compare and len(ids) >= 2:
            try:
                cmp_rep = self.c.compare_reports(ids)
                rid = cmp_rep["id"]
                print(f"对比报告 report_id={rid}")
                print(f"  下载: {self.api_public_url}/api/reports/{rid}/download")
            except Exception as e:  # noqa: BLE001
                print(f"对比报告失败: {e}")
        elif do_compare and len(ids) < 2:
            print("候选不足 2 个，跳过对比 PDF。")
        if do_single:
            for mid in ids:
                try:
                    rep = self.c.generate_report(mid)
                    rid = rep["id"]
                    print(f"模型 {mid} 报告 report_id={rid} → {self.api_public_url}/api/reports/{rid}/download")
                except Exception as e:  # noqa: BLE001
                    print(f"模型 {mid} 报告失败: {e}")

    def do_detach(self, arg: str) -> None:
        """退出 REPL 时不终止已启动的后端子进程。"""
        self.keep_server = True
        print("已设置：退出本 CLI 后后端继续运行（与启动参数 --keep-server 相同）。")

    def do_urls(self, arg: str) -> None:
        """打印深链与下载 URL。"""
        if self.dataset_id is None:
            print("尚无 dataset_id（先 load/sample）。")
        else:
            sp = self.last_automl.get("split_id") if self.last_automl else None
            cands = (self.last_automl or {}).get("candidates") or []
            ids = [int(c["model_id"]) for c in cands if c.get("model_id") is not None]
            ch = (self.last_automl or {}).get("chosen_recommendation") or {}
            ch_mid = ch.get("model_id")
            pm = self.preferred_model_id
            if pm is None and ch_mid is not None:
                pm = int(ch_mid)
            if not ids and pm is not None:
                ids = [int(pm)]
            q = build_expert_workbench_query(
                dataset_id=int(self.dataset_id),
                split_id=int(sp) if sp is not None else None,
                model_ids=ids,
                primary_model_id=int(pm) if pm is not None else None,
            )
            print(f"前端深链: {self.frontend_url}/{q}")
        print(f"API 文档: {self.api_public_url}/docs")

    def do_quit(self, arg: str) -> bool:
        """退出。"""
        return self.do_exit(arg)

    def do_exit(self, arg: str) -> bool:
        """退出。"""
        print("再见。")
        return True

    def do_EOF(self, arg: str) -> bool:
        print()
        return True

    def postloop(self) -> None:
        """正常退出 REPL 时关闭子进程（与 main.run_repl 的 finally 二选一即可）。"""
        from cli.server_proc import stop_process

        if self.server_proc is not None and not self.keep_server:
            stop_process(self.server_proc)
            self.server_proc = None
