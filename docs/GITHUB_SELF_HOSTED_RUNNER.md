# GitHub Actions com runner self-hosted (fallback opcional)

> **Para que serve:** rodar os testes do GitHub Actions ("Qualidade": lint +
> unidade + worker + build, e opcionalmente o E2E visual) **sem consumir os
> minutos pagos do GitHub-hosted**. Uma máquina sua (ligada) executa os jobs.
>
> **Isto é OPCIONAL.** O CI/CD principal é o Cloudflare Workers Builds
> (`CLOUDFLARE_BUILDS_SETUP.md`). O runner self-hosted só interessa se você
> quiser manter o check "Qualidade" verde no GitHub e/ou rodar os testes de
> screenshot (que precisam de navegador) num ambiente controlado.

## Requisitos

- Uma máquina **Linux ou Windows** que possa **ficar ligada** quando você quiser
  que o CI rode (se estiver desligada, os jobs ficam na fila).
- Node.js 22 (o mesmo do `ci.yml`).
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

O workflow atual usa `runs-on: ubuntu-latest` (GitHub-hosted). Para usar o seu
runner, trocaria para `runs-on: [self-hosted, tdg-local]`. **Não** faça essa
troca no `ci.yml` principal antes de o runner existir — senão os jobs ficam
presos na fila. O caminho recomendado é criar um workflow separado
(ex.: `.github/workflows/qualidade-selfhosted.yml`) com `workflow_dispatch` e
`runs-on: [self-hosted, tdg-local]`, rodando exatamente:

```bash
npm ci
npm run verify        # lint + unidade + worker (gate obrigatório)
npm run build
# opcional (gate visual — precisa de navegador):
npx playwright install chromium
npm run test:e2e:todogreen
```

Assim você liga o gate quando quiser, sem mexer no fluxo que já existe.

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
| Testes de screenshot (navegador) | Runner self-hosted **ou** local (`npm run test:e2e:todogreen`) |
| Republicar de emergência | `npm run deploy:cloudflare` local, ou "Publicar" manual |
