"""学習用の画像フォルダと、SDXL LoRA の学習ジョブ。"""

from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets"
LORA_DIR = ROOT / "models" / "loras"
TRAIN_SCRIPT = Path(__file__).resolve().parent / "train_sdxl.py"
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
MAX_IMAGES = 40
_lock = threading.Lock()
_job: dict = {"state": "idle", "message": "", "step": 0, "total": 0, "loss": None, "log": []}
_process: subprocess.Popen | None = None
_on_done = None


def set_on_done(callback) -> None:
    global _on_done
    _on_done = callback


def _dataset_id(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{8}", value or ""):
        raise ValueError("データセットが見つかりません。")
    return value


def dataset_dir(dataset_id: str) -> Path:
    folder = DATASETS / _dataset_id(dataset_id)
    if not folder.is_dir():
        raise ValueError("データセットが見つかりません。")
    return folder


def _read_meta(folder: Path) -> dict:
    try:
        data = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    return data if isinstance(data, dict) else {}


def _write_meta(folder: Path, meta: dict) -> None:
    (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _image_rows(folder: Path) -> list[dict]:
    rows = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in IMAGE_EXT or not path.is_file():
            continue
        caption_path = path.with_suffix(".txt")
        try:
            caption = caption_path.read_text(encoding="utf-8") if caption_path.is_file() else ""
        except OSError:
            caption = ""
        rows.append({"name": path.name, "caption": caption})
    return rows


def dataset_view(dataset_id: str) -> dict:
    folder = dataset_dir(dataset_id)
    meta = _read_meta(folder)
    return {
        "id": folder.name,
        "name": str(meta.get("name") or ""),
        "goal": str(meta.get("goal") or "style"),
        "trigger": str(meta.get("trigger") or ""),
        "images": _image_rows(folder),
    }


def create_dataset(name: str, goal: str, trigger: str) -> dict:
    if goal not in {"style", "character", "face"}:
        raise ValueError("学び方を選んでください。")
    DATASETS.mkdir(parents=True, exist_ok=True)
    dataset_id = uuid.uuid4().hex[:8]
    folder = DATASETS / dataset_id
    folder.mkdir(parents=True)
    _write_meta(folder, {"name": name.strip()[:40], "goal": goal, "trigger": trigger.strip()[:40]})
    return dataset_view(dataset_id)


def update_dataset(dataset_id: str, name: str, goal: str, trigger: str) -> dict:
    if goal not in {"style", "character", "face"}:
        raise ValueError("学び方を選んでください。")
    folder = dataset_dir(dataset_id)
    _write_meta(folder, {"name": name.strip()[:40], "goal": goal, "trigger": trigger.strip()[:40]})
    return dataset_view(dataset_id)


def _open_image(data: bytes) -> Image.Image:
    if len(data) > 12_000_000:
        raise ValueError("画像が大きすぎます。1枚12MBまでです。")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as error:
        raise ValueError("画像を読めませんでした。PNG、JPEG、WebP にしてください。") from error
    if image.mode == "RGBA":
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")
    image.thumbnail((2048, 2048))
    return image


def add_image(dataset_id: str, data: bytes) -> dict:
    folder = dataset_dir(dataset_id)
    if len(_image_rows(folder)) >= MAX_IMAGES:
        raise ValueError("画像は 40 枚までです。")
    image = _open_image(data)
    number = 1
    while (folder / f"img_{number:03d}.jpg").exists():
        number += 1
    path = folder / f"img_{number:03d}.jpg"
    image.save(path, "JPEG", quality=95)
    return {"name": path.name, "caption": ""}


def image_file(dataset_id: str, name: str) -> Path:
    if Path(name).name != name or Path(name).suffix.lower() not in IMAGE_EXT:
        raise ValueError("画像が見つかりません。")
    path = dataset_dir(dataset_id) / name
    if not path.is_file():
        raise ValueError("画像が見つかりません。")
    return path


def write_caption(dataset_id: str, name: str, text: str) -> None:
    path = image_file(dataset_id, name)
    if len(text) > 2000:
        raise ValueError("説明が長すぎます。")
    path.with_suffix(".txt").write_text(text.strip(), encoding="utf-8")


def delete_image(dataset_id: str, name: str) -> None:
    path = image_file(dataset_id, name)
    path.unlink(missing_ok=True)
    path.with_suffix(".txt").unlink(missing_ok=True)


def autotag(dataset_id: str, *, trigger: str, goal: str, drop_face: bool, overwrite: bool) -> dict:
    from tagger_wd import describe_image, tag_image

    folder = dataset_dir(dataset_id)
    rows = _image_rows(folder)
    if not rows:
        raise ValueError("先に画像を追加してください。")
    changed = 0
    for row in rows:
        if row["caption"].strip() and not overwrite:
            continue
        image = Image.open(folder / row["name"])
        if goal == "face":
            text = describe_image(image, trigger=trigger, drop_face=drop_face)
        else:
            text = tag_image(image, trigger=trigger, drop_face=drop_face)
        (folder / row["name"]).with_suffix(".txt").write_text(text, encoding="utf-8")
        changed += 1
    view = dataset_view(dataset_id)
    view["changed"] = changed
    if changed == 0:
        view["note"] = "すでに説明があります。付け直すにチェックを入れると、上書きします。"
    return view


def _safe_output_name(name: str) -> str:
    cleaned = re.sub(r"[^\w.\-]+", "_", name.strip(), flags=re.UNICODE).strip("._")
    if not cleaned:
        raise ValueError("LoRA の名前を入れてください。")
    if not cleaned.lower().endswith(".safetensors"):
        cleaned += ".safetensors"
    if Path(cleaned).name != cleaned or len(cleaned) > 80:
        raise ValueError("LoRA のファイル名を確認してください。")
    return cleaned


def _output_path(name: str) -> Path:
    LORA_DIR.mkdir(parents=True, exist_ok=True)
    path = LORA_DIR / _safe_output_name(name)
    if path.exists():
        raise ValueError("同じ名前の LoRA が既にあります。名前を変えてください。")
    return path


def job_status() -> dict:
    with _lock:
        item = dict(_job)
    item.pop("log", None)
    return item


def _set_job(**kwargs) -> None:
    with _lock:
        _job.update(kwargs)


def _append_log(line: str) -> None:
    with _lock:
        log = _job.setdefault("log", [])
        log.append(line)
        del log[:-40]


def _watch(process: subprocess.Popen, progress_path: Path, done_info: dict) -> None:
    global _process
    assert process.stdout is not None
    for line in process.stdout:
        text = line.rstrip()
        if text.startswith("PROGRESS "):
            try:
                payload = json.loads(text[len("PROGRESS ") :])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                message = str(payload.get("message") or "")
                # Windows のパイプが日本語を壊したときは、UTF-8 で書いたファイルを使う。
                if "\ufffd" in message and progress_path.is_file():
                    try:
                        saved = json.loads(progress_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        saved = None
                    if isinstance(saved, dict) and saved.get("message") and "\ufffd" not in str(saved.get("message")):
                        message = str(saved["message"])
                        payload = saved
                _set_job(
                    state=str(payload.get("state") or "running"),
                    message=message,
                    step=int(payload.get("step") or 0),
                    total=int(payload.get("total") or 0),
                    loss=payload.get("loss"),
                )
            continue
        if text:
            _append_log(text)
            print(text, flush=True)
    code = process.wait()
    with _lock:
        global_process = _process
    if global_process is process:
        _process = None
    if code == 0 and progress_path.is_file():
        _set_job(state="done", message="学習が終わりました。LoRA の一覧から追加できます。")
        callback = _on_done
        if callback:
            try:
                callback(done_info)
            except Exception as error:
                print(f"サムネイルを付けられませんでした: {error}", flush=True)
        return
    if code < 0 or _job.get("state") == "stopped":
        _set_job(state="stopped", message="学習を止めました。")
        return
    message = "学習が止まりました。黒い画面の最後の行を確認してください。"
    if progress_path.is_file():
        try:
            payload = json.loads(progress_path.read_text(encoding="utf-8"))
            if payload.get("message"):
                message = str(payload["message"])
        except (OSError, json.JSONDecodeError):
            pass
    _set_job(state="error", message=message)


def start_training(spec: dict) -> dict:
    global _process
    with _lock:
        if _process is not None and _process.poll() is None:
            raise ValueError("いま学習中です。終わるまで待ってください。")
    dataset_id = _dataset_id(str(spec.get("dataset") or ""))
    folder = dataset_dir(dataset_id)
    images = _image_rows(folder)
    if len(images) < 5:
        raise ValueError("画像は 5 枚以上にしてください。15 枚くらいが扱いやすいです。")
    if any(not item["caption"].strip() for item in images):
        raise ValueError("説明が空の画像があります。タグを自動で付けるか、自分で書いてください。")
    goal = str(spec.get("goal") or "")
    if goal == "face":
        raise ValueError("顔の特徴の学習は FLUX.2 用で、次の対応です。今は文章の準備までできます。")
    if goal not in {"style", "character"}:
        raise ValueError("学び方を選んでください。")
    checkpoint = Path(str(spec.get("checkpoint") or ""))
    if not checkpoint.is_file():
        raise ValueError("基礎モデルのファイルが見つかりません。")
    try:
        rank = int(spec.get("rank") or 16)
        repeats = int(spec.get("repeats") or 20)
        resolution = int(spec.get("resolution") or 768)
    except (TypeError, ValueError) as error:
        raise ValueError("学習の設定を確認してください。") from error
    if rank not in {4, 8, 16, 32} or not 5 <= repeats <= 80 or resolution not in {768, 1024}:
        raise ValueError("学習の設定を確認してください。")
    trigger = str(spec.get("trigger") or "").strip()
    if not trigger or len(trigger) > 40 or any(char in trigger for char in "\r\n"):
        raise ValueError("呼び方は 1〜40 文字にしてください。")
    name = str(spec.get("name") or trigger).strip()[:40]
    output = _output_path(str(spec.get("output") or f"{trigger}_{goal}"))
    _write_meta(folder, {"name": name, "goal": goal, "trigger": trigger})
    progress = folder / "progress.json"
    job = {
        "dataset": dataset_id,
        "checkpoint": str(checkpoint),
        "output": str(output),
        "rank": rank,
        "repeats": repeats,
        "resolution": resolution,
        "goal": goal,
        "trigger": trigger,
        "name": name,
        "progress": str(progress),
    }
    (folder / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    _set_job(state="running", message="学習の準備をしています。", step=0, total=len(images) * repeats, loss=None, log=[])
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    process = subprocess.Popen(
        [sys.executable, "-u", str(TRAIN_SCRIPT), "--job", str(folder / "job.json")],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    with _lock:
        _process = process
    preview = str(folder / images[0]["name"])
    threading.Thread(
        target=_watch,
        args=(process, progress, {"output": output.name, "preview": preview, "trigger": trigger}),
        daemon=True,
    ).start()
    return job_status()


def stop_training() -> dict:
    global _process
    with _lock:
        process = _process
    if process is None or process.poll() is not None:
        _set_job(state="idle", message="")
        return job_status()
    _set_job(state="stopped", message="学習を止めています。")
    process.terminate()
    return job_status()
