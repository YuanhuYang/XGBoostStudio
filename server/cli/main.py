"""xs-studio 入口：默认 REPL，子命令 run 一键跑。"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cli.api_client import StudioHttpClient
from cli.deeplink import build_expert_workbench_query
from cli.repl import StudioREPL
from cli.server_proc import server_root, start_uvicorn, stop_process, wait_health


def _public_url(host: str, port: int) -> str:
    if ":" in host and not host.startswith("["):
        return f"http://[{host}]:{port}"
    return f"http://{host}:{port}"


def run_one_shot(args: argparse.Namespace) -> int:
    proc = None
    public = (args.base_url or _public_url(args.host, args.port)).rstrip("/")
    try:
        if not args.base_url:
            proc = start_uvicorn(host=args.host, port=args.port, cwd=server_root())
            print("正在启动后端…", flush=True)
            wait_health(public)
            print(f"后端就绪: {public}", flush=True)
        with StudioHttpClient(public) as client:
            path = Path(args.path).expanduser()
            if path.is_file():
                d = client.upload_dataset(path, args.sheet)
            else:
                print(f"文件不存在: {path}", file=sys.stderr)
                return 2
            ds_id = int(d["id"])
            print(f"dataset_id={ds_id}", flush=True)
            body: dict = {
                "dataset_id": ds_id,
                "skip_tuning": args.skip_tuning,
                "max_tuning_trials": args.max_tuning_trials,
                "train_ratio": args.train_ratio,
                "random_seed": args.random_seed,
            }
            if args.no_smart_clean:
                body["smart_clean"] = False
            if args.target_column:
                body["target_column"] = args.target_column
            job_id = client.start_automl_job(body)
            print(f"job_id={job_id}", flush=True)

            def on_ev(ev: dict) -> None:
                m = ev.get("message")
                if m:
                    print(f"  {ev.get('step', '')}: {m}", flush=True)

            client.consume_automl_sse(job_id, on_ev)
            res = client.get_automl_result(job_id)
            cands = res.get("candidates") or []
            ids = [int(c["model_id"]) for c in cands if c.get("model_id") is not None]
            ch = res.get("chosen_recommendation") or {}
            print(f"split_id={res.get('split_id')} 候选 model_ids={ids}", flush=True)
            print(f"chosen_model_id={ch.get('model_id')}", flush=True)
            pp = res.get("pipeline_plan")
            if pp:
                print(f"pipeline_plan={json.dumps(pp, ensure_ascii=False)}", flush=True)
            if args.pdf:
                if len(ids) >= 2:
                    cr = client.compare_reports(ids)
                    print(f"compare_report_id={cr['id']} url={public}/api/reports/{cr['id']}/download", flush=True)
                for mid in ids:
                    try:
                        r = client.generate_report(mid)
                        print(f"model={mid} report_id={r['id']} url={public}/api/reports/{r['id']}/download", flush=True)
                    except Exception as e:  # noqa: BLE001
                        print(f"model={mid} report failed: {e}", file=sys.stderr, flush=True)
            fe = args.frontend_url.rstrip("/")
            sp = res.get("split_id")
            pm = ch.get("model_id")
            pm_int = int(pm) if pm is not None else None
            q = build_expert_workbench_query(
                dataset_id=ds_id,
                split_id=int(sp) if sp is not None else None,
                model_ids=ids,
                primary_model_id=pm_int,
            )
            print(f"frontend={fe}/{q}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"错误: {e}", file=sys.stderr)
        return 1
    finally:
        if proc is not None and not args.keep_server:
            stop_process(proc)
    return 0


def run_repl(args: argparse.Namespace) -> int:
    proc = None
    client: StudioHttpClient | None = None
    public = (args.base_url or _public_url(args.host, args.port)).rstrip("/")
    try:
        if not args.base_url:
            proc = start_uvicorn(host=args.host, port=args.port, cwd=server_root())
            print("正在启动后端…", flush=True)
            wait_health(public)
            print(f"后端就绪: {public}", flush=True)
        client = StudioHttpClient(public)
        repl = StudioREPL(
            client,
            api_public_url=public,
            frontend_url=args.frontend_url,
            server_proc=proc,
            keep_server=args.keep_server,
        )
        repl.cmdloop()
    except KeyboardInterrupt:
        print("\n中断。", flush=True)
    finally:
        if client is not None:
            client.close()
        if proc is not None and not args.keep_server:
            stop_process(proc)
    return 0


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="xs-studio", description="XGBoost Studio 命令行")
    p.add_argument("--host", default="127.0.0.1", help="绑定地址（启动子进程时）")
    p.add_argument("--port", type=int, default=18899, help="端口")
    p.add_argument("--base-url", default=None, help="已有后端根 URL，不启动子进程")
    p.add_argument("--keep-server", action="store_true", help="退出 CLI 后仍保留 uvicorn 子进程")
    p.add_argument(
        "--frontend-url",
        "--print-frontend-url",
        default="http://127.0.0.1:5173",
        dest="frontend_url",
        help="打印深链时使用的前端根地址（两参数等价）",
    )
    sub = p.add_subparsers(dest="command", required=False)
    sub.add_parser("shell", help="进入交互 REPL（与无子命令相同）")
    run = sub.add_parser("run", help="非交互：上传文件并跑 AutoML")
    run.add_argument("path", help="CSV/XLSX 路径")
    run.add_argument("--sheet", default=None, help="Excel 工作表名")
    run.add_argument("--pdf", action="store_true", help="生成对比与各模型 PDF")
    run.add_argument("--skip-tuning", action="store_true")
    run.add_argument("--max-tuning-trials", type=int, default=12)
    run.add_argument(
        "--no-smart-clean",
        action="store_true",
        help="跳过智能去重/填缺失/IQR 截断（默认同 API 开启）",
    )
    run.add_argument("--target-column", default=None)
    run.add_argument("--train-ratio", type=float, default=0.8)
    run.add_argument("--random-seed", type=int, default=42)
    run.set_defaults(_handler=run_one_shot)

    args = p.parse_args()
    handler = getattr(args, "_handler", None)
    if handler is run_one_shot:
        sys.exit(handler(args))
    if args.command == "shell":
        sys.exit(run_repl(args))
    sys.exit(run_repl(args))


if __name__ == "__main__":
    main()
