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

- **Produção** (rodada 1): `GET /api/status` → `version` `58c0000535fe`. **Rodada 2 (13/09/2026)**:
  `GET /api/system/version` → `2d65bdfdf87b` (PR #365), `environment: production`,
  `publishedBy: cloudflare-workers-builds`, `migrations.expected: 131`; **fecho da rodada**:
  `bd402c306939` (PR #367, P5/P6 + docs), `migrations.expected: 132`, última `0125`, D1 remoto sem
  migration pendente. **Rodada 3 / 3-bis (13/09/2026, tarde)**: `1a17c34d8cec` (P1.4) →
  `fdcd3bd627b7` (P2) → `037ab2538fb5` (Codex direto na `main`, incluindo os complementos do
  P5/P6) → **`3d83b2b7e6fe`** (PR #379, fecho), `migrations.expected: 136`, última `0133`, D1
  remoto sem pendência. Entre 14:40 e 18:07 UTC a produção ficou presa em `037ab25` porque o
  `deploy:cloudflare` passou a rodar Playwright dentro do build do Cloudflare (`cd8f90b`);
  desfeito no #379, o merge publicou em 70 s. A tela **Administração → Saúde do sistema**
  mostra LOCAL × SERVIDOR × BANCO lado a lado (`docs/DEPLOYMENT_RUNBOOK.md` §13a tem o
  registro de cada publicação).
- **Migrations**: rodada 1 até `0119`; rodada 2 acrescentou `0120`–`0125` (todas aditivas:
  métricas de integração, snapshots de viabilidade, cache geográfico, perfil energético do
  veículo, referências de energia, sinais de mercado + Risk Map); rodada 3 acrescentou
  `0130`/`0131` (Codex: sessões/reservas/preço de recarga, contratos GreenPay), `0132`
  (pré-flight persistido) e `0133` (preferências do radar) — `0126`–`0129` não existem
  (numeração pulada pelo Codex para evitar colisão; não há lacuna aplicada no D1).
  A anomalia da auditoria (0119 aplicada no D1 remoto e ausente do `main`) está
  reconciliada — o arquivo existe no repositório e a numeração segue linear.
  Nenhuma migration aplicada foi renomeada, reaplicada ou apagada.
- **Deploy**: Cloudflare Workers Builds é o publicador de fato (push em `main` →
  `npm ci` → `npm run verify` → `npm run build` →
  `npm run deploy:cloudflare`). GitHub Actions ("Publicar")
  ficou como contingência **manual** (`workflow_dispatch`).

## O que foi entregue nesta rodada (PRs mergeados)

| PR | Tema | Problema → Correção | Validação |
| --- | --- | --- | --- |
| **#351** | CI/CD independente | GitHub Actions falhava por minutos esgotados e travava o fluxo. → Cloudflare Builds documentado como principal; `deploy.yml` vira contingência manual; runbooks (`CLOUDFLARE_BUILDS_SETUP.md`, `GITHUB_SELF_HOSTED_RUNNER.md`) | `verify` + `build` verdes; deploy real via Cloudflare |
| **#352** | Estabilidade CSS | Chave `{` não fechada quebrava o CSS da vertical. → Correção pontual | `build` verde |
| **#353** | P0 — fim do "zero falso" | Uma coleção com erro zerava TODOS os records ("Banco indisponível", números falsos). → `Promise.allSettled` por coleção no worker + gancho resiliente + banner de 3 estados (fatal/parcial/desatualizado) com "Tentar novamente" | teste worker de falha parcial + testes do gancho e do banner |
| **#355** | Integridade Planner ↔ To-Do | "Aguardando" virava "Em andamento" a cada sync (perda no round-trip) e tarefa apagada ressuscitava. → `statusTarefaAoEspelhar` preserva o status mais fino; `removeTask` arquiva no Planner antes de remover | testes de round-trip de status e de propagação do delete |
| **#358** | P0 — versão e saúde | Produção sem identificação de SHA/ambiente e sem visão de integrações. → `GET /api/system/version` + **Saúde do sistema** (componentes, integrações em estado canônico, alertas `D1_BEHIND_CODE`/`CLIENT_SERVER_MISMATCH`, métricas por integração) + `TDG_ENVIRONMENT` | gate local verde; smoke em produção |
| **#362** | P2-A — viabilidade persistida | Viabilidade só calculada no cliente, proposta avançava sem ela. → snapshot imutável/versionado em D1 + gate server-side 409 `viability_required` + painel com proveniência | 13 testes de worker + jornada ERP |
| **#363** | P3-A — RoutingProvider | Pesado roteava como carro. → OSRM × Valhalla (truck costing) por veículo; `NO_SAFE_ROUTING_ENGINE` honesto; infra Valhalla no compose | 22 testes (domínio + worker) |
| **#364** | P3-B/C — elevação/clima/digital twin | Modelo de energia assumia plano e sem clima; veículo sem perfil físico. → Valhalla `/height` + Open-Meteo com cache e proveniência; perfil físico; baseline de consumo por observações | 23 testes unit + worker |
| **#365** | P4 — energia | Tarifa e diesel fixos no código; sem ONS; recarga sem plano por veículo. → hierarquias com fonte/data (ANEEL, ANP, ONS), plano de recarga por veículo, perfil por espaço, cron | 58 testes unit + 14 worker |
| **P5/P6** | Radar estruturado + Risk Map | Radar só por busca web (e endpoint órfão); risco viário inexistente; alternativas de rota não conectadas. → PNCP/Compras.gov/GDELT → `market_signal` com score explicável e triagem; PRF/ANTT → risco por rota; alternativas ranqueadas com risco como custo | 22 testes unit + 17 worker |
| **rodada 1** | Visibilidade da eletrificação + matriz + relatório | Domínios de decisão puros/testados não apareciam no caminho conectado. → `preflight` (PASS/WARNING/BLOCK + sugestões calculadas) anexado ao `POST /routes/electric-plan`, reusando o domínio puro (sem 3ª camada); matriz e este relatório atualizados | 3 testes de endpoint (PASS, BLOCK por autonomia, BLOCK por motorista) — suíte da API verde |
| **#371** | P1.4 — design system | Tokens `--tdg-*` declarados duas vezes no mesmo `.tdg` e 16 aliases que só valiam pelo fallback inline. → bloco canônico claro/escuro + aliases com valor real + guarda estática de tokens; regressão visual por screenshot | `designTokens.test.js`; gate local verde; produção `1a17c34d8cec` |
| **rodada 3** | Regressão visual — suíte única | O #371 e o commit direto do Codex (`c38c627`) criaram duas suítes de screenshot em paralelo. → consolidadas em `e2e/visual/` (config própria, relógio congelado, máscaras de relógio/versão/latência/mapa, 16 telas claro/escuro + mobile + portais), baselines versionados e revalidados | 4 testes Playwright, 43 imagens, geração + verificação independentes |
| **rodada 3** | P2 — pré-flight persistido + fila de ação | Pré-flight morria na resposta do electric-plan; rota era atribuída ao motorista sem checagem persistida; WARNING sem rastro de autorização. → `todogreen_preflight_results` (0132) + `POST /api/todogreen/preflight` resolvendo a entrada pelo cadastro + **gate** na coleção `rotas` (mesmo par, prazo, não-BLOCK, WARNING só com justificativa auditada) + passo na Roteirização; BLOCK/WARNING/risco alto → itens na Torre de Controle (Central de Trabalho, sem entidade nova) | 13 testes de domínio + 13 de worker (gate, override, kill switch, dedupe da fila); suítes de rotas/portal do motorista adaptadas |
| **rodada 3** | P5/P6 complementos | Termos de busca fixos no código; sinal triado não virava oportunidade sem redigitação; pedágio fora do ranking das alternativas. → prefs por espaço (`0133`) com cron pela união; `POST …/:id/opportunity` pela esteira de `records/opportunities` (mesma validação/auditoria, triagem `converted`); praças da ANTT por alternativa × tarifa média → `tollCost` no ranking (nota declara quando falta tarifa ou a consulta falha) | 3 testes de worker (prefs, sync com termos do espaço + cron, conversão idempotente) + 1 de ranking com pedágio + 2 de painel |

## Fechamento da task canônica (13/09/2026)

A regressão Planner ↔ To Do foi encerrada estruturalmente, não apenas com sincronização melhor:
`db.tasks` é a **fonte única da tarefa**. O Planner mantém planos, baldes e compartilhamento no servidor,
mas tarefas são projeções da task canônica. Criar, editar, concluir ou excluir pelo Planner altera a mesma
entidade exibida no To Do, CRM e Implantação, sem PATCH/DELETE de espelho.

Para preservar dados antigos, `GET /api/todogreen/planner/planos/:id/tarefas` continua disponível somente para
migração explícita. O runtime normal não lê essa coleção, evitando que uma tarefa apagada volte após recarregar. Escrita no store legado é bloqueada por padrão com `CANONICAL_TASK_REQUIRED`;
somente ferramentas explícitas de migração podem usar `x-tdg-legacy-planner-write: 1`.
Arquivar um plano apenas remove o vínculo da visão Planner e **não apaga** a task canônica.

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
| Design system / regressão visual (P1.4) | **Entregue (#371 + rodada 3)** | Tokens canônicos + aliases + guarda; suíte única de regressão visual em `e2e/visual/` com baselines (Chromium/Linux da sessão remota); caminho Docker documentado, ainda não exercitado |
| Roteirizador em duas colunas (mapa) | Backlog | Depende de o Leaflet montar (`invalidateSize`/`ResizeObserver`) — só verificável em navegador |
| Pré-flight persistido + despacho automático | **Entregue** | Gate canônico na coleção `rotas`, fila de ação na Torre de Controle e `/dispatch/aplicar` usando `registrarPreflight` + a mesma `gateDePreflightDaRota`; BLOCK não grava, WARNING exige justificativa auditada e a rota persiste `preflight_id/status`. |
| P7 — Green On (comandos OCPP), GreenPay repasse (SysPag), Core All Green / Greenmob | Externo | O Codex trouxe sessões/reservas de recarga, cobrança por kWh e GreenPay fase 2 (contratos) na `main` (`c38c627`, migrations 0130/0131); comandos OCPP exigem CSMS, repasse exige token SysPag e identidade multi-vertical exige decisão de arquitetura — nada disso é simulado |
| Painel de observabilidade ("Administração > Saúde do sistema") | **Entregue (#358)** | Domínio puro `systemHealthDomain` + painel; integrações só ficam "Operacional" com teste/sincronização realtricas |
| `viabilitySnapshot` no caminho conectado | **Entregue (#362)** | Tabela própria, versionamento por hash, gate 409 na proposta |
| `dataProvenance` campo a campo | Parcial | Aparece na viabilidade (fontes/tipo/confiança), na Energia (origem/data/vigência) e nos sinais de mercado (motivos do score); demais telas seguem sem |
| Restrições viárias (OSM) efetivas | Infra | Dependem do grafo OSM/PostGIS carregado (infra externa) |

## Como validar

```bash
npm run verify                  # lint + testes unitários + testes de worker
npm run build                   # gera dist/
npm run test:e2e:critical       # jornadas críticas no Chromium (antes do merge; :ci instala o navegador)
```

Em produção, comparar `GET /api/status` → `version` com o SHA de `main`. A
publicação é automática via Cloudflare Workers Builds a cada push em `main`
(`npm ci && npm run verify && npm run build` e depois `npm run deploy:cloudflare`,
que aplica migrations e publica). O gate de navegador (`test:e2e:critical`) roda
**antes do merge** e no fallback manual `deploy.yml`; não roda dentro do build do
Cloudflare — o container não instala Chromium e a tentativa de 13/09 (`cd8f90b`) deixou a
`main` sem publicar até ser desfeita. GitHub Actions vermelho por falta de minutos/runner
não bloqueia; `verify`, `build`, E2E crítico local, Cloudflare Build ou deploy manual vermelho bloqueia.

## Regressões conhecidas

- O antigo vermelho de `LogisticsVertical.test.jsx › abre o To Do diretamente pela jornada do espaço de trabalho` foi **corrigido**: a jornada entra em `Hoje`, abre `Quadro` e então valida `Nova tarefa`.
- O lint vermelho histórico no `PlannerPage` foi corrigido em #365 sem mudar comportamento.
- Nesta rodada, nenhuma regressão interna conhecida é tratada como verde por documentação; falhas externas continuam declaradas como externas.

## Pendência de credencial (só a titular resolve)

- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` no cofre do Worker — sem eles as
  notificações do navegador ficam desligadas (o app funciona normalmente).
- A chave da API Cloudflare compartilhada durante a sessão deve ser tratada como
  **exposta**: recomenda-se revogar/rotacionar. Na rodada 2 foi usada, só por variável de
  ambiente, para `wrangler d1 migrations list --remote` e dois deploys manuais
  (`d2396e44`, `401f7ec`); nenhum segredo foi commitado.
- **Workers Builds publica sem gate**: definir o *build command* como
  `npm run verify && npm run build` (ver `AUDITORIA_CONSOLIDACAO_TDG.md` §12.4 para a lista
  completa de decisões da titular: token, gate, teste do To Do, `TDG_ENVIRONMENT` em prévia,
  infra Valhalla/OSRM, CSV da PRF, perfil de energia por espaço, R2).
- **Rodada 3** acrescentou três decisões (§13.4): Codex direto na `main` sem PR/gate (manter ou
  exigir PR), baseline canônico da regressão visual via Docker (rodar uma vez numa máquina com
  Docker) e estender o gate de pré-flight ao despacho automático.
