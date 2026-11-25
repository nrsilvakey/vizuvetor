// Identificação de elementos por IA (Claude, via api/analisar.php no servidor).
// A imagem da peça é reduzida e enviada; a chave da API fica só no servidor.
import { canvas } from "./image";

export type IaTipo = "texto" | "numero" | "logo" | "escudo" | "listra" | "faixa" | "personagem" | "ilustracao" | "ornamento" | "padrao" | "fundo" | "marca_terceiros" | "etiqueta_mockup" | "cenario_mockup";
export type IaTratamento = "texto_vivo" | "vetor" | "bitmap_recortado" | "fundo" | "descartar";
export interface IaElemento {
  id: string; tipo: IaTipo; rotulo: string; texto?: string; estilo_fonte?: string; cor?: string; contorno?: string;
  tratamento: IaTratamento; confianca: number;
  box: { x: number; y: number; w: number; h: number }; // em px do recorte da peça
  usar: boolean; feito?: boolean;
}
export interface IaResultado { tipo_de_arte: "uniforme" | "ilustracao" | "chapada"; cor_base?: string; elementos: IaElemento[]; modelo?: string; uso?: any }

export const TIPO_LABEL: Record<IaTipo, string> = {
  texto: "Texto", numero: "Número", logo: "Logo", escudo: "Escudo", listra: "Listra", faixa: "Faixa", personagem: "Personagem",
  ilustracao: "Ilustração", ornamento: "Ornamento", padrao: "Padrão", fundo: "Fundo", marca_terceiros: "Marca de terceiros",
  etiqueta_mockup: "Etiqueta do mockup", cenario_mockup: "Cenário do mockup",
};
export const TRAT_LABEL: Record<IaTratamento, string> = { texto_vivo: "texto editável", vetor: "vetor", bitmap_recortado: "bitmap recortado", fundo: "fundo", descartar: "descartar" };
export const TRAT_COR: Record<IaTratamento, string> = { texto_vivo: "#ff8a00", vetor: "#e4003a", bitmap_recortado: "#1f9d55", fundo: "#2f7df6", descartar: "#777" };

const SENHA_KEY = "vizuvetor.senha_ia";

export async function analisar(ras: ImageBitmap, contexto: string): Promise<IaResultado> {
  const k = Math.min(1, 1568 / Math.max(ras.width, ras.height));
  const [c, x] = canvas(Math.round(ras.width * k), Math.round(ras.height * k));
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(ras, 0, 0, c.width, c.height);
  const imagem = c.toDataURL("image/jpeg", 0.9).split(",")[1];
  let senha = sessionStorage.getItem(SENHA_KEY) || "";
  for (let tent = 0; tent < 2; tent++) {
    const r = await fetch("api/analisar.php", {
      method: "POST",
      headers: { "content-type": "application/json", ...(senha ? { "x-vv-senha": senha } : {}) },
      body: JSON.stringify({ imagem, tipo_midia: "image/jpeg", contexto }),
    });
    let j: any = null;
    try { j = await r.json(); } catch { /* resposta não-JSON */ }
    if (r.status === 401 && tent === 0) {
      senha = window.prompt("Senha da equipe para usar a IA:") || "";
      if (!senha) throw new Error("Análise cancelada (sem senha)");
      sessionStorage.setItem(SENHA_KEY, senha);
      continue;
    }
    if (!r.ok || !j?.ok) throw new Error(j?.erro || `Falha na análise (HTTP ${r.status})`);
    return normalizar(j.resultado, ras.width, ras.height, j);
  }
  throw new Error("Senha da equipe incorreta");
}

export function normalizar(res: any, W: number, H: number, meta: any = {}): IaResultado {
  const els: IaElemento[] = [];
  (res?.elementos || []).forEach((e: any, i: number) => {
    const b = (e.caixa || []).map(Number);
    if (b.length !== 4 || b.some((v: number) => !isFinite(v))) return;
    let [x0, y0, x1, y1] = b;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    // folga de 1,5% para a caixa não cortar a borda do elemento
    const px = (x1 - x0) * 0.015 + 2, py = (y1 - y0) * 0.015 + 2;
    const X0 = Math.max(0, (x0 - px) / 1000 * W), Y0 = Math.max(0, (y0 - py) / 1000 * H);
    const X1 = Math.min(W, (x1 + px) / 1000 * W), Y1 = Math.min(H, (y1 + py) / 1000 * H);
    if (X1 - X0 < 4 || Y1 - Y0 < 4) return;
    const trat: IaTratamento = e.tratamento || "vetor";
    els.push({
      id: "ia" + i, tipo: e.tipo, rotulo: e.rotulo || e.tipo, texto: e.texto, estilo_fonte: e.estilo_fonte, cor: e.cor, contorno: e.contorno,
      tratamento: trat, confianca: Math.max(0, Math.min(1, +e.confianca || 0)),
      box: { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 },
      usar: trat !== "fundo" && trat !== "vetor", // vetor e fundo já saem do motor; o resto precisa de ação
    });
  });
  return { tipo_de_arte: res?.tipo_de_arte || "chapada", cor_base: res?.cor_base, elementos: els, modelo: meta.modelo, uso: meta.uso };
}
