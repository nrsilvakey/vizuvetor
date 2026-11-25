# VizuVetor

Transforma artes geradas por IA em projetos editáveis e exporta um **PDF de exatamente
3 páginas** para o CorelDRAW (1 arte completa · 2 só fundo · 3 todos os vetores), com
SVG em camadas para o VectorCraft. Interface em português do Brasil.

## Estado atual (etapa 2 de 5)

| Parte | Pasta | Estado |
|---|---|---|
| Modelo de projeto v1 (mm, peças, objetos, revisões) | `services/worker/vizuvetor_worker/schema.py` → `packages/project-schema` | ✅ feito, JSON Schema gerado |
| Exportador do PDF de 3 páginas | `services/worker/vizuvetor_worker/export_pdf.py` | ✅ feito, 20 testes passando |
| Fixture sintética (camiseta frente/costas) | `tests/fixtures/make_fixture.py` | ✅ feita |
| Importação no CorelDRAW | `docs/checklist-coreldraw.md` | 🟡 abriu corretamente no Corel (Mac); itens do checklist a detalhar |
| Protótipo VizuVetor (separação no navegador) | `apps/vizuvetor` | ✅ no ar em https://opencriativa.com.br/vizuvetor/ |
| App web (React/Vite) ponta a ponta | `apps/web` | ✅ importar · peças (retângulo e 4 cantos com perspectiva) · separar com pincel · editor · salvar/reabrir `.vizuvetor` · PDF no navegador (Pyodide) |
| API + fila + PostgreSQL | `services/api` | ⬜ não iniciado — o app funciona sem servidor; a API entra com o VPS |
| OCR, segmentação, vetorização no worker | `services/worker` | ⬜ não iniciado (etapa 3), precisa de VPS |
| Desktop (Tauri, Windows/macOS) | `apps/desktop` | ⬜ não iniciado (etapa 4), precisa de GitHub + certificados |

Nada nas pastas "não iniciado" tem código: só o README explicando o que entra ali.

## Rodar

Requisitos: Python 3.10+.

```bash
cd services/worker
pip install -e ".[test]"            # reportlab, pypdf, fonttools, uharfbuzz, pillow, numpy, pydantic
python3 ../../tests/fixtures/make_fixture.py
python3 -m vizuvetor_worker exportar ../../tests/fixtures/camiseta_sintetica/projeto.json saida.pdf --manifesto saida.json
python3 -m pytest -q                # 20 testes
```

App web:

```bash
cd apps/web
npm install
npm run dev        # desenvolvimento
npm run build      # gera dist/ (copia o worker Python para public/py)
```

O PDF do app web é gerado no navegador pelo **mesmo código Python** do worker,
rodando no Pyodide (carregado de cdn.jsdelivr.net na primeira exportação).
PDF do navegador e do Python nativo: idênticos pixel a pixel (testado).

Gerar o JSON Schema depois de mudar o modelo:

```bash
python3 scripts/gerar_schema.py
```

## O que os testes garantem

Exatamente 3 páginas com rótulos; tamanho físico em mm; página 3 sem nenhuma imagem
(busca recursiva); página 1 com objetos independentes, bitmap com máscara alfa e fonte
incorporada; acentos extraíveis; página 2 só fundo e em registro com a 1; furo vazado
na página 3; texto vivo e em curvas em registro (≤ 0,15 mm); estado de rascunho; aviso
de PPI baixo; página 3 vazia; fonte com licença restrita vira curvas; entradas inválidas
(asset ausente, imagem corrompida, arco, glifo faltando, ID repetido, unidade errada);
TrimBox/BleedBox com sangria; sem fontes fantasmas. Detalhes em `docs/contrato-pdf.md`.

## Limitações observadas

- Sem kerning/ligaduras no texto (desligados para a pág. 3 ficar em registro com a 1).
- Cores RGB; CMYK/PDF-X só com perfil ICC validado com a gráfica.
- A fixture é sintética: a arte real de camiseta ("Família de Légua") ainda precisa de validação manual.
- Fonte de teste: DejaVu Sans (licença em `tests/fixtures/fonts/LICENSE-DejaVu.txt`).

## Etapa 2 — o que foi verificado (teste ponta a ponta no Chrome)

- Mockup de camiseta: 4 peças marcadas (frente, costas, 2 mangas), separação: moldura, estrela e letras em vetor; esfera sombreada como imagem recortada; céu interno como fundo reconstruído.
- Pincel "Imagem" sobre parte da estrela: na nova separação aquela faixa virou bitmap.
- Texto com acento adicionado, revisado e aprovado; arrastar no canvas e desfazer/refazer.
- Salvar `.vizuvetor`, descartar, reabrir: mesmos 14 objetos e nome com acento.
- PDF gerado no navegador: 3 páginas, página 3 sem imagens, texto "Família de Légua" extraível, estado "Aprovado".
- Placa fotografada em perspectiva: 4 cantos clicados fora de ordem, retificação 1000 × 500 mm (proporção medida 1,998).

## Limitações atuais da etapa 2

- Sem OCR e sem detecção automática de peças/painéis (etapa 3): peças e textos são marcados à mão.
- Ajuste de nós de curvas ainda não está no editor (mover, escalar, girar, cores, dividir/mesclar já estão).
- Moldes reais de camiseta e variantes de tamanho: etapa 4.
- Projeto é salvo como arquivo `.vizuvetor` e rascunho automático no navegador; sem servidor ainda.

## Próximas etapas

3. OCR (PaddleOCR), segmentação assistida, vetorização no worker (portando o motor do VizuVetor), reconstrução de fundo com aprovação.
4. Desktop Tauri (Windows x64, macOS Apple Silicon/Intel), moldes reais e variantes de tamanho.
5. README final com matriz de compatibilidade testada.

## Dependências externas pendentes

- **GitHub conectado ao Claude**: repositório e CI.
- **VPS** (Hostinger ou outro): API, PostgreSQL, fila e worker de IA.
- **Certificados**: assinatura Windows e conta Apple Developer para notarizar o DMG.

## Identificação de elementos por IA (Claude)

- O navegador envia a peça (reduzida a 1568 px, JPEG) para `app/api/analisar.php`; o PHP chama a API da Anthropic com a chave guardada **só no servidor** em `public_html/vizuvetor/app/api/config.php` (bloqueado por `.htaccess`, fora do git; modelo em `docs/vizuvetor-config.exemplo.php`).
- O deploy (`scripts/deploy_tus.sh`) não envia `config.php`, então a chave não é sobrescrita.
- `config.php` também aceita `senha_equipe` (o app pede a senha) e `limite_por_hora` por IP.
- Teste sem gastar API: `tests/e2e/ia_lyon.py` simula a resposta.
