#!/usr/bin/env bash
# Regressão visual numa IMAGEM DOCKER FIXA — a única forma de o baseline ser
# reproduzível entre máquinas. Fonte e render do Chromium mudam de um sistema
# para outro; rodar o screenshot sempre na mesma imagem tira essa variável da
# frente (decisão da titular: "Docker/imagem fixa p/ consistência").
#
# A imagem é fixada na MESMA versão do @playwright/test do projeto (1.62.1) —
# Playwright e navegador têm que casar, senão o render muda.
#
# Uso:
#   scripts/visual-regression.sh            # compara com os baselines (gate)
#   scripts/visual-regression.sh --update   # (re)gera os baselines canônicos
#
# NÃO usa GitHub Actions (sem franquia): roda na sua máquina, com Docker.
set -euo pipefail

IMAGEM="mcr.microsoft.com/playwright:v1.62.1-noble"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

# Passa adiante os argumentos (ex.: --update-snapshots, -g "tema escuro").
ARGS=("$@")
# Açúcar: aceitar "--update" como atalho de "--update-snapshots".
for i in "${!ARGS[@]}"; do
  [ "${ARGS[$i]}" = "--update" ] && ARGS[$i]="--update-snapshots"
done

echo "Regressão visual na imagem fixa ${IMAGEM}"
exec docker run --rm --init --ipc=host \
  -v "${RAIZ}:/work" -w /work \
  -e CI=1 \
  "${IMAGEM}" \
  npx playwright test --config playwright.visual.config.js "${ARGS[@]}"
