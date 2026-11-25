import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetUrl, ensureFont, useApp } from "../ctx";
import { decode, sha256 } from "../lib/image";
import { BitmapObject, Obj, pageSize, Piece, ROLE_LABEL, T0, TextObject, TYPE_LABEL, uid, VectorObject } from "../model";
import { ObjBody, objTransform } from "../render";
import { vectorizeColor } from "../lib/separate";

type View = { x: number; y: number; w: number; h: number };

export default function Editor() {
  const { doc, update, assets, toast, bump } = useApp();
  const p = doc.project!;
  const [W, H] = pageSize(p);
  const [view, setView] = useState<View>({ x: -10, y: -10, w: W + 20, h: H + 20 });
  const [sel, setSel] = useState<string | null>(null);
  const [compare, setCompare] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const bodies = useRef(new Map<string, SVGGElement>());
  const [bbox, setBbox] = useState<DOMRect | null>(null);
  const drag = useRef<any>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [pick, setPick] = useState<string | null>(null); // "vetorizar uma cor": id do bitmap
  const [tol, setTol] = useState(22);
  const [vbusy, setVbusy] = useState(false);

  const found = useMemo(() => {
    for (const pc of p.pieces) for (const o of pc.objects) if (o.id === sel) return { pc, o };
    return null;
  }, [p, sel]);
  useLayoutEffect(() => { const g = sel ? bodies.current.get(sel) : null; setBbox(g ? g.getBBox() : null); }, [sel, p, assets.size]);
  useEffect(() => { setView({ x: -10, y: -10, w: W + 20, h: H + 20 }); }, [p.pieces.length]);

  // ---------- edição ----------
  function patchObj(id: string, fn: (o: Obj) => Obj, merge = false) {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((pc) => ({ ...pc, objects: pc.objects.map((o) => (o.id === id ? fn(o) : o)) })) } }), merge);
  }
  function patchT(id: string, t: Partial<Obj["transform"]>, merge = false) { patchObj(id, (o) => ({ ...o, transform: { ...o.transform, ...t } }), merge); }
  function removeObj(id: string) {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((pc) => ({ ...pc, objects: pc.objects.filter((o) => o.id !== id) })) } }));
    setSel(null);
  }
  function addObj(pcId: string, o: Obj) {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((pc) => (pc.id === pcId ? { ...pc, objects: [...pc.objects, o] } : pc)) } }));
    setSel(o.id);
  }
  function restack(id: string, dir: 1 | -1) {
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((pc) => {
      if (!pc.objects.some((o) => o.id === id)) return pc;
      const s = [...pc.objects].sort((a, b) => a.z - b.z), i = s.findIndex((o) => o.id === id), j = i + dir;
      if (j < 0 || j >= s.length) return pc;
      [s[i], s[j]] = [s[j], s[i]];
      const z = new Map(s.map((o, k) => [o.id, k * 10]));
      return { ...pc, objects: pc.objects.map((o) => ({ ...o, z: z.get(o.id)! })) };
    }) } }));
  }
  function split(pc: Piece, o: VectorObject) {
    if (o.paths.length < 2) return;
    const parts: VectorObject[] = o.paths.map((path, i) => ({ ...o, id: uid("vet"), name: `${o.name} · forma ${i + 1}`, paths: [path], z: o.z + i * 0.01 }));
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pc.id ? { ...x, objects: [...x.objects.filter((y) => y.id !== o.id), ...parts] } : x)) } }));
    setSel(parts[0].id);
  }
  function mergeDown(pc: Piece, o: VectorObject) {
    const below = [...pc.objects].filter((x) => x.type === "vector" && x.z < o.z).sort((a, b) => b.z - a.z)[0] as VectorObject | undefined;
    if (!below) return toast("Não há vetor abaixo para mesclar");
    if (JSON.stringify(below.transform) !== JSON.stringify(o.transform)) return toast("Só dá para mesclar vetores com a mesma posição/escala");
    update((d) => ({ ...d, project: { ...d.project!, pieces: d.project!.pieces.map((x) => (x.id === pc.id ? { ...x, objects: x.objects.filter((y) => y.id !== o.id).map((y) => (y.id === below.id ? { ...below, paths: [...below.paths, ...o.paths], approved: false } : y)) } : x)) } }));
    setSel(below.id);
  }
  function addText() {
    const pc = found?.pc || p.pieces[0];
    if (!pc) return;
    const t: TextObject = { id: uid("txt"), name: "Texto", type: "text", content: "Texto", font_path: "fonts/DejaVuSans-Bold.ttf", size_pt: 36, fill: "#1a1a1a",
      align: "center", letter_spacing_pt: 0, reviewed: false, ocr_text: null, z: 500, transform: { ...T0(), x_mm: pc.width_mm / 2, y_mm: pc.height_mm / 2 }, visible: true, approved: false, origin: "manual", confidence: null };
    addObj(pc.id, t);
  }
  async function loadFont(f: File) {
    const name = "fonts/" + f.name.replace(/[^\w.-]+/g, "_");
    assets.set(name, new Blob([await f.arrayBuffer()], { type: "font/ttf" }));
    try { await ensureFont(assets, name); } catch { assets.delete(name); return toast("Fonte inválida"); }
    if (found?.o.type === "text") patchObj(found.o.id, (o) => ({ ...(o as TextObject), font_path: name }));
    bump(); toast("Fonte carregada: " + f.name + " (a licença é verificada na exportação)");
  }
  async function replaceImage(f: File) {
    if (!found || !("asset" in found.o)) return;
    try {
      const b = await decode(f), name = `substituidas/${(await sha256(f)).slice(0, 12)}.png`;
      assets.set(name, f);
      patchObj(found.o.id, (o) => ({ ...o, asset: name, approved: false, ...(o.type === "bitmap" ? { source_ppi: b.width / (o.width_mm / 25.4) } : {}) } as Obj));
      bump(); toast("Imagem substituída");
    } catch (e: any) { toast(e.message); }
  }

  // ---------- interação no canvas ----------
  const toPage = (e: { clientX: number; clientY: number }) => {
    const m = svg.current!.getScreenCTM()!.inverse(), q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [q.x, q.y];
  };
  const pxPerMm = () => svg.current?.getScreenCTM()?.a || 1;
  async function pickColor(e: React.PointerEvent, pc: Piece, o: BitmapObject) {
    const [px, py] = toPage(e), t = o.transform, r = (-t.rotation_deg * Math.PI) / 180;
    const dx = px - pc.page_x_mm - t.x_mm, dy = py - pc.page_y_mm - t.y_mm;
    const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / t.scale, ly = (dx * Math.sin(r) + dy * Math.cos(r)) / t.scale;
    const blob = assets.get(o.asset); if (!blob) return;
    setVbusy(true);
    try {
      const bmp = await createImageBitmap(blob), c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext("2d")!; x.drawImage(bmp, 0, 0);
      const ix = Math.floor((lx / o.width_mm) * bmp.width), iy = Math.floor((ly / o.height_mm) * bmp.height);
      bmp.close();
      if (ix < 0 || iy < 0 || ix >= c.width || iy >= c.height) return toast("Clique dentro do recorte");
      // cor mediana numa janela 7x7 (ignora reflexos e bordas suavizadas)
      const x0 = Math.max(0, ix - 3), y0 = Math.max(0, iy - 3), win = x.getImageData(x0, y0, Math.min(7, c.width - x0), Math.min(7, c.height - y0)).data;
      const ch: number[][] = [[], [], []];
      for (let i = 0; i < win.length; i += 4) if (win[i + 3] >= 128) for (let k = 0; k < 3; k++) ch[k].push(win[i + k]);
      if (!ch[0].length) return toast("Esse ponto é transparente — clique na cor do objeto");
      const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
      const [R, G, B] = ch.map(med);
      const paths = await vectorizeColor(blob, [R, G, B], tol, o.width_mm);
      if (!paths.length) return toast("Nenhuma forma dessa cor grande o suficiente");
      const hex = "#" + [R, G, B].map((v) => v.toString(16).padStart(2, "0")).join("");
      const v: VectorObject = { id: uid("vet"), name: `Vetor ${hex.toUpperCase()} de ${o.name}`, type: "vector", paths: paths.map((d) => ({ d, fill: hex, fill_rule: "evenodd" as const })),
        z: o.z + 1, transform: { ...o.transform }, visible: true, approved: false, origin: "manual", confidence: null };
      addObj(pc.id, v);
      toast(`${paths.length} forma(s) vetorizada(s) na cor ${hex.toUpperCase()}`);
    } finally { setVbusy(false); setPick(null); }
  }
  function startMove(e: React.PointerEvent, pc: Piece, o: Obj) {
    if (pick && pick === o.id && o.type === "bitmap") { e.stopPropagation(); pickColor(e, pc, o); return; }
    e.stopPropagation(); setSel(o.id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    update((d) => d);
    drag.current = { kind: "move", id: o.id, p0: toPage(e), t0: { ...o.transform } };
  }
  function startHandle(e: React.PointerEvent, kind: "scale" | "rotate") {
    if (!found || !bbox) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    update((d) => d);
    const { pc, o } = found, t = o.transform, O = [pc.page_x_mm + t.x_mm, pc.page_y_mm + t.y_mm];
    const c = [bbox.x + bbox.width / 2, bbox.y + bbox.height / 2];
    drag.current = { kind, id: o.id, p0: toPage(e), t0: { ...t }, O, c, pc };
  }
  function onMove(e: React.PointerEvent) {
    const g = drag.current; if (!g) return;
    const P = toPage(e);
    if (g.kind === "pan") { const k = view.w / svg.current!.clientWidth; setView({ ...view, x: g.v0.x - (e.clientX - g.s0[0]) * k, y: g.v0.y - (e.clientY - g.s0[1]) * k }); return; }
    if (g.kind === "move") return patchT(g.id, { x_mm: g.t0.x_mm + P[0] - g.p0[0], y_mm: g.t0.y_mm + P[1] - g.p0[1] }, true);
    if (g.kind === "scale") {
      const d0 = Math.hypot(g.p0[0] - g.O[0], g.p0[1] - g.O[1]), d1 = Math.hypot(P[0] - g.O[0], P[1] - g.O[1]);
      return patchT(g.id, { scale: Math.max(0.01, g.t0.scale * d1 / (d0 || 1)) }, true);
    }
    if (g.kind === "rotate") { // gira em torno do centro do objeto
      const rad = (a: number) => (a * Math.PI) / 180, s = g.t0.scale;
      const rc = (r: number) => [Math.cos(rad(r)) * g.c[0] * s - Math.sin(rad(r)) * g.c[1] * s, Math.sin(rad(r)) * g.c[0] * s + Math.cos(rad(r)) * g.c[1] * s];
      const c0 = rc(g.t0.rotation_deg), C = [g.O[0] + c0[0], g.O[1] + c0[1]];
      let r = g.t0.rotation_deg + ((Math.atan2(P[1] - C[1], P[0] - C[0]) - Math.atan2(g.p0[1] - C[1], g.p0[0] - C[0])) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      const c1 = rc(r);
      return patchT(g.id, { rotation_deg: Math.round(r * 100) / 100, x_mm: C[0] - c1[0] - g.pc.page_x_mm, y_mm: C[1] - c1[1] - g.pc.page_y_mm }, true);
    }
  }
  function onWheel(e: React.WheelEvent) {
    const [px, py] = toPage(e), k = Math.exp(e.deltaY * 0.0015);
    setView((v) => ({ x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k }));
  }
  const zoom = (k: number) => setView((v) => ({ x: v.x + (v.w * (1 - k)) / 2, y: v.y + (v.h * (1 - k)) / 2, w: v.w * k, h: v.h * k }));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (!found || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeObj(found.o.id); }
      const step = e.shiftKey ? 10 : 1, t = found.o.transform;
      if (e.key === "ArrowLeft") patchT(found.o.id, { x_mm: t.x_mm - step });
      if (e.key === "ArrowRight") patchT(found.o.id, { x_mm: t.x_mm + step });
      if (e.key === "ArrowUp") { e.preventDefault(); patchT(found.o.id, { y_mm: t.y_mm - step }); }
      if (e.key === "ArrowDown") { e.preventDefault(); patchT(found.o.id, { y_mm: t.y_mm + step }); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const hs = 9 / (pxPerMm() * (found?.o.transform.scale || 1));
  const fonts = [...assets.keys()].filter((k) => k.startsWith("fonts/") && /\.(ttf|otf)$/i.test(k));
  return (
    <section className="step editor">
      <aside className="layers">
        <h2>Objetos</h2>
        {p.pieces.map((pc) => (
          <div key={pc.id} className="grp">
            <h3>{ROLE_LABEL[pc.role]} <small>{pc.width_mm} × {pc.height_mm} mm</small></h3>
            {!pc.objects.length && <p className="hint small">Vazio — separe na etapa 3 ou adicione texto.</p>}
            <ul>
              {[...pc.objects].sort((a, b) => b.z - a.z).map((o) => (
                <li key={o.id} className={(sel === o.id ? "on " : "") + (o.visible ? "" : "off")} onClick={() => setSel(o.id)}>
                  <button className="eye" title={o.visible ? "Ocultar" : "Mostrar"} onClick={(e) => { e.stopPropagation(); patchObj(o.id, (x) => ({ ...x, visible: !x.visible })); }}>{o.visible ? "◉" : "○"}</button>
                  {o.type === "vector" && <i className="sw" style={{ background: o.paths[0]?.fill }} />}
                  <span className="nm">{o.name || o.id}<small>{TYPE_LABEL[o.type]}{o.confidence != null ? ` · ${Math.round(o.confidence * 100)}%` : ""}</small></span>
                  <input type="checkbox" title="Aprovado" checked={o.approved && (o.type !== "background" || o.status === "aprovado")}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => patchObj(o.id, (x) => ({ ...x, approved: e.target.checked, ...(x.type === "background" ? { status: e.target.checked ? "aprovado" : "rascunho" } : {}) } as Obj))} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      <div className="canvasbox">
        <div className="bar">
          <button onClick={() => zoom(0.8)} title="Aproximar">＋</button>
          <button onClick={() => zoom(1.25)} title="Afastar">－</button>
          <button onClick={() => setView({ x: -10, y: -10, w: W + 20, h: H + 20 })}>Encaixar</button>
          <button onClick={addText}>+ Texto</button>
          <button onClick={() => fontInput.current?.click()}>Carregar fonte</button>
          <label className="rng inline">Comparar com original<input type="range" min={0} max={1} step={0.05} value={compare} onChange={(e) => setCompare(+e.target.value)} /></label>
          <input ref={fontInput} type="file" accept=".ttf,.otf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFont(f); e.target.value = ""; }} />
          <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) replaceImage(f); e.target.value = ""; }} />
        </div>
        <svg ref={svg} className="page-svg" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} onWheel={onWheel}
          onPointerDown={(e) => { setSel(null); drag.current = { kind: "pan", s0: [e.clientX, e.clientY], v0: { ...view } }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
          <rect x={0} y={0} width={W} height={H} className="paper" />
          {p.pieces.map((pc) => (
            <g key={pc.id}>
              <rect x={pc.page_x_mm} y={pc.page_y_mm} width={pc.width_mm} height={pc.height_mm} className="piecebox" />
              {pc.bleed_mm > 0 && <rect x={pc.page_x_mm - pc.bleed_mm} y={pc.page_y_mm - pc.bleed_mm} width={pc.width_mm + 2 * pc.bleed_mm} height={pc.height_mm + 2 * pc.bleed_mm} className="bleed" />}
              <text x={pc.page_x_mm} y={pc.page_y_mm - 3} className="plabel" fontSize={Math.max(4, W / 90)}>{ROLE_LABEL[pc.role]}</text>
              {[...pc.objects].sort((a, b) => a.z - b.z).filter((o) => o.visible).map((o) => (
                <g key={o.id} transform={objTransform(pc, o)} onPointerDown={(e) => startMove(e, pc, o)} className="obj">
                  <g ref={(el) => { if (el) bodies.current.set(o.id, el); else bodies.current.delete(o.id); }}><ObjBody o={o} assets={assets} /></g>
                </g>
              ))}
              {compare > 0 && (() => {
                const s = doc.app.sources.find((x) => x.pieceId === pc.id);
                return s?.raster ? <image href={assetUrl(assets, s.raster)} x={pc.page_x_mm} y={pc.page_y_mm} width={pc.width_mm} height={pc.height_mm} opacity={compare} preserveAspectRatio="none" pointerEvents="none" /> : null;
              })()}
            </g>
          ))}
          {found && bbox && (
            <g transform={objTransform(found.pc, found.o)} className="selbox">
              <rect x={bbox.x} y={bbox.y} width={bbox.width} height={bbox.height} />
              <line x1={bbox.x + bbox.width / 2} y1={bbox.y} x2={bbox.x + bbox.width / 2} y2={bbox.y - hs * 2.5} />
              <circle className="hd rot" cx={bbox.x + bbox.width / 2} cy={bbox.y - hs * 2.5} r={hs * 0.7} onPointerDown={(e) => startHandle(e, "rotate")} />
              <rect className="hd" x={bbox.x + bbox.width - hs / 2} y={bbox.y + bbox.height - hs / 2} width={hs} height={hs} onPointerDown={(e) => startHandle(e, "scale")} />
            </g>
          )}
        </svg>
        <p className="hint small">Arraste o fundo para mover a vista, role para zoom. Setas movem 1 mm (Shift: 10 mm). Shift ao girar trava em 15°. Delete apaga.</p>
      </div>

      <aside className="side props">
        <h2>Propriedades</h2>
        {!found && <p className="hint">Selecione um objeto no canvas ou na lista.</p>}
        {found && (() => {
          const { pc, o } = found, t = o.transform;
          const num = (label: string, v: number, on: (x: number) => void, unit: string, step = 0.1) => (
            <label className="num">{label}<input type="number" step={step} value={Math.round(v * 100) / 100} onChange={(e) => on(+e.target.value)} /><span>{unit}</span></label>
          );
          return (<>
            <label className="fld">Nome<input value={o.name} onChange={(e) => patchObj(o.id, (x) => ({ ...x, name: e.target.value }), true)} /></label>
            <p className="hint small">{TYPE_LABEL[o.type]} · {ROLE_LABEL[pc.role]} · origem: {o.origin === "motor" ? "motor (sugestão)" : "manual"}{o.confidence != null ? ` · confiança ${Math.round(o.confidence * 100)}%` : ""}</p>
            <div className="grid2">
              {num("X", t.x_mm, (v) => patchT(o.id, { x_mm: v }), "mm")}
              {num("Y", t.y_mm, (v) => patchT(o.id, { y_mm: v }), "mm")}
              {num("Escala", t.scale * 100, (v) => patchT(o.id, { scale: Math.max(0.01, v / 100) }), "%", 1)}
              {num("Rotação", t.rotation_deg, (v) => patchT(o.id, { rotation_deg: v }), "°", 1)}
            </div>
            <div className="row">
              <button onClick={() => restack(o.id, 1)}>Subir</button>
              <button onClick={() => restack(o.id, -1)}>Descer</button>
              <button onClick={() => removeObj(o.id)}>Apagar</button>
            </div>
            {o.type === "vector" && (<>
              <h3>Cores</h3>
              {[...new Set(o.paths.map((x) => x.fill))].map((c) => (
                <label key={c} className="color"><input type="color" value={c} onChange={(e) => patchObj(o.id, (x) => ({ ...(x as VectorObject), paths: (x as VectorObject).paths.map((pp) => (pp.fill === c ? { ...pp, fill: e.target.value } : pp)) }), true)} />{c.toUpperCase()}</label>
              ))}
              <p className="hint small">{o.paths.length} forma(s) · {o.paths.reduce((a, x) => a + (x.d.match(/[LC]/g)?.length || 0), 0)} segmentos</p>
              <div className="row"><button disabled={o.paths.length < 2} onClick={() => split(pc, o)}>Dividir em formas</button><button onClick={() => mergeDown(pc, o)}>Mesclar com o de baixo</button></div>
            </>)}
            {o.type === "text" && (<>
              <label className="fld">Conteúdo<textarea rows={2} value={o.content} onChange={(e) => patchObj(o.id, (x) => ({ ...(x as TextObject), content: e.target.value, reviewed: false }), true)} /></label>
              <label className="fld">Fonte<select value={o.font_path} onChange={(e) => patchObj(o.id, (x) => ({ ...(x as TextObject), font_path: e.target.value }))}>
                {fonts.map((f) => <option key={f} value={f}>{f.replace("fonts/", "")}</option>)}</select></label>
              <div className="grid2">
                {num("Tamanho", o.size_pt, (v) => patchObj(o.id, (x) => ({ ...(x as TextObject), size_pt: Math.max(1, v) })), "pt", 1)}
                {num("Espaço", o.letter_spacing_pt, (v) => patchObj(o.id, (x) => ({ ...(x as TextObject), letter_spacing_pt: v })), "pt", 0.5)}
              </div>
              <div className="row">
                {(["left", "center", "right"] as const).map((a) => <button key={a} className={o.align === a ? "on" : ""} onClick={() => patchObj(o.id, (x) => ({ ...(x as TextObject), align: a }))}>{{ left: "Esq.", center: "Centro", right: "Dir." }[a]}</button>)}
                <label className="color"><input type="color" value={o.fill} onChange={(e) => patchObj(o.id, (x) => ({ ...(x as TextObject), fill: e.target.value }), true)} /></label>
              </div>
              <label className="chk"><input type="checkbox" checked={o.reviewed} onChange={(e) => patchObj(o.id, (x) => ({ ...(x as TextObject), reviewed: e.target.checked }))} /> Acentos revisados</label>
              {o.ocr_text && o.ocr_text !== o.content && <p className="hint small">Leitura do OCR: “{o.ocr_text}”</p>}
            </>)}
            {o.type === "bitmap" && (<>
              <div className="grid2">
                {num("Largura", o.width_mm, (v) => patchObj(o.id, (x) => ({ ...(x as BitmapObject), height_mm: (x as BitmapObject).height_mm * v / (x as BitmapObject).width_mm, width_mm: Math.max(1, v) })), "mm", 1)}
                {num("Altura", o.height_mm, (v) => patchObj(o.id, (x) => ({ ...(x as BitmapObject), width_mm: (x as BitmapObject).width_mm * v / (x as BitmapObject).height_mm, height_mm: Math.max(1, v) })), "mm", 1)}
              </div>
              <PpiLine name={o.asset} w={o.width_mm * t.scale} h={o.height_mm * t.scale} />
              <button onClick={() => replaceInput.current?.click()}>Substituir imagem</button>
              <h3>Versão em vetor</h3>
              <label className="rng">Tolerância de cor <output>ΔE {tol}</output><input type="range" min={6} max={50} value={tol} onChange={(e) => setTol(+e.target.value)} /></label>
              <button className={pick === o.id ? "on" : ""} disabled={vbusy} onClick={() => setPick(pick === o.id ? null : o.id)}>{vbusy ? "Vetorizando…" : pick === o.id ? "Clique numa cor do recorte…" : "Vetorizar uma cor"}</button>
              <p className="hint small">Ex.: clique no amarelo das letras para criar a face do letreiro em vetor. O bitmap continua como alternativa fiel.</p>
            </>)}
            {o.type === "background" && (<>
              <label className="fld">Situação<select value={o.status} onChange={(e) => patchObj(o.id, (x) => ({ ...x, status: e.target.value as any, approved: e.target.value === "aprovado" }))}>
                <option value="rascunho">Rascunho</option><option value="aprovado">Aprovado</option></select></label>
              {o.kind === "bitmap" && <PpiLine name={o.asset!} w={o.width_mm! * t.scale} h={o.height_mm! * t.scale} />}
              <p className="hint small">Áreas atrás da arte foram reconstruídas por aproximação. Use “Comparar com original” para conferir.</p>
              {o.kind === "bitmap" && <button onClick={() => replaceInput.current?.click()}>Carregar fundo próprio</button>}
            </>)}
            <label className="chk"><input type="checkbox" checked={o.approved && (o.type !== "background" || o.status === "aprovado")}
              onChange={(e) => patchObj(o.id, (x) => ({ ...x, approved: e.target.checked, ...(x.type === "background" ? { status: e.target.checked ? "aprovado" : "rascunho" } : {}) } as Obj))} /> <b>Aprovado</b></label>
          </>);
        })()}
      </aside>
    </section>
  );
}

function PpiLine({ name, w, h }: { name: string; w: number; h: number }) {
  const { assets } = useApp();
  const [px, setPx] = useState<[number, number] | null>(null);
  useEffect(() => { const b = assets.get(name); if (b) createImageBitmap(b).then((x) => { setPx([x.width, x.height]); x.close(); }); }, [name, assets]);
  if (!px) return null;
  const ppx = px[0] / (w / 25.4), ppy = px[1] / (h / 25.4), low = Math.min(ppx, ppy) < 150;
  return <p className={"hint small" + (low ? " warnc" : "")}>{px[0]} × {px[1]} px · PPI efetivo {Math.round(ppx)} × {Math.round(ppy)}{low ? " (baixo para impressão)" : ""}</p>;
}
