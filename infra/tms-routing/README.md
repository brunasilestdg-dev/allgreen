# Roteirização gratuita do TMS

Stack auto-hospedado para o Portal TMS da To Do Green:

- **VROOM**: otimiza sequência e alocação considerando capacidade, janelas, skills, múltiplos depósitos e pickup/delivery.
- **OSRM**: calcula a rede viária, tempos, distâncias e geometria usando OpenStreetMap.
- **Nginx gateway**: expõe somente `/optimize` e exige um Bearer token próprio entre o Worker e a máquina.

Não há cobrança de licença nem custo por chamada. Existe apenas o custo/uso da máquina onde os containers rodam.

## 1. Pré-requisitos

Na máquina que executará o roteirizador:

- Docker
- Docker Compose
- `curl`
- espaço em disco suficiente para o extrato OSM e arquivos processados

O arquivo padrão é o extrato `sudeste-latest.osm.pbf` da Geofabrik, adequado para começar pela operação no Sudeste. Para ampliar a cobertura, troque `TDG_OSM_PBF_URL` antes de preparar o mapa.

## 2. Criar o segredo local

```bash
cd infra/tms-routing
cp .env.example .env
```

Edite `.env` e substitua `ROUTING_TOKEN` por um segredo longo e aleatório.

O valor real não deve ser commitado.

## 3. Preparar o mapa

```bash
chmod +x prepare-osrm.sh
./prepare-osrm.sh
```

O script:

1. baixa o extrato OSM;
2. executa `osrm-extract` com o perfil `car`;
3. particiona a rede com MLD;
4. executa `osrm-customize`.

Essa etapa é pesada, mas só precisa ser refeita quando o mapa for atualizado.

## 4. Subir o stack

```bash
docker compose up -d
```

Serviços locais:

| Serviço | Endereço local | Exposição |
| --- | --- | --- |
| OSRM | `127.0.0.1:5000` | somente máquina |
| VROOM | `127.0.0.1:3000` | somente máquina |
| Gateway | `127.0.0.1:3100` | ponto que deve ser publicado para o Worker |

Os dois motores não ficam abertos diretamente na internet.

## 5. Testar localmente

```bash
curl -X POST http://127.0.0.1:3100/optimize \
  -H "Authorization: Bearer SEU_ROUTING_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vehicles":[{"id":1,"start":[-46.8764,-23.5035],"capacity":[20]}],
    "jobs":[{"id":101,"location":[-46.6333,-23.5505],"delivery":[5]}]
  }'
```

Sem o token correto, o gateway responde `401`.

## 6. Tornar o gateway alcançável pelo Worker

O Cloudflare Worker não consegue chamar `127.0.0.1` da máquina. Portanto, somente o gateway `3100` deve ser publicado por um endpoint HTTPS seguro.

Pode ser usado o mecanismo de túnel/reverse proxy que a infraestrutura da To Do Green já adotar. O destino local deve ser:

```text
http://127.0.0.1:3100
```

Não publique diretamente as portas `3000` ou `5000`.

## 7. Configurar o Worker

Configure no ambiente do Worker:

```text
TDG_ROUTING_URL=https://SEU-ENDPOINT-SEGURO/optimize
TDG_ROUTING_TOKEN=O_MESMO_ROUTING_TOKEN_DO_ARQUIVO_.env
```

A URL e o token ficam somente no servidor. O cliente da API externa não conhece o endpoint do VROOM.

## 8. Consumir pela API TMS

Crie uma chave `tdg_live_...` com o escopo:

```text
routing:write
```

Depois chame:

```http
POST /api/tms/v1/routes/optimize
Authorization: Bearer tdg_live_xxxxxxxxx
Content-Type: application/json
```

O Worker valida a chave do cliente, aplica rate limit e encaminha apenas o payload de otimização para o gateway protegido.

## Atualização de mapas

Quando quiser atualizar a malha:

```bash
docker compose down
rm -f data/sudeste-latest.osrm*
rm -f data/sudeste-latest.osm.pbf
./prepare-osrm.sh
docker compose up -d
```

Em produção, a atualização deve ser feita em janela controlada ou preparando os arquivos em paralelo para evitar indisponibilidade.

## Observação sobre perfis

A primeira versão usa o perfil viário `car` do OSRM. Isso atende ao núcleo de roteirização e permite colocar o TMS em operação rapidamente. O tratamento fino por moto, VUC, van, caminhão e carreta deve evoluir depois com perfis/restrições específicos, sem alterar o contrato da API externa.
