"""Leitura do atributo `d` do SVG para segmentos absolutos (M, L, C, Z).

Suporta M L H V C S Q T Z (absolutos e relativos). Quadráticas viram cúbicas.
Arcos (A/a) são recusados com erro claro: o motor nunca os gera e a conversão
aproximada ficaria escondida do operador.
"""
from __future__ import annotations

import re

_TOKEN = re.compile(r"[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_ARGS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "Z": 0}


class PathError(ValueError):
    pass


def parse(d: str) -> list[tuple]:
    """Retorna lista de ('M',x,y) ('L',x,y) ('C',x1,y1,x2,y2,x,y) ('Z',)."""
    toks = _TOKEN.findall(d)
    resto = _TOKEN.sub("", d).replace(",", "").strip()
    if resto:
        raise PathError(f"caracteres inválidos no caminho: {resto[:20]!r}")
    if not toks:
        raise PathError("caminho vazio")
    out: list[tuple] = []
    i, cmd = 0, None
    cx = cy = sx = sy = 0.0
    last_c2 = last_q = None  # pontos de controle para S e T
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Aa":
                raise PathError("arcos (A) não são suportados; converta para curvas")
            if cmd in "Zz":
                out.append(("Z",))
                cx, cy = sx, sy
                last_c2 = last_q = None
                continue
        elif cmd is None:
            raise PathError("caminho deve começar com M")
        up = cmd.upper()
        n = _ARGS[up]
        if i + n > len(toks) or any(tk.isalpha() for tk in toks[i : i + n]):
            raise PathError(f"faltam números para o comando {cmd}")
        a = [float(v) for v in toks[i : i + n]]
        i += n
        rel = cmd.islower()
        if up == "M":
            x, y = (cx + a[0], cy + a[1]) if rel else (a[0], a[1])
            out.append(("M", x, y))
            cx, cy, sx, sy = x, y, x, y
            cmd = "l" if rel else "L"  # pares seguintes são linhas
            last_c2 = last_q = None
        elif up in "LHV":
            if up == "L":
                x, y = (cx + a[0], cy + a[1]) if rel else (a[0], a[1])
            elif up == "H":
                x, y = (cx + a[0] if rel else a[0]), cy
            else:
                x, y = cx, (cy + a[0] if rel else a[0])
            out.append(("L", x, y))
            cx, cy = x, y
            last_c2 = last_q = None
        elif up in "CS":
            if up == "C":
                x1, y1, x2, y2, x, y = a
                if rel:
                    x1, y1, x2, y2, x, y = cx + x1, cy + y1, cx + x2, cy + y2, cx + x, cy + y
            else:
                x2, y2, x, y = a
                if rel:
                    x2, y2, x, y = cx + x2, cy + y2, cx + x, cy + y
                x1, y1 = (2 * cx - last_c2[0], 2 * cy - last_c2[1]) if last_c2 else (cx, cy)
            out.append(("C", x1, y1, x2, y2, x, y))
            last_c2, last_q = (x2, y2), None
            cx, cy = x, y
        else:  # Q / T -> cúbica
            if up == "Q":
                qx, qy, x, y = a
                if rel:
                    qx, qy, x, y = cx + qx, cy + qy, cx + x, cy + y
            else:
                x, y = a
                if rel:
                    x, y = cx + x, cy + y
                qx, qy = (2 * cx - last_q[0], 2 * cy - last_q[1]) if last_q else (cx, cy)
            out.append(("C", cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y))
            last_q, last_c2 = (qx, qy), None
            cx, cy = x, y
    if out and out[0][0] != "M":
        raise PathError("caminho deve começar com M")
    return out
