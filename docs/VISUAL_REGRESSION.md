# Regressão visual (screenshot regression)

Rede de segurança visual da To Do Green: cada tela vira um screenshot comparado
com um baseline versionado. Qualquer mudança de layout, cor, espaçamento ou
componente aparece como diff — é o que protege a consolidação do Design System
de quebrar telas sem ninguém ver.

> **Não depende do GitHub Actions.** O Actions está sem franquia/minutos; esta
> suíte roda **local** ou, para baseline canônico, numa **imagem Docker fixa**.

## Arquivos

- `playwright.visual.config.js` — config dedicada (separada da E2E funcional).
- `e2e/visual/apoioVisual.js` — determinismo (relógio fixo, sem animação, tema).
- `e2e/visual/regressao-visual.spec.js` — as telas cobertas.
- `e2e/visual/__baselines__/` — os PNGs de referência (gerados no Docker).
- `scripts/visual-regression.sh` — runner na imagem fixa.

## Por que Docker para o baseline

Fonte e render do Chromium mudam de um sistema para outro. Se o baseline for
gerado numa máquina e comparado em outra, o diff acusa diferença onde não houve
mudança de código. A imagem `mcr.microsoft.com/playwright:v1.62.1-noble` (a
MESMA versão do `@playwright/test` do projeto) fixa fonte + navegador + SO, então
o baseline é reproduzível em qualquer máquina com Docker.

## Comandos

```bash
# Gate: compara as telas com os baselines (falha se algo mudou)
npm run test:visual:docker

# (Re)gera os baselines canônicos — rode após uma mudança visual INTENCIONAL
npm run test:visual:docker:update
```

Sem Docker (iteração rápida, baseline NÃO canônico — pode divergir da sua
máquina; nunca comite baseline gerado assim):

```bash
npm run test:visual          # compara
npm run test:visual:update   # regenera local
```

## Fluxo

1. Primeira vez (ou após mudança visual aprovada): `npm run test:visual:docker:update`.
2. Confira o diff dos PNGs em `e2e/visual/__baselines__/` e **comite** os baselines.
3. Dali em diante, `npm run test:visual:docker` é o gate: vermelho = a tela
   mudou. Se foi de propósito, rode `:update` e comite; se não, é regressão.

## Determinismo (por que os screenshots não variam)

- **Conta fixa** criada pela mesma API do produto (`e2e/apoio.js`), estado
  conhecido (empty states determinísticos).
- **Relógio congelado** (`page.clock`, `INSTANTE_FIXO`) — sem "hoje"/"há 2 min".
- **Animações e transições desligadas** (reducedMotion + CSS injetado +
  `animations:"disabled"`).
- **locale `pt-BR` e fuso `America/Sao_Paulo`** fixos.
- **Máscaras** sobre regiões voláteis (e-mail único no perfil, assistente Semente).

## Cobertura

Viewports: **1440x960 claro**, **1440x960 escuro** e **390x844 mobile** (só onde
se aplica — painel, frota, To Do, TMS e portais; não em telas densas de mesa).

Telas: Dashboard, Clientes, Oportunidades, Viabilidade (Aceito esta viagem?),
Precificação, Propostas, Operações, Roteirização, Frota, Energia, To Do,
Financeiro, ESG, TMS (portal interno — abre pela mesma sessão, sem novo login) e
a entrada dos portais externos (Cliente e Motorista).

### Próximo degrau

**Pré-flight** e a **ficha de Conta** vivem DENTRO de fluxos (TMS/cliente) que
exigem dado semeado e interação para renderizar conteúdo — entram quando houver
um seed determinístico desses cenários. O **conteúdo autenticado** dos portais
externos (não só a tela de entrada) depende de cliente/motorista semeado, mesmo
caso.
