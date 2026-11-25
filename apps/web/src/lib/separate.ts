// Liga o motor (Web Worker) ao modelo do projeto: gera fundo, imagens recortadas
// (uma por região conectada) e vetores (um objeto por cor), todos como sugestão
// do motor, não aprovados.
import { BackgroundObject, BitmapObject, EngineSettings, Obj, T0, VectorObject, uid } from "../model";
import { canvas, toBlob } from "./image";

export interface EngineLayer { hex: string; area: number; objs: string[]; nodes: number; conf: number }
interface EngineResult { w: number; h: number; layers: EngineLayer[]; mImg: Uint8Array | null; mBg: Uint8Array | null; fill: Uint8ClampedArray | null; cnt: number[]; ms: number }

let worker: Worker | null = null;
let jobs = 0;

export function runEngine(img: CanvasImageSource & { width: number; height: number }, S: EngineSettings, force: Uint8Array | null,
  onProgress: (t: string) => void): Promise<EngineResult> {
  const sc = Math.min(2, S.res / Math.max(img.width, img.height));
  const [c, x] = canvas(img.width * sc, img.height * sc);
  x.drawImage(img, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height);
  let f: ArrayBuffer | undefined;
  if (force) { // reamostra o mapa de correções para a resolução de trabalho
    const [fc, fx] = canvas(c.width, c.height);
    fx.imageSmoothingEnabled = false;
    const [mc, mx] = canvas(img.width, img.height);
    const id = mx.createImageData(mc.width, mc.height);
    for (let i = 0; i < force.length; i++) { id.data[i * 4] = force[i] * 60; id.data[i * 4 + 3] = 255; }
    mx.putImageData(id, 0, 0);
    fx.drawImage(mc, 0, 0, fc.width, fc.height);
    const fd = fx.getImageData(0, 0, fc.width, fc.height).data, F = new Uint8Array(fc.width * fc.height);
    for (let i = 0; i < F.length; i++) F[i] = Math.round(fd[i * 4] / 60);
    f = F.buffer;
  }
  if (!worker) worker = new Worker(new URL("./engine.worker.js", import.meta.url));
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e) => {
      const m = e.data;
      if (m.progress) return onProgress(m.progress);
      if (m.error) return reject(new Error(m.error));
      if (m.done && m.id === id) resolve(m);
    };
    worker!.onerror = (e) => reject(new Error(e.message || "erro no motor"));
    const tr: Transferable[] = [data.data.buffer];
    if (f) tr.push(f);
    worker!.postMessage({ id, w: c.width, h: c.height, buf: data.data.buffer, S: { ...S, auto: true, k: 8, bgm: "img", enh: false }, force: f }, tr);
  });
}

function scalePath(d: string, k: number) {
  return d.replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) => String(Math.round(parseFloat(n) * k * 1000) / 1000));
}

function maskCanvas(m: Uint8Array, w: number, h: number) {
  const [c, x] = canvas(w, h);
  const id = x.createImageData(w, h);
  for (let i = 0; i < m.length; i++) id.data[i * 4 + 3] = m[i];
  x.putImageData(id, 0, 0);
  return c;
}

/** Regiões conectadas de uma máscara (bbox em px de trabalho). */
function regions(m: Uint8Array, w: number, h: number, minArea: number) {
  const seen = new Uint8Array(w * h), out: { x0: number; y0: number; x1: number; y1: number; n: number; lab: number }[] = [];
  const lab = new Int32Array(w * h).fill(-1), st: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || seen[s]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; seen[s] = 1; st.push(s);
    const L = out.length;
    while (st.length) {
      const p = st.pop()!, x = p % w, y = (p / w) | 0; n++; lab[p] = L;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < w * h && m[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    out.push({ x0, y0, x1, y1, n, lab: L });
  }
  return { regs: out.filter((r) => r.n >= minArea), lab };
}

export async function separatePiece(opts: {
  pieceId: string; raster: HTMLCanvasElement | ImageBitmap; widthMm: number; heightMm: number;
  S: EngineSettings; force: Uint8Array | null; onProgress: (t: string) => void;
}): Promise<{ objects: Obj[]; assets: Map<string, Blob>; stats: { cores: number; vetorPct: number; imagemPct: number; fundoPct: number; ms: number } }> {
  const { pieceId, raster, widthMm, S } = opts;
  const r = await runEngine(raster, S, opts.force, opts.onProgress);
  const { w, h } = r, k = widthMm / w, assets = new Map<string, Blob>(), objects: Obj[] = [];
  const RW = raster.width, RH = raster.height;
  // fundo completo (reconstruído atrás da arte quando houver)
  if (r.mBg) {
    const [bc, bx] = canvas(RW, RH);
    if (r.fill) {
      const [fc, fx] = canvas(w, h);
      fx.putImageData(new ImageData(new Uint8ClampedArray(r.fill), w, h), 0, 0);
      bx.drawImage(fc, 0, 0, RW, RH);
    }
    const [oc, ox] = canvas(RW, RH);
    ox.drawImage(raster, 0, 0);
    ox.globalCompositeOperation = "destination-in";
    ox.drawImage(maskCanvas(r.mBg, w, h), 0, 0, RW, RH);
    bx.drawImage(oc, 0, 0);
    const name = `pc-${pieceId}-fundo.png`;
    assets.set(name, await toBlob(bc));
    const bg: BackgroundObject = {
      id: uid("fundo"), name: "Fundo", type: "background", kind: "bitmap", asset: name, width_mm: widthMm, height_mm: opts.heightMm,
      paths: [], z: 0, transform: T0(), visible: true, approved: false, origin: "motor", status: "rascunho",
      reconstructed_mask: null, confidence: null,
    };
    objects.push(bg);
  }
  // imagens recortadas: uma por região (personagens, flores, paisagens…)
  if (r.mImg) {
    const { regs, lab } = regions(r.mImg, w, h, Math.max(64, (w * h) / 4000));
    let n = 0;
    for (const g of regs.sort((a, b) => b.n - a.n)) {
      const pad = 3, x0 = Math.max(0, g.x0 - pad), y0 = Math.max(0, g.y0 - pad), x1 = Math.min(w - 1, g.x1 + pad), y1 = Math.min(h - 1, g.y1 + pad);
      const m = new Uint8Array(w * h);
      for (let i = 0; i < m.length; i++) if (r.mImg[i] && (lab[i] === g.lab || lab[i] === -1)) m[i] = r.mImg[i];
      const sx = RW / w, sy = RH / h, cx0 = Math.floor(x0 * sx), cy0 = Math.floor(y0 * sy), cw = Math.ceil((x1 + 1) * sx) - cx0, ch = Math.ceil((y1 + 1) * sy) - cy0;
      const [cc, cx] = canvas(cw, ch);
      cx.drawImage(raster, cx0, cy0, cw, ch, 0, 0, cw, ch);
      cx.globalCompositeOperation = "destination-in";
      cx.drawImage(maskCanvas(m, w, h), x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, cw, ch);
      const name = `pc-${pieceId}-img-${++n}.png`;
      assets.set(name, await toBlob(cc));
      const bmp: BitmapObject = {
        id: uid("img"), name: `Imagem ${n}`, type: "bitmap", asset: name,
        width_mm: (cw / RW) * widthMm, height_mm: (ch / RH) * opts.heightMm, source_ppi: cw / ((cw / RW) * widthMm / 25.4),
        z: 10 + n, transform: { ...T0(), x_mm: (cx0 / RW) * widthMm, y_mm: (cy0 / RH) * opts.heightMm },
        visible: true, approved: false, origin: "motor", confidence: null,
      };
      objects.push(bmp);
    }
  }
  // vetores: um objeto por cor (cada forma é um caminho próprio, com seus furos)
  r.layers.forEach((l, i) => {
    const v: VectorObject = {
      id: uid("vet"), name: `Cor ${i + 1} ${l.hex.toUpperCase()}`, type: "vector",
      paths: l.objs.map((d) => ({ d: scalePath(d, k), fill: l.hex, fill_rule: "evenodd" as const })),
      z: 100 + i, transform: T0(), visible: true, approved: false, origin: "motor", confidence: Math.round(l.conf * 100) / 100,
    };
    objects.push(v);
  });
  const tot = r.cnt[1] + r.cnt[2] + r.cnt[3] || 1;
  return { objects, assets, stats: { cores: r.layers.length, vetorPct: r.cnt[1] / tot, imagemPct: r.cnt[2] / tot, fundoPct: r.cnt[3] / tot, ms: r.ms } };
}
