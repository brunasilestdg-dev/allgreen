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

- Node.js 22 (mesma versão do CI — ver `.github/workflows/ci.yml`).
- Conta Cloudflare com Workers habilitado.
- `npm i -g wrangler` (ou usar `npx wrangler`).
- Acesso ao repositório GitHub de destino.

## 1. Clonar e instalar

```bash
git clone <URL_DO_REPOSITORIO>
cd Seufuncionario
npm ci
```

## 2. Validar localmente antes de tocar em produção

```bash
npm run verify   # lint + testes (unit + worker)
npm run build    # gera dist/
```

Ambos precisam passar. O CI (`.github/workflows/ci.yml`) roda os mesmos passos
mais o E2E (Playwright) — não publique com teste vermelho (seção 45).

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
wrangler d1 create seu-funcionario-db
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
npx wrangler d1 migrations apply seu-funcionario-db --remote

# desenvolvimento local:
npx wrangler d1 migrations apply seu-funcionario-db --local
```

Nunca edite uma migration já aplicada — crie uma nova numerada (regra do
`AGENTS.md`).

## 6. R2 (armazenamento de arquivos), se aplicável

Arquivos (POD, cofre de documentos, mídia) usam **binding**, nunca URL fixa
(seção 41). Para um ambiente novo:

```bash
wrangler r2 bucket create <nome-do-bucket>
```

Adicione o binding correspondente em `wrangler.jsonc` (`r2_buckets`) com o mesmo
nome de binding que o código espera. Confira em `worker/services/*` quais
bindings de R2 são lidos de `env` antes de nomear.

## 7. Bindings já esperados pelo Worker

De `wrangler.jsonc`:

| Binding | Tipo | Observação |
| --- | --- | --- |
| `ASSETS` | Assets estáticos (`./dist`) | SPA + `run_worker_first` para rotas de API/portais |
| `AI` | Workers AI | contingência local de IA |
| `DB` | D1 (`seu-funcionario-db`) | banco operacional |

`vars` públicas (não são segredo): `GEMINI_MODEL`, `XAI_MODEL`,
`TODOGREEN_ADMIN_EMAILS`, `TDG_ENVIRONMENT`.

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

- `.github/workflows/ci.yml` (**Qualidade**): roda em push/PR — lint, testes,
  build e E2E. **Enquanto o GitHub Actions estiver sem minutos** (runner vazio,
  `steps: []`, workflow "Publicar" *skipped*), isso **não** é erro de código e o
  gate obrigatório passa a ser o **local** (seção 12a) ou o do Cloudflare Builds.
- Cloudflare Workers Builds (conectado ao repo): em push na `main`, roda
  `npm ci && npm run build` e `npm run deploy:cloudflare`.
- `.github/workflows/deploy.yml` (**Publicar**): contingência manual.

Para trocar o repositório: reconecte o Workers Builds ao novo repo e mantenha o
mesmo pipeline (nada de específico do repositório está embutido nos workflows).

## 12. Primeiro deploy

```bash
npm run deploy            # valida + build + migrations + publica
# ou, sem revalidar:
npm run deploy:cloudflare
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
npx wrangler d1 migrations list seu-funcionario-db --remote   # compara com migrations/
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

Produção ≠ `main` até prova em contrário. Após cada publicação, anote em
`docs/AUDITORIA_CONSOLIDACAO_TDG.md` (ou no relatório da rodada):

| Data (UTC) | SHA publicado | Como | Version ID (wrangler) | Smoke |
| --- | --- | --- | --- | --- |
| 2026-09-13 02:30 | `d2396e44d8e4` (= `main`) | `npm run deploy:cloudflare` c/ token | `3fdb0103-5906-48d6-affb-f974e869ad59` | `/api/status` ok, SPA 200, records 401 |

Sempre diferenciar **LOCAL** (build do navegador), **MAIN** (branch) e
**PRODUÇÃO** (o que `/api/system/version` devolve) — a tela Saúde do sistema faz
isso lado a lado.

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

## 14. Motores de roteirização auto‑hospedados (opcional)

VROOM/OSRM/Valhalla são infraestrutura própria (seção 35) — ver
`infra/tms-routing/`. Endpoints são lidos de `env` (sem hardcode):

| Variável | Uso |
| --- | --- |
| `TDG_ROUTING_URL` / `TDG_ROUTING_TOKEN` | otimizador VROOM (`/routes/optimize`) |
| `TDG_OSRM_BASE_URL` / `TODOGREEN_OSRM_BASE_URL` | motor OSRM (perfil genérico; o gateway de integrações lê `TODOGREEN_*`, a API elétrica lê `TDG_*` — a tela de saúde aceita qualquer um dos dois) |
| `TDG_VALHALLA_BASE_URL` | motor Valhalla (truck costing / restrições) — **PREPARADO**: seleção de motor pronta, cliente HTTP ainda não |
| `TODOGREEN_VROOM_BASE_URL` | VROOM via gateway de integrações (mesmo papel de `TDG_ROUTING_URL`) |
| `TODOGREEN_NOMINATIM_BASE_URL` | geocodificação própria |

Sem essas URLs, a otimização responde `routing_not_configured` (503) e a
seleção de motor reflete os motores disponíveis — nada é forjado como ativo
(seções 14–15, 32).
