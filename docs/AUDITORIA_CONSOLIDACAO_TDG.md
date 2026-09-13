# Auditoria de Consolidação — To Do Green

> Documento da **Fase 0** da rodada de consolidação/estabilização. Registra o
> estado real **antes** de qualquer alteração. Atualizado ao longo da rodada.
>
> Gerado em: 2026-09-13. Autor: sessão de consolidação (Claude Code).

## 0. Como este documento evolui

Este arquivo é o diário da rodada. As seções marcadas **[em apuração]** têm
levantamento detalhado em curso (varredura de leitura do código) e serão
consolidadas aqui e na `docs/TODOGREEN_ERP_READINESS_MATRIX.md`. Nada de código
funcional é alterado até a auditoria da fase correspondente estar registrada.

## 1. Versões: main × produção

| O quê | Valor |
|---|---|
| **SHA do `main`** (origin) | `5275b05` — "Roteirizador (produtividade): importar paradas em massa (#349)" |
| **SHA em produção** | `92a2850` — "Roteirizador: operação criada na mão vira roteirizável (#348)" |
| **Como ler o SHA de produção** | `GET /api/status` → campo `version` (12 chars = short SHA git). Também há `buildTime`. |
| **Diferença** | Produção está **1 merge atrás** do `main`. `git diff 92a2850 5275b05` = **4 arquivos** (só o #349): `public/sw.js`, `src/features/logistics/operationsImportDomain.js(.test)`, `src/features/logistics/pages/OperationsPage.jsx`. |
| **Banco/DB** | D1 `seu-funcionario-db` (`database_id` `dfa94699-...`); Worker `seufuncionario-expo` (`wrangler.jsonc`, `main: worker-entry.js`). O nome bate com o Worker em produção. |

**Diagnóstico:** hoje a defasagem main→produção é pequena (1 commit), mas o
**mecanismo** de publicação é frágil (ver seção 3). O objetivo é levar o código
bom até produção de forma confiável — **não** fazer downgrade do código para
igualar produção.

## 2. Migrations (local × remoto)

Auditado no D1 remoto via API Cloudflare (token da titular, **somente leitura** —
`SELECT`), já que `wrangler --remote` está bloqueado pelo classifier do ambiente.

| O quê | Valor |
|---|---|
| Migrations **locais** (main 5275b05) | 125 arquivos, última = `0118_todogreen_employee_tickets.sql` |
| Migrations **aplicadas no D1 remoto** | **126**, última = `0119_todogreen_operation_import_templates.sql` |
| Tabelas `todogreen%` no remoto | 144 |

### 🔴 Anomalia (processo): migration à frente do main

O D1 de **produção tem a `0119_todogreen_operation_import_templates.sql` aplicada,
mas essa migration NÃO está no `main`** — ela só existe em branches não-mergeadas
(`claude/wonderful-ride-281eyw`/#341 "Recarga fase 2" e a #337). Ou seja, **uma
migration de branch não-mergeada foi aplicada no banco de produção** (provável
`wrangler d1 migrations apply --remote` rodado de uma branch, ou build de branch
mal configurado).

- **Risco atual:** baixo — a 0119 é aditiva (tabela nova de "operation import
  templates") e o código do `main` não a lê; quando #341 mergear, o wrangler vê a
  0119 como já aplicada (rastreada por nome) e **não** reaplica (sem duplo-apply).
- **Por que importa:** é a prova concreta do problema de disciplina de deploy
  (item 14: "migration aplicada fora do main", "deploy de SHA ≠ main"). Reforça o
  PR 1 (deploy só via `main`) e a guarda anti-regressão correspondente.
- **NÃO** vou reverter/renomear/reaplicar nada (regra da rodada).

### Colisão de número conhecida e aceita

Dois `0112_` (`0112_drop_todogreen_operations.sql` e
`0112_todogreen_internal_files_r2.sql`) — **ambos aplicados** no remoto. O commit
`9a08405` decidiu manter os nomes já aplicados. **NÃO renomear/reaplicar/apagar.**

## 3. CI/CD (P0)

**Estado atual:**
- `.github/workflows/ci.yml` ("Qualidade"): roda em push na `main` e em PRs —
  `npm ci` → `lint` → `test:unit` → `test:worker` → `build` → E2E (Playwright).
- `.github/workflows/deploy.yml` ("Publicar"): dispara por `workflow_run` da
  "Qualidade" **só se ela concluir com sucesso**; exige o segredo
  `CLOUDFLARE_API_TOKEN`.
- **Cloudflare Workers Builds** (integração nativa, ligada ao repo): publica em
  push na `main` de forma independente do GitHub Actions. **É quem publica hoje.**

**O problema:** os minutos/franquia do GitHub-hosted Actions esgotaram. O job da
"Qualidade" **morre no startup** (job com `runner_name` vazio, `steps: []`,
duração de 2–4s, sem logs — HTTP 404 ao baixar). Isso já afeta o `main`: os
últimos merges (#339, #340, #343) mostram "Qualidade" **failure**; a "Publicar"
fica **skipped**. Ou seja, a publicação **não pode depender** do GitHub Actions.

**Plano (PR 1):** tornar o **Cloudflare Workers Builds** o CI/CD principal
(build+validação+migrations+deploy), evitar deploy duplicado do GitHub Actions,
e documentar: painel Cloudflare (cliques exatos), runner self-hosted (fallback),
e deploy manual de emergência. Detalhes em `docs/CLOUDFLARE_BUILDS_SETUP.md`,
`docs/GITHUB_SELF_HOSTED_RUNNER.md` (a criar no PR 1). Reutilizar scripts já
existentes (`npm run verify`, `build`, `deploy:cloudflare`) sem duplicar.

## 4. Erro "Não foi possível carregar os registros" (P0)

**Raiz confirmada (no código):**
- Backend `worker/services/todogreen-vertical-records.js`, handler agregado
  (`handleTodoGreenVerticalRecords`, sem coleção na URL, ~linha 2697):

  ```js
  const [listas, cenarios] = await Promise.all([
    Promise.all(permitidas.map((n) => listar(env, COLECOES[n], access, user.email))),
    ...
  ]);
  ```

  Usa **`Promise.all`** sobre todas as coleções permitidas. Se **UMA** coleção
  falha (ex.: coluna/tabela ausente, SQL incompatível com o schema remoto), o
  `Promise.all` **rejeita inteiro** → o agregado responde erro → o frontend cai
  no `catch`.
- Frontend `src/features/logistics/useVerticalRecords.js`: o `catch` de
  `carregarColecoes` só faz `setErro(...)`; como o estado inicial é `VAZIO`
  (todas as coleções `[]`), na **primeira** carga com falha os `dados` ficam
  zerados. As telas renderizam **zero** a partir do `VAZIO`.

**Consequência:** uma coleção defeituosa (ex.: `financial`) zera **todas** as
outras (clientes, oportunidades, operações), e erro de infraestrutura vira
número **0** — exatamente o sintoma relatado.

**Plano (PR 2):** isolar por coleção (`Promise.allSettled` no backend), resposta
agregada `{ data, errors, totals }`, e no frontend distinguir
zero-real × indisponível × desatualizado (stale) + botão "Tentar novamente" +
estado de carregando + identificar a área afetada. Sem expor SQL/D1 ao usuário
final; diagnóstico técnico só em área de admin (ver seção "Observabilidade").
Testes: (1) financial falha, oportunidades continuam; (2) tudo falha → mostra
indisponível, não zero; (3) zero real continua zero; (4) retry recupera sem
reload total. **Investigar também a causa concreta em produção** (PR 2/3): qual
coleção falha e por quê (coluna/tabela/permission gate/SQL) — sem reaplicar
migration destrutivamente.

## 5. Regressões conhecidas (a confirmar/corrigir nas fases)

| Regressão | Evidência | Fase |
|---|---|---|
| **Records zerados em falha parcial** | seção 4 (raiz confirmada) | PR 2 |
| **To Do "voltou ao formato antigo"** | **Resolvido em 13/09/2026**: a entrada própria usa HOJE/PRÓXIMAS/QUADRO/PROJETOS e reaproveita `TasksScreen` apenas como visão avançada, preservando as funções históricas | concluído |
| **Planner × To Do (duas verdades)** | **Resolvido em 13/09/2026**: `db.tasks` é a task canônica. Planner projeta e edita a mesma entidade; CRM e Implantação já gravam nela. O store antigo do Planner fica somente para leitura/importação legada; escrita direta exige opt-in explícito `x-tdg-legacy-planner-write: 1` e não é usada pelo app | concluído |
| **Roteirizador perde o mapa (Leaflet branco)** | histórico: 2 colunas quebrou o Leaflet → voltou a 1 coluna. Preservar correções; só migrar com `invalidateSize`/`ResizeObserver` provados por teste | PR 5 |
| **Navegação: quase todo o organograma no 1º nível** | Confirmado: `PRIMARY_NAVIGATION` (`LogisticsVertical.jsx:966`) = **19 áreas** no 1º nível, lista plana. Rotas↔`MODULE_IMPLEMENTATION` batem 68↔68; **aliases de URL já existem** (`TODO_GREEN_ROUTE_ALIASES`) — base boa para reagrupar sem quebrar links. Smell: página desconhecida cai silenciosamente no Dashboard (`:3597`) | PR 4 |

## 6. Pacote de eletrificação — classificação A–F (o que existe × o que está visível)

Legenda: A=domínio puro · B=backend/worker · C=persistência(D1) · D=UI
acessível+roteada · E=auditoria · F=jornada real em produção.

| Domínio (arquivo em `src/features/logistics/`) | A | B | C | D | E | F | Situação |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|
| `driverOfflineQueueDomain` | ✅ | ✅ | ✅ | ✅¹ | ✅ | ✅ | **Maduro** — app do motorista (PWA offline), migração `0094` (idempotência) |
| `energyEstimationDomain` | ✅ | ✅ | ❌ | ❌ | ~ | ❌ | Só na **API TMS externa** `/api/tms/v1/routes/electric-plan` (key-gated); nada persiste; sem UI |
| `routingEngineSelectionDomain` | ✅ | ~ | ❌ | ❌ | ~ | ❌ | Metadado **advisory** na mesma API; a decisão real de motor está no dispatch/VROOM |
| `viabilitySnapshotDomain` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **PURO ONLY** — só importado pelo próprio teste |
| `preflightDomain` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **PURO ONLY** |
| `roadRestrictionDomain` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **PURO ONLY** |
| `dataProvenanceDomain` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **PURO ONLY** (proveniência é princípio espalhado no código, mas este módulo dedicado não é usado) |
| `routeAlternativesDomain` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **PURO ONLY** (espera saída do `roadRestrictionDomain` mas não o chama) |

¹ acessível pela rota standalone do portal do motorista, **não** pelo menu do ERP (por desenho).

### 🔴 Padrão a corrigir com cuidado no PR 6

Os 7 domínios foram criados **no mesmo lote (13/09 00:55)** e **vários são
re-implementações puras que SOMBREIAM módulos antigos já ligados na UI**:

- `viabilitySnapshotDomain` × **`tripViabilityDomain`** (ligado via `TripViabilityPage`)
- `preflightDomain` × **`driverChecklistDomain`** (ligado no `todogreen-driver-portal`)
- `energyEstimationDomain` × **`energyDomain`** (ligado via `EnergyPanel`)
- `routingEngineSelectionDomain` × **`routingOptimizationDomain`/`distanciaRodoviariaDomain`**

Ou seja: a UI hoje usa os **antigos**; os **novos** estão em grande parte mortos.
O item 11 do pedido ("tornar visível o que foi criado, sem criar outra camada
duplicada") exige **reconciliar** (ligar os novos na UI existente OU consolidar
antigo+novo numa fonte só) — **não** adicionar uma terceira camada. Prioridade da
rodada (PR 6): Viabilidade (resultado visível + snapshot versionado + bloqueio +
auditoria), Pré-flight (PASS/WARNING/BLOCK visível) e Proveniência
(fonte/confiança/versão ao expandir um número). Decisão de reconciliação a
registrar antes de codar o PR 6.

## 7. Integrações externas — status honesto

Classificado por caminho de código real (não por texto de doc/UI). Regra:
**documentação/UI mencionar ≠ REAL**. A matriz `TODOGREEN_ERP_READINESS_MATRIX.md`
será atualizada com isto no PR 6.

| Integração | Status | Evidência |
|---|---|---|
| **ANEEL** | **REAL** | `fetch` CKAN `dadosabertos.aneel.gov.br` (gateway); `configured:true` sem chave |
| **ANTT** (open data) | **REAL** | `fetch` `dados.antt.gov.br` (RNTRC); **CIOT** é **EXTERNA** (env `TODOGREEN_ANTT_CIOT_*` + conector C#/Windows) |
| **OSRM** | **REAL** | `routeTodoGreen` faz `fetch` real; público por padrão, self-hosted via `TODOGREEN_OSRM_BASE_URL` |
| **PNCP** | **PARCIAL** | só filtro `site:pncp.gov.br` na busca web + classificador de fonte; 503 sem provedor de busca |
| **Track3r** | **PARCIAL** | **import de arquivo é REAL** (projeta em `todogreen_client_operations`); API/webhook gated por segredo (EXTERNO até sincronizar) |
| **Valhalla** | **PREPARADA** | sem cliente de rota; só *seleciona* `engine:"valhalla"` como metadado quando `TDG_VALHALLA_BASE_URL` existe |
| **VROOM** | **EXTERNA** | adaptador real, mas **503 `routing_not_configured`** sem `TDG_ROUTING_URL`; fallback é o VRP WASM local |
| **ANTT-CIOT** | **EXTERNA** | conector self-hosted (`connectors/antt-ciot/`) + certificado |
| **ONS** | **NÃO CONFIGURADA** | zero código; só em listas de "conectores futuros" nos docs |
| **ANP** | **NÃO CONFIGURADA** | zero caminho real; só comentário de exemplo em domínio puro |
| **GDELT** | **NÃO CONFIGURADA** | zero código; só docs |
| **PRF** | **NÃO CONFIGURADA** | zero caminho real; só comentário |
| **OCPP** | **NÃO CONFIGURADA** | sem código de protocolo/sessão; só card de status `configured:false` |

Nota: o próprio gateway (`todogreen-integrations.js`) documenta o conjunto vivo
como "APIs públicas gratuitas (CEP, IBGE, Bacen, ANTT, ANEEL, Open Charge Map) e
stack self-hosted (OSRM, Nominatim, VROOM, IA local)" — consistente com o acima.

## 8. Branches e PRs abertos

**PRs abertos (a triar — não serão alterados nesta rodada; meu trabalho vai em PRs novos):**

| PR | Branch | Título | Nota |
|---|---|---|---|
| #341 (draft) | `claude/wonderful-ride-281eyw` | Recarga: sessão medida, reserva, cobrança kWh, GreenPay fase 2 | Feature nova — fora do escopo desta rodada |
| #337 (draft) | `claude/busy-hawking-ap8vok` | Remove TRACK3R; TMS 100% nativo | Relacionado à seção 7 (integrações) |
| #309 (draft) | `cleanup/allgreen-only` | Produto exclusivo All Green | Cleanup antigo (11/09) |
| #189 | `codex/tdg-ux-meu-dia-navegacao` | Meu dia e navegação | UX/nav antigo (05/09) |
| #185 | `codex/tdg-crm-shortcuts-login-layout` | Filtros dos indicadores + 4 portais | Antigo (04/09) |

Há ~40 branches remotas (agent/codex/claude/*), a maioria já mergeada ou obsoleta.
Não serão apagadas nesta rodada sem confirmação.

## 9. Dependências de infraestrutura externa (só a titular resolve)

- **GitHub Actions:** franquia/minutos esgotados (P0 do CI/CD).
- **Cloudflare (painel/cofre):** conectar/ajustar Workers Builds; segredos;
  aplicar migrations remotas; publicar. Requer a conta da titular.
- **Pendências já documentadas** (`PENDENCIAS_DA_TITULAR.md`): VAPID (push),
  SysPag (repasse PIX), R2 (mídia — opcional; POD já servido do D1), Gmail
  (`GOOGLE_CLIENT_SECRET`), WhatsApp Cloud API, TRACK3R (token/URL).
- **Integrações externas** (seção 7): dependem de credenciais/endpoints.

## 10. Constraints desta sessão de auditoria (transparência)

1. **Cloudflare:** a titular compartilhou um token de API que **funciona para
   leitura do D1 via API REST** (curl) — usei-o **somente para `SELECT`**
   (auditar migrations/schema remotos). Porém: `wrangler` está **bloqueado pelo
   classifier** do ambiente (ação de produção), e **não** faço escritas/deploy/
   apply de migrations nem configuro o painel Workers Builds por aqui — isso é
   **documentado** para a titular executar. ⚠️ O token passou pelo chat: **deve
   ser revogado/rotacionado** após esta rodada.
2. **Sem navegador (Playwright) no sandbox** → os testes de screenshot E2E podem
   ser **escritos** aqui, mas **não executados** (o Chromium/headless-shell não
   está instalado). A execução fica para runner self-hosted / local / Cloudflare,
   conforme viabilidade (seção 9 do pedido).
3. **GitHub Actions indisponível** (franquia) → validação e publicação não podem
   depender dele nesta rodada.

## 11. Plano de entrega (PRs) e critérios

Sequencial, na branch designada, **validando antes de cada merge**
(`npm run verify` + `npm run build` + testes específicos), merge via Cloudflare
(sem depender do Actions):

- **PR 1** — CI/CD (Cloudflare Builds principal + docs de setup/runner/emergência) + este diagnóstico de versões.
- **PR 2** — Carregamento de registros: falha parcial isolada, fim do zero-falso, retry/stale, investigação da causa em produção.
- **PR 3** — To Do (HOJE/PRÓXIMAS/QUADRO/PROJETOS) preservando funcionalidade + caminho para fonte canônica de tarefas (Planner×To Do).
- **PR 4** — Navegação agrupada (sem perder módulos, com alias de URLs) + SSO interno ERP/TMS + isolamento dos portais.
- **PR 5** — Design system (tokens canônicos + aliases) + regressão visual (testes) + roteirizador (2 colunas só com Leaflet provado).
- **PR 6** — Visibilidade da eletrificação (viabilidade/pré-flight/proveniência) + matriz de integrações honesta + observabilidade (Saúde do sistema).

**Guardas anti-regressão** (testes/lint) ao longo dos PRs, conforme item 14 do
pedido (zero-falso, rota com duas telas, módulo fora do catálogo, tarefa
duplicada, portal importando interno, relogin no TMS, token de design duplicado,
CSS lazy não importado, item de menu sem nome, overflow horizontal, Leaflet sem
container, migration renomeada, deploy de SHA ≠ main sem identificação).

Relatório final em `docs/RELATORIO_CONSOLIDACAO_TDG.md` ao fim da rodada.


## 12. Rodada 2 (13/09/2026) — P0→P6 executados, com SHAs e decisões

Diário da segunda rodada (mesma sessão de consolidação). Regra mantida: **auditar
antes de criar, estender em vez de duplicar, publicar só com gate local verde,
nunca tocar em migration aplicada**. Tudo abaixo está em `main` e em produção,
salvo onde indicado.

### 12.1 O que entrou (PRs mesclados, em ordem)

| PR | Fase | Entrega | Migrations |
| --- | --- | --- | --- |
| #358 | P0 | `GET /api/system/version` (sha/buildTime/branch/publishedBy/environment/migrations) a partir do manifesto do build; **Saúde do sistema** (Administração) com componentes, integrações da seção 113 em estado canônico, alertas `D1_BEHIND_CODE`/`CLIENT_SERVER_MISMATCH`, métricas por integração (latência/volume/último sucesso e falha); `TDG_ENVIRONMENT` no Worker; guarda de isolamento dos portais externos (teste estático) | `0120` |
| #362 | P2-A | Viabilidade operacional **persistida** (`todogreen_viability_snapshots`, imutável/versionada por hash do conteúdo) e **gate server-side da proposta** (409 `viability_required` ao enviar/aprovar sem snapshot); painel de viabilidade na oportunidade com proveniência | `0121` |
| #363 | P3-A | `RoutingProvider` real: OSRM (leves) × **Valhalla truck costing** (pesados) escolhido pelo veículo; sem Valhalla configurado, pesado recebe `NO_SAFE_ROUTING_ENGINE` (409) — nunca rota de carro; catálogo/probe/saúde do Valhalla; `docker-compose` com Valhalla; seletor de veículo na Roteirização | — |
| #364 | P3-B/C | **Elevação** (Valhalla `/height`) e **clima** (Open-Meteo) honestos com cache (`todogreen_geo_cache`) e proveniência no snapshot de viabilidade; **perfil físico/energético do veículo** e **baseline de consumo** (observações → mediana/p90/correção) — digital twin | `0122`, `0123` |
| #365 | P4 | **Tarifa de energia** pela hierarquia contrato > informada > **ANEEL** (cache do datastore) > fallback declarado; **ANP** diesel (CSV oficial → mediana por município/UF/região/país); **ONS** curva de carga → janela financeira/energética/recomendada; **plano de recarga por veículo** (pontos × tarifa × demanda contratada); perfil de energia por espaço; cron auto-limitado; Saúde do sistema com ANEEL/ONS/ANP reais; correção de lint na `main` (`PlannerPage`, React Compiler) | `0124` |
| P5/P6 | P5/P6 | **Sinais de mercado estruturados** (PNCP · Compras.gov · GDELT → `market_signal` com fingerprint e score explicável, triagem por espaço, cron) e correção da rota órfã `/api/todogreen/market-radar`; **Risk Map** (PRF por célula ~1,1 km com UPS; ANTT por rodovia/km via CKAN) com `POST /api/todogreen/risk/route`; **alternativas de rota** com risco como custo (`rankRouteAlternatives` conectado) e cartão de risco na Roteirização | `0125` |

### 12.2 Produção × main ao longo da rodada

Ver a tabela de SHAs em `docs/DEPLOYMENT_RUNBOOK.md` §13a. Resumo: `58c0000` (início) →
`d2396e44` (manual) → `700468c` (auto, **com teste do To Do vermelho**) → `401f7ec` (pin manual
no último verde) → `cc4c0fe` → `2a4d459` → `c4f3637` → `2d65bdf` → `bd402c3` (autos, cada um com gate local
verde exceto a falha pré-existente abaixo). D1 remoto acompanhou (0120→0125 aplicadas pelo
`deploy:cloudflare` do build; ao fecho, `wrangler d1 migrations list --remote` sem pendências). Nenhuma migration renomeada,
reaplicada ou apagada; nenhum SQL destrutivo.

### 12.3 Regressões encontradas na `main` fora do escopo desta sessão

- **Teste vermelho** `LogisticsVertical.test.jsx › abre o To Do diretamente pela jornada do espaço
  de trabalho` desde o commit `0ae17c2` (To Do canônico — Codex): o botão "Nova tarefa" saiu da
  tela e o teste ainda o espera. **Não alterado aqui** (escopo entregue ao Codex pela titular).
  Todos os gates desta rodada registram essa única falha (4111+ testes passando).
- **Lint vermelho** no mesmo commit (`Date.now`/`Math.random` no corpo do `PlannerPage`, regra de
  pureza do React Compiler): corrigido em #365 com um helper de módulo, sem mudar comportamento.
- **Endpoint órfão** `/api/todogreen/market-radar` (a tela RFQs/RFIs chamava uma rota que não
  existia no roteador): roteado em P5/P6.

### 12.4 Decisões que só a titular toma (deixadas para o fim, como pedido)

1. **Rotacionar o token da API Cloudflare** compartilhado no chat (usado só via variável de
   ambiente para `wrangler d1 migrations list/apply` e `deploy`; nunca gravado no repositório).
2. **Workers Builds sem gate**: hoje todo push em `main` publica sem rodar testes. Definir o *build
   command* como `npm run verify && npm run build` (falha do teste bloqueia o deploy) — ou aceitar
   o risco explicitamente.
3. **Teste do To Do** (12.3): Codex atualiza o teste ou devolve o botão.
4. **`TDG_ENVIRONMENT`** nos Workers de prévia (`preview`) para a Saúde do sistema não rotular prévia
   como produção.
5. **Infra self-hosted** (`infra/tms-routing`): Valhalla (pesados, elevação, alternativas), OSRM,
   Nominatim, VROOM — sem eles, pesados não roteiam (honesto) e elevação/alternativas ficam limitadas.
6. **Risk Map**: importar o CSV oficial da PRF (`POST /api/todogreen/risk/import/prf`) — sem ele o
   risco por rota é `RISK_DATA_NOT_AVAILABLE`.
7. **Perfil de energia** de cada espaço (distribuidora/subgrupo/modalidade, UF/município, demanda,
   horários) na tela Energia — destrava ANEEL/ANP no cálculo.
8. **R2 (`MEDIA_BUCKET`)** opcional para anexos fora do D1.
9. **P1.4 design system/regressão visual** e **P2 restante** (pré-flight persistido como gate de
   publicação de rota, Action Queue) e **P7** (Green On/OCPP comandos, GreenPay repasse, Core All
   Green/Greenmob) — não iniciados nesta rodada; ver `RELATORIO_CONSOLIDACAO_TDG.md` "O que falta".

## 13. Rodada 3 (13/09/2026, tarde) — P1.4 publicado, `main` do Codex absorvida, P2 fechado

### 13.1 O que entrou

| Entrega | Onde | Estado |
| --- | --- | --- |
| **P1.4 design system**: bloco canônico `.tdg` (claro/escuro), 16 aliases legados com valor real, guarda estática de tokens | PR #371 → `1a17c34d8cec` em produção (13:20 UTC) | REAL |
| **Regressão visual — suíte única**: o PR #371 trouxe `e2e/todogreen-screenshots.spec.js`; o commit do Codex `c38c627` (direto na `main`, mesmo horário) trouxe `e2e/visual/` + `playwright.visual.config.js` + Docker. Duas implementações paralelas → **consolidadas** na de `e2e/visual/` (máscaras de relógio/versão/latência/mapa e as telas Saúde do sistema/Inteligência migraram; o spec e os 12 PNGs do #371 foram removidos); baselines gerados e revalidados aqui | este PR | REAL (Docker ainda não exercitado — `docs/VISUAL_REGRESSION.md`) |
| **`main` do Codex absorvida com gate**: `c38c627` (menu em 8 grupos, sessões/reservas de recarga, cobrança por kWh, GreenPay fase 2, migrations `0130`/`0131`) entrou na `main` sem PR e sem gate; o merge do #371 sobre ele foi gateado aqui depois do fato: lint 0 erros, worker 106/106, unit 352 ok (única falha: o teste do To Do, 12.3), build ok; D1 remoto já tinha `0130`/`0131` (`migrations list --remote` sem pendências) | — | verificado |
| **P2.b pré-flight persistido** (migration `0132`): `POST /api/todogreen/preflight` resolve motorista/veículo/carregadores pelo cadastro, roda `preflightDomain`, grava resultado + proveniência; **gate** na coleção `rotas` (mesmo par por assinatura, prazo, não-BLOCK, WARNING só com justificativa auditada); passo "Rodar pré-flight" na Roteirização | este PR | REAL |
| **P2.c fila de ação**: BLOCK/WARNING e risco viário alto viram itens no quadro seed Torre de Controle (dedupe por `sourceKey`) — sem entidade nova | este PR | REAL |
| **P5/P6 complementos**: termos PNCP/GDELT e UFs de foco por espaço (`0133`, `GET/PUT /market-signals/prefs`; sync manual usa o espaço, cron usa a união); "Criar oportunidade" a partir do sinal pela esteira de `records/opportunities` (triagem `converted`); pedágio por alternativa (praças da ANTT × tarifa média) no custo total do ranking, com nota honesta quando falta tarifa ou a consulta falha | PR seguinte | REAL |

### 13.2 Produção × main

`f357c76` (fecho da rodada 2) → `1a17c34d8cec` (merge do #371 sobre `c38c627`; Workers Builds; `migrations.expected` 134, última `0131`) → **`fdcd3bd627b7`** (PR #373, P2; Workers Builds 13:48 UTC; `migrations.expected` 135, última `0132`). A migration `0132_todogreen_preflight_results` (aditiva) foi aplicada no D1 remoto **antes** do merge, para o código novo nunca encontrar a tabela ausente. → **P5/P6 complementos (PR seguinte): SHA a registrar após o merge**; migration `0133_todogreen_market_radar_prefs` pelo mesmo caminho.

### 13.3 O que mudou no diagnóstico

- A regra "auditar antes de criar" agora vale também para o que chega **em paralelo pela `main`**: o Codex publica direto, sem PR; toda rodada começa com `git fetch` + diff da `main` antes de qualquer commit (foi assim que a duplicata da regressão visual apareceu e foi resolvida no mesmo dia).
- O gate de pré-flight é **restritivo por padrão**: quem atribui rota pela Roteirização passa obrigatoriamente pela checagem. O despacho automático (`todogreen-dispatch.js`) continua criando rotas sem pré-flight persistido (filtra disponibilidade, mas não grava resultado) — está na matriz como limite e é a próxima extensão natural (mesmo serviço, mesma tabela).

### 13.4 Decisões da titular — lista atualizada

Permanecem as de 12.4 (1–8). Novas:

10. **Codex direto na `main`**: manter assim (rápido, sem gate) ou exigir PR com gate local declarado, como esta sessão faz. Enquanto for direto, cada rodada daqui absorve e gateia o que entrou.
11. **Regressão visual canônica**: rodar uma vez `npm run test:visual:docker` numa máquina com Docker; se acusar só anti-aliasing, regenerar lá e passar a tratar o Docker como origem única dos baselines.
12. ~~**Gate de pré-flight no despacho automático**~~ — **fechado pelo Codex** (`cd8f90b`): `/dispatch/aplicar` chama `registrarPreflight` + `gateDePreflightDaRota` (o mesmo serviço, sem duplicação) e a atribuição direta legada foi desativada (`CANONICAL_ROUTE_REQUIRED`).
13. **Onde roda o gate de navegador** (`test:e2e:critical`): hoje antes do merge (sessão/local) e no `deploy.yml`; para virar gate automático de produção precisa do runner self-hosted ou de proteção da `main` com PR obrigatório (script `scripts/github/protect-main.sh`, que exige permissão administrativa) — dentro do Workers Builds não é possível (13.5).

### 13.5 Rodada 3-bis (13/09, 17h UTC) — `main` do Codex absorvida e gateada depois do fato

Enquanto esta sessão estava pausada (limite de uso da titular), o Codex publicou 5 commits direto na `main`, sem PR e sem gate: `a363850` (o conteúdo do PR #374, idêntico byte a byte), `bfcb2a1` (PR #372 recuperado: navegação reativa, Meu Dia, TMS, chunk recovery, **teste do To Do corrigido**), `e1de658` (Design System fase 1: Card, Table, Drawer, Tooltip, feedback), `037ab25` (hardenings: score determinístico, holerite, POD) e `cd8f90b` (pré-flight no despacho, E2E crítico, k6, docs). Verificação feita aqui:

| Achado | Estado | Ação |
| --- | --- | --- |
| Migrations `0133` no D1 remoto | aplicada (`migrations list --remote` sem pendências) | — |
| Despacho automático reutiliza o serviço de pré-flight | correto (sem implementação paralela) | decisão 12 fechada |
| Matriz: gates Jurídico/assinatura/implantação/tabela de preço marcados REAL | coerente com o código (`juridicoConcluido`, cofre de evidência; `it.todo` restante só o CT-e) | — |
| **Lint vermelho na `main`** | `MarketSignalsPanel.test.jsx`: um `\n` literal colado na linha (erro de parse) em `bfcb2a1` | corrigido nesta rodada |
| **Produção presa em `037ab25`** | `cd8f90b` passou a rodar `npx playwright install --with-deps chromium` + E2E **dentro do deploy command do Workers Builds**; 30+ min depois nenhum deployment novo (`wrangler deployments list`), a API de builds não é legível com o token | `deploy:cloudflare` voltou a migrations + publicação; gate de navegador antes do merge e no `deploy.yml`; `deploy:cloudflare:gated` para publicação manual com Chromium; docs (AGENTS, CLOUDFLARE_BUILDS_SETUP, runbook, matriz P0, relatório) corrigidas para o estado real |
| Regressão visual: `tms-mobile` oscila (fotografado no meio de "Carregando torre de controle…") | 2 de 5 execuções | `estabilizar` espera a rede assentar e o `.tms-loading` sumir (teto 45 s) |
| **Worker vermelho na `main`**: `todogreen-erp-journey.worker.test.js` (jornada cliente → caixa) quebrou no despacho — o veículo do cenário não tinha bateria/consumo e o pré-flight do `cd8f90b`, corretamente, devolveu WARNING (409) | 1 arquivo em 107 | cenário ganha veículo completo (120 kWh, SoH 98%, 0,45 kWh/km) e passa a conferir `preflights[0].status = PASS` |
| **E2E crítico vermelho na `main`**: `todogreen-portais-auth.spec.js` esperava o título "Minha rota" na abertura do app do motorista, que abre na seção Hoje | 1 de 11 jornadas | o teste passa a abrir a aba Rota pela navegação, como o motorista faz |
| **Baselines visuais desatualizados**: o menu em 8 grupos (`bfcb2a1`) mudou 3 telas (dashboard claro/escuro, oportunidades mobile; ~2% dos pixels, diff conferido = só o menu) | mudança intencional | baselines regenerados e revalidados |
| Gate local do estado final da `main` (com as correções acima) | lint 0 erros; unit **357/357** (o teste do To Do voltou a passar com a correção do Codex; guarda de tokens corrigida); worker **107/107** (jornada transversal corrigida); build ok; E2E crítico e visual: registrados no PR #379 | — |

