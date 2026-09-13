# CI/CD via Cloudflare Workers Builds (guia da titular)

> **Objetivo:** publicar a To Do Green **sem depender dos minutos pagos do GitHub
> Actions**. O Cloudflare Workers Builds vira o CI/CD **principal**: em cada push
> na `main`, ele clona o repo, instala dependências, valida, compila, aplica migrations e publica.
>
> O GitHub Actions continua **registrado** (workflows não foram apagados) —
> "Qualidade" para rodar testes quando os minutos voltarem, e "Publicar" como
> **botão manual de emergência** (não publica mais sozinho, para não haver
> publicação dupla).

## O que é cada peça

| Peça | Papel |
|---|---|
| **Cloudflare Workers Builds** | **CI/CD principal.** Publica automaticamente em push na `main`. |
| GitHub Actions "Qualidade" (`.github/workflows/ci.yml`) | Testes no CI do GitHub. Hoje falha por falta de minutos; volta a servir quando a franquia renovar ou com runner self-hosted (ver `GITHUB_SELF_HOSTED_RUNNER.md`). |
| GitHub Actions "Publicar" (`.github/workflows/deploy.yml`) | **Fallback manual** (workflow_dispatch). Não publica mais sozinho. |

O Worker se chama **`seufuncionario-expo`** (`wrangler.jsonc` → `name`). O nome no
painel Cloudflare tem que ser exatamente esse. Banco D1: `seu-funcionario-db`.

## Passo a passo no painel (uma vez)

1. Acesse o painel: **https://dash.cloudflare.com** → **Workers & Pages**.
2. Abra o Worker **`seufuncionario-expo`**.
3. **Settings** → aba **Builds**.
4. **Connect** / **Connect Git Repository** → **GitHub** → autorize se pedir →
   escolha **`brunapsiles/Seufuncionario`**.
5. **Production branch** = **`main`**.
6. Preencha os campos de build (próxima seção) e **Save**.

## Configuração recomendada do build

| Campo | Valor | Por quê |
|---|---|---|
| **Root directory** | `/` | O projeto está na raiz. |
| **Build command** | `npm ci && npm run verify && npm run build` | Instala a árvore exata do lockfile, roda o **quality gate obrigatório** (`verify` = lint + testes de unidade + testes de worker) e só então gera o `dist/`. |
| **Deploy command** | `npm run deploy:cloudflare` | Aplica as migrations no D1 **e** publica: `wrangler d1 migrations apply seu-funcionario-db --remote && wrangler deploy`. |
| **Non-production branches** | **Preview** (build/preview, **sem** promover a produção) | PR/branch vira versão de prévia; **nunca** promovida sozinha. |

> **Observação sobre E2E (Playwright):** os testes de screenshot exigem navegador
> e **não** entram no build do Cloudflare (pode não haver browser no ambiente e
> estoura o tempo). Eles ficam no **gate visual** separado (runner self-hosted ou
> execução local — ver `GITHUB_SELF_HOSTED_RUNNER.md` e o item de regressão
> visual). O build do Cloudflare roda o gate obrigatório (`npm ci` + `verify` + `build`).

Se o painel exigir **separar build e deploy**, use:
- **Install command:** `npm ci` (se o painel oferecer esse campo)
- **Build command:** `npm run verify && npm run build`
- **Deploy command:** `npm run deploy:cloudflare`

Se o painel não tiver campo de instalação separado, o **Build command** precisa ser:
`npm ci && npm run verify && npm run build`

Se só houver um campo de comando, use `npm ci && npm run deploy` (o script
`deploy` executa `verify && build && deploy:cloudflare`) — mas o caminho preferido é separar, para
o log distinguir "falhou na validação" de "falhou ao publicar".

## Segredos e variáveis

- O Worker **já tem os segredos no cofre da Cloudflare** (Gemini, xAI, Google,
  Brevo, etc. — ver `AGENTS.md`/`PENDENCIAS_DA_TITULAR.md`). O Workers Builds
  publica **no mesmo Worker**, então ele herda esses bindings/segredos em
  produção. Não é preciso recadastrar nada para publicar.
- Para o **deploy command** aplicar migrations e publicar, o Builds precisa de
  permissão de Workers + D1 na conexão (a própria conexão Git do Builds já roda
  como a sua conta) — não exige token no repositório.
- **NUNCA** colocar segredo no GitHub (nem em arquivo versionado, nem em
  `Secrets` do repo) para o caminho principal. O único segredo que o **fallback
  manual** ("Publicar") usa é `CLOUDFLARE_API_TOKEN` em
  *Settings → Secrets and variables → Actions* — e só se você quiser usar esse
  botão manual. O caminho Cloudflare Builds **não** usa esse token.
- ⚠️ Se algum token de API foi colado em conversa/chat, **revogue e gere outro**
  em *My Profile → API Tokens*.

## Segurança de migrations (importante)

- O `deploy:cloudflare` roda `wrangler d1 migrations apply --remote` **antes** de
  publicar. O wrangler rastreia migrations **pelo nome do arquivo** e só aplica as
  que faltam — então uma migration já aplicada **não** é reaplicada.
- **NUNCA** renomear, reordenar, reaplicar ou apagar uma migration já aplicada.
  Isso quebra o rastreamento e pode falhar o deploy.
- Nota de auditoria: o D1 de produção já tem a `0119_todogreen_operation_import_templates.sql`
  aplicada (veio de branch ainda não mergeada). Quando essa branch mergear, o
  wrangler verá a 0119 como já aplicada e **não** vai duplicar. Ver
  `AUDITORIA_CONSOLIDACAO_TDG.md` seção 2.

## Como confirmar o primeiro deploy

1. Faça um push (ou merge) na `main`.
2. No painel: **Workers & Pages → seufuncionario-expo → Builds** — acompanhe o log
   (deve rodar npm ci → verify → build → migrations → deploy).
3. Confirme a versão no ar:
   `https://seufuncionario-expo.brunapsiles.workers.dev/api/status`
   → o campo **`version`** deve mostrar o **SHA curto** do commit da `main` que
   você acabou de publicar (é como se rastreia "produção == main"). O `buildTime`
   deve ser recente.

## Deploy manual de emergência (fallback, não é o caminho principal)

Se o Cloudflare Builds estiver indisponível, dá para publicar do seu terminal
(exige `wrangler login` na sua conta):

```bash
npm ci
npm run verify   # lint + testes de unidade + worker
npm run build
npm run deploy:cloudflare   # aplica migrations no D1 remoto e publica
```

Alternativa sem terminal: **Actions → "Publicar" → Run workflow** (usa o
`CLOUDFLARE_API_TOKEN` do repositório; só funciona com os minutos do Actions
disponíveis). Esse fallback manual também roda `npm ci`, `npm run verify` e
`npm run build` antes de migrar/publicar.

## Evitar publicação duplicada

- **Automático:** só o Cloudflare Workers Builds.
- **Manual:** "Publicar" (workflow_dispatch) — use apenas quando o Builds não der
  conta. Ele **não dispara mais sozinho** (o gatilho automático foi removido em
  `deploy.yml`), justamente para os dois nunca publicarem o mesmo commit ao mesmo
  tempo.
