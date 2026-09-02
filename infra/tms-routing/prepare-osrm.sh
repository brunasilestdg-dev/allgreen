#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${ROOT_DIR}/data"
PBF_FILE="${DATA_DIR}/sudeste-latest.osm.pbf"
PBF_URL="${TDG_OSM_PBF_URL:-https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf}"
OSRM_IMAGE="${TDG_OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"

mkdir -p "${DATA_DIR}"

if [[ ! -s "${PBF_FILE}" ]]; then
  echo "Baixando mapa OSM do Sudeste..."
  curl --fail --location --retry 3 --continue-at - "${PBF_URL}" --output "${PBF_FILE}"
else
  echo "Mapa já existe: ${PBF_FILE}"
fi

echo "Extraindo rede viária para o perfil car..."
docker run --rm -t \
  -v "${DATA_DIR}:/data" \
  "${OSRM_IMAGE}" \
  osrm-extract -p /opt/car.lua /data/sudeste-latest.osm.pbf

echo "Particionando grafo MLD..."
docker run --rm -t \
  -v "${DATA_DIR}:/data" \
  "${OSRM_IMAGE}" \
  osrm-partition /data/sudeste-latest.osrm

echo "Customizando grafo MLD..."
docker run --rm -t \
  -v "${DATA_DIR}:/data" \
  "${OSRM_IMAGE}" \
  osrm-customize /data/sudeste-latest.osrm

echo "OSRM preparado. Agora execute: docker compose up -d"
