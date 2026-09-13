# Regressão visual (screenshot regression)

Rede de segurança visual da To Do Green: cada tela vira um screenshot comparado
com um baseline versionado. Qualquer mudança de layout, cor, espaçamento ou
componente aparece como diff — é o que protege a consolidação do Design System
de quebrar telas sem ninguém ver.

> **Não depende do GitHub Actions.** O Actions está sem franquia/minutos; esta
> suíte roda **local**, na **sessão remota do Claude Code** (Chromium/Linux, mesma
> versão do Playwright) ou, para baseline canônico reproduzível em qualquer
> máquina, numa **imagem Docker fixa**.

> **Uma suíte só.** Em 13/09 existiam duas implementações paralelas (esta e
> `e2e/todogreen-screenshots.spec.js`, do PR #371). Foram consolidadas aqui: as
> máscaras de relógio/versão/latência/mapa e as telas Saúde do sistema e
> Inteligência vieram para este spec; o outro arquivo e seus PNGs foram removidos.
> Não crie outra — estenda `PAGINAS_ERP`.

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

**Estado real dos baselines versionados:** foram gerados na sessão remota do
Claude Code (Ubuntu + Chromium do Playwright 1.62.1, sem Docker disponível ali)
e revalidados em execução independente no mesmo ambiente. É o mesmo par
Playwright/Chromium da imagem Docker, mas a lista de fontes do sistema pode
diferir — se a primeira rodada em Docker acusar diferença só de anti-aliasing,
regenere lá (`npm run test:visual:docker:update`), comite e passe a tratar o
Docker como origem única. Nunca comite baseline gerado num Mac/Windows.

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
- **Máscaras** sobre regiões voláteis: `time`, `[data-visual-dinamico]`, versão
  publicada/latências da Saúde do sistema (`.tdg-health-*`), relógio do shell e o
  **mapa Leaflet** (tiles externos carregam ou não conforme a rede do runner).

## Cobertura

Viewports: **1440x960 claro**, **1440x960 escuro** e **390x844 mobile** (só onde
se aplica — painel, frota, To Do, TMS e portais; não em telas densas de mesa).

Telas: Dashboard, Clientes, Oportunidades, Viabilidade (Aceito esta viagem?),
Precificação, Propostas, Operações, Roteirização, Frota, Energia, To Do,
Financeiro, ESG, Saúde do sistema, Inteligência (radar/RFQ), TMS (portal interno —
abre pela mesma sessão, sem novo login) e a entrada dos portais externos (Cliente
e Motorista).

### Próximo degrau

**Pré-flight** e a **ficha de Conta** vivem DENTRO de fluxos (TMS/cliente) que
exigem dado semeado e interação para renderizar conteúdo — entram quando houver
um seed determinístico desses cenários. O **conteúdo autenticado** dos portais
externos (não só a tela de entrada) depende de cliente/motorista semeado, mesmo
caso.
