# Runbook de deploy e migração (Cloudflare)

Guia para **subir o projeto num ambiente Cloudflare novo** — outro repositório
GitHub, outra conta/projeto Cloudflare, outro D1, outro domínio — sem reescrever
código. Complementa o `AGENTS.md` (comandos do dia a dia) e o
`docs/OPERACAO_PRODUCAO.md` (operação corrente).

> **Portabilidade (seções 38–40 do plano de produto).** O código não deve
> depender de IDs fixos de infraestrutura. Hoje o único ID fixo é o
> `database_id` do D1 em `wrangler.jsonc` — este runbook mostra como trocá‑lo
> para um ambiente novo. Nenhuma chave/segredo vai em código (ver
> `docs/SECRETS.md`).

---

## 0. Pré‑requisitos

- Node.js 22 (a versão do fallback `.github/workflows/deploy.yml`; o repositório
  não fixa versão em `.nvmrc`/`engines`, então o Workers Builds usa a padrão da
  imagem de build).
- Conta Cloudflare com Workers habilitado.
- `npm i -g wrangler` (ou usar `npx wrangler`).
- Acesso ao repositório GitHub de destino.

## 1. Clonar e instalar

```bash
git clone <URL_DO_REPOSITORIO>
cd allgreen
npm ci
```

## 2. Validar localmente antes de tocar em produção

```bash
npm run verify                  # lint + testes (unit + worker)
npm run build                   # gera dist/
npm run test:e2e:critical       # jornadas críticas no Chromium (PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium na sessão remota; :ci instala o navegador)
```

Todos precisam passar **antes do merge**. Enquanto o GitHub Actions estiver sem minutos/runner, um
check vermelho por falta de capacidade do Actions não bloqueia. O que bloqueia é
`npm run verify` vermelho, `npm run build` vermelho, `test:e2e:critical` vermelho ou falha no
Cloudflare Builds/deploy manual. A suíte crítica de Playwright roda antes do merge e no
fallback manual `deploy.yml`, **não** dentro do build do Cloudflare (o container não instala
Chromium — ver seção 11); a regressão visual completa por screenshots continua separada,
porque é mais pesada e depende dos baselines canônicos.

## 3. Autenticar o wrangler

```bash
wrangler login          # interativo (navegador)
# OU, em CI/headless:
export CLOUDFLARE_API_TOKEN=***   # token com permissão de Workers + D1 + R2
export CLOUDFLARE_ACCOUNT_ID=***  # id da conta de destino
```

Token Cloudflare: **My Profile → API Tokens → Create Token**, com permissões
mínimas *Workers Scripts:Edit*, *D1:Edit*, *Workers R2 Storage:Edit* e, se for
usar domínio próprio, *Zone:DNS:Edit* + *Workers Routes:Edit*.

## 4. Criar o banco D1 e apontar o `wrangler.jsonc`

```bash
wrangler d1 create allgreen-db
```

O comando devolve um `database_id`. **Troque o `database_id`** em
`wrangler.jsonc` (bloco `d1_databases`) pelo novo — é o único identificador de
infraestrutura fixo no repositório. O `binding` (`DB`) e o `database_name`
podem permanecer.

> Para manter o repositório 100% portável, o `database_id` pode ser sobrescrito
> por ambiente com `wrangler deploy --var` / arquivos `wrangler.<env>.jsonc` ou
> pela variável de deploy do provedor; o padrão aqui é editar o valor no clone
> de destino.

## 5. Aplicar as migrations

As migrations em `migrations/` são **incrementais e numeradas** e reconstroem o
schema num D1 novo, em ordem.

```bash
# ambiente novo (remoto):
npx wrangler d1 migrations apply allgreen-db --remote

# desenvolvimento local:
npx wrangler d1 migrations apply allgreen-db --local
```

Nunca edite uma migration já aplicada — crie uma nova numerada (regra do
`AGENTS.md`).

## 6. R2 (armazenamento de arquivos), se aplicável

Arquivos (POD, cofre de documentos, mídia) usam **binding**, nunca URL fixa
(seção 41). O código lê um único binding R2, **opcional**: `MEDIA_BUCKET`
(`worker/services/todogreen-file-store.js`). Sem ele — o estado atual de
produção, já que o `wrangler.jsonc` não declara `r2_buckets` — os bytes ficam
em chunks base64 no D1, que funciona mas tem teto de escala. Para ligar:

```bash
wrangler r2 bucket create <nome-do-bucket>
```

e declare em `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "MEDIA_BUCKET", "bucket_name": "<nome-do-bucket>" }]
```

Arquivo gravado antes continua sendo lido do D1; só o que chega depois vai
para o R2.

## 7. Bindings já esperados pelo Worker

De `wrangler.jsonc`:

| Binding | Tipo | Observação |
| --- | --- | --- |
| `ASSETS` | Assets estáticos (`./dist`) | SPA + `run_worker_first` para rotas de API/portais |
| `AI` | Workers AI | contingência local de IA |
| `DB` | D1 (`allgreen-db`) | banco operacional |
| `MEDIA_BUCKET` | R2 (**opcional**, não declarado hoje) | bytes do POD e do cofre; sem ele ficam em chunks no D1 (seção 6) |

`vars` públicas (não são segredo): `GEMINI_MODEL`, `XAI_MODEL`,
`MONDAY_CLIENT_ID`, `TODOGREEN_ADMIN_EMAILS`, `TDG_ENVIRONMENT`.

> `TDG_ENVIRONMENT` é o **ambiente declarado pelo próprio Worker** (`production`,
> `preview`, `staging`…). Aparece em `GET /api/system/version` e na tela
> **Administração → Saúde do sistema** (LOCAL × SERVIDOR × BANCO). Num Worker de
> prévia/homologação, troque o valor — nunca há literal de ambiente no código.

## 8. Segredos

Ver **`docs/SECRETS.md`** para a lista completa. Cadastro:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put BREVO_API_KEY
# ... (um por segredo)
```

Nenhum segredo entra em código, commit, log ou frontend (seção 42). O app sobe
sem os opcionais — as integrações ficam `NOT_CONFIGURED` até a chave existir.

## 9. Cron Triggers

Já declarados em `wrangler.jsonc → triggers.crons`:

> **Referências de energia (P4)** — o cron horário chama `runTodoGreenEnergyReferenceScheduled`
> (auto-limitado): ONS 1×/dia, ANP 1×/semana, ANEEL 1×/semana por par
> distribuidora/subgrupo/modalidade configurado (3 pares por disparo). Cada fonte grava
> `last_attempt_at`/`last_success_at`/`source_updated_at` em `todogreen_energy_reference_sync`;
> falha não apaga o último sucesso e reaparece em Administração → Saúde do sistema (grupo Energia).
>
> **Sinais de mercado (P5)** — `runTodoGreenMarketSignalsScheduled`: PNCP a cada 6 h (6 termos de
> transporte/logística), Compras.gov 1×/dia (últimos 3 dias), GDELT um termo por hora (a fonte limita a
> 1 consulta a cada 5 s). Estado em `todogreen_reference_sync`; sinais em `todogreen_market_signals`
> (retenção 120 dias para o que já venceu).
>
> **Risk Map (P6)** — `runTodoGreenRoadRiskScheduled`: ANTT um recurso CSV por hora (≈40 concessionárias,
> refresh de 30 dias) → `todogreen_road_risk_segments`. A PRF não tem API estável: importe o CSV oficial
> (acidentes por ocorrência) em `POST /api/todogreen/risk/import/prf` (teto 40 MB) → células de ~1,1 km
> em `todogreen_road_risk_cells`. Sem importação, o risco por rota é `RISK_DATA_NOT_AVAILABLE` — nunca zero.

- `0 * * * *` — de hora em hora.
- `0 12 * * 1` — segunda‑feira meio‑dia (UTC).

São aplicados no `wrangler deploy`. Novas ingestões periódicas (ANP, ANEEL, ONS,
GDELT, PRF/ANTT — seções 6–14) devem reaproveitar esses gatilhos ou adicionar um
novo cron aqui, com o handler no roteador do Worker.

## 10. Domínio

- Padrão: `https://<name>.<subdomínio-workers>.workers.dev` (o `name` de
  `wrangler.jsonc`).
- Domínio próprio: adicionar uma **route** ou **custom domain** no painel do
  Worker (ou `routes` no `wrangler.jsonc`), com o DNS na zona correspondente.
- Não há URL de produção hard‑coded no código; o app se serve pela origem da
  requisição.

## 11. GitHub Actions / deploy automático

- **Não há workflow de qualidade no GitHub.** O único workflow do repositório é o
  `deploy.yml` (abaixo). O gate obrigatório é o **local/sessão remota** antes do
  merge (seção 2) e o do Cloudflare Builds; `verify`, `build`, `test:e2e:critical`,
  Cloudflare Builds ou deploy manual vermelho bloqueiam. Para ter um check no
  GitHub sem gastar minutos, ver `docs/GITHUB_SELF_HOSTED_RUNNER.md`.
- Cloudflare Workers Builds (conectado ao repo): em push na `main`, roda
  `npm ci && npm run verify && npm run build` e depois `npm run deploy:cloudflare`
  (`wrangler d1 migrations apply --remote && wrangler deploy`). O E2E de navegador
  **não** roda aqui: o container do Builds não instala Chromium — em 13/09 o
  `deploy:cloudflare` passou a chamar `test:e2e:critical:ci` (`cd8f90b`) e a `main`
  ficou sem publicar (produção presa em `037ab25`) até o comando voltar a
  migrations + publicação. Quem publica com navegador disponível pode usar
  `npm run deploy:cloudflare:gated` (E2E → migrations → publicação).
- `.github/workflows/deploy.yml` (**Publicar**): contingência manual. Instala
  Chromium e executa `test:e2e:critical` antes de migrar/publicar.

Para trocar o repositório: reconecte o Workers Builds ao novo repo e mantenha o
mesmo pipeline (nada de específico do repositório está embutido nos workflows).

## 12. Primeiro deploy

```bash
npm ci
npm run verify
npm run build
npm run test:e2e:critical:ci    # gate de navegador (instala Chromium)
npm run deploy:cloudflare       # aplica migrations no D1 remoto e publica

# Atalho equivalente depois do npm ci:
npm run deploy            # valida + build + migrations + publica
```

## 12a. Deploy manual sem GitHub Actions (gate local + Wrangler)

Caminho usado na consolidação de 13/09/2026, quando o Actions estava sem
franquia. Só publica o que passou no gate **na máquina que publica**:

```bash
git fetch origin main && git checkout main && git pull --ff-only origin main
git rev-parse HEAD                      # SHA que será publicado
npm ci
npm run lint && npm run test:unit && npm run test:worker && npm run build
# (ou: npm run verify && npm run build)

export CLOUDFLARE_API_TOKEN=***         # token da titular; NUNCA em arquivo versionado
npx wrangler whoami                     # confirma a conta
npx wrangler d1 migrations list allgreen-db --remote   # compara com migrations/
npm run deploy:cloudflare               # aplica pendentes + publica (idempotente)
```

Regras: teste obrigatório vermelho ⇒ **não publica**; nunca resetar/apagar
banco, rodar SQL destrutivo, renomear ou apagar migration aplicada; migration
com **número** repetido (ex.: dois `0112_`) é aceita porque o wrangler rastreia
pelo **nome do arquivo** — não renomear. Depois de publicar, registre o SHA
(seção 13a). Se o token passou por chat ou tela compartilhada, **revogue-o**
após a publicação.

## 13. Validar produção (smoke test)

- `GET /api/system/version` → `{ sha, buildTime, environment, branch, publishedBy, migrations }`.
  O `sha` tem que ser o `git rev-parse --short=12 HEAD` publicado; `environment`
  = `production` no Worker de produção. Sem segredo nenhum na resposta.
- `GET /api/status` → `status: operacional`, `database: operacional`, mesmo `version`.
- `GET /api/todogreen/records` sem sessão → **401** (rota viva; dado protegido).
- **Administração → Saúde do sistema** (papel com `integration:manage` ou
  `audit:read`): LOCAL × SERVIDOR × BANCO alinhados, D1 *Operacional*, alertas
  vazios (um `D1_BEHIND_CODE` aqui significa migration pendente — aplicar antes
  de usar função nova).
- `GET /` carrega o app (SPA).
- Login e chat de IA respondem (com pelo menos um provedor configurado).
- **Integrações → Busca web → Testar** (ver `AGENTS.md`).
- Rotas de portais respondem: `/portal-tms`, `/portal-cliente`,
  `/portal-motorista`, `/todogreen` (seção 58 — compatibilidade de URLs).
- API pública de roteirização (`POST /api/tms/v1/routes/electric-plan`) devolve
  `plan`, `energyEstimate` e `routingEngineSelection` com chave TMS válida.

## 13a. Registrar o SHA publicado

Produção ≠ `main` até prova em contrário. Após cada publicação, acrescente uma
linha nesta tabela (ou no relatório da rodada, se a publicação fizer parte de
um PR — nesse caso, cite o PR aqui):

| Data (UTC) | SHA publicado | Como | Version ID (wrangler) | Smoke |
| --- | --- | --- | --- | --- |
| 2026-09-13 02:30 | `d2396e44d8e4` (= `main`) | `npm run deploy:cloudflare` c/ token | `3fdb0103-5906-48d6-affb-f974e869ad59` | `/api/status` ok, SPA 200, records 401 |
| 2026-09-13 05:10 | `401f7ecb8c78` (último `main` verde) | manual c/ token — *pin* por cima do auto-deploy `700468c` (teste do To Do vermelho na main) | `80bd5835-…` | `/api/system/version` ok |
| 2026-09-13 05:2x | `cc4c0fe6476c` (PR #362, viabilidade) | Cloudflare Workers Builds (push em `main`) | — | `/api/system/version` ok, `migrations.expected` 128 |
| 2026-09-13 05:38 | `2a4d459fdc2d` (PR #363, RoutingProvider) | Cloudflare Workers Builds | — | `/api/system/version` ok |
| 2026-09-13 05:53 | `c4f363784393` (PR #364, elevação/clima/perfil do veículo) | Cloudflare Workers Builds | — | `/api/system/version` ok, `migrations.expected` 130; D1 remoto com 0122/0123 aplicadas |
| 2026-09-13 12:18 | `2d65bdfdf87b` (PR #365, energia P4 + lint) | Cloudflare Workers Builds | — | `/api/system/version` ok, `migrations.expected` 131; D1 remoto com 0124 aplicada |
| 2026-09-13 12:22 | `6028b0edad89` (PR #366, Codex — bipagem de etiquetas) | Cloudflare Workers Builds | — | `/api/system/version` ok |
| 2026-09-13 12:52 | `bd402c306939` (PR #367, radar estruturado + Risk Map + alternativas; inclui #368 do Codex) | Cloudflare Workers Builds | — | `/api/system/version` ok, `migrations.expected` 132, última `0125`; `wrangler d1 migrations list --remote` → "No migrations to apply" |
| 2026-09-13 13:20 | `1a17c34d8cec` (merge do PR #371 P1.4 sobre `c38c627` do Codex) | Cloudflare Workers Builds | — | `/api/system/version` ok, `migrations.expected` 134, última `0131`; D1 remoto sem pendências; gate local do estado mesclado: lint 0 erros, worker 106/106, unit 352 ok (falha pré-existente do To Do), build ok |
| 2026-09-13 13:48 | `fdcd3bd627b7` (PR #373, P2 pré-flight persistido + fila de ação + regressão visual consolidada) | Cloudflare Workers Builds | `0132` aplicada no D1 remoto antes do merge (`wrangler d1 migrations apply --remote`) | `/api/system/version` ok, `migrations.expected` 135, última `0132`; `/api/todogreen/preflight` responde 401 sem sessão; gate local: lint 0 erros, worker 107/107, unit 352 ok (falha pré-existente do To Do), build ok, visual 4/4 |
| 2026-09-13 14:04–14:40 | `a363850` → `037ab2538fb5` (Codex direto na `main`: P5/P6 complementos do PR #374, PR #372 recuperado, Design System fase 1, hardenings) | Cloudflare Workers Builds | `0133` aplicada no D1 remoto | `/api/system/version` = `037ab2538fb5`, `migrations.expected` 136, última `0133`; gate local desses commits rodado só depois (rodada 3-bis) |
| 2026-09-13 17:11 | `cd8f90b` (Codex: hardening de despacho + E2E no `deploy:cloudflare`) | Cloudflare Workers Builds | — | **não publicou**: 30+ min sem novo deployment (`wrangler deployments list`), produção seguiu em `037ab25`; causa: Playwright dentro do deploy command do Cloudflare — desfeito na rodada 3-bis (ver seção 11) |
| 2026-09-13 18:07 | `3d83b2b7e6fe` (PR #379, rodada 3-bis: lint, guarda de tokens, `deploy:cloudflare` sem Playwright, E2E e visual) | Cloudflare Workers Builds | — | **produção voltou a publicar**: `/api/system/version` = `3d83b2b7e6fe` 70 s após o merge (estava presa em `037ab25` desde 14:40); `migrations.expected` 136, última `0133`; D1 remoto sem pendências; `/api/todogreen/preflight` e `/market-signals/prefs` respondem 401 sem sessão; gate local: lint 0 erros, unit 357/357, worker 107/107, build ok, E2E crítico 11/11, visual 4/4 |

> **Estado atual do gate:** `deploy:cloudflare` = migrations + publicação (é o deploy
> command do Workers Builds e precisa rodar sem navegador). O gate de navegador
> `test:e2e:critical` (smoke, acesso, navegação ERP↔TMS e portais autenticados) é
> obrigatório **antes do merge** e roda no fallback manual `deploy.yml`;
> `deploy:cloudflare:gated` encadeia os dois para publicação manual com Chromium.
> O build command do Workers Builds continua `npm ci && npm run verify && npm run build`.
> A regressão visual completa permanece como gate separado.

Sempre diferenciar **LOCAL** (build do navegador), **MAIN** (branch) e
**PRODUÇÃO** (o que `/api/system/version` devolve) — a tela Saúde do sistema faz
isso lado a lado.

## 13a-bis. Regressão visual (screenshots de referência)

Suíte única: `playwright.visual.config.js` + `e2e/visual/regressao-visual.spec.js`, baselines em
`e2e/visual/__baselines__/` — guia completo em `docs/VISUAL_REGRESSION.md`. Telas do ERP em desktop
claro/escuro e mobile (onde se aplica), portal TMS e entrada dos portais externos, com relógio
congelado, animações desligadas e máscaras sobre o que é legitimamente variável (horas, versão,
latências, mapa).

```bash
# comparar (gate) — Chromium/Linux, mesmo ambiente das referências
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium npm run test:visual
# atualizar referências, só depois de uma mudança visual INTENCIONAL revisada no PR
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium npm run test:visual:update
# caminho canônico reproduzível em qualquer máquina (exige Docker)
npm run test:visual:docker
```

Mudança **não intencional** que quebre a comparação é regressão — não atualize a referência
sem entender a causa. A guarda de tokens (`src/design-system/designTokens.test.js`) roda no
`npm test`.

## 13b. Rollback

O Worker guarda as versões publicadas. Para voltar à anterior **sem** mexer no
banco (migrations são aditivas e ficam):

```bash
npx wrangler deployments list          # lista Version IDs, do mais novo ao mais antigo
npx wrangler rollback <VERSION_ID>     # volta o Worker + assets daquela versão
curl -s https://<worker>/api/system/version   # confirma o sha que voltou
```

Rollback **não** desfaz migration: se a versão nova aplicou uma migration
aditiva, a antiga continua funcionando (colunas extras são ignoradas). Nunca
"reverter" migration com SQL destrutivo em produção — crie uma migration nova
quando precisar corrigir schema.

## 14. Roteirização cloud e motores auto‑hospedados opcionais

Em produção, quando `GEOAPIFY_API_KEY` existe no cofre do Worker, a Geoapify é
a fonte cloud primária de geocodificação, roteamento de leves/pesados e elevação.
O otimizador de despacho permanece nativo no próprio Cloudflare Worker (WASM),
sem depender de PC, VPS ou servidor no escritório.

OSRM/Nominatim/Valhalla/VROOM próprios continuam disponíveis como contingência
ou opção de infraestrutura futura, mas **não são requisito** para o ambiente
cloud com Geoapify ativo.

| Variável | Uso |
| --- | --- |
| `GEOAPIFY_API_KEY` | geocodificação, roteamento cloud e elevação; segredo do Worker |

VROOM/OSRM/Valhalla auto-hospedados são infraestrutura própria (seção 35) — ver
`infra/tms-routing/`. Endpoints são lidos de `env` (sem hardcode):

| Variável | Uso |
| --- | --- |
| `TDG_ROUTING_URL` / `TDG_ROUTING_TOKEN` | otimizador VROOM (`/routes/optimize`) |
| `TDG_OSRM_BASE_URL` / `TODOGREEN_OSRM_BASE_URL` | motor OSRM (perfil genérico; o gateway de integrações lê `TODOGREEN_*`, a API elétrica lê `TDG_*` — a tela de saúde aceita qualquer um dos dois) |
| `TDG_VALHALLA_BASE_URL` (ou `TODOGREEN_VALHALLA_BASE_URL`) | motor Valhalla (truck costing / restrições / elevação `/height`) — **REAL**: `POST /api/todogreen/maps/route` com `vehicle` pesado roteia por ele; sem a URL responde `NO_SAFE_ROUTING_ENGINE` (409), nunca perfil de carro |
| `TODOGREEN_VROOM_BASE_URL` | VROOM via gateway de integrações (mesmo papel de `TDG_ROUTING_URL`) |
| `TODOGREEN_NOMINATIM_BASE_URL` | geocodificação própria |
| `TDG_WEATHER_DISABLED=1` (opcional) | desliga a consulta de clima (Open-Meteo) do modelo de energia; sem ela o modelo assume sem penalidade térmica e reduz a confiança |
| `TDG_ANEEL_BASE_URL` / `TDG_ANEEL_TARIFAS_RESOURCE_ID` (opcionais) | portal CKAN da ANEEL e o recurso das *tarifas homologadas* usados pelo cache tarifário (`todogreen_energy_tariff_reference`); padrão: dados abertos públicos da ANEEL. Só a `distribuidora/subgrupo/modalidade` do perfil de energia do espaço é buscada |
| `TDG_ONS_CURVA_CARGA_URL` (opcional, aceita `{ano}`) | CSV da curva de carga horária do ONS; padrão: bucket público de dados abertos do ONS (`CURVA_CARGA_<ano>.csv`, teto 8 MB) → perfil médio 24 h por subsistema (`todogreen_grid_load_profiles`) |
| `TDG_ANP_DIESEL_URL` (opcional) | CSV do levantamento de preços da ANP; padrão: "últimas 4 semanas — diesel/GNV" (gov.br, ~3,6 MB, teto 16 MB) → mediana por município/UF/região/país e semana (`todogreen_fuel_price_reference`). Alternativa: `POST /api/todogreen/energy/anp/import` com o CSV |
| `TDG_ENERGY_REFERENCE_DISABLED=1` (opcional) | desliga o cron e o botão de sincronização das referências de energia; a Saúde do sistema mostra as três fontes como não configuradas (nunca "conectado") |
| `TDG_PNCP_BASE_URL` / `TDG_COMPRAS_GOV_BASE_URL` / `TDG_GDELT_BASE_URL` (opcionais) | portais públicos dos sinais de mercado (PNCP busca de editais, Compras.gov contratações 14.133, GDELT DOC 2.0); padrão: endereços oficiais. `TDG_COMPRAS_GOV_MODALIDADES` (padrão `5,3` = pregão e concorrência, códigos do Compras.gov) |
| `TDG_MARKET_SIGNALS_DISABLED=1` (opcional) | desliga o cron e o botão de sincronização dos sinais de mercado (PNCP/Compras.gov/GDELT); as três linhas ficam não configuradas na Saúde do sistema |
| `TDG_ANTT_BASE_URL` / `TDG_ANTT_ACIDENTES_PACKAGE` (opcionais) | CKAN da ANTT e o pacote de *acidentes por quilômetro* das concessionárias (padrão `acidentes-quilometro-rodovias`); um recurso CSV por hora (teto 12 MB), refresh a cada 30 dias |
| `TDG_ROAD_RISK_DISABLED=1` (opcional) | desliga o cron da ANTT e as ingestões do Risk Map; o risco por rota passa a `RISK_DATA_NOT_AVAILABLE` |
| `TDG_CRON_EXTERNAL_DISABLED=1` (opcional; **ligado no ambiente de teste**) | kill switch único dos crons que saem para a internet (energia, sinais de mercado, Risk Map): o handler `scheduled` pula os três e devolve `skipped`. Os botões "Sincronizar" das telas continuam funcionando |
| `TDG_PREFLIGHT_GATE_DISABLED=1` (opcional) | desliga o **gate** de pré-flight da coleção `rotas` (a rota passa sem verificação e fica com `preflight_status` vazio); o endpoint `/api/todogreen/preflight` continua funcionando e registrando. Padrão: ligado |
| `TDG_PREFLIGHT_TTL_HOURS` (opcional, padrão 24) | por quantas horas um pré-flight libera a rota do mesmo par; depois disso é preciso rodar de novo |
| `TDG_RISK_ACTION_THRESHOLD` (opcional, padrão 60) | score de risco viário (0–100) a partir do qual o traçado vira item de ação na Torre de Controle |
| (sem variável) migration `0133_todogreen_market_radar_prefs` | preferências do radar por espaço (termos PNCP/GDELT, UFs de foco). Aditiva; aplicar com `wrangler d1 migrations apply --remote` junto do deploy |

Sem essas URLs, a otimização responde `routing_not_configured` (503) e a
seleção de motor reflete os motores disponíveis — nada é forjado como ativo
(seções 14–15, 32).
