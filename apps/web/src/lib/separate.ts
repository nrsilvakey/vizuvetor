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
  onProgress: (t: string) => void, extra: Record<string, unknown> = {}): Promise<EngineResult> {
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
    worker!.postMessage({ id, w: c.width, h: c.height, buf: data.data.buffer, S: { ...S, auto: true, k: 8, bgm: "img", enh: false, ...extra }, force: f }, tr);
  });
}

export function scalePath(d: string, k: number) {
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
  S: EngineSettings; force: Uint8Array | null; onProgress: (t: string) => void; uniform?: boolean; cleanFolds?: boolean;
}): Promise<{ objects: Obj[]; assets: Map<string, Blob>; stats: { removidas: number; cores: number; vetorPct: number; imagemPct: number; fundoPct: number; ms: number } }> {
  const { pieceId, raster, widthMm, S } = opts;
  // uniforme: sem fundo por borda nem degradê->imagem; dobras não viram cores; cor dominante = fundo da peça
  // uniforme: ignora uma faixa junto ao contorno da roupa (gola do mockup, sombras laterais);
  // isso também separa elementos que o mockup "grudava" pela borda.
  let src: CanvasImageSource & { width: number; height: number } = raster;
  if (opts.uniform && (S.edgeBand ?? 3) > 0) {
    const [ec, ex] = canvas(raster.width, raster.height);
    ex.drawImage(raster, 0, 0);
    const id = ex.getImageData(0, 0, ec.width, ec.height), W = ec.width, H = ec.height, op = new Float32Array(W * H);
    for (let i = 0; i < op.length; i++) op[i] = id.data[i * 4 + 3] >= 128 ? 1 : 0;
    const band = Math.max(2, Math.round((W * (S.edgeBand ?? 3)) / 100));
    // erosão: soma em janela (integral) — pixel fica só se toda a vizinhança for da roupa
    const I = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += op[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - band), x1 = Math.min(W, x + band + 1), y0 = Math.max(0, y - band), y1 = Math.min(H, y + band + 1);
      const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      if (sum < (x1 - x0) * (y1 - y0) - 0.5) id.data[(y * W + x) * 4 + 3] = 0;
    }
    ex.putImageData(id, 0, 0);
    src = ec;
  }
  const r = await runEngine(src, opts.uniform ? { ...S, stack: true } : S, opts.force, opts.onProgress,
    opts.uniform ? { bgm: "vec", thr: 0, flat: true, de: Math.max(S.de, 14) } : {});
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
  // uniforme: fundo = retângulo da peça na cor dominante (aplicável a qualquer tamanho de molde);
  // formas irregulares que encostam na borda da roupa (sombras/dobras do mockup, gola do mockup) saem.
  let layers = r.layers, removed = 0;
  if (opts.uniform && layers.length) {
    const base = layers[0], Wm = widthMm, Hm = opts.heightMm;
    objects.push({
      id: uid("fundo"), name: `Fundo camiseta (cor base ${base.hex.toUpperCase()})`, type: "background", kind: "vector", asset: null, width_mm: Wm, height_mm: Hm,
      paths: [{ d: `M0 0L${Wm} 0L${Wm} ${Hm}L0 ${Hm}Z`, fill: base.hex, fill_rule: "evenodd" as const }], z: 0, transform: T0(), visible: true,
      approved: false, origin: "motor", status: "rascunho", reconstructed_mask: null, confidence: Math.round(base.conf * 100) / 100,
    } as BackgroundObject);
    // alfa da peça na resolução do motor: para saber se a forma encosta na borda da roupa
    const [ac, ax] = canvas(w, h);
    ax.drawImage(src, 0, 0, w, h);
    const ad = ax.getImageData(0, 0, w, h).data, outside = (x: number, y: number) => {
      const xi = Math.round(x), yi = Math.round(y);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const X = xi + dx, Y = yi + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || ad[(Y * w + X) * 4 + 3] < 128) return true;
      }
      return false;
    };
    layers = layers.slice(1).map((l) => {
      if (!opts.cleanFolds) return l;
      const keep = l.objs.filter((d) => {
        const pts = outerPoints(d);
        if (pts.length < 3) return false;
        const area = Math.abs(polyArea(pts)), hull = Math.abs(polyArea(convexHull(pts))) || 1;
        const touches = pts.some(([x, y]) => outside(x, y));
        const tiny = area < w * h * 0.0004;
        const big = area > w * h * 0.04; // formas grandes (faixas, painéis) nunca saem sozinhas
        const ok = !(tiny || (touches && !big && area / hull < 0.72));
        if (!ok) removed++;
        return ok;
      });
      return { ...l, objs: keep };
    }).filter((l) => l.objs.length);
  }
  // vetores: um objeto por cor (cada forma é um caminho próprio, com seus furos)
  layers.forEach((l, i) => {
    const v: VectorObject = {
      id: uid("vet"), name: `Cor ${i + 1} ${l.hex.toUpperCase()}`, type: "vector",
      paths: l.objs.map((d) => ({ d: scalePath(d, k), fill: l.hex, fill_rule: "evenodd" as const })),
      z: 100 + i, transform: T0(), visible: true, approved: false, origin: "motor", confidence: Math.round(l.conf * 100) / 100,
    };
    objects.push(v);
  });
  const tot = r.cnt[1] + r.cnt[2] + r.cnt[3] || 1;
  return { objects, assets, stats: { removidas: removed, cores: r.layers.length, vetorPct: r.cnt[1] / tot, imagemPct: r.cnt[2] / tot, fundoPct: r.cnt[3] / tot, ms: r.ms } };
}

// ---------------- modo ilustração: recortes de objeto e fundo por textura ----------------
// @ts-ignore módulo JS puro (testado também em Node)
import { colorMask, polygonMask, reconstructTexture, refineCut } from "./cut.js";

function rasterData(raster: CanvasImageSource & { width: number; height: number }) {
  const [c, x] = canvas(raster.width, raster.height);
  x.drawImage(raster, 0, 0);
  return x.getImageData(0, 0, c.width, c.height);
}

/** Vetoriza uma máscara (px) com o mesmo contorno subpixel + Bézier do motor. */
export function traceMask(mask: Uint8Array, w: number, h: number, eps = 0.5): Promise<string[]> {
  if (!worker) worker = new Worker(new URL("./engine.worker.js", import.meta.url));
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    worker!.onmessage = (e) => { const m = e.data; if (m.error) reject(new Error(m.error)); else if (m.done && m.id === id) resolve(m.objs); };
    const copy = new Uint8Array(mask);
    worker!.postMessage({ type: "trace", id, mask: copy.buffer, w, h, minA: Math.max(4, (w * h) / 200000), eps }, [copy.buffer]);
  });
}

/** Recorta um objeto pela caixa/laço (px do recorte da peça). */
export async function cutObject(opts: {
  pieceId: string; raster: CanvasImageSource & { width: number; height: number }; poly: number[][]; tight: boolean;
  widthMm: number; heightMm: number; name: string; z: number;
}) {
  const img = rasterData(opts.raster), W = img.width, H = img.height;
  const region = polygonMask(opts.poly, W, H);
  const { alpha, conf } = refineCut(img.data, W, H, region, { tight: opts.tight });
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 8) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error("Nada foi recortado. Faça o laço mais rente ao objeto.");
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, [cc, cx] = canvas(cw, ch), out = cx.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = ((y + y0) * W + x + x0), t = (y * cw + x) * 4;
    out.data[t] = img.data[s * 4]; out.data[t + 1] = img.data[s * 4 + 1]; out.data[t + 2] = img.data[s * 4 + 2]; out.data[t + 3] = alpha[s];
  }
  cx.putImageData(out, 0, 0);
  const objId = uid("img"), asset = `pc-${opts.pieceId}-${objId}.png`;
  const [mc, mx] = canvas(W, H), md = mx.createImageData(W, H);
  for (let i = 0; i < alpha.length; i++) { md.data[i * 4] = alpha[i]; md.data[i * 4 + 3] = 255; }
  mx.putImageData(md, 0, 0);
  const maskName = `cortes/${opts.pieceId}/${objId}.png`;
  const kx = opts.widthMm / W, ky = opts.heightMm / H;
  const obj: BitmapObject = {
    id: objId, name: opts.name, type: "bitmap", asset, width_mm: cw * kx, height_mm: ch * ky, source_ppi: cw / (cw * kx / 25.4),
    z: opts.z, transform: { ...T0(), x_mm: x0 * kx, y_mm: y0 * ky }, visible: true, approved: false, origin: "manual",
    confidence: Math.round(conf * 100) / 100,
  };
  return { obj, assets: new Map<string, Blob>([[asset, await toBlob(cc)], [maskName, await toBlob(mc)]]), maskName };
}

/** Fundo da peça em modo ilustração: a arte inteira, com as áreas dos recortes refeitas por textura. */
export async function illustrationBackground(opts: {
  pieceId: string; raster: CanvasImageSource & { width: number; height: number }; widthMm: number; heightMm: number;
  cutMasks: (CanvasImageSource & { width: number; height: number })[];
}) {
  const img = rasterData(opts.raster), W = img.width, H = img.height, hole = new Uint8Array(W * H);
  for (const m of opts.cutMasks) {
    const d = rasterData(m).data;
    for (let i = 0; i < hole.length; i++) if (d[i * 4] > 8) hole[i] = 1;
  }
  // amplia 5 px para não deixar contorno do objeto no fundo
  let grown = new Uint8Array(hole);
  for (let it = 0; it < 5; it++) {
    const next = new Uint8Array(grown);
    for (let i = 0; i < grown.length; i++) if (!grown[i]) { const x = i % W; if ((x > 0 && grown[i - 1]) || (x < W - 1 && grown[i + 1]) || grown[i - W] || grown[i + W]) next[i] = 1; }
    grown = next;
  }
  for (let i = 0; i < grown.length; i++) hole[i] = grown[i];
  const any = hole.some((v) => v);
  const r = any ? reconstructTexture(img.data, W, H, hole, null) : { rgba: img.data, method: "nenhum" };
  const [c, x] = canvas(W, H);
  x.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), W, H), 0, 0);
  const asset = `pc-${opts.pieceId}-fundo.png`;
  const assets = new Map<string, Blob>([[asset, await toBlob(c)]]);
  let maskName: string | null = null;
  if (any) {
    const [mc, mx] = canvas(W, H), md = mx.createImageData(W, H);
    for (let i = 0; i < hole.length; i++) { md.data[i * 4] = hole[i] * 255; md.data[i * 4 + 3] = 255; }
    mx.putImageData(md, 0, 0);
    maskName = `pc-${opts.pieceId}-fundo-refeito.png`;
    assets.set(maskName, await toBlob(mc));
  }
  const bg: BackgroundObject = {
    id: uid("fundo"), name: any ? "Fundo (áreas refeitas)" : "Fundo", type: "background", kind: "bitmap", asset, width_mm: opts.widthMm, height_mm: opts.heightMm,
    paths: [], z: 0, transform: T0(), visible: true, approved: false, origin: "motor", status: "rascunho", reconstructed_mask: maskName, confidence: null,
  };
  return { bg, assets, method: r.method as string };
}

/** Vetoriza os pixels de uma cor dentro de um bitmap recortado. */
export async function vectorizeColor(bitmap: Blob, rgb: [number, number, number], tol: number, widthMm: number) {
  const b = await createImageBitmap(bitmap), img = rasterData(b), W = img.width, H = img.height;
  b.close();
  const m: Uint8Array = colorMask(img.data, W, H, rgb, tol);
  const objs = await traceMask(m, W, H, 0.4);
  const k = widthMm / W;
  return objs.map((d) => scalePath(d, k));
}


// ---- geometria simples dos caminhos (px do motor) ----
function outerPoints(d: string): number[][] {
  const sub = d.split("M")[1] || "";
  const nums = (sub.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number), pts: number[][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}
function polyArea(p: number[][]) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
function convexHull(pts: number[][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
