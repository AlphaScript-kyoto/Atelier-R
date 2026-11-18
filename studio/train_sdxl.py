"""SDXL のチェックポイントから、ComfyUI で読める LoRA を作る。"""

from __future__ import annotations

import argparse
import gc
import json
import os
import random
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("DIFFUSERS_VERBOSITY", "error")
os.environ.setdefault("TQDM_DISABLE", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from safetensors.torch import save_file
from torch import nn


class LoRALinear(nn.Module):
    def __init__(self, base: nn.Linear, rank: int, alpha: int):
        super().__init__()
        self.base = base
        self.rank = rank
        self.alpha = float(alpha)
        self.down = nn.Linear(base.in_features, rank, bias=False)
        self.up = nn.Linear(rank, base.out_features, bias=False)
        nn.init.kaiming_uniform_(self.down.weight, a=5**0.5)
        nn.init.zeros_(self.up.weight)

    def forward(self, hidden):
        base = self.base(hidden)
        update = self.up(self.down(hidden.to(self.down.weight.dtype)))
        scale = self.alpha / self.rank
        return base + update.to(base.dtype) * scale


def report(progress_path: Path, **payload) -> None:
    progress_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print("PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)


def read_predict_key(path: Path) -> str:
    import struct

    try:
        with path.open("rb") as handle:
            size = struct.unpack("<Q", handle.read(8))[0]
            header = json.loads(handle.read(size))
    except (OSError, ValueError, json.JSONDecodeError):
        return "epsilon"
    meta = header.get("__metadata__") if isinstance(header, dict) else {}
    if not isinstance(meta, dict):
        return "epsilon"
    key = str(meta.get("modelspec.predict_key") or "").lower()
    return "v_prediction" if "v" in key and "eps" not in key else "epsilon"


def square_image(path: Path, size: int) -> torch.Tensor:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((size, size), Image.BICUBIC)
    array = torch.from_numpy(np.array(image, dtype=np.uint8, copy=True)).float().permute(2, 0, 1)
    return array / 127.5 - 1


def inject_lora(unet, rank: int, alpha: int) -> list[str]:
    names = []
    for name, module in list(unet.named_modules()):
        if not isinstance(module, nn.Linear):
            continue
        if not name.endswith(("to_q", "to_k", "to_v", "to_out.0")):
            continue
        parent = unet
        parts = name.split(".")
        for part in parts[:-1]:
            parent = parent[int(part)] if part.isdigit() else getattr(parent, part)
        last = parts[-1]
        wrapped = LoRALinear(module, rank, alpha)
        if last.isdigit():
            parent[int(last)] = wrapped
        else:
            setattr(parent, last, wrapped)
        names.append(name)
    if not names:
        raise RuntimeError("LoRA を差し込む層が見つかりませんでした。")
    return names


def save_lora(unet, names: list[str], output: Path, alpha: int, meta: dict) -> None:
    tensors = {}
    modules = dict(unet.named_modules())
    for name in names:
        module = modules[name]
        key = "lora_unet_" + name.replace(".", "_")
        tensors[f"{key}.lora_down.weight"] = module.down.weight.detach().float().cpu()
        tensors[f"{key}.lora_up.weight"] = module.up.weight.detach().float().cpu()
        tensors[f"{key}.alpha"] = torch.tensor(float(alpha))
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".saving")
    save_file(tensors, str(temporary), metadata={key: str(value) for key, value in meta.items()})
    temporary.replace(output)


def train(job_path: Path) -> None:
    job = json.loads(job_path.read_text(encoding="utf-8"))
    progress = Path(job["progress"])
    dataset = job_path.parent
    images = sorted(path for path in dataset.iterdir() if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    resolution = int(job["resolution"])
    rank = int(job["rank"])
    repeats = int(job["repeats"])
    epochs = max(1, int(job.get("epochs") or 1))
    per_epoch = len(images) * repeats
    total = per_epoch * epochs
    outputs = [Path(item) for item in job.get("outputs") or [job["output"]]]
    report(progress, state="running", step=0, total=total, message="画像エンジンがメモリを空けるのを待っています。")
    # ComfyUI がモデルを下ろすのを待つ。待たないと 16GB では足りない。
    time.sleep(4)
    if not torch.cuda.is_available():
        raise RuntimeError("GPU が見つかりません。")
    device = torch.device("cuda")
    dtype = torch.bfloat16
    report(progress, state="running", step=0, total=total, message="基礎モデルを読み込んでいます。数分かかります。")
    from diffusers import StableDiffusionXLPipeline

    pipe = StableDiffusionXLPipeline.from_single_file(job["checkpoint"], torch_dtype=dtype)
    predict = read_predict_key(Path(job["checkpoint"]))
    if predict == "v_prediction":
        pipe.scheduler.register_to_config(prediction_type="v_prediction")
    pipe.vae.to(device)
    pipe.text_encoder.to(device)
    pipe.text_encoder_2.to(device)
    cached = []
    report(progress, state="running", step=0, total=total, message="画像と文章を、学習用の形に変換しています。")
    for index, path in enumerate(images, start=1):
        caption = path.with_suffix(".txt").read_text(encoding="utf-8").strip()
        pixel = square_image(path, resolution).unsqueeze(0).to(device=device, dtype=pipe.vae.dtype)
        with torch.no_grad():
            latent = pipe.vae.encode(pixel).latent_dist.sample() * pipe.vae.config.scaling_factor
            embeds, _, pooled, _ = pipe.encode_prompt(
                caption,
                device=device,
                num_images_per_prompt=1,
                do_classifier_free_guidance=False,
                clip_skip=2,
            )
        time_ids = torch.tensor([[resolution, resolution, 0, 0, resolution, resolution]], dtype=torch.float32)
        cached.append((latent.cpu(), embeds.cpu(), pooled.cpu(), time_ids))
        report(progress, state="running", step=0, total=total, message=f"画像を変換しています（{index}/{len(images)}）。")
    unet = pipe.unet
    scheduler = pipe.scheduler
    prediction_type = scheduler.config.prediction_type
    del pipe
    gc.collect()
    torch.cuda.empty_cache()
    names = inject_lora(unet, rank, rank)
    unet.to(device)
    for module in unet.modules():
        if isinstance(module, LoRALinear):
            module.down.to(dtype=torch.float32)
            module.up.to(dtype=torch.float32)
    unet.requires_grad_(False)
    params = []
    for module in unet.modules():
        if isinstance(module, LoRALinear):
            params.extend(module.down.parameters())
            params.extend(module.up.parameters())
    for param in params:
        param.requires_grad_(True)
    unet.enable_gradient_checkpointing()
    unet.train()
    optimizer = torch.optim.AdamW(params, lr=1e-4, weight_decay=0.01)
    report(progress, state="running", step=0, total=total, message="学習を始めています。")
    losses = []
    step = 0
    for epoch in range(1, epochs + 1):
        for _ in range(per_epoch):
            step += 1
            latent, embeds, pooled, time_ids = random.choice(cached)
            latent = latent.to(device=device, dtype=torch.float32)
            noise = torch.randn_like(latent)
            timestep = torch.randint(0, scheduler.config.num_train_timesteps, (1,), device=device).long()
            noisy = scheduler.add_noise(latent, noise, timestep)
            if prediction_type == "v_prediction":
                target = scheduler.get_velocity(latent, noise, timestep)
            else:
                target = noise
            with torch.autocast(device_type="cuda", dtype=dtype):
                pred = unet(
                    noisy.to(dtype),
                    timestep,
                    embeds.to(device=device, dtype=dtype),
                    added_cond_kwargs={
                        "text_embeds": pooled.to(device=device, dtype=dtype),
                        "time_ids": time_ids.to(device=device, dtype=dtype),
                    },
                ).sample
                loss = F.mse_loss(pred.float(), target.float())
            if not torch.isfinite(loss):
                raise RuntimeError("損失が数にならなくなりました。枚数を減らすか、解像度を 768 にしてください。")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
            if step == 1 or step % 5 == 0 or step == total:
                average = sum(losses[-20:]) / len(losses[-20:])
                report(
                    progress,
                    state="running",
                    step=step,
                    total=total,
                    loss=round(average, 4),
                    message=f"学習中です（エポック {epoch}/{epochs}、{step}/{total}）。",
                )
        output = outputs[epoch - 1] if epoch - 1 < len(outputs) else outputs[-1]
        label = job.get("name") or output.stem
        if epochs > 1:
            label = f"{label} {epoch}/{epochs}"
        report(progress, state="running", step=step, total=total, message=f"エポック {epoch}/{epochs} の LoRA を保存しています。")
        save_lora(
            unet,
            names,
            output,
            rank,
            {
                "ss_base_model_version": "sdxl_base_v1.0",
                "modelspec.architecture": "stable-diffusion-xl-v1-base/lora",
                "modelspec.predict_key": prediction_type,
                "atelier_trigger": job.get("trigger") or "",
                "atelier_name": label,
                "atelier_goal": job.get("goal") or "",
                "ss_network_dim": rank,
                "ss_network_alpha": rank,
                "ss_epoch": epoch,
            },
        )
    report(progress, state="done", step=total, total=total, message=f"学習が終わりました。LoRA が {epochs} 個できました。")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    job_path = Path(args.job)
    progress = Path(json.loads(job_path.read_text(encoding="utf-8"))["progress"])
    try:
        train(job_path)
    except Exception as error:
        message = str(error).strip() or error.__class__.__name__
        report(progress, state="error", step=0, total=0, message=message)
        print(message, file=sys.stderr, flush=True)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
