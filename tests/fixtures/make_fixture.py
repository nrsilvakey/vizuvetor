"""Gera a fixture sintética `camiseta_sintetica` (determinística).

Estrutura equivalente ao caso de referência (frente e costas de camiseta):
fundo em bitmap reconstruído, moldura vetorial com furo, ornamento (estrela),
textos com diacríticos e um "personagem" em bitmap recortado com alfa suave.
A arte real do cliente ainda precisa de validação manual (ver docs/).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).parent
OUT = HERE / "camiseta_sintetica"


def fundo(w=1476, h=1772, seed=1):  # 250x300 mm a 150 ppi
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    sky = np.stack([200 - y / h * 80, 220 - y / h * 60, 245 - y / h * 30], -1)
    hills = (y > h * 0.62 + 60 * np.sin(x / w * 6.0)).astype(float)[..., None]
    land = np.stack([70 + 0 * x, 120 - y / h * 40, 60 + 0 * x], -1)
    img = sky * (1 - hills) + land * hills + rng.normal(0, 4, (h, w, 1))
    return Image.fromarray(np.clip(img, 0, 255).astype("uint8"), "RGB")


def personagem(w=708, h=886):  # 120x150 mm a 150 ppi
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((w * 0.3, h * 0.05, w * 0.7, h * 0.38), fill=(122, 74, 48, 255))       # cabeça
    d.rounded_rectangle((w * 0.18, h * 0.36, w * 0.82, h * 0.98), 80, fill=(240, 240, 235, 255))  # corpo
    d.ellipse((w * 0.4, h * 0.15, w * 0.46, h * 0.2), fill=(20, 20, 20, 255))
    d.ellipse((w * 0.54, h * 0.15, w * 0.6, h * 0.2), fill=(20, 20, 20, 255))
    a = im.getchannel("A").filter(ImageFilter.GaussianBlur(6))  # borda suave
    im.putalpha(a)
    return im


def estrela(cx, cy, r1, r2, n=8):
    pts = []
    for i in range(n * 2):
        ang = -math.pi / 2 + i * math.pi / n
        r = r1 if i % 2 == 0 else r2
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return "M" + "L".join(f"{x:.3f} {y:.3f}" for x, y in pts) + "Z"


def moldura(w, h, t, r):
    """Retângulo arredondado com furo (evenodd) em mm, usando curvas C."""
    k = 0.5523 * r

    def rr(x0, y0, x1, y1, r, k):
        return (f"M{x0 + r} {y0}L{x1 - r} {y0}C{x1 - r + k} {y0} {x1} {y0 + r - k} {x1} {y0 + r}"
                f"L{x1} {y1 - r}C{x1} {y1 - r + k} {x1 - r + k} {y1} {x1 - r} {y1}"
                f"L{x0 + r} {y1}C{x0 + r - k} {y1} {x0} {y1 - r + k} {x0} {y1 - r}"
                f"L{x0} {y0 + r}C{x0} {y0 + r - k} {x0 + r - k} {y0} {x0 + r} {y0}Z")

    ri = max(1.0, r - t)
    return rr(0, 0, w, h, r, k) + rr(t, t, w - t, h - t, ri, 0.5523 * ri)


def build():
    OUT.mkdir(exist_ok=True)
    fundo().save(OUT / "fundo_frente.png")
    fundo(seed=2).save(OUT / "fundo_costas.png")
    personagem().save(OUT / "personagem.png")
    font = "../fonts/DejaVuSans-Bold.ttf"

    def bg(pid, asset):
        return {"id": f"{pid}-fundo", "type": "background", "kind": "bitmap", "asset": asset,
                "width_mm": 250, "height_mm": 300, "z": 0, "approved": True, "status": "aprovado", "origin": "motor"}

    def txt(oid, content, x, y, size, fill="#1a1a1a"):
        return {"id": oid, "type": "text", "content": content, "font_path": font, "size_pt": size, "fill": fill,
                "align": "center", "z": 30, "transform": {"x_mm": x, "y_mm": y}, "approved": True,
                "reviewed": True, "ocr_text": content, "origin": "motor", "confidence": 0.9}

    frente = {"id": "frente", "role": "frente", "width_mm": 250, "height_mm": 300, "objects": [
        bg("frente", "fundo_frente.png"),
        {"id": "frente-moldura", "type": "vector", "name": "Moldura", "z": 10, "approved": True,
         "transform": {"x_mm": 10, "y_mm": 10},
         "paths": [{"d": moldura(230, 280, 6, 18), "fill": "#8a1c1c", "fill_rule": "evenodd"}]},
        {"id": "frente-estrela", "type": "vector", "name": "Ornamento", "z": 11, "approved": True,
         "transform": {"x_mm": 0, "y_mm": 0},
         "paths": [{"d": estrela(125, 262, 16, 7), "fill": "#d4a017"}]},
        {"id": "frente-personagem", "type": "bitmap", "name": "Personagem", "asset": "personagem.png",
         "width_mm": 120, "height_mm": 150, "z": 20, "approved": True, "transform": {"x_mm": 65, "y_mm": 75}},
        txt("frente-titulo", "Família de Légua", 125, 24, 40),
        txt("frente-sub", "Salve o povo de Légua", 125, 50, 20, "#8a1c1c"),
    ]}
    costas = {"id": "costas", "role": "costas", "width_mm": 250, "height_mm": 300, "page_x_mm": 270, "objects": [
        bg("costas", "fundo_costas.png"),
        {"id": "costas-moldura", "type": "vector", "name": "Moldura", "z": 10, "approved": True,
         "transform": {"x_mm": 10, "y_mm": 10},
         "paths": [{"d": moldura(230, 280, 6, 18), "fill": "#8a1c1c", "fill_rule": "evenodd"}]},
        txt("costas-vo", "Vó Maria Conga", 125, 110, 36),
        txt("costas-flechas", "Sete Flechas", 125, 150, 36, "#8a1c1c"),
    ]}
    proj = {"schema_version": 1, "id": "fixture-camiseta", "name": "Camiseta sintética", "mode": "camiseta",
            "unit": "mm", "revision": 1, "pieces": [frente, costas], "export": {"text_mode_page1": "texto", "min_ppi": 120}}
    (OUT / "projeto.json").write_text(json.dumps(proj, ensure_ascii=False, indent=2), encoding="utf-8")
    return OUT / "projeto.json"


if __name__ == "__main__":
    print(build())
