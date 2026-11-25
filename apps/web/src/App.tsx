import { useCallback, useEffect, useRef, useState } from "react";
import { AppCtx, loadDefaultFonts } from "./ctx";
import { decode } from "./lib/image";
import { download, openProject, saveProject, slug } from "./lib/project-io";
import { DEFAULT_SETTINGS } from "./model";
import { autosave, clearAutosave, emptyDoc, loadAutosave, useDoc } from "./store";
import Importar from "./steps/Importar";
import Pecas from "./steps/Pecas";
import Separar from "./steps/Separar";
import Editor from "./steps/Editor";
import Exportar from "./steps/Exportar";

const STEPS = [
  ["importar", "1 Importar"], ["pecas", "2 Peças"], ["separar", "3 Separar"], ["editar", "4 Editar"], ["exportar", "5 Exportar"],
] as const;
type Step = (typeof STEPS)[number][0];

export default function App() {
  const { doc, update, undo, redo, canUndo, canRedo, reset, assets } = useDoc();
  const [step, setStep] = useState<Step>("importar");
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [msg, setMsg] = useState("");
  const toastT = useRef<number>();
  const toast = useCallback((t: string) => { setMsg(t); clearTimeout(toastT.current); toastT.current = window.setTimeout(() => setMsg(""), 3500); }, []);
  const originals = useRef(new Map<string, ImageBitmap>()).current;
  const [rascunho, setRascunho] = useState<{ at: number } | null>(null);
  const fileOpen = useRef<HTMLInputElement>(null);

  useEffect(() => { loadDefaultFonts(assets).then(bump); loadAutosave().then((r) => r && setRascunho({ at: r.at })); }, [assets, bump]);
  useEffect(() => {
    if (!doc.project) return;
    const t = setTimeout(() => autosave(doc, assets), 800);
    return () => clearTimeout(t);
  }, [doc, assets]);

  async function hydrate(d: typeof doc, a: Map<string, Blob>) {
    assets.clear();
    for (const [k, v] of a) assets.set(k, v);
    await loadDefaultFonts(assets);
    originals.clear();
    for (const o of d.project?.originals || []) {
      const b = assets.get(o.path);
      if (b) originals.set(o.id, await decode(b));
    }
    if (!d.app.settings) d.app.settings = { ...DEFAULT_SETTINGS };
    reset(d);
    setStep(d.project?.pieces.some((p) => p.objects.length) ? "editar" : d.project?.pieces.length ? "pecas" : "importar");
    bump();
  }

  async function recuperar() {
    const r = await loadAutosave();
    setRascunho(null);
    if (r) { await hydrate(r.doc, r.assets); toast("Rascunho recuperado"); }
  }
  async function abrir(f: File) {
    try { const r = await openProject(f); await hydrate(r.doc, r.assets); toast("Projeto aberto: " + r.doc.project?.name); }
    catch (e: any) { toast(e.message); }
  }
  async function salvar() {
    try { const b = await saveProject(doc, assets); download(b, slug(doc.project?.name || "projeto") + ".vizuvetor"); toast("Projeto salvo"); }
    catch (e: any) { toast(e.message); }
  }
  function novo() {
    if (doc.project && !confirmDiscard()) return;
    originals.clear(); reset(emptyDoc()); clearAutosave(); setStep("importar");
  }
  const [askNew, setAskNew] = useState(false);
  function confirmDiscard() { setAskNew(true); return false; }

  const has = !!doc.project;
  const ctx = { doc, update, assets, bump, toast, originals };
  return (
    <AppCtx.Provider value={ctx}>
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" /><path d="M17 0v34M0 17h34" stroke="currentColor" strokeWidth="2.5" /></svg>
          <b>VizuVetor</b>
          {has && <input className="pname" aria-label="Nome do projeto" value={doc.project!.name}
            onChange={(e) => update((d) => ({ ...d, project: { ...d.project!, name: e.target.value } }), true)} />}
        </div>
        <nav className="steps" aria-label="Etapas">
          {STEPS.map(([k, l]) => (
            <button key={k} aria-current={step === k} disabled={!has && k !== "importar"} onClick={() => setStep(k)}>{l}</button>
          ))}
        </nav>
        <div className="acts">
          <button onClick={undo} disabled={!canUndo} title="Desfazer (⌘Z)">↶</button>
          <button onClick={redo} disabled={!canRedo} title="Refazer (⇧⌘Z)">↷</button>
          <button onClick={() => fileOpen.current?.click()}>Abrir</button>
          <button onClick={salvar} disabled={!has}>Salvar</button>
          <button onClick={novo} disabled={!has}>Novo</button>
          <input ref={fileOpen} type="file" accept=".vizuvetor,.zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = ""; }} />
        </div>
      </header>
      {rascunho && !has && (
        <div className="banner">Há um rascunho salvo automaticamente em {new Date(rascunho.at).toLocaleString("pt-BR")}.
          <button onClick={recuperar}>Recuperar</button><button onClick={() => { clearAutosave(); setRascunho(null); }}>Descartar</button></div>
      )}
      {askNew && (
        <div className="banner warn">Começar um projeto novo descarta o atual (salve antes se quiser guardar).
          <button onClick={() => { setAskNew(false); originals.clear(); reset(emptyDoc()); clearAutosave(); setStep("importar"); }}>Descartar e começar</button>
          <button onClick={() => setAskNew(false)}>Cancelar</button></div>
      )}
      <main>
        {step === "importar" && <Importar onDone={() => setStep("pecas")} />}
        {step === "pecas" && has && <Pecas onDone={() => setStep("separar")} />}
        {step === "separar" && has && <Separar onDone={() => setStep("editar")} />}
        {step === "editar" && has && <Editor />}
        {step === "exportar" && has && <Exportar />}
      </main>
      <div className={"toast" + (msg ? " on" : "")} role="status">{msg}</div>
    </AppCtx.Provider>
  );
}
