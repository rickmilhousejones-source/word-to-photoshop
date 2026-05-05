#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 TrueType 轮廓字体（glyf 表）生成「合成粗体」输出文件：沿水平方向把同一轮廓
在 0 … dx 之间做多层等间距叠加（位移越大层数越多），比「只画两遍」更接近实心
扫掠，减轻大位移时的「双层轮廓」与接缝感。仅依赖 fonttools。

注意：属几何近似粗体，质量取决于原字与位移量；可变字体会先移除 fvar/gvar 等再导出静态 TTF。
字体授权须自理，请勿对无权修改的商业字体再分发衍生文件。
"""

from __future__ import annotations

import argparse
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


def _read_postscript_name(font: TTFont) -> str:
    name = font.get("name")
    if not name:
        return ""
    for rec in list(name.names):
        if rec.nameID != 6:
            continue
        try:
            return rec.toUnicode()
        except Exception:
            try:
                if isinstance(rec.string, bytes):
                    return rec.string.decode("utf-16-be", errors="replace")
            except Exception:
                pass
    return ""


def _strip_var_tables(font: TTFont) -> None:
    for tag in ("fvar", "gvar", "avar", "MVAR", "HVAR", "STAT"):
        if tag in font:
            del font[tag]


def _patch_name_records(font: TTFont, display_suffix: str = " SynthBold", ps_suffix: str = "SynthBold") -> None:
    """Make internal name-table strings distinct from the source font (family/full name/PS name/unique ID, all langs)."""
    if "name" not in font:
        return
    table = font["name"]
    ds = display_suffix.strip()
    ds_sp = " " + ds if not display_suffix.startswith(" ") else display_suffix
    ps_token = "-" + ps_suffix

    def needs_display_suffix(u: str) -> bool:
        compact = u.replace(" ", "").lower()
        if compact.endswith("synthbold"):
            return False
        if "syntheticbold" in compact or ("synthetic" in compact and "bold" in compact):
            return False
        return True

    def needs_ps_suffix(u: str) -> bool:
        base = u.replace(" ", "")
        low = base.lower()
        return not (low.endswith(ps_suffix.lower()) or low.endswith("-synthbd"))

    updates = []
    for rec in list(table.names):
        nid = rec.nameID
        if nid not in (1, 2, 3, 4, 6, 16, 17, 18):
            continue
        try:
            u = rec.toUnicode()
        except Exception:
            try:
                u = str(rec.string, "utf-16-be") if isinstance(rec.string, bytes) else str(rec.string)
            except Exception:
                continue
        if nid == 6:
            base = u.replace(" ", "")
            if not needs_ps_suffix(u):
                newv = base
            else:
                newv = base + ps_token
                if len(newv) > 63:
                    newv = newv[:63]
        elif nid in (1, 16):
            newv = u + ds_sp if needs_display_suffix(u) else u
        elif nid in (4, 18):
            newv = u + ds_sp if needs_display_suffix(u) else u
        elif nid == 3:
            newv = u + ds_sp if needs_display_suffix(u) else u
        elif nid in (2, 17):
            low = u.strip().lower()
            if low in ("regular", "normal", "book", "roman", "medium"):
                newv = "Bold"
            else:
                newv = u + ds_sp if needs_display_suffix(u) else u
        else:
            continue
        updates.append((newv, nid, rec.platformID, rec.platEncID, rec.langID))
    for newv, nid, pid, eid, lid in updates:
        table.setName(newv, nid, pid, eid, lid)


def _shift_layer_count(dx: int, upem: int, cap: int) -> int:
    """More layers when |dx| is large (in design units) so outlines merge visually instead of twin edges."""
    adx = abs(int(dx))
    if adx <= 1:
        return 2
    em = max(int(upem), 1)
    # ~1 extra layer per ~0.006 em of shift, starting from 2; cap keeps file size/runtime sane.
    ratio = adx / float(em)
    extra = int(round(ratio / 0.006))
    n = 2 + max(0, extra)
    return max(2, min(int(cap), n))


def _shift_offsets(dx: int, n: int) -> list[int]:
    """Integer X offsets from 0 to dx inclusive, unique and sorted (handles rounding duplicates)."""
    adx = abs(int(dx))
    if n <= 2:
        return [0, adx] if adx > 0 else [0]
    raw = [int(round(adx * i / (n - 1))) for i in range(n)]
    out: list[int] = []
    for v in sorted(set(raw)):
        out.append(v)
    if len(out) < 2 and adx > 0:
        return [0, adx]
    return out


def _widen_metrics(font: TTFont, dx: int) -> None:
    if "hmtx" not in font:
        return
    mtx = font["hmtx"].metrics
    for gname in list(mtx.keys()):
        w, lsb = mtx[gname]
        try:
            w = int(w) + int(dx)
        except Exception:
            continue
        if w < 0:
            w = 0
        mtx[gname] = (w, lsb)


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate synthetic bold TTF from glyf outlines (fonttools only).")
    ap.add_argument("--input", "-i", required=True, help="Input .ttf/.ttc (first face if TTC)")
    ap.add_argument("--output", "-o", required=True, help="Output .ttf path")
    ap.add_argument(
        "--shift-em",
        type=float,
        default=0.028,
        help="Horizontal shift as fraction of unitsPerEm (default: .028; higher = heavier)",
    )
    ap.add_argument(
        "--shift-max-layers",
        type=int,
        default=10,
        metavar="N",
        help="Cap on intermediate outline copies along the shift (default 10; larger shift uses more layers up to this cap)",
    )
    ap.add_argument("--face-index", type=int, default=0, help="TTC face index (default 0)")
    args = ap.parse_args()

    inp = args.input
    try:
        low = inp.lower()
        if low.endswith(".ttc"):
            font = TTFont(inp, fontNumber=int(args.face_index))
        else:
            font = TTFont(inp)
    except Exception as e:
        print("ERR|open_font|" + str(e), file=sys.stderr)
        return 2

    if "glyf" not in font:
        print("ERR|need_glyf|仅支持含 TrueType 轮廓（glyf）的字体；纯 CFF 轮廓请先用工具转为 TTF。", file=sys.stderr)
        return 3

    if "fvar" in font:
        _strip_var_tables(font)

    try:
        print("META|src_ps|" + _read_postscript_name(font), flush=True)
    except Exception:
        pass

    upem = int(getattr(font["head"], "unitsPerEm", 1000) or 1000)
    dx = int(round(float(args.shift_em) * upem))
    if dx == 0:
        dx = 1

    cap = max(2, min(32, int(args.shift_max_layers)))
    n_layers = _shift_layer_count(dx, upem, cap)
    offsets = _shift_offsets(dx, n_layers)

    glyf = font["glyf"]
    glyph_set = font.getGlyphSet()
    names = [n for n in glyf.keys() if n is not None]

    ok = 0
    skip = 0
    for gname in names:
        pen = TTGlyphPen(glyph_set)
        try:
            for ox in offsets:
                glyph_set[gname].draw(TransformPen(pen, Transform(1, 0, 0, 1, int(ox), 0)))
            glyf[gname] = pen.glyph()
            ok += 1
        except Exception as e:
            print("WARN|glyph|" + str(gname) + "|" + str(e), file=sys.stderr)
            skip += 1

    _widen_metrics(font, dx)
    _patch_name_records(font)

    try:
        font.save(args.output)
    except Exception as e:
        print("ERR|save|" + str(e), file=sys.stderr)
        return 4

    try:
        out_font = TTFont(args.output)
        print("META|out_ps|" + _read_postscript_name(out_font), flush=True)
    except Exception:
        pass

    print(
        "OK|"
        + str(args.output)
        + "|glyphs_ok="
        + str(ok)
        + "|glyphs_skip="
        + str(skip)
        + "|dx="
        + str(dx)
        + "|upem="
        + str(upem)
        + "|layers="
        + str(len(offsets))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
