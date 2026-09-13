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
