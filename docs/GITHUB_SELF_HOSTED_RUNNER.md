# GitHub Actions com runner self-hosted (fallback opcional)

> **Para que serve:** ter um check de qualidade no GitHub (lint + unidade +
> worker + build, e opcionalmente o E2E) **sem consumir os minutos pagos do
> GitHub-hosted**. Uma máquina sua (ligada) executa os jobs.
>
> **Isto é OPCIONAL e ainda não existe.** Hoje o repositório tem um único
> workflow, o "Publicar" (`.github/workflows/deploy.yml`, manual). O CI/CD
> principal é o Cloudflare Workers Builds (`CLOUDFLARE_BUILDS_SETUP.md`) e o gate
> de qualidade roda antes do merge. O runner self-hosted só interessa se você
> quiser um check verde/vermelho no próprio PR e/ou rodar os testes de
> navegador num ambiente controlado.

## Requisitos

- Uma máquina **Linux ou Windows** que possa **ficar ligada** quando você quiser
  que o CI rode (se estiver desligada, os jobs ficam na fila).
- Node.js 22 (o mesmo do `deploy.yml`).
- Para o E2E visual: o navegador do Playwright instalado
  (`npx playwright install chromium`).

## Cadastro do runner (uma vez)

1. No GitHub do repositório: **Settings → Actions → Runners → New self-hosted
   runner**.
2. Escolha o SO (Linux/Windows) e siga os comandos que a própria tela mostra
   (baixar o runner, `./config.sh` com o token que ela gera, `./run.sh`).
3. Dê um **label** ao runner (ex.: `tdg-local`) para os workflows o escolherem.
4. Deixe o `./run.sh` (Linux) ou o serviço (Windows) rodando. Para rodar sempre,
   instale como serviço (`./svc.sh install` no Linux; o instalador do Windows
   oferece serviço).

## Apontar um workflow para o runner

O `deploy.yml` usa `runs-on: ubuntu-latest` (GitHub-hosted) e deve continuar
assim. Para o check de qualidade, crie **depois de o runner existir** um workflow
separado — se ele apontar para um runner que ainda não existe, os jobs ficam
presos na fila. Exemplo de `.github/workflows/qualidade-selfhosted.yml`:

```yaml
name: Qualidade (runner próprio)
on:
  pull_request:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  gate:
    runs-on: [self-hosted, tdg-local]
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run verify        # lint + unidade + worker (gate obrigatório)
      - run: npm run build
      # gate de navegador (precisa do Chromium do Playwright no runner):
      - run: npm run test:e2e:critical
```

Só depois de ele rodar de forma confiável em PRs vale torná-lo obrigatório na
proteção da `main` (`GITHUB_MAIN_PROTECTION.md`).

## Segurança (ler antes de ligar)

- **NUNCA rode PR de terceiros não confiável** num runner que tenha credenciais
  de produção. Um PR malicioso pode executar código arbitrário no runner. Como
  este é um repositório privado de um time pequeno, o risco é menor, mas a regra
  vale: só rode o que você confia.
- **Restrinja o runner ao repositório** (runner de *repo*, não de *organização*),
  para ele não ser usado por outros repos.
- **Não guarde segredos de produção no runner.** O gate obrigatório
  (`verify` + `build`) **não precisa** de segredo nenhum — os testes usam D1 em
  memória/mocks. Só o **deploy** precisa de credencial, e o deploy é do Cloudflare
  Builds, não do runner.
- Prefira runner **efêmero** (`--ephemeral`) se for rodar PRs, para cada job
  começar limpo.
- Mantenha o SO e o Node atualizados.

## Quando usar cada caminho

| Situação | Caminho |
|---|---|
| Publicar (produção) | **Cloudflare Workers Builds** (automático em push na `main`) |
| Rodar testes no GitHub sem gastar minutos | **Runner self-hosted** (este doc) |
| Testes de navegador | Runner self-hosted **ou** local (`npm run test:e2e:critical`; screenshots: `npm run test:visual`) |
| Republicar de emergência | `npm run deploy:cloudflare` local, ou "Publicar" manual |
