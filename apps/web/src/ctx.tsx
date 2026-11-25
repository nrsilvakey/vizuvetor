import { createContext, useContext } from "react";
import type { Assets, Doc } from "./store";
import { fontMetrics } from "./lib/image";

export interface Ctx {
  doc: Doc;
  update: (fn: (d: Doc) => Doc, merge?: boolean) => void;
  assets: Assets;
  bump: () => void; // força re-render quando assets mudam
  toast: (t: string) => void;
  originals: Map<string, ImageBitmap>;
}
export const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

// URLs de objeto para os assets (prévia em <image>)
const urls = new Map<Blob, string>();
export function assetUrl(assets: Assets, name?: string | null): string | undefined {
  if (!name) return;
  const b = assets.get(name);
  if (!b) return;
  let u = urls.get(b);
  if (!u) { u = URL.createObjectURL(b); urls.set(b, u); }
  return u;
}

// Fontes carregadas no navegador para a prévia do texto (mesmo arquivo que vai para o PDF)
const fonts = new Map<Blob, { family: string; upm: number; asc: number }>();
export async function ensureFont(assets: Assets, path: string) {
  const b = assets.get(path);
  if (!b) return null;
  let f = fonts.get(b);
  if (f) return f;
  const buf = await b.arrayBuffer();
  const m = fontMetrics(buf);
  const family = "vvf-" + Math.random().toString(36).slice(2, 8);
  const ff = new FontFace(family, buf);
  await ff.load();
  (document.fonts as any).add(ff);
  f = { family, ...m };
  fonts.set(b, f);
  return f;
}
export function fontInfo(assets: Assets, path: string) {
  const b = assets.get(path);
  return b ? fonts.get(b) : undefined;
}

export const DEFAULT_FONTS = ["fonts/DejaVuSans-Bold.ttf", "fonts/DejaVuSans.ttf"];
export async function loadDefaultFonts(assets: Assets) {
  for (const f of DEFAULT_FONTS) {
    if (assets.has(f)) continue;
    const r = await fetch(new URL(f, document.baseURI));
    if (r.ok) assets.set(f, new Blob([await r.arrayBuffer()], { type: "font/ttf" }));
  }
}
