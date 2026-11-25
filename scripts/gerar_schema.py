"""Gera packages/project-schema/schema/project.schema.json a partir do modelo Python."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "worker"))
from vizuvetor_worker.schema import Project  # noqa: E402

out = ROOT / "packages" / "project-schema" / "schema" / "project.schema.json"
schema = Project.model_json_schema()
schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
schema["$id"] = "https://opencriativa.com.br/vizuvetor/project.schema.json"
out.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(out)
