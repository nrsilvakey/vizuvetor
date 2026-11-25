# Checklist de importação no CorelDRAW (manual)

**Status: PARCIAL.** 25/11/2026 — o usuário importou `teste-corel.pdf` no CorelDRAW (Mac)
e relatou que "abriu corretamente". Versão do Corel e itens 2–11 ainda não detalhados.

Arquivo de teste: gerar com

    cd services/worker
    python3 ../../tests/fixtures/make_fixture.py
    python3 -m oae_worker exportar ../../tests/fixtures/camiseta_sintetica/projeto.json teste-corel.pdf --manifesto teste-corel.json

Registrar abaixo: versão do CorelDRAW, sistema (macOS/Windows e versão), data, quem testou.

| # | Verificação | Esperado | Resultado |
|---|---|---|---|
| 1 | Arquivo › Importar (ou Abrir) o PDF | Diálogo pergunta páginas; importar **todas as 3** | |
| 2 | Opção de texto no diálogo | Testar as duas: "Importar texto como: Texto" e "Curvas" | |
| 3 | Tamanho da página 1 | 520 × 300 mm | |
| 4 | Página 1 — objetos | Fundos e personagem selecionáveis como bitmaps separados; moldura e estrela como curvas; 4 textos | |
| 5 | Acentos (modo texto) | "Família de Légua", "Salve o povo de Légua", "Vó Maria Conga", "Sete Flechas" corretos e editáveis | |
| 6 | Fonte | Sem aviso de fonte ausente/substituída (DejaVu Sans Bold incorporada) | |
| 7 | Transparência | Borda suave do personagem sobre o fundo, sem caixa branca | |
| 8 | Página 2 | Só os dois fundos, mesma posição da página 1 | |
| 9 | Página 3 | Nenhum bitmap; moldura com furo vazado; estrela; textos já em curvas | |
| 10 | Separação de objetos | Cada elemento selecionável sozinho (desagrupar se vier em grupo) | |
| 11 | Cores | Vermelho moldura #8A1C1C, estrela #D4A017 (RGB) | |

Observações de importação (diferenças entre versões, agrupamentos, recortes
indesejados, etc.):

-
