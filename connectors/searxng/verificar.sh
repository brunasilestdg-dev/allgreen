#!/usr/bin/env bash
# Confere, de fora, se a instância está pronta para o Seu Funcionário.
#
# Testa as quatro coisas que costumam falhar, na ordem em que falham — e cada
# uma diz o que corrigir, em vez de só dizer que não funcionou.
#
#   ./verificar.sh https://busca.todogreen.com.br SEU_TOKEN
set -u
BASE="${1:?uso: ./verificar.sh https://SEU_DOMINIO TOKEN}"
TOKEN="${2:?uso: ./verificar.sh https://SEU_DOMINIO TOKEN}"
BASE="${BASE%/}"
falhou=0

passo() { printf '%-52s' "$1"; }
ok()    { echo "ok"; }
erro()  { echo "FALHOU"; echo "   → $1"; falhou=1; }

passo "1. o servidor responde (HTTPS válido)"
if curl -fsS --max-time 15 "$BASE/healthz" >/dev/null 2>&1; then ok
else erro "DNS apontando para cá? Porta 443 aberta? Caddy conseguiu emitir o certificado? Veja: docker compose logs caddy"; fi

passo "2. sem token, a busca é recusada"
codigo=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/search?q=teste&format=json" 2>/dev/null)
if [ "$codigo" = "401" ]; then ok
elif [ "$codigo" = "200" ]; then erro "A instância está ABERTA. Qualquer um pode usá-la e o IP será banido no Google. Confira SEARXNG_TOKEN no .env e reinicie o Caddy."
else erro "Esperava 401, veio $codigo."; fi

passo "3. com token, devolve JSON com resultados"
corpo=$(curl -s --max-time 25 -H "x-searxng-token: $TOKEN" "$BASE/search?q=logistica+sustentavel&format=json" 2>/dev/null)
if echo "$corpo" | grep -q '"results"'; then ok
elif echo "$corpo" | grep -qi "<html"; then erro 'Veio HTML, não JSON. Falta "json" em search.formats no settings.yml.'
elif [ -z "$corpo" ]; then erro "Resposta vazia. O contêiner do searxng subiu? docker compose ps"
else erro "Resposta inesperada: $(echo "$corpo" | head -c 150)"; fi

passo "4. o operador site: funciona (busca de contato)"
n=$(curl -s --max-time 30 -H "x-searxng-token: $TOKEN" \
     "$BASE/search?q=site%3Alinkedin.com%2Fin+gerente+logistica+brasil&format=json" 2>/dev/null \
     | grep -o '"url"' | wc -l)
if [ "${n:-0}" -ge 3 ]; then echo "ok ($n resultados)"
else erro "Só $n resultado(s). Google e Bing estão habilitados no settings.yml? Se o servidor for novo, o Google pode estar pedindo captcha — veja: docker compose logs searxng"; fi

echo
if [ "$falhou" = "0" ]; then
  echo "Tudo certo. Agora cadastre no cofre do Worker:"
  echo "  npx wrangler secret put SEARXNG_BASE_URL     # $BASE"
  echo "  npx wrangler secret put SEARXNG_TOKEN        # o mesmo token"
else
  echo "Corrija o que falhou acima e rode de novo."
  exit 1
fi
