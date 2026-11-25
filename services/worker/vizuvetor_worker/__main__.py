"""CLI: python -m vizuvetor_worker exportar projeto.json saida.pdf [--manifesto m.json]"""
import argparse
import json
import sys

from .export_pdf import ExportError, export


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="vizuvetor_worker", description="VizuVetor — worker")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("exportar", help="gera o PDF de 3 páginas a partir de um projeto")
    e.add_argument("projeto")
    e.add_argument("saida")
    e.add_argument("--manifesto")
    a = ap.parse_args(argv)
    try:
        m = export(a.projeto, a.saida, a.manifesto)
    except ExportError as err:
        print(f"erro: {err}", file=sys.stderr)
        return 2
    print(json.dumps({"estado": m["estado"], "avisos": m["avisos"], "bitmaps": m["bitmaps"]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
