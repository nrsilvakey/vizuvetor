import { useState } from "react";
import { useApp } from "../ctx";
import { ACCEPT, decode, sha256 } from "../lib/image";
import { Mode, newProject, uid } from "../model";

const MODES: [Mode, string, string][] = [
  ["camiseta", "Camiseta", "Frente, costas, mangas e gola como peças separadas"],
  ["placa", "Placa", "Uma peça com tamanho final em mm; aceita foto em perspectiva"],
  ["livre", "Arte livre", "Área de trabalho e recortes livres"],
];

export default function Importar({ onDone }: { onDone: () => void }) {
  const { doc, update, assets, originals, toast, bump } = useApp();
  const [mode, setMode] = useState<Mode>(doc.project?.mode || "camiseta");
  const [name, setName] = useState(doc.project?.name || "");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | File[]) {
    setBusy(true);
    try {
      let p = doc.project || newProject(name || "Nova arte", mode);
      if (!doc.project) p = { ...p, mode, name: name || (files[0]?.name.replace(/\.[^.]+$/, "") ?? "Nova arte") };
      const originals_ = [...p.originals];
      for (const f of Array.from(files)) {
        if (!ACCEPT.includes(f.type)) { toast(`${f.name}: formato não aceito (use PNG, JPEG ou WebP)`); continue; }
        const bmp = await decode(f); // aplica orientação EXIF; original fica intacto
        const id = uid("orig"), ext = f.type.split("/")[1].replace("jpeg", "jpg");
        const path = `originais/${id}.${ext}`;
        assets.set(path, f);
        originals.set(id, bmp);
        originals_.push({ id, path, sha256: await sha256(f), width_px: bmp.width, height_px: bmp.height });
      }
      if (!originals_.length) return;
      update((d) => ({ ...d, project: { ...p, originals: originals_ } }));
      bump();
      onDone();
    } catch (e: any) { toast(e.message || "Não consegui abrir a imagem"); }
    finally { setBusy(false); }
  }

  return (
    <section className="step importar">
      <div className="col">
        <h1>Importar a arte</h1>
        <p className="hint">PNG, JPEG ou WebP. Pode ser a imagem composta (mockup com frente, costas e mangas) ou várias imagens de referência separadas. O original é guardado intacto no projeto.</p>
        {!doc.project && (<>
          <label className="fld">Nome do projeto<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Família de Légua" /></label>
          <fieldset className="modes"><legend>Modo</legend>
            {MODES.map(([k, l, d]) => (
              <label key={k} className={"mode" + (mode === k ? " on" : "")}>
                <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} />
                <b>{l}</b><span>{d}</span>
              </label>
            ))}
          </fieldset>
        </>)}
        <label className={"drop" + (over ? " on" : "")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
          <input type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
          <strong>{busy ? "Lendo…" : doc.project ? "Adicionar outra imagem de referência" : "Soltar imagem aqui ou clicar para escolher"}</strong>
          <span>Unidades do projeto: milímetros</span>
        </label>
      </div>
      {doc.project && (
        <div className="col">
          <h2>Imagens do projeto</h2>
          <ul className="origs">
            {doc.project.originals.map((o) => (
              <li key={o.id}><b>{o.path.split("/").pop()}</b><span>{o.width_px} × {o.height_px} px · sha256 {o.sha256.slice(0, 10)}…</span></li>
            ))}
          </ul>
          <button className="btn main" onClick={onDone}>Definir as peças →</button>
        </div>
      )}
    </section>
  );
}
