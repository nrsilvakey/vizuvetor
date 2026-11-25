// Identificação de fonte: renderiza o texto em cada fonte da biblioteca e compara com a
// máscara da tinta na caixa marcada (sobreposição IoU, penalizando proporção diferente).
// Também mede posição, tamanho e espaçamento para recriar o texto no mesmo lugar.
import { ensureFont } from "../ctx";
import type { Assets } from "../store";
import { canvas, fontMetrics } from "./image";

export interface LibFont { arquivo: string; nome: string; estilo: string; licenca: string }
export interface FontMatch { path: string; nome: string; score: number; iou: number; preview: string }

let lib: LibFont[] | null = null;
export async function fontLibrary(): Promise<LibFont[]> {
  if (lib) return lib;
  const r = await fetch(new URL("fonts/biblioteca/index.json", document.baseURI));
  lib = r.ok ? await r.json() : [];
  return lib!;
}
export async function ensureLibraryFont(assets: Assets, arquivo: string) {
  const path = "fonts/biblioteca/" + arquivo;
  if (!assets.has(path)) {
    const r = await fetch(new URL(path, document.baseURI));
    if (!r.ok) throw new Error("Fonte não encontrada: " + arquivo);
    assets.set(path, new Blob([await r.arrayBuffer()], { type: "font/ttf" }));
  }
  return path;
}

/** Máscara da tinta numa caixa: separa 2 cores e escolhe a que menos toca a borda da caixa. */
export function inkMask(img: ImageData, box: { x: number; y: number; w: number; h: number }) {
  const W = img.width, x0 = Math.max(0, Math.round(box.x)), y0 = Math.max(0, Math.round(box.y));
  const w = Math.min(W - x0, Math.round(box.w)), h = Math.min(img.height - y0, Math.round(box.h)), d = img.data;
  const px = (x: number, y: number) => ((y0 + y) * W + x0 + x) * 4;
  // 2 grupos de cor (k-means simples em RGB)
  let c = [[0, 0, 0], [255, 255, 255]];
  for (let it = 0; it < 8; it++) {
    const s = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = px(x, y); if (d[i + 3] < 128) continue;
      const k = dist(d, i, c[0]) < dist(d, i, c[1]) ? 0 : 1;
      s[k][0] += d[i]; s[k][1] += d[i + 1]; s[k][2] += d[i + 2]; s[k][3]++;
    }
    c = s.map((v, k) => (v[3] ? [v[0] / v[3], v[1] / v[3], v[2] / v[3]] : c[k]));
  }
  const lab = new Uint8Array(w * h), edge = [0, 0], tot = [0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = px(x, y); if (d[i + 3] < 128) { lab[y * w + x] = 2; continue; }
    const k = dist(d, i, c[0]) < dist(d, i, c[1]) ? 0 : 1;
    lab[y * w + x] = k; tot[k]++;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge[k]++;
  }
  const ink = edge[0] / (tot[0] || 1) < edge[1] / (tot[1] || 1) ? 0 : 1;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = lab[i] === ink ? 1 : 0;
  const hex = "#" + c[ink].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { mask: m, w, h, x0, y0, color: hex };
}
const dist = (d: Uint8ClampedArray, i: number, c: number[]) => (d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2;

function tight(m: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Renderiza o texto na fonte (já registrada como `family`) e devolve a máscara justa. */
function renderMask(family: string, text: string, S = 160) {
  const [c, x] = canvas(Math.max(64, text.length * S * 1.3), S * 2.2);
  x.font = `${S}px "${family}"`;
  x.textBaseline = "alphabetic";
  x.fillStyle = "#000";
  const base = Math.round(S * 1.5), left = Math.round(S * 0.3);
  x.fillText(text, left, base);
  const m = x.getImageData(0, 0, c.width, c.height).data, M = new Uint8Array(c.width * c.height);
  for (let i = 0; i < M.length; i++) M[i] = m[i * 4 + 3] > 128 ? 1 : 0;
  const t = tight(M, c.width, c.height);
  return { M, cw: c.width, t, base, left, S, advance: x.measureText(text).width };
}

function resizeMask(M: Uint8Array, cw: number, t: { x0: number; y0: number; w: number; h: number }, tw: number, th: number) {
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = t.x0 + Math.min(t.w - 1, Math.floor(((x + 0.5) * t.w) / tw)), sy = t.y0 + Math.min(t.h - 1, Math.floor(((y + 0.5) * t.h) / th));
    out[y * tw + x] = M[sy * cw + sx];
  }
  return out;
}

export async function matchFonts(assets: Assets, ink: ReturnType<typeof inkMask>, text: string, candidates: { path: string; nome: string }[]) {
  const t = tight(ink.mask, ink.w, ink.h);
  if (!t) throw new Error("Não achei a tinta do texto dentro da caixa");
  const target = new Uint8Array(t.w * t.h);
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) target[y * t.w + x] = ink.mask[(t.y0 + y) * ink.w + t.x0 + x];
  const out: (FontMatch & { metrics: any })[] = [];
  for (const f of candidates) {
    const fi = await ensureFont(assets, f.path).catch(() => null);
    if (!fi) continue;
    const r = renderMask(fi.family, text);
    if (!r.t) continue;
    const g = resizeMask(r.M, r.cw, r.t, t.w, t.h);
    let inter = 0, uni = 0;
    for (let i = 0; i < g.length; i++) { if (g[i] && target[i]) inter++; if (g[i] || target[i]) uni++; }
    const iou = inter / (uni || 1), aspect = (r.t.w / r.t.h) / (t.w / t.h);
    const score = iou * Math.exp(-Math.abs(Math.log(aspect)) * 1.5);
    // prévia pequena
    const [pc, px] = canvas(160, 40);
    px.font = `30px "${fi.family}"`; px.fillStyle = "#111"; px.textBaseline = "middle"; px.fillText(text, 4, 21);
    out.push({ path: f.path, nome: f.nome, score, iou, preview: pc.toDataURL(), metrics: { r, t, fi } });
  }
  out.sort((a, b) => b.score - a.score);
  return { ranked: out, tightBox: t };
}

/**
 * Converte o encaixe da fonte escolhida em parâmetros do objeto de texto (mm, pt), para que o
 * texto recriado ocupe o mesmo lugar da tinta original. pxToMm: mm por pixel do recorte.
 */
export async function textPlacement(assets: Assets, m: any, ink: ReturnType<typeof inkMask>, tb: { x0: number; y0: number; w: number; h: number }, text: string, pxToMm: number) {
  const { r, fi } = m.metrics;
  const buf = await assets.get(m.path ?? "")?.arrayBuffer();
  const met = buf ? fontMetrics(buf) : { upm: fi.upm, asc: fi.asc };
  const scale = tb.h / r.t.h; // px do recorte por px renderizado
  const sizePx = r.S * scale, sizeMm = sizePx * pxToMm;
  const inkTopRender = r.t.y0, baselineRender = r.base;
  const baselinePx = ink.y0 + tb.y0 + (baselineRender - inkTopRender) * scale;
  const leftPx = ink.x0 + tb.x0 - (r.t.x0 - r.left) * scale;
  const y_mm = baselinePx * pxToMm - (sizeMm * met.asc) / met.upm;
  const x_mm = leftPx * pxToMm;
  const size_pt = (sizeMm * 72) / 25.4;
  // espaçamento que faz a largura bater
  const inkWRender = r.t.w * scale, n = [...text].length;
  const spacing_pt = n > 1 ? (((tb.w - inkWRender) * pxToMm) / (n - 1)) * (72 / 25.4) : 0;
  return { x_mm, y_mm, size_pt, letter_spacing_pt: Math.abs(spacing_pt) < 0.05 ? 0 : spacing_pt };
}

/** OCR no navegador (Tesseract.js, português). Carregado sob demanda; sem rede, o operador digita. */
let tess: any = null;
export async function ocr(img: HTMLCanvasElement): Promise<{ text: string; conf: number } | null> {
  try {
    if (!tess) {
      await new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        s.onload = () => res(); s.onerror = () => rej(new Error("OCR indisponível"));
        document.head.append(s);
      });
      tess = await (window as any).Tesseract.createWorker("por");
      await tess.setParameters({ tessedit_pageseg_mode: "7" }); // uma linha de texto
    }
    const r = await tess.recognize(img);
    const text = (r.data.text || "").replace(/\s+/g, " ").trim();
    return text ? { text, conf: (r.data.confidence || 0) / 100 } : null;
  } catch { return null; }
}
