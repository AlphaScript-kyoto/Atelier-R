"""画像にタグ、または短い英語の説明を付ける。"""

from __future__ import annotations

import csv
import re
import threading
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

TAGGER_DIR = Path(__file__).resolve().parent / "tagger"
TAG_THRESHOLD = 0.35
MAX_TAGS = 40
FACE_TOKENS = {
    "ahoge",
    "bangs",
    "blush",
    "braid",
    "braids",
    "eye",
    "eyebrows",
    "eyelashes",
    "eyeliner",
    "eyes",
    "eyeshadow",
    "face",
    "forehead",
    "freckles",
    "hair",
    "lips",
    "lipstick",
    "makeup",
    "mole",
    "nose",
    "ponytail",
    "pupil",
    "pupils",
    "sidelocks",
    "skin",
    "twintails",
}
_lock = threading.Lock()
_session: ort.InferenceSession | None = None
_tags: list[dict] | None = None
_blip = None


def _load_tagger() -> tuple[ort.InferenceSession, list[dict]]:
    global _session, _tags
    if _session is not None and _tags is not None:
        return _session, _tags
    model_path = TAGGER_DIR / "model.onnx"
    table_path = TAGGER_DIR / "selected_tags.csv"
    if not model_path.is_file() or not table_path.is_file():
        raise RuntimeError("タグ付け用のファイルが studio/tagger にありません。")
    with table_path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    _tags = rows
    _session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    return _session, _tags


def _square(image: Image.Image, size: int = 448) -> np.ndarray:
    image = image.convert("RGB")
    width, height = image.size
    scale = size / max(width, height)
    resized = image.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.BICUBIC)
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    # このタグ付けモデルは、色の並びが青・緑・赤で、0〜255 の小数を受け取る。
    return np.asarray(canvas, dtype=np.float32)[:, :, ::-1]


def is_face_tag(name: str) -> bool:
    parts = set(name.lower().replace("-", " ").replace("_", " ").split())
    return bool(parts & FACE_TOKENS)


def _escape_tag(name: str) -> str:
    text = name.replace("_", " ").strip()
    return text.replace("(", "\\(").replace(")", "\\)")


def tag_image(image: Image.Image, *, trigger: str, drop_face: bool) -> str:
    with _lock:
        session, rows = _load_tagger()
        array = np.expand_dims(_square(image), 0)
        probs = session.run(None, {"input": array})[0][0]
    scored = sorted(
        ((float(probs[index]), rows[index]) for index in range(min(len(rows), len(probs)))),
        key=lambda item: item[0],
        reverse=True,
    )
    names: list[str] = []
    for score, row in scored:
        if score < TAG_THRESHOLD or len(names) >= MAX_TAGS:
            break
        # 9 は評価、4 は既知のキャラクター名。呼び方で置き換えるので入れない。
        if row.get("category") in {"9", "4"}:
            continue
        name = str(row.get("name") or "").strip()
        if not name or (drop_face and is_face_tag(name)):
            continue
        names.append(_escape_tag(name))
    return _join(trigger, names)


def _join(trigger: str, parts: list[str]) -> str:
    trigger = trigger.strip()
    body = ", ".join(part for part in parts if part)
    if trigger and body:
        return f"{trigger}, {body}"
    return trigger or body


_FACE_PHRASE = re.compile(
    r"\b(?:long|short|medium|wavy|straight|curly|blonde|brown|black|red|pink|blue|silver|white|gray|grey|dark|light)\s+hair\b"
    r"|\b(?:blue|brown|green|black|red|gray|grey|dark|light)\s+eyes\b"
    r"|\b(?:bangs|ponytail|braid|braids)\b",
    re.IGNORECASE,
)


def _strip_face_words(text: str) -> str:
    cleaned = _FACE_PHRASE.sub("", text)
    cleaned = re.sub(r"\s+,", ",", cleaned)
    cleaned = re.sub(r",\s*,", ", ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip(" ,")


def describe_image(image: Image.Image, *, trigger: str, drop_face: bool) -> str:
    """FLUX 向けに、写真の内容を短い英語にする。"""
    global _blip
    with _lock:
        if _blip is None:
            from transformers import BlipForConditionalGeneration, BlipProcessor

            processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
            model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base")
            model.eval()
            _blip = (processor, model)
        processor, model = _blip
        import torch

        inputs = processor(image.convert("RGB"), return_tensors="pt")
        with torch.no_grad():
            tokens = model.generate(**inputs, max_new_tokens=40)
        text = processor.decode(tokens[0], skip_special_tokens=True).strip()
    if drop_face:
        text = _strip_face_words(text)
    return _join(trigger, [text] if text else [])
