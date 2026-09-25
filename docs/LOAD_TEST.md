# Teste de carga — To Do Green

Este teste existe para responder com medição, e não chute, quantos acessos simultâneos o ERP/TMS suporta.

## O que ele mede

`scripts/load/todogreen-smoke.k6.js` usa k6 e faz somente leituras:

- `GET /api/status`;
- `GET /api/todogreen/clients`;
- `GET /api/todogreen/transactions/service-orders`;
- `GET /api/todogreen/preflight?limit=20`;
- `GET /api/todogreen/system-health`.

Não cria, altera ou apaga dados.

## Segurança

O alvo padrão é **local**: `http://127.0.0.1:8788`. O script não aponta para produção por padrão.

Para medir APIs autenticadas, informe um token de sessão owner/admin em `AUTH_TOKEN`.
Para medir apenas `/api/status`, use `PUBLIC_ONLY=1`.

Nunca versione token.

## Instalação

Instale o k6 na máquina/runner conforme a documentação oficial do k6. O projeto não adiciona k6 ao `node_modules`.

## Execução local

Suba o Worker local em outro terminal:

```bash
npx wrangler d1 migrations apply allgreen-db --local
npx wrangler dev --local --port 8788
```

Carga pública simples:

```bash
PUBLIC_ONLY=1 TARGET_VUS=25 npm run test:load
```

Carga autenticada:

```bash
AUTH_TOKEN="<token>" TARGET_VUS=25 npm run test:load
```

## Escalonamento recomendado

Não comece tentando descobrir o limite com um salto enorme. Rode degraus:

```bash
AUTH_TOKEN="<token>" TARGET_VUS=10 STEADY=2m npm run test:load
AUTH_TOKEN="<token>" TARGET_VUS=25 STEADY=3m npm run test:load
AUTH_TOKEN="<token>" TARGET_VUS=50 STEADY=3m npm run test:load
AUTH_TOKEN="<token>" TARGET_VUS=100 STEADY=5m npm run test:load
```

Pare de subir quando um destes limites falhar:

- erro HTTP >= 1%;
- p95 global >= 1,5 s;
- p99 global >= 3 s;
- checagens funcionais < 99%;
- D1/Worker começar a apresentar throttling, timeout ou crescimento contínuo de latência.

O maior degrau estável é a **capacidade medida naquele cenário**, não um limite universal. Depois repita com mix de escrita e telemetria em ambiente de teste antes de prometer capacidade comercial.

## Produção

Rodar carga contra produção é uma decisão operacional. Prefira preview/staging com configuração equivalente. Se produção for inevitável, use janela controlada, observabilidade aberta e um teto inicial baixo.

## Resultado mínimo a registrar

Para cada execução registre:

- SHA testado;
- ambiente/URL;
- número de VUs;
- duração;
- p50/p95/p99;
- taxa de erros;
- requests/s;
- alertas de D1/Worker;
- conclusão: aprovado/reprovado.

Sem essa execução, o repositório tem o **harness** de carga, mas não existe ainda um número honesto de usuários simultâneos suportados.
