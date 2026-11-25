"""Testes do contrato do PDF de 3 páginas (etapa 1 do plano)."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
import pytest
from fontTools.ttLib import TTFont
from pypdf import PdfReader
from pypdf.generic import ContentStream

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))
import make_fixture  # noqa: E402

from vizuvetor_worker import svgpath  # noqa: E402
from vizuvetor_worker.export_pdf import ExportError, export  # noqa: E402

TEXT_OPS = {b"Tj", b"TJ", b"'", b'"'}  # operadores que escrevem texto
TEXTOS = ["Família de Légua", "Salve o povo de Légua", "Vó Maria Conga", "Sete Flechas"]
PT = 72 / 25.4


@pytest.fixture()
def proj(tmp_path):
    make_fixture.build()
    dst = tmp_path / "fixtures"
    shutil.copytree(ROOT / "tests" / "fixtures", dst, ignore=shutil.ignore_patterns("__pycache__"))
    return dst / "camiseta_sintetica" / "projeto.json"


def _edit(p: Path, fn):
    d = json.loads(p.read_text(encoding="utf-8"))
    fn(d)
    p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


def _run(proj, tmp_path, name="out.pdf"):
    out = tmp_path / name
    man = export(proj, out, tmp_path / (name + ".json"))
    return out, man


def _images_recursive(res, seen=None) -> int:
    """Conta XObjects de imagem, inclusive dentro de Form XObjects aninhados."""
    seen = seen if seen is not None else set()
    n = 0
    if not res or "/XObject" not in res:
        return 0
    for _, ref in res["/XObject"].items():
        obj = ref.get_object()
        key = id(obj)
        if key in seen:
            continue
        seen.add(key)
        if obj.get("/Subtype") == "/Image":
            n += 1
        elif obj.get("/Subtype") == "/Form":
            n += _images_recursive(obj.get("/Resources"), seen)
    return n


def _ops(reader, page):
    cs = ContentStream(page.get_contents(), reader)
    return [op for _, op in cs.operations]


def _render(pdf, i, scale=2.0):
    doc = pdfium.PdfDocument(str(pdf))
    return np.asarray(doc[i].render(scale=scale).to_pil().convert("RGB")).astype(int)


def _px(img, x_mm, y_mm, scale=2.0):
    return img[int(y_mm * PT * scale), int(x_mm * PT * scale)]


# ---------- estrutura ----------
def test_tres_paginas_rotulos_e_tamanho_fisico(proj, tmp_path):
    out, man = _run(proj, tmp_path)
    r = PdfReader(out)
    assert len(r.pages) == 3
    assert [r.page_labels[i] for i in range(3)] == ["Arte completa", "Fundo", "Vetores"]
    for p in r.pages:  # 2 peças de 250 mm + 20 mm de espaço = 520 x 300 mm
        assert float(p.mediabox.width) / PT == pytest.approx(520, abs=0.01)
        assert float(p.mediabox.height) / PT == pytest.approx(300, abs=0.01)
    assert man["pdf"]["tamanho_mm"] == [520.0, 300.0]


def test_pagina3_sem_nenhuma_imagem(proj, tmp_path):
    out, _ = _run(proj, tmp_path)
    r = PdfReader(out)
    p3 = r.pages[2]
    assert _images_recursive(p3.get("/Resources")) == 0
    ops = _ops(r, p3)
    assert b"BI" not in ops and b"INLINE IMAGE" not in ops and b"Do" not in ops
    assert not set(ops) & TEXT_OPS  # textos viraram curvas


def test_pagina1_objetos_independentes(proj, tmp_path):
    out, man = _run(proj, tmp_path)
    r = PdfReader(out)
    p1 = r.pages[0]
    assert _images_recursive(p1.get("/Resources")) == 3  # 2 fundos + personagem
    imgs = [o.get_object() for o in p1["/Resources"]["/XObject"].values()]
    assert any("/SMask" in i for i in imgs), "o personagem precisa de máscara alfa"
    ops = _ops(r, p1)
    assert ops.count(b"q") >= 9 and ops.count(b"Q") == ops.count(b"q")  # cada objeto isolado
    texto = p1.extract_text()
    for t in TEXTOS:
        assert t in texto, f"texto com acento ausente: {t}"
    fontes = [f.get_object() for f in p1["/Resources"]["/Font"].values()]
    usadas = [f for f in fontes if "DejaVuSans-Bold" in str(f.get("/BaseFont"))]
    assert usadas, "fonte do projeto não está no PDF"
    for f in usadas:  # fonte incorporada (subconjunto TrueType)
        desc = f["/DescendantFonts"][0].get_object() if "/DescendantFonts" in f else f
        assert "/FontFile2" in desc["/FontDescriptor"].get_object()
    assert man["contagem_por_pagina"]["1"]["texto_vivo"] == 4


def test_pagina2_so_fundo(proj, tmp_path):
    out, man = _run(proj, tmp_path)
    r = PdfReader(out)
    p2 = r.pages[1]
    ops = _ops(r, p2)
    assert not set(ops) & TEXT_OPS
    assert not any(o in ops for o in (b"f", b"f*", b"B", b"B*"))
    assert _images_recursive(p2.get("/Resources")) == 2
    assert man["contagem_por_pagina"]["2"] == {"imagens": 2}


def test_sem_fontes_fantasma(proj, tmp_path):
    """Nenhuma página referencia fonte que não usa (evita aviso de fonte ausente no Corel)."""
    out, _ = _run(proj, tmp_path)
    r = PdfReader(out)
    for i, p in enumerate(r.pages):
        fonts_ = p["/Resources"].get("/Font", {})
        names = [str(f.get_object().get("/BaseFont")) for f in fonts_.values()]
        assert not any("Helvetica" in n for n in names), f"pág. {i + 1}: {names}"
    assert "/Font" not in r.pages[1]["/Resources"] and "/Font" not in r.pages[2]["/Resources"]
    assert "Família de Légua" in r.pages[0].extract_text()


# ---------- visual ----------
def test_registro_e_transparencia(proj, tmp_path):
    out, _ = _run(proj, tmp_path)
    p1, p2 = _render(out, 0), _render(out, 1)
    # área só de fundo (fora da moldura) idêntica nas págs. 1 e 2
    assert np.abs(_px(p1, 4, 150) - _px(p2, 4, 150)).max() <= 2
    # canto transparente do personagem (65+3, 75+3 mm) deixa ver o fundo
    assert np.abs(_px(p1, 68, 78) - _px(p2, 68, 78)).max() <= 3
    # miolo do personagem é opaco (corpo claro)
    assert _px(p1, 125, 190).min() > 200


def test_furo_da_moldura_na_pagina3(proj, tmp_path):
    out, _ = _run(proj, tmp_path)
    p3 = _render(out, 2)
    assert tuple(_px(p3, 13, 150)) == pytest.approx((138, 28, 28), abs=3)  # aro
    assert _px(p3, 40, 150).min() >= 250  # furo vazado = papel branco


def test_texto_vivo_e_curvas_em_registro(proj, tmp_path):
    vivo, _ = _run(proj, tmp_path, "vivo.pdf")
    _edit(proj, lambda d: d["export"].update(text_mode_page1="curvas"))
    curvas, man = _run(proj, tmp_path, "curvas.pdf")
    sc = 6
    s = sc * PT
    crop = (slice(int(15 * s), int(35 * s)), slice(int(60 * s), int(190 * s)))  # título da frente
    mask = lambda img: img[crop].sum(axis=2) < 120  # só a tinta do título (#1a1a1a)  # noqa: E731
    a, b, c3 = (mask(_render(f, i, sc)) for f, i in ((vivo, 0), (curvas, 0), (vivo, 2)))

    def centro(m):
        ys, xs = np.nonzero(m)
        return np.array([xs.mean(), ys.mean()]) / s  # em mm

    # texto vivo x texto em curvas: deslocamento < 0,15 mm e mesma área de tinta (±2%)
    assert np.abs(centro(a) - centro(b)).max() < 0.15
    assert abs(a.sum() - b.sum()) / b.sum() < 0.02
    # pág. 3 (curvas) coincide com a pág. 1 em modo curvas
    assert np.abs(centro(b) - centro(c3)).max() < 0.02 and (b ^ c3).mean() < 0.002
    assert not set(_ops(PdfReader(curvas), PdfReader(curvas).pages[0])) & TEXT_OPS


# ---------- estado, avisos, entradas inválidas ----------
def test_rascunho_quando_nao_aprovado(proj, tmp_path):
    _edit(proj, lambda d: d["pieces"][0]["objects"][0].update(status="rascunho"))
    out, man = _run(proj, tmp_path)
    assert man["estado"] == "rascunho"
    assert PdfReader(out).metadata["/Subject"] == "RASCUNHO"
    assert any("rascunho" in w for w in man["avisos"])


def test_ppi_baixo_gera_aviso(proj, tmp_path):
    _edit(proj, lambda d: d["export"].update(min_ppi=300))
    _, man = _run(proj, tmp_path)
    assert man["bitmaps"][0]["ppi_efetivo"] == [150.0, 150.0]
    assert any("PPI efetivo" in w for w in man["avisos"])


def test_pagina3_vazia_ainda_tem_tres_paginas(proj, tmp_path):
    def so_bitmaps(d):
        for pc in d["pieces"]:
            pc["objects"] = [o for o in pc["objects"] if o["type"] in ("background", "bitmap")]
    _edit(proj, so_bitmaps)
    out, man = _run(proj, tmp_path)
    assert len(PdfReader(out).pages) == 3
    assert any("Página 3 vazia" in w for w in man["avisos"])


def test_fonte_restrita_vira_curvas(proj, tmp_path):
    fdir = proj.parent.parent / "fonts"
    f = TTFont(fdir / "DejaVuSans-Bold.ttf")
    f["OS/2"].fsType = 0x0002
    f.save(fdir / "Restrita.ttf")
    _edit(proj, lambda d: d["pieces"][1]["objects"][2].update(font_path="../fonts/Restrita.ttf"))
    out, man = _run(proj, tmp_path)
    assert any("não permite incorporação" in w for w in man["avisos"])
    assert "Vó Maria Conga" not in PdfReader(out).pages[0].extract_text()


@pytest.mark.parametrize("mut,msg", [
    (lambda d: d["pieces"][0]["objects"][3].update(asset="nao_existe.png"), "não encontrado"),
    (lambda d: d["pieces"][0]["objects"][1]["paths"][0].update(d="M0 0A5 5 0 0 1 10 10Z"), "arcos"),
    (lambda d: d["pieces"][0]["objects"][4].update(content="Família 漢"), "não tem os caracteres"),
    (lambda d: d["pieces"][1]["objects"][1].update(id="frente-moldura"), "repetido"),
    (lambda d: d.update(unit="cm"), "Projeto inválido"),
])
def test_entradas_invalidas(proj, tmp_path, mut, msg):
    _edit(proj, mut)
    with pytest.raises(ExportError, match=msg):
        _run(proj, tmp_path)


def test_imagem_corrompida(proj, tmp_path):
    (proj.parent / "personagem.png").write_bytes(b"isto nao e png")
    with pytest.raises(ExportError, match="Imagem inválida"):
        _run(proj, tmp_path)


def test_sangria_define_trimbox_e_bleedbox(proj, tmp_path):
    def uma_peca(d):
        d["pieces"] = d["pieces"][:1]
        d["pieces"][0].update(bleed_mm=3, page_x_mm=3, page_y_mm=3)
        d["export"].update(page_margin_mm=0)
    _edit(proj, uma_peca)
    out, _ = _run(proj, tmp_path)
    p = PdfReader(out).pages[0]
    assert float(p.mediabox.width) / PT == pytest.approx(256, abs=0.01)
    assert float(p.trimbox.width) / PT == pytest.approx(250, abs=0.01)
    assert float(p.bleedbox.width) / PT == pytest.approx(256, abs=0.01)


# ---------- leitor de caminhos ----------
def test_svgpath_relativos_e_quadraticas():
    segs = svgpath.parse("m10 10 h5 v5 l-5 0 z M0 0 Q10 0 10 10 T20 20")
    assert segs[0] == ("M", 10, 10) and segs[1] == ("L", 15, 10) and segs[2] == ("L", 15, 15)
    assert segs[4] == ("Z",)
    assert segs[6][0] == "C" and segs[6][-2:] == (10, 10)
    assert segs[7][0] == "C" and segs[7][-2:] == (20, 20)
    with pytest.raises(svgpath.PathError):
        svgpath.parse("L10 10")
    with pytest.raises(svgpath.PathError):
        svgpath.parse("M0 0 X")


def test_posicionamento_sem_harfbuzz_igual(monkeypatch):
    """No navegador (Pyodide) não há HarfBuzz: o fallback do fontTools dá as mesmas posições."""
    from vizuvetor_worker import fonts

    f = str(ROOT / "tests" / "fixtures" / "fonts" / "DejaVuSans-Bold.ttf")
    decomposta = "Fami\u0301lia de Le\u0301gua"  # acentos combinantes -> NFC
    com = [fonts.shape(f, t, 40, 1.5) for t in TEXTOS + [decomposta]]
    monkeypatch.setattr(fonts, "hb", None)
    sem = [fonts.shape(f, t, 40, 1.5) for t in TEXTOS + [decomposta]]
    for (ga, wa), (gb, wb) in zip(com, sem):
        assert [g[0] for g in ga] == [g[0] for g in gb]
        assert wa == pytest.approx(wb, abs=1e-6)
        assert all(abs(a[1] - b[1]) < 1e-6 for a, b in zip(ga, gb))
    assert com[0] == com[-1]  # decomposto e composto ficam iguais
