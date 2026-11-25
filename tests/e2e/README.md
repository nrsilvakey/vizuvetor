# Testes ponta a ponta do app web (Playwright)

Arquivos de trabalho em `/tmp/e2e/` (imagens de entrada, capturas, projeto salvo e PDF).

    mkdir -p /tmp/e2e && python3 gerar_imagens.py          # mockup de camiseta e foto de placa
    cd ../../apps/web && npm run build && npx vite preview --port 4173 &
    python3 fluxo_completo.py      # importar, peças, separar, pincel, editar, salvar, reabrir, PDF
    python3 placa_perspectiva.py   # modo placa com 4 cantos
    URL=https://opencriativa.com.br/vizuvetor/app/ python3 fluxo_completo.py   # contra o site

Variáveis: `URL` (padrão http://localhost:4173/) e `CHROME` (caminho do navegador).

## Modo ilustração com arte real (não versionada)

A arte "Família de Légua" é de cliente e **não** fica no repositório. Com ela em `/tmp/e2e/familia.png`:

    python3 ilustracao_familia.py "[422,603]"   # x,y (px do painel) de um ponto amarelo do letreiro

Fluxo: frente marcada → tipo Ilustração → laço no grupo → caixa no letreiro → fundo refeito por
textura → "Vetorizar uma cor" no amarelo das letras → PDF (pág. 1: 3 bitmaps; pág. 2: fundo; pág. 3: vetor).

## Modo uniforme com arte real (não versionada)

Com o mockup do Lyon em `/tmp/e2e/lyon.jpg` (ou `ARTE=...`):

    python3 uniforme_lyon.py

Fluxo: frente marcada → contorno da peça (descarta estádio) → tipo Uniforme → PDF.
Esperado: pág. 2 = fundo retangular na cor base (vetor, aplicável a qualquer molde); pág. 3 = faixa,
gola, listras, escudo e logo em vetor; nenhum bitmap.
