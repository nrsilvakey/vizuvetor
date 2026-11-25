// Modelo de projeto v1 — espelho de services/worker/vizuvetor_worker/schema.py
// (fonte única: packages/project-schema/schema/project.schema.json).
// Medidas em mm, origem no canto superior esquerdo, Y para baixo.

export type Mode = "camiseta" | "placa" | "livre";
export type Role = "frente" | "costas" | "manga_esquerda" | "manga_direita" | "gola" | "placa" | "area";

export interface Transform { x_mm: number; y_mm: number; scale: number; rotation_deg: number }
export interface VectorPath { d: string; fill: string; fill_rule: "evenodd" | "nonzero"; stroke?: string | null; stroke_width_mm?: number }

interface Base {
  id: string; name: string; z: number; transform: Transform; visible: boolean;
  approved: boolean; confidence?: number | null; origin: "motor" | "manual";
}
export interface VectorObject extends Base { type: "vector"; paths: VectorPath[] }
export interface TextObject extends Base {
  type: "text"; content: string; font_path: string; size_pt: number; fill: string;
  align: "left" | "center" | "right"; letter_spacing_pt: number; ocr_text?: string | null; reviewed: boolean;
}
export interface BitmapObject extends Base { type: "bitmap"; asset: string; width_mm: number; height_mm: number; source_ppi?: number | null }
export interface BackgroundObject extends Base {
  type: "background"; kind: "bitmap" | "vector"; asset?: string | null; width_mm?: number | null; height_mm?: number | null;
  paths: VectorPath[]; reconstructed_mask?: string | null; status: "rascunho" | "aprovado";
}
export type Obj = VectorObject | TextObject | BitmapObject | BackgroundObject;

export interface Piece {
  id: string; role: Role; width_mm: number; height_mm: number; page_x_mm: number; page_y_mm: number; bleed_mm: number; objects: Obj[];
}
export interface ExportOptions {
  page_width_mm?: number | null; page_height_mm?: number | null; page_margin_mm: number;
  text_mode_page1: "texto" | "curvas"; min_ppi: number;
}
export interface Original { id: string; path: string; sha256: string; width_px: number; height_px: number }
export interface Project {
  schema_version: 1; id: string; name: string; mode: Mode; unit: "mm"; revision: number;
  originals: Original[]; pieces: Piece[]; export: ExportOptions;
}

// ---- dados do editor que não vão para o PDF (guardados em app.json no .vizuvetor) ----
export type Quad = [number, number][]; // 4 cantos em px do original (sentido horário a partir do sup. esq.)
export interface PieceSource {
  pieceId: string; originalId: string;
  rect?: { x: number; y: number; w: number; h: number }; // px do original
  quad?: Quad; // placa: perspectiva
  raster?: string; // asset do recorte/retificado (px)
  pxW?: number; pxH?: number;
  forceMap?: string; // asset PNG com as correções de pincel (R=vetor, G=imagem, B=fundo)
  artType?: ArtType; // como separar esta peça
  cuts?: { objId: string; mask: string }[]; // recortes de objeto (máscara alfa em px do recorte)
}
export type ArtType = "cores" | "ilustracao";
export const ART_LABEL: Record<ArtType, string> = {
  cores: "Chapada / uniforme (separa por cor)",
  ilustracao: "Ilustração (separa por objeto)",
};
export interface AppState { sources: PieceSource[]; settings: EngineSettings }
export interface EngineSettings { thr: number; de: number; prec: number; speck: number; stack: boolean; res: number; tol: number; fillBg: boolean }
export const DEFAULT_SETTINGS: EngineSettings = { thr: 55, de: 6, prec: 0.5, speck: 30, stack: true, res: 1600, tol: 3, fillBg: true };

export const ROLE_LABEL: Record<Role, string> = {
  frente: "Frente", costas: "Costas", manga_esquerda: "Manga esquerda", manga_direita: "Manga direita",
  gola: "Gola", placa: "Placa", area: "Área",
};
export const TYPE_LABEL = { vector: "Vetor", text: "Texto", bitmap: "Imagem recortada", background: "Fundo" } as const;

export const PT_PER_MM = 72 / 25.4;
export const uid = (p = "o") => p + "-" + Math.random().toString(36).slice(2, 9);
export const T0 = (): Transform => ({ x_mm: 0, y_mm: 0, scale: 1, rotation_deg: 0 });

export function newProject(name: string, mode: Mode): Project {
  return {
    schema_version: 1, id: uid("p"), name, mode, unit: "mm", revision: 0, originals: [], pieces: [],
    export: { page_margin_mm: 0, text_mode_page1: "texto", min_ppi: 150, page_width_mm: null, page_height_mm: null },
  };
}

/** Distribui as peças lado a lado na página (20 mm de espaço), como na pág. 1 do PDF. */
export function layoutPieces(p: Project): Project {
  let x = 0;
  const pieces = p.pieces.map((pc) => { const n = { ...pc, page_x_mm: x + pc.bleed_mm, page_y_mm: pc.bleed_mm }; x += pc.width_mm + 2 * pc.bleed_mm + 20; return n; });
  return { ...p, pieces };
}

export function pageSize(p: Project): [number, number] {
  if (p.export.page_width_mm && p.export.page_height_mm) return [p.export.page_width_mm, p.export.page_height_mm];
  const W = Math.max(1, ...p.pieces.map((pc) => pc.page_x_mm + pc.width_mm + pc.bleed_mm)) + p.export.page_margin_mm;
  const H = Math.max(1, ...p.pieces.map((pc) => pc.page_y_mm + pc.height_mm + pc.bleed_mm)) + p.export.page_margin_mm;
  return [W, H];
}

/** Pendências que fazem o PDF sair como rascunho. */
export function pendencias(p: Project): string[] {
  const out: string[] = [];
  for (const pc of p.pieces) for (const o of pc.objects) {
    if (!o.approved) out.push(`${ROLE_LABEL[pc.role]}: "${o.name || o.id}" não aprovado`);
    if (o.type === "background" && o.status !== "aprovado") out.push(`${ROLE_LABEL[pc.role]}: fundo em rascunho`);
    if (o.type === "text" && !o.reviewed) out.push(`${ROLE_LABEL[pc.role]}: texto "${o.content}" sem revisão de acentos`);
  }
  if (!p.pieces.length) out.push("Nenhuma peça definida");
  return out;
}
