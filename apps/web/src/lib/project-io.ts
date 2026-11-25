// Salvar/reabrir o projeto (.vizuvetor = ZIP) e exportar o PDF.
import JSZip from "jszip";
import { AppState, Project } from "../model";
import type { Assets, Doc } from "../store";

export const FORMAT = "vizuvetor-projeto";
export const FORMAT_VERSION = 1;

export async function saveProject(doc: Doc, assets: Assets): Promise<Blob> {
  if (!doc.project) throw new Error("Nenhum projeto aberto");
  const z = new JSZip();
  const used = usedAssets(doc);
  const hashes: Record<string, number> = {};
  for (const name of used) {
    const b = assets.get(name);
    if (!b) throw new Error(`Arquivo do projeto ausente: ${name}`);
    z.file(name, b);
    hashes[name] = b.size;
  }
  z.file("projeto.json", JSON.stringify(doc.project, null, 2));
  z.file("app.json", JSON.stringify(doc.app, null, 2));
  z.file("manifest.json", JSON.stringify({ formato: FORMAT, versao: FORMAT_VERSION, salvo_em: new Date().toISOString(), revisao: doc.project.revision, arquivos: hashes }, null, 2));
  return z.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function openProject(file: Blob): Promise<{ doc: Doc; assets: Assets }> {
  let z: JSZip;
  try { z = await JSZip.loadAsync(file); } catch { throw new Error("Arquivo não é um projeto .vizuvetor válido"); }
  const man = z.file("manifest.json"), pj = z.file("projeto.json");
  if (!man || !pj) throw new Error("Projeto incompleto (faltam manifest.json ou projeto.json)");
  const m = JSON.parse(await man.async("string"));
  if (m.formato !== FORMAT) throw new Error("Formato desconhecido");
  if (m.versao > FORMAT_VERSION) throw new Error("Projeto salvo numa versão mais nova do VizuVetor");
  const project: Project = JSON.parse(await pj.async("string"));
  if (project.schema_version !== 1) throw new Error("Versão de esquema não suportada");
  const appf = z.file("app.json");
  const app: AppState = appf ? JSON.parse(await appf.async("string")) : { sources: [], settings: undefined as any };
  const assets: Assets = new Map();
  for (const name of Object.keys(m.arquivos || {})) {
    const f = z.file(name);
    if (!f) throw new Error(`Arquivo ausente no projeto: ${name}`);
    const type = name.endsWith(".png") ? "image/png" : name.endsWith(".ttf") ? "font/ttf" : "application/octet-stream";
    assets.set(name, new Blob([await f.async("arraybuffer")], { type }));
  }
  return { doc: { project, app }, assets };
}

export function usedAssets(doc: Doc): string[] {
  const s = new Set<string>();
  const p = doc.project!;
  for (const o of p.originals) s.add(o.path);
  for (const pc of p.pieces) for (const o of pc.objects) {
    if ("asset" in o && o.asset) s.add(o.asset);
    if (o.type === "text") s.add(o.font_path);
  }
  for (const src of doc.app.sources) { if (src.raster) s.add(src.raster); if (src.forceMap) s.add(src.forceMap); }
  return [...s];
}

let pdfWorker: Worker | null = null;
export async function exportPdf(doc: Doc, assets: Assets, onProgress: (t: string) => void): Promise<{ pdf: Blob; manifesto: any }> {
  const p = doc.project!;
  const files: Record<string, ArrayBuffer> = {};
  for (const pc of p.pieces) for (const o of pc.objects) {
    const names = [("asset" in o && o.asset) || null, o.type === "text" ? o.font_path : null].filter(Boolean) as string[];
    for (const n of names) {
      const b = assets.get(n);
      if (!b) throw new Error(`Arquivo ausente: ${n}`);
      files[n] = await b.arrayBuffer();
    }
  }
  if (!pdfWorker) pdfWorker = new Worker(new URL("./pdf.worker.js", import.meta.url), { type: "module" });
  const base = new URL("py/", document.baseURI).href;
  return new Promise((resolve, reject) => {
    pdfWorker!.onmessage = (e) => {
      const m = e.data;
      if (m.progress) return onProgress(m.progress);
      if (m.error) return reject(new Error(m.error));
      if (m.done) resolve({ pdf: new Blob([m.pdf], { type: "application/pdf" }), manifesto: m.manifesto });
    };
    pdfWorker!.onerror = (e) => reject(new Error(e.message || "falha no exportador"));
    pdfWorker!.postMessage({ base, project: p, files }, Object.values(files));
  });
}

/** Nome de arquivo seguro, sem perder as letras acentuadas ("Família" -> "Familia"). */
export const slug = (s: string) => (s || "arte").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "arte";

export function download(b: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(b);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
