"""Exportador do PDF de exatamente 3 páginas (contrato para o CorelDRAW).

Pág. 1 — Arte completa: fundo + objetos nas posições finais, cada objeto
         isolado em seu próprio bloco gráfico (q … Q).
Pág. 2 — Somente fundo, em registro com a pág. 1 (mesmo MediaBox e posições).
Pág. 3 — Todos os vetores: paths aprovados, textos convertidos em curvas
         (mesmo posicionamento da pág. 1) e fundos genuinamente vetoriais.
         Nenhuma imagem (XObject de imagem ou imagem inline).

Conversão física: 72 pt por polegada, 25,4 mm por polegada.
"""
from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont as RLTTFont
from reportlab.pdfgen import canvas as rlcanvas

from . import __version__, fonts, svgpath
from .schema import (
    BackgroundObject,
    BitmapObject,
    Piece,
    Project,
    TextObject,
    VectorObject,
    VectorPath,
)

PT_PER_MM = 72.0 / 25.4
PAGE_LABELS = ("Arte completa", "Fundo", "Vetores")


def mm(v: float) -> float:
    return v * PT_PER_MM


class ExportError(ValueError):
    """Erro de entrada com mensagem para o operador."""


@dataclass
class Report:
    warnings: list[str] = field(default_factory=list)
    bitmaps: list[dict] = field(default_factory=list)
    counts: dict = field(default_factory=lambda: {1: {}, 2: {}, 3: {}})
    draft: bool = False

    def count(self, page: int, kind: str, n: int = 1):
        self.counts[page][kind] = self.counts[page].get(kind, 0) + n


def _rgb(hexs: str):
    return tuple(int(hexs[i : i + 2], 16) / 255 for i in (1, 3, 5))


def _resolve(base: Path, p: str) -> Path:
    q = Path(p)
    return q if q.is_absolute() else (base / q)


class _Exporter:
    def __init__(self, project: Project, base_dir: Path):
        self.p = project
        self.base = base_dir
        self.r = Report()
        ex = project.export
        if ex.page_width_mm and ex.page_height_mm:
            self.W, self.H = ex.page_width_mm, ex.page_height_mm
        else:
            self.W = max(pc.page_x_mm + pc.width_mm + pc.bleed_mm for pc in project.pieces) + ex.page_margin_mm
            self.H = max(pc.page_y_mm + pc.height_mm + pc.bleed_mm for pc in project.pieces) + ex.page_margin_mm
        self._imgs: dict[str, ImageReader] = {}
        self._fonts: set[str] = set()
        self._validate()

    # ---------- validação ----------
    def _validate(self):
        ids = set()
        for pc in self.p.pieces:
            for o in pc.objects:
                if o.id in ids:
                    raise ExportError(f"ID de objeto repetido: {o.id}")
                ids.add(o.id)
                assets = []
                if isinstance(o, (BitmapObject,)):
                    assets.append(o.asset)
                if isinstance(o, BackgroundObject):
                    if o.kind == "bitmap":
                        if not (o.asset and o.width_mm and o.height_mm):
                            raise ExportError(f"Fundo bitmap {o.id} precisa de asset, width_mm e height_mm")
                        assets.append(o.asset)
                    elif not o.paths:
                        raise ExportError(f"Fundo vetorial {o.id} sem caminhos")
                for a in assets:
                    f = _resolve(self.base, a)
                    if not f.is_file():
                        raise ExportError(f"Arquivo não encontrado para {o.id}: {a}")
                    try:
                        with Image.open(f) as im:
                            im.verify()
                    except Exception as e:  # noqa: BLE001
                        raise ExportError(f"Imagem inválida em {o.id}: {a} ({e})") from e
                paths = (o.paths if isinstance(o, (VectorObject, BackgroundObject)) else [])
                for vp in paths:
                    try:
                        svgpath.parse(vp.d)
                    except svgpath.PathError as e:
                        raise ExportError(f"Caminho inválido em {o.id}: {e}") from e
                if isinstance(o, TextObject):
                    fp = _resolve(self.base, o.font_path)
                    if not fp.is_file():
                        raise ExportError(f"Fonte não encontrada para {o.id}: {o.font_path}")
                    miss = fonts.missing_glyphs(str(fp), o.content)
                    if miss:
                        raise ExportError(f"A fonte de {o.id} não tem os caracteres: {' '.join(miss)}")
                    if not o.reviewed:
                        self.r.warnings.append(f"Texto {o.id} ('{o.content}') ainda não revisado (acentos)")
                if not o.approved:
                    self.r.draft = True
            for o in pc.objects:
                if isinstance(o, BackgroundObject) and o.status != "aprovado":
                    self.r.draft = True
                    self.r.warnings.append(f"Fundo {o.id} em rascunho (não aprovado)")

    # ---------- geometria ----------
    def _enter(self, c, pc: Piece, o):
        """Leva o sistema de coordenadas ao canto superior esquerdo do objeto (pt, y para cima)."""
        t = o.transform
        c.saveState()
        c.translate(mm(pc.page_x_mm + t.x_mm), mm(self.H - pc.page_y_mm - t.y_mm))
        if t.rotation_deg:
            c.rotate(-t.rotation_deg)  # rotação horária na tela (y para baixo)
        return t.scale

    def _paths(self, c, paths: list[VectorPath], scale: float, page: int):
        c.saveState()
        k = PT_PER_MM * scale
        c.transform(k, 0, 0, -k, 0, 0)  # unidades do objeto: mm, y para baixo
        for vp in paths:
            p = c.beginPath()
            for seg in svgpath.parse(vp.d):
                if seg[0] == "M":
                    p.moveTo(seg[1], seg[2])
                elif seg[0] == "L":
                    p.lineTo(seg[1], seg[2])
                elif seg[0] == "C":
                    p.curveTo(*seg[1:])
                else:
                    p.close()
            c.setFillColorRGB(*_rgb(vp.fill))
            stroke = bool(vp.stroke and vp.stroke_width_mm > 0)
            if stroke:
                c.setStrokeColorRGB(*_rgb(vp.stroke))
                c.setLineWidth(vp.stroke_width_mm)  # em unidades do objeto (mm)
            c.drawPath(p, fill=1, stroke=1 if stroke else 0, fillMode=0 if vp.fill_rule == "evenodd" else 1)
            self.r.count(page, "paths")
        c.restoreState()

    def _image(self, c, asset: str, w_mm: float, h_mm: float, scale: float, oid: str, page: int):
        f = _resolve(self.base, asset)
        key = str(f)
        if key not in self._imgs:
            self._imgs[key] = ImageReader(str(f))
        ir = self._imgs[key]
        c.saveState()
        c.scale(scale, scale)
        c.drawImage(ir, 0, -mm(h_mm), mm(w_mm), mm(h_mm), mask="auto")
        c.restoreState()
        self.r.count(page, "imagens")
        if page == 1:
            pw, ph = ir.getSize()
            ppi_x = pw / (w_mm * scale / 25.4)
            ppi_y = ph / (h_mm * scale / 25.4)
            self.r.bitmaps.append({"objeto": oid, "pixels": [pw, ph], "mm": [round(w_mm * scale, 2), round(h_mm * scale, 2)],
                                   "ppi_efetivo": [round(ppi_x, 1), round(ppi_y, 1)]})
            if min(ppi_x, ppi_y) < self.p.export.min_ppi:
                self.r.warnings.append(f"{oid}: PPI efetivo {min(ppi_x, ppi_y):.0f} abaixo do mínimo {self.p.export.min_ppi:.0f}")

    def _text(self, c, o: TextObject, scale: float, as_curves: bool, page: int):
        fp = str(_resolve(self.base, o.font_path))
        fi = fonts.info(fp)
        glyphs, width = fonts.shape(fp, o.content, o.size_pt, o.letter_spacing_pt)
        ax = {"left": 0.0, "center": -width / 2, "right": -width}[o.align]
        base_y = -o.size_pt * fi.ascender / fi.upm  # y do objeto = topo da caixa (ascendente)
        c.saveState()
        c.scale(scale, scale)
        c.setFillColorRGB(*_rgb(o.fill))
        if as_curves or not fi.embeddable:
            if not as_curves:
                self.r.warnings.append(f"Fonte de {o.id} não permite incorporação: texto saiu em curvas")
            p = c.beginPath()
            fonts.draw_outlines(p, fp, glyphs, ax, base_y, o.size_pt)
            c.drawPath(p, fill=1, stroke=0, fillMode=1)  # glifos usam nonzero
            self.r.count(page, "texto_em_curvas")
        else:
            if fi.name not in self._fonts:
                pdfmetrics.registerFont(RLTTFont(fi.name, fp))
                self._fonts.add(fi.name)
            t = c.beginText()
            t.setTextOrigin(ax, base_y)
            t.setFont(fi.name, o.size_pt)
            t.setCharSpace(o.letter_spacing_pt)
            t.textOut(fonts.nfc(o.content))
            c.drawText(t)
            self.r.count(page, "texto_vivo")
        c.restoreState()

    # ---------- páginas ----------
    def _ordered(self):
        for pc in self.p.pieces:
            for o in sorted(pc.objects, key=lambda o: o.z):
                if o.visible:
                    yield pc, o

    def _page(self, c, page: int):
        for pc, o in self._ordered():
            is_bg = isinstance(o, BackgroundObject)
            if page == 2 and not is_bg:
                continue
            if page == 3 and (isinstance(o, BitmapObject) or (is_bg and o.kind == "bitmap")):
                continue
            s = self._enter(c, pc, o)
            if isinstance(o, VectorObject) or (is_bg and o.kind == "vector"):
                self._paths(c, o.paths, s, page)
            elif isinstance(o, TextObject):
                self._text(c, o, s, as_curves=(page == 3 or self.p.export.text_mode_page1 == "curvas"), page=page)
            else:
                self._image(c, o.asset, o.width_mm, o.height_mm, s, o.id, page)
            c.restoreState()
        if page == 3 and not self.r.counts[3]:
            self.r.warnings.append("Página 3 vazia: não há vetores aprovados")

    def run(self, out: Path) -> Report:
        buf = io.BytesIO()
        c = rlcanvas.Canvas(buf, pagesize=(mm(self.W), mm(self.H)), pageCompression=1)
        c.setTitle(self.p.name)
        c.setCreator(f"VizuVetor {__version__}")
        c.setAuthor("VizuVetor — Opencriativa")
        c.setSubject("RASCUNHO" if self.r.draft else "Aprovado")
        single = self.p.pieces[0] if len(self.p.pieces) == 1 else None
        for page in (1, 2, 3):
            if single and single.bleed_mm > 0:
                b = single.bleed_mm
                x0, y0 = single.page_x_mm, self.H - single.page_y_mm - single.height_mm
                c.setTrimBox((mm(x0), mm(y0), mm(x0 + single.width_mm), mm(y0 + single.height_mm)))
                c.setBleedBox((mm(x0 - b), mm(y0 - b), mm(x0 + single.width_mm + b), mm(y0 + single.height_mm + b)))
            self._page(c, page)
            c.showPage()
        c.save()
        # rótulos de página (pypdf), sem reescrever o conteúdo
        rd = PdfReader(io.BytesIO(buf.getvalue()))
        wr = PdfWriter(clone_from=rd)
        for page in wr.pages:
            _strip_unused_text(page, wr)
        for i, lab in enumerate(PAGE_LABELS):
            wr.set_page_label(i, i, prefix=lab)
        wr.add_metadata({"/Title": self.p.name, "/Subject": "RASCUNHO" if self.r.draft else "Aprovado"})
        with open(out, "wb") as f:
            wr.write(f)
        return self.r


_SHOW = {b"Tj", b"TJ", b"'", b'"'}


def _strip_unused_text(page, writer):
    """Remove blocos BT…ET que não escrevem texto e fontes não usadas.

    O ReportLab abre um bloco de texto vazio com Helvetica em toda página;
    o CorelDRAW avisaria de fonte ausente na importação.
    """
    from pypdf.generic import ContentStream, NameObject

    cs = ContentStream(page.get_contents(), writer)
    ops, block, used = [], None, set()
    for operands, op in cs.operations:
        if op == b"BT":
            block = [(operands, op)]
            continue
        if block is not None:
            block.append((operands, op))
            if op == b"ET":
                if any(o in _SHOW for _, o in block):
                    ops.extend(block)
                    used.update(str(a[0]) for a, o in block if o == b"Tf")
                block = None
            continue
        ops.append((operands, op))
    cs.operations = ops
    page.replace_contents(cs)
    res = page.get("/Resources")
    if res is not None and "/Font" in res.get_object():
        # recursos podem ser compartilhados entre páginas: cria cópias por página
        from pypdf.generic import DictionaryObject

        new_res = DictionaryObject(res.get_object())
        old = new_res["/Font"].get_object()
        keep = DictionaryObject({NameObject(k): v for k, v in old.items() if k in used})
        if keep:
            new_res[NameObject("/Font")] = keep
        else:
            del new_res[NameObject("/Font")]
        page[NameObject("/Resources")] = new_res


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def export(project_path: str | Path, out_pdf: str | Path, manifest_path: str | Path | None = None) -> dict:
    project_path, out_pdf = Path(project_path), Path(out_pdf)
    try:
        proj = Project.model_validate_json(project_path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise ExportError(f"Projeto inválido: {e}") from e
    ex = _Exporter(proj, project_path.parent)
    rep = ex.run(out_pdf)
    assets = sorted({o.asset for pc in proj.pieces for o in pc.objects if getattr(o, "asset", None)})
    manifest = {
        "motor": f"vizuvetor {__version__}",
        "projeto": {"id": proj.id, "revisao": proj.revision, "sha256": _sha(project_path)},
        "pdf": {"arquivo": out_pdf.name, "sha256": _sha(out_pdf), "paginas": list(PAGE_LABELS),
                "tamanho_mm": [round(ex.W, 3), round(ex.H, 3)]},
        "estado": "rascunho" if rep.draft else "aprovado",
        "parametros": proj.export.model_dump(),
        "assets": {a: _sha(_resolve(project_path.parent, a)) for a in assets},
        "bitmaps": rep.bitmaps,
        "contagem_por_pagina": {str(k): v for k, v in rep.counts.items()},
        "avisos": rep.warnings,
    }
    if manifest_path:
        Path(manifest_path).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest
