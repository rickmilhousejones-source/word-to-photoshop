#!/usr/bin/env python3
"""
Generate strict black/white (0/255) bubble masks from comic page images.

Output convention:
- Writes 8-bit single-channel PNG masks into output-dir (default: <input-dir>/mask)
- White (255) = bubble/balloon candidate region
- Black (0) = background
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable, List, Tuple

import cv2
import numpy as np


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate black/white bubble masks into mask/ directory")
    p.add_argument("--input-dir", required=True, type=Path, help="Directory of page images (jpg/png/webp/...)")
    p.add_argument(
        "--output-dir",
        default=None,
        type=Path,
        help="Output directory for masks. Default: <input-dir>/mask",
    )
    p.add_argument("--morph-kernel", type=int, default=7, help="Morphology kernel size (odd preferred)")
    p.add_argument("--min-area", type=int, default=900, help="Remove tiny components below this area")
    p.add_argument("--save-debug", action="store_true", help="Save debug visualization into <output-dir>/_viz")
    return p.parse_args()


def iter_images(input_dir: Path) -> Iterable[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
    for p in sorted(input_dir.iterdir()):
        if p.is_file() and p.suffix.lower() in exts:
            yield p


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def to_binary_0_255(mask: np.ndarray) -> np.ndarray:
    if mask.dtype != np.uint8:
        mask = mask.astype(np.uint8, copy=False)
    return np.where(mask > 0, 255, 0).astype(np.uint8, copy=False)


def remove_border_connected_components(bw: np.ndarray) -> np.ndarray:
    """Remove any white component that touches image border (common: page background)."""
    h, w = bw.shape[:2]
    if h <= 2 or w <= 2:
        return bw
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((bw > 0).astype(np.uint8), connectivity=8)
    if num_labels <= 1:
        return bw
    keep = np.ones((num_labels,), dtype=np.bool_)
    keep[0] = False
    for i in range(1, num_labels):
        x, y, ww, hh, _area = stats[i]
        touches = (x <= 0) or (y <= 0) or (x + ww >= w) or (y + hh >= h)
        if touches:
            keep[i] = False
    out = np.zeros_like(bw)
    for i in range(1, num_labels):
        if keep[i]:
            out[labels == i] = 255
    return out


def filter_small_components(bw: np.ndarray, min_area: int) -> np.ndarray:
    if min_area <= 0:
        return bw
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats((bw > 0).astype(np.uint8), connectivity=8)
    if num_labels <= 1:
        return bw
    out = np.zeros_like(bw)
    for i in range(1, num_labels):
        area = int(stats[i][cv2.CC_STAT_AREA])
        if area >= min_area:
            out[labels == i] = 255
    return out


def build_mask_from_page(bgr: np.ndarray, morph_kernel: int, min_area: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_ch, s, v = cv2.split(hsv)
    _ = h_ch

    # Broad "paper / balloon ink" cue: moderately low saturation, not too dark.
    mask_white = cv2.inRange(hsv, (0, 0, 118), (180, 115, 255))

    # Local bright structures on L-channel (robust across tinted paper).
    blur_l = cv2.GaussianBlur(L, (5, 5), 0)
    mask_local = cv2.adaptiveThreshold(
        blur_l, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 53, -6
    )

    pct = float(np.percentile(L, 58))
    bright = np.where(L >= max(96.0, min(238.0, pct + 18.0)), 255, 0).astype(np.uint8)

    gray_blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, otsu = cv2.threshold(gray_blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    cand = cv2.bitwise_or(cv2.bitwise_and(mask_white, mask_local), cv2.bitwise_and(bright, mask_white))
    cand = cv2.bitwise_or(cand, cv2.bitwise_and(otsu, mask_white))

    bw = cand
    bw = cv2.medianBlur(bw, 3)

    if morph_kernel and morph_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_kernel, morph_kernel))
        ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, morph_kernel - 2), max(3, morph_kernel - 2)))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=2)
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, ko, iterations=1)

    bw = to_binary_0_255(bw)
    bw = remove_border_connected_components(bw)
    bw = filter_small_components(bw, min_area=min_area)
    bw = to_binary_0_255(bw)
    return bw, mask_white, mask_local


def write_debug(viz_dir: Path, src_path: Path, bgr: np.ndarray, bw: np.ndarray, mask_white: np.ndarray, mask_local: np.ndarray) -> None:
    ensure_dir(viz_dir)
    base = src_path.stem
    cv2.imwrite(str(viz_dir / f"{base}.mask_white.png"), mask_white)
    cv2.imwrite(str(viz_dir / f"{base}.mask_local.png"), mask_local)
    cv2.imwrite(str(viz_dir / f"{base}.mask_bw.png"), bw)
    # Overlay preview
    overlay = bgr.copy()
    red = np.zeros_like(overlay)
    red[:, :, 2] = 255
    alpha = 0.35
    m = (bw > 0)[:, :, None]
    overlay = np.where(m, (overlay * (1 - alpha) + red * alpha).astype(np.uint8), overlay)
    cv2.imwrite(str(viz_dir / f"{base}.overlay.png"), overlay)


def out_mask_name(src: Path) -> str:
    # Keep same stem; always output .png
    return f"{src.stem}.png"


def _progress_line(index: int, total: int, label: str, width: int = 28) -> None:
    if total <= 0:
        return
    pct = (index + 1) / total
    filled = min(width, max(0, int(round(pct * width))))
    bar = "#" * filled + "-" * (width - filled)
    short = (label[:44] + "…") if len(label) > 45 else label
    sys.stdout.write(f"\r[{bar}] {100.0 * pct:3.0f}% ({index + 1}/{total}) {short:<46}")
    sys.stdout.flush()


def main() -> int:
    args = parse_args()
    input_dir: Path = args.input_dir
    if not input_dir.exists():
        raise SystemExit(f"Input dir not found: {input_dir}")
    output_dir: Path = args.output_dir if args.output_dir is not None else (input_dir / "mask")
    ensure_dir(output_dir)
    viz_dir = output_dir / "_viz"

    files: List[Path] = list(iter_images(input_dir))
    total = len(files)
    if total == 0:
        print("[WARN] no images found in: " + str(input_dir))
        return 0
    print("DO NOT CLOSE - Processing images. Please wait.\n")
    count = 0
    for idx, src_path in enumerate(files):
        _progress_line(idx, total, src_path.name)
        bgr = cv2.imread(str(src_path), cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        bw, mask_white, mask_local = build_mask_from_page(bgr, morph_kernel=int(args.morph_kernel), min_area=int(args.min_area))
        out_path = output_dir / out_mask_name(src_path)
        cv2.imwrite(str(out_path), bw)
        if args.save_debug:
            write_debug(viz_dir, src_path, bgr, bw, mask_white, mask_local)
        count += 1

    if total:
        _progress_line(total - 1, total, "done")
        sys.stdout.write("\n")
    print(f"[OK] generated={count} outputDir={output_dir}")
    if args.save_debug:
        print(f"[OK] vizDir={viz_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

