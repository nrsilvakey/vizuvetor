# Contrato do PDF de 3 páginas

Implementado em `services/worker/vizuvetor_worker/export_pdf.py`, verificado por
`services/worker/tests/test_export_pdf.py`.

| Página | Rótulo | Conteúdo | Verificado por teste |
|---|---|---|---|
| 1 | Arte completa | Fundos, vetores, textos e bitmaps nas posições finais; cada objeto em bloco `q … Q` próprio | 3 imagens (fundos + personagem com `/SMask`), 4 textos com acento extraíveis, fonte incorporada (`/FontFile2`) |
| 2 | Fundo | Somente objetos `background`, em registro com a pág. 1 | sem operadores de texto nem preenchimentos vetoriais; pixel de fundo igual ao da pág. 1 |
| 3 | Vetores | Vetores, textos em curvas e fundos vetoriais; **nenhuma imagem** | zero XObjects de imagem (busca recursiva em Form XObjects), sem `BI`/`Do`/`Tj`/`TJ`; furo vazado renderiza branco |

## Regras

- Unidades: 72 pt por polegada, 25,4 mm por polegada. MediaBox igual nas 3 páginas.
  Peça única com sangria define TrimBox e BleedBox.
- Tamanho da página: envolve todas as peças (`page_x_mm + largura + sangria` + margem),
  ou `export.page_width_mm/page_height_mm` se informados.
- Texto vivo (pág. 1, modo `texto`) e texto em curvas (pág. 3 e modo `curvas`)
  usam o mesmo posicionamento (HarfBuzz sem `kern`/`liga`). Diferença medida:
  ≤ 0,08 mm (arredondamento de largura do ReportLab, 1/1000 em). Limite do teste: 0,15 mm.
- Fonte com licença restrita (OS/2 `fsType` bit 1 sem bits 2/3) nunca é incorporada:
  o texto sai em curvas e o manifesto registra o aviso.
- Caractere sem glifo na fonte, asset ausente ou corrompido, arco SVG, ID repetido
  ou projeto fora do esquema: erro claro (`ExportError`), nenhum PDF gerado.
- Objeto não aprovado ou fundo em rascunho: PDF gerado com `/Subject (RASCUNHO)` e
  `estado: rascunho` no manifesto.
- O PDF não referencia fontes que não usa (o ReportLab cria uma Helvetica vazia por
  página; ela é removida para evitar aviso de fonte ausente no CorelDRAW).
- Cores em RGB (DeviceRGB). CMYK/PDF-X só depois de perfil ICC validado com a gráfica.

## Manifesto (`--manifesto`)

JSON com: versão do motor, hash do projeto e dos assets, hash do PDF, tamanho em mm,
estado, parâmetros, **PPI efetivo por eixo de cada bitmap** e contagem de objetos por página.

## Ainda não coberto

- Camadas nomeadas (Optional Content): só depois de testar a importação no Corel.
- Página 3 com tamanho próprio (prancha): hoje usa o mesmo tamanho da pág. 1.
- Kerning e ligaduras (desligados de propósito para garantir o registro).
- Contornos técnicos (corte) e cor spot.
