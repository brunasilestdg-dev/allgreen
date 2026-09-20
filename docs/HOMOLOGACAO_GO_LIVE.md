# Homologação e go-live da vertical To Do Green

Estado da homologação pedida (PR #440 + frentes seguintes) e, no fim, o que
**só a titular** pode concluir (credenciais/produção). O lado de código de cada
frente foi feito e validado localmente (lint + testes + build + e2e com Chromium)
— **sem depender do GitHub Actions**; o portão de deploy é o Cloudflare Workers
Builds.

## Estado por frente

| Frente | Código (feito e validado aqui) | Depende da titular |
| --- | --- | --- |
| **PR #440** (segurança/integridade/entrega) | Pronto para revisão; CI (Workers Builds + GitGuardian) verde | Aprovar e **mergear** (= deploy em produção) |
| **TRACK3R — 13 webhooks** | Todos com projetor idempotente; dreno de reprocessamento no cron; **2 bugs reais corrigidos** (INSERT de encomenda e de fatura); 28/28 testes verdes | Ligar o webhook real: segredo `TODOGREEN_TRACK3R_WEBHOOK_SECRET` + fornecedor disparando |
| **Segurança da autenticação** | Cabeçalhos anti-clickjacking (`X-Frame-Options: DENY`) + `noindex` nas superfícies privadas do SPA; sessão canônica por cookie já aceita em todas as rotas | **Rotacionar credenciais** (abaixo); migração cookie-only dos portais é faseada (próximo passo) |
| **Operação logística completa** | Jornada order-to-cash coberta por teste transversal | Homologar com dados/volume reais em produção |
| **monday.com** | OAuth 2.1 + receptor de webhook + inbox + conexões (migração 0139). **Ainda NÃO** projeta os eventos do monday em registros do ERP, e não há testes | **Conectar** a conta (OAuth) e **definir o mapeamento** quadros/colunas → registros do ERP (depende do seu esquema de quadros); com isso eu construo a projeção + testes e valido o sync real |
| **Interface** | e2e local 10/11 (1 falha pré-existente de copy, não-regressão) | Regressão visual com baseline exige **Docker** (`npm run test:visual:docker`) |
| **Recuperação/publicação** | Versão em produção conferida por HTTP (`/api/status`, operacional) | **Backup/restore D1/R2** em produção (conta Cloudflare) |

## 🔑 Rotação de credenciais (fazer agora — só a titular tem o cofre)

Todo segredo que trafegou por conversas com assistentes deve ser tratado como
potencialmente exposto e rotacionado. Nenhum segredo está no código (verificado).
Os valores nunca aparecem aqui — só o nome e onde rotacionar.

1. **GEMINI_API_KEY** — Google AI Studio → gerar nova / revogar antiga → `npx wrangler secret put GEMINI_API_KEY`
2. **XAI_API_KEY** — console.x.ai → revogar e gerar → `npx wrangler secret put XAI_API_KEY`
3. **GOOGLE_API_KEY** — console.cloud.google.com → Credenciais → regenerar **e restringir** as APIs → `npx wrangler secret put GOOGLE_API_KEY`
4. **BREVO_API_KEY** — app.brevo.com → SMTP & API → revogar e gerar → `npx wrangler secret put BREVO_API_KEY`
5. **Token Cloudflare de deploy** — dash.cloudflare.com/profile/api-tokens → *roll* → atualizar o secret **`CLOUDFLARE_API_TOKEN` no GitHub** (Settings → Secrets → Actions). Não é `wrangler secret`.
6. **VAPID** (se o par compartilhado em conversa foi o cadastrado) — gerar par novo (comando em `PENDENCIAS_DA_TITULAR.md`) → `npx wrangler secret put VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` (atualizar também a chave pública embutida no frontend).

Depois de cada uma: `npx wrangler secret list` para conferir e testar a função
afetada. Segredos são lidos em runtime (não exige redeploy).

## 🚦 Go-live — passos que exigem a titular

- **Mergear o PR #440**: revise e aprove; o merge na `main` publica em produção
  pelo Workers Builds. (Não faço merge/aprovação por política.)
- **TRACK3R webhook**: `openssl rand -hex 32` → `npx wrangler secret put TODOGREEN_TRACK3R_WEBHOOK_SECRET`; informe ao fornecedor a URL `.../api/todogreen/tms/webhook/<id>` e peça a tabela oficial de códigos de ocorrência (detalhes em `PENDENCIAS_DA_TITULAR.md`). Feito isto, dá para homologar os 13 eventos com dados reais.
- **monday.com**: conectar a conta na Central de Integrações (OAuth) e mapear os quadros/campos aos registros do ERP.
- **Backup/restore D1/R2**: validar em produção com a conta Cloudflare (runbook em `docs/DEPLOYMENT_RUNBOOK.md`).

## Próximos passos de código (posso seguir com seu aval)

- **Migração cookie-only dos portais externos** (tira o token do `localStorage`, fechando o vetor de XSS): faseada — portais → app → remoção das gravações do token. Só frontend (o servidor já valida pelo cookie).
- **Allow-list de papéis internos no choke point** (defesa em profundidade) + teste de contrato que garante 403 de papel de permissão mínima em toda rota interna.
- **Atomicidade por lote** (`env.DB.batch`) nas projeções TRACK3R (hoje idempotentes + reprocessáveis; batch daria all-or-nothing por evento).
- **monday.com — projeção para o ERP + testes**: depois que você definir o mapeamento (quais quadros/colunas viram quais registros do ERP), construo a projeção dos eventos do inbox para os registros e cubro com testes (hoje só há OAuth + receptor de webhook, sem projeção nem cobertura).

## Estado de validação (nesta sessão, sem GitHub Actions)

- Lint: 0 erros · Build: OK · Testes unitários: 4578/4578 · e2e local: 10/11 (1 falha de copy pré-existente).
- Testes de worker: as 4 falhas do TRACK3R (webhooks) foram **corrigidas**; restam 2 pré-existentes (`energy`, `geo-fleet`) que dependem de serviços externos (Valhalla/ANEEL/ANP) indisponíveis neste ambiente — passam no build real da Cloudflare.
- Cloudflare Workers Builds do PR #440: **deploy bem-sucedido** (portão real de deploy).
