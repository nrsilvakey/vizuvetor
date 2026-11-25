import { useEffect, useRef, useState } from "react";
import { assetUrl, useApp } from "../ctx";
import { canvas, decode, toBlob } from "../lib/image";
import { cutObject, illustrationBackground, separatePiece } from "../lib/separate";
import { ART_LABEL, ArtType, EngineSettings, Obj, ROLE_LABEL } from "../model";
import { PieceObjects } from "../render";

type Tool = "laco" | "caixa" | "pincel";
const BRUSH = [[1, "Vetor", "#e4003a"], [2, "Imagem", "#1f9d55"], [3, "Fundo", "#2f7df6"], [0, "Apagar correção", "#888"]] as const;
const COLORS = ["", "rgba(228,0,58,.45)", "rgba(31,157,85,.45)", "rgba(47,125,246,.45)"];
const maps = new Map<string, Uint8Array>(); // correções de pincel em memória por peça

export default function Separar({ onDone }: { onDone: () => void }) {
  const { doc, update, assets, toast, bump } = useApp();
  const p = doc.project!;
  const [pid, setPid] = useState(p.pieces[0]?.id);
  const pc = p.pieces.find((x) => x.id === pid)!;
  const src = doc.app.sources.find((s) => s.pieceId === pid);
  const art: ArtType = src?.artType || "cores";
  const S = doc.app.settings;
  const [tool, setTool] = useState<Tool>(art === "ilustracao" ? "laco" : "pincel");
  const [brush, setBrush] = useState<number>(1);
  const [size, setSize] = useState(30);
  const [cutName, setCutName] = useState("Imagem principal");
  const [busy, setBusy] = useState("");
  const [stats, setStats] = useState<Record<string, any>>({});
  const [ras, setRas] = useState<ImageBitmap | null>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ pts: number[][] } | null>(null);
  const painting = useRef(false);
  const dirty = useRef(false);

  useEffect(() => { setTool(art === "ilustracao" ? "laco" : "pincel"); }, [pid, art]);
  useEffect(() => {
    let live = true;
    (async () => {
      setRas(null);
      if (!src?.raster) return;
      const b = await decode(assets.get(src.raster)!);
      if (!live) return;
      if (!maps.has(pid) && src.forceMap && assets.has(src.forceMap)) {
        const m = await decode(assets.get(src.forceMap)!), [c, x] = canvas(m.width, m.height);
        x.drawImage(m, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data, F = new Uint8Array(c.width * c.height);
        for (let i = 0; i < F.length; i++) F[i] = Math.round(d[i * 4] / 60);
        if (c.width === b.width && c.height === b.height) maps.set(pid, F);
      }
      setRas(b);
    })();
    return () => { live = false; };
  }, [pid, src?.raster]);
  useEffect(() => { drawOverlay(); }, [ras, tool]);

  // ---------- desenho na sobreposição ----------
  function drawOverlay(extra?: number[][], box = false) {
    const c = ov.current; if (!c || !ras) return;
    c.width = ras.width; c.height = ras.height;
    const x = c.getContext("2d")!;
    if (tool === "pincel") {
      const F = maps.get(pid), id = x.createImageData(c.width, c.height);
      if (F) for (let i = 0; i < F.length; i++) if (F[i]) { const col = [0, [228, 0, 58], [31, 157, 85], [47, 125, 246]][F[i]] as number[]; id.data.set([col[0], col[1], col[2], 115], i * 4); }
      x.putImageData(id, 0, 0);
    }
    if (extra && extra.length > 1) {
      x.lineWidth = Math.max(2, ras.width / 300); x.strokeStyle = "#00c8ff"; x.fillStyle = "rgba(0,200,255,.12)";
      x.beginPath();
      if (box) { const [a, b] = [extra[0], extra[extra.length - 1]]; x.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      else { x.moveTo(extra[0][0], extra[0][1]); for (const q of extra) x.lineTo(q[0], q[1]); x.closePath(); }
      x.fill(); x.stroke();
    }
  }
  const toPx = (e: React.PointerEvent) => { const c = ov.current!, r = c.getBoundingClientRect(), s = c.width / r.width; return [(e.clientX - r.left) * s, (e.clientY - r.top) * s]; };

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === "pincel") { painting.current = true; paint(e); return; }
    drawing.current = { pts: [toPx(e)] };
  }
  function move(e: React.PointerEvent) {
    if (tool === "pincel") return paint(e);
    if (!drawing.current) return;
    const q = toPx(e), pts = drawing.current.pts;
    if (tool === "caixa") { pts[1] = q; drawOverlay(pts, true); return; }
    const last = pts[pts.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 3) { pts.push(q); drawOverlay(pts); }
  }
  async function up() {
    if (tool === "pincel") { painting.current = false; persistMap(); return; }
    const g = drawing.current; drawing.current = null;
    if (!g || !ras) return;
    let poly = g.pts;
    if (tool === "caixa") { if (poly.length < 2) return drawOverlay(); const [a, b] = [poly[0], poly[1]]; poly = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
    if (poly.length < 3) return drawOverlay();
    await doCut(poly, tool === "laco");
  }
  function paint(e: React.PointerEvent) {
    if (!painting.current || !ras) return;
    const c = ov.current!, [cx, cy] = toPx(e), rad = (size / 2) * (c.width / c.getBoundingClientRect().width);
    let F = maps.get(pid);
    if (!F) { F = new Uint8Array(c.width * c.height); maps.set(pid, F); }
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(c.height, cy + rad); y++)
      for (let xx = Math.max(0, Math.floor(cx - rad)); xx < Math.min(c.width, cx + rad); xx++)
        if ((xx - cx) ** 2 + (y - cy) ** 2 <= rad * rad) F[y * c.width + xx] = brush;
    const x = c.getContext("2d")!;
    x.save(); x.globalCompositeOperation = "copy"; x.beginPath(); x.arc(cx, cy, rad, 0, 7); x.clip();
    x.fillStyle = brush ? COLORS[brush] : "rgba(0,0,0,0)"; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); x.restore();
    dirty.current = true;
  }
  async function persistMap() {
    if (!dirty.current || !ras) return;
    dirty.current = false;
    const F = maps.get(pid)!, [c, x] = canvas(ras.width, ras.height), id = x.createImageData(c.width, c.height);
    for (let i = 0; i < F.length; i++) { id.data[i * 4] = F[i] * 60; id.data[i * 4 + 3] = 255; }
    x.putImageData(id, 0, 0);
    const name = `correcoes/${pid}.png`;
    assets.set(name, await toBlob(c));
    setSrc({ forceMap: name });
  }
  function setSrc(patch: Record<string, any>) { update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === pid ? { ...s, ...patch } : s)) } })); }
  function clearMap() { maps.delete(pid); drawOverlay(); setSrc({ forceMap: undefined }); }

  // ---------- recorte de objeto ----------
  async function doCut(poly: number[][], tight: boolean) {
    if (!ras) return;
    setBusy("Recortando…");
    try {
      const maxZ = Math.max(0, ...pc.objects.map((o) => o.z));
      const r = await cutObject({ pieceId: pid, raster: ras, poly, tight, widthMm: pc.width_mm, heightMm: pc.height_mm, name: cutName || "Recorte", z: maxZ + 10 });
      for (const [k, v] of r.assets) assets.set(k, v);
      const cuts = [...(src?.cuts || []), { objId: r.obj.id, mask: r.maskName }];
      update((d) => ({
        project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pid ? { ...x, objects: [...x.objects, r.obj] } : x)) },
        app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === pid ? { ...s, cuts } : s)) },
      }));
      toast(`"${r.obj.name}" recortado (confiança ${Math.round((r.obj.confidence || 0) * 100)}%)`);
      if (art === "ilustracao") await rebuildBackground(cuts);
    } catch (e: any) { toast(e.message); }
    finally { setBusy(""); drawOverlay(); bump(); }
  }
  async function rebuildBackground(cuts = src?.cuts || []) {
    if (!ras) return;
    setBusy("Refazendo o fundo por trás dos recortes…");
    const live = new Set(pc.objects.map((o) => o.id));
    const masks = [];
    for (const c of cuts) if ((live.has(c.objId) || cuts !== src?.cuts) && assets.has(c.mask)) masks.push(await decode(assets.get(c.mask)!));
    const r = await illustrationBackground({ pieceId: pid, raster: ras, widthMm: pc.width_mm, heightMm: pc.height_mm, cutMasks: masks });
    for (const [k, v] of r.assets) assets.set(k, v);
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pid ? { ...x, objects: [r.bg, ...x.objects.filter((o) => o.type !== "background")] } : x)) } }));
    setBusy(""); bump();
    if (r.method === "blocos" || r.method === "copia") toast("Fundo refeito por textura — confira antes de aprovar");
  }

  // ---------- separação automática ----------
  async function runCores(ids: string[]) {
    for (const id of ids) {
      const piece = p.pieces.find((x) => x.id === id)!, s = doc.app.sources.find((x) => x.pieceId === id);
      if (!s?.raster) continue;
      if ((s.artType || "cores") === "ilustracao") { if (id === pid) await rebuildBackground(); continue; }
      setBusy(`${ROLE_LABEL[piece.role]}: preparando…`);
      try {
        const r = await decode(assets.get(s.raster)!);
        const res = await separatePiece({ pieceId: id, raster: r, widthMm: piece.width_mm, heightMm: piece.height_mm, S, force: maps.get(id) || null,
          onProgress: (t) => setBusy(`${ROLE_LABEL[piece.role]}: ${t}`) });
        for (const k of [...assets.keys()]) if (k.startsWith(`pc-${id}-`) && !(s.cuts || []).some((c) => k.includes(c.objId))) assets.delete(k);
        for (const [k, v] of res.assets) assets.set(k, v);
        const keep = (o: Obj) => o.origin === "manual";
        update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === id ? { ...x, objects: [...x.objects.filter(keep), ...res.objects] } : x)) } }));
        setStats((st) => ({ ...st, [id]: res.stats }));
        if (res.stats.vetorPct < 0.35 && res.stats.cores > 12) toast(`${ROLE_LABEL[piece.role]} parece ilustração: experimente o tipo "Ilustração"`);
      } catch (e: any) { toast(`Erro ao separar ${ROLE_LABEL[piece.role]}: ${e.message}`); }
    }
    setBusy(""); bump();
  }
  function setS(patch: Partial<EngineSettings>) { update((d) => ({ ...d, app: { ...d.app, settings: { ...d.app.settings, ...patch } } }), true); }
  function setArt(a: ArtType) {
    setSrc({ artType: a });
    if (a === "ilustracao") update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pid ? { ...x, objects: x.objects.filter((o) => o.origin === "manual") } : x)) } }));
  }
  function approveAll() {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pid ? { ...x, objects: x.objects.map((o) => ({ ...o, approved: true, ...(o.type === "background" ? { status: "aprovado" as const } : {}) })) } : x)) } }));
    toast("Tudo desta peça aprovado");
  }

  const st = stats[pid];
  const has = pc?.objects.length > 0;
  const cutsHere = pc?.objects.filter((o) => (src?.cuts || []).some((c) => c.objId === o.id)) || [];
  return (
    <section className="step separar">
      <div className="canvasbox">
        <div className="bar">
          {p.pieces.map((x) => <button key={x.id} className={x.id === pid ? "on" : ""} onClick={() => setPid(x.id)}>{ROLE_LABEL[x.role]}{x.objects.length ? " ✓" : ""}</button>)}
        </div>
        <div className="twin">
          <figure>
            <figcaption>{tool === "pincel" ? "Recorte da peça · pinte para corrigir" : tool === "laco" ? "Contorne o objeto rente à borda (laço)" : "Arraste uma caixa em volta do objeto"}</figcaption>
            <div className="paint">
              {ras && src?.raster && <img src={assetUrl(assets, src.raster)} alt="Recorte da peça" />}
              <canvas ref={ov} onPointerDown={down} onPointerMove={move} onPointerUp={up} style={{ cursor: "crosshair" }} />
            </div>
          </figure>
          <figure>
            <figcaption>Resultado {has ? "" : "(ainda não separado)"}</figcaption>
            <div className="result chk">
              {pc && <svg viewBox={`${pc.page_x_mm} ${pc.page_y_mm} ${pc.width_mm} ${pc.height_mm}`}><PieceObjects pc={pc} assets={assets} /></svg>}
            </div>
          </figure>
        </div>
        {busy && <p className="busyline">{busy}</p>}
        {st && art === "cores" && <p className="hint">{st.cores} cores em vetor · {Math.round(st.vetorPct * 100)}% vetor · {Math.round(st.imagemPct * 100)}% imagem · {Math.round(st.fundoPct * 100)}% fundo · {(st.ms / 1000).toFixed(1)} s</p>}
      </div>
      <aside className="side">
        <h2>Tipo de arte</h2>
        <select value={art} onChange={(e) => setArt(e.target.value as ArtType)} aria-label="Tipo de arte">
          {(Object.keys(ART_LABEL) as ArtType[]).map((k) => <option key={k} value={k}>{ART_LABEL[k]}</option>)}
        </select>
        <p className="hint small">{art === "ilustracao"
          ? "Nada vira vetor sozinho. O fundo fica em bitmap; cada personagem/letreiro que você recortar vira um bitmap próprio, com o fundo refeito por trás. No editor, “Vetorizar uma cor” cria a versão em vetor de letreiros e faixas."
          : "Cores chapadas viram vetor por cor; degradês e texturas viram imagem; o fundo é reconhecido e refeito."}</p>

        <h2>Ferramenta</h2>
        <div className="brushes">
          <button className={tool === "laco" ? "on" : ""} onClick={() => setTool("laco")}>Laço (rente)</button>
          <button className={tool === "caixa" ? "on" : ""} onClick={() => setTool("caixa")}>Caixa</button>
          {art === "cores" && <button className={tool === "pincel" ? "on" : ""} onClick={() => setTool("pincel")}>Pincel de correção</button>}
        </div>
        {tool !== "pincel" && (<>
          <label className="fld">Nome do próximo recorte<input value={cutName} onChange={(e) => setCutName(e.target.value)} /></label>
          <p className="hint small">Laço: contorne rente — o miolo é mantido e só a borda é ajustada pela cor. Caixa: o app tenta separar o objeto do fundo pela cor (funciona quando as cores são bem diferentes).</p>
          {cutsHere.length > 0 && <p className="hint small">Recortes nesta peça: {cutsHere.map((o) => o.name).join(", ")}</p>}
          {art === "ilustracao" && <button className="btn" disabled={!!busy || !ras} onClick={() => rebuildBackground()}>Refazer o fundo</button>}
        </>)}
        {tool === "pincel" && (<>
          <div className="brushes">
            {BRUSH.map(([v, l, c]) => <button key={v} className={brush === v ? "on" : ""} onClick={() => setBrush(v)}><i style={{ background: c }} />{l}</button>)}
          </div>
          <label className="rng">Tamanho <output>{size}px</output><input type="range" min={4} max={160} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
          <p className="hint small">O que você pintar prevalece sobre o automático na próxima separação.</p>
          <button className="btn" onClick={clearMap}>Limpar correções desta peça</button>
        </>)}

        {art === "cores" && (<>
          <h2>Ajustes do motor</h2>
          <label className="rng">Degradês viram imagem <output>{S.thr}%</output><input type="range" min={0} max={100} value={S.thr} onChange={(e) => setS({ thr: +e.target.value })} /></label>
          <label className="rng">Fidelidade de cor <output>ΔE {S.de}</output><input type="range" min={2} max={16} step={0.5} value={S.de} onChange={(e) => setS({ de: +e.target.value })} /></label>
          <label className="rng">Precisão do contorno <output>{S.prec} px</output><input type="range" min={0.15} max={2} step={0.05} value={S.prec} onChange={(e) => setS({ prec: +e.target.value })} /></label>
          <label className="rng">Ignorar manchas até <output>{S.speck} px</output><input type="range" min={0} max={300} step={2} value={S.speck} onChange={(e) => setS({ speck: +e.target.value })} /></label>
          <label className="rng">Tolerância do fundo <output>{S.tol}</output><input type="range" min={0.5} max={12} step={0.5} value={S.tol} onChange={(e) => setS({ tol: +e.target.value })} /></label>
          <label className="chk"><input type="checkbox" checked={S.stack} onChange={(e) => setS({ stack: e.target.checked })} /> Empilhar cores (sem frestas)</label>
          <label className="chk"><input type="checkbox" checked={S.fillBg} onChange={(e) => setS({ fillBg: e.target.checked })} /> Reconstruir o fundo atrás da arte</label>
        </>)}
        <div className="btns">
          <button className="btn main" disabled={!!busy} onClick={() => runCores([pid])}>{art === "ilustracao" ? (has ? "Refazer fundo da peça" : "Criar fundo da peça") : has ? "Separar de novo" : "Separar esta peça"}</button>
          <button className="btn" disabled={!!busy} onClick={() => runCores(p.pieces.map((x) => x.id))}>Processar todas as peças</button>
          <button className="btn" disabled={!has} onClick={approveAll}>Aprovar tudo desta peça</button>
          <button className="btn" onClick={onDone}>Ir para o editor →</button>
        </div>
        <p className="hint small">Tudo que o app gera entra como rascunho. Áreas de fundo refeitas são aproximadas: confira antes de aprovar.</p>
      </aside>
    </section>
  );
}
