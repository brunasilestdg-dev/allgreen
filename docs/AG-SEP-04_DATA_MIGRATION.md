# AG-SEP-04 — Plano e matriz de migração de dados (D1)

Status: `AG-SEP-04 PLANO — decisão: Estratégia B (coexistência); aguarda leitura de produção`

## 0. Decisão da titular (confirmada)

Os dois produtos **coexistem**:

| Produto | Papel | Worker | D1 | Domínio | `TDG_ENVIRONMENT` |
|---|---|---|---|---|---|
| **All Green** | **Produção** | `allgreen` | `allgreen-db` | `orianone.app` / `www.orianone.app` (via OrianBridge) | `production` |
| **Seu Funcionário** | **Teste / staging** | `seufuncionario-expo` | `seu-funcionario-db` (permanece) | apenas `*.workers.dev` (sai do `orianone.app`) | ajustar para não-produção (`preview`/`test`) |

Consequências travadas:
- Estratégia de dados = **B (cópia filtrada por conta)** — §4.
- Os dados de produção do All Green (grafo de tenant + `todogreen_*`) são **copiados** para `allgreen-db`; a origem permanece intacta e passa a ser o ambiente de teste do Seu Funcionário.
- Domínio (`orianone.app`, OrianBridge) é **configuração de infraestrutura** (rotas `wrangler.jsonc` + env), nunca literal em regra de negócio (§9 de `ALLGREEN_REPOSITORY_SEPARATION.md`).
- Após o corte, o worker antigo perde o custom domain `orianone.app` e deve ter `TDG_ENVIRONMENT` reclassificado para não rotular teste como produção na tela "Saúde do sistema".

Base: `main` no commit da separação standalone (rebrand All Green + `allgreen-db` criado).

Este documento é **plano**. Ele NÃO executa cópia, corte, `DROP` nem qualquer
escrita destrutiva. Ele prepara o corte de dados exigido pelo §5 de
`ALLGREEN_REPOSITORY_SEPARATION.md` e respeita `TODOGREEN_DATA_OWNERSHIP.md`.

## 1. Estado atual verificado (não suposto)

Confirmado por inspeção da conta Cloudflare e das migrações versionadas:

| Recurso | Estado |
|---|---|
| D1 produção | `seu-funcionario-db` (`dfa94699-…`), ~25 MB, dados reais dos dois produtos |
| D1 novo (All Green) | `allgreen-db` (`468b68a6-99ca-418a-9052-ab3adb8d1a6a`), região ENAM, **schema aplicado (139 migrações), zero linhas de dados** |
| Worker produção | `seufuncionario-expo` — serve `orianone.app` (custom domain **ativo**) |
| Worker novo | `allgreen` — publicado **em paralelo** em `allgreen.brunapsiles.workers.dev`, binding `DB → allgreen-db`, `/api/status` operacional |
| Domínio | `orianone.app` continua 100% em `seufuncionario-expo` (produção intacta) |
| Conta Cloudflare | `Brunapsiles@gmail.com` (`ec9f14d5195f54fb76d9d4a81ccfb2f0`) |

Total de tabelas no schema: **235**. Duas famílias:

- **~180 `todogreen_*`** — dados canônicos da vertical All Green.
- **~55 de núcleo/compartilhadas** — `users`, `sessions`, `workspaces`,
  `memberships`, `contacts`, `interactions`, `tenants`, `public_*`, etc.

### 1.1 O discriminador (achado central)

`users` **não tem coluna de produto**. O mesmo login pode usar o workspace
genérico (Seu Funcionário) e a vertical (`/todogreen`). A fronteira real é o
grafo de tenant:

```
tenants (id, slug, name, segment)
   └── tenant_users (tenant_id, workspace_owner_id → users.id, user_id → users.id, role)
          └── todogreen_* (escopadas por tenant_id / operation_id / client_id)
```

Logo:
- **Conta All Green** = `users.id` que aparece como `workspace_owner_id` (ou `user_id`) em `tenant_users`, mais o `tenants`/`todogreen_*` correspondente.
- **Conta Seu Funcionário puro** = `users` sem vínculo em `tenant_users`, com dados só no blob `workspaces`.

Isso torna possível uma cópia **filtrada por conta**, e não só a cópia total.

## 2. Regras de segurança do corte (§5)

1. Preservar **IDs e histórico** (chaves primárias e timestamps idênticos).
2. **Nenhuma tabela canônica com dois escritores produtivos** durante o corte.
3. Sem `DROP`/exclusão destrutiva; `seu-funcionario-db` permanece como rollback.
4. Ordem: `EXPORTAR (snapshot) → IMPORTAR no allgreen-db → VALIDAR contagens/integridade → HOMOLOGAR → CONGELAR escrita da origem → RE-DELTA → CUTOVER → ESTABILIZAR`.
5. Tracking/telemetria externa é entrada; não gera segunda tabela canônica.

## 3. Matriz de migração por objeto

Colunas exigidas pelo §5: `objeto | tabela(s) | dono | leitores | escritores | FK/dependências | estratégia de cópia | estratégia de rollback`.

> Legenda de cópia: **INTEGRAL** = copiar todas as linhas; **FILTRADA** = só linhas das contas All Green (ver §1.1); **RECRIÁVEL** = cache/derivado, pode reprojetar em vez de copiar.

### 3.1 Núcleo / compartilhado (raiz do grafo)

| Objeto | Tabela(s) | Dono | Leitores | Escritores | FK/dependências | Cópia | Rollback |
|---|---|---|---|---|---|---|---|
| Conta/identidade | `users` | Plataforma | tudo | Auth | raiz (`id`) | FILTRADA (contas All Green) ou INTEGRAL | manter origem; reimport idempotente por `id` |
| Sessão | `sessions` | Auth | Auth | Auth | `user_id→users` | **não copiar** (efêmero; expira em 30d) | re-login |
| Workspace (blob JSON) | `workspaces` | Usuário | app | Sync | `user_id→users` | acompanha `users` (mesma estratégia) | reimport por `user_id`; origem preservada |
| Colaboração | `memberships`, `invites` | Usuário-dono | app | Collab | `owner_id/member_id→users` | acompanha `users` | reimport por `id`/`code` |
| Contatos | `contacts` | Usuário-dono | app | app | `owner_id→users` | acompanha `users` | reimport por `id` |
| Caixa de entrada | `interactions` | Espaço | app | app | `owner_id→users` | acompanha `users` | reimport por `id` |
| Sites/leads/forms/quotes públicos | `public_sites`, `public_site_leads`, `public_forms`, `public_form_submissions`, `public_quotes`, `public_bookings`, `booking_*` | Usuário-dono | público | app | `owner_id→users`; tokens | acompanha `users` | reimport por `id`/token |
| Push/segredos de workspace | `push_subscriptions`, `workspace_ai_keys`, `workspace_search_keys`, `workspace_plans` | Usuário | app | app | `user_id→users` | acompanha `users` (**revisar segredos**) | reimport por chave |
| Cadastro pendente/reset | `pending_signups`, `password_resets` | Auth | Auth | Auth | e-mail | **não copiar** (efêmero) | re-emissão |
| Auditoria/erros/uso | `audit_log`, `error_logs`, `analytics_events`, `workspace_usage`, `weekly_summary_log` | Plataforma | ops | sistema | `user_id`/nenhum | INTEGRAL (histórico) ou início limpo | append-only; origem preservada |

### 3.2 Multi-tenant All Green (discriminador)

| Objeto | Tabela(s) | Dono | Leitores | Escritores | FK/dependências | Cópia | Rollback |
|---|---|---|---|---|---|---|---|
| Tenant | `tenants` | ERP | tudo All Green | Admin | raiz (`id`,`slug`) | INTEGRAL | reimport por `id` |
| Vínculo usuário-tenant | `tenant_users`, `tenant_users_v2`, `tenant_modules`, `todogreen_access_emails` | ERP | acesso | Admin | `tenant_id→tenants`, `*_id→users` | INTEGRAL | reimport por `id` |
| Catálogo de módulos | `module_catalog` | Plataforma | app | Admin | — | INTEGRAL/semente | reimport por `id` |

### 3.3 Domínio logístico canônico (conforme `TODOGREEN_DATA_OWNERSHIP.md`)

| Objeto | Tabela(s) canônica(s) | Dono | Escritores | FK/dependências | Cópia | Rollback |
|---|---|---|---|---|---|---|
| Cliente/carteira | `todogreen_clients` (+ `todogreen_crm*`, `todogreen_company*`) | ERP | CRM/Comercial | `tenant_id→tenants` | INTEGRAL | reimport por `id` |
| Contrato/SLA/cobrança | `todogreen_contracts`, `todogreen_billing*` | ERP | Comercial/Jurídico | `client_id`, `tenant_id` | INTEGRAL | reimport por `id` |
| Preço/parâmetros | `todogreen_pricing*`, `todogreen_price*`, `pricing_scenarios`, `todogreen_deal*`, `todogreen_cost*` | ERP | Pricing/Deal Desk | `tenant_id`; versões | INTEGRAL (preservar versões) | reimport por `id` |
| Ordem de serviço | `todogreen_service_orders` | ERP cria / TMS executa | Planejamento/execução | `operation_id`, `client_id` | INTEGRAL | reimport por `id` |
| Operação/rota/eventos | `todogreen_client_operations`, `todogreen_routes`, `todogreen_road*`, ledger de eventos | TMS | TMS/Motorista/conectores | `client_id`, `tenant_id` | INTEGRAL (preservar ledger em ordem) | reimport por `id` + sequência |
| Motorista/veículo/frota | `todogreen_driver*`, `todogreen_fleet*`, `todogreen_habilitacao*` | ERP cadastra / TMS aloca | Cadastros/despacho | `tenant_id`, `operation_id` | INTEGRAL | reimport por `id` |
| Vistoria/jornada | `todogreen_work*` (jornada), checklists | TMS/Motorista | motorista vinculado | `driver`, `operation_id` | INTEGRAL | reimport por `id` |
| POD | `todogreen_proofs_of_delivery` | TMS | Motorista/API | `operation_id`, entrega | INTEGRAL (imutável) | reimport por `id` |
| Financeiro | `todogreen_financial*`, espinha transacional (`0056`) | ERP Financeiro | Financeiro/automações | `service_order_id`, `client_id` | INTEGRAL (preservar títulos/baixas) | reimport por `id` |
| Fiscal | `todogreen_fiscal*`, `todogreen_ciot*` | ERP Fiscal | Fiscal/conector | `service_order_id`; chave/protocolo | INTEGRAL (preservar autorizados) | reimport por `id` |
| Telemetria/tracker | `todogreen_tracker*`, `todogreen_track*`, `todogreen_geo_cache`, `todogreen_energy*`, `todogreen_charging*`, `todogreen_market*` | Conector TMS | provedor autenticado | `operation_id`, projeções | RECRIÁVEL (reprojetar) ou INTEGRAL do bruto recente | reprojetar do ledger |
| Solicitação do cliente | `todogreen_client_requests` | Portal Cliente | cliente vinculado/equipe | `client_id` (sessão) | INTEGRAL | reimport por `id` |
| Portais/RH/estoque/metas | `todogreen_customer-portal*`, `todogreen_payroll*`, `todogreen_employee*`, `todogreen_stock*`, `todogreen_goal*`, `todogreen_planner*`, `todogreen_document*`, `todogreen_legal*`, `todogreen_score*` | ERP | app All Green | domínio | `tenant_id`/`client_id` | INTEGRAL | reimport por `id` |
| Integração Monday | `todogreen_monday*` | Conector | conector | tokens | RECRIÁVEL (reconectar) | reconfigurar conector |

> As linhas acima cobrem os prefixos observados. A **classificação final tabela-a-tabela** (incluindo a coluna exata de dono/`*_id` de cada `todogreen_*`) deve ser confirmada com a leitura de produção da §7 antes de executar.

## 4. Estratégias de cutover (decisão da titular)

| # | Estratégia | Como | Prós | Contras | Quando usar |
|---|---|---|---|---|---|
| **A** | **Clone integral** | Copiar TODAS as tabelas de `seu-funcionario-db` → `allgreen-db`; apontar `orianone.app` para o worker novo; **aposentar** o worker antigo | Simples; nada se perde; sem discriminador | Se o produto antigo continuar ativo em outro domínio, vira **dois escritores** → fork | All Green **substitui** o Seu Funcionário (produto único) |
| **B** | **Cópia filtrada por conta** | Copiar só contas ligadas a tenant (§1.1) + todo `todogreen_*` + tenant graph; Seu Funcionário puro fica no D1 antigo | Bancos realmente independentes; cada produto segue | Complexo; risco de conta usada nos dois lados; delta duplo | Os dois produtos seguem vivos e separados |
| **C** | **DB compartilhado interino** | Worker novo aponta o binding `DB` para o **`seu-funcionario-db` existente**; cutover de `orianone.app`; split real do D1 depois | Zero cópia; zero fork; dados intactos; reversível | Não entrega D1 independente ainda; reutiliza infra de produção (explícito, não implícito) | Cutover urgente com integridade máxima; separar o D1 depois com calma |

**Decisão travada: Estratégia B.** Os dois produtos coexistem (§0): All Green
em produção no `orianone.app` com `allgreen-db`; Seu Funcionário como ambiente
de teste no worker/DB antigos. Copiar para `allgreen-db` apenas o conjunto All
Green (contas ligadas a tenant pela §1.1 + `tenants`/`tenant_users` + todo
`todogreen_*` + os `workspaces`/`contacts`/`interactions`/`public_*` dessas
contas). O que não é All Green permanece só na origem (teste).

**Risco a tratar na execução (contas que usam os dois lados):** uma conta All
Green que também tenha dados no workspace genérico terá seu blob copiado junto
(vai com o `user`); após o corte, edições no ambiente de teste divergem do de
produção — aceitável porque teste não é fonte canônica. A consulta da §7
mede quantas contas estão nessa situação antes de executar.

## 5. Runbook de execução (após decisão + homologação)

Pré-condição: escrita da origem **congelada** na janela de corte (modo manutenção
ou leitura-apenas do worker antigo) para o snapshot não perder delta.

```bash
# 1. Snapshot lógico da origem (preserva IDs/DDL/insert)
npx wrangler d1 export seu-funcionario-db --remote --output backup-origem.sql
#    -> guardar backup-origem.sql fora do repo (é dado de produção, NÃO commitar)

# 2A. (Estratégia A) importar tudo no destino já migrado
#     Importar só as linhas (o schema já existe). Preferir export --no-schema
npx wrangler d1 export seu-funcionario-db --remote --no-schema --output dados-origem.sql
npx wrangler d1 execute allgreen-db --remote --file dados-origem.sql

# 2B/2C. ver seção de estratégia escolhida (filtro/aponte binding)

# 3. Validar contagens tabela-a-tabela (origem vs destino) — ver §7

# 4. Cutover do domínio só depois de validado (worker novo já tem as rotas
#    custom_domain no wrangler.jsonc): publicar move orianone.app.
npx wrangler deploy      # ⚠️ isto RELIGA orianone.app ao worker allgreen
```

Preservação de IDs: `wrangler d1 export` emite `INSERT`s com as PKs originais →
IDs e histórico preservados. Rollback: reapontar `orianone.app` ao
`seufuncionario-expo` (custom domain) e/ou reimportar `backup-origem.sql`; a
origem nunca é apagada nesta etapa.

## 6. Pré-flight (critérios de `TODOGREEN_DATA_OWNERSHIP.md` §42-50)

- [ ] suíte completa e build verdes (unit ✔, worker ✔ exceto energy/geo-fleet externos)
- [ ] teste transversal passa sem escrita direta no banco no cenário
- [ ] conectores do piloto configurados e com teste de saúde
- [ ] versão de produção identificada e validada
- [ ] nenhum caminho novo criando OS sem operação nem concluindo entrega fora do comando canônico
- [ ] homologação feita em `allgreen.brunapsiles.workers.dev` com conta de teste
- [ ] janela de manutenção combinada; escrita da origem congelável
- [ ] `backup-origem.sql` gerado e guardado fora do repo

## 7. Consultas somente-leitura a rodar (para fechar os números)

Bloqueadas nesta sessão pelo gate de permissão ("Production Reads"). Rodar em
`seu-funcionario-db` para dimensionar e confirmar o discriminador:

```sql
-- Tabelas e schema real (confirma os 235 objetos e colunas de dono)
SELECT name FROM sqlite_master WHERE type='table'
  AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'
  ORDER BY name;

-- Volume por tabela (priorização da cópia) — gerar counts por tabela

-- Discriminador: quantas contas são All Green vs genéricas
SELECT COUNT(*) total_users FROM users;
SELECT COUNT(DISTINCT workspace_owner_id) contas_allgreen FROM tenant_users;
SELECT COUNT(*) tenants FROM tenants;
-- contas que usam AMBOS (workspace grande E tenant) — risco da estratégia B
SELECT COUNT(*) FROM workspaces w
  WHERE EXISTS (SELECT 1 FROM tenant_users t WHERE t.workspace_owner_id = w.user_id);
```

Com esses números eu finalizo a estratégia (A/B/C) e as contagens de validação
da §5.4.

## 8. Próximo bloco

`AG-SEP-05` (homologação de auth/portais/integrações/jornadas) deve rodar em
paralelo à decisão desta matriz. O cutover de domínio (`AG-SEP-07`) só ocorre
após esta migração validada. Nada aqui é executado automaticamente.
