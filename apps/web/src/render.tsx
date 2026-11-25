// Renderização SVG dos objetos em mm — a mesma geometria que vai para o PDF.
import { useEffect, useState } from "react";
import { assetUrl, ensureFont, fontInfo } from "./ctx";
import { Obj, Piece } from "./model";
import type { Assets } from "./store";

export type PageFilter = "all" | "fundo" | "vetores";

export function objTransform(pc: Piece, o: Obj) {
  const t = o.transform;
  return `translate(${pc.page_x_mm + t.x_mm} ${pc.page_y_mm + t.y_mm}) rotate(${t.rotation_deg}) scale(${t.scale})`;
}

export function includeOnPage(o: Obj, f: PageFilter) {
  if (!o.visible) return false;
  if (f === "fundo") return o.type === "background";
  if (f === "vetores") return o.type === "vector" || o.type === "text" || (o.type === "background" && o.kind === "vector");
  return true;
}

export function ObjBody({ o, assets }: { o: Obj; assets: Assets }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (o.type === "text" && !fontInfo(assets, o.font_path)) ensureFont(assets, o.font_path).then(() => force((x) => x + 1));
  }, [o, assets]);
  switch (o.type) {
    case "vector":
      return <>{o.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill} fillRule={p.fill_rule} stroke={p.stroke || undefined} strokeWidth={p.stroke ? p.stroke_width_mm : undefined} />)}</>;
    case "background":
      if (o.kind === "vector") return <>{o.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill} fillRule={p.fill_rule} />)}</>;
      return <image href={assetUrl(assets, o.asset)} width={o.width_mm!} height={o.height_mm!} preserveAspectRatio="none" />;
    case "bitmap":
      return <image href={assetUrl(assets, o.asset)} width={o.width_mm} height={o.height_mm} preserveAspectRatio="none" />;
    case "text": {
      const fi = fontInfo(assets, o.font_path), mm = (o.size_pt * 25.4) / 72;
      const y = fi ? (mm * fi.asc) / fi.upm : mm * 0.93;
      return (
        <text x={0} y={y} fontFamily={fi?.family || "sans-serif"} fontSize={mm} fill={o.fill}
          textAnchor={o.align === "center" ? "middle" : o.align === "right" ? "end" : "start"}
          letterSpacing={(o.letter_spacing_pt * 25.4) / 72} style={{ whiteSpace: "pre" }}>{o.content.normalize("NFC")}</text>
      );
    }
  }
}

export function PieceObjects({ pc, assets, filter = "all" }: { pc: Piece; assets: Assets; filter?: PageFilter }) {
  return (
    <>
      {[...pc.objects].sort((a, b) => a.z - b.z).filter((o) => includeOnPage(o, filter)).map((o) => (
        <g key={o.id} transform={objTransform(pc, o)}><ObjBody o={o} assets={assets} /></g>
      ))}
    </>
  );
}
