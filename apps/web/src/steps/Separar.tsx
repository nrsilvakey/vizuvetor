import { useEffect, useRef, useState } from "react";
import { assetUrl, useApp } from "../ctx";
import { canvas, decode, toBlob } from "../lib/image";
import { separatePiece } from "../lib/separate";
import { EngineSettings, ROLE_LABEL } from "../model";
import { PieceObjects } from "../render";

const BRUSH = [[1, "Vetor", "#e4003a"], [2, "Imagem", "#1f9d55"], [3, "Fundo", "#2f7df6"], [0, "Apagar correção", "#888"]] as const;
const COLORS = ["", "rgba(228,0,58,.45)", "rgba(31,157,85,.45)", "rgba(47,125,246,.45)"];
const maps = new Map<string, Uint8Array>(); // correções em memória por peça

export default function Separar({ onDone }: { onDone: () => void }) {
  const { doc, update, assets, toast, bump } = useApp();
  const p = doc.project!;
  const [pid, setPid] = useState(p.pieces[0]?.id);
  const pc = p.pieces.find((x) => x.id === pid)!;
  const src = doc.app.sources.find((s) => s.pieceId === pid);
  const S = doc.app.settings;
  const [brush, setBrush] = useState<number>(1);
  const [size, setSize] = useState(30);
  const [busy, setBusy] = useState("");
  const [stats, setStats] = useState<Record<string, any>>({});
  const [ras, setRas] = useState<ImageBitmap | null>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const dirty = useRef(false);

  // carrega o recorte e o mapa de correções salvo
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
  useEffect(() => { drawOverlay(); }, [ras]);

  function drawOverlay() {
    const c = ov.current; if (!c || !ras) return;
    c.width = ras.width; c.height = ras.height;
    const x = c.getContext("2d")!, F = maps.get(pid), id = x.createImageData(c.width, c.height);
    if (F) for (let i = 0; i < F.length; i++) if (F[i]) { const col = [0, [228, 0, 58], [31, 157, 85], [47, 125, 246]][F[i]] as number[]; id.data.set([col[0], col[1], col[2], 115], i * 4); }
    x.putImageData(id, 0, 0);
  }
  function paint(e: React.PointerEvent) {
    if (!painting.current || !ras) return;
    const c = ov.current!, r = c.getBoundingClientRect(), sx = c.width / r.width;
    const cx = (e.clientX - r.left) * sx, cy = (e.clientY - r.top) * sx, rad = (size / 2) * sx;
    let F = maps.get(pid);
    if (!F) { F = new Uint8Array(c.width * c.height); maps.set(pid, F); }
    const x = c.getContext("2d")!;
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(c.height, cy + rad); y++)
      for (let xx = Math.max(0, Math.floor(cx - rad)); xx < Math.min(c.width, cx + rad); xx++)
        if ((xx - cx) ** 2 + (y - cy) ** 2 <= rad * rad) F[y * c.width + xx] = brush;
    x.save(); x.globalCompositeOperation = "copy";
    x.beginPath(); x.arc(cx, cy, rad, 0, 7); x.clip();
    x.fillStyle = brush ? COLORS[brush] : "rgba(0,0,0,0)"; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    x.restore();
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
    update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === pid ? { ...s, forceMap: name } : s)) } }));
  }
  function clearMap() { maps.delete(pid); drawOverlay(); update((d) => ({ ...d, app: { ...d.app, sources: d.app.sources.map((s) => (s.pieceId === pid ? { ...s, forceMap: undefined } : s)) } })); }

  async function run(ids: string[]) {
    for (const id of ids) {
      const piece = p.pieces.find((x) => x.id === id)!, s = doc.app.sources.find((x) => x.pieceId === id);
      if (!s?.raster) continue;
      setBusy(`${ROLE_LABEL[piece.role]}: preparando…`);
      try {
        const r = await decode(assets.get(s.raster)!);
        const res = await separatePiece({ pieceId: id, raster: r, widthMm: piece.width_mm, heightMm: piece.height_mm, S, force: maps.get(id) || null,
          onProgress: (t) => setBusy(`${ROLE_LABEL[piece.role]}: ${t}`) });
        for (const k of [...assets.keys()]) if (k.startsWith(`pc-${id}-`)) assets.delete(k);
        for (const [k, v] of res.assets) assets.set(k, v);
        update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === id ? { ...x, objects: [...x.objects.filter((o) => o.origin === "manual"), ...res.objects] } : x)) } }));
        setStats((st) => ({ ...st, [id]: res.stats }));
      } catch (e: any) { toast(`Erro ao separar ${ROLE_LABEL[piece.role]}: ${e.message}`); }
    }
    setBusy(""); bump();
  }
  function setS(patch: Partial<EngineSettings>) { update((d) => ({ ...d, app: { ...d.app, settings: { ...d.app.settings, ...patch } } }), true); }
  function approveAll() {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pid ? { ...x, objects: x.objects.map((o) => ({ ...o, approved: true, ...(o.type === "background" ? { status: "aprovado" as const } : {}) })) } : x)) } }));
    toast("Tudo desta peça aprovado");
  }

  const st = stats[pid];
  const has = pc?.objects.some((o) => o.origin === "motor");
  return (
    <section className="step separar">
      <div className="canvasbox">
        <div className="bar">
          {p.pieces.map((x) => <button key={x.id} className={x.id === pid ? "on" : ""} onClick={() => setPid(x.id)}>{ROLE_LABEL[x.role]}{x.objects.length ? " ✓" : ""}</button>)}
        </div>
        <div className="twin">
          <figure>
            <figcaption>Recorte · pinte para corrigir</figcaption>
            <div className="paint">
              {ras && src?.raster && <img src={assetUrl(assets, src.raster)} alt="Recorte da peça" />}
              <canvas ref={ov} onPointerDown={(e) => { painting.current = true; (e.target as Element).setPointerCapture(e.pointerId); paint(e); }}
                onPointerMove={paint} onPointerUp={() => { painting.current = false; persistMap(); }} style={{ cursor: "crosshair" }} />
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
        {st && <p className="hint">{st.cores} cores em vetor · {Math.round(st.vetorPct * 100)}% vetor · {Math.round(st.imagemPct * 100)}% imagem · {Math.round(st.fundoPct * 100)}% fundo · {(st.ms / 1000).toFixed(1)} s</p>}
      </div>
      <aside className="side">
        <h2>Pincel de correção</h2>
        <div className="brushes">
          {BRUSH.map(([v, l, c]) => <button key={v} className={brush === v ? "on" : ""} onClick={() => setBrush(v)}><i style={{ background: c }} />{l}</button>)}
        </div>
        <label className="rng">Tamanho <output>{size}px</output><input type="range" min={4} max={160} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <p className="hint small">O que você pintar prevalece sobre o automático na próxima separação.</p>
        <button className="btn" onClick={clearMap}>Limpar correções desta peça</button>
        <h2>Ajustes do motor</h2>
        <label className="rng">Degradês viram imagem <output>{S.thr}%</output><input type="range" min={0} max={100} value={S.thr} onChange={(e) => setS({ thr: +e.target.value })} /></label>
        <label className="rng">Fidelidade de cor <output>ΔE {S.de}</output><input type="range" min={2} max={16} step={0.5} value={S.de} onChange={(e) => setS({ de: +e.target.value })} /></label>
        <label className="rng">Precisão do contorno <output>{S.prec} px</output><input type="range" min={0.15} max={2} step={0.05} value={S.prec} onChange={(e) => setS({ prec: +e.target.value })} /></label>
        <label className="rng">Ignorar manchas até <output>{S.speck} px</output><input type="range" min={0} max={300} step={2} value={S.speck} onChange={(e) => setS({ speck: +e.target.value })} /></label>
        <label className="rng">Tolerância do fundo <output>{S.tol}</output><input type="range" min={0.5} max={12} step={0.5} value={S.tol} onChange={(e) => setS({ tol: +e.target.value })} /></label>
        <label className="chk"><input type="checkbox" checked={S.stack} onChange={(e) => setS({ stack: e.target.checked })} /> Empilhar cores (sem frestas)</label>
        <label className="chk"><input type="checkbox" checked={S.fillBg} onChange={(e) => setS({ fillBg: e.target.checked })} /> Reconstruir o fundo atrás da arte</label>
        <div className="btns">
          <button className="btn main" disabled={!!busy} onClick={() => run([pid])}>{has ? "Separar de novo" : "Separar esta peça"}</button>
          <button className="btn" disabled={!!busy} onClick={() => run(p.pieces.map((x) => x.id))}>Separar todas as peças</button>
          <button className="btn" disabled={!has} onClick={approveAll}>Aprovar tudo desta peça</button>
          <button className="btn" onClick={onDone}>Ir para o editor →</button>
        </div>
        <p className="hint small">Tudo que o motor gera entra como sugestão (rascunho). O fundo reconstruído é aproximado: confira antes de aprovar.</p>
      </aside>
    </section>
  );
}
