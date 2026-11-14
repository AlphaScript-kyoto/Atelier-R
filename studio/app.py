"""Atelier R。ComfyUI のノード画面の代わりに、ブラウザへこの画面を出します。"""

from __future__ import annotations

import atexit
import base64
import ctypes
import hashlib
import hmac
import io
import json
import mimetypes
import os
import random
import secrets
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
CARDS_PATH = Path(__file__).resolve().parent / "model_cards.json"
PREVIEW_DIR = STATIC_DIR / "previews"
_cards_lock = threading.Lock()
AGENT_TOKEN_PATH = ROOT / "agent_token.txt"
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
    },
    "super-creek.safetensors": {
        "name": "Super Creek",
        "triggers": [
            "d4pv95de878c73flsqv0",
            "super creek \\(umamusume\\)",
        ],
    },
    "Elegg_-_Goddess_of_Victory_Nikke_Various_Outfits.safetensors": {
        "name": "Elegg",
        "triggers": ["EleggNK"],
        "shared": [
            "purple eyes",
            "short hair",
            "blonde hair",
            "hair intakes",
            "hair over eyes",
            "two-tone hair",
            "multicolored hair",
            "ahoge",
        ],
        "outfits": [
            {
                "name": "Default",
                "triggers": [
                    "Elegg_Base",
                    "bare shoulders",
                    "high collar",
                    "black sports bra",
                    "white crop top",
                    "crop top overhang",
                    "long sleeves",
                    "shoulder cutout",
                    "black gloves",
                    "yellow gloves",
                    "two-tone gloves",
                    "suspenders",
                    "grey shorts",
                    "micro shorts",
                    "denim shorts",
                    "black belt",
                    "thigh strap",
                    "whte socks",
                    "tabi",
                    "sandals",
                    "yellow footwear",
                ],
            },
            {
                "name": "Boom and Shock",
                "triggers": [
                    "Elegg_Boom",
                    "underboob",
                    "yellow bikini",
                    "tube top",
                    "see-through",
                    "cleavage cutout",
                    "heart cutout",
                    "rabbit choker",
                    "black choker",
                    "yellow gloves",
                    "single glove",
                    "slingshot swimsuit",
                    "crocs",
                    "white footwear",
                    "body writing",
                    "oficial alternate costume",
                ],
            },
            {
                "name": "Formal Dress",
                "triggers": [
                    "Elegg_Formal",
                    "short dress",
                    "halter dress",
                    "silver dress",
                    "white elbow gloves",
                    "bridal gauntlets",
                    "cleavage cutout",
                    "underboob cutout",
                    "silver skirt",
                    "miniskirt",
                    "jewelry",
                    "thigh strap",
                    "high heels",
                    "strappy heels",
                    "black footwear",
                    "bare shoulders",
                    "sideboob",
                    "alternate costume",
                ],
            },
            {
                "name": "Bunny Girl",
                "triggers": [
                    "Elegg_Bunny",
                    "rabbit ears",
                    "fake animal ears",
                    "playboy bunny",
                    "rabbit tail",
                    "yellow leotard",
                    "strapless leotard",
                    "yellow bowtie",
                    "detached collar",
                    "white elbow gloves",
                    "lace-trimmed gloves",
                    "wrist cuffs",
                    "white pantyhose",
                    "fishnet pantyhose",
                    "thigh strap",
                    "see-through navel",
                    "see-through leotard",
                    "alternate costume",
                ],
            },
            {
                "name": "Harem",
                "triggers": [
                    "Elegg_Harem",
                    "alternate costume",
                    "yellow outfit",
                    "pelvic curtain",
                    "armlet",
                    "dancer",
                    "breast curtains",
                    "harem outfit",
                    "mouth veil",
                ],
            },
            {
                "name": "Cow Girl",
                "triggers": [
                    "Elegg_Cow",
                    "hairband",
                    "fake animal ears",
                    "fake horns",
                    "cow ears",
                    "cow horns",
                    "ear tag",
                    "black choker",
                    "cow tail",
                    "animal print",
                    "micro bikini",
                    "neck bell",
                    "cowbell",
                    "cow print bikini",
                    "print thighhighs",
                    "elbow gloves",
                    "alternate costume",
                ],
            },
        ],
    },
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
VARY_COUNT = 3
VARY_DENOISE = 0.55
EXPAND_PADS = (128, 256, 384)
EXPAND_PROMPT_SUFFIX = ", extended background, continuing the same background, same curtains, same wall, matching lighting, no extra objects, no extra people"
EXPAND_NEGATIVE_SUFFIX = ", extra person, duplicate, cloned character, umbrella, parasol, new object, frame, border"

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


def read_agent_token() -> str:
    try:
        token = AGENT_TOKEN_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if len(token) < 32 or any(character.isspace() for character in token):
        return ""
    return token


def ensure_agent_token() -> None:
    if read_agent_token():
        print(f"Muse用の合言葉: {AGENT_TOKEN_PATH.name}", flush=True)
        return
    AGENT_TOKEN_PATH.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
    print(f"Muse用の合言葉を作りました: {AGENT_TOKEN_PATH.name}", flush=True)
    print("このファイルは GitHub には上げません。中身を人に見せないでください。", flush=True)


_agent_peer_ips: set[str] = set()
_agent_peer_checked = 0.0
_agent_peer_lock = threading.Lock()


def agent_peer_ips() -> set[str]:
    """tag:agent が付いた端末の Tailscale アドレスです。番号は起動のたびに読み直します。"""
    global _agent_peer_ips, _agent_peer_checked
    now = time.time()
    with _agent_peer_lock:
        if _agent_peer_checked and now - _agent_peer_checked < 30:
            return set(_agent_peer_ips)
    found: set[str] = set()
    try:
        status = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if status.returncode != 0 or not status.stdout:
            raise OSError("tailscale status failed")
        payload = json.loads(status.stdout)
        peers = payload.get("Peer") or {}
        values = peers.values() if isinstance(peers, dict) else peers
        for peer in values:
            tags = [str(tag) for tag in (peer.get("Tags") or [])]
            if "tag:agent" not in tags:
                continue
            for address in peer.get("TailscaleIPs") or []:
                text = str(address).strip()
                if text:
                    found.add(text)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        with _agent_peer_lock:
            return set(_agent_peer_ips)
    with _agent_peer_lock:
        _agent_peer_ips = found
        _agent_peer_checked = time.time()
        return set(found)


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


def tag_key(tag: str) -> str:
    return " ".join(tag.lower().split())


def split_tags(text: str) -> list[str]:
    """カンマで分けます。括弧の中のカンマは、一つの言葉として残します。"""
    tags: list[str] = []
    buf: list[str] = []
    depth = 0
    escaped = False
    for char in text:
        if escaped:
            buf.append(char)
            escaped = False
            continue
        if char == "\\":
            buf.append(char)
            escaped = True
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        if char == "," and depth == 0:
            tag = "".join(buf).strip()
            if tag:
                tags.append(tag)
            buf = []
            continue
        buf.append(char)
    tail = "".join(buf).strip()
    if tail:
        tags.append(tail)
    return tags


def strip_expand_suffix(text: str) -> str:
    cleaned = text.strip()
    if cleaned.endswith(EXPAND_PROMPT_SUFFIX):
        cleaned = cleaned[: -len(EXPAND_PROMPT_SUFFIX)]
    return cleaned.strip().strip(",")


def positive_text(raw: bytes) -> str:
    try:
        graph = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ""
    if not isinstance(graph, dict):
        return ""
    for node in graph.values():
        if not isinstance(node, dict) or node.get("class_type") != "KSampler":
            continue
        ref = (node.get("inputs") or {}).get("positive")
        if not isinstance(ref, list) or not ref:
            continue
        target = graph.get(str(ref[0]))
        if not isinstance(target, dict):
            continue
        text = (target.get("inputs") or {}).get("text")
        if isinstance(text, str) and text.strip():
            return strip_expand_suffix(text)
    return ""


def positive_prompt_in_png(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                return ""
            while True:
                header = handle.read(8)
                if len(header) < 8:
                    return ""
                length, kind = struct.unpack(">I4s", header)
                if length > 20_000_000:
                    return ""
                if kind == b"tEXt":
                    chunk = handle.read(length)
                    handle.read(4)
                    if len(chunk) != length:
                        return ""
                    key, _, value = chunk.partition(b"\x00")
                    if key == b"prompt":
                        return positive_text(value)
                    continue
                if kind == b"IEND":
                    return ""
                handle.seek(length + 4, os.SEEK_CUR)
    except OSError:
        return ""
    return ""


def recent_prompt_tags(limit: int = 36) -> list[list[str]]:
    if not OUTPUT_DIR.is_dir():
        return []
    files = [
        path
        for path in OUTPUT_DIR.glob("studio_*.png")
        if not path.name.startswith("studio_expand_")
    ]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    found: list[list[str]] = []
    for path in files:
        tags = split_tags(positive_prompt_in_png(path))
        if not tags:
            continue
        found.append(tags)
        if len(found) >= limit:
            break
    return found


def fallback_prompt() -> str:
    base = ["1girl", "solo", "looking at viewer", "soft smile"]
    words = read_extra_words()
    if not words:
        return ", ".join(base + ["simple background"])
    pick_count = min(len(words), random.randint(4, 7))
    return ", ".join(base + random.sample(words, pick_count))


def remix_tags(lists: list[list[str]]) -> str:
    """よく出る言葉は残し、場所が近い言葉だけを別の絵から入れ替えます。"""
    count = len(lists)
    weights = [1.0 - 0.6 * (index / max(count - 1, 1)) for index in range(count)]
    appearances: dict[str, int] = {}
    scores: dict[str, float] = {}
    spellings: dict[str, str] = {}
    position_sum: dict[str, float] = {}
    position_n: dict[str, int] = {}
    for tags, weight in zip(lists, weights):
        seen: set[str] = set()
        for pos, tag in enumerate(tags):
            key = tag_key(tag)
            if not key or key in seen:
                continue
            seen.add(key)
            appearances[key] = appearances.get(key, 0) + 1
            scores[key] = scores.get(key, 0.0) + weight
            position_sum[key] = position_sum.get(key, 0.0) + pos
            position_n[key] = position_n.get(key, 0) + 1
            spellings.setdefault(key, tag)

    total = sum(weights)
    core = {
        key
        for key, score in scores.items()
        if appearances[key] >= 2 and score >= total * 0.42
    }
    if len(core) > 14:
        core = set(sorted(core, key=lambda key: scores[key], reverse=True)[:14])

    def average_pos(key: str) -> float:
        return position_sum[key] / position_n[key]

    originals = {frozenset(tag_key(tag) for tag in tags) for tags in lists}
    pool = [key for key in scores if key not in core]

    def pick_neighbor(key: str, used: set[str]) -> str:
        here = average_pos(key)
        nearby = [
            other
            for other in pool
            if other not in used and abs(average_pos(other) - here) <= 4
        ]
        if not nearby:
            return ""
        return random.choices(nearby, weights=[scores[other] for other in nearby], k=1)[0]

    text = ""
    for _attempt in range(8):
        donor = random.choices(range(count), weights=weights, k=1)[0]
        chosen: list[str] = []
        used: set[str] = set()
        for tag in lists[donor]:
            key = tag_key(tag)
            if not key or key in used:
                continue
            if key not in core and random.random() < 0.55:
                replacement = pick_neighbor(key, used)
                if replacement:
                    key = replacement
                elif random.random() < 0.4:
                    continue
            chosen.append(key)
            used.add(key)
        for key in sorted(core, key=average_pos):
            if key not in used:
                chosen.append(key)
                used.add(key)
        if pool and random.random() < 0.65:
            extras = [key for key in pool if key not in used]
            if extras:
                extra = random.choices(extras, weights=[scores[key] for key in extras], k=1)[0]
                chosen.append(extra)
        chosen.sort(key=average_pos)
        while len(chosen) > 4 and len(", ".join(spellings[key] for key in chosen)) > 1800:
            removable = [key for key in chosen if key not in core]
            if not removable:
                break
            drop = min(removable, key=lambda key: scores[key])
            chosen.remove(drop)
        text = ", ".join(spellings[key] for key in chosen)
        if text and frozenset(chosen) not in originals:
            return text
    if text:
        used_now = {tag_key(tag) for tag in split_tags(text)}
        extras = [word for word in read_extra_words() if tag_key(word) not in used_now]
        if extras:
            return f"{text}, {random.choice(extras)}"
    return text or fallback_prompt()


def matches_hint(tags: list[str], hints: list[str]) -> bool:
    blob = ", ".join(tag_key(tag) for tag in tags)
    return any(hint and hint in blob for hint in hints)


def build_random_prompt(current: str, hints: list | None = None) -> dict:
    lists = recent_prompt_tags()
    clean_hints = []
    for hint in hints or []:
        if isinstance(hint, str):
            key = tag_key(hint)[:200]
            if key and key not in clean_hints:
                clean_hints.append(key)
        if len(clean_hints) >= 8:
            break
    if clean_hints:
        matched = [tags for tags in lists if matches_hint(tags, clean_hints)]
        if len(matched) >= 4:
            lists = matched
    picture_count = len(lists)
    current_tags = split_tags(strip_expand_suffix(str(current or "")))
    if current_tags:
        lists = [current_tags, *lists]
    if not lists:
        return {"prompt": fallback_prompt(), "source_count": 0}
    return {"prompt": remix_tags(lists), "source_count": picture_count}


def read_cards() -> dict:
    empty = {"checkpoints": {}, "loras": {}}
    if not CARDS_PATH.is_file():
        return empty
    try:
        data = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return empty
    if not isinstance(data, dict):
        return empty
    cards = {}
    for kind in ("checkpoints", "loras"):
        bucket = data.get(kind)
        cards[kind] = bucket if isinstance(bucket, dict) else {}
    return cards


def public_preview(stored: str, fallback: str = "") -> str:
    name = Path(stored).name if stored else ""
    preview = PREVIEW_DIR / name
    if name and preview.is_file():
        return "/previews/" + name
    if fallback.startswith("/") and ".." not in fallback:
        return fallback
    return ""


def card_fields(cards: dict, kind: str, model_id: str, fallback: str = "") -> dict:
    item = (cards.get(kind) or {}).get(model_id) or {}
    if not isinstance(item, dict):
        item = {}
    url = str(item.get("url") or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        url = ""
    return {
        "preview": public_preview(str(item.get("preview") or ""), fallback),
        "url": url,
    }


def parse_multipart(body: bytes, boundary: str) -> dict:
    marker = b"--" + boundary.encode("utf-8")
    fields: dict = {}
    for chunk in body.split(marker):
        chunk = chunk.strip(b"\r\n")
        if not chunk or chunk == b"--":
            continue
        if chunk.endswith(b"--"):
            chunk = chunk[:-2].rstrip(b"\r\n")
        header, sep, data = chunk.partition(b"\r\n\r\n")
        if not sep:
            continue
        if data.endswith(b"\r\n"):
            data = data[:-2]
        disposition = header.decode("utf-8", "replace")
        name = ""
        filename = ""
        for piece in disposition.split(";"):
            piece = piece.strip()
            if piece.startswith("name="):
                name = piece[5:].strip('"')
            elif piece.startswith("filename="):
                filename = piece[9:].strip('"')
        if not name:
            continue
        if filename:
            fields[name] = {"filename": Path(filename).name, "data": data}
        else:
            fields[name] = data.decode("utf-8", "replace")
    return fields


def write_preview(kind: str, model_id: str, data: bytes) -> str:
    if len(data) > 5_000_000:
        raise ValueError("画像が大きすぎます。5MBまでです。")
    is_png = data.startswith(b"\x89PNG\r\n\x1a\n")
    is_jpeg = data.startswith(b"\xff\xd8\xff")
    is_webp = data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    if not (is_png or is_jpeg or is_webp):
        raise ValueError("画像は PNG、JPEG、WebP にしてください。")
    from PIL import Image

    try:
        image = Image.open(io.BytesIO(data))
        image = image.convert("RGB")
    except Exception as error:
        raise ValueError("画像を読めませんでした。") from error
    image.thumbnail((640, 800))
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha256(f"{kind}:{model_id}".encode()).hexdigest()[:20] + ".jpg"
    image.save(PREVIEW_DIR / name, "JPEG", quality=85)
    return name


def known_model_ids(kind: str) -> set[str]:
    path = "/models/checkpoints" if kind == "checkpoints" else "/models/loras"
    names = comfy_json("GET", path)
    if not isinstance(names, list):
        return set()
    return {name for name in names if isinstance(name, str)}


def save_model_card(kind: str, model_id: str, url: str, image: bytes | None) -> dict:
    if kind not in {"checkpoints", "loras"}:
        raise ValueError("種類を確認してください。")
    if not model_id or Path(model_id).name != model_id:
        raise ValueError("モデル名を確認してください。")
    if model_id not in known_model_ids(kind):
        raise ValueError("そのファイルは一覧にありません。")
    url = url.strip()
    if url:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or len(url) > 500:
            raise ValueError("詳細のURLは http か https のページにしてください。")
    with _cards_lock:
        cards = read_cards()
        bucket = cards.setdefault(kind, {})
        current = bucket.get(model_id) if isinstance(bucket.get(model_id), dict) else {}
        preview_name = str(current.get("preview") or "")
        if image:
            preview_name = write_preview(kind, model_id, image)
        elif not preview_name and not url:
            raise ValueError("画像か、ダウンロード元のURLを入れてください。")
        bucket[model_id] = {"preview": preview_name, "url": url}
        CARDS_PATH.write_text(json.dumps(cards, ensure_ascii=False, indent=2), encoding="utf-8")
    fallback = LORA_CATALOG.get(model_id, {}).get("preview", "") if kind == "loras" else ""
    shown = card_fields({"checkpoints": {}, "loras": {}, kind: {model_id: bucket[model_id]}}, kind, model_id, fallback)
    return {"ok": True, "preview": shown["preview"], "url": shown["url"]}


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
    cards = read_cards()
    return {
        "ready": True,
        "checkpoints": [
            {
                "id": name,
                "name": CHECKPOINT_NAMES.get(name, Path(name).stem),
                **card_fields(cards, "checkpoints", name),
            }
            for name in checkpoints
        ],
        "loras": [
            {
                "id": name,
                "name": LORA_CATALOG.get(name, {}).get("name", Path(name).stem),
                **card_fields(cards, "loras", name, LORA_CATALOG.get(name, {}).get("preview", "")),
                "triggers": LORA_CATALOG.get(name, {}).get("triggers", []),
                "shared": LORA_CATALOG.get(name, {}).get("shared", []),
                "outfits": LORA_CATALOG.get(name, {}).get("outfits", []),
            }
            for name in loras
        ],
        "ratios": RATIOS,
        "output_dir": str(OUTPUT_DIR),
        "extra_words": read_extra_words(),
    }


MAX_LORAS = 5


def selected_loras(body: dict, lora_ids: set[str]) -> list[tuple[str, float]]:
    raw = body.get("loras")
    if isinstance(raw, list) and raw:
        items = raw
    elif body.get("lora"):
        items = [{"id": body.get("lora"), "strength": body.get("strength", 1)}]
    else:
        items = []
    if len(items) > MAX_LORAS:
        raise ValueError("同時に使える LoRA は 5 つまでです。")
    chosen: list[tuple[str, float]] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("LoRA の選択を確認してください。")
        lora_id = str(item.get("id") or item.get("lora") or "")
        if not lora_id:
            continue
        if lora_id not in lora_ids or lora_id in seen:
            raise ValueError("LoRA の選択を確認してください。")
        try:
            strength = float(item.get("strength") if item.get("strength") is not None else 1)
        except (TypeError, ValueError) as error:
            raise ValueError("LoRA の強さを確認してください。") from error
        if strength < 0 or strength > 2:
            raise ValueError("LoRA の強さは 0 から 2 の間にしてください。")
        seen.add(lora_id)
        chosen.append((lora_id, strength))
    return chosen


def align_down(value: float, minimum: int = 64) -> int:
    return max(minimum, int(value) // 8 * 8)


def fit_output(width: int, height: int) -> tuple[int, int]:
    if width <= MAX_SIDE and height <= MAX_SIDE and width * height <= MAX_PIXELS:
        return width, height
    fit = min(MAX_SIDE / width, MAX_SIDE / height, (MAX_PIXELS / (width * height)) ** 0.5)
    return align_down(width * fit), align_down(height * fit)


def ensure_memory(width: int, height: int, count: int) -> None:
    if width * height * count * BYTES_PER_PIXEL > MAX_OUTPUT_BYTES:
        raise ValueError("このサイズと枚数の組み合わせはメモリが足りなくなります。枚数を減らすか、解像度を下げてください。")


def png_size(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as handle:
            header = handle.read(24)
    except OSError:
        return None
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", header[16:24])
    if width < 64 or height < 64:
        return None
    return width, height


def output_image_file(source: object) -> tuple[Path, str]:
    if not isinstance(source, dict):
        raise ValueError("元の絵が見つかりません。一覧の絵をもう一度開いてください。")
    filename = str(source.get("filename") or "")
    subfolder = str(source.get("subfolder") or "").replace("\\", "/").strip("/")
    if not filename or Path(filename).name != filename or filename.startswith("."):
        raise ValueError("元の絵が見つかりません。一覧の絵をもう一度開いてください。")
    if Path(filename).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise ValueError("この形式の絵からは作れません。")
    parts = [part for part in subfolder.split("/") if part] if subfolder else []
    if any(part in {".", ".."} for part in parts):
        raise ValueError("元の絵が見つかりません。一覧の絵をもう一度開いてください。")
    path = OUTPUT_DIR.joinpath(*parts, filename).resolve()
    root = OUTPUT_DIR.resolve()
    if path != root and root not in path.parents:
        raise ValueError("元の絵が見つかりません。一覧の絵をもう一度開いてください。")
    if not path.is_file():
        raise ValueError("元の絵が見つかりません。一覧の絵をもう一度開いてください。")
    relative = "/".join([*parts, filename])
    return path, f"{relative} [output]"


def picture_size(path: Path, body: dict) -> tuple[int, int]:
    found = png_size(path)
    if found:
        width, height = found
    else:
        try:
            width = int(body.get("width"))
            height = int(body.get("height"))
        except (TypeError, ValueError) as error:
            raise ValueError("元の絵のサイズを読めませんでした。") from error
    if width < 64 or height < 64 or width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
        raise ValueError("この絵のサイズでは、別パターンや拡張ができません。")
    return width, height


def expand_layout(width: int, height: int, pad: int) -> dict[str, int]:
    pad = int(pad) // 8 * 8
    room = DIRECT_LONG_SIDE - 2 * pad
    if room < 512:
        pad = (DIRECT_LONG_SIDE - 512) // 2 // 8 * 8
        room = DIRECT_LONG_SIDE - 2 * pad
    scale = min(1.0, room / max(width, height))
    if width >= height:
        content_w = align_down(width * scale)
        content_h = max(64, align_down(height * content_w / width))
    else:
        content_h = align_down(height * scale)
        content_w = max(64, align_down(width * content_h / height))
    while content_w + 2 * pad > DIRECT_LONG_SIDE or content_h + 2 * pad > DIRECT_LONG_SIDE:
        if width >= height and content_w > 64:
            content_w -= 8
            content_h = max(64, align_down(height * content_w / width))
        elif content_h > 64:
            content_h -= 8
            content_w = max(64, align_down(width * content_h / height))
        else:
            break
    draw_w = content_w + 2 * pad
    draw_h = content_h + 2 * pad
    restore = width / content_w
    out_w = max(64, int(round(draw_w * restore / 8)) * 8)
    out_h = max(64, int(round(draw_h * restore / 8)) * 8)
    out_w, out_h = fit_output(out_w, out_h)
    if out_w <= width or out_h <= height:
        raise ValueError("この絵はすでに大きいので、周りを広げる余白が足りません。もう少し小さい絵で試してください。")
    paste_x = max(0, (out_w - width) // 2)
    paste_y = max(0, (out_h - height) // 2)
    short_content = min(content_w, content_h)
    feather = min(160, max(24, pad // 2), max(24, short_content // 4))
    if feather * 2 >= short_content:
        feather = max(8, short_content // 2 - 8)
    blend = min(paste_x, paste_y, max(width, 1) // 5, max(height, 1) // 5)
    return {
        "content_w": content_w,
        "content_h": content_h,
        "pad": pad,
        "draw_w": draw_w,
        "draw_h": draw_h,
        "out_w": out_w,
        "out_h": out_h,
        "feather": feather,
        "paste_x": paste_x,
        "paste_y": paste_y,
        "blend": max(24, blend),
    }


def read_seed(body: dict, *, fresh: bool) -> int:
    if fresh or body.get("seed") in (None, ""):
        return random.randrange(0, 2**32)
    try:
        seed = int(body.get("seed"))
    except (TypeError, ValueError) as error:
        raise ValueError("シードは数字にしてください。") from error
    if seed < 0 or seed > 2**32 - 1:
        raise ValueError("シードの数が範囲の外です。")
    return seed


def generation_inputs(body: dict, mode: str) -> dict:
    options = list_options()
    if not options["ready"]:
        raise ValueError("画像エンジンの準備がまだです。少し待ってからもう一度押してください。")

    checkpoint_ids = {item["id"] for item in options["checkpoints"]}
    lora_ids = {item["id"] for item in options["loras"]}
    checkpoint = str(body.get("checkpoint") or "")
    if checkpoint not in checkpoint_ids:
        raise ValueError("基礎モデルを選んでください。")

    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("中央の欄に、描きたい内容を書いてください。")
    if len(prompt) > 4000:
        raise ValueError("文章が長すぎます。4000 文字以内にしてください。")
    negative = str(body.get("negative") or "").strip()[:4000]

    if mode == "create":
        width, height = image_size(body)
        try:
            count = int(body.get("count") or 1)
        except (TypeError, ValueError) as error:
            raise ValueError("枚数を確認してください。") from error
        if count < 1 or count > 99:
            raise ValueError("一度に作れる枚数は 1 枚から 99 枚です。")
        ensure_memory(width, height, count)
        draw_width, draw_height = sampling_size(width, height)
        return {
            "checkpoint": checkpoint,
            "loras": selected_loras(body, lora_ids),
            "prompt": prompt,
            "negative": negative,
            "seed": read_seed(body, fresh=False),
            "count": count,
            "width": width,
            "height": height,
            "out_width": width,
            "out_height": height,
            "draw_width": draw_width,
            "draw_height": draw_height,
        }

    image_path, annotation = output_image_file(body.get("source"))
    width, height = picture_size(image_path, body)
    source_path = str(image_path)
    if mode == "vary":
        draw_width, draw_height = sampling_size(width, height)
        ensure_memory(width, height, VARY_COUNT)
        return {
            "checkpoint": checkpoint,
            "loras": selected_loras(body, lora_ids),
            "prompt": prompt,
            "negative": negative,
            "seed": read_seed(body, fresh=True),
            "count": VARY_COUNT,
            "width": width,
            "height": height,
            "out_width": width,
            "out_height": height,
            "draw_width": draw_width,
            "draw_height": draw_height,
            "source": annotation,
            "denoise": VARY_DENOISE,
        }

    try:
        pad = int(body.get("pad") or 256)
    except (TypeError, ValueError) as error:
        raise ValueError("足す幅を選んでください。") from error
    if pad not in EXPAND_PADS:
        raise ValueError("足す幅を選んでください。")
    layout = expand_layout(width, height, pad)
    ensure_memory(layout["out_w"], layout["out_h"], 1)
    expanded_prompt = f"{prompt}{EXPAND_PROMPT_SUFFIX}"[:4000]
    expanded_negative = f"{negative}{EXPAND_NEGATIVE_SUFFIX}".strip()[:4000]
    return {
        "checkpoint": checkpoint,
        "loras": selected_loras(body, lora_ids),
        "prompt": expanded_prompt,
        "negative": expanded_negative,
        "seed": read_seed(body, fresh=True),
        "count": 1,
        "width": width,
        "height": height,
        "out_width": layout["out_w"],
        "out_height": layout["out_h"],
        "source": annotation,
        "source_path": source_path,
        "layout": layout,
    }


def model_nodes(checkpoint: str, loras: list[tuple[str, float]]) -> tuple[dict[str, dict], list]:
    graph: dict[str, dict] = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
    }
    model_ref = ["1", 0]
    clip_ref = ["1", 1]
    for index, (lora_id, strength) in enumerate(loras):
        node_id = str(20 + index)
        graph[node_id] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": model_ref,
                "clip": clip_ref,
                "lora_name": lora_id,
                "strength_model": strength,
                "strength_clip": strength,
            },
        }
        model_ref = [node_id, 0]
        clip_ref = [node_id, 1]
    graph["3"] = {
        "class_type": "CLIPSetLastLayer",
        "inputs": {"clip": clip_ref, "stop_at_clip_layer": -2},
    }
    return graph, model_ref


def add_prompts(graph: dict[str, dict], prompt: str, negative: str) -> None:
    graph["4"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": prompt, "clip": ["3", 0]},
    }
    graph["5"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": ["3", 0]},
    }


def add_sampler(graph: dict[str, dict], model_ref: list, seed: int, latent_ref: list, denoise: float) -> None:
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
            "latent_image": latent_ref,
            "denoise": denoise,
        },
    }
    graph["8"] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["7", 0], "vae": ["1", 2]},
    }


def add_scale(graph: dict[str, dict], image_ref: list, width: int, height: int, node_id: str) -> list:
    graph[node_id] = {
        "class_type": "ImageScale",
        "inputs": {
            "image": image_ref,
            "upscale_method": "lanczos",
            "width": width,
            "height": height,
            "crop": "disabled",
        },
    }
    return [node_id, 0]


def add_save(
    graph: dict[str, dict],
    image_ref: list,
    current: tuple[int, int],
    target: tuple[int, int],
    prefix: str,
) -> None:
    if current != target:
        image_ref = add_scale(graph, image_ref, target[0], target[1], "10")
    graph["9"] = {
        "class_type": "SaveImage",
        "inputs": {"images": image_ref, "filename_prefix": prefix},
    }


def build_create(spec: dict, prefix: str) -> dict:
    graph, model_ref = model_nodes(spec["checkpoint"], spec["loras"])
    add_prompts(graph, spec["prompt"], spec["negative"])
    graph["6"] = {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "width": spec["draw_width"],
            "height": spec["draw_height"],
            "batch_size": spec["count"],
        },
    }
    add_sampler(graph, model_ref, spec["seed"], ["6", 0], 1)
    add_save(
        graph,
        ["8", 0],
        (spec["draw_width"], spec["draw_height"]),
        (spec["out_width"], spec["out_height"]),
        prefix,
    )
    return graph


def build_vary(spec: dict, prefix: str) -> dict:
    graph, model_ref = model_nodes(spec["checkpoint"], spec["loras"])
    add_prompts(graph, spec["prompt"], spec["negative"])
    graph["11"] = {
        "class_type": "LoadImageOutput",
        "inputs": {"image": spec["source"]},
    }
    image_ref = ["11", 0]
    if (spec["width"], spec["height"]) != (spec["draw_width"], spec["draw_height"]):
        image_ref = add_scale(graph, image_ref, spec["draw_width"], spec["draw_height"], "13")
    graph["12"] = {
        "class_type": "VAEEncode",
        "inputs": {"pixels": image_ref, "vae": ["1", 2]},
    }
    graph["14"] = {
        "class_type": "RepeatLatentBatch",
        "inputs": {"samples": ["12", 0], "amount": spec["count"]},
    }
    add_sampler(graph, model_ref, spec["seed"], ["14", 0], spec["denoise"])
    add_save(
        graph,
        ["8", 0],
        (spec["draw_width"], spec["draw_height"]),
        (spec["out_width"], spec["out_height"]),
        prefix,
    )
    return graph


def write_expand_context(source: Path, layout: dict[str, int]) -> str:
    """灰色の余白ではなく、今の絵のふちの色を伸ばした下絵を作ります。"""
    import numpy as np
    from PIL import Image, ImageFilter

    image = Image.open(source).convert("RGB").resize(
        (layout["content_w"], layout["content_h"]),
        Image.Resampling.LANCZOS,
    )
    pad = layout["pad"]
    padded = np.pad(np.asarray(image), ((pad, pad), (pad, pad), (0, 0)), mode="edge")
    soft = np.asarray(
        Image.fromarray(padded).filter(ImageFilter.GaussianBlur(radius=max(12, pad // 4)))
    ).astype(np.float32)
    sharp = padded.astype(np.float32)
    height, width = sharp.shape[:2]
    rows, cols = np.ogrid[:height, :width]
    inside = np.minimum(
        np.minimum(rows - pad, pad + layout["content_h"] - 1 - rows),
        np.minimum(cols - pad, pad + layout["content_w"] - 1 - cols),
    ).astype(np.float32)
    weight = np.clip(inside / max(layout["feather"], 1), 0, 1)[..., None]
    mixed = Image.fromarray((sharp * weight + soft * (1 - weight)).astype(np.uint8), "RGB")
    for old in OUTPUT_DIR.glob("studio_expand_*.png"):
        old.unlink(missing_ok=True)
    name = f"studio_expand_{uuid.uuid4().hex[:8]}.png"
    mixed.save(OUTPUT_DIR / name, compress_level=1)
    return f"{name} [output]"


def build_expand(spec: dict, prefix: str) -> dict:
    layout = spec["layout"]
    graph, model_ref = model_nodes(spec["checkpoint"], spec["loras"])
    add_prompts(graph, spec["prompt"], spec["negative"])
    graph["11"] = {
        "class_type": "LoadImageOutput",
        "inputs": {"image": spec["source"]},
    }
    image_ref = ["11", 0]
    if (spec["width"], spec["height"]) != (layout["content_w"], layout["content_h"]):
        image_ref = add_scale(graph, image_ref, layout["content_w"], layout["content_h"], "13")
    graph["15"] = {
        "class_type": "ImagePadForOutpaint",
        "inputs": {
            "image": image_ref,
            "left": layout["pad"],
            "top": layout["pad"],
            "right": layout["pad"],
            "bottom": layout["pad"],
            "feathering": layout["feather"],
        },
    }
    # マスクを丸めると境目が直線になるので、ぼかしたマスクのまま描く。
    graph["24"] = {
        "class_type": "LoadImageOutput",
        "inputs": {"image": write_expand_context(Path(spec["source_path"]), layout)},
    }
    graph["12"] = {
        "class_type": "VAEEncode",
        "inputs": {"pixels": ["24", 0], "vae": ["1", 2]},
    }
    graph["19"] = {
        "class_type": "SetLatentNoiseMask",
        "inputs": {"samples": ["12", 0], "mask": ["15", 1]},
    }
    # 強く描き直すと、余白に別の飾りを足して境目が切れる。弱く整えるだけにする。
    add_sampler(graph, model_ref, spec["seed"], ["19", 0], 0.45)
    painted = ["8", 0]
    if (layout["draw_w"], layout["draw_h"]) != (layout["out_w"], layout["out_h"]):
        painted = add_scale(graph, painted, layout["out_w"], layout["out_h"], "10")
    graph["16"] = {
        "class_type": "SolidMask",
        "inputs": {"value": 1.0, "width": spec["width"], "height": spec["height"]},
    }
    graph["17"] = {
        "class_type": "FeatherMask",
        "inputs": {
            "mask": ["16", 0],
            "left": layout["blend"],
            "top": layout["blend"],
            "right": layout["blend"],
            "bottom": layout["blend"],
        },
    }
    graph["21"] = {
        "class_type": "MaskToImage",
        "inputs": {"mask": ["17", 0]},
    }
    graph["22"] = {
        "class_type": "ImageBlur",
        "inputs": {"image": ["21", 0], "blur_radius": 31, "sigma": 10.0},
    }
    graph["23"] = {
        "class_type": "ImageToMask",
        "inputs": {"image": ["22", 0], "channel": "red"},
    }
    graph["18"] = {
        "class_type": "ImageCompositeMasked",
        "inputs": {
            "destination": painted,
            "source": ["11", 0],
            "x": layout["paste_x"],
            "y": layout["paste_y"],
            "resize_source": False,
            "mask": ["23", 0],
        },
    }
    graph["9"] = {
        "class_type": "SaveImage",
        "inputs": {"images": ["18", 0], "filename_prefix": prefix},
    }
    return graph


def build_graph(body: dict, prefix: str = "studio") -> tuple[dict, int, tuple[int, int]]:
    mode = str(body.get("mode") or "create")
    if mode not in {"create", "vary", "expand"}:
        raise ValueError("操作を確認してください。")
    spec = generation_inputs(body, mode)
    if mode == "vary":
        graph = build_vary(spec, prefix)
    elif mode == "expand":
        graph = build_expand(spec, prefix)
    else:
        graph = build_create(spec, prefix)
    return graph, spec["seed"], (spec["out_width"], spec["out_height"])


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
                "subfolder": image.get("subfolder") or "",
                "path": str(folder / filename),
            })
    if not images and not status.get("completed"):
        return running_status(prompt_id, known)
    forget_progress(prompt_id)
    folders = {image["subfolder"] for image in images}
    saved_dir = OUTPUT_DIR / folders.pop() if len(folders) == 1 else OUTPUT_DIR
    return {"state": "done", "seed": known["seed"], "images": images, "output_dir": str(saved_dir)}


class StudioHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        if str(args[1:2]) not in {"('200',)", "('304',)"}:
            super().log_message(fmt, *args)

    def log_error(self, fmt: str, *args) -> None:
        if args and args[0] == 404:
            return
        super().log_error(fmt, *args)

    def bearer_token(self) -> str:
        header = self.headers.get("Authorization") or ""
        scheme, _, value = header.partition(" ")
        if scheme.lower() != "bearer":
            return ""
        return value.strip()

    def client_ip(self) -> str:
        host = str(self.client_address[0] if self.client_address else "")
        if host.startswith("::ffff:"):
            return host.removeprefix("::ffff:")
        return host

    def agent_authorized(self) -> bool:
        presented = self.bearer_token()
        expected = read_agent_token()
        if presented and expected and hmac.compare_digest(presented, expected):
            return True
        # 合言葉をチャットに出さず、tag:agent の端末だけを通す。
        return self.client_ip() in agent_peer_ips()

    def reject_agent(self) -> None:
        self.send_json({"error": "合言葉が違います。"}, status=401)

    def for_agent(self, payload: dict) -> dict:
        images = payload.get("images")
        if not images:
            return payload
        copied = dict(payload)
        copied["images"] = []
        for image in images:
            item = dict(image)
            query = urllib.parse.urlparse(str(item.get("url") or "")).query
            if query:
                item["url"] = "/api/agent/image?" + query
            copied["images"].append(item)
        return copied

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/agent/options":
            if not self.agent_authorized():
                self.reject_agent()
                return
            self.send_json(list_options())
            return
        if parsed.path.startswith("/api/agent/jobs/"):
            if not self.agent_authorized():
                self.reject_agent()
                return
            prompt_id = parsed.path.removeprefix("/api/agent/jobs/")
            self.send_json(self.for_agent(job_status(prompt_id)))
            return
        if parsed.path == "/api/agent/image":
            if not self.agent_authorized():
                self.reject_agent()
                return
            self.send_image(urllib.parse.parse_qs(parsed.query))
            return
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
        return self.read_body_object()

    def read_agent_json(self) -> dict | None:
        if not self.agent_authorized():
            self.reject_agent()
            return None
        return self.read_body_object()

    def read_body_object(self) -> dict | None:
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

    def read_model_card(self) -> dict | None:
        if not self.from_studio_screen():
            self.send_json({"error": "この操作は Atelier R の画面からだけ受け付けます。"}, status=403)
            return None
        content_type = self.headers.get("Content-Type") or ""
        if "multipart/form-data" not in content_type.lower():
            self.send_json({"error": "送信形式が正しくありません。"}, status=415)
            return None
        boundary = ""
        for piece in content_type.split(";"):
            piece = piece.strip()
            if piece.lower().startswith("boundary="):
                boundary = piece.split("=", 1)[1].strip().strip('"')
        if not boundary:
            self.send_json({"error": "送信形式が正しくありません。"}, status=400)
            return None
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.send_json({"error": "送信内容を読めませんでした。"}, status=400)
            return None
        if length <= 0 or length > 6_000_000:
            self.send_json({"error": "画像が大きすぎます。5MBまでです。"}, status=400)
            return None
        return parse_multipart(self.rfile.read(length), boundary)

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/random-prompt":
            body = self.read_json_object()
            if body is None:
                return
            current = body.get("prompt") or ""
            hints = body.get("hints") or []
            if not isinstance(current, str) or not isinstance(hints, list):
                self.send_json({"error": "文章を読めませんでした。"}, status=400)
                return
            self.send_json(build_random_prompt(current[:4000], hints))
            return
        if path == "/api/model-card":
            fields = self.read_model_card()
            if fields is None:
                return
            image = fields.get("image")
            image_bytes = image.get("data") if isinstance(image, dict) else None
            if image_bytes == b"":
                image_bytes = None
            try:
                saved = save_model_card(
                    str(fields.get("kind") or ""),
                    str(fields.get("id") or ""),
                    str(fields.get("url") or ""),
                    image_bytes,
                )
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return
            except RuntimeError:
                self.send_json({"error": "モデル一覧を確認できませんでした。"}, status=502)
                return
            self.send_json(saved)
            return
        if path == "/api/open-folder":
            if self.read_json_object(local_only=True) is None:
                return
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            os.startfile(OUTPUT_DIR)
            self.send_json({"ok": True, "path": str(OUTPUT_DIR)})
            return
        if path == "/api/agent/generate":
            body = self.read_agent_json()
            if body is not None:
                self.begin_generation(body, for_muse=True)
            return
        if path != "/api/generate":
            self.send_error(404)
            return
        body = self.read_json_object()
        if body is None:
            return
        self.begin_generation(body, for_muse=False)

    def begin_generation(self, body: dict, *, for_muse: bool) -> None:
        try:
            prefix = "muse/studio" if for_muse else "studio"
            graph, seed, size = build_graph(body, prefix)
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
        payload = {"prompt_id": prompt_id, "seed": seed, "width": size[0], "height": size[1]}
        if for_muse:
            payload["status_url"] = f"/api/agent/jobs/{prompt_id}"
        self.send_json(payload)

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
        self.send_header("Cache-Control", "no-store")
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
            if node in {"1", "2"} or (node.isdigit() and 20 <= int(node) <= 29):
                _stage[prompt_id] = "モデルを読み込んでいます"
            elif node == "11":
                _stage[prompt_id] = "元の絵を読み込んでいます"
            elif node in {"12", "13", "14"}:
                _stage[prompt_id] = "元の絵を取り込んでいます"
            elif node == "15":
                _stage[prompt_id] = "周りに余白を足しています"
            elif node in {"16", "17", "18", "19", "21", "22", "23"}:
                _stage[prompt_id] = "元の絵の位置を合わせています"
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
    ensure_agent_token()
    refresh_tailscale_names()
    peers = ", ".join(sorted(agent_peer_ips()))
    if peers:
        print(f"合言葉なしで通す端末: {peers}", flush=True)
    else:
        print("tag:agent の端末は見つかりません。Muse には合言葉が必要です。", flush=True)
    if port_is_open(STUDIO_PORT):
        if os.environ.get("STUDIO_SKIP_DIALOG") != "1":
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
