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

O gate de produção fica no Cloudflare: `deploy:cloudflare` executa o E2E crítico em Chromium antes de migrations/publicação.

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

Adicione required status checks somente depois que o check estiver executando de forma confiável em PRs. Não exija hoje o `test-and-build` quebrado por quota, porque isso tornaria todos os merges impossíveis.

A proteção de branch não substitui o gate do deploy: uma mudança pode ser semanticamente ruim mesmo com PR. O fluxo continua sendo **PR → validação → merge → Cloudflare gate → produção**.
