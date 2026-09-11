# Roteirização gratuita do TMS

Stack auto-hospedado para o Portal TMS da To Do Green:

- **VROOM**: otimiza sequência e alocação considerando capacidade, janelas, skills, múltiplos depósitos e pickup/delivery.
- **OSRM**: calcula a rede viária, tempos, distâncias e geometria usando OpenStreetMap.
- **Nominatim + PostgreSQL/PostGIS**: geocodifica endereços usando a mesma base OpenStreetMap, sem depender do endpoint público.
- **Nginx gateway**: expõe somente `/optimize`, `/osrm/` e `/nominatim/`, todos protegidos pelo mesmo Bearer token entre o Worker e a máquina.

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

Edite `.env` e substitua `ROUTING_TOKEN` e `NOMINATIM_PASSWORD` por segredos longos e diferentes.

Os valores reais não devem ser commitados.

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

Essa etapa é pesada, mas só precisa ser refeita quando o mapa for atualizado. O mesmo arquivo PBF é montado no Nominatim para alimentar o banco PostgreSQL/PostGIS. Na primeira subida, o Nominatim também precisa importar e indexar o extrato; o volume `nominatim-db` preserva esse índice entre reinícios.

## 4. Subir o stack

```bash
docker compose up -d
```

Serviços locais:

| Serviço | Endereço local | Exposição |
| --- | --- | --- |
| OSRM | `127.0.0.1:5000` | somente máquina |
| Nominatim/PostGIS | `127.0.0.1:8080` | somente máquina |
| VROOM | `127.0.0.1:3000` | somente máquina |
| Gateway | `127.0.0.1:3100` | único ponto a publicar para o Worker |

OSRM, VROOM e Nominatim não ficam abertos diretamente na internet.

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

Não publique diretamente as portas `3000`, `5000` ou `8080`.

## 7. Configurar o Worker

Configure no ambiente do Worker:

```text
TDG_ROUTING_URL=https://SEU-ENDPOINT-SEGURO/optimize
TODOGREEN_OSRM_BASE_URL=https://SEU-ENDPOINT-SEGURO/osrm/
TODOGREEN_NOMINATIM_BASE_URL=https://SEU-ENDPOINT-SEGURO/nominatim/
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

## Uso pela tela interna de Roteirização

A tela interna usa:

```http
POST /api/todogreen/routing/optimize
```

Esse endpoint usa a sessão normal da Vertical e reaproveita o mesmo VROOM do TMS. O navegador nunca recebe `TDG_ROUTING_TOKEN` nem conhece a URL privada do gateway.

Quando `TDG_ROUTING_URL` ainda não estiver configurada ou o host estiver indisponível, a tela mantém o otimizador local já existente como contingência. Quando o VROOM responde com uma solução parcial por causa de uma restrição inviável, a solução parcial não é aplicada.

### Escopo do MVP

O MVP deixa **VROOM + OSRM + OpenStreetMap + Nominatim/PostgreSQL/PostGIS** no caminho crítico. VROOM distribui e ordena; OSRM calcula a malha; Nominatim/PostGIS resolve endereços; OSM fornece os dados geográficos.

**Valhalla** fica preparado como evolução, mas não roda em paralelo com OSRM no MVP. Rodar os dois para a mesma função só dobraria memória e processamento. Quando forem necessários perfis/custos viários mais customizados, o backend pode trocar o roteador do VROOM sem alterar a tela ou o contrato da API.

O D1 continua como banco operacional do ERP. PostgreSQL/PostGIS fica dedicado ao índice geográfico do Nominatim, evitando uma migração desnecessária do restante do produto.

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
