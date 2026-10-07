#!/usr/bin/env bash
# =====================================================================
# Pruebas de los endpoints de la Fase 1 (equivalente a la colección Postman).
#
#   ./ai/probar-endpoints.sh [BASE]      (por defecto http://localhost:3001)
#
# Requiere que estén levantados el backend y el sidecar de embeddings.
# =====================================================================
set -uo pipefail
BASE=${1:-http://localhost:3001}
IMG=${IMG:-"$(cd "$(dirname "$0")/.." && pwd)/public/img/ext/$(ls "$(cd "$(dirname "$0")/.." && pwd)/public/img/ext" | grep -m1 -- '-1\.\(jpg\|webp\|png\)$')"}

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
titulo() { printf '\n\033[1m%s\033[0m\n' "$1"; }

titulo "1) Estado del motor de embeddings"
curl -sS "$BASE/api/ai/embeddings/status" | python3 -m json.tool 2>/dev/null || fail "sin respuesta"

titulo "2) POST /api/ai/style-chat — asistente RAG"
R=$(curl -sS -X POST "$BASE/api/ai/style-chat" -H 'Content-Type: application/json' \
  -d '{"message":"¿Qué me pongo para una boda en la playa?"}')
echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('  ✗', d['error']); sys.exit(1)
print('  respuesta   :', (d.get('reply') or '')[:150].replace('\n',' '), '…')
print('  plan        :', d.get('plan_source'), '·', json.dumps(d.get('plan'), ensure_ascii=False)[:110])
print('  productos   :', len(d.get('products', [])))
for p in d.get('products', [])[:5]:
    print('     -', p['name'][:44].ljust(46), 'sim', p['similarity'], '·', (p.get('reasons') or [''])[0])
g=d.get('grounding', {})
print('  grounding   :', g.get('totalCitados'), 'citados ·', len(g.get('inventados', [])), 'inventados')
print('  fases (ms)  :', json.dumps(d.get('phases_ms')))
print('  latencia    :', d.get('latency_ms'), 'ms')
print('  RESULTADO   :', '✓ grounding correcto' if g.get('groundingOk') else '✗ hay productos inventados')
"

titulo "3) POST /api/ai/style-chat — consulta con presupuesto"
curl -sS -X POST "$BASE/api/ai/style-chat" -H 'Content-Type: application/json' \
  -d '{"message":"una blusa para el trabajo por menos de 40 dólares"}' \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  plan:', json.dumps(d.get('plan'), ensure_ascii=False))
print('  precios:', [p['price'] for p in d.get('products', [])])
print('  RESULTADO:', '✓ todos dentro de presupuesto' if all(p['price']<=40 for p in d.get('products',[])) else '✗ alguno se pasa')
"

titulo "4) POST /api/ai/visual-search — búsqueda por imagen (JSON base64)"
if [ -f "$IMG" ]; then
  python3 -c "
import base64,json,urllib.request,sys
img=base64.b64encode(open('$IMG','rb').read()).decode()
req=urllib.request.Request('$BASE/api/ai/visual-search?k=5',
  data=json.dumps({'image':img}).encode(), headers={'Content-Type':'application/json'})
d=json.loads(urllib.request.urlopen(req, timeout=60).read())
print('  imagen :', '$IMG'.split('/')[-1])
print('  resultados:', d['count'], '· latencia', d['latency_ms'], 'ms (embedding', d['embed_ms'], 'ms)')
for r in d['results'][:5]:
    print('     -', str(r['similarity']).ljust(7), (r['garment'] or '?').ljust(11), r['name'][:40])
"
else
  fail "no se encontró imagen de prueba en $IMG"
fi

titulo "5) POST /api/ai/visual-search — imagen binaria"
if [ -f "$IMG" ]; then
  CODE=$(curl -sS -o /tmp/vs-bin.json -w '%{http_code}' -X POST \
    "$BASE/api/ai/visual-search?k=3" -H "Content-Type: image/jpeg" --data-binary "@$IMG")
  if [ "$CODE" = "200" ]; then ok "acepta el binario (HTTP 200) → $(python3 -c "import json;print(json.load(open('/tmp/vs-bin.json'))['count'])") resultados"
  else fail "HTTP $CODE"; fi
fi

titulo "6) Casos de error esperados"
C=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/style-chat" -H 'Content-Type: application/json' -d '{}')
[ "$C" = "400" ] && ok "style-chat sin mensaje → 400" || fail "style-chat sin mensaje → $C (esperado 400)"
C=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/ai/visual-search" -H 'Content-Type: application/json' -d '{}')
[ "$C" = "400" ] && ok "visual-search sin imagen → 400" || fail "visual-search sin imagen → $C (esperado 400)"
C=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/ai/no-existe")
[ "$C" = "404" ] && ok "ruta inexistente → 404" || fail "ruta inexistente → $C (esperado 404)"

printf '\n\033[1mListo.\033[0m\n'
