// Recorte de objeto com borda ajustada (sem IA): modelo de cores objeto x fundo,
// no espírito do GrabCut, e reconstrução do fundo (pull-push multiescala).
// Funciona em navegador e em Node (sem DOM) para teste.

const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
const ff = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function toLab(d, N) {
  const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = lin[d[i * 4]], g = lin[d[i * 4 + 1]], b = lin[d[i * 4 + 2]];
    const X = ff((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), Y = ff(r * 0.2126 + g * 0.7152 + b * 0.0722), Z = ff((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    L[i] = 116 * Y - 16; A[i] = 500 * (X - Y); B[i] = 200 * (Y - Z);
  }
  return [L, A, B];
}

function kmeans(P, n, k, iters = 10) {
  k = Math.min(k, n);
  if (!k) return [];
  const C = [[P[0], P[1], P[2]]], md = new Float32Array(n).fill(1e12);
  while (C.length < k) {
    const c = C[C.length - 1]; let best = 0, bd = -1;
    for (let j = 0; j < n; j++) { const a = P[j * 3] - c[0], b = P[j * 3 + 1] - c[1], e = P[j * 3 + 2] - c[2], dd = a * a + b * b + e * e; if (dd < md[j]) md[j] = dd; if (md[j] > bd) { bd = md[j]; best = j; } }
    if (bd <= 1) break;
    C.push([P[best * 3], P[best * 3 + 1], P[best * 3 + 2]]);
  }
  for (let it = 0; it < iters; it++) {
    const s = C.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < n; j++) {
      let bi = 0, bd = 1e12;
      for (let c = 0; c < C.length; c++) { const a = P[j * 3] - C[c][0], b = P[j * 3 + 1] - C[c][1], e = P[j * 3 + 2] - C[c][2], dd = a * a + b * b + e * e; if (dd < bd) { bd = dd; bi = c; } }
      const t = s[bi]; t[0] += P[j * 3]; t[1] += P[j * 3 + 1]; t[2] += P[j * 3 + 2]; t[3]++;
    }
    s.forEach((t, c) => { if (t[3]) C[c] = [t[0] / t[3], t[1] / t[3], t[2] / t[3]]; });
  }
  return C;
}

function sample(idx, L, A, B, max) {
  const step = Math.max(1, Math.floor(idx.length / max)), n = Math.ceil(idx.length / step), P = new Float32Array(n * 3);
  for (let j = 0, k = 0; j < idx.length; j += step, k++) { const p = idx[j]; P[k * 3] = L[p]; P[k * 3 + 1] = A[p]; P[k * 3 + 2] = B[p]; }
  return [P, n];
}
const near = (C, l, a, b) => { let bd = 1e12; for (const c of C) { const x = l - c[0], y = a - c[1], z = b - c[2], d = x * x + y * y + z * z; if (d < bd) bd = d; } return bd; };

function boxMean(a, w, h, r) {
  const W = w + 1, I = new Float64Array(W * (h + 1)), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += a[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
  for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1); o[y * w + x] = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0)); } }
  return o;
}

/** Máscara de polígono (px) por varredura — sem canvas. */
export function polygonMask(poly, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[j];
      if ((y1 > yc) !== (y2 > yc)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) m[y * w + x] = 1;
    }
  }
  return m;
}

/**
 * Ajusta a borda do objeto dentro da região marcada.
 * region: 1 = dentro da caixa/laço. Amostra o fundo numa faixa em volta da região,
 * modela as cores do objeto e do fundo e decide pixel a pixel (3 iterações),
 * suaviza, fica com as partes ligadas ao miolo e preenche buracos pequenos.
 * tight: true quando o laço foi feito rente ao objeto (confia mais na marcação).
 * Retorna alfa 0..255 (Uint8Array) e a confiança média.
 */
export function refineCut(data, w, h, region, { tight = false } = {}) {
  const N = w * h, [L, A, B] = toLab(data, N);
  let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
  for (let i = 0; i < N; i++) if (region[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; area++; }
  if (!area) return { alpha: new Uint8Array(N), conf: 0 };
  const band = Math.max(4, Math.round(Math.max(x1 - x0, y1 - y0) * 0.06));
  const reg = Float32Array.from(region), near1 = boxMean(reg, w, h, band);
  const bgIdx = [], inIdx = [];
  for (let i = 0; i < N; i++) {
    if (data[i * 4 + 3] < 128) continue;
    if (!region[i] && near1[i] > 0) bgIdx.push(i); else if (region[i]) inIdx.push(i);
  }
  // fundo: faixa externa (+ borda interna da região quando é caixa)
  const inner = boxMean(reg, w, h, Math.max(2, Math.round(band / 3)));
  if (!tight) for (let i = 0; i < N; i++) if (region[i] && inner[i] < 0.75) bgIdx.push(i);
  let [Pb, nb] = sample(bgIdx, L, A, B, 20000);
  const Cb = kmeans(Pb, nb, 8);
  // primeira estimativa do objeto: o miolo da região menos o que parece fundo
  let fg = new Uint8Array(N);
  const core = boxMean(reg, w, h, Math.max(3, Math.round(band)));
  const seedIdx = [];
  for (const i of inIdx) if (core[i] > 0.98) seedIdx.push(i);
  let [Pf, nf] = sample(seedIdx.length ? seedIdx : inIdx, L, A, B, 20000);
  let Cf = kmeans(Pf, nf, 10);
  const margin = tight ? 0.7 : 1.0; // laço rente: na dúvida, é objeto
  for (let it = 0; it < 3; it++) {
    // remove do modelo do objeto as cores que o fundo explica bem
    const CfPure = Cf.filter((c) => near(Cb, c[0], c[1], c[2]) > 64);
    const Cuse = CfPure.length ? CfPure : Cf;
    for (const i of inIdx) fg[i] = near(Cuse, L[i], A[i], B[i]) * margin < near(Cb, L[i], A[i], B[i]) ? 1 : 0;
    const fi = inIdx.filter((i) => fg[i]);
    if (fi.length < 50) break;
    [Pf, nf] = sample(fi, L, A, B, 20000);
    Cf = kmeans(Pf, nf, 10);
  }
  // laço rente: o miolo é do objeto; a cor só decide numa faixa estreita junto do traço
  if (tight) {
    const edge = boxMean(reg, w, h, Math.max(4, Math.round(band * 0.5)));
    for (const i of inIdx) if (edge[i] > 0.999) fg[i] = 1;
  }
  // suavização + componentes ligados ao miolo + buracos pequenos preenchidos
  let s = boxMean(Float32Array.from(fg), w, h, 2);
  for (let i = 0; i < N; i++) fg[i] = region[i] && s[i] > 0.5 ? 1 : 0;
  fg = keepMain(fg, w, h, area * 0.02);
  const inv = new Uint8Array(N);
  for (let i = 0; i < N; i++) inv[i] = region[i] && !fg[i] ? 1 : 0;
  const holes = smallComponents(inv, w, h, area * 0.004, region);
  for (const i of holes) fg[i] = 1;
  // alfa suave na borda
  s = boxMean(Float32Array.from(fg), w, h, 1);
  const alpha = new Uint8Array(N);
  let n = 0, sum = 0;
  for (let i = 0; i < N; i++) {
    alpha[i] = region[i] ? Math.round(255 * s[i]) : 0;
    if (fg[i]) { n++; const df = near(Cf, L[i], A[i], B[i]), db = near(Cb, L[i], A[i], B[i]); sum += db / (df + db + 1e-6); }
  }
  return { alpha, conf: n ? sum / n : 0 };
}

function components(m, w, h, val) {
  const N = w * h, lab = new Int32Array(N).fill(-1), sizes = [], st = [];
  for (let s = 0; s < N; s++) {
    if (m[s] !== val || lab[s] >= 0) continue;
    const id = sizes.length; let n = 0; lab[s] = id; st.push(s);
    while (st.length) {
      const p = st.pop(); n++; const x = p % w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < N && m[q] === val && lab[q] < 0) { lab[q] = id; st.push(q); }
    }
    sizes.push(n);
  }
  return { lab, sizes };
}
function keepMain(m, w, h, minA) {
  const { lab, sizes } = components(m, w, h, 1), o = new Uint8Array(w * h);
  const big = Math.max(...sizes, 0);
  for (let i = 0; i < o.length; i++) if (lab[i] >= 0 && (sizes[lab[i]] >= minA || sizes[lab[i]] === big)) o[i] = 1;
  return o;
}
function smallComponents(m, w, h, maxA, region) {
  const { lab, sizes } = components(m, w, h, 1), out = [];
  // buraco = componente pequeno que não encosta na borda da região
  const touches = new Uint8Array(sizes.length);
  for (let i = 0; i < m.length; i++) {
    if (lab[i] < 0) continue;
    const x = i % w;
    for (const q of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (q < 0 || q >= m.length || !region[q]) { touches[lab[i]] = 1; break; }
  }
  for (let i = 0; i < m.length; i++) if (lab[i] >= 0 && sizes[lab[i]] <= maxA && !touches[lab[i]]) out.push(i);
  return out;
}

/** Reconstrói o fundo dentro de `hole` (1 = refazer) a partir do resto (pull-push). Retorna RGBA. */
export function reconstruct(data, w, h, hole) {
  const N = w * h, lv = [];
  let C = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { const k = hole[i] || data[i * 4 + 3] < 128 ? 0 : 1; C[i * 4] = data[i * 4] * k; C[i * 4 + 1] = data[i * 4 + 1] * k; C[i * 4 + 2] = data[i * 4 + 2] * k; C[i * 4 + 3] = k; }
  let cw = w, ch = h;
  lv.push({ C, w: cw, h: ch });
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, (cw + 1) >> 1), nh = Math.max(1, (ch + 1) >> 1), P = lv[lv.length - 1].C, Q = new Float32Array(nw * nh * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const s = (y * cw + x) * 4, t = ((y >> 1) * nw + (x >> 1)) * 4; for (let k = 0; k < 4; k++) Q[t + k] += P[s + k]; }
    for (let i = 0; i < nw * nh; i++) { const a = Q[i * 4 + 3]; if (a > 1) { for (let k = 0; k < 4; k++) Q[i * 4 + k] /= a; } }
    lv.push({ C: Q, w: nw, h: nh }); cw = nw; ch = nh;
  }
  for (let l = lv.length - 2; l >= 0; l--) {
    const F = lv[l], Cc = lv[l + 1];
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
      const i = (y * F.w + x) * 4, a = F.C[i + 3];
      if (a >= 1) continue;
      const fx = Math.min(Cc.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(Cc.h - 1, Math.max(0, (y - 0.5) / 2));
      const xa = Math.floor(fx), ya = Math.floor(fy), xb = Math.min(Cc.w - 1, xa + 1), yb = Math.min(Cc.h - 1, ya + 1), tx = fx - xa, ty = fy - ya;
      for (let k = 0; k < 3; k++) {
        const g = (xx, yy) => { const j = (yy * Cc.w + xx) * 4, b = Cc.C[j + 3]; return b > 0 && b < 1 ? Cc.C[j + k] / b : Cc.C[j + k]; };
        const v = (g(xa, ya) * (1 - tx) + g(xb, ya) * tx) * (1 - ty) + (g(xa, yb) * (1 - tx) + g(xb, yb) * tx) * ty;
        F.C[i + k] = F.C[i + k] + (1 - a) * v;
      }
      F.C[i + 3] = 1;
    }
  }
  const out = new Uint8ClampedArray(N * 4), T = lv[0].C;
  for (let i = 0; i < N; i++) { out[i * 4] = T[i * 4]; out[i * 4 + 1] = T[i * 4 + 1]; out[i * 4 + 2] = T[i * 4 + 2]; out[i * 4 + 3] = data[i * 4 + 3]; }
  return out;
}

/** Pixels do recorte com cor parecida com `rgb` (ΔE < tol). Para "vetorizar esta cor". */
export function colorMask(data, w, h, rgb, tol, alphaMin = 128) {
  const N = w * h, [L, A, B] = toLab(data, N), px = new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]), [l, a, b] = toLab(px, 1).map((x) => x[0]);
  const m = new Uint8Array(N), t2 = tol * tol;
  for (let i = 0; i < N; i++) { if (data[i * 4 + 3] < alphaMin) continue; const x = L[i] - l, y = A[i] - a, z = B[i] - b; if (x * x + y * y + z * z < t2) m[i] = 1; }
  return m;
}

/**
 * Fundo por textura: para fundos densos (folhagem, padrões), copia de outra parte
 * da própria arte a região que melhor continua a borda do buraco, e mistura as
 * emendas com a reconstrução suave. `avoid` marca pixels que não podem servir de
 * fonte (outros objetos). Retorna RGBA e a posição de origem usada.
 */
export function reconstructTexture(data, w, h, hole, avoid) {
  const N = w * h, smooth = reconstruct(data, w, h, hole);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) if (hole[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { rgba: smooth, offset: null };
  const holeF = Float32Array.from(hole), dil = boxMean(holeF, w, h, 6), ring = [], hp = [];
  for (let i = 0; i < N; i++) { if (hole[i]) hp.push(i); else if (dil[i] > 0 && (i & 1) === 0) ring.push(i); }
  const bad = new Uint8Array(N);
  for (let i = 0; i < N; i++) bad[i] = hole[i] || (avoid && avoid[i]) || data[i * 4 + 3] < 128 ? 1 : 0;
  // soma acumulada de "bad" para testar rapidamente se a fonte deslocada está limpa
  const W = w + 1, I = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x < w; x++) { r += bad[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + r; } }
  const badIn = (ax, ay, bx, by) => I[(by + 1) * W + bx + 1] - I[ay * W + bx + 1] - I[(by + 1) * W + ax] + I[ay * W + ax];
  const pad = 7, bw = x1 - x0, bh = y1 - y0;
  let best = null, bestS = Infinity;
  const step = Math.max(4, Math.round(Math.max(bw, bh) / 40));
  for (let dy = -y0 + pad; dy + y1 + pad < h; dy += step) for (let dx = -x0 + pad; dx + x1 + pad < w; dx += step) {
    if (Math.abs(dx) < bw / 2 && Math.abs(dy) < bh / 2) continue;
    if (badIn(x0 + dx - pad, y0 + dy - pad, x1 + dx + pad, y1 + dy + pad) > 0) continue; // fonte precisa estar limpa (com margem)
    let s = 0;
    for (const p of ring) { const q = p + dy * w + dx; for (let k = 0; k < 3; k++) { const e = data[p * 4 + k] - data[q * 4 + k]; s += e * e; } if (s > bestS) break; }
    if (s < bestS) { bestS = s; best = [dx, dy]; }
  }
  if (best) {
    const inside = boxMean(holeF, w, h, 4), out = new Uint8ClampedArray(smooth), off = best[1] * w + best[0];
    for (const p of hp) { const t = Math.min(1, Math.max(0, (inside[p] - 0.5) * 2)), q = p + off; for (let k = 0; k < 3; k++) out[p * 4 + k] = smooth[p * 4 + k] * (1 - t) + data[q * 4 + k] * t; }
    return { rgba: out, offset: best, method: "copia" };
  }
  return { rgba: quilt(data, w, h, hole, bad, smooth), offset: null, method: "blocos" };
}

/** Costura de textura em blocos: preenche o buraco de fora para dentro com blocos da própria arte. */
function quilt(data, w, h, hole, bad, smooth) {
  const N = w * h, T = Math.max(24, Math.round(Math.min(w, h) / 14)), ov = Math.round(T / 4), S = T + 2 * ov;
  const out = new Uint8ClampedArray(data), known = new Uint8Array(N);
  for (let i = 0; i < N; i++) known[i] = hole[i] ? 0 : 1;
  for (let i = 0; i < N; i++) if (hole[i]) { out[i * 4] = smooth[i * 4]; out[i * 4 + 1] = smooth[i * 4 + 1]; out[i * 4 + 2] = smooth[i * 4 + 2]; }
  // fontes: blocos S x S totalmente limpos
  const W = w + 1, I = new Int32Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let r = 0; for (let x = 0; x < w; x++) { r += bad[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + r; } }
  const clean = (ax, ay) => I[(ay + S) * W + ax + S] - I[ay * W + ax + S] - I[(ay + S) * W + ax] + I[ay * W + ax] === 0;
  const src = [], st = Math.max(4, Math.round(T / 5));
  for (let y = 0; y + S < h; y += st) for (let x = 0; x + S < w; x += st) if (clean(x, y)) src.push([x, y]);
  if (!src.length) return smooth;
  // blocos do buraco
  let tiles = [];
  for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
    let any = 0;
    for (let y = ty; y < Math.min(h, ty + T) && !any; y++) for (let x = tx; x < Math.min(w, tx + T); x++) if (hole[y * w + x]) { any = 1; break; }
    if (any) tiles.push([tx, ty]);
  }
  const knownCount = (tx, ty) => { let n = 0; for (let y = ty - ov; y < ty + T + ov; y += 2) for (let x = tx - ov; x < tx + T + ov; x += 2) if (x >= 0 && y >= 0 && x < w && y < h && known[y * w + x]) n++; return n; };
  while (tiles.length) {
    tiles.sort((a, b) => knownCount(b[0], b[1]) - knownCount(a[0], a[1]));
    const [tx, ty] = tiles.shift();
    let bs = Infinity, bsrc = src[0];
    for (const [sx, sy] of src) {
      let s = 0;
      for (let y = 0; y < S && s < bs; y += 3) {
        const yy = ty - ov + y; if (yy < 0 || yy >= h) continue;
        for (let x = 0; x < S; x += 3) {
          const xx = tx - ov + x; if (xx < 0 || xx >= w) continue;
          const p = yy * w + xx; if (!known[p]) continue;
          const q = (sy + y) * w + sx + x;
          const a = out[p * 4] - data[q * 4], b = out[p * 4 + 1] - data[q * 4 + 1], c = out[p * 4 + 2] - data[q * 4 + 2];
          s += a * a + b * b + c * c;
        }
      }
      if (s < bs) { bs = s; bsrc = [sx, sy]; }
    }
    const [sx, sy] = bsrc;
    for (let y = 0; y < S; y++) {
      const yy = ty - ov + y; if (yy < 0 || yy >= h) continue;
      for (let x = 0; x < S; x++) {
        const xx = tx - ov + x; if (xx < 0 || xx >= w) continue;
        const p = yy * w + xx; if (!hole[p]) continue;
        const q = (sy + y) * w + sx + x;
        // borda do bloco: mistura com o que já existe para esconder a emenda
        const edge = Math.min(x, y, S - 1 - x, S - 1 - y), t = known[p] ? Math.min(1, edge / ov) : 1;
        for (let k = 0; k < 3; k++) out[p * 4 + k] = out[p * 4 + k] * (1 - t) + data[q * 4 + k] * t;
        if (x >= ov && y >= ov && x < ov + T && y < ov + T) known[p] = 1;
      }
    }
  }
  return out;
}
