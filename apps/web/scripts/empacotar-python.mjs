// Empacota o worker Python (mesmo código de services/worker) num único JSON para o
// navegador (Pyodide). Evita servir arquivos .py soltos na hospedagem.
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, "../../../services/worker/vizuvetor_worker");
const pub = path.resolve(here, "../public/py");
fs.rmSync(path.join(pub, "vizuvetor_worker"), { recursive: true, force: true });
const files = {};
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".py"))) files[f] = fs.readFileSync(path.join(src, f), "utf8");
const wheels = fs.readdirSync(path.join(pub, "wheels")).filter((f) => f.endsWith(".whl"));
fs.writeFileSync(path.join(pub, "worker.json"), JSON.stringify({ files, wheels }));
fs.rmSync(path.join(pub, "manifest.json"), { force: true });
console.log(`worker Python: ${Object.keys(files).length} arquivos, ${wheels.length} wheels`);
