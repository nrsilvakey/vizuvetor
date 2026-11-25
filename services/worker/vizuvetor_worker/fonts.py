"""Fontes: licença de incorporação, posicionamento com HarfBuzz e glifos em curvas.

Texto vivo (pág. 1) e texto em curvas (pág. 3) usam o MESMO posicionamento:
avanços do HarfBuzz com `kern` e `liga` desligados, que coincidem com as
larguras que o ReportLab usa ao escrever o texto vivo. Assim a pág. 3 fica
em registro com a pág. 1. Limitação documentada: sem kerning nem ligaduras.

Sem HarfBuzz (ex.: navegador via Pyodide), o posicionamento cai para os avanços
do fontTools (cmap + hmtx), que é o mesmo resultado para texto latino em NFC.
O texto é sempre normalizado para NFC antes de posicionar e de escrever.
"""
from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

try:
    import uharfbuzz as hb
except ImportError:  # Pyodide / ambientes sem HarfBuzz
    hb = None
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont

FEATURES = {"kern": False, "liga": False, "clig": False, "calt": False}


@dataclass
class FontInfo:
    path: str
    name: str  # nome registrado no ReportLab
    upm: int
    ascender: int
    descender: int
    embeddable: bool
    fs_type: int


@lru_cache(maxsize=32)
def info(path: str) -> FontInfo:
    f = TTFont(path, lazy=True)
    fs = f["OS/2"].fsType if "OS/2" in f else 0
    # bit 1 (0x0002) = licença restrita: não pode incorporar
    restricted = bool(fs & 0x0002) and not (fs & 0x000C)
    hhea = f["hhea"]
    digest = hashlib.sha1(path.encode()).hexdigest()[:8]
    return FontInfo(path, f"VV-{digest}", f["head"].unitsPerEm, hhea.ascent, hhea.descent, not restricted, fs)


@lru_cache(maxsize=32)
def _hb_font(path: str):
    blob = hb.Blob.from_file_path(path)
    face = hb.Face(blob)
    return hb.Font(face)


def missing_glyphs(path: str, text: str) -> list[str]:
    cmap = TTFont(path, lazy=True).getBestCmap()
    return sorted({ch for ch in nfc(text) if not ch.isspace() and ord(ch) not in cmap})


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def shape(path: str, text: str, size_pt: float, letter_spacing_pt: float = 0.0):
    """Lista de (glyph_name, x_pt, y_pt) e largura total, em pontos."""
    text = nfc(text)
    upm = info(path).upm
    k = size_pt / upm
    tt = _tt(path)
    x = 0.0
    out = []
    if hb is not None:
        font = _hb_font(path)
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(font, buf, FEATURES)
        order = tt.getGlyphOrder()
        for gi, gp in zip(buf.glyph_infos, buf.glyph_positions):
            out.append((order[gi.codepoint], x + gp.x_offset * k, gp.y_offset * k))
            x += gp.x_advance * k + letter_spacing_pt
    else:
        cmap, hmtx = tt.getBestCmap(), tt["hmtx"]
        for ch in text:
            g = cmap.get(ord(ch), ".notdef")
            out.append((g, x, 0.0))
            x += hmtx[g][0] * k + letter_spacing_pt
    if out:
        x -= letter_spacing_pt
    return out, x


@lru_cache(maxsize=32)
def _tt(path: str):
    return TTFont(path, lazy=True)


class _RLPen(BasePen):
    """Converte contornos do glifo para um path do ReportLab (curvas cúbicas)."""

    def __init__(self, glyphset, path, ox, oy, k):
        super().__init__(glyphset)
        self.p, self.ox, self.oy, self.k = path, ox, oy, k

    def _t(self, pt):
        return self.ox + pt[0] * self.k, self.oy + pt[1] * self.k

    def _moveTo(self, pt):
        self.p.moveTo(*self._t(pt))

    def _lineTo(self, pt):
        self.p.lineTo(*self._t(pt))

    def _curveToOne(self, p1, p2, p3):
        self.p.curveTo(*self._t(p1), *self._t(p2), *self._t(p3))

    def _closePath(self):
        self.p.close()


@lru_cache(maxsize=32)
def _glyphset(path: str):
    return TTFont(path).getGlyphSet()


def draw_outlines(path_obj, font_path: str, glyphs, baseline_x: float, baseline_y: float, size_pt: float) -> int:
    """Desenha os glifos (y para cima, em pt) dentro de `path_obj`. Retorna nº de glifos com contorno."""
    gs = _glyphset(font_path)
    k = size_pt / info(font_path).upm
    n = 0
    for name, gx, gy in glyphs:
        pen = _RLPen(gs, path_obj, baseline_x + gx, baseline_y + gy, k)
        before = len(path_obj._code) if hasattr(path_obj, "_code") else 0
        gs[name].draw(pen)
        if not hasattr(path_obj, "_code") or len(path_obj._code) > before:
            n += 1
    return n
