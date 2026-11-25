# apps/vizuvetor — protótipo em produção

Ferramenta de página única que já roda em https://opencriativa.com.br/vizuvetor/ .
Separa vetor / degradê / fundo no navegador (Lab, contorno subpixel, Bézier,
fundo reconstruído) e exporta SVG e um PDF de 3 páginas próprio.

Será a referência para portar o motor de vetorização para `services/worker`
(Python/OpenCV) e o editor para `apps/web`. O PDF oficial passa a ser o do
worker (`oae_worker exportar`), que segue o contrato completo.
