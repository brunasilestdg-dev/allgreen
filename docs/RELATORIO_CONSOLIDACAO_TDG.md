# Relatório de Consolidação — To Do Green

> Documento-resumo da rodada de **CONSOLIDAÇÃO, CORREÇÃO DE REGRESSÕES, UX e
> ESTABILIDADE**. Complementa a auditoria de Fase 0 (`AUDITORIA_CONSOLIDACAO_TDG.md`)
> e a matriz de prontidão (`TODOGREEN_ERP_READINESS_MATRIX.md`). Escrito para a
> titular (Bruna): diz o que foi feito, o que já existia, o que falta e por quê.

## Objetivo e regras da rodada

Tornar o To Do Green um ERP coerente, estável e visualmente consistente:
eliminar regressões, corrigir carregamento de dados, simplificar a navegação e
tornar o CI/CD independente dos minutos pagos do GitHub Actions.

Restrições respeitadas em **todas** as entregas abaixo:

- Não criar novas funcionalidades (exceto infra necessária).
- Não remover funcionalidades existentes.
- Não substituir telas funcionais por mocks.
- Não apagar migrations aplicadas; não recriar banco; não resetar dados de produção.
- Não fazer grandes rewrites nem mudanças cosméticas isoladas com erro funcional aberto.
- Não fazer merge em `main` sem validar a fase.
- Critério de "pronto": acessível, persistido quando necessário, visível na UI e testado.

## Estado de referência

- **Produção** (no fecho desta rodada): `GET /api/status` → `version` `58c0000535fe`,
  `database: operacional`. É o SHA curto do código publicado — o jeito de comparar
  produção × `main` sem adivinhação.
- **Migrations**: 126 arquivos, até `0119_todogreen_operation_import_templates`.
  A anomalia da auditoria (0119 aplicada no D1 remoto e ausente do `main`) está
  reconciliada — o arquivo existe no repositório e a numeração segue linear.
  Nenhuma migration aplicada foi renomeada, reaplicada ou apagada.
- **Deploy**: Cloudflare Workers Builds é o publicador de fato (push em `main` →
  `npm ci && npm run build` → `npm run deploy:cloudflare`). GitHub Actions ("Publicar")
  ficou como contingência **manual** (`workflow_dispatch`).

## O que foi entregue nesta rodada (PRs mergeados)

| PR | Tema | Problema → Correção | Validação |
| --- | --- | --- | --- |
| **#351** | CI/CD independente | GitHub Actions falhava por minutos esgotados e travava o fluxo. → Cloudflare Builds documentado como principal; `deploy.yml` vira contingência manual; runbooks (`CLOUDFLARE_BUILDS_SETUP.md`, `GITHUB_SELF_HOSTED_RUNNER.md`) | `verify` + `build` verdes; deploy real via Cloudflare |
| **#352** | Estabilidade CSS | Chave `{` não fechada quebrava o CSS da vertical. → Correção pontual | `build` verde |
| **#353** | P0 — fim do "zero falso" | Uma coleção com erro zerava TODOS os records ("Banco indisponível", números falsos). → `Promise.allSettled` por coleção no worker + gancho resiliente + banner de 3 estados (fatal/parcial/desatualizado) com "Tentar novamente" | teste worker de falha parcial + testes do gancho e do banner |
| **#355** | Integridade Planner ↔ To-Do | "Aguardando" virava "Em andamento" a cada sync (perda no round-trip) e tarefa apagada ressuscitava. → `statusTarefaAoEspelhar` preserva o status mais fino; `removeTask` arquiva no Planner antes de remover | testes de round-trip de status e de propagação do delete |
| **este** | Visibilidade da eletrificação + matriz + relatório | Domínios de decisão puros/testados não apareciam no caminho conectado. → `preflight` (PASS/WARNING/BLOCK + sugestões calculadas) anexado ao `POST /routes/electric-plan`, reusando o domínio puro (sem 3ª camada); matriz e este relatório atualizados | 3 testes de endpoint (PASS, BLOCK por autonomia, BLOCK por motorista) — suíte da API verde |

## O que já existia no código (não recriado)

A auditoria confirmou que boa parte do "plano de consolidação" **já estava
implementada e testada** neste código maduro (130+ domínios puros com teste). Foi
verificado e preservado, não reescrito:

- **Navegação consolidada**: `moduleGroupingDomain.js` já agrupa os ~47 itens de
  menu nas ~12 telas reais (um cartão por tela, com os "assuntos" que a busca usa),
  e já está ligado em `LogisticsVertical.jsx`. Guardas de navegação já cobrem rótulos
  únicos por tela (`moduleNavLabels.test.js`, `shellNavegacao.test.js`).
- **SSO/portais**: portais de cliente, motorista e colaborador com escopo isolado,
  cada um com testes de worker dedicados.
- **Camada de decisão da eletrificação**: `energyEstimationDomain`,
  `viabilitySnapshotDomain`, `routingEngineSelectionDomain`, `roadRestrictionDomain`,
  `preflightDomain`, `dataProvenanceDomain`, `driverOfflineQueueDomain` — todos puros
  e testados. `energyEstimate` e `routingEngineSelection` já respondiam por endpoint;
  esta rodada somou o `preflight`.

Continuar "produzindo PRs" para o que já existe seria desperdício e risco. A
decisão foi entregar o que agrega valor verificável e registrar o resto com honestidade.

## Reconciliação puro → conectado (item da eletrificação)

Princípio: a regra de decisão mora num **único** domínio puro e o caminho
conectado o **reusa** — nunca uma segunda implementação no worker ("sem 3ª camada").

Hoje o `POST /routes/electric-plan` devolve, sobre o mesmo par veículo/rota:
`energyEstimate` · `routingEngineSelection` · **`preflight`** (novo).

O `preflight` é aditivo e **blindado**: qualquer falha ao computá-lo devolve
`preflight: null` sem derrubar `plan` nem `energyEstimate` (mesma disciplina de
falha parcial do PR #353). Quando o chamador não envia `alternatives.chargers`,
os carregadores são derivados dos `chargingStations` já enviados, para as
sugestões de recarga terem potência real.

## O que falta — com o motivo (transparência)

Estes itens **não** foram forçados às cegas porque o critério de "pronto" exige
"visível na UI e testado", e esta sessão **não tem navegador** para validar layout,
montagem de mapa (Leaflet) ou CSS. Empurrá-los sem ver introduziria justamente as
regressões que a rodada existe para eliminar.

| Item | Estado | Por que ficou fora / próximo passo seguro |
| --- | --- | --- |
| Design system / regressão visual | Backlog | Precisa de navegador para conferir tokens e capturar screenshots de referência |
| Roteirizador em duas colunas (mapa) | Backlog | Depende de o Leaflet montar (`invalidateSize`/`ResizeObserver`) — só verificável em navegador |
| Painel de observabilidade ("Administração > Saúde do sistema") | Não iniciado | É funcionalidade nova de UI; decisão da titular. Se aprovado, nasce como domínio puro + painel testável em jsdom, sem inventar métricas |
| `viabilitySnapshot` no caminho conectado | Pendente | Exige tabela D1 própria + bloqueio de avanço da proposta (persistência antes de UI) |
| `dataProvenance` campo a campo | Pendente | Aplicação nas telas — trabalho visual, requer navegador |
| Restrições viárias (OSM) efetivas | Infra | Dependem do grafo OSM/PostGIS carregado (infra externa) |

## Como validar

```bash
npm run verify   # lint + testes unitários + testes de worker
npm run build    # gera dist/
```

Em produção, comparar `GET /api/status` → `version` com o SHA de `main`. A
publicação é automática via Cloudflare Workers Builds a cada push em `main`.

## Pendência de credencial (só a titular resolve)

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` no cofre do Worker — sem eles as
  notificações do navegador ficam desligadas (o app funciona normalmente).
- A chave da API Cloudflare compartilhada durante a sessão deve ser tratada como
  **exposta**: recomenda-se revogar/rotacionar. Foi usada apenas para consultas
  D1 somente-leitura de auditoria; nenhum segredo foi commitado.
