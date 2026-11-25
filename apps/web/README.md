# apps/web — VizuVetor no navegador (etapa 2)

React + TypeScript (Vite). Roda inteiro no navegador, sem servidor:

1. **Importar** — PNG/JPEG/WebP, orientação EXIF aplicada, original guardado intacto (sha256).
2. **Peças** — retângulo ou 4 cantos (perspectiva/homografia), papel da peça, tamanho e sangria em mm.
3. **Separar** — motor do VizuVetor (`src/lib/engine.worker.js`) por peça; pincéis Vetor/Imagem/Fundo
   que prevalecem na próxima separação; tudo entra como sugestão não aprovada.
4. **Editar** — canvas SVG em mm, lista de objetos, mover/escalar/girar, ordem, visibilidade, cores,
   dividir/mesclar vetores, texto com fonte (TTF/OTF), substituir imagem/fundo, comparar com original,
   desfazer/refazer, aprovação.
5. **Exportar** — prévia das 3 páginas, pendências, PPI; PDF gerado pelo worker Python via Pyodide.

Projeto: arquivo `.vizuvetor` (ZIP: `manifest.json`, `projeto.json` no esquema v1, `app.json`, originais,
recortes, assets e fontes) + rascunho automático no IndexedDB.

    npm install && npm run dev
    npm run build   # dist/ estático (publicado em opencriativa.com.br/vizuvetor/app/)
