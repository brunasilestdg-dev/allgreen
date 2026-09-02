# To Do Green TMS API v1

API externa para clientes, embarcadores e parceiros integrarem diretamente com o TMS da To Do Green.

## Base

```text
/api/tms/v1
```

A especificação OpenAPI fica disponível sem autenticação em:

```text
GET /api/tms/v1/openapi.json
```

## Autenticação

Cada integração usa uma chave própria com prefixo `tdg_live_`.

```http
Authorization: Bearer tdg_live_xxxxxxxxxxxxxxxxx
```

A chave completa é exibida somente na criação. No banco fica apenas o SHA-256 da credencial.

Uma chave pode ser vinculada a um único cliente. Nesse caso, ela não consegue listar, criar ou consultar cargas de outro cliente.

### Escopos

| Escopo | Permite |
| --- | --- |
| `shipments:read` | Listar e consultar shipments, volumes, tracking e POD |
| `shipments:write` | Criar shipments/ordens de serviço |
| `tracking:write` | Registrar eventos de tracking |
| `pod:write` | Registrar POD e concluir entrega |
| `routing:write` | Solicitar otimização de rotas no motor auto-hospedado |
| `fiscal:read` | Consultar CT-e e MDF-e |
| `ciot:read` | Consultar CIOT |
| `billing:read` | Consultar faturamento |

## Idempotência

Todas as operações de escrita que alteram o estado do TMS exigem:

```http
Idempotency-Key: identificador-unico-da-requisicao
```

Repetir a mesma requisição com a mesma chave de API e o mesmo `Idempotency-Key` devolve o resultado anterior, evitando duplicação por timeout ou retry do cliente.

A otimização de rota é uma operação de cálculo sem persistência e não exige `Idempotency-Key`.

## Endpoints

### Identificar a credencial

```http
GET /api/tms/v1/me
```

Retorna o ID da chave, cliente vinculado e escopos.

### Listar shipments

```http
GET /api/tms/v1/shipments?page=1&limit=20&status=in_progress
```

Quando a chave é vinculada a um cliente, o filtro de cliente é imposto no servidor.

### Criar shipment

```http
POST /api/tms/v1/shipments
Idempotency-Key: amazon-20260901-000123
Content-Type: application/json
```

Exemplo:

```json
{
  "clientId": "cliente_123",
  "externalReference": "AMZ-000123",
  "serviceType": "same_day",
  "scheduledStartAt": "2026-09-02T08:00:00-03:00",
  "scheduledEndAt": "2026-09-02T18:00:00-03:00",
  "origin": {
    "name": "CD Barueri",
    "city": "Barueri",
    "state": "SP"
  },
  "destination": {
    "name": "Destinatário",
    "city": "São Paulo",
    "state": "SP"
  },
  "packages": [
    {
      "trackId": "TDG000001",
      "barcode": "789000000001",
      "weightKg": 3.4,
      "dimensionsCm": {
        "length": 30,
        "width": 20,
        "height": 15
      },
      "declaredValue": 249.90,
      "invoiceNumber": "12345",
      "invoiceKey": "chave-nfe"
    }
  ],
  "metadata": {
    "canal": "marketplace"
  }
}
```

O shipment é gravado na mesma `todogreen_service_orders` usada pelo TMS, operação, POD e faturamento. Não existe uma base paralela para a API.

A criação exige contrato válido do cliente. A API não aceita carga comercial sem vínculo com contrato apto.

### Consultar shipment completo

```http
GET /api/tms/v1/shipments/{id}
```

Retorna, quando existentes:

- ordem de serviço
- volumes/Track IDs
- viagens
- entregas
- tracking
- PODs

### Tracking

```http
GET /api/tms/v1/shipments/{id}/tracking
```

Adicionar evento:

```http
POST /api/tms/v1/shipments/{id}/tracking
Idempotency-Key: evt-000123
Content-Type: application/json
```

```json
{
  "eventType": "ARRIVED_AT_HUB",
  "location": "Base São Paulo",
  "city": "São Paulo",
  "state": "SP",
  "latitude": -23.5505,
  "longitude": -46.6333,
  "occurredAt": "2026-09-02T11:15:00-03:00",
  "externalEventId": "CLIENTE-EVT-987"
}
```

Eventos aceitos na v1:

```text
CREATED
PICKED_UP
DEPARTED
IN_TRANSIT
REACHED_CHECKPOINT
ARRIVED_AT_HUB
DEPARTED_FROM_HUB
REACHED_DESTINATION
DELIVERED
DELIVERY_ATTEMPT
EXCEPTION
CANCELLED
```

`DELIVERED` registra o evento, mas a conclusão comercial pode continuar dependendo do POD.

### POD

```http
GET /api/tms/v1/shipments/{id}/pod
```

Registrar:

```http
POST /api/tms/v1/shipments/{id}/pod
Idempotency-Key: pod-000123
Content-Type: application/json
```

```json
{
  "recipientName": "Maria Silva",
  "documentUrl": "https://cliente.example/pod/000123.jpg",
  "latitude": -23.55,
  "longitude": -46.63,
  "occurredAt": "2026-09-02T15:21:00-03:00",
  "completeShipment": true
}
```

Quando `completeShipment` é verdadeiro, a OS é concluída e entra na fila canônica de faturamento.

### Otimizar rota

```http
POST /api/tms/v1/routes/optimize
Authorization: Bearer tdg_live_xxxxxxxxxxxxxxxxx
Content-Type: application/json
```

Requer o escopo `routing:write`.

O formato segue o modelo nativo do VROOM. Isso preserva recursos prontos de otimização, como capacidade, skills, janela de atendimento, jornada do veículo, múltiplos depósitos e coleta + entrega.

Exemplo simples:

```json
{
  "vehicles": [
    {
      "id": 1,
      "start": [-46.8764, -23.5035],
      "end": [-46.8764, -23.5035],
      "capacity": [120],
      "time_window": [28800, 64800]
    },
    {
      "id": 2,
      "start": [-46.8764, -23.5035],
      "end": [-46.8764, -23.5035],
      "capacity": [40],
      "time_window": [28800, 64800]
    }
  ],
  "jobs": [
    {
      "id": 101,
      "location": [-46.6333, -23.5505],
      "delivery": [8],
      "service": 300,
      "time_windows": [[32400, 43200]]
    },
    {
      "id": 102,
      "location": [-46.7019, -23.5329],
      "delivery": [5],
      "service": 240
    }
  ],
  "geometry": true
}
```

Para uma coleta e entrega vinculadas na mesma rota, use `shipments` no formato VROOM:

```json
{
  "vehicles": [
    {
      "id": 1,
      "start": [-46.8764, -23.5035],
      "capacity": [50]
    }
  ],
  "shipments": [
    {
      "amount": [10],
      "pickup": {
        "id": 201,
        "location": [-46.8522, -23.5208],
        "service": 300
      },
      "delivery": {
        "id": 202,
        "location": [-46.6333, -23.5505],
        "service": 300
      }
    }
  ]
}
```

A API aceita até 250 veículos e 5.000 jobs/shipments por solicitação. O processamento tem timeout de 30 segundos.

O endpoint não depende de Google Maps ou Mapbox. Ele encaminha o problema para o VROOM configurado pela To Do Green, e o VROOM usa um motor de rotas auto-hospedado, preferencialmente OSRM com dados do OpenStreetMap.

Se o serviço local ainda não estiver conectado, a API responde `503 routing_not_configured` em vez de cair silenciosamente para uma API paga.

### Planejar recarga elétrica

```http
POST /api/tms/v1/routes/electric-plan
Authorization: Bearer tdg_live_xxxxxxxxxxxxxxxxx
Content-Type: application/json
```

Requer `routing:write`. O planejador considera energia disponível acima da reserva, consumo ajustado pela carga, conectores, potência máxima aceita pelo veículo, acesso, status, desvio e confiabilidade do ponto.

```json
{
  "vehicle": {
    "id": "BYD-T3-07",
    "model": "BYD T3",
    "category": "van",
    "batteryCapacityKwh": 45,
    "socPercent": 40,
    "reservePercent": 15,
    "consumptionKwhPer100Km": 22,
    "payloadKg": 500,
    "maxPayloadKg": 700,
    "loadPenaltyPercent": 20,
    "connectors": ["Type 2", "CCS2"],
    "maxAcKw": 7,
    "maxDcKw": 50
  },
  "route": {
    "distanceKm": 120,
    "averageSpeedKmh": 60
  },
  "chargingStations": [
    {
      "id": "ocm-123",
      "name": "Eletroposto Rodovia",
      "operator": "Operador",
      "distanceFromStartKm": 45,
      "detourKm": 4,
      "operational": true,
      "openNow": true,
      "publicAccess": true,
      "heavyVehicleAccess": false,
      "reliabilityScore": 0.95,
      "source": "open_charge_map",
      "connectors": [
        { "type": "CCS2", "powerKw": 150, "status": "available" }
      ]
    }
  ]
}
```

A resposta diferencia:

- `feasible_without_charge`: conclui acima da reserva;
- `feasible_with_charge`: devolve ponto, conector, potência efetiva, energia e minutos;
- `infeasible`: explica por que nenhum ponto serve;
- `invalid`: perfil energético ou distância incompletos.

O motor nunca considera apenas proximidade. Um CCS2 mais distante pode vencer um Type 2 próximo quando o tempo total da operação for menor. Pontos incompatíveis, offline, fechados, fora do alcance, sem autorização ou impróprios para a categoria do veículo são descartados.

A posição e os conectores podem vir de Open Charge Map/OpenStreetMap. Disponibilidade em tempo real deve vir de OCPP ou da API da rede quando existir. A fonte e a confiabilidade permanecem no resultado para não tratar dado comunitário como certeza operacional.

### CT-e e MDF-e

```http
GET /api/tms/v1/fiscal
GET /api/tms/v1/fiscal?type=cte
GET /api/tms/v1/fiscal?type=mdfe
```

Aceita também filtros de shipment/cliente quando compatíveis com o escopo da chave.

### CIOT

```http
GET /api/tms/v1/ciot
```

### Faturamento

```http
GET /api/tms/v1/invoices
```

## Rate limit

Cada chave tem um limite configurável entre 30 e 600 chamadas por minuto. O padrão é 120/min.

Ao exceder:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
```

## Erros

A API usa HTTP status e corpo JSON previsível:

```json
{
  "error": "unauthorized",
  "message": "Chave TMS ausente, inválida ou revogada."
}
```

Principais códigos:

- `400`: payload ou parâmetro inválido
- `401`: chave ausente/inválida/revogada
- `403`: escopo insuficiente ou tentativa de acessar outro cliente
- `404`: shipment/recurso inexistente
- `409`: conflito de negócio, duplicidade ou contrato não apto
- `429`: limite de chamadas excedido
- `502`: motor de roteirização indisponível ou respondeu com erro
- `503`: serviço ou roteirizador ainda não configurado
- `504`: otimização excedeu o timeout

## Arquitetura e custo de licença

A API roda dentro do worker da Vertical To Do Green e usa o banco operacional já existente.

A modelagem de endpoints de shipment/tracking/POD foi acelerada usando o projeto open source HaulSync como referência de domínio. O HaulSync usa licença MIT. Não é necessário operar o backend do HaulSync como serviço separado.

A otimização usa VROOM auto-hospedado sobre OSRM. O planejador energético nativo adiciona compatibilidade de carregadores e decisão de recarga sem depender de API paga. Ambos podem ser executados em infraestrutura própria sem cobrança por requisição. O VROOM resolve problemas de capacidade, janelas, múltiplos depósitos, frota heterogênea e pickup/delivery; o OSRM calcula tempos, distâncias e geometria viária usando dados do OpenStreetMap.

A To Do Green controla o endpoint do roteirizador por `TDG_ROUTING_URL`. A API externa nunca recebe nem escolhe essa URL, evitando que o endpoint de otimização vire um proxy aberto.
