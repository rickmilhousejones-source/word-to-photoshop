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


def extract_boxes(
    mask: np.ndarray,
    *,
    min_area: int,
    max_area_ratio: float,
    min_width: int,
    min_height: int,
    max_ratio: float,
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
    )
    if relaxed:
        return relaxed, "fallback_relaxed"
    return [], "empty"


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

    for mask_path in mask_paths:
        page = forced_page or page_from_name(mask_path.name, page_pattern)
        if not page:
            continue
        gray = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if gray is None:
            continue
        processed = postprocess_mask(gray, args.morph_close_kernel)
        boxes, pass_name = extract_boxes_with_fallback(processed, args)
        pages[page] = [b.as_dict() for b in boxes]
        files_meta.append({"file": mask_path.name, "page": page, "count": len(boxes), "pass": pass_name})

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
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] pages={len(pages)} output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
