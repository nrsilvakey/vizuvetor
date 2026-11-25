/* Exportador do PDF de 3 páginas rodando no navegador (Pyodide).
   Usa exatamente o mesmo código Python de services/worker/vizuvetor_worker. */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.8/full/";
let ready = null;

async function boot(base) {
  const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE + "pyodide.mjs");
  self.postMessage({ progress: "Carregando o Python (só na primeira vez)…" });
  const py = await loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage(["micropip", "pillow", "numpy", "fonttools", "pydantic", "charset-normalizer"]);
  const man = await (await fetch(base + "worker.json")).json();
  py.FS.mkdirTree("/vv/vizuvetor_worker");
  for (const [f, code] of Object.entries(man.files)) py.FS.writeFile("/vv/vizuvetor_worker/" + f, code);
  const urls = [];
  for (const w of man.wheels) {
    py.FS.writeFile("/tmp/" + w, new Uint8Array(await (await fetch(base + "wheels/" + w)).arrayBuffer()));
    urls.push("emfs:/tmp/" + w);
  }
  const mp = py.pyimport("micropip");
  await mp.install.callKwargs(urls, { deps: false });
  await py.runPythonAsync("import sys; sys.path.insert(0, '/vv'); import vizuvetor_worker.export_pdf");
  return py;
}

self.onmessage = async (e) => {
  const { base, project, files } = e.data;
  try {
    ready = ready || boot(base);
    const py = await ready;
    self.postMessage({ progress: "Montando as 3 páginas…" });
    const root = "/proj-" + Date.now();
    py.FS.mkdirTree(root);
    for (const [name, buf] of Object.entries(files)) {
      const p = root + "/" + name;
      py.FS.mkdirTree(p.slice(0, p.lastIndexOf("/")));
      py.FS.writeFile(p, new Uint8Array(buf));
    }
    py.FS.writeFile(root + "/projeto.json", JSON.stringify(project));
    py.globals.set("ROOT", root);
    const res = await py.runPythonAsync(`
import json
from vizuvetor_worker.export_pdf import export, ExportError
try:
    m = export(ROOT + "/projeto.json", ROOT + "/saida.pdf", ROOT + "/manifesto.json")
    out = json.dumps({"ok": True, "manifesto": m}, ensure_ascii=False)
except ExportError as err:
    out = json.dumps({"ok": False, "erro": str(err)}, ensure_ascii=False)
out`);
    const r = JSON.parse(res);
    if (!r.ok) { self.postMessage({ error: r.erro }); return; }
    const pdf = py.FS.readFile(root + "/saida.pdf");
    self.postMessage({ done: true, pdf: pdf.buffer, manifesto: r.manifesto }, [pdf.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
