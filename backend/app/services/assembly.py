"""ffmpeg assembly: clips → transitions → subtitles → audio mix → final film."""
from __future__ import annotations

import asyncio
import math
import struct
import wave
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from .. import config
from .screenplay import scene_subtitle_lines

import arabic_reshaper
from bidi.algorithm import get_display


def _shape(text: str) -> str:
    """RTL shaping for Arabic; Latin passes through."""
    if any("\u0600" <= ch <= "\u06FF" for ch in text):
        return get_display(arabic_reshaper.reshape(text))
    return text


def _font(size: int):
    from PIL import ImageFont

    if config.FONT_AR_PATH.exists():
        try:
            return ImageFont.truetype(str(config.FONT_AR_PATH), size)
        except OSError:
            pass
    return ImageFont.load_default()


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode()[-500:]}")


def resolution_size(resolution: str, aspect: str) -> tuple[int, int]:
    base = {"720p": 720, "1080p": 1080, "4k": 2160}.get(resolution, 1080)
    if aspect == "16:9":
        return (int(base * 16 / 9) // 2 * 2, base)
    if aspect == "9:16":
        return (base, int(base * 16 / 9) // 2 * 2)
    return (base, base)


# ---------------------------------------------------------------- subtitles
def wrap_text(text: str, max_chars: int = 42) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + 1 > max_chars and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines or [""]


def render_subtitle_png(text: str, out_path: Path, size: tuple[int, int]) -> Path:
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")
    lines = wrap_text(text, max_chars=28 if w <= 760 else 44)
    font = _font(max(18, int(h * 0.045)))
    line_h = int(h * 0.062)
    box_h = line_h * len(lines) + int(h * 0.03)
    y0 = h - box_h - int(h * 0.06)
    draw.rectangle([0, y0, w, y0 + box_h], fill=(0, 0, 0, 110))
    for i, line in enumerate(lines):
        shaped = _shape(line)
        bbox = draw.textbbox((0, 0), shaped, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((w - tw) / 2, y0 + int(h * 0.015) + i * line_h), shaped, font=font, fill=(255, 255, 255, 235))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")
    return out_path


# ---------------------------------------------------------------- title cards
def render_title_card(
    title: str,
    subtitle: str,
    out_path: Path,
    size: tuple[int, int],
    *,
    footer: str = "",
) -> Path:
    w, h = size
    arr = np.zeros((h, w, 3), dtype=np.float64)
    top = np.array([8, 10, 26.0])
    bottom = np.array([22, 16, 48.0])
    grad = np.linspace(0, 1, h)[:, None, None]
    arr = top + (bottom - top) * grad
    arr = np.repeat(arr, w, axis=1)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")
    draw = ImageDraw.Draw(img, "RGBA")

    shaped_t = _shape(title)
    font_t = _font(int(h * 0.09))
    bbox = draw.textbbox((0, 0), shaped_t, font=font_t)
    tw = bbox[2] - bbox[0]
    draw.text(((w - tw) / 2, h * 0.38), shaped_t, font=font_t, fill=(255, 255, 255, 255))

    if subtitle:
        font_s = _font(int(h * 0.04))
        shaped_s = _shape(subtitle)
        bbox = draw.textbbox((0, 0), shaped_s, font=font_s)
        tw = bbox[2] - bbox[0]
        draw.text(((w - tw) / 2, h * 0.52), shaped_s, font=font_s, fill=(210, 210, 225, 235))

    draw.rectangle([w * 0.36, h * 0.50, w * 0.64, h * 0.505], fill=(240, 180, 90, 255))

    if footer:
        font_f = _font(int(h * 0.028))
        shaped_f = _shape(footer)
        bbox = draw.textbbox((0, 0), shaped_f, font=font_f)
        tw = bbox[2] - bbox[0]
        draw.text(((w - tw) / 2, h * 0.88), shaped_f, font=font_f, fill=(180, 180, 200, 220))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "PNG")
    return out_path


# ---------------------------------------------------------------- clips
async def still_to_clip(
    image_path: Path,
    out_path: Path,
    *,
    duration_sec: float,
    size: tuple[int, int],
    fps: int = 24,
    motion_seed: int = 0,
    subtitle_pngs: list[tuple[Path, float, float]] | None = None,
    fade_in: float = 0.35,
    fade_out: float = 0.35,
) -> Path:
    w, h = size
    frames = max(int(round(duration_sec * fps)), fps)
    motions = [
        "z='min(1.0+0.0035*in,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
        "z='max(1.25-0.0035*in,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'",
        "z='1.10':x='(iw-iw/zoom)*(0.35+0.3*in/{frames})':y='ih/2-(ih/zoom/2)'",
        "z='1.10':x='(iw-iw/zoom)*(0.65-0.3*in/{frames})':y='ih/2-(ih/zoom/2)'",
    ]
    expr = motions[motion_seed % len(motions)].format(frames=frames)

    inputs: list[str] = ["-y", "-i", str(image_path)]
    for png, _, _ in subtitle_pngs or []:
        inputs += ["-i", str(png)]

    chain = [
        f"[0:v]scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2},"
        f"zoompan={expr}:d={frames}:s={w}x{h}:fps={fps}[base]"
    ]
    prev = "base"
    for i, (_, start, end) in enumerate(subtitle_pngs or []):
        nxt = f"ov{i}"
        chain.append(
            f"[{prev}][{i + 1}:v]overlay=0:0:enable='between(t,{start:.2f},{end:.2f})'[{nxt}]"
        )
        prev = nxt
    fi = f",fade=t=in:st=0:d={fade_in}" if fade_in > 0 else ""
    fo = f",fade=t=out:st={max(0.0, duration_sec - fade_out):.2f}:d={fade_out}" if fade_out > 0 else ""
    chain.append(f"[{prev}]format=yuv420p{fi}{fo}[vout]")

    cmd = (
        [config.ffmpeg_exe()]
        + inputs
        + [
            "-filter_complex", ";".join(chain),
            "-map", "[vout]",
            "-frames:v", str(frames),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-an",
            str(out_path),
        ]
    )
    await _run(cmd)
    return out_path


async def polish_clip(
    video_in: Path,
    out_path: Path,
    *,
    duration_sec: float,
    size: tuple[int, int],
    fps: int = 24,
    subtitle_pngs: list[tuple[Path, float, float]] | None = None,
    fade_in: float = 0.4,
    fade_out: float = 0.4,
) -> Path:
    """Re-encode a clip: normalize size/fps, pad/trim to duration, burn subtitles, fades."""
    w, h = size
    inputs: list[str] = ["-y", "-i", str(video_in)]
    for png, _, _ in subtitle_pngs or []:
        inputs += ["-i", str(png)]

    chain = [
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
        f"fps={fps},setsar=1,tpad=stop_mode=clone:stop_duration={max(0.0, duration_sec):.2f},"
        f"trim=0:{duration_sec:.2f},setpts=PTS-STARTPTS[base]"
    ]
    prev = "base"
    for i, (_, start, end) in enumerate(subtitle_pngs or []):
        nxt = f"ov{i}"
        chain.append(
            f"[{prev}][{i + 1}:v]overlay=0:0:enable='between(t,{start:.2f},{end:.2f})'[{nxt}]"
        )
        prev = nxt
    fi = f",fade=t=in:st=0:d={fade_in}" if fade_in > 0 else ""
    fo = f",fade=t=out:st={max(0.0, duration_sec - fade_out):.2f}:d={fade_out}" if fade_out > 0 else ""
    chain.append(f"[{prev}]format=yuv420p{fi}{fo}[vout]")

    cmd = (
        [config.ffmpeg_exe()]
        + inputs
        + [
            "-filter_complex", ";".join(chain),
            "-map", "[vout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-an",
            "-t", f"{duration_sec:.2f}",
            str(out_path),
        ]
    )
    await _run(cmd)
    return out_path


async def image_to_clip(
    image_path: Path,
    out_path: Path,
    *,
    duration_sec: float,
    size: tuple[int, int],
    fps: int = 24,
    fade: bool = True,
) -> Path:
    """Static card clip (title / end)."""
    w, h = size
    frames = max(int(round(duration_sec * fps)), fps)
    vf = f"scale={w}:{h},format=yuv420p"
    if fade:
        vf += f",fade=t=in:st=0:d=0.6,fade=t=out:st={max(0.0, duration_sec - 0.6):.2f}:d=0.6"
    cmd = [
        config.ffmpeg_exe(), "-y", "-loop", "1", "-framerate", str(fps), "-t", str(duration_sec),
        "-i", str(image_path), "-vf", vf, "-frames:v", str(frames),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-an",
        str(out_path),
    ]
    await _run(cmd)
    return out_path


async def concat_clips(clip_paths: list[Path], out_path: Path, *, reencode: bool = False) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    list_file = out_path.with_suffix(".txt")
    lines = "\n".join(f"file '{p.resolve()}'" for p in clip_paths)
    list_file.write_text(lines, encoding="utf-8")
    cmd = [config.ffmpeg_exe(), "-y", "-f", "concat", "-safe", "0", "-i", str(list_file)]
    if reencode:
        cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c", "copy"]
    cmd += ["-movflags", "+faststart", str(out_path)]
    await _run(cmd)
    list_file.unlink(missing_ok=True)
    return out_path


# ---------------------------------------------------------------- audio
def write_sfx_whoosh(out_path: Path, duration_sec: float = 1.0, sample_rate: int = 44100) -> Path:
    n = int(duration_sec * sample_rate)
    t = np.arange(n) / sample_rate
    rng = np.random.default_rng(3)
    noise = rng.normal(0, 1, n)
    sweep = np.sin(2 * np.pi * (200 + 900 * t / duration_sec) * t)
    env = np.minimum(t / 0.12, 1.0) * np.exp(-3.2 * t)
    mix = (0.5 * noise + 0.5 * sweep) * env
    mix /= max(np.abs(mix).max(), 1e-9)
    pcm = (mix * 0.35 * 32767).astype(np.int16)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return out_path


def write_silence(out_path: Path, duration_sec: float, sample_rate: int = 44100) -> Path:
    n = int(duration_sec * sample_rate)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(b"\x00\x00" * n)
    return out_path


async def mix_audio(
    speech_parts: list[tuple[Path, float]],
    music_path: Path | None,
    out_path: Path,
    *,
    total_duration: float,
    sfx_points: list[tuple[Path, float]] | None = None,
) -> Path:
    """speech_parts: (wav_path, offset_sec). music plays under everything."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not speech_parts and not music_path:
        write_silence(out_path.with_suffix(".wav"), total_duration)
        return out_path.with_suffix(".wav")

    inputs: list[str] = ["-y"]
    filters: list[str] = []
    mix_labels: list[str] = []
    idx = 0

    for path, offset in speech_parts:
        inputs += ["-i", str(path)]
        ms = int(offset * 1000)
        filters.append(f"[{idx}:a]aformat=channel_layouts=stereo,adelay={ms}|{ms}[sp{idx}]")
        mix_labels.append(f"[sp{idx}]")
        idx += 1

    for path, offset in sfx_points or []:
        inputs += ["-i", str(path)]
        ms = int(offset * 1000)
        filters.append(f"[{idx}:a]aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=0.5[sfx{idx}]")
        mix_labels.append(f"[sfx{idx}]")
        idx += 1

    if music_path and Path(music_path).exists():
        inputs += ["-i", str(music_path)]
        filters.append(f"[{idx}:a]aformat=channel_layouts=stereo,volume=0.30[mus]")
        mix_labels.append("[mus]")
        idx += 1

    if len(mix_labels) == 1:
        filters.append(f"{mix_labels[0]}apad=whole_dur={total_duration:.2f},atrim=0:{total_duration:.2f}[aout]")
    else:
        joined = "".join(mix_labels)
        filters.append(
            f"{joined}amix=inputs={len(mix_labels)}:duration=longest:dropout_transition=3,"
            f"apad=whole_dur={total_duration:.2f},atrim=0:{total_duration:.2f}[aout]"
        )

    cmd = (
        [config.ffmpeg_exe()]
        + inputs
        + ["-filter_complex", ";".join(filters), "-map", "[aout]", "-ac", "2", "-ar", "44100", str(out_path)]
    )
    await _run(cmd)
    return out_path


async def mux(video_path: Path, audio_path: Path, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        config.ffmpeg_exe(), "-y", "-i", str(video_path), "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", "-movflags", "+faststart", str(out_path),
    ]
    await _run(cmd)
    return out_path


async def make_poster(video_path: Path, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        config.ffmpeg_exe(), "-y", "-ss", "1", "-i", str(video_path),
        "-frames:v", "1", "-q:v", "3", str(out_path),
    ]
    await _run(cmd)
    return out_path


async def probe_duration(path: Path) -> float:
    """Duration via ffmpeg decode (works with the bundled binary)."""
    proc = await asyncio.create_subprocess_exec(
        config.ffmpeg_exe(), "-i", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    text = err.decode(errors="ignore")
    import re

    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", text)
    if not m:
        return 0.0
    hh, mm, ss = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return hh * 3600 + mm * 60 + ss


# ---------------------------------------------------------------- srt
def srt_timestamp(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(scenes: list[dict[str, Any]], out_path: Path, *, start_offsets: list[float]) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    blocks: list[str] = []
    n = 1
    for scene, offset in zip(scenes, start_offsets):
        for cue in scene_subtitle_lines(scene):
            blocks.append(
                f"{n}\n{srt_timestamp(offset + cue['start'])} --> {srt_timestamp(offset + cue['end'])}\n{cue['text']}\n"
            )
            n += 1
    out_path.write_text("\n".join(blocks), encoding="utf-8")
    return out_path
