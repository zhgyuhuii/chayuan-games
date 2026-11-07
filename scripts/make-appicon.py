#!/usr/bin/env python3
"""
察元AI游戏 应用图标一条龙（纯 macOS 内建工具，无第三方依赖）：
满幅源图（Agnes 出图：圆角方+白底）→ 裁白边 → 四角泛洪透明 → squircle 源
→ build/icon.png（1024 RGBA）
→ build/icon.icns（sips 缩尺寸 + iconutil；≤48px 做对比/亮度/饱和增强）
→ build/icon.ico（手工 PNG 条目 16~256，≤48px 同样增强）
→ src/assets/app-icon.png（256px 页眉/favicon 用，轻度增强）

用法: python3 scripts/make-appicon.py <src.png>   # 产物落到仓库约定路径
"""
import io
import os
import struct
import subprocess
import sys
import tempfile
from collections import deque

from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHITE = 244  # 近白判定阈值（rgb 均值 >= WHITE 视为出图背景白）


def squircle(src_path: str) -> Image.Image:
    """裁白边 + 四角泛洪透明，返回带 alpha 的方图。"""
    img = Image.open(src_path).convert("RGB")
    w, h = img.size
    px = img.load()

    # ① 裁掉四周白边（非白像素 bbox，留 2px 呼吸位）
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if (r + g + b) / 3 < WHITE:
                xs.append(x)
                ys.append(y)
    box = (max(min(xs) - 2, 0), max(min(ys) - 2, 0), min(max(xs) + 3, w), min(max(ys) + 3, h))
    img = img.crop(box)
    w, h = img.size
    px = img.load()
    print(f"crop: {box} -> {w}x{h}")

    # ② 从四边泛洪：与背景白连通的像素 → 透明（不伤图形内部的白色高光）
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    seen = [[False] * w for _ in range(h)]
    seeds = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    q = deque()
    for x, y in seeds:
        r, g, b = px[x, y][:3]
        if (r + g + b) / 3 >= WHITE and not seen[y][x]:
            seen[y][x] = True
            ap[x, y] = 0
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx]:
                r, g, b = px[nx, ny][:3]
                if (r + g + b) / 3 >= WHITE:
                    seen[ny][nx] = True
                    ap[nx, ny] = 0
                    q.append((nx, ny))

    # ③ alpha 边缘羽化去白边锯齿；归一 1024 方图
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert("RGBA")
    out.putalpha(alpha)
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(out, ((side - w) // 2, (side - h) // 2))
    return canvas.resize((1024, 1024), Image.LANCZOS)


def resized(icon: Image.Image, size: int) -> Image.Image:
    im = icon.resize((size, size), Image.LANCZOS)
    if size <= 48:  # 小尺寸增强：抵消霓虹暗部细节糊掉
        im = ImageEnhance.Contrast(im).enhance(1.45)
        im = ImageEnhance.Brightness(im).enhance(1.25)
        im = ImageEnhance.Color(im).enhance(1.35)
    return im


def build_icns(icon: Image.Image, out_path: str) -> None:
    sizes = [  # Apple iconset 全尺寸
        (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
    ]
    with tempfile.TemporaryDirectory() as td:
        iset = os.path.join(td, "icon.iconset")
        os.makedirs(iset)
        for size, name in sizes:
            resized(icon, size).save(os.path.join(iset, name))
        subprocess.run(["iconutil", "-c", "icns", iset, "-o", out_path], check=True)
    print(f"saved {out_path}")


def build_ico(icon: Image.Image, out_path: str) -> None:
    entries = []
    for size in (256, 128, 64, 48, 32, 16):
        buf = io.BytesIO()
        resized(icon, size).save(buf, "PNG")
        entries.append((size, buf.getvalue()))  # Vista+ 支持 PNG 条目
    header = struct.pack("<HHH", 0, 1, len(entries))
    table, offset = b"", 6 + 16 * len(entries)
    blobs = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size  # 256 编码为 0
        table += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        blobs += data
    with open(out_path, "wb") as f:
        f.write(header + table + blobs)
    print(f"saved {out_path}")


def main() -> None:
    src = sys.argv[1]
    icon = squircle(src)
    icon.save(os.path.join(ROOT, "build", "icon.png"))
    print("saved build/icon.png (1024x1024 RGBA)")
    build_icns(icon, os.path.join(ROOT, "build", "icon.icns"))
    build_ico(icon, os.path.join(ROOT, "build", "icon.ico"))
    asset_dir = os.path.join(ROOT, "src", "assets")
    os.makedirs(asset_dir, exist_ok=True)
    im = icon.resize((256, 256), Image.LANCZOS)
    im = ImageEnhance.Contrast(im).enhance(1.2)
    im = ImageEnhance.Brightness(im).enhance(1.1)
    im.save(os.path.join(asset_dir, "app-icon.png"))
    print("saved src/assets/app-icon.png (256px)")


if __name__ == "__main__":
    main()
