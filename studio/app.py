"""Atelier R。ComfyUI のノード画面の代わりに、ブラウザへこの画面を出します。"""

from __future__ import annotations

import atexit
import base64
import ctypes
import json
import mimetypes
import os
import random
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMFY_DIR = ROOT / "ComfyUI"
STATIC_DIR = Path(__file__).resolve().parent / "static"
EXTRA_WORDS_PATH = Path(__file__).resolve().parent / "extra_words.txt"
COMFY_URL = "http://127.0.0.1:8188"
STUDIO_HOST = "127.0.0.1"
STUDIO_PORT = 8189
TAILSCALE_IPV4: str | None = None
TAILSCALE_DNS: str | None = None
OUTPUT_DIR = COMFY_DIR / "output"
CLIENT_ID = str(uuid.uuid4())
_progress_state: dict[str, dict] = {}
_stage: dict[str, str] = {}

CHECKPOINT_NAMES = {
    "1_animemixillustrious_v8.safetensors": "AnimeMix v8",
    "2_EstellaXL.safetensors": "EstellaXL",
    "3_HolyMix_00002_.safetensors": "Holy Mix",
}
LORA_CATALOG = {
    "olivia.safetensors": {
        "name": "Olivia von Ecclesia",
        "preview": "/olivia-preview.png",
        "triggers": [
            "liv (long blonde wavy hair, emerald eyes)",
            "red and black royal dress with gold trim",
            "ornate black gauntlets on both arms",
            "black chest plate",
        ],
    }
}
RATIOS = [
    {"id": "1:2", "label": "1:2", "width": 768, "height": 1536, "column": "portrait"},
    {"id": "2:1", "label": "2:1", "width": 1536, "height": 768, "column": "landscape"},
    {"id": "9:16", "label": "9:16", "width": 768, "height": 1344, "column": "portrait"},
    {"id": "16:9", "label": "16:9", "width": 1344, "height": 768, "column": "landscape"},
    {"id": "2:3", "label": "2:3", "width": 832, "height": 1216, "column": "portrait"},
    {"id": "3:2", "label": "3:2", "width": 1216, "height": 832, "column": "landscape"},
    {"id": "3:4", "label": "3:4", "width": 896, "height": 1152, "column": "portrait"},
    {"id": "4:3", "label": "4:3", "width": 1152, "height": 896, "column": "landscape"},
    {"id": "4:5", "label": "4:5", "width": 896, "height": 1120, "column": "portrait"},
    {"id": "5:4", "label": "5:4", "width": 1120, "height": 896, "column": "landscape"},
    {"id": "1:1", "label": "1:1", "width": 1024, "height": 1024, "column": "full"},
    {"id": "custom", "label": "カスタム", "width": 0, "height": 0, "column": "full"},
]
RATIO_BY_ID = {item["id"]: item for item in RATIOS if item["id"] != "custom"}
MIN_SIDE = 512
MAX_SIDE = 7680
MAX_PIXELS = 7680 * 4320
DIRECT_LONG_SIDE = 1536
# 拡大後の画像を1枚あたり幅×高さ×12バイトで持つ。合計4GBを超える枚数は受け付けない。
BYTES_PER_PIXEL = 12
MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024

_comfy_process: subprocess.Popen | None = None
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


def comfy_is_up() -> bool:
    try:
        with urllib.request.urlopen(f"{COMFY_URL}/system_stats", timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def is_tailscale_ipv4(address: str) -> bool:
    parts = address.split(".")
    if len(parts) != 4:
        return False
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return False
    return numbers[0] == 100 and 64 <= numbers[1] <= 127 and all(0 <= number <= 255 for number in numbers)


def refresh_tailscale_names() -> None:
    """このPCの Tailscale アドレスを起動のたびに読み直します。"""
    global TAILSCALE_IPV4, TAILSCALE_DNS
    TAILSCALE_IPV4 = None
    TAILSCALE_DNS = None
    try:
        ip_result = subprocess.run(
            ["tailscale", "ip", "-4"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    lines = [line.strip() for line in (ip_result.stdout or "").splitlines() if line.strip()]
    if ip_result.returncode == 0 and lines and is_tailscale_ipv4(lines[0]):
        TAILSCALE_IPV4 = lines[0]
    try:
        status = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if status.returncode == 0 and status.stdout:
            payload = json.loads(status.stdout)
            name = str((payload.get("Self") or {}).get("DNSName") or "").strip().rstrip(".").lower()
            if name and "." in name:
                TAILSCALE_DNS = name
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return


def studio_hosts() -> set[str]:
    hosts = {f"{STUDIO_HOST}:{STUDIO_PORT}"}
    if TAILSCALE_IPV4:
        hosts.add(f"{TAILSCALE_IPV4}:{STUDIO_PORT}")
    if TAILSCALE_DNS:
        hosts.add(f"{TAILSCALE_DNS}:{STUDIO_PORT}")
    return hosts


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((STUDIO_HOST, port)) == 0


APP_NAME = "Atelier R"


def start_comfy_if_needed() -> None:
    global _comfy_process
    if comfy_is_up():
        print("画像エンジンはすでに起動しています。", flush=True)
        return
    if port_is_open(8188):
        print("画像エンジンの起動を待っています。", flush=True)
        for _ in range(30):
            if comfy_is_up():
                return
            time.sleep(1)
        print("画像エンジンが応答しません。この画面のメッセージを確認してください。", flush=True)
        return
    python = COMFY_DIR / ".venv" / "Scripts" / "python.exe"
    if not python.exists():
        raise SystemExit("ComfyUI の Python が見つかりません。README の「最初の準備」を実行してください。")
    print("画像エンジンを起動しています。初回は 30 秒ほどかかります。")
    _comfy_process = subprocess.Popen(
        [str(python), "main.py", "--listen", "127.0.0.1", "--port", "8188"],
        cwd=COMFY_DIR,
    )


def stop_comfy_if_we_started() -> None:
    if _comfy_process is None or _comfy_process.poll() is not None:
        return
    _comfy_process.terminate()
    try:
        _comfy_process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        _comfy_process.kill()


def comfy_json(method: str, path: str, payload: dict | None = None, timeout: int = 30):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        COMFY_URL + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return {}
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail or error.reason) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("画像エンジンに接続できませんでした。") from error


def read_extra_words() -> list[str]:
    if not EXTRA_WORDS_PATH.is_file():
        return []
    try:
        lines = EXTRA_WORDS_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    words = []
    seen = set()
    for line in lines:
        word = line.strip()
        if not word or word.startswith("#"):
            continue
        word = word[:200]
        if word in seen:
            continue
        seen.add(word)
        words.append(word)
        if len(words) >= 300:
            break
    return words


def list_options() -> dict:
    not_ready = {
        "ready": False,
        "checkpoints": [],
        "loras": [],
        "ratios": RATIOS,
        "output_dir": str(OUTPUT_DIR),
        "extra_words": read_extra_words(),
    }
    if not comfy_is_up():
        return not_ready
    try:
        checkpoints = comfy_json("GET", "/models/checkpoints")
        loras = comfy_json("GET", "/models/loras")
    except RuntimeError:
        return not_ready
    return {
        "ready": True,
        "checkpoints": [
            {"id": name, "name": CHECKPOINT_NAMES.get(name, Path(name).stem)}
            for name in checkpoints
        ],
        "loras": [
            {
                "id": name,
                "name": LORA_CATALOG.get(name, {}).get("name", Path(name).stem),
                "preview": LORA_CATALOG.get(name, {}).get("preview", ""),
                "triggers": LORA_CATALOG.get(name, {}).get("triggers", []),
            }
            for name in loras
        ],
        "ratios": RATIOS,
        "output_dir": str(OUTPUT_DIR),
        "extra_words": read_extra_words(),
    }


def build_graph(body: dict) -> tuple[dict, int]:
    options = list_options()
    if not options["ready"]:
        raise ValueError("画像エンジンの準備がまだです。少し待ってからもう一度押してください。")

    checkpoint_ids = {item["id"] for item in options["checkpoints"]}
    lora_ids = {item["id"] for item in options["loras"]}
    checkpoint = str(body.get("checkpoint") or "")
    if checkpoint not in checkpoint_ids:
        raise ValueError("基礎モデルを選んでください。")

    lora = str(body.get("lora") or "")
    if lora and lora not in lora_ids:
        raise ValueError("LoRA の選択を確認してください。")

    width, height = image_size(body)
    draw_width, draw_height = sampling_size(width, height)

    try:
        count = int(body.get("count") or 1)
        strength = float(body.get("strength") if body.get("strength") is not None else 1)
    except (TypeError, ValueError) as error:
        raise ValueError("枚数と LoRA の強さを確認してください。") from error
    if count < 1 or count > 99:
        raise ValueError("一度に作れる枚数は 1 枚から 99 枚です。")
    if width * height * count * BYTES_PER_PIXEL > MAX_OUTPUT_BYTES:
        raise ValueError("このサイズと枚数の組み合わせはメモリが足りなくなります。枚数を減らすか、解像度を下げてください。")
    if strength < 0 or strength > 2:
        raise ValueError("LoRA の強さは 0 から 2 の間にしてください。")

    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("中央の欄に、描きたい内容を書いてください。")
    if len(prompt) > 4000:
        raise ValueError("文章が長すぎます。4000 文字以内にしてください。")
    negative = str(body.get("negative") or "").strip()[:4000]

    seed = body.get("seed")
    if seed is None or seed == "":
        seed = random.randrange(0, 2**32)
    try:
        seed = int(seed)
    except (TypeError, ValueError) as error:
        raise ValueError("シードは数字にしてください。") from error
    if seed < 0 or seed > 2**32 - 1:
        raise ValueError("シードの数が範囲の外です。")

    graph: dict[str, dict] = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
    }
    model_ref = ["1", 0]
    clip_ref = ["1", 1]
    if lora:
        graph["2"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": model_ref,
                "clip": clip_ref,
                "lora_name": lora,
                "strength_model": strength,
                "strength_clip": strength,
            },
        }
        model_ref = ["2", 0]
        clip_ref = ["2", 1]
    graph["3"] = {
        "class_type": "CLIPSetLastLayer",
        "inputs": {"clip": clip_ref, "stop_at_clip_layer": -2},
    }
    graph["4"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": prompt, "clip": ["3", 0]},
    }
    graph["5"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": ["3", 0]},
    }
    graph["6"] = {
        "class_type": "EmptyLatentImage",
        "inputs": {"width": draw_width, "height": draw_height, "batch_size": count},
    }
    graph["7"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": model_ref,
            "seed": seed,
            "steps": 28,
            "cfg": 5.5,
            "sampler_name": "euler_ancestral",
            "scheduler": "normal",
            "positive": ["4", 0],
            "negative": ["5", 0],
            "latent_image": ["6", 0],
            "denoise": 1,
        },
    }
    graph["8"] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["7", 0], "vae": ["1", 2]},
    }
    image_ref = ["8", 0]
    if (draw_width, draw_height) != (width, height):
        graph["10"] = {
            "class_type": "ImageScale",
            "inputs": {
                "image": image_ref,
                "upscale_method": "lanczos",
                "width": width,
                "height": height,
                "crop": "disabled",
            },
        }
        image_ref = ["10", 0]
    graph["9"] = {
        "class_type": "SaveImage",
        "inputs": {"images": image_ref, "filename_prefix": "studio"},
    }
    return graph, seed


def image_size(body: dict) -> tuple[int, int]:
    ratio_id = str(body.get("ratio") or "9:16")
    if ratio_id == "custom":
        try:
            width = int(body.get("width"))
            height = int(body.get("height"))
        except (TypeError, ValueError) as error:
            raise ValueError("カスタムの幅と高さを数字で入れてください。") from error
        if width % 8 or height % 8 or not (MIN_SIDE <= width <= MAX_SIDE and MIN_SIDE <= height <= MAX_SIDE):
            raise ValueError("幅と高さは 512〜7680 で、8 の倍数にしてください。")
        if width * height > MAX_PIXELS:
            raise ValueError("8K（7680×4320）より大きいサイズは指定できません。")
        return width, height
    ratio = RATIO_BY_ID.get(ratio_id)
    if ratio is None:
        raise ValueError("縦横比を選んでください。")
    return ratio["width"], ratio["height"]


def sampling_size(width: int, height: int) -> tuple[int, int]:
    long_side = max(width, height)
    if long_side <= DIRECT_LONG_SIDE:
        return width, height
    scale = DIRECT_LONG_SIDE / long_side
    draw_width = max(64, int(round(width * scale / 8)) * 8)
    draw_height = max(64, int(round(height * scale / 8)) * 8)
    return draw_width, draw_height


def forget_progress(prompt_id: str) -> None:
    with _jobs_lock:
        _progress_state.pop(prompt_id, None)
        _stage.pop(prompt_id, None)


def running_status(prompt_id: str, known: dict) -> dict:
    with _jobs_lock:
        progress = dict(_progress_state.get(prompt_id) or {})
        stage = _stage.get(prompt_id, "準備しています")
    value = int(progress.get("value") or 0)
    maximum = int(progress.get("max") or 0)
    return {
        "state": "running",
        "seed": known["seed"],
        "value": value,
        "max": maximum,
        "stage": stage,
    }


def remember_job(prompt_id: str, seed: int) -> None:
    with _jobs_lock:
        _jobs[prompt_id] = {"seed": seed, "created": time.time()}
        if len(_jobs) > 40:
            oldest = sorted(_jobs.items(), key=lambda item: item[1]["created"])[:-40]
            for key, _ in oldest:
                _jobs.pop(key, None)
                _progress_state.pop(key, None)
                _stage.pop(key, None)


def job_status(prompt_id: str) -> dict:
    with _jobs_lock:
        known = _jobs.get(prompt_id)
    if known is None:
        return {"state": "missing"}
    try:
        history = comfy_json("GET", "/history/" + urllib.parse.quote(prompt_id), timeout=10)
    except RuntimeError as error:
        return {"state": "error", "message": str(error)}
    item = history.get(prompt_id)
    if not item:
        return running_status(prompt_id, known)
    status = item.get("status") or {}
    if status.get("status_str") == "error":
        message = "生成に失敗しました。"
        for entry in status.get("messages") or []:
            if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], dict):
                message = str(entry[1].get("exception_message") or message)
        forget_progress(prompt_id)
        return {"state": "error", "message": message, "seed": known["seed"]}
    images = []
    for node in (item.get("outputs") or {}).values():
        for image in node.get("images") or []:
            filename = image.get("filename") or ""
            if not filename or Path(filename).name != filename:
                continue
            query = urllib.parse.urlencode(
                {
                    "filename": filename,
                    "subfolder": image.get("subfolder") or "",
                    "type": image.get("type") or "output",
                }
            )
            folder = OUTPUT_DIR / (image.get("subfolder") or "")
            images.append({
                "url": "/api/image?" + query,
                "filename": filename,
                "path": str(folder / filename),
            })
    if not images and not status.get("completed"):
        return running_status(prompt_id, known)
    forget_progress(prompt_id)
    return {"state": "done", "seed": known["seed"], "images": images, "output_dir": str(OUTPUT_DIR)}


class StudioHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        if str(args[1:2]) not in {"('200',)", "('304',)"}:
            super().log_message(fmt, *args)

    def log_error(self, fmt: str, *args) -> None:
        if args and args[0] == 404:
            return
        super().log_error(fmt, *args)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/options":
            self.send_json(list_options())
            return
        if parsed.path.startswith("/api/jobs/"):
            prompt_id = parsed.path.removeprefix("/api/jobs/")
            self.send_json(job_status(prompt_id))
            return
        if parsed.path == "/api/image":
            self.send_image(urllib.parse.parse_qs(parsed.query))
            return
        self.send_static(parsed.path)

    def request_host(self) -> str:
        return (self.headers.get("Host") or "").split(",")[0].strip().lower()

    def request_origin(self) -> str:
        return (self.headers.get("Origin") or "").strip().rstrip("/").lower()

    def from_local_screen(self) -> bool:
        host = f"{STUDIO_HOST}:{STUDIO_PORT}"
        return self.request_host() == host and self.request_origin() == f"http://{host}"

    def from_studio_screen(self) -> bool:
        host = self.request_host()
        return host in studio_hosts() and self.request_origin() == f"http://{host}"

    def read_json_object(self, *, local_only: bool = False) -> dict | None:
        if local_only:
            allowed = self.from_local_screen()
            denied = "保存フォルダを開くのは、このPCの画面からだけです。"
        else:
            allowed = self.from_studio_screen()
            denied = "この操作は Atelier R の画面からだけ受け付けます。"
        if not allowed:
            self.send_json({"error": denied}, status=403)
            return None
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self.send_json({"error": "送信形式が正しくありません。"}, status=415)
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.send_json({"error": "送信内容を読めませんでした。"}, status=400)
            return None
        if length < 0 or length > 100_000:
            self.send_json({"error": "送信データが大きすぎます。"}, status=400)
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json({"error": "送信内容を読めませんでした。"}, status=400)
            return None
        if not isinstance(body, dict):
            self.send_json({"error": "送信内容を読めませんでした。"}, status=400)
            return None
        return body

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/open-folder":
            if self.read_json_object(local_only=True) is None:
                return
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            os.startfile(OUTPUT_DIR)
            self.send_json({"ok": True, "path": str(OUTPUT_DIR)})
            return
        if path != "/api/generate":
            self.send_error(404)
            return
        body = self.read_json_object()
        if body is None:
            return
        try:
            graph, seed = build_graph(body)
            result = comfy_json("POST", "/prompt", {"prompt": graph, "client_id": CLIENT_ID})
        except ValueError as error:
            print(f"生成を始められませんでした: {error}", flush=True)
            self.send_json({"error": str(error)}, status=400)
            return
        except RuntimeError as error:
            self.send_json({"error": "生成を開始できませんでした。" + str(error)[:300]}, status=502)
            return
        prompt_id = result.get("prompt_id")
        if not prompt_id or result.get("node_errors"):
            self.send_json({"error": "ワークフローを開始できませんでした。"}, status=502)
            return
        remember_job(prompt_id, seed)
        self.send_json({"prompt_id": prompt_id, "seed": seed})

    def send_json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def send_image(self, query: dict) -> None:
        filename = (query.get("filename") or [""])[0]
        if not filename or Path(filename).name != filename:
            self.send_error(400)
            return
        params = urllib.parse.urlencode(
            {
                "filename": filename,
                "subfolder": (query.get("subfolder") or [""])[0],
                "type": (query.get("type") or ["output"])[0],
            }
        )
        try:
            with urllib.request.urlopen(f"{COMFY_URL}/view?{params}", timeout=30) as response:
                data = response.read()
                content_type = response.headers.get("Content-Type", "image/png")
        except (OSError, urllib.error.URLError):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_static(self, path: str) -> None:
        relative = "index.html" if path in {"", "/"} else path.lstrip("/")
        file_path = (STATIC_DIR / relative).resolve()
        if STATIC_DIR.resolve() not in file_path.parents and file_path != STATIC_DIR.resolve():
            self.send_error(404)
            return
        if not file_path.is_file():
            self.send_error(404)
            return
        data = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def note_progress(message: dict) -> None:
    kind = message.get("type")
    data = message.get("data") or {}
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        return
    with _jobs_lock:
        if kind == "progress":
            _progress_state[prompt_id] = {"value": data.get("value") or 0, "max": data.get("max") or 0}
            _stage[prompt_id] = "画像を描いています"
        elif kind == "executing":
            node = str(data.get("node") or "")
            if node in {"1", "2"}:
                _stage[prompt_id] = "モデルを読み込んでいます"
            elif node == "7":
                _stage[prompt_id] = "画像を描いています"
            elif node == "10":
                _stage[prompt_id] = "指定サイズまで拡大しています"
            elif node in {"8", "9"}:
                _stage[prompt_id] = "画像を保存しています"
            elif node:
                _stage[prompt_id] = "準備しています"


def take_bytes(sock: socket.socket, buf: bytes, size: int) -> bytes | None:
    while len(buf) < size:
        chunk = sock.recv(65536)
        if not chunk:
            return None
        buf += chunk
    return buf


def read_ws_frame(sock: socket.socket, buf: bytes) -> tuple[tuple[int, bytes] | None, bytes]:
    buf = take_bytes(sock, buf, 2)
    if buf is None:
        return None, b""
    first, second = buf[0], buf[1]
    buf = buf[2:]
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        buf = take_bytes(sock, buf, 2)
        if buf is None:
            return None, b""
        length = struct.unpack("!H", buf[:2])[0]
        buf = buf[2:]
    elif length == 127:
        buf = take_bytes(sock, buf, 8)
        if buf is None:
            return None, b""
        length = struct.unpack("!Q", buf[:8])[0]
        buf = buf[8:]
    if length > 16_000_000:
        return None, b""
    buf = take_bytes(sock, buf, length)
    if buf is None:
        return None, b""
    return (opcode, buf[:length]), buf[length:]


def send_ws_frame(sock: socket.socket, opcode: int, payload: bytes) -> None:
    mask = os.urandom(4)
    header = bytes([0x80 | opcode])
    size = len(payload)
    if size < 126:
        header += bytes([0x80 | size])
    elif size < 65536:
        header += bytes([0x80 | 126]) + struct.pack("!H", size)
    else:
        header += bytes([0x80 | 127]) + struct.pack("!Q", size)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    sock.sendall(header + mask + masked)


def listen_for_progress() -> None:
    while True:
        try:
            if not comfy_is_up():
                time.sleep(1)
                continue
            sock = socket.create_connection(("127.0.0.1", 8188), timeout=10)
            key = base64.b64encode(os.urandom(16)).decode()
            request = (
                f"GET /ws?clientId={CLIENT_ID} HTTP/1.1\r\n"
                "Host: 127.0.0.1:8188\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            )
            sock.sendall(request.encode())
            handshake = b""
            while b"\r\n\r\n" not in handshake:
                chunk = sock.recv(4096)
                if not chunk:
                    raise OSError("websocket handshake failed")
                handshake += chunk
            if b" 101 " not in handshake.split(b"\r\n", 1)[0]:
                raise OSError("websocket upgrade failed")
            buf = handshake.split(b"\r\n\r\n", 1)[1]
            sock.settimeout(None)
            while True:
                frame, buf = read_ws_frame(sock, buf)
                if frame is None:
                    break
                opcode, payload = frame
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    send_ws_frame(sock, 0xA, payload)
                    continue
                if opcode != 0x1:
                    continue
                note_progress(json.loads(payload.decode("utf-8")))
        except (OSError, json.JSONDecodeError, TimeoutError):
            time.sleep(1)


def studio_url() -> str:
    return f"http://{STUDIO_HOST}:{STUDIO_PORT}"


def open_studio_page() -> None:
    url = studio_url()
    if sys.platform == "win32":
        opened = subprocess.run(["cmd", "/c", "start", "", url], check=False)
        if opened.returncode == 0:
            print(f"ブラウザで開きました: {url}", flush=True)
            return
        print("ブラウザを自動で開けませんでした。", flush=True)
    if not webbrowser.open(url):
        print(f"自分でこのアドレスを開いてください: {url}", flush=True)


def notify_already_open() -> None:
    message = f"{APP_NAME} はすでに開いています。\nブラウザで開きました。\n{studio_url()}"
    print(message, flush=True)
    if sys.platform != "win32" or os.environ.get("STUDIO_SKIP_DIALOG") == "1":
        return
    ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x00050040)


def bind_studio_servers() -> list[ThreadingHTTPServer]:
    ThreadingHTTPServer.allow_reuse_address = True
    servers = [ThreadingHTTPServer((STUDIO_HOST, STUDIO_PORT), StudioHandler)]
    if not TAILSCALE_IPV4:
        print("Tailscale のアドレスが見つかりません。このPCの中からだけ開けます。", flush=True)
        return servers
    try:
        servers.append(ThreadingHTTPServer((TAILSCALE_IPV4, STUDIO_PORT), StudioHandler))
    except OSError as error:
        print(f"スマホ向けの待ち受けを開けませんでした: {error}", flush=True)
    return servers


def main() -> None:
    refresh_tailscale_names()
    if port_is_open(STUDIO_PORT):
        open_studio_page()
        notify_already_open()
        raise SystemExit(2)
    start_comfy_if_needed()
    threading.Thread(target=listen_for_progress, daemon=True).start()
    atexit.register(stop_comfy_if_we_started)
    servers = bind_studio_servers()
    print(f"{APP_NAME}: {studio_url()}", flush=True)
    if TAILSCALE_IPV4:
        print(f"スマホから: http://{TAILSCALE_IPV4}:{STUDIO_PORT}", flush=True)
    if TAILSCALE_DNS:
        print(f"スマホから（名前）: http://{TAILSCALE_DNS}:{STUDIO_PORT}", flush=True)
    print("終了するときは、この画面で Ctrl+C を押してください。", flush=True)
    workers = []
    for server in servers:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        workers.append(worker)
    open_studio_page()
    try:
        while any(worker.is_alive() for worker in workers):
            for worker in workers:
                worker.join(0.5)
    except KeyboardInterrupt:
        print("\n終了します。", flush=True)
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        stop_comfy_if_we_started()


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
