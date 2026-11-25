#!/bin/bash
# Envia apps/web/dist para public_html/vizuvetor/app via TUS (URL e chaves geradas na hora pelo hPanel/API).
# Uso: TUS_URL=... X_AUTH=... X_AUTH_REST=... scripts/deploy_tus.sh [pasta_local] [destino]
set -e
SRC=${1:-apps/web/dist}; DEST=${2:-vizuvetor/app}
cd "$SRC"; n=0
while IFS= read -r f; do
  f=${f#./}; size=$(stat -c%s "$f")
  curl -sf -o /dev/null -X POST "$TUS_URL/$DEST/$f?override=true" -H "X-Auth: $X_AUTH" -H "X-Auth-Rest: $X_AUTH_REST" -H "Tus-Resumable: 1.0.0" -H "Upload-Length: $size" -H "Upload-Offset: 0"
  if [ "$size" -gt 0 ]; then
    curl -sf -o /dev/null -X PATCH "$TUS_URL/$DEST/$f?override=true" -H "X-Auth: $X_AUTH" -H "X-Auth-Rest: $X_AUTH_REST" -H "Tus-Resumable: 1.0.0" -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: 0" --data-binary "@$f"
  fi
  n=$((n+1))
done < <(find . -type f)
echo "enviados: $n arquivos"
