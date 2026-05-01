#!/usr/bin/env python3
"""Read one binary mask image and write speech-bubble bounding boxes as JSON."""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

import cv2
import numpy as np


@dataclass
class BubbleBox:
    left: int
    top: int
    right: int
    bottom: int

    def as_dict(self) -> Dict[str, float]:
        return {
            "left": float(self.left),
            "top": float(self.top),
            "right": float(self.right),
            "bottom": float(self.bottom),
            "centerX": (self.left + self.right) / 2.0,
            "centerY": (self.top + self.bottom) / 2.0,
            "area": float(max(0, self.right - self.left) * max(0, self.bottom - self.top)),
        }


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


def extract_boxes_contour(
    mask: np.ndarray,
    *,
    min_area: int,
    max_area_ratio: float,
    min_width: int,
    min_height: int,
    max_ratio: float,
    min_fill_ratio: float = 0.0,
) -> List[BubbleBox]:
    img_h, img_w = mask.shape[:2]
    image_area = max(1, img_w * img_h)
    max_area = int(image_area * max_area_ratio)
    boxes: List[BubbleBox] = []
    m = (mask > 0).astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        area = int(cv2.contourArea(c))
        if area < min_area or area > max_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
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


def extract_boxes_with_fallback(mask: np.ndarray) -> tuple[List[BubbleBox], str]:
    min_area = 1200
    max_area_ratio = 0.92
    min_width = 40
    min_height = 28
    max_ratio = 14.0

    primary = extract_boxes_contour(
        mask,
        min_area=min_area,
        max_area_ratio=max_area_ratio,
        min_width=min_width,
        min_height=min_height,
        max_ratio=max_ratio,
        min_fill_ratio=0.06,
    )
    if primary:
        return primary, "primary_contour"

    primary_cc = extract_boxes(
        mask,
        min_area=min_area,
        max_area_ratio=max_area_ratio,
        min_width=min_width,
        min_height=min_height,
        max_ratio=max_ratio,
        min_fill_ratio=0.05,
    )
    if primary_cc:
        return primary_cc, "primary_cc"

    relaxed_co = extract_boxes_contour(
        mask,
        min_area=max(200, int(min_area * 0.35)),
        max_area_ratio=min(0.98, max_area_ratio + 0.05),
        min_width=max(24, int(min_width * 0.65)),
        min_height=max(16, int(min_height * 0.65)),
        max_ratio=max(max_ratio, 22.0),
        min_fill_ratio=0.04,
    )
    if relaxed_co:
        return relaxed_co, "fallback_contour"

    relaxed = extract_boxes(
        mask,
        min_area=max(120, int(min_area * 0.3)),
        max_area_ratio=min(0.98, max_area_ratio + 0.05),
        min_width=max(20, int(min_width * 0.6)),
        min_height=max(14, int(min_height * 0.6)),
        max_ratio=max(max_ratio, 24.0),
        min_fill_ratio=0.03,
    )
    if relaxed:
        return relaxed, "fallback_relaxed_cc"
    return [], "empty"


def postprocess_mask(gray: np.ndarray, morph_close_kernel: int) -> np.ndarray:
    _, bw_try = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    near_binary = np.logical_or(gray <= 12, gray >= 243)
    ratio_near = float(np.count_nonzero(near_binary)) / float(gray.size)
    if ratio_near >= 0.94:
        bw = bw_try
    else:
        _, bw_o = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        inv = cv2.bitwise_not(gray)
        _, inv_o = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        fg1 = float(np.count_nonzero(bw_o > 0)) / float(bw_o.size)
        fg2 = float(np.count_nonzero(inv_o > 0)) / float(inv_o.size)
        cand = bw_o if abs(fg1 - 0.5) <= abs(fg2 - 0.5) else cv2.bitwise_not(inv_o)
        bw = cand

    if morph_close_kernel and morph_close_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_close_kernel, morph_close_kernel))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k, iterations=2)
        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, morph_close_kernel - 2), max(3, morph_close_kernel - 2)))
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k2, iterations=1)
    return bw


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mask", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--morph-close-kernel", type=int, default=7)
    args = p.parse_args()

    if not args.mask.exists():
        print(f"mask not found: {args.mask}", file=sys.stderr)
        return 2

    bgr = cv2.imread(str(args.mask), cv2.IMREAD_COLOR)
    if bgr is None:
        print(f"unreadable: {args.mask}", file=sys.stderr)
        return 3

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    bw = postprocess_mask(gray, int(args.morph_close_kernel))
    boxes, pass_name = extract_boxes_with_fallback(bw)

    payload: Dict[str, Any] = {
        "version": 1,
        "maskPath": str(args.mask.resolve()),
        "width": int(bw.shape[1]),
        "height": int(bw.shape[0]),
        "pass": pass_name,
        "boxes": [b.as_dict() for b in boxes],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] boxes={len(boxes)} out={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
