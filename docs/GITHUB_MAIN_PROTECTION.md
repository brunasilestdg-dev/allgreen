# Proteção da branch main

Objetivo: impedir push direto na `main` sem tornar o repositório impraticável enquanto o GitHub Actions está sem runner/minutos.

## Política escolhida

- alteração da `main` somente por Pull Request;
- zero aprovações obrigatórias por enquanto (repositório de uma titular; exigir outra pessoa travaria o fluxo);
- administradora também respeita a proteção;
- conversa de PR precisa estar resolvida;
- force push desativado;
- exclusão da branch desativada;
- **nenhum status check do GitHub Actions é obrigatório enquanto o runner/quota está indisponível**.

O gate de produção fica no Cloudflare Workers Builds: o build command roda `npm ci && npm run verify && npm run build` antes do `deploy:cloudflare` (migrations + publicação). O E2E crítico (`test:e2e:critical`) **não** roda lá — o container não instala Chromium; ele é gate antes do merge e no fallback manual `deploy.yml` (`deploy:cloudflare:gated` encadeia os dois para quem publica com navegador).

Quando houver runner estável novamente, a proteção deve evoluir para exigir o check de qualidade do PR.

## Aplicação

O conector GitHub usado pelo assistente não expõe escrita administrativa de branch protection. Por isso a política está codificada em:

```
scripts/github/protect-main.sh
```

Execute uma vez numa máquina autenticada como administradora do repositório:

```bash
bash scripts/github/protect-main.sh
```

O script é idempotente: reaplica a mesma política e, ao final, consulta o estado da proteção.

Para outro repo/branch:

```bash
REPO=owner/repo BRANCH=main bash scripts/github/protect-main.sh
```

## Depois que o GitHub Actions voltar

Hoje não existe nenhum check de qualidade no GitHub para exigir (o único workflow é o `deploy.yml`, manual). Adicione required status checks somente depois que um check existir e estiver executando de forma confiável em PRs (`GITHUB_SELF_HOSTED_RUNNER.md`) — exigir um check que não roda tornaria todos os merges impossíveis.

A proteção de branch não substitui o gate do deploy: uma mudança pode ser semanticamente ruim mesmo com PR. O fluxo continua sendo **PR → validação → merge → Cloudflare gate → produção**.
