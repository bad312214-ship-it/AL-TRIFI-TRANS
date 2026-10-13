"""Procedural cinematic still renderer (Pillow + NumPy).

Produces real concept-art style frames locally, with zero external calls.
When an image API key exists, the pipeline swaps in a remote engine;
this renderer is the honest, always-available baseline."""
from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .. import config
from .base import Capability, GenerationResult, ImageProvider

PALETTES = {
    "dawn": {"sky": [(28, 22, 66), (232, 120, 80), (255, 200, 120)], "ground": (22, 18, 40), "glow": (255, 190, 120)},
    "day": {"sky": [(20, 42, 92), (70, 130, 190), (170, 210, 235)], "ground": (30, 48, 60), "glow": (255, 240, 200)},
    "dusk": {"sky": [(18, 12, 48), (120, 40, 90), (250, 120, 80)], "ground": (16, 10, 30), "glow": (255, 150, 90)},
    "night": {"sky": [(6, 8, 26), (14, 22, 56), (36, 52, 110)], "ground": (8, 10, 24), "glow": (180, 200, 255)},
    "magic": {"sky": [(24, 10, 56), (90, 30, 130), (220, 120, 220)], "ground": (18, 10, 40), "glow": (240, 180, 255)},
    "desert": {"sky": [(60, 30, 40), (220, 130, 70), (250, 210, 150)], "ground": (80, 48, 30), "glow": (255, 220, 160)},
}

MOOD_PALETTE = {
    "حماس": "dawn", "اكتشاف": "day", "دهشة": "magic", "شجاعة": "dawn",
    "سحر": "magic", "غموض": "night", "بهاء": "magic", "أسطورة": "dusk",
    "فخر": "dusk", "حنين": "dusk", "وقار": "day", "مصير": "night",
    "شجن": "dusk", "أمل": "dawn", "ترابط": "day", "لم شمل": "dawn",
    "مرح": "day", "خفة": "day", "طاقة": "dawn", "مفاجأة": "magic",
    "دفء": "dawn", "براءة": "day", "مغامرة": "day", "محبة": "dawn",
    "excitement": "dawn", "discovery": "day", "wonder": "magic", "courage": "dawn",
    "magic": "magic", "mystery": "night", "splendor": "magic", "legend": "dusk",
    "warmth": "dawn", "innocence": "day", "adventure": "day", "love": "dawn",
    "poignancy": "dusk", "hope": "dawn", "bond": "day", "reunion": "dawn",
}


def _font(size: int, latin: bool = False) -> ImageFont.FreeTypeFont:
    path = config.FONT_LATIN_PATH if latin and config.FONT_LATIN_PATH.exists() else config.FONT_AR_PATH
    if not path.exists():
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        return ImageFont.load_default()


def _vgrad(size: tuple[int, int], stops: list[tuple[int, int, int]]) -> np.ndarray:
    w, h = size
    top = np.array(stops[0], dtype=np.float64)
    mid = np.array(stops[1], dtype=np.float64)
    bot = np.array(stops[2], dtype=np.float64)
    y = np.linspace(0.0, 1.0, h)[:, None, None]
    upper = top + (mid - top) * np.clip(y / 0.55, 0, 1)
    lower = mid + (bot - mid) * np.clip((y - 0.55) / 0.45, 0, 1)
    img = np.where(y < 0.55, upper, lower)
    return np.repeat(img, w, axis=1)


def _radial_glow(arr: np.ndarray, cx: float, cy: float, radius: float, color, strength: float) -> np.ndarray:
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - cx * w) / (radius * w)) ** 2 + ((yy - cy * h) / (radius * w)) ** 2)
    mask = np.clip(1.0 - d, 0, 1) ** 2 * strength
    return arr + mask[:, :, None] * np.array(color, dtype=np.float64)


def _mountain_layer(w: int, h: int, base_y: float, roughness: float, seed: int, color, alpha: float) -> Image.Image:
    rng = random.Random(seed)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    pts = [(0, h)]
    x = 0
    y = h * base_y
    step = max(24, w // 26)
    while x <= w:
        y += rng.uniform(-roughness, roughness) * h * 0.06
        y = max(h * (base_y - 0.18), min(h * (base_y + 0.12), y))
        pts.append((x, int(y)))
        x += step
    pts.append((w, h))
    draw.polygon(pts, fill=color + (int(255 * alpha),))
    return layer


def _trees(draw: ImageDraw.ImageDraw, w: int, h: int, base_y: float, seed: int, color) -> None:
    rng = random.Random(seed)
    for _ in range(max(8, w // 90)):
        x = rng.randint(0, w - 1)
        th = rng.randint(int(h * 0.05), int(h * 0.16))
        tw = max(6, th // 4)
        y0 = int(h * base_y) + rng.randint(-int(h * 0.02), int(h * 0.03))
        draw.polygon([(x, y0 - th), (x - tw, y0), (x + tw, y0)], fill=color)
        draw.rectangle([x - max(2, tw // 6), y0, x + max(2, tw // 6), y0 + th // 5], fill=color)


def _city_silhouette(draw: ImageDraw.ImageDraw, w: int, h: int, base_y: float, seed: int, color) -> None:
    rng = random.Random(seed)
    x = 0
    while x < w:
        bw = rng.randint(int(w * 0.03), int(w * 0.08))
        bh = rng.randint(int(h * 0.12), int(h * 0.38))
        y0 = int(h * base_y)
        draw.rectangle([x, y0 - bh, x + bw, y0], fill=color)
        # windows
        for wy in range(y0 - bh + 8, y0 - 6, 14):
            for wx in range(x + 4, x + bw - 4, 10):
                if rng.random() < 0.35:
                    draw.rectangle([wx, wy, wx + 3, wy + 5], fill=(255, 214, 140, 200))
        x += bw + rng.randint(2, 10)


def _figure(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float, color) -> None:
    """Minimal human silhouette (for scale/storytelling)."""
    head_r = max(3, int(scale * 0.06))
    draw.ellipse([x - head_r, y - scale * 0.95, x + head_r, y - scale * 0.95 + head_r * 2], fill=color)
    draw.polygon(
        [(x - scale * 0.10, y), (x + scale * 0.10, y), (x + scale * 0.05, y - scale * 0.72), (x - scale * 0.05, y - scale * 0.72)],
        fill=color,
    )


def render_scene_still(
    out_path: Path,
    *,
    size: tuple[int, int],
    seed: int = 0,
    mood: str = "",
    environment: str = "",
    lighting: str = "",
    style: str = "cinematic_3d",
    label: str = "",
    figure: bool = True,
) -> Path:
    w, h = size
    rng = random.Random(seed)
    env = f"{environment} {lighting} {style}".lower()

    palette_key = MOOD_PALETTE.get(mood, "")
    if not palette_key:
        if any(k in env for k in ("night", "ليل", "moon", "قمر", "space", "فضاء", "نجوم")):
            palette_key = "night"
        elif any(k in env for k in ("desert", "صحراء", "sand", "رمال")):
            palette_key = "desert"
        elif any(k in env for k in ("magic", "سحر", "city", "مدينة", "future", "مستقبل")):
            palette_key = "magic"
        elif any(k in env for k in ("forest", "غابة", "green", "green")):
            palette_key = "day"
        else:
            palette_key = rng.choice(["dawn", "day", "dusk", "magic"])
    pal = PALETTES[palette_key]

    arr = _vgrad((w, h), pal["sky"])
    is_night = palette_key == "night"
    # celestial body
    cx, cy = rng.uniform(0.62, 0.82), rng.uniform(0.18, 0.34)
    arr = _radial_glow(arr, cx, cy, 0.28, pal["glow"], 0.85 if not is_night else 0.5)

    stars = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    sdraw = ImageDraw.Draw(stars, "RGBA")
    if is_night or palette_key == "magic":
        for _ in range(int(w * h / 9000)):
            sx, sy = rng.randint(0, w - 1), rng.randint(0, int(h * 0.55))
            b = rng.randint(120, 255)
            sdraw.point((sx, sy), fill=(255, 255, 255, b))
    # sun / moon disc
    r = int(min(w, h) * (0.045 if not is_night else 0.035))
    disc = (255, 244, 214, 255) if not is_night else (230, 234, 255, 255)
    sdraw.ellipse([cx * w - r, cy * h - r, cx * w + r, cy * h + r], fill=disc)

    base = stars.convert("RGBA")
    # mountains / terrain
    if any(k in env for k in ("city", "مدينة", "future", "مستقبل", "town", "مدينة")):
        base.alpha_composite(_mountain_layer(w, h, 0.62, 1.2, seed + 7, tuple(int(c * 0.5) for c in pal["ground"]), 0.9))
        _city_silhouette(ImageDraw.Draw(base), w, h, 0.72, seed + 11, pal["ground"] + (255,))
    else:
        base.alpha_composite(_mountain_layer(w, h, 0.55, 1.6, seed + 3, tuple(int(c * 0.45) for c in pal["ground"]), 0.65))
        base.alpha_composite(_mountain_layer(w, h, 0.66, 1.2, seed + 5, tuple(int(c * 0.7) for c in pal["ground"]), 0.85))
        if any(k in env for k in ("forest", "غابة", "tree", "شجر", "village", "قرية", "green")):
            _trees(ImageDraw.Draw(base), w, h, 0.72, seed + 9, (12, 22, 18, 255))

    base.alpha_composite(_mountain_layer(w, h, 0.82, 0.6, seed + 13, pal["ground"], 1.0))

    draw = ImageDraw.Draw(base, "RGBA")
    # fog band
    fog = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fdraw = ImageDraw.Draw(fog)
    for i in range(3):
        fy = int(h * (0.58 + i * 0.07))
        fdraw.ellipse([-w * 0.2, fy, w * 1.2, fy + int(h * 0.10)], fill=(255, 255, 255, 16 - i * 4))
    base.alpha_composite(fog)

    if figure:
        ground_y = h * 0.86
        _figure(draw, w * rng.uniform(0.28, 0.42), ground_y, h * 0.16, (10, 10, 18, 235))
        if rng.random() < 0.5:
            _figure(draw, w * rng.uniform(0.5, 0.62), ground_y, h * 0.12, (12, 12, 22, 225))

    # vignette
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    vignette = np.clip(1.0 - 0.35 * np.clip(d - 0.55, 0, 1) ** 1.5, 0, 1)
    fin = np.asarray(base.convert("RGB"), dtype=np.float64) * vignette[:, :, None]
    # film grain
    grain = np.random.default_rng(seed).normal(0, 4.0, (h, w, 1))
    fin = np.clip(fin + grain, 0, 255).astype(np.uint8)

    img = Image.fromarray(fin)
    img = img.filter(ImageFilter.SMOOTH)

    if label:
        d2 = ImageDraw.Draw(img, "RGBA")
        f = _font(max(16, h // 28))
        d2.rectangle([0, int(h * 0.90), w, h], fill=(0, 0, 0, 120))
        d2.text((int(w * 0.03), int(h * 0.915)), label, font=f, fill=(255, 255, 255, 220))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "PNG")
    return out_path


def render_character_sheet(
    out_path: Path,
    *,
    name: str,
    appearance: str,
    palette: dict | None = None,
    size: tuple[int, int] = (768, 1024),
    seed: int = 0,
) -> Path:
    """Character reference card: consistent palette + bust silhouette."""
    import arabic_reshaper
    from bidi.algorithm import get_display

    w, h = size
    rng = random.Random(seed)
    primary = (palette or {}).get("primary", "#2b4c7e")
    accent = (palette or {}).get("accent", "#f4b860")

    def hex_rgb(s: str) -> tuple[int, int, int]:
        s = s.lstrip("#")
        if len(s) != 6:
            return (43, 76, 126)
        return tuple(int(s[i : i + 2], 16) for i in (0, 2, 4))

    p_rgb, a_rgb = hex_rgb(primary), hex_rgb(accent)
    arr = _vgrad((w, h), [tuple(int(c * 0.35) for c in p_rgb), p_rgb, tuple(min(255, int(c * 1.25)) for c in p_rgb)])
    arr = _radial_glow(arr, 0.5, 0.32, 0.42, a_rgb, 0.4)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert("RGBA")

    draw = ImageDraw.Draw(img, "RGBA")
    # bust silhouette with palette colors
    cx = w // 2
    head_r = int(w * 0.16)
    head_y = int(h * 0.30)
    draw.ellipse([cx - head_r, head_y - head_r, cx + head_r, head_y + head_r], fill=(235, 220, 205, 255))
    # hair
    draw.pieslice([cx - head_r - 10, head_y - head_r - 16, cx + head_r + 10, head_y + head_r * 0.6], 180, 360, fill=(40, 30, 30, 255))
    # shoulders
    draw.polygon(
        [(cx - w * 0.30, h * 0.92), (cx + w * 0.30, h * 0.92), (cx + w * 0.17, h * 0.52), (cx - w * 0.17, h * 0.52)],
        fill=p_rgb + (255,),
    )
    draw.polygon(
        [(cx - w * 0.08, h * 0.52), (cx + w * 0.08, h * 0.52), (cx + w * 0.05, h * 0.46), (cx - w * 0.05, h * 0.46)],
        fill=(235, 220, 205, 255),
    )
    draw.rectangle([cx - w * 0.17, h * 0.52, cx + w * 0.17, h * 0.56], fill=a_rgb + (255,))
    # eyes
    for dx in (-1, 1):
        ex = cx + dx * head_r * 0.42
        draw.ellipse([ex - 9, head_y - 6, ex + 9, head_y + 8], fill=(250, 250, 250, 255))
        draw.ellipse([ex - 4, head_y - 2, ex + 4, head_y + 6], fill=(30, 24, 20, 255))
    # palette swatches
    for i, c in enumerate((p_rgb, a_rgb, (240, 240, 240))):
        draw.rectangle([w - 54, 20 + i * 34, w - 20, 48 + i * 34], fill=c + (255,), outline=(255, 255, 255, 90))

    # name + appearance strip
    draw.rectangle([0, int(h * 0.90), w, h], fill=(0, 0, 0, 140))
    reshaped = get_display(arabic_reshaper.reshape(name))
    draw.text((int(w * 0.04), int(h * 0.91)), reshaped, font=_font(int(h * 0.035)), fill=(255, 255, 255, 235))
    if appearance:
        snippet = appearance[:90]
        draw.text((int(w * 0.04), int(h * 0.955)), get_display(arabic_reshaper.reshape(snippet)), font=_font(int(h * 0.022)), fill=(220, 220, 220, 200))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "PNG")
    return out_path


class LocalImageProvider(ImageProvider):
    name = "local"

    async def generate(
        self,
        prompt: str,
        out_path: Path,
        *,
        size: tuple[int, int],
        seed: int = 0,
        negative: str = "",
    ) -> GenerationResult:
        # prompt is expected to be a composed scene description;
        # keywords influence palette/architecture choices.
        path = render_scene_still(
            out_path,
            size=size,
            seed=seed,
            mood=_pick(prompt, "mood"),
            environment=prompt,
            lighting=_pick(prompt, "light"),
            label="",
        )
        return GenerationResult(path=path, meta={"engine": "local-painter", "seed": seed})

    async def test_connection(self) -> Capability:
        return Capability(
            name=self.name,
            label="المولّد المحلي (رسم إجرائي) / Local procedural painter",
            kind="image",
            configured=True,
            details={"resolutions": ["720p", "1080p", "4k"], "note": "يعمل بدون إنترنت — أسلوب Concept Art سينمائي."},
        )


def _pick(text: str, kind: str) -> str:
    t = text.lower()
    if kind == "mood":
        for k in MOOD_PALETTE:
            if k in t:
                return k
    return ""
