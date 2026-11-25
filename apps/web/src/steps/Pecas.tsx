import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx";
import { applyH, canvas, cropRect, homography, toBlob, warpQuad } from "../lib/image";
import { layoutPieces, Piece, PieceSource, Quad, ROLE_LABEL, Role, uid } from "../model";

const ROLES: Record<string, Role[]> = {
  camiseta: ["frente", "costas", "manga_esquerda", "manga_direita", "gola", "calcao", "meiao"],
  placa: ["placa"],
  livre: ["area"],
};
const DEFAULT_W: Partial<Record<Role, number>> = { frente: 300, costas: 300, manga_esquerda: 200, manga_direita: 200, gola: 420, calcao: 280, meiao: 160, placa: 1000, area: 300 };

const bitmapUrls = new Map<ImageBitmap, string>();
export function bitmapUrl(b: ImageBitmap) {
  let u = bitmapUrls.get(b);
  if (!u) { const [c, x] = canvas(b.width, b.height); x.drawImage(b, 0, 0); u = c.toDataURL("image/png"); bitmapUrls.set(b, u); }
  return u;
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const geomKey = (s: PieceSource, pc: Piece) => JSON.stringify([s.originalId, s.rect, s.quad, s.outline, pc.width_mm, pc.height_mm]);

/** Gera (ou reaproveita) o recorte em pixels de cada peça. */
export async function buildRasters(doc: any, assets: Map<string, Blob>, originals: Map<string, ImageBitmap>) {
  const sources: PieceSource[] = [];
  for (const s of doc.app.sources as PieceSource[]) {
    const pc = doc.project.pieces.find((p: Piece) => p.id === s.pieceId);
    const bmp = originals.get(s.originalId);
    if (!pc || !bmp) continue;
    const key = geomKey(s, pc);
    if (s.raster && assets.has(s.raster) && (s as any).key === key) { sources.push(s); continue; }
    let c: HTMLCanvasElement;
    if (s.quad) {
      const top = (dist(s.quad[0], s.quad[1]) + dist(s.quad[3], s.quad[2])) / 2;
      const outW = Math.min(3000, Math.round(top)), outH = Math.round(outW * pc.height_mm / pc.width_mm);
      c = warpQuad(bmp, s.quad, outW, outH);
    } else {
      const r = s.rect!;
      c = cropRect(bmp, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    }
    if (s.outline && s.outline.length > 2) { // descarta o que está fora da roupa (estádio, gramado, etiquetas)
      const map = s.quad
        ? ((H) => (q: number[]) => applyH(H, q[0], q[1]))(homography(s.quad, [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]]))
        : (q: number[]) => [q[0] - Math.round(s.rect!.x), q[1] - Math.round(s.rect!.y)];
      const x = c.getContext("2d")!;
      x.save(); x.globalCompositeOperation = "destination-in"; x.beginPath();
      s.outline.map(map).forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])));
      x.closePath(); x.fill(); x.restore();
    }
    const name = `recortes/${pc.id}.png`;
    assets.set(name, await toBlob(c));
    sources.push({ ...s, raster: name, pxW: c.width, pxH: c.height, key } as PieceSource);
  }
  return sources;
}

export default function Pecas({ onDone }: { onDone: () => void }) {
  const { doc, update, originals, toast, assets } = useApp();
  const p = doc.project!;
  const [origId, setOrigId] = useState(p.originals[0]?.id);
  const [pending, setPending] = useState<{ role: Role; tool: "rect" | "quad" } | null>(null);
  const [draft, setDraft] = useState<{ a?: number[]; b?: number[]; pts: number[][] }>({ pts: [] });
  const [sel, setSel] = useState<string | null>(p.pieces[0]?.id ?? null);
  const [persp, setPersp] = useState(p.mode === "placa");
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pieceId: string; corner: number; start: number[] } | null>(null);
  const [outlining, setOutlining] = useState<string | null>(null); // id da peça sendo contornada
  const outlinePts = useRef<number[][] | null>(null);
  const [, setTick] = useState(0);
  const bmp = origId ? originals.get(origId) : undefined;
  const W = bmp?.width || 1, H = bmp?.height || 1, hs = Math.max(W, H) / 90;

  useEffect(() => { if (!origId && p.originals[0]) setOrigId(p.originals[0].id); }, [p.originals, origId]);

  const pt = (e: React.PointerEvent | PointerEvent) => {
    const s = svg.current!, m = s.getScreenCTM()!.inverse(), q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [Math.max(0, Math.min(W, q.x)), Math.max(0, Math.min(H, q.y))];
  };

  function addPiece(role: Role, src: Omit<PieceSource, "pieceId">) {
    const id = uid("pc"), wmm = DEFAULT_W[role] || 300;
    let ratio = 1;
    if (src.rect) ratio = src.rect.h / src.rect.w;
    if (src.quad) { const q = src.quad; ratio = ((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) / ((dist(q[0], q[1]) + dist(q[3], q[2])) / 2); }
    const piece: Piece = { id, role, width_mm: wmm, height_mm: Math.round(wmm * ratio * 10) / 10, page_x_mm: 0, page_y_mm: 0, bleed_mm: 0, objects: [] };
    update((d) => ({ project: layoutPieces({ ...d.project!, pieces: [...d.project!.pieces, piece] }), app: { ...d.app, sources: [...d.app.sources, { ...src, pieceId: id }] } }));
    setSel(id);
  }

  function down(e: React.PointerEvent) {
    if (outlining) { outlinePts.current = [pt(e)]; (e.target as Element).setPointerCapture?.(e.pointerId); setTick((t) => t + 1); return; }
    if (!pending) return;
    const q = pt(e);
    if (pending.tool === "rect") { setDraft({ a: q, b: q, pts: [] }); (e.target as Element).setPointerCapture?.(e.pointerId); }
    else {
      const pts = [...draft.pts, q];
      if (pts.length === 4) { addPiece(pending.role, { originalId: origId!, quad: orderQuad(pts) }); setPending(null); setDraft({ pts: [] }); }
      else setDraft({ pts });
    }
  }
  function move(e: React.PointerEvent) {
    if (outlining && outlinePts.current) { const q = pt(e), l = outlinePts.current[outlinePts.current.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > W / 300) { outlinePts.current.push(q); setTick((t) => t + 1); } return; }
    if (drag.current) return moveHandle(e);
    if (pending?.tool === "rect" && draft.a) setDraft({ ...draft, b: pt(e) });
  }
  function up() {
    if (outlining && outlinePts.current) {
      const pts = outlinePts.current; outlinePts.current = null;
      if (pts.length > 4) update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === outlining ? { ...s, outline: pts } : s)) } }));
      setOutlining(null); return;
    }
    if (drag.current) { drag.current = null; return; }
    if (pending?.tool === "rect" && draft.a && draft.b) {
      const x = Math.min(draft.a[0], draft.b[0]), y = Math.min(draft.a[1], draft.b[1]), w = Math.abs(draft.a[0] - draft.b[0]), h = Math.abs(draft.a[1] - draft.b[1]);
      if (w > 8 && h > 8) addPiece(pending.role, { originalId: origId!, rect: { x, y, w, h } });
      setPending(null); setDraft({ pts: [] });
    }
  }
  function startHandle(e: React.PointerEvent, pieceId: string, corner: number) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    update((d) => d); // ponto de desfazer
    drag.current = { pieceId, corner, start: pt(e) };
  }
  function moveHandle(e: React.PointerEvent) {
    const g = drag.current!, q = pt(e);
    update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => {
      if (s.pieceId !== g.pieceId) return s;
      if (s.quad) { const quad = s.quad.map((c, i) => (i === g.corner ? q : c)) as Quad; return { ...s, quad }; }
      const r = s.rect!, x1 = r.x + r.w, y1 = r.y + r.h;
      let nx = r.x, ny = r.y, nx1 = x1, ny1 = y1;
      if (g.corner === 0 || g.corner === 3) nx = Math.min(q[0], x1 - 8); else nx1 = Math.max(q[0], r.x + 8);
      if (g.corner === 0 || g.corner === 1) ny = Math.min(q[1], y1 - 8); else ny1 = Math.max(q[1], r.y + 8);
      return { ...s, rect: { x: nx, y: ny, w: nx1 - nx, h: ny1 - ny } };
    }) } }), true);
  }

  function setPiece(id: string, patch: Partial<Piece>) {
    update((d) => ({ ...d, project: layoutPieces({ ...d.project!, pieces: d.project!.pieces.map((pc) => (pc.id === id ? { ...pc, ...patch } : pc)) }) }));
  }
  function removePiece(id: string) {
    update((d) => ({ project: layoutPieces({ ...d.project!, pieces: d.project!.pieces.filter((pc) => pc.id !== id) }), app: { ...d.app, sources: d.app.sources.filter((s) => s.pieceId !== id) } }));
  }
  function ratioOf(id: string) {
    const s = doc.app.sources.find((x) => x.pieceId === id);
    if (s?.rect) return s.rect.h / s.rect.w;
    if (s?.quad) { const q = s.quad; return ((dist(q[0], q[3]) + dist(q[1], q[2])) / 2) / ((dist(q[0], q[1]) + dist(q[3], q[2])) / 2); }
    return 1;
  }

  const dupRoles = useMemo(() => {
    const c: Record<string, number> = {};
    p.pieces.forEach((pc) => (c[pc.role] = (c[pc.role] || 0) + 1));
    return Object.entries(c).filter(([r, n]) => n > 1 && r !== "area").map(([r]) => ROLE_LABEL[r as Role]);
  }, [p.pieces]);

  async function next() {
    if (!p.pieces.length) return toast("Marque pelo menos uma peça");
    setBusy(true);
    try {
      const sources = await buildRasters(doc, assets, originals);
      update((d) => ({ ...d, app: { ...d.app, sources } }));
      onDone();
    } catch (e: any) { toast(e.message); } finally { setBusy(false); }
  }

  const srcs = doc.app.sources.filter((s) => s.originalId === origId);
  return (
    <section className="step pecas">
      <div className="canvasbox">
        <div className="bar">
          {p.originals.length > 1 && (
            <select value={origId} onChange={(e) => setOrigId(e.target.value)} aria-label="Imagem">
              {p.originals.map((o, i) => <option key={o.id} value={o.id}>Imagem {i + 1}</option>)}
            </select>
          )}
          <span className="lbl">Marcar:</span>
          {ROLES[p.mode].map((r) => (
            <button key={r} className={pending?.role === r ? "on" : ""} onClick={() => { setPending({ role: r, tool: persp ? "quad" : "rect" }); setDraft({ pts: [] }); }}>+ {ROLE_LABEL[r]}</button>
          ))}
          <label className="chk"><input type="checkbox" checked={persp} onChange={(e) => setPersp(e.target.checked)} /> 4 cantos (perspectiva)</label>
        </div>
        <p className="hint">{outlining ? "Contorne a roupa arrastando o mouse rente à borda. O que ficar fora (estádio, gramado, etiquetas) é descartado." : pending ? (pending.tool === "rect" ? `Arraste um retângulo sobre ${ROLE_LABEL[pending.role].toLowerCase()}.` : `Clique os 4 cantos de ${ROLE_LABEL[pending.role].toLowerCase()} (${draft.pts.length}/4), em qualquer ordem.`)
          : p.mode === "camiseta" ? "Dica: quando o mockup já mostra as mangas, use os painéis de manga isolados como fonte e trate as mangas do mockup só como referência — assim nada sai duplicado." : "Escolha a peça e marque a área na imagem. Arraste os cantos para ajustar."}</p>
        {bmp && (
          <svg ref={svg} className={"stage-svg" + (pending || outlining ? " drawing" : "")} viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
            <image href={bitmapUrl(bmp)} width={W} height={H} />
            {srcs.map((s) => {
              const pc = p.pieces.find((x) => x.id === s.pieceId); if (!pc) return null;
              const poly: number[][] = s.quad ? s.quad : [[s.rect!.x, s.rect!.y], [s.rect!.x + s.rect!.w, s.rect!.y], [s.rect!.x + s.rect!.w, s.rect!.y + s.rect!.h], [s.rect!.x, s.rect!.y + s.rect!.h]];
              const on = sel === pc.id;
              return (
                <g key={s.pieceId} className={"pc" + (on ? " on" : "")} onPointerDown={(e) => { if (!pending && !outlining) { e.stopPropagation(); setSel(pc.id); } }}>
                  <polygon points={poly.map((q) => q.join(",")).join(" ")} />
                  <text x={poly[0][0] + hs} y={poly[0][1] + hs * 2.2} fontSize={hs * 1.8}>{ROLE_LABEL[pc.role]}</text>
                  {on && poly.map((q, i) => <rect key={i} className="hd" x={q[0] - hs / 2} y={q[1] - hs / 2} width={hs} height={hs} onPointerDown={(e) => startHandle(e, pc.id, i)} />)}
                </g>
              );
            })}
            {srcs.filter((s) => s.outline).map((s) => <polygon key={"o" + s.pieceId} className="outline" points={s.outline!.map((q) => q.join(",")).join(" ")} />)}
            {outlinePts.current && <polyline className="draft" points={outlinePts.current.map((q) => q.join(",")).join(" ")} />}
            {draft.a && draft.b && <rect className="draft" x={Math.min(draft.a[0], draft.b[0])} y={Math.min(draft.a[1], draft.b[1])} width={Math.abs(draft.a[0] - draft.b[0])} height={Math.abs(draft.a[1] - draft.b[1])} />}
            {draft.pts.length > 0 && <polyline className="draft" points={draft.pts.map((q) => q.join(",")).join(" ")} />}
            {draft.pts.map((q, i) => <circle key={i} className="draftpt" cx={q[0]} cy={q[1]} r={hs / 1.5} />)}
          </svg>
        )}
      </div>
      <aside className="side">
        <h2>Peças físicas</h2>
        {!p.pieces.length && <p className="hint">Nenhuma peça ainda. Use os botões “+” acima da imagem.</p>}
        {dupRoles.length > 0 && <p className="warn">Papel repetido: {dupRoles.join(", ")}. Confira se não há manga duplicada.</p>}
        {p.pieces.map((pc) => (
          <div key={pc.id} className={"card" + (sel === pc.id ? " on" : "")} onClick={() => setSel(pc.id)}>
            <div className="row">
              <select value={pc.role} onChange={(e) => setPiece(pc.id, { role: e.target.value as Role })} aria-label="Papel da peça">
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button className="x" onClick={(e) => { e.stopPropagation(); removePiece(pc.id); }} aria-label="Remover peça">✕</button>
            </div>
            <div className="row nums">
              <label>Largura<input type="number" min={1} step={1} value={pc.width_mm} onChange={(e) => { const w = +e.target.value || 1; setPiece(pc.id, { width_mm: w, height_mm: Math.round(w * ratioOf(pc.id) * 10) / 10 }); }} /><span>mm</span></label>
              <label>Altura<input type="number" min={1} step={1} value={pc.height_mm} onChange={(e) => setPiece(pc.id, { height_mm: +e.target.value || 1 })} /><span>mm</span></label>
              <label>Sangria<input type="number" min={0} step={0.5} value={pc.bleed_mm} onChange={(e) => setPiece(pc.id, { bleed_mm: Math.max(0, +e.target.value) })} /><span>mm</span></label>
            </div>
            <p className="hint small">{doc.app.sources.find((s) => s.pieceId === pc.id)?.quad ? "Perspectiva corrigida pelos 4 cantos." : "Recorte retangular."} Mudar a largura ajusta a altura na proporção marcada.</p>
            <div className="row">
              <button className={outlining === pc.id ? "on" : ""} onClick={(e) => { e.stopPropagation(); setSel(pc.id); setPending(null); setOutlining(outlining === pc.id ? null : pc.id); }}>
                {doc.app.sources.find((s) => s.pieceId === pc.id)?.outline ? "Refazer contorno da peça" : "Contornar a peça"}</button>
              {doc.app.sources.find((s) => s.pieceId === pc.id)?.outline && <button onClick={(e) => { e.stopPropagation(); update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === pc.id ? { ...s, outline: undefined } : s)) } })); }}>Remover contorno</button>}
            </div>
          </div>
        ))}
        <button className="btn main" disabled={busy || !p.pieces.length} onClick={next}>{busy ? "Gerando recortes…" : "Separar as peças →"}</button>
      </aside>
    </section>
  );
}

/** Ordena 4 pontos clicados em qualquer ordem: sup.esq, sup.dir, inf.dir, inf.esq. */
function orderQuad(pts: number[][]): Quad {
  const c = [pts.reduce((a, p) => a + p[0], 0) / 4, pts.reduce((a, p) => a + p[1], 0) / 4];
  const s = [...pts].sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  // começa pelo de menor x+y (superior esquerdo)
  let k = 0; s.forEach((p, i) => { if (p[0] + p[1] < s[k][0] + s[k][1]) k = i; });
  return [0, 1, 2, 3].map((i) => s[(k + i) % 4] as [number, number]) as Quad;
}
