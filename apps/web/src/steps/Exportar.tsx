import { useState } from "react";
import { useApp } from "../ctx";
import { download, exportPdf, slug } from "../lib/project-io";
import { pageSize, pendencias, ROLE_LABEL } from "../model";
import { PageFilter, PieceObjects } from "../render";

const PAGES: [PageFilter, string, string][] = [
  ["all", "1 · Arte completa", "Fundo e objetos nas posições finais"],
  ["fundo", "2 · Somente fundo", "Em registro com a página 1"],
  ["vetores", "3 · Todos os vetores", "Sem nenhum bitmap; textos em curvas"],
];

export default function Exportar() {
  const { doc, update, assets, toast } = useApp();
  const p = doc.project!;
  const [W, H] = pageSize(p);
  const [busy, setBusy] = useState("");
  const [man, setMan] = useState<any>(null);
  const pend = pendencias(p);
  const vetores = p.pieces.some((pc) => pc.objects.some((o) => o.visible && (o.type === "vector" || o.type === "text" || (o.type === "background" && o.kind === "vector"))));

  async function gerar() {
    setBusy("Preparando…"); setMan(null);
    try {
      const r = await exportPdf(doc, assets, setBusy);
      download(r.pdf, slug(p.name) + "-3-paginas.pdf");
      setMan(r.manifesto);
      toast(r.manifesto.estado === "rascunho" ? "PDF gerado como RASCUNHO (há pendências)" : "PDF gerado");
    } catch (e: any) { toast(e.message); } finally { setBusy(""); }
  }

  return (
    <section className="step exportar">
      <div className="pages">
        {PAGES.map(([f, t, d]) => (
          <figure key={f}>
            <figcaption><b>{t}</b><span>{d}</span></figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="sheet">
              <rect width={W} height={H} fill="#fff" />
              {p.pieces.map((pc) => <g key={pc.id}><PieceObjects pc={pc} assets={assets} filter={f} /></g>)}
            </svg>
          </figure>
        ))}
      </div>
      <aside className="side">
        <h2>PDF para o CorelDRAW</h2>
        <p className="hint">{(W).toFixed(1)} × {(H).toFixed(1)} mm · {p.pieces.length} peça(s): {p.pieces.map((pc) => ROLE_LABEL[pc.role]).join(", ")}</p>
        <label className="fld">Texto na página 1
          <select value={p.export.text_mode_page1} onChange={(e) => update((d) => ({ ...d, project: { ...d.project!, export: { ...d.project!.export, text_mode_page1: e.target.value as any } } }))}>
            <option value="texto">Texto editável (fonte incorporada)</option>
            <option value="curvas">Curvas (aparência garantida)</option>
          </select></label>
        <label className="fld">PPI mínimo para alerta
          <input type="number" min={50} max={600} value={p.export.min_ppi} onChange={(e) => update((d) => ({ ...d, project: { ...d.project!, export: { ...d.project!.export, min_ppi: +e.target.value || 150 } } }), true)} /></label>
        {!vetores && <p className="warn">A página 3 vai sair vazia: não há vetores nem textos.</p>}
        <h3>Pendências {pend.length ? `(${pend.length})` : ""}</h3>
        {pend.length ? <ul className="pend">{pend.slice(0, 12).map((x, i) => <li key={i}>{x}</li>)}{pend.length > 12 && <li>… e mais {pend.length - 12}</li>}</ul>
          : <p className="ok">Tudo aprovado. O PDF sai como versão final.</p>}
        {pend.length > 0 && <p className="hint small">Com pendências o PDF é gerado como RASCUNHO (marcado nas propriedades do arquivo).</p>}
        <button className="btn main" disabled={!!busy || !p.pieces.length} onClick={gerar}>{busy || "Gerar PDF de 3 páginas"}</button>
        <p className="hint small">O PDF é montado no seu navegador pelo mesmo exportador usado no servidor. Na primeira vez ele baixa o Python (~15 MB) e depois fica em cache.</p>
        {man && (<>
          <h3>Resultado</h3>
          <p className={man.estado === "rascunho" ? "warn" : "ok"}>Estado: {man.estado} · {man.pdf.tamanho_mm.join(" × ")} mm</p>
          {man.bitmaps.length > 0 && <table className="ppi"><thead><tr><th>Bitmap</th><th>Pixels</th><th>PPI efetivo</th></tr></thead>
            <tbody>{man.bitmaps.map((b: any) => <tr key={b.objeto}><td>{b.objeto}</td><td>{b.pixels.join("×")}</td><td>{b.ppi_efetivo.join(" × ")}</td></tr>)}</tbody></table>}
          {man.avisos.length > 0 && <ul className="pend">{man.avisos.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>}
        </>)}
        <details><summary>Como importar no CorelDRAW</summary>
          <ol><li>Arquivo › Importar, escolha o PDF e marque <b>todas as páginas</b>.</li>
            <li>Em “Importar texto como”, escolha <b>Texto</b> para editar ou <b>Curvas</b> para manter a aparência.</li>
            <li>Página 2 fica em registro com a 1; a página 3 só tem curvas (pronta para recorte/serigrafia).</li></ol></details>
      </aside>
    </section>
  );
}
