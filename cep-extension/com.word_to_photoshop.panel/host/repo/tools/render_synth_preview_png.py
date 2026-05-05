#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build a 3-column PNG preview: source | faux-like strokes | synthetic TTF (via generator)."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont


def _text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _draw_centered(draw, cx, cy, text, font, fill):
    tw, th = _text_size(draw, text, font)
    draw.text((cx - tw / 2, cy - th / 2), text, font=font, fill=fill)


def _draw_faux_like_centered(draw, cx, cy, text, font):
    tw, th = _text_size(draw, text, font)
    x0, y0 = cx - tw / 2, cy - th / 2
    for ox, oy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)):
        draw.text((x0 + ox, y0 + oy), text, font=font, fill=(130, 130, 130))
    draw.text((x0, y0), text, font=font, fill=(25, 25, 25))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", "-i", required=True)
    ap.add_argument("--output", "-o", required=True)
    ap.add_argument("--generator", "-g", required=True, help="Path to generate_synthetic_bold_font.py")
    ap.add_argument("--text", "-t", default="\u662f")
    ap.add_argument("--shift-em", type=float, default=0.028)
    args = ap.parse_args()

    text = (args.text or "\u662f").strip() or "\u662f"
    fd, tmp_ttf = tempfile.mkstemp(suffix=".ttf")
    os.close(fd)
    try:
        r = subprocess.run(
            [
                sys.executable,
                args.generator,
                "--input",
                args.input,
                "--output",
                tmp_ttf,
                "--shift-em",
                str(args.shift_em),
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            sys.stderr.write(r.stderr or r.stdout or "generator failed\n")
            return 2
    except Exception as e:
        print("ERR|subprocess|" + str(e), file=sys.stderr)
        return 2

    # Match ScriptUI image control size / aspect to avoid non-uniform scaling squashing rows together.
    w, h = 560, 200
    im = Image.new("RGB", (w, h), (248, 248, 248))
    dr = ImageDraw.Draw(im)
    size = 72
    try:
        f_src = ImageFont.truetype(args.input, size)
    except Exception:
        f_src = ImageFont.load_default()
    try:
        f_syn = ImageFont.truetype(tmp_ttf, size)
    except Exception:
        f_syn = f_src

    # Three columns: source | faux-like | synthetic (matches UI copy: left / mid / right).
    col_x = [w * (1 + 2 * i) / 6 for i in range(3)]
    label_y = 14
    glyph_y = h / 2 + 8
    try:
        f_lbl = ImageFont.truetype(args.input, 13)
    except Exception:
        f_lbl = ImageFont.load_default()

    def col_label(i, s):
        dr.text((col_x[i], label_y), s, font=f_lbl, fill=(72, 72, 72), anchor="mm")

    col_label(0, "\u6e90\u5b57\u4f53")
    col_label(1, "\u4eff\u7c97\u8fd1\u4f3c")
    col_label(2, "\u5408\u6210 %.3f" % args.shift_em)

    _draw_centered(dr, col_x[0], glyph_y, text, f_src, (20, 20, 20))
    _draw_faux_like_centered(dr, col_x[1], glyph_y, text, f_src)
    _draw_centered(dr, col_x[2], glyph_y, text, f_syn, (18, 18, 18))

    try:
        im.save(args.output)
    except Exception as e:
        print("ERR|save_png|" + str(e), file=sys.stderr)
        return 3
    finally:
        try:
            os.remove(tmp_ttf)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
