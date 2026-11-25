# Testes ponta a ponta do app web (Playwright)

Arquivos de trabalho em `/tmp/e2e/` (imagens de entrada, capturas, projeto salvo e PDF).

    mkdir -p /tmp/e2e && python3 gerar_imagens.py          # mockup de camiseta e foto de placa
    cd ../../apps/web && npm run build && npx vite preview --port 4173 &
    python3 fluxo_completo.py      # importar, peças, separar, pincel, editar, salvar, reabrir, PDF
    python3 placa_perspectiva.py   # modo placa com 4 cantos
    URL=https://opencriativa.com.br/vizuvetor/app/ python3 fluxo_completo.py   # contra o site

Variáveis: `URL` (padrão http://localhost:4173/) e `CHROME` (caminho do navegador).
