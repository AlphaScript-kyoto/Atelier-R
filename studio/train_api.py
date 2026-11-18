"""学習用の画像フォルダと、SDXL LoRA の学習ジョブ。"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
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
    return LORA_DIR / _safe_output_name(name)


def _candidate_outputs(folder: Path, name: str, epochs: int) -> list[Path]:
    """学習中の LoRA は、保存を押すまで候補フォルダに置く。"""
    base_name = _safe_output_name(name)
    dest = folder / "candidates"
    probe = dest / base_name
    paths = [probe] if epochs == 1 else [probe.with_name(f"{probe.stem}_e{index:02d}.safetensors") for index in range(1, epochs + 1)]
    LORA_DIR.mkdir(parents=True, exist_ok=True)
    if any((LORA_DIR / path.name).exists() for path in paths):
        raise ValueError("同じ名前の LoRA が既にあります。呼び方を変えてください。")
    dest.mkdir(parents=True, exist_ok=True)
    for item in dest.iterdir():
        if item.is_file():
            item.unlink()
    return paths


def job_status() -> dict:
    with _lock:
        item = dict(_job)
    item.pop("log", None)
    item.setdefault("candidates", [])
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
                    **({"candidates": payload["candidates"]} if isinstance(payload.get("candidates"), list) else {}),
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
        message = "見本ができました。残したいカードを選んで保存してください。"
        try:
            saved = json.loads(progress_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            saved = {}
        if isinstance(saved, dict):
            if isinstance(saved.get("candidates"), list):
                _set_job(candidates=saved["candidates"])
            if saved.get("message") and "\ufffd" not in str(saved.get("message")):
                message = str(saved["message"])
        _set_job(state="done", message=message)
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
        epochs = int(spec.get("epochs") or 1)
        resolution = int(spec.get("resolution") or 768)
    except (TypeError, ValueError) as error:
        raise ValueError("学習の設定を確認してください。") from error
    if rank not in {4, 8, 16, 32} or not 5 <= repeats <= 80 or not 1 <= epochs <= 10 or resolution not in {768, 1024}:
        raise ValueError("学習の設定を確認してください。")
    trigger = str(spec.get("trigger") or "").strip()
    if not trigger or len(trigger) > 40 or any(char in trigger for char in "\r\n"):
        raise ValueError("呼び方は 1〜40 文字にしてください。")
    preview_prompt = str(spec.get("preview_prompt") or "").strip()
    if len(preview_prompt) < 3 or len(preview_prompt) > 800:
        raise ValueError("モデル効果プレビューのプロンプトを、3〜800文字で入れてください。")
    name = str(spec.get("name") or trigger).strip()[:40]
    outputs = _candidate_outputs(folder, str(spec.get("output") or f"{trigger}_{goal}"), epochs)
    _write_meta(folder, {"name": name, "goal": goal, "trigger": trigger})
    progress = folder / "progress.json"
    job = {
        "dataset": dataset_id,
        "checkpoint": str(checkpoint),
        "output": str(outputs[-1]),
        "outputs": [str(path) for path in outputs],
        "rank": rank,
        "repeats": repeats,
        "epochs": epochs,
        "resolution": resolution,
        "goal": goal,
        "trigger": trigger,
        "name": name,
        "preview_prompt": preview_prompt,
        "progress": str(progress),
    }
    (folder / "job.json").write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    _set_job(
        state="running",
        message="学習の準備をしています。",
        step=0,
        total=len(images) * repeats * epochs,
        loss=None,
        log=[],
        dataset=dataset_id,
        candidates=[],
    )
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
    threading.Thread(
        target=_watch,
        args=(process, progress, {}),
        daemon=True,
    ).start()
    return job_status()


def preview_file(dataset_id: str, name: str) -> Path:
    if Path(name).name != name or Path(name).suffix.lower() != ".jpg":
        raise ValueError("見本が見つかりません。")
    path = dataset_dir(dataset_id) / "candidates" / name
    if not path.is_file():
        raise ValueError("見本が見つかりません。")
    return path


def take_candidates(dataset_id: str, names: list) -> list[dict]:
    """選ばれた LoRA だけ一覧用フォルダへ移し、残りは消す。"""
    with _lock:
        process = _process
    if process is not None and process.poll() is None:
        raise ValueError("学習が終わってから保存してください。")
    if not isinstance(names, list) or not names:
        raise ValueError("残す LoRA を1つ以上選んでください。")
    folder = dataset_dir(dataset_id) / "candidates"
    chosen = []
    seen = set()
    for name in names:
        if not isinstance(name, str) or Path(name).name != name or not name.lower().endswith(".safetensors"):
            raise ValueError("LoRA の名前を確認してください。")
        if name in seen:
            continue
        seen.add(name)
        path = folder / name
        if not path.is_file():
            raise ValueError("その LoRA は見当たりません。もう一度学習し直してください。")
        chosen.append(path)
    LORA_DIR.mkdir(parents=True, exist_ok=True)
    if any((LORA_DIR / path.name).exists() for path in chosen):
        raise ValueError("同じ名前の LoRA が既にあります。呼び方を変えてください。")
    saved = []
    for path in chosen:
        preview = path.with_suffix(".jpg")
        image = preview.read_bytes() if preview.is_file() else None
        dest = LORA_DIR / path.name
        shutil.move(str(path), dest)
        saved.append({"name": dest.name, "image": image})
    if folder.is_dir():
        for item in folder.iterdir():
            if item.is_file():
                item.unlink()
    _set_job(candidates=[], message="選んだ LoRA を保存しました。一覧から追加できます。")
    return saved


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
