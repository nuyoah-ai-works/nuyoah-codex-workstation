#!/usr/bin/env python3
"""Build a time-locked reference-audio control track for AI video generation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_stem(value: str, fallback: str = "节奏控制轨") -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", str(value or "").strip())
    value = re.sub(r"^[.\s-]+|[.\s-]+$", "", value)
    return value or fallback


def ensure_inside(root: Path, child: Path) -> Path:
    root = root.resolve()
    child = child.resolve()
    try:
        child.relative_to(root)
    except ValueError as exc:
        raise ValueError("节奏控制轨目标目录跳出了项目文件夹") from exc
    return child


def unique_output(output_dir: Path, stem: str) -> Path:
    for index in range(1, 10000):
        suffix = "" if index == 1 else f"-{index:02d}"
        candidate = output_dir / f"{stem}{suffix}.wav"
        sidecar_stem = candidate.with_suffix("")
        if not candidate.exists() and not Path(f"{sidecar_stem}.prompt.md").exists() and not Path(f"{sidecar_stem}.meta.json").exists():
            return candidate
    raise RuntimeError("目标文件夹中同名控制轨过多")


def api_healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/health", timeout=3) as response:
            payload = json.loads(response.read().decode("utf-8"))
        status = payload.get("data", payload).get("status")
        return status == "ok"
    except Exception:
        return False


def ensure_music_api(api_url: str, launcher: Path) -> None:
    if api_healthy(api_url):
        return
    if not launcher.exists():
        raise RuntimeError(f"本地音乐服务未启动，且没有找到启动器：{launcher}")
    process = subprocess.run(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(launcher)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=150,
    )
    if process.returncode != 0 or not api_healthy(api_url):
        raise RuntimeError("本地音乐服务没有进入可用状态，请检查 ACE-Step 日志")


def classify_cue(label: str, explicit: str = "") -> str:
    if explicit in {"start", "motion", "impact", "transition", "accent", "silence", "end"}:
        return explicit
    text = str(label or "").lower()
    if any(word in text for word in ("静", "停顿", "无声", "屏息", "silence", "pause")):
        return "silence"
    if any(word in text for word in ("撞", "击", "砍", "斩", "落地", "爆", "破碎", "重击", "impact", "hit", "crash")):
        return "impact"
    if any(word in text for word in ("冲", "挥", "掠", "穿", "突进", "移动", "加速", "旋转", "dash", "swing", "move")):
        return "motion"
    if any(word in text for word in ("转", "切", "变", "揭示", "显现", "transition", "reveal", "change")):
        return "transition"
    if any(word in text for word in ("结束", "收势", "定格", "end", "finish")):
        return "end"
    return "accent"


def candidate_entries(catalog: dict, cue_type: str) -> list[dict]:
    entries = catalog.get("entries", [])
    category_order = {
        "motion": ["whoosh"],
        "impact": ["impacts"],
        "transition": ["whoosh", "digital"],
        "start": ["ui", "digital", "whoosh"],
        "end": ["impacts", "ui"],
        "accent": ["impacts", "ui", "digital"],
    }.get(cue_type, ["ui"])
    for category in category_order:
        matches = [entry for entry in entries if entry.get("category") == category]
        if matches:
            return matches
    return entries


def pick_sfx(catalog: dict, skill_root: Path, cue: dict, index: int) -> tuple[Path, dict] | None:
    cue_type = classify_cue(cue.get("label", ""), cue.get("type", ""))
    if cue_type == "silence":
        return None
    candidates = candidate_entries(catalog, cue_type)
    if not candidates:
        return None
    key = f"{cue.get('time', 0)}|{cue.get('label', '')}|{index}".encode("utf-8")
    offset = int(hashlib.sha256(key).hexdigest()[:8], 16) % len(candidates)
    for step in range(len(candidates)):
        entry = candidates[(offset + step) % len(candidates)]
        candidate = skill_root / entry["path"]
        if candidate.exists():
            return candidate, {**entry, "cueType": cue_type}
    return None


def generate_music(payload: dict, work_dir: Path) -> tuple[Path, dict]:
    api_url = str(payload.get("apiUrl") or "http://127.0.0.1:8001")
    launcher = Path(payload["aceStepLauncher"])
    generator = Path(payload["musicGeneratorScript"])
    ensure_music_api(api_url, launcher)
    if not generator.exists():
        raise RuntimeError(f"没有找到本地音乐生成适配器：{generator}")

    prompt = str(payload.get("musicPrompt") or payload.get("description") or "").strip()
    if not prompt:
        prompt = "Instrumental cinematic rhythmic pulse, sparse arrangement, clear dynamic sections, no vocals, clean ending."
    prompt_path = work_dir / "music-prompt.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    output = work_dir / "music-bed.wav"
    requested_duration = float(payload["duration"])
    source_duration = max(10.0, requested_duration)
    command = [
        sys.executable,
        str(generator),
        "--prompt-file", str(prompt_path),
        "--output", str(output),
        "--api-url", api_url,
        "--duration", str(source_duration),
        "--bpm", str(payload.get("bpm") or 96),
        "--key-scale", str(payload.get("keyScale") or "D minor"),
        "--time-signature", str(payload.get("timeSignature") or "4"),
        "--inference-steps", str(payload.get("inferenceSteps") or 8),
        "--timeout", "600",
    ]
    process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=660)
    if process.returncode != 0 or not output.exists():
        raise RuntimeError((process.stderr or process.stdout or "本地音乐生成失败").strip())
    meta_path = Path(f"{output}.meta.json")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    meta["control_track_requested_duration"] = requested_duration
    meta["music_source_duration"] = source_duration
    meta["trimmed_to_control_duration"] = source_duration != requested_duration
    return output, meta


def build_track(payload: dict) -> dict:
    project_root = Path(payload["projectRoot"])
    output_dir = ensure_inside(project_root, Path(payload["outputDir"]))
    output_dir.mkdir(parents=True, exist_ok=True)

    duration = float(payload.get("duration") or 0)
    if duration < 2 or duration > 180:
        raise ValueError("目标时长应在 2–180 秒之间")
    mode = str(payload.get("mode") or "sfx")
    if mode not in {"sfx", "music", "hybrid"}:
        raise ValueError("未知的控制轨模式")

    cues = []
    for item in payload.get("cues") or []:
        cue_time = round(float(item.get("time") or 0), 3)
        if cue_time < 0 or cue_time >= duration:
            continue
        cues.append({
            "time": cue_time,
            "label": str(item.get("label") or "节奏点").strip(),
            "type": classify_cue(item.get("label", ""), item.get("type", "")),
        })
    cues.sort(key=lambda item: item["time"])
    if not cues:
        cues = [
            {"time": 0.0, "label": "开始", "type": "start"},
            {"time": round(duration * 0.45, 3), "label": "主要变化", "type": "impact"},
            {"time": round(duration * 0.85, 3), "label": "收束", "type": "end"},
        ]

    stem = clean_stem(payload.get("name") or f"节奏控制轨_{duration:g}秒")
    output = unique_output(output_dir, stem)
    work_dir = Path(payload.get("workDir") or output_dir / ".rhythm-control-work" / str(int(time.time() * 1000)))
    work_dir.mkdir(parents=True, exist_ok=True)

    catalog_path = Path(payload["sfxCatalog"])
    skill_root = Path(payload["audioSkillRoot"])
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    selected = []
    music_path = None
    music_meta = None
    try:
        if mode in {"music", "hybrid"}:
            music_path, music_meta = generate_music(payload, work_dir)

        input_args: list[str] = []
        filter_parts: list[str] = []
        mix_labels: list[str] = []
        input_index = 0
        if music_path:
            input_args.extend(["-i", str(music_path)])
            filter_parts.append(
                f"[{input_index}:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS,aresample=48000,"
                "aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.40[base]"
            )
        else:
            input_args.extend(["-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate=48000:d={duration:.3f}"])
            filter_parts.append(f"[{input_index}:a]atrim=0:{duration:.3f},asetpts=PTS-STARTPTS[base]")
        mix_labels.append("[base]")
        input_index += 1

        if mode in {"sfx", "hybrid"}:
            for cue_index, cue in enumerate(cues):
                picked = pick_sfx(catalog, skill_root, cue, cue_index)
                if not picked:
                    selected.append({**cue, "asset": None})
                    continue
                source, entry = picked
                input_args.extend(["-i", str(source)])
                delay = max(0, int(round(cue["time"] * 1000)))
                gain = 0.86 if cue["type"] == "impact" else 0.58
                label = f"cue{input_index}"
                filter_parts.append(
                    f"[{input_index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                    f"volume={gain:.2f},adelay={delay}|{delay}[{label}]"
                )
                mix_labels.append(f"[{label}]")
                selected.append({
                    **cue,
                    "asset": str(source),
                    "assetId": entry.get("id"),
                    "assetSha256": entry.get("sha256") or sha256(source),
                    "gain": gain,
                })
                input_index += 1

        if len(mix_labels) == 1:
            filter_parts.append(f"{mix_labels[0]}alimiter=limit=0.95,atrim=0:{duration:.3f}[out]")
        else:
            filter_parts.append(
                f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0,"
                f"alimiter=limit=0.95,atrim=0:{duration:.3f}[out]"
            )

        command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            *input_args,
            "-filter_complex", ";".join(filter_parts),
            "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", str(output),
        ]
        process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        if process.returncode != 0 or not output.exists():
            raise RuntimeError((process.stderr or "控制轨渲染失败").strip())

        relative_path = str(output.relative_to(project_root.resolve()))
        role_contract = (
            "参考音频只负责组织画面的起势、加速、撞击、转折和收束；目标片长按音频完整时长执行。"
            "不要把每一个声音机械翻译成一次切镜，也不要假定最终成片必须保留这条参考音频。"
        )
        meta = {
            "schemaVersion": 1,
            "kind": "reference-audio-control-track",
            "project": {
                "id": payload.get("projectId", ""),
                "name": payload.get("projectName", ""),
                "root": str(project_root.resolve()),
            },
            "mode": mode,
            "duration": duration,
            "bpm": int(payload.get("bpm") or 96),
            "keyScale": str(payload.get("keyScale") or "D minor"),
            "description": str(payload.get("description") or "").strip(),
            "musicPrompt": str(payload.get("musicPrompt") or "").strip(),
            "roleContract": role_contract,
            "cues": selected if mode in {"sfx", "hybrid"} else cues,
            "musicGeneration": music_meta,
            "output": {
                "path": str(output),
                "relativePath": relative_path,
                "bytes": output.stat().st_size,
                "sha256": sha256(output),
                "sampleRate": 48000,
                "channels": 2,
                "codec": "pcm_s24le",
            },
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        sidecar_stem = output.with_suffix("")
        meta_path = Path(f"{sidecar_stem}.meta.json")
        prompt_path = Path(f"{sidecar_stem}.prompt.md")
        cue_rows = "\n".join(
            f"| {cue['time']:.3f}s | {cue['label']} | {cue.get('type', 'accent')} |"
            for cue in meta["cues"]
        )
        prompt_path.write_text(
            "# 参考音频节奏控制轨\n\n"
            f"- 项目：{payload.get('projectName') or payload.get('projectId')}\n"
            f"- 目标片长：{duration:g} 秒\n"
            f"- 模式：{mode}\n"
            f"- BPM：{int(payload.get('bpm') or 96)}\n"
            f"- 音频文件：{output.name}\n"
            f"- SHA-256：{meta['output']['sha256']}\n\n"
            "## 画面任务\n\n"
            f"{meta['description'] or '（未填写）'}\n\n"
            "## 节奏点\n\n| 时间 | 画面事件 | 控制作用 |\n|---:|---|---|\n"
            f"{cue_rows}\n\n"
            "## 生成时附加说明\n\n"
            f"{role_contract}\n\n"
            "## 音乐生成提示词\n\n"
            f"{meta['musicPrompt'] or '（本轨未使用生成音乐）'}\n",
            encoding="utf-8",
        )
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {
            "ok": True,
            "track": {
                "id": meta["output"]["sha256"][:16],
                "projectId": payload.get("projectId", ""),
                "projectName": payload.get("projectName", ""),
                "profileId": payload.get("profileId", ""),
                "name": output.stem,
                "relativePath": relative_path,
                "absolutePath": str(output),
                "promptPath": str(prompt_path),
                "metaPath": str(meta_path),
                "duration": duration,
                "mode": mode,
                "bpm": int(payload.get("bpm") or 96),
                "cues": meta["cues"],
                "roleContract": role_contract,
                "sha256": meta["output"]["sha256"],
                "createdAt": meta["createdAt"],
            },
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    result_path = Path(args.result)
    try:
        payload = json.loads(Path(args.payload).read_text(encoding="utf-8-sig"))
        result = build_track(payload)
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        result = {"ok": False, "error": str(exc)}
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
