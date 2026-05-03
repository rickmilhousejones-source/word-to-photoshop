#!/usr/bin/env python3
"""
Extract speech bubble rectangles from binary mask images.

Input assumption:
- white regions (255) are candidate bubble areas
- black regions (0) are background
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence

import cv2
import numpy as np


@dataclass
class BubbleBox:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top

    @property
    def area(self) -> int:
        return self.width * self.height

    def as_dict(self) -> Dict[str, float]:
        return {
            "left": self.left,
            "top": self.top,
            "right": self.right,
            "bottom": self.bottom,
            "centerX": (self.left + self.right) / 2.0,
            "centerY": (self.top + self.bottom) / 2.0,
            "area": self.area,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract bubble boxes from mask images")
    parser.add_argument("--mask-dir", required=True, type=Path, help="Directory containing page mask images")
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="Output JSON path, e.g. jsxdata/bubble_boxes.json",
    )
    parser.add_argument("--page-regex", default=r"(\d{1,4})", help="Regex to capture page number from filename")
    parser.add_argument(
        "--force-page",
        default="",
        help="Force all extracted boxes into this page id (e.g. 003), ignoring filename parsing",
    )
    parser.add_argument("--min-area", type=int, default=1200, help="Min connected component area")
    parser.add_argument("--max-area-ratio", type=float, default=0.92, help="Max area ratio of image")
    parser.add_argument("--min-width", type=int, default=40, help="Min candidate width")
    parser.add_argument("--min-height", type=int, default=28, help="Min candidate height")
    parser.add_argument("--max-ratio", type=float, default=14.0, help="Max aspect ratio")
    parser.add_argument(
        "--morph-close-kernel",
        type=int,
        default=7,
        help="Kernel size for morphology close, set 0 to disable",
    )
    return parser.parse_args()


def normalize_page(page_number: int | str) -> str:
    num = int(page_number)
    return f"{num:03d}"


def discover_masks(mask_dir: Path) -> Sequence[Path]:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
    return sorted([p for p in mask_dir.iterdir() if p.is_file() and p.suffix.lower() in exts])


def is_probably_binary_mask(gray: np.ndarray) -> bool:
    # True binary masks should be mostly near 0/255 with very few mid-tones.
    if gray is None or gray.size == 0:
        return False
    near_binary = np.logical_or(gray <= 12, gray >= 243)
    ratio = float(np.count_nonzero(near_binary)) / float(gray.size)
    return ratio >= 0.94


def page_from_name(name: str, page_pattern: re.Pattern[str]) -> str | None:
    stem = Path(name).stem
    lower_stem = stem.lower()

    # Prefer numbers near "_mask" to avoid picking UUID tails.
    mask_pos = lower_stem.find("_mask")
    if mask_pos > 0:
        prefix = stem[:mask_pos]
        m = re.search(r"(\d{1,4})(?!.*\d)", prefix)
        if m:
            return normalize_page(m.group(1))

    hit = None
    for m in page_pattern.finditer(stem):
        hit = m
    if not hit:
        return None
    return normalize_page(hit.group(1))


def postprocess_mask(gray: np.ndarray, morph_close_kernel: int) -> np.ndarray:
    _, bw = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    if morph_close_kernel and morph_close_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_close_kernel, morph_close_kernel))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=1)
    return bw


def postprocess_non_binary(gray: np.ndarray, morph_close_kernel: int) -> np.ndarray:
    # For non-binary comic pages, approximate white speech balloons:
    # high value + low saturation + local bright regions.
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if morph_close_kernel and morph_close_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_close_kernel, morph_close_kernel))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=1)
    return bw


def postprocess_non_binary_from_color(bgr: np.ndarray, morph_close_kernel: int) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    _ = h  # Keep signature explicit; hue is intentionally unused.

    # White-ish areas in comics: high V, low S.
    mask_white = cv2.inRange(hsv, (0, 0, 145), (180, 95, 255))

    # Keep strong local bright areas for balloons with texture/noise.
    blur = cv2.GaussianBlur(v, (5, 5), 0)
    adap = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, -4)

    bw = cv2.bitwise_and(mask_white, adap)
    bw = cv2.medianBlur(bw, 3)
    if morph_close_kernel and morph_close_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_close_kernel, morph_close_kernel))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=1)
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k, iterations=1)
    return bw


def extract_boxes(
    mask: np.ndarray,
    *,
    min_area: int,
    max_area_ratio: float,
    min_width: int,
    min_height: int,
    max_ratio: float,
    min_fill_ratio: float = 0.0,
) -> List[BubbleBox]:
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    img_h, img_w = mask.shape[:2]
    image_area = max(1, img_w * img_h)
    max_area = int(image_area * max_area_ratio)
    boxes: List[BubbleBox] = []

    for label in range(1, num_labels):
        x, y, w, h, area = stats[label]
        if area < min_area or area > max_area:
            continue
        if w < min_width or h < min_height:
            continue
        bbox_area = max(1, int(w) * int(h))
        fill_ratio = float(area) / float(bbox_area)
        if fill_ratio < min_fill_ratio:
            continue
        ratio = max(w / max(1, h), h / max(1, w))
        if ratio > max_ratio:
            continue
        boxes.append(BubbleBox(left=int(x), top=int(y), right=int(x + w), bottom=int(y + h)))

    boxes.sort(key=lambda b: (b.top, b.left))
    return boxes


def extract_boxes_with_fallback(mask: np.ndarray, args: argparse.Namespace) -> tuple[List[BubbleBox], str]:
    primary = extract_boxes(
        mask,
        min_area=args.min_area,
        max_area_ratio=args.max_area_ratio,
        min_width=args.min_width,
        min_height=args.min_height,
        max_ratio=args.max_ratio,
        min_fill_ratio=0.05,
    )
    if primary:
        return primary, "primary"

    # Fallback for sparse/thin mask pages: relax thresholds to avoid empty page output.
    relaxed = extract_boxes(
        mask,
        min_area=max(120, int(args.min_area * 0.3)),
        max_area_ratio=min(0.98, args.max_area_ratio + 0.05),
        min_width=max(20, int(args.min_width * 0.6)),
        min_height=max(14, int(args.min_height * 0.6)),
        max_ratio=max(args.max_ratio, 24.0),
        min_fill_ratio=0.03,
    )
    if relaxed:
        return relaxed, "fallback_relaxed"
    return [], "empty"


def extract_boxes_non_binary(mask: np.ndarray, args: argparse.Namespace) -> tuple[List[BubbleBox], str]:
    primary = extract_boxes(
        mask,
        min_area=max(args.min_area, 2600),
        max_area_ratio=min(args.max_area_ratio, 0.30),
        min_width=max(args.min_width, 72),
        min_height=max(args.min_height, 44),
        max_ratio=min(args.max_ratio, 9.0),
        min_fill_ratio=0.18,
    )
    if primary:
        return primary, "non_binary_primary"
    relaxed = extract_boxes(
        mask,
        min_area=max(900, int(args.min_area * 0.55)),
        max_area_ratio=min(0.40, args.max_area_ratio),
        min_width=max(40, int(args.min_width * 0.8)),
        min_height=max(26, int(args.min_height * 0.8)),
        max_ratio=min(12.0, max(args.max_ratio, 12.0)),
        min_fill_ratio=0.12,
    )
    if relaxed:
        return relaxed, "non_binary_relaxed"
    return [], "non_binary_empty"


def write_visualization(image_path: Path, page: str, boxes: Sequence[BubbleBox], viz_dir: Path) -> str:
    viz_dir.mkdir(parents=True, exist_ok=True)
    src = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if src is None:
        return ""
    canvas = src.copy()
    for i, b in enumerate(boxes):
        cv2.rectangle(canvas, (int(b.left), int(b.top)), (int(b.right), int(b.bottom)), (0, 255, 120), 2)
        label = f"{i+1}:{int(b.area)}"
        tx = max(4, int(b.left))
        ty = max(18, int(b.top) - 6)
        cv2.putText(canvas, label, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 120), 1, cv2.LINE_AA)
    header = f"page={page} boxes={len(boxes)} file={image_path.name}"
    cv2.putText(canvas, header, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 80), 2, cv2.LINE_AA)
    out_name = image_path.stem + ".bubble_preview.png"
    out_path = viz_dir / out_name
    cv2.imwrite(str(out_path), canvas)
    return str(out_path)


def main() -> int:
    args = parse_args()
    if not args.mask_dir.exists():
        raise SystemExit(f"Mask directory not found: {args.mask_dir}")

    page_pattern = re.compile(args.page_regex)
    forced_page = normalize_page(args.force_page) if str(args.force_page or "").strip() else ""
    mask_paths = discover_masks(args.mask_dir)
    if not mask_paths:
        raise SystemExit(f"No mask files found in: {args.mask_dir}")

    pages: Dict[str, List[Dict[str, float]]] = {}
    files_meta: List[Dict[str, object]] = []
    viz_dir = args.output.parent / "_bubble_viz"

    for mask_path in mask_paths:
        parsed_page = page_from_name(mask_path.name, page_pattern)
        if forced_page and parsed_page and parsed_page != forced_page:
            continue
        page = forced_page or parsed_page
        if not page:
            continue
        bgr = cv2.imread(str(mask_path), cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        is_binary = is_probably_binary_mask(gray)
        if not is_binary:
            processed = postprocess_non_binary_from_color(bgr, args.morph_close_kernel)
            boxes, pass_name = extract_boxes_non_binary(processed, args)
        else:
            processed = postprocess_mask(gray, args.morph_close_kernel)
            boxes, pass_name = extract_boxes_with_fallback(processed, args)
        pages.setdefault(page, [])
        pages[page].extend([b.as_dict() for b in boxes])
        viz_path = write_visualization(mask_path, page, boxes, viz_dir)
        files_meta.append({
            "file": mask_path.name,
            "page": page,
            "count": len(boxes),
            "pass": pass_name if is_binary else ("non_binary_input+" + pass_name),
            "viz": viz_path,
        })

    payload = {
        "version": 1,
        "coordinateSpace": "documentPixels",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "generator": {
            "name": "tools/extract_bubbles.py",
            "opencv": cv2.__version__,
            "params": {
                "minArea": args.min_area,
                "maxAreaRatio": args.max_area_ratio,
                "minWidth": args.min_width,
                "minHeight": args.min_height,
                "maxRatio": args.max_ratio,
                "morphCloseKernel": args.morph_close_kernel,
            },
        },
        "pages": pages,
        "files": files_meta,
        "visualizationDir": str(viz_dir),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] pages={len(pages)} output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
