// Utilitários de imagem: leitura com orientação EXIF, hash, recorte e perspectiva.

export async function sha256(b: Blob): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", await b.arrayBuffer());
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
export const MAX_PIXELS = 80e6; // limite de decodificação

/** Decodifica aplicando a orientação EXIF. */
export async function decode(b: Blob): Promise<ImageBitmap> {
  if (b.type && !ACCEPT.includes(b.type)) throw new Error("Formato não aceito. Use PNG, JPEG ou WebP.");
  const bmp = await createImageBitmap(b, { imageOrientation: "from-image" });
  if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close(); throw new Error("Imagem grande demais (acima de 80 megapixels)."); }
  return bmp;
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.imageSmoothingQuality = "high";
  return [c, x];
}

export const toBlob = (c: HTMLCanvasElement, type = "image/png") =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("falha ao gerar PNG"))), type));

/** Normaliza o original (orientação aplicada) para PNG sem perder transparência. */
export async function normalized(bmp: ImageBitmap): Promise<Blob> {
  const [c, x] = canvas(bmp.width, bmp.height);
  x.drawImage(bmp, 0, 0);
  return toBlob(c);
}

export function cropRect(src: CanvasImageSource, r: { x: number; y: number; w: number; h: number }) {
  const [c, x] = canvas(r.w, r.h);
  x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c;
}

// ---------- homografia (placa em perspectiva) ----------
function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error("Cantos inválidos (pontos alinhados)");
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}
/** Homografia H que leva src[i] -> dst[i] (4 pontos). Retorna 9 coeficientes (h33 = 1). */
export function homography(src: [number, number][], dst: [number, number][]): number[] {
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}
export function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Retifica o quadrilátero `quad` (px do original) num retângulo outW x outH (bilinear). */
export function warpQuad(src: ImageBitmap | HTMLCanvasElement, quad: [number, number][], outW: number, outH: number) {
  const [sc, sx] = canvas(src.width, src.height);
  sx.drawImage(src, 0, 0);
  const S = sx.getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
  const [c, x] = canvas(outW, outH);
  const out = x.createImageData(c.width, c.height), O = out.data;
  const H = homography([[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]], quad); // destino -> origem
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
    const [u, v] = applyH(H, xx + 0.5, y + 0.5), fx = u - 0.5, fy = v - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, o = (y * c.width + xx) * 4;
    if (x0 < -1 || y0 < -1 || x0 >= SW || y0 >= SH) continue;
    for (let k = 0; k < 4; k++) {
      const g = (X: number, Y: number) => S[(Math.min(SH - 1, Math.max(0, Y)) * SW + Math.min(SW - 1, Math.max(0, X))) * 4 + k];
      O[o + k] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
  x.putImageData(out, 0, 0);
  return c;
}

/** Lê métricas de uma fonte TTF/OTF (unitsPerEm, ascender) para a prévia do texto. */
export function fontMetrics(buf: ArrayBuffer): { upm: number; asc: number } {
  const v = new DataView(buf), n = v.getUint16(4);
  let upm = 1000, asc = 800;
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16, tag = String.fromCharCode(v.getUint8(r), v.getUint8(r + 1), v.getUint8(r + 2), v.getUint8(r + 3)), off = v.getUint32(r + 8);
    if (tag === "head") upm = v.getUint16(off + 18);
    if (tag === "hhea") asc = v.getInt16(off + 4);
  }
  return { upm, asc };
}
