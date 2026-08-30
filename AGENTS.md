# Guia para agentes (Codex, Claude e outros)

Este arquivo orienta qualquer assistente de IA que trabalhe neste projeto. A titular (Bruna) alterna entre assistentes — **leia tudo antes de mexer**.

## O que é o projeto

**Seu Funcionário** — plataforma de equipe digital para empreendedores brasileiros, em produção:
**https://seufuncionario-expo.brunapsiles.workers.dev**

- Frontend: React 19 + Vite (`src/App.jsx` concentra o app; `src/styles.css` os estilos)
- Backend: Cloudflare Worker (`worker.js`) — login, chat de IA multi-provedor, mídia, sincronização, colaboração
- Banco: Cloudflare D1 (`seu-funcionario-db`), migrações em `migrations/`
- PWA instalável; código no GitHub `brunapsiles/Seufuncionario` (branch `main`)

## Comandos

```bash
npm ci            # instalar
npm run lint      # ESLint (flat config); trava só em ERROS, avisos não bloqueiam
npm run verify    # roda lint + todos os testes
npm run build     # gera dist/ (não commitado)
npm test          # executa a suíte Vitest isoladamente
npm run deploy    # valida, compila, aplica migrações e publica
npm run deploy:cloudflare                             # aplica migrações e publica
npx wrangler d1 migrations apply seu-funcionario-db --remote   # aplica migrações novas
```

**Lint** (`eslint.config.js`, flat config): roda no `verify`, no deploy local completo e no CI. O Cloudflare Workers Builds executa só a compilação porque a validação completa já é a barreira obrigatória do GitHub. O lint trava só em ERROS; hoje o único rule como erro é `react-hooks/rules-of-hooks` (0 violações — de guarda contra a classe de bug de "hooks depois de return condicional" que já mordeu aqui). O resto é AVISO (backlog para reduzir aos poucos, ~80): `no-unused-vars`, `react-hooks/exhaustive-deps`, regras novas do React Compiler (`set-state-in-effect` etc.) e `jsx-a11y` (acessibilidade). Ao mexer no código, não precisa zerar os avisos, mas **não introduza erros** (o CI barra).

## Deploy automático

O Cloudflare Workers Builds está conectado ao repositório `brunapsiles/Seufuncionario`.
Todo push na branch `main` executa `npm ci && npm run build` e, em seguida,
`npm run deploy:cloudflare`. O diretório raiz configurado é `/`; builds de branches que
não sejam a `main` também estão habilitados como versões de prévia. A validação completa
(`npm run verify`) acontece antes no GitHub Actions, evitando estourar o tempo do build
gratuito da Cloudflare. O workflow `Publicar` do GitHub é apenas uma contingência manual.

## Segredos (JÁ configurados no cofre do Worker — nunca commitar valores)

`GEMINI_API_KEY`, `XAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `BREVO_API_KEY`, `MAIL_SENDER`, `MAIL_SENDER_NAME`. Os provedores gratuitos adicionais são ativados quando seus segredos `GROQ_API_KEY`, `SAMBANOVA_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `GITHUB_MODELS_TOKEN` e `HF_TOKEN` forem cadastrados.

**Pendente de cadastro pela titular** (a sessão que implementou não tem acesso ao `wrangler login`/cofre de produção): `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` — sem eles, `pushEnabled(env)` fica `false` e o app funciona normalmente, só sem notificações do navegador. Gerar um par novo com `crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"])`, exportar a chave pública como `raw` (base64url) e a privada como `jwk.d` (veja `handleAuth`/`vapidHeaders` em `worker.js` para o formato exato esperado). Opcional: `VAPID_SUBJECT` (um `mailto:` ou URL identificando o operador) — se ausente, usa a URL de produção como padrão.

## Busca web: cascata, nunca disparo simultâneo

`worker/services/web-search.js` tenta UM provedor por vez e só cai para o
seguinte se ele falhar ou voltar vazio — o mesmo desenho de `runWithFallback`
em `ai.js`. **Não voltar a chamar todos em paralelo**: já foi assim, e com três
provedores ligados uma pesquisa de empresa de 8 consultas virava 24 chamadas,
queimando a cota de três serviços ao mesmo tempo para responder a mesma
pergunta. Nesse desenho, ligar mais provedor gratuito gastava MAIS cota.

Ordem da cascata (de cima para baixo): SearXNG auto-hospedado, Serper, Brave,
Tavily, Exa, Jina, Firecrawl, Search1API, You.com, Google CSE, SerpApi e, por
último, os que não pedem chave — DuckDuckGo, Wikidata e Wikipédia. O critério é
cota maior primeiro, para a menor sobrar de reserva.

Os três últimos existem para a pesquisa NÃO MORRER quando a cota dos outros
acaba; como a cascata para no primeiro que entrega, eles não custam chamada
extra enquanto os de cima respondem. Por isso `webSearchConfiguration` responde
`configured: true` mesmo sem chave nenhuma — marcar `false` faria a vertical
recusar a pesquisa antes de tentar, e a reserva nunca serviria justamente
quando é necessária. `SEM_BUSCA_GRATUITA=1` desliga essa reserva.

Chaves opcionais, todas com cota gratuita: `SERPER_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `JINA_API_KEY`,
`FIRECRAWL_API_KEY`, `SEARCH1_API_KEY`, `YOU_API_KEY`, `SERPAPI_API_KEY`,
`GOOGLE_SEARCH_API_KEY` + `SEARCH_ENGINE_ID`. `SEARXNG_BASE_URL` não é chave:
é a URL de uma instância própria, e é a única saída sem cota.

Cadastrada uma chave, confira com **Integrações → Busca web → Testar**: ele roda
o mesmo caminho da pesquisa de empresa e diz quem respondeu, quem falhou e
quantos resultados vieram.

## Regras inegociáveis

1. **Gratuidade**: nada de serviços pagos, cartão ou dependência obrigatória de API paga. xAI (Grok) não entra na cascata automática; exige `confirmPaid: true` por consumir créditos.
2. **Nunca** colocar chaves/tokens em código, commits, logs ou no frontend.
3. Produto 100% em **português do Brasil**; tom profissional e acolhedor.
4. Antes de commitar: `npm run verify` e `npm run build` verdes. Testar o fluxo real em produção quando possível.
5. Não recriar funções que já existem — corrigir/estender as atuais (ver mapa abaixo).
6. Alterou schema? Criar NOVA migração numerada em `migrations/` (nunca editar as antigas) e aplicar com wrangler.
7. Dados de usuários são isolados por conta; qualquer rota nova de dados exige sessão (ver `sessionUser`).
8. Ao subir mudança visual, incrementar a versão do cache em `public/sw.js` (`seu-funcionario-vN`).
9. Mudanças concluídas e validadas devem ser publicadas automaticamente, sem pedir
   uma autorização adicional à titular. Só interromper quando houver bloqueio externo
   inevitável de credencial, permissão ou serviço, informando exatamente o acesso faltante.

## Arquitetura do frontend (quebra do monólito, em andamento)

`src/App.jsx` ainda é grande (~20,8 mil linhas), mas a **camada de lógica pura** (sem React/JSX) está sendo movida para `src/domain.js`: helpers fundamentais (`uid`, `today`, `contactLinks`), gamificação (`DEFAULT_LEVELS`, `computeUserPoints`, `levelForPoints`, `levelProgress`, `computeAchievements`), `computeMyWork` e `computeBusinessInsights`. **Padrão:** `App.jsx` importa de `./domain.js` para uso interno **e reexporta** o que os testes consomem via `import { ... } from "./App"` — assim testes existentes não quebram. Ao adicionar nova lógica pura/testável, colocar em `domain.js` (não em `App.jsx`) e, se algum teste importar de `./App`, adicionar à linha de reexport. Próximos passos da quebra (ainda não feitos): extrair componentes de página com `React.lazy` para code-splitting.

## Mapa do que já existe (não duplicar)

- **Auth**: e-mail+senha (PBKDF2), verificação por código de 6 dígitos via Brevo (`pending_signups`, `/api/auth/verify|resend`), login Google (`/api/auth/google`; origem autorizada e fluxo real validados), perfil (`/api/auth/profile`)
- **Chat com a IA** (`UniversalRequest`, na Estratégia e no Início): resposta em streaming (`/api/ai/stream`, SSE) com fallback para `/api/ai`; markdown (`Markdown`), ações por mensagem (copiar/salvar/documento/tarefa). Melhorias de interação: **botão "Parar"** durante a geração (`abortRef`/`stoppedRef` — parada do usuário mantém o parcial e não vira erro; timeout de 70s continua tratado como erro), **sugestões de início** (prompt starters) no estado vazio (`applyStarter` — NÃO nomear com prefixo `use`, senão o ESLint trata como hook e o build trava), e **auto-scroll acompanha o streaming** (dep `streamingLen` = tamanho da última mensagem).
- **IA**: cascata dinâmica em `worker.js` (`providerMap`): Google Gemini/Gemma, Cloudflare Workers AI, Groq, Cerebras, Mistral, OpenRouter, GitHub Models e Hugging Face. Só entram provedores configurados; xAI exige confirmação paga; ao final há contingência local. 46 funcionários especialistas + Diretor orquestrador + funcionários dinâmicos criados pelo usuário
- **Sync**: workspace JSON por usuário no D1 (`/api/workspace`), multi-dispositivo, espaços compartilhados com convites (`/api/collab/*`), controle otimista por `revision`
- **Ferramentas inteligentes** (ToolsHub): tradutor, roteirizador (link Google Maps), calculadora de preço, gerador de posts, minuta de contrato, roteiro de vendas, vaga/entrevista RH, POP operações, respostas de atendimento — padrão `aiTools` + `AIToolModal`, fácil de estender. Os cartões são renderizados a partir de `smartToolGroups` (agrupados por tema: Vendas e clientes / Dinheiro e números / Documentos e textos / Equipe e operação) — ferramenta nova entra no grupo certo desse array, não como JSX solto. Ordem da página: ferramentas internas (inteligentes + Modelos de WhatsApp) antes do redirecionador externo (hero + catálogo + guia fiscal). Trocar de página sempre volta a rolagem ao topo (`useEffect` sobre `page` em `App`); a barra de seções de Configurações (`settings-jump-nav`) é sticky de largura total com fundo sólido e as seções-alvo têm `scroll-margin-top` — manter esses dois detalhes ao mexer em navegação/âncoras.
- **Painel "Recursos desta área"** (`areaToolkits` + componente `AreaToolkit`, no topo de cada página de área): é recolhível e vem **recolhido por padrão** (estado persistido em `localStorage` por área, chave `sf-toolkit-open:{area}`) para a superfície de trabalho (kanban, CRM, fluxo de caixa…) aparecer primeiro — não voltar a deixá-lo aberto/dominando a tela. Regra de curadoria dos itens: redirecionamentos externos só entram quando **complementam** um módulo nativo, nunca quando o duplicam (por isso saíram Trello/Notion da Operação, Notion de Estratégia/Documentos e HubSpot de Vendas — o app já tem kanban, Documentos e CRM próprios; Sheets/Canva/Drive/Google Agenda/NF-e ficam por serem complementos). Taxonomia de selo unificada em 3 categorias: `No app` (page/scroll/special), `Com IA` (aiTools), `Serviço externo` (toolCatalog). Não reintroduzir selos avulsos ("Gratuito", "REDIRECIONAMENTO" etc.) nesse painel.
- **Sites**: editor com publicação real em `/s/:slug`, HTML higienizado, formulário público e leads por proprietário (`/api/sites/*`, `/api/public-sites/*`; migração `0006_public_sites.sql`)
- **Demais**: tarefas/kanban, CRM, financeiro, documentos com histórico restaurável, estúdio de mídia (FLUX na cota gratuita; vídeo via servidor próprio opcional em `video-ai/`), certificações, PWA, tema claro/escuro, página Meu Time e Configurações
- **Caixa de entrada unificada** (página `caixa`, componente `InboxPage`): reúne por contato tudo que entra e sai — WhatsApp, e-mail, formulários do site, ligações e notas. **É a PRIMEIRA coleção fora do blob JSON do workspace**: mora numa tabela relacional real (`interactions`, migração `0015_interactions.sql`) com escopo por espaço via `/api/inbox` (`handleInbox`, mesmo padrão de `handleProductEvents` — `membershipRole(user, owner)`, `?owner=` para espaço ativo; todo membro do espaço vê a caixa compartilhada, autor gravado por registro). Este é o padrão-alvo para migrar tarefas/leads/caixa depois — **dado novo de alto volume NÃO deve ir para o blob JSON**. Frontend: `logInteraction(...)` (helper de módulo) é chamado nos pontos de envio — `useWhatsappSender`/`WhatsappSendModal` (`onSent`) e `EmailComposer` (`logEmail` em todas as vias: Gmail API, Gmail web, Outlook, mailto) — para que todo canal caia num só lugar ligado ao contato. `groupInteractions` (pura, exportada, testada) agrupa por `contactId || contactHandle || contactName`. Registros que saem (`direction: "out"`) já nascem lidos; recebidos ficam por ler. **Omnichannel dentro da gratuidade**: sem API paga da Meta — o WhatsApp que sai é registrado, e a entrada vem de e-mail/formulário; WhatsApp bidirecional real fica como degrau futuro (exige WhatsApp Cloud API + verificação da titular). **Entrada real já ligada**: quando um formulário de site público recebe uma mensagem (`handlePublicSite`, endpoint `/api/public-sites/:slug/leads`), além do `public_site_leads` grava uma interação `channel: "form", direction: "in"` (por `read_at` nulo = não lida) para o dono do site — só quando o lead é novo (respeita a deduplicação diária via `meta.changes`). A linha do tempo de cada contato aparece **dentro do modal de edição do contato** (componente `ContactTimeline`, em `Contacts`): busca `/api/inbox` e casa por `contactId`, telefone (últimos 8 dígitos, tolera formatação), e-mail ou nome.
- **Jornadas transversais** (gatilhos entre módulos, usando a caixa/linha do tempo como hub): helpers puros e testados em `src/App.jsx`. `buildOrderReceita(order, {businessId, ownerId})` → um pedido registrado vira, opcionalmente (checkbox `postToFinance`, padrão ligado, só ao criar), uma **receita no caixa** (`type: "Receita"`, `category: "Vendas"`, `sourceOrderId`), e sempre registra um `logInteraction` na linha do tempo do cliente (canal `note`) — ver `saveOrder` em `Catalog`. `buildLeadWonSideEffects(lead, {businessId, ownerId})` → quando um lead entra em **"Ganho"** (nos dois pontos: `save` do formulário e `changeStage` do kanban), cria uma **tarefa de primeiro atendimento** (`status: "A fazer"`, `priority: "Alta"`, `sourceLeadId`) e um registro na linha do tempo. Os gatilhos disparam só na TRANSIÇÃO para o estado (não em toda edição) para não duplicar. Ao criar novas jornadas, seguir esse padrão: helper puro (testável) + wiring no ponto de ação + `logInteraction` para o hub.
- **Orçamentos / RFQ** (página `orcamentos`, componente `Quotes`; coleção `db.quotes`, em `RESTRICTED_FIELDS` no worker para escopo por dono/visibilidade como `orders`): monta orçamento ao cliente com itens de texto livre (descrição/qtd/preço — serve serviços, não só catálogo), desconto e validade. Status `rascunho`/`enviado`/`aprovado`/`recusado`. "Enviar" abre o WhatsApp (via `useWhatsappSender`) e registra na linha do tempo; **"Aprovar e gerar pedido"** fecha a jornada transversal: `orderFromQuote` (pura) cria um pedido em `db.orders` que, via `buildOrderReceita`, lança a receita no caixa — e registra tudo na linha do tempo do cliente. Helpers puros testados: `quoteTotal` (soma − desconto, ≥0) e `orderFromQuote` (`channel: "Orçamento"`, `sourceQuoteId`). Sem Meta/API paga. **Link público de aprovação** (migração `0016_public_quotes.sql`): botão "Link para aprovar" em cada orçamento chama `POST /api/quotes/share` (`handleQuotes`), que grava um SNAPSHOT do orçamento (que vive no blob) numa tabela relacional `public_quotes` com um token não-adivinhável (`randomHex(16)`), reaproveitando o token se já compartilhado. A página pública `/orcamento/:token` (`handlePublicQuote` → `renderPublicQuote`, servida no bloco não-autenticado junto de `/s/`) mostra o orçamento e dois `<form>` POST (sem JS inline, sem nonce) para Aprovar/Recusar em `/api/public-quotes/:token/decision` (limitado por IP, **idempotente** — não sobrescreve decisão já tomada; form POST responde 303 de volta à página, JSON responde status). **Sem criação automática de pedido**: o app do dono busca `GET /api/quotes/status` e mostra o selo "Aprovado pelo cliente" no card; a conversão em pedido continua sendo o botão "Aprovar e gerar pedido" (dono no controle). Testado em `test/public-quotes.worker.test.js`.
- **Compras / RFQ de fornecedores** (página `compras`, módulo lazy `src/features/procurement/Procurement.jsx`; coleção `db.supplierRfqs`, protegida por `RESTRICTED_FIELDS`): é distinta de Orçamentos, que vende ao cliente. Cria solicitação com itens, quantidades, prazo e prioridade; registra ou importa propostas de vários fornecedores; aceita PDF/DOCX/TXT/MD/CSV reaproveitando `extractDocumentText` e a IA de Compras; exige conferência antes de salvar; normaliza moeda brasileira; calcula subtotal, frete, impostos, desconto, cobertura e total; ranqueia sem deixar proposta incompleta vencer uma completa; compara menor preço item a item; registra o fornecedor escolhido; pode criar tarefa de negociação em Operação; pode cadastrar o fornecedor em Contatos; exporta mapa CSV. Todas as conexões são opcionais: a RFQ funciona completa e independentemente. Regras puras ficam em `src/domain.js` (`procurementNumber`, `supplierBidTotals`, `compareSupplierBids`, `bestOffersByItem`, `buildProcurementCsv`, `parseSupplierProposal`) e têm testes em `src/procurement.test.js`. Este módulo inaugura a extração real de uma página do monólito com `React.lazy`; novos módulos grandes devem seguir esse padrão.
- **Painel de resultados** (página `resultados`, componente `Insights`, grupo FINANCEIRO): transforma os dados já conectados (caixa, pedidos, orçamentos) em indicadores para o dono. `computeBusinessInsights(db, business, nowMs)` (pura, testada) calcula receita dos últimos 30 dias com tendência vs. os 30 anteriores, nº de pedidos, ticket médio, conversão de orçamentos (aprovados/decididos) e top clientes por receita (a partir de `orders`). Read-only. Estado vazio convida a registrar um pedido. É a "prova de valor" que só passou a existir depois que as jornadas transversais (iteração 2/3) ligaram venda→pedido→caixa.
- **Saúde do espaço de sincronização** (card "Dados e segurança" em Configurações): o workspace é UM JSON sincronizado (limite ~900 KB); quando cresce, a sincronização fica lenta/falha e conflita entre colaboradores. `workspaceBreakdown(db)` (pura, testada) mostra o que ocupa espaço por coleção (barras, maior primeiro), e `trimOldConversations(list, keep)` (pura) libera o maior ofensor seguro — conversas de IA antigas — mantendo as 5 recentes, via ação explícita com confirmação. **Nota estratégica**: `pushNotification` já limita `notifications` a 50; a caixa de entrada (iteração 1) já é relacional. A migração completa das coleções de alto volume (tarefas/leads/financeiro) do blob JSON para tabelas D1 é um trabalho ESTAGIADO e de risco (mexe no hot path de `useDatabase`/`performSync` e no CRUD espalhado) — deve ser feita coleção a coleção, seguindo o padrão do `handleInbox`/`interactions`, com teste real entre etapas; não fazer num único passo automatizado sobre dados de produção.
- **Meu trabalho** (página `meu-trabalho`, componente `MyWork`; item de menu no topo, ícone `BriefcaseBusiness`): espaço de trabalho focado da pessoa logada dentro do espaço ativo — é o "modo funcionário profundo". Consolida via `computeMyWork(db, userId, business)` (pura, testada) as tarefas atribuídas a ela (`assigneeId` ou `assignees[]`), com contadores (em andamento / aguardando revisão / correções pedidas / atrasadas), um aviso de "precisa de atenção", a lista de próximas tarefas por prazo, e o "Meu progresso" (nível/pontos/barra via `computeUserPoints`/`levelForPoints`/`levelProgress`, conquistas via `computeAchievements`, plano de desenvolvimento e certificações). É read-only + navegação (chama `go(...)`), não duplica os componentes pesados de tarefas. Distinto do PAINEL DO GESTOR (dono) no Dashboard. Obs.: o rótulo "Meu trabalho" também aparece no cabeçalho (`.top-business`) quando `isEmployeeMode` — testes que checam esse cabeçalho devem escopar em `.top-business` para não colidir com o item de menu.
- **Contratos / receita recorrente** (painel `#finance-recurring` no Financeiro, componente `Finance`; coleção `db.recurring`, em `RESTRICTED_FIELDS` no worker): mensalidades e contratos fixos com valor + dia de vencimento. Helpers puros em `src/domain.js` (testados): `recurringStatus` (agendado/a_lancar/lancado/off por mês), `buildRecurringTransaction` (receita `category: "Contratos"`, `sourceRecurringId`), `buildRecurringPostings` (lançamentos automáticos dos `autoPost` vencidos e não lançados — idempotente por `history["AAAA-MM"]`) e `buildRecurringReminder` (lembrete mensal dos MANUAIS, dedup por `recurring-AAAA-MM`). Efeito em `App` roda só no espaço do próprio dono (`if (activeSpaceId()) return`, como o DAS): dispara o lembrete e aplica o autoPost. Sem autoPost, o painel mostra "Lançar mês" (dono no controle — consistente com "nada de dinheiro criado sozinho sem opção").
- **Apresentações / gerador de slides** (página `apresentacoes`, componentes `Presentations` e `PresentationEditor`; coleção `db.presentations` no blob do workspace): a titular descreve o tema, o objetivo, o público e o número de slides, e a IA (`/api/ai`, `specialist: "Redator"`) devolve o roteiro. O parser puro `parseDeckSlides` em `src/domain.js` (testado em `src/deck.test.js`) normaliza a resposta num array `[{title, bullets[], notes}]` — tolera cercas ```json, texto ao redor do array, chaves em português (`titulo`/`pontos`/`notas`) e faz fallback para Markdown (`## título` + tópicos) quando não vem JSON. Cada slide vira um card; o **modo apresentação** é um overlay `role="dialog"` em tela cheia com navegação por setas/teclado (←/→/Espaço/Esc) e nota do apresentador. O `PresentationEditor` permite renomear, reordenar (↑/↓), adicionar/remover slides e editar tópicos (um por linha). **Exportação em PDF gratuita** via `jspdf` (import dinâmico, mesmo padrão de `Documents`): um slide por página em paisagem, sem serviço pago. Duplicar cria cópia. Prompt instrui a IA a não inventar preços/depoimentos/resultados não informados. Preenche a lacuna "Apresentações" da paridade de funções, dentro da gratuidade (reaproveita a IA já existente, nada de Gamma/Canva pago).
- **Calendário de conteúdo / planejador editorial** (página `conteudo`, componentes `ContentPlanner` e `ContentPostEditor`; coleção `db.contentPlan` no blob do workspace): a titular descreve o negócio, o canal principal e o objetivo, e a IA (`/api/ai`, `specialist: "Redator"`) devolve uma sequência de posts. Helpers puros em `src/domain.js` (testados em `src/content-plan.test.js`): `parseContentPlan` normaliza a resposta em `[{channel, format, hook, caption, cta, hashtags[]}]` — tolera cercas ```json, texto ao redor, chaves em português (`canal`/`formato`/`gancho`/`legenda`/`chamada`/`tags`) e limpa as hashtags (tira `#`, espaços e acentos inválidos); `scheduleContentDates(count, inicio, cadencia)` distribui as datas a cada N dias pulando domingo. Cada post nasce com `status: "ideia"` e ciclo ideia→pronto→publicado (botão de status). Ações por post: **copiar legenda** (clipboard, junta legenda+CTA+hashtags), **enviar por WhatsApp** (`whatsappLink("", texto)` → `wa.me/?text=`, sem número, grátis), editar (modal `ContentPostEditor`: data, canal, formato, situação, gancho, legenda, CTA, hashtags) e remover. Lista agrupada por data com rótulo em pt-BR. Prompt instrui a não inventar preços/promoções/depoimentos. Preenche a lacuna "Marketing/conteúdo" da paridade de funções — o menu Marketing continua sendo o chat com especialistas (`Specialists`); este é o planejador estruturado e persistido. Dentro da gratuidade (reaproveita a IA existente, sem agendador/API paga de redes sociais).
- **Gerador de planilhas** (página `planilhas`, componente `SheetBuilder`; coleção `db.sheets` no blob do workspace): a titular descreve a planilha que precisa e a IA (`/api/ai`, `specialist: "Estrategista"`) devolve a estrutura pronta com colunas e linhas de exemplo. Helpers puros em `src/domain.js` (testados em `src/sheet.test.js`): `parseSheet` extrai `{title, columns[], rows[][]}` de um objeto JSON (tolera cercas ```json, texto ao redor, chaves em português `colunas`/`linhas`, linhas como array OU objeto mapeado pelas colunas; ajusta cada linha ao número de colunas) e `buildCsv(columns, rows, sep=";")` serializa em CSV com separador `;` (padrão Excel pt-BR) e aspas escapadas. A tabela é **editável célula a célula** no app (editar cabeçalhos, adicionar/remover linhas e colunas). Exportação **CSV** com BOM UTF-8 (`"﻿" + csv`) para abrir com acentos no Excel/Google Planilhas, e **Copiar** como TSV (cola direto numa planilha). Planilhas podem ser salvas (`db.sheets`), reabertas e excluídas. Prompt deixa claro que os valores são exemplos ilustrativos a substituir — não inventa dados reais. Preenche a lacuna "Planilhas/dados" da paridade de funções sem dependência nova (CSV nativo, sem lib de xlsx) e dentro da gratuidade.
- **Análise de textos e documentos** (página `analise`, componentes `Analyzer` e `AnalysisResultView`; coleção `db.analyses` no blob do workspace): a titular cola um texto OU envia um arquivo (reaproveita `extractDocumentText` — PDF/DOCX/TXT/MD/CSV), opcionalmente faz uma pergunta, e a IA (`/api/ai`, `specialist: "Estrategista"`) devolve uma análise estruturada. Helper puro `parseAnalysis` em `src/domain.js` (testado em `src/analysis.test.js`): normaliza a resposta em `{summary, keyPoints[], risks[], actions[], answer}` — tolera cercas ```json, texto ao redor, chaves em português (`resumo`/`pontos`/`riscos`/`acoes`/`resposta`), limpa marcadores de lista, e retorna `null` se nada útil. O prompt é rígido: **a IA trabalha só com o texto fornecido, não usa conhecimento externo e diz quando algo "não consta"** (alinhado ao princípio "não inventar"). O texto é truncado em 18k caracteres no envio. Cada análise é salva (`db.analyses`, com título, pergunta, um trecho de 280 chars e o resultado) e reaparece em "Análises anteriores" (`<details>` expansível), com copiar/excluir. Preenche a lacuna "Pesquisa/análise" da paridade de funções, dentro da gratuidade — enquanto o chat de especialistas é conversacional, esta página entrega uma leitura estruturada de um documento específico. `AnalysisResultView` é um componente de módulo (não aninhado) para respeitar o `eslint` (regra de componentes instáveis em render).
- **Mapa de ideias / brainstorm** (página `ideias`, componente `MindMap`; coleção `db.brainstorms` no blob do workspace): a titular escreve um tema/desafio e a IA (`/api/ai`, `specialist: "Estrategista"`) abre em ramos e ideias. Helper puro `parseMindMap` em `src/domain.js` (testado em `src/mindmap.test.js`): normaliza a resposta em `{title, branches: [{title, ideas[]}]}` — tolera cercas ```json, texto ao redor, chaves em português (`ramos`/`ideias`/`titulo`), limpa marcadores e descarta ramos vazios. Grade de cards de ramo, tudo editável (título do ramo, ideias, adicionar/remover ramo e ideia). **Integração com tarefas**: o ✓ de cada ideia chama `taskFromIdea` (constante de módulo que espelha o `blankTask` de `Tasks`) e insere a tarefa em `db.tasks` (área "Operação", `status: "A fazer"`) — atalho para transformar pensamento em ação, com link para a página `operacao`. Mapas podem ser salvos (`db.brainstorms`), reabertos, copiados (Markdown) e excluídos. Preenche a lacuna "Organização/gestão" da paridade de funções, dentro da gratuidade. `taskFromIdea` é uma função de módulo (não aninhada) e replica todos os campos de array do `blankTask` para o card renderizar corretamente no quadro.
- **Modelos prontos de documentos** (dentro da página `documentos`, componente `Documents`): botão "Modelos prontos" abre um seletor (`Modal`) com uma biblioteca de modelos de negócio. Os modelos são dados puros em `src/domain.js`: `DOCUMENT_TEMPLATES` (contrato de prestação de serviços, recibo, proposta comercial, termo de confidencialidade/NDA, ordem de serviço, carta de cobrança amigável) e `fillDocTemplate(template, ctx)` (testados em `src/doc-templates.test.js`). Cada `body` usa `{{empresa}}` e `{{data}}` (preenchidos automaticamente com o nome do negócio ativo e a data de hoje formatada em pt-BR) e campos entre `[COLCHETES]` que a pessoa completa. Escolher um modelo chama `applyTemplate` → `open({...blankDocument, title, type, content: fillDocTemplate(...)})`, abrindo o editor de documento já preenchido (novo documento, salva na coleção `db.documents` como qualquer outro). O aviso deixa claro que **não é aconselhamento jurídico**. Preenche a lacuna "Documentos → modelos por segmento" sem serviço externo. Obs.: `applyTemplate` (não `useTemplate`) porque o prefixo `use` é tratado como hook pelo `eslint` (`react-hooks/rules-of-hooks`).
- **Gerador de assinatura de e-mail** (página `assinatura`, componente `EmailSignature`; coleção `db.signatures` no blob do workspace): monta uma assinatura profissional a partir de nome, cargo, negócio, telefone, e-mail, site, cidade, Instagram e cor de destaque — **sem IA** (determinístico, instantâneo). Builder puro em `src/domain.js` (testado em `src/signature.test.js`): `buildEmailSignature(data)` → `{ html, text }` (HTML com estilos inline compatível com clientes de e-mail; **escapa HTML** dos campos para evitar injeção; valida a cor de destaque) e `normalizeWhatsappNumber` (acrescenta DDI 55 a números nacionais). Prefill automático do perfil (`db.user`) e do negócio ativo. Prévia ao vivo em React (não usa `dangerouslySetInnerHTML` — o preview é montado com os dados do form, e o HTML só é gerado para copiar). Ações: **Copiar assinatura** (via `ClipboardItem` com `text/html` + `text/plain`, fallback para texto), **Copiar texto**, **Baixar HTML**, e **Salvar** (múltiplas assinaturas em `db.signatures`, reabríveis/excluíveis). Preenche a lacuna "Comunicação/e-mail → assinatura" dentro da gratuidade.
- **Cobrança Pix (copia e cola)** (página `cobranca`, componente `PixCharge`; coleção `db.pixCharges` no blob do workspace): monta um BR Code estático (Pix "copia e cola") a partir da chave, nome do recebedor, cidade, valor (opcional) e descrição — **sem IA e sem API bancária** (padrão determinístico do Banco Central/EMV). Builders puros em `src/domain.js` (testados em `src/pix.test.js`): `buildPixCode({key,name,city,amount,txid,description})` (formato EMV ID+tamanho+valor; sanitiza acentos/limita nome≤25 e cidade≤15; campo 54 só com valor>0) e `pixCrc16` (CRC16-CCITT-FALSE, ancorado ao vetor "123456789" ⇒ "29B1"). Ações: **Copiar código**, **Enviar por WhatsApp** (`whatsappLink("", msg)` com o código embutido) e **Salvar** (reabrir/excluir; prefill da chave/nome/cidade a partir da última cobrança salva). **Princípio "o app não toca no dinheiro"**: ele só gera o código — o pagamento cai direto na conta da chave Pix; aviso explícito no topo. Preenche a lacuna "Gestão comercial → link de cobrança" dentro da gratuidade. Fica na seção FINANCEIRO do menu.
- **Banco de dados personalizável / "Meus dados"** (página `bases`, componentes `DataBases` e `DbCell`; coleção `db.databases` no blob do workspace) — **primeira das quatro frentes grandes que a titular pediu ("Todos")**: motor tipo Notion/Airtable. Cada base = `{ id, name, fields[], rows[] }`; campo = `{ id, name, type, options? }` com tipos em `DB_FIELD_TYPES` (texto, texto longo, número, data, seleção, sim/não). Linha = `{ id, cells: { [fieldId]: value } }`. Helpers puros em `src/domain.js` (testados em `src/databases.test.js`): `coerceCellValue(type, raw)` (normaliza por tipo — número aceita vírgula, checkbox vira booleano), `formatCellValue`, `groupRowsByField` e `kanbanColumns(base, fieldId)` (colunas = opções do campo de seleção + "—" para vazios). UI: barra lateral de bases (criar por modelo — Clientes/Estoque/Projetos — ou em branco), e três **visões da mesma base**: **Tabela** (edição célula a célula por tipo, adicionar/remover linha e campo), **Galeria** (cards) e **Quadro** (kanban agrupado por um campo de seleção, com dropdown por card para mover). Modal de campo cria/edita/exclui colunas (nome, tipo, opções). `DbCell` é componente de módulo (não aninhado). Escopo por `businessId`. Próximas frentes pedidas: Wiki/páginas, Automação/agentes, Extensão de navegador. **Limites reais (não são "peso"): gratuidade e contas externas** — pesquisa web ao vivo, WhatsApp Cloud API, voz/vídeo em tempo real e colaboração com cursores ficam de fora por exigirem serviço pago/infra, não por complexidade.
- **Base de conhecimento / Wiki** (página `wiki`, componentes `Wiki` e `WikiTreeNodes`; coleção `db.wikiPages` no blob do workspace) — **frente 2 de 4**: wiki interna com páginas aninhadas. Cada página = `{ id, title, content, parentId, businessId, ownerId, ... }`. Helpers puros em `src/domain.js` (testados em `src/wiki.test.js`): `buildPageTree(pages)` (árvore por `parentId`, ordenada, órfãos sobem para a raiz), `pageDescendantIds(pages, id)` (para exclusão em cascata) e `searchPages(pages, q)` (busca em título+conteúdo). UI: barra lateral com **árvore recursiva** (`WikiTreeNodes`, componente de módulo) + busca; editor de página com título, campo "Dentro de:" (mover para outra página como pai, excluindo a si e descendentes p/ evitar ciclo) e conteúdo em **Markdown** (reaproveita o componente `Markdown` já existente do chat) com alternância Editar/Ler. Criar subpágina, excluir (cascata com confirmação). Escopo por `businessId`. Cobre "criar páginas, pastas, wikis, bases de conhecimento". Publicar na web fica como evolução (sites públicos já existem). Próximas frentes: Automação/agentes, Extensão de navegador.
- **Automações (regras que rodam sozinhas)** (página `automacoes`, componente `Automations`; coleção `db.automations` no blob do workspace) — **frente 3 de 4**: motor de regras agendadas. Regra = `{ id, name, enabled, frequency: "weekly"|"monthly", day, actionType: "task"|"reminder", actionText, history }`. Helpers puros em `src/domain.js` (testados em `src/automations.test.js`): `automationDue(rule, ymd)` (semanal dispara no dia da semana escolhido — dedup pela data; mensal dispara a partir do dia — dedup por mês; respeita `enabled` e `history`) e `runAutomations(rules, ymd)` → `{ rules: atualizadas com o período marcado, intents: [{ruleId, actionType, text}] }` (puro, não executa nada). O App transforma os intents em tarefas (`taskFromIdea`) ou notificações. **Efeito no App** (junto do DAS/recorrentes, `if (activeSpaceId() || !db.user?.id) return`) roda as automações vencidas ao abrir o app, idempotente. Componente: modelos rápidos (Planejar a semana / Fechar o caixa / Lembrete de cobrança), criar/editar/pausar/excluir regra, e botão **"Rodar agora"**. **Princípio de segurança**: automações **só criam tarefas e lembretes** — nunca gastam dinheiro nem enviam nada sozinhas (consistente com "nada de dinheiro criado sozinho"). Cobre "tarefas agendadas, lembretes, fluxos automáticos". Próxima frente: Extensão de navegador.
- **Extensão de navegador** (pasta `extension/`, artefato separado do PWA) — **frente 4 de 4, conclui o pacote "Todos"**: WebExtension Manifest V3 que leva a IA do app para qualquer página. Arquivos: `manifest.json` (MV3, permissões `activeTab`/`scripting`/`storage`/`contextMenus`, host do Worker), `popup.html`/`popup.css`/`popup.js` (ações: resumir página, traduzir seleção, responder mensagem, explicar, perguntar), `background.js` (menu de contexto "Perguntar ao Seu Funcionário") e `README.md` (instalar via "carregar sem compactação"/Firefox, conectar). **Núcleo puro `extension/prompt.js` → `buildExtensionPrompt(mode, ctx)`** (monta o prompt por modo, prioriza a seleção sobre o texto da página, trunca em 6000 chars, instrui "não inventar"), importado pelo `popup.js` e testado em `src/extension-prompt.test.js`. Autenticação: a extensão chama `POST /api/ai` com `Authorization: Bearer <token>`; o token é o de sessão do app, exposto para cópia em **Configurações → Extensão do navegador** (componente de módulo `ExtensionCard`, lê `AUTH_TOKEN_KEY` do localStorage, mascarado por padrão, testado em `src/extension-card.test.jsx`). ESLint: bloco novo em `eslint.config.js` para `extension/**` com globals `webextensions` (a API `chrome`). **Gratuidade**: reaproveita o `/api/ai` existente, sem serviço novo; Firefox grátis, Chrome Web Store tem taxa única de US$5 opcional (uso pessoal via load-unpacked não precisa). **As 4 frentes grandes pedidas ("Todos") estão concluídas**: banco de dados (v105), wiki (v106), automações (v107), extensão (v108).
- **Bases mais fundas: visão Calendário + campo Relação** (`DataBases`/`DbCell` em `src/App.jsx`; helpers em `src/domain.js`) — **aprofundamento 2/4 pedido ("Todos")**, aproximando o módulo de dados do Notion/Airtable: (1) **Visão Calendário** — grade mensal (`monthMatrix(ym)`, 6 semanas domingo→sábado) posicionando registros por um campo Data (`groupRowsByDate`), com seletor de campo e navegação de mês; (2) **Campo de Relação** — tipo `relation` em `DB_FIELD_TYPES` com `targetBaseId`: a célula vira um select dos registros da base-alvo, mostrados pelo rótulo do 1º campo (`recordLabel`), resolvido na galeria via `displayCell`. Helpers puros testados em `src/databases-deep.test.js`; calendário em `src/databases-calendar.test.jsx`. **Aprofundamento 1/4 (automações server-side) foi feito pelo CODEX no v110** (cron horário, dedup determinístico, snapshots + `automation_runs`); minha versão duplicada foi descartada no rebase. Corrigido de passagem o teste `product-events.worker.test.js` que travava o main (esperava `version: "v82"` fixo): agora `expect.stringMatching(/^v\d+$/)`, e `/api/status` foi para `v111`. **Coordenação CODEX/Claude**: os dois trabalham o repo em paralelo — pegar áreas distintas (Claude=frontend/bases, CODEX=backend) e sempre `git fetch`/rebasear antes do push. Próximos aprofundamentos: Gmail na Caixa de entrada, Documentos + mala direta.
- **Mala direta (mail merge) nos Documentos** (`MailMergeModal` + `Documents` em `src/App.jsx`; helpers em `src/domain.js`) — **aprofundamento 3/4 pedido ("Todos")**: botão "Mala direta" na página Documentos abre um modal que gera **um documento personalizado por registro** de uma fonte (Contatos ou qualquer base de "Meus dados"). Helpers puros (testados em `src/mailmerge.test.js`): `extractMergeFields(text)` (lista os `{{campos}}` únicos) e `applyMergeFields(text, values)` (substitui; campo sem valor vira vazio). O modal tem seletor de fonte, chips que inserem `{{campo}}` no modelo, título com campos e prévia do 1º registro. `mergeValuesFromBase(base, row, bases)` (usa `recordLabel` p/ relação e `formatCellValue`) e `mergeValuesFromContact(contact)` montam os valores. Gerar cria N documentos (`type: "Mala direta"`) em `db.documents`. Teste de UI em `src/mailmerge-ui.test.jsx`. Sem edição simultânea em tempo real (que exigiria infra paga).
- **Fórmulas nas bases** (`DataBases` em `src/App.jsx`; `evalFormula` em `src/domain.js`) — mais profundidade Notion/Airtable: novo tipo de campo `formula` em `DB_FIELD_TYPES`. `evalFormula(expr, values)` é um avaliador aritmético **seguro (sem `eval`)**, recursivo-descendente: suporta `+ − * / ( )`, números decimais e nomes de campos (inclusive com espaço) resolvidos pelos valores numéricos da linha (não numérico/desconhecido = 0; divisão por zero = 0; arredonda 2 casas). Testado em `src/formula.test.js` (vetores) e `src/formula-ui.test.jsx` (fluxo: cria campo Total = Quantidade * Preço, preenche a linha, confere o cálculo). No app: célula de fórmula é **somente leitura** (`.db-formula-cell`), computada por `formulaResult(f,row)` via `rowNumericValues`; `displayCell(f, row)` passou a receber a linha inteira (galeria/calendário atualizados) para resolver fórmula e relação. Modal de campo mostra input de fórmula + chips para inserir nomes de campos. **Gmail bidirecional na Caixa de entrada continua bloqueado por dependência externa da titular**: o `/api/auth/google` só valida ID token (identidade) — NÃO há fluxo OAuth de autorização, `GOOGLE_CLIENT_SECRET` nem escopo `gmail.readonly`/armazenamento de refresh token. Ler o Gmail exige a titular configurar o consent screen do Google Cloud com `gmail.readonly` + cadastrar `GOOGLE_CLIENT_SECRET` no cofre (documentar em PENDENCIAS quando for a vez). **Restantes** dependem de conta externa/decisão (Gmail/WhatsApp/voz/vídeo) ou são outra categoria de produto.
- **Gráficos nas planilhas** (`SheetChart` + `SheetBuilder` em `src/App.jsx`; `sheetChartSeries`/`parseBrNumber` em `src/domain.js`) — aprofundamento de Planilhas/dados: botão "Gráfico" na planilha abre um painel com seletor de coluna de **categorias** e de **valores**, e três tipos — **barras, linha, pizza** — renderizados em **SVG puro** (sem lib, componente de módulo `SheetChart`, paleta `CHART_COLORS`). `sheetChartSeries(columns, rows, labelIdx, valueIdx)` monta `[{label, value}]` ignorando linhas vazias; `parseBrNumber` lê o formato BR ("R$ 1.200,50" ⇒ 1200.5; "2.000" com pontos em grupos de 3 ⇒ 2000; vírgula = decimal). Testado em `src/sheetchart.test.js` (vetores) e `src/sheetchart-ui.test.jsx` (abre planilha salva, abre o gráfico, confere 3 barras no SVG). **Fila verde de aprofundamentos gratuitos** (sem dependência externa, próximos candidatos): rollups nas bases, biblioteca de respostas de e-mail, formulários ligados a base, índice automático nos documentos, fluxogramas por IA, comparar modelos de IA na tela, sessões/dispositivos + revogação. O restante do inventário integral depende de conta externa (omnichannel: WhatsApp/Gmail/Instagram/Slack/SMS/telefonia; pesquisa web ao vivo; TTS/vídeo) ou é outra categoria de produto (vídeo/áudio em tempo real, cursores simultâneos, IDE, RPA, apps móveis).
- **Memória da IA + busca por significado** (`src/features/knowledge/memoryDomain.js`, `searchDomain.js` + `KnowledgeCenter.jsx`, lazy) — coleções `memories` e `glossary`; blocos 3 e 4 da segunda lista. **Memória**: escopo (`pessoal|empresa|projeto|cliente|especialista`) com `scopeRef`, e `relevantMemories` **nunca vaza** memória de projeto/cliente/especialista fora do contexto correspondente nem devolve memória `approved: false`. `detectSensitive` (CPF, CNPJ, cartão, senha, conta, saúde) faz a memória **nascer pendente**, e `makeMemory` marca `approved: false` — aprovação é da titular. `findConflicts` separa **contradição de repetição** comparando negação (`não/nunca/sem/exceto`) sobre pares de alta similaridade Jaccard, e só compara dentro do mesmo escopo+scopeRef. `isStale` avisa memória vencida mas **nada é apagado sozinho**. `suggestMemories` só extrai frases com gatilho declarativo e nunca inventa texto. **Busca**: `stem` é um radical simples de pt-BR (plural, `-mento`, `-ção`, `-ais`) que faz "clientes" achar "cliente"; `expandWithSynonyms` usa o glossário da empresa e é o que mais aproxima de busca semântica **sem vetor nenhum**; `scoreDocuments` é BM25 com `titleBoost` de 3. `buildIndex` **respeita visibilidade**: item `privado` de outro `ownerId` não entra no índice — a busca não pode ser um vazamento. `buildAnswerPrompt` obriga citação `[n]` e manda dizer "Não encontrei essa informação no seu workspace." em vez de completar com conhecimento geral. **Decisão consciente**: embeddings + banco vetorial seriam pagos; o caminho escolhido (radical + glossário + BM25) resolve o caso de um negócio pequeno sem custo, e isso está declarado em `PENDENCIAS_DA_TITULAR.md`. Testado em `src/knowledge-domain.test.js` (56) e `src/knowledge-ui.test.jsx` (11).
- **Captura em linguagem natural + agendamento inteligente** (`src/features/planner/plannerDomain.js` + `src/features/planner/DayPlanner.jsx`, lazy) — blocos 7 e 8 da segunda lista. `parseTaskInput(texto, {today, projects})` devolve `{title, due, time, durationMinutes, priority, project, assignee, recurrence, understood}` e **remove do título tudo o que consumiu**. **Três armadilhas resolvidas, todas pegas por teste**: (1) **`\b` não cria fronteira ao lado de letra acentuada** — `/\bamanh[ãa]\b/` nunca casa; usar `(?![\p{L}])` no fim. O mesmo vale para "às" no começo, daí `(?<![\p{L}\p{N}])`. (2) A **hora precisa ser lida antes da duração**: se a duração vier primeiro, "às 15h" é consumido como "15 horas de duração". (3) A forma só-horas da duração exige "por/durante" — "2h" solto é ambíguo com horário; "30min" e "1h30" são inequívocos. A recorrência é lida **antes** da data, senão "toda sexta" viraria data única. Data impossível (31/02) é recusada e o rótulo "data" sai de `understood`. No agendamento: `freeSlots` respeita jornada, dias úteis e almoço; `autoSchedule` ordena por prazo e depois prioridade, **nunca agenda depois do prazo**, respeita `time` fixo só quando cabe, e devolve `unplaced` com motivo — dizer "não cabe" é entrega, não erro. Cuidado ao testar: uma tarefa de 480 min **não cabe em nenhum dia** com almoço partindo a jornada (as vagas são 180 e 300 min). `dayLoad` desconta o almoço da capacidade. Testado em `src/planner-domain.test.js` (50) e `src/planner-ui.test.jsx` (9).
- **Quadro rápido / whiteboard** (`src/features/whiteboard/whiteboardDomain.js` + `src/features/whiteboard/QuickWhiteboard.jsx`, lazy) — coleção `whiteboards`, itens 32–33. `simplifyStroke` é Ramer–Douglas–Peucker (traço de mouse vira centenas de pontos inúteis sem isso). **Dois erros de algoritmo corrigidos pelos testes, que valem memória**: (1) `countCorners` precisa contar de forma **cíclica** em traço fechado — sem isso o canto que fica no ponto de partida nunca é medido e um retângulo aparece com 3 cantos, virando triângulo; daí o parâmetro `{closed}`. (2) Em `recognizeShape` a ordem importa: **cantos são testados antes do erro de elipse**, porque o retângulo tem erro de elipse baixo o bastante para ser classificado como elipse se a elipse vier primeiro. `totalTurning` é o portão contra rabisco: forma simples fecha em ~360°, rabisco passa de 540° e a função devolve `null` — **preferir null a chutar**, porque a UI substitui o traço pela forma e um chute errado apaga o desenho da pessoa. `applyRuler` encaixa em múltiplos de 15° preservando o comprimento. `eraseAt` usa `pointToSegment` (distância ao segmento, não à reta infinita) para apagar por proximidade real. `toggleReaction` só aceita emoji de `REACTIONS` e remove a chave quando fica vazia. Testado em `src/whiteboard-domain.test.js` (46) e `src/whiteboard-ui.test.jsx` (9). **Limites declarados na interface, não só aqui**: reconhecimento de escrita à mão exigiria OCR pago; edição simultânea exigiria infraestrutura em tempo real cobrada à parte (Durable Objects).
- **Diagramas técnicos** (`src/features/diagrams/diagramDomain.js` + `src/features/diagrams/DiagramStudio.jsx`, lazy) — coleção `diagrams`, itens 26–31. `SHAPE_LIBRARY` tem 26 formas em 7 categorias, cada uma com `kind` (como desenhar) e `bpmn` opcional (`start|end|task|gateway`) que alimenta a validação. `nearestAnchors` testa os 16 pares de lados e escolhe o mais curto — é isso que faz o conector grudar e se reposicionar sozinho; `orthogonalRoute` devolve cotovelo e **nunca diagonal** (há teste que verifica trecho por trecho). `findCycles` é DFS com pilha de recursão e **normaliza a chave do ciclo** para não relatar o mesmo duas vezes; `findDisconnectedGroups` percorre o grafo **sem direção** (ilhas). `validateBpmn` só roda se houver forma BPMN no diagrama, e cobre: sem início, sem fim, início com entrada, início sem saída, fim com saída, fim sem entrada, gateway com menos de dois ramos, tarefa inalcançável. `orgChartFromRows` posiciona por nível e **não entra em laço** quando alguém responde a si mesmo (conjunto de visitados na recursão). `snapToGrid` cai na grade padrão se receber grade 0, em vez de dividir por zero. **Bug corrigido pelos testes**: `fromCsv` dividia a linha por `split(";")` e corrompia campo entre aspas contendo `;` — agora usa `csvFields`, um parser que respeita aspas e aspas duplicadas. `toSvg` remove `<>&` do texto para não gerar XML inválido e ignora conector com ponta inexistente. **Limite declarado na própria interface**: VSDX (Visio) e Draw.io não são lidos — são formatos proprietários compactados, e um leitor que falha em silêncio é pior que a ausência dele. Testado em `src/diagram-domain.test.js` (62) e `src/diagram-ui.test.jsx` (12).
- **Quadro visual / canvas** (`src/features/canvas/canvasDomain.js` + `src/features/canvas/CanvasBoard.jsx`, lazy) — coleção `boards`, itens 19–25. `screenToCanvas`/`canvasToScreen` são **inversas exatas** (há teste de ida e volta) e `zoomAt` reposiciona a visão para manter fixo o ponto sob o cursor — sem isso o quadro escorrega ao dar zoom. `clampZoom` limita a 0,2–4. `fitView` centraliza o conteúdo no viewport. `elementsInFrame` exige **contenção total** (elemento que começa dentro e termina fora não conta) e nunca inclui outras áreas nem a si mesma. `clusterByProximity` agrupa post-its **em cadeia** por distância entre centros (a perto de b, b perto de c → um grupo só), ignorando o que não é post-it. `toggleVote` é idempotente por pessoa (votar de novo desfaz) e ignora votante sem id. `timerState` é puro: **recebe o instante atual** em vez de olhar o relógio, e a UI só fornece o tick via `setInterval`. `BOARD_TEMPLATES` recebe um gerador de id e devolve elementos; todos testados por unicidade de id. `parseBoardGroups` lê "Tema: X" tolerando markdown e descarta tema sem itens. Testado em `src/canvas-domain.test.js` (47) e `src/canvas-ui.test.jsx` (10). Nos testes de interface: "Quadro" e o nome do modelo aparecem em mais de um lugar (menu, seletor, campo de nome) — escopar por `.cvs`/`getByLabelText`, nunca `findByText` solto.
- **PWA em web, tablet e iPhone** — um único código serve os três; `display: standalone` + `apple-mobile-web-app-capable` fazem o iPhone abrir em tela cheia quando instalado pela Tela de Início. **Não é app de loja**: App Store exigiria a conta Apple paga, e push no iOS só funciona depois de instalado na Tela de Início. Atualização é imediata em todas as superfícies: o Service Worker busca HTML com `cache: no-store` e chama `skipWaiting` + `clients.claim()`. O manifest estava com `orientation: "portrait-primary"`, que travava tablet em retrato — corrigido para `"any"`.
- **Reuniões: transcrição, ata e ações** (`src/features/meetings/meetingDomain.js` + `src/features/meetings/Meetings.jsx`, lazy; `handleTranscribe` em `worker.js`) — coleção `meetings`, itens 14–18 do inventário. Captura no navegador via `MediaRecorder`; a transcrição vai em base64 para `/api/transcribe`, que roda `@cf/openai/whisper` no **Workers AI já existente** (gratuidade preservada, nada de serviço pago) e **não armazena o áudio**; teto de 8 MB de base64 por envio e erro do modelo nunca vaza detalhe interno na resposta. `parseTranscript` estrutura "Nome: fala" e "[01:20] Nome: fala"; o rótulo de participante é aceito só com **até 3 palavras e sem pontuação de fim de frase** — sem isso, "Ficou decidido o seguinte: ..." era lido como participante. Linha sem rótulo é continuação da fala anterior. `speakerStats` dá turnos e percentual; `renameSpeaker` corrige o nome em toda a transcrição (Whisper erra nome próprio). `buildMinutesPrompt` é puro e testado, e inclui "Não invente decisões, prazos ou responsáveis". `parseMinutes` tolera markdown (`##`, `**`), maiúsculas, falta de acento e aceita "Ações" como sinônimo de Tarefas. `parseActionItem` lê "o que — quem — DD/MM" e "(quem, DD/MM)"; o prefixo `respons[áa]vel|resp\.?` precisa ter a alternativa **longa antes da curta**, senão "Responsável: Ana" virava "onsável: Ana". `actionDueDate` usa o ano da reunião quando o prazo não traz ano e **rejeita data impossível** (31/02). `minutesToTasks` filtra título sem letra nem número, para um travessão solto não virar tarefa. Testado em `src/meeting-domain.test.js` (36), `src/meetings-ui.test.jsx` (8) e `test/transcribe.worker.test.js` (9). **Limite honesto**: gravar Meet/Teams/Zoom de dentro da chamada (item 14) exige app aprovado nas plataformas — o que existe é gravar o áudio da sala/microfone e enviar arquivo.
- **Resultado do mês** (`src/features/finance/statementDomain.js` + `src/features/finance/MonthlyStatement.jsx`, lazy) — DRE simples sobre o livro-caixa, sem coleção nova: lê `transactions` e `bills`. `monthResult` devolve receita/despesa/resultado e **`margem: null` quando não há receita** (não 0% — a UI mostra travessão); `compareMonths` devolve **`pct: null` quando o mês anterior era zero**, porque crescer a partir de zero não é percentual — a UI escreve "sem base anterior". `monthSeries` vai do mês mais antigo para o mais recente (ordem de leitura de gráfico); `shiftMonth` usa aritmética de meses absolutos e vira o ano nos dois sentidos. `categoryBreakdown` agrupa com fatia e "Sem categoria" para vazios; `cashVersusAccrual` cruza o que moveu no caixa com o que venceu (por `dueDate` das contas) — a diferença é o que ficou para receber; `averageMonthlyResult` só divide pelos meses **com movimento**, para a média não ser diluída por meses vazios. Reusa `parseBrNumber`. Testado em `src/statement-domain.test.js` (21) e `src/statement-ui.test.jsx` (8). Nos testes de interface, escopar por `.stmt-cards article` e usar `getAllByText` para variações percentuais: receita e resultado costumam variar a mesma porcentagem.
- **Funil de vendas** (`src/features/crm/pipelineDomain.js` + `src/features/crm/SalesPipeline.jsx`, lazy) — coleções `opportunities` e `salesPipeline`. Aprofundamento do CRM (item 12): o CRM antigo guarda leads com etapa de texto fixa, sem probabilidade nem previsão. Aqui a etapa tem `probability` e `won`/`lost`, e `weightedValue` = valor × probabilidade — a previsão ponderada em vez da soma otimista. `opportunityProbability` deixa a oportunidade sobrescrever a etapa (limitada a 0–100). `conversionRates` calcula passagem etapa→etapa contando quem está numa posição **igual ou posterior** na ordem (quem avançou já passou pelas anteriores). `averageSalesCycle` só conta ganhas **com `closedAt`** preenchido; a UI grava `closedAt` automaticamente ao entrar numa etapa `won`/`lost` e limpa ao voltar para etapa aberta. `daysInStage` lê da última entrada de `stageHistory` (`moveStage` registra cada mudança) e alimenta `stalledOpportunities` — o aviso de negócio esquecido. `forecastByMonth` agrupa pela `expectedCloseDate` e vira o ano corretamente; `lossBreakdown` agrupa motivos com "Não informado" para os vazios. Reusa `parseBrNumber`. Testado em `src/pipeline-domain.test.js` (29) e `src/pipeline-ui.test.jsx` (7).
- **Contas a receber e a pagar** (`src/features/finance/billsDomain.js` + `src/features/finance/Bills.jsx`, lazy) — coleção `bills`. Preenche a lacuna real do Financeiro: o módulo antigo é um **livro-caixa** (só dinheiro já movimentado, sem vencimento nem status); este trata do dinheiro combinado e não recebido. `billStatus` → `quitada | atrasada | vence-hoje | a-vencer | sem-data` com contagem de dias e singular/plural correto; suporta **pagamento parcial** (`payments[]`, `billOpenAmount` nunca negativo, `registerPayment` nunca aceita mais que o saldo). `agingBuckets` faz inadimplência por faixa; `cashFlowForecast` projeta por semana e joga **as atrasadas na primeira semana** (o dinheiro ainda é esperado); `upcomingBills` ordena da mais atrasada para a mais distante. `nextRecurrence` gera a conta mensal seguinte e **ajusta o dia quando o mês é mais curto** (31/01 → 28/02). **Integração que importa**: `paymentToTransaction` faz a baixa lançar no livro-caixa como Receita/Despesa — Financeiro e Contas nunca divergem; a UI grava a conta atualizada E a transação na mesma chamada de `update`. Reusa `parseBrNumber` de `src/domain.js` em vez de um segundo parser de número BR (a primeira versão tinha o seu, e quebrava em "1.250,50"). Testado em `src/bills-domain.test.js` (35) e `src/bills-ui.test.jsx` (6).
- **Metas e OKRs** (`src/features/goals/goalsDomain.js` + `src/features/goals/Goals.jsx`, lazy) — categoria inteira que faltava (item 3 do inventário da titular). Coleção `objectives` no workspace. `keyResultProgress` cobre 4 tipos (`numero` com start→target→current e unidade, `percentual`, `marco`, `tarefas` automático) e trata **meta decrescente** (start 100 → target 60 conta progresso ao cair). `objectiveProgress` faz média **ponderada** por `weight`. `cycleRange` devolve o período do ciclo (mensal/trimestral civil/anual) e `cycleElapsed` quanto dele já passou; `goalStatus` compara progresso × tempo decorrido com tolerância de 10 pontos → `concluida | no-prazo | atencao | risco | encerrada`, e a barra do cartão marca visualmente onde a meta deveria estar. `resolveAutoProgress(objective, {tasks})` resolve os KRs do tipo `tarefas` a partir do projeto ligado — as contagens são **derivadas, nunca gravadas** (só o `history` volta ao banco). `appendProgressPoint` dedupa por dia e substitui o ponto quando o progresso muda no mesmo dia. **Cuidado herdado**: o helper `num()` precisa devolver o fallback para `""`/null/undefined — a primeira versão devolvia 0 e zerava todos os pesos, o que zerava o progresso de tudo. Testado em `src/goals-domain.test.js` (27) e `src/goals-ui.test.jsx` (5). Nos testes de interface, escopar as asserções de porcentagem ao `.goal-card`: o mesmo "50%" aparece no cartão e no resumo do topo.
- **Assinatura eletrônica de documentos** (`normalizeForSigning`, `documentFingerprint`, `signatureCode`, `makeSignature`, `verifySignature`, `signatureStatus`, `signatureBlockText` em `src/domain.js`; `SignaturePad`, `SignDocumentModal`, `SignatureList` em `src/App.jsx`) — assinatura eletrônica **simples** (Lei 14.063/2020), sem serviço externo e sem custo. O documento ganha `signatures: []`; cada assinatura guarda assinante, papel, e-mail, data/hora, a impressão digital do texto (FNV-1a + djb2 combinados, 16 hexa, determinística e síncrona) e um código legível `SF-XXXX-XXXX`. `normalizeForSigning` ignora fim de linha e espaço no fim da linha, para que só mudança real invalide. `verifySignature` compara a impressão digital atual com a assinada e devolve `{valid, reason: "ok"|"alterado"|"invalida", message}`; o cartão do documento mostra "Assinado (n)" ou "Alterado após assinar". `signatureBlockText` é anexado às exportações PDF/DOCX/TXT com o aviso de que **não substitui certificado ICP-Brasil** quando a lei exigir — não vender isso como assinatura qualificada. O `SignaturePad` desenha com mouse/toque e degrada com elegância (canvas ausente no jsdom): assinar pelo nome digitado continua valendo, por isso os testes de interface não dependem de canvas. Testado em `src/doc-signature.test.js` (17) e `src/doc-signature-ui.test.jsx` (3).
- **Biblioteca de respostas de e-mail** (`EMAIL_TEMPLATES` em `src/domain.js`; usada no `EmailComposer` em `src/App.jsx`) — item da fila verde: catálogo curado de modelos de e-mail (boas-vindas, follow-up, agradecimento, cobrança, orçamento, reagendamento) com campos entre `[COLCHETES]` para completar (mesmo padrão de `DOCUMENT_TEMPLATES`). No `EmailComposer`, um seletor "Usar um modelo pronto" preenche assunto+corpo ao escolher. Testado em `src/email-templates.test.js`. Espelha os modelos de WhatsApp, agora para e-mail. **Decisões da titular autorizadas** ("ok pra tudo q depende da minha decisão"): as integrações que dependem de credenciais/consentimento dela (Gmail readonly + `GOOGLE_CLIENT_SECRET`; WhatsApp Cloud API + `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID`; busca web + `SEARCH_API_KEY`) estão detalhadas em `PENDENCIAS_DA_TITULAR.md` (seção "Integrações que você autorizou"). O código só liga quando os segredos existirem no cofre — a sessão não tem acesso ao cofre/consoles, então o passo dela é pré-requisito (padrão VAPID).
- **Colaboração em equipe** (ver `worker.js` e `src/App.jsx`, componente `Collaborators`/`Team`): convite real por e-mail com ativação (`/api/collab/invite*`, `/api/collab/join`, migração `0010_team_invites.sql`); três papéis (`admin`/`gestor`/`colaborador`, `VALID_ROLES`) — todos os papéis acessam TODAS as ferramentas, o controle é sobre os DADOS, nunca sobre o acesso à tela
  - **Visibilidade de dados**: `canSeeTask(record, userId, ctx)` em `worker.js` é o predicado único de leitura — checa `ownerId`, `assigneeId`, `assignees[]`, `sharedWith[]`, `visibility === "espaco_todo"`, `interested[]`, `sharedTeams[]` (equipe) e `visibility === "projeto"` + `project` (ctx.projects, calculado a partir das tarefas do usuário). `RESTRICTED_FIELDS` aplica esse filtro no GET/PUT de `/api/workspace` a tarefas, CRM/contatos, documentos, sites, desenvolvimento, notificações, financeiro, agenda, catálogo, frota, conversas, rascunhos, horas, histórico, certificados e mídia. Registro legado sem `ownerId` **não é público automaticamente**: só fica visível quando houver atribuição ou compartilhamento explícito. Formulários operacionais podem escolher `visibility: "espaco_todo"` como padrão quando o dado realmente pertence ao espaço.
  - **Visualizar e editar são permissões diferentes**: `canEditRecord(record, userId, ctx)` exige propriedade, `editors[]` explícito ou compartilhamento com `sharingPermission: "editar"`. O `SharingFields` permite escolher “Somente visualizar” ou “Pode visualizar e editar”. `mergeRecordsFromMember` preserva integralmente registros apenas visíveis, aplica `sanitizeTaskParticipation` às interações legítimas de participantes (interesse, checklist e entrega própria) e atribui `ownerId` + visibilidade privada a registros novos do colaborador. Campos administrativos de topo em `OWNER_ONLY_TOP_LEVEL_FIELDS` nunca são aceitos de gestor/colaborador. Autoatribuição/interesse em missão usa `POST /api/tasks/action`, com revisão condicional atômica; não reimplementar esse fluxo como PUT comum.
  - **Sites/leads públicos são autorizados por registro, não só por pertencer ao espaço**: `public_sites`/`public_site_leads` vivem fora do `RESTRICTED_FIELDS` (tabelas D1 próprias); `canManageSite(env, actorId, ownerId, siteId)` em `worker.js` é o gate usado por `handleSites` (publish/unpublish/delete/leads) — dono do espaço ou papel `admin` sempre pode, e qualquer outro membro precisa passar por `canEditRecord`; acesso somente para visualizar nunca permite publicar, apagar ou ler leads.
  - **`/api/collab` aceita `?owner=` para quem é `admin` convidado administrar o espaço ativo**: fora de "leave", toda ação POST calcula `scopeOwnerId` (`?owner=` ou o próprio `user.id`) e, se for de outro dono, exige `membershipRole(...) === "admin"`; senão 403. O GET base (`Collaborators`) devolve `canManage` no payload — o frontend usa isso para mostrar convites reais e habilitar os botões de administração só quando a pessoa realmente pode agir naquele espaço (ver `collabQuery` em `Collaborators`).
  - **Token de convite fica hasheado (sha256), nunca em texto puro**: `invites.token` guarda `sha256(token)` — o token bruto só existe no link do e-mail. Toda consulta (`invite-info`, `invite/accept`) hasheia o token recebido antes de comparar. Cancelar um convite faz `UPDATE ... SET status = 'cancelado'` (mantém o registro para auditoria), nunca `DELETE`.
  - **Equipes e projetos**: `db.teams` (grupos de colaboradores, gerenciados só pelo dono, protegidos contra alteração por papel restrito no PUT) e `db.projects` (nomes de projeto criados com antecedência); componente `SharingFields` é o seletor de visibilidade reutilizável — usado em Tarefas, CRM, Documentos, Sites, Agendamentos, Catálogo (Produtos e Pedidos) e Frota (Veículos e Fretes) — sempre usar esse componente em vez de recriar o seletor
  - **Missões e gamificação**: tarefa com `isMission: true` ganha vagas/pontos/recompensa/subtarefas/entrega-e-revisão; `computeUserPoints`/`levelForPoints`/`computeAchievements`/`levelProgress` (funções puras em `src/App.jsx`) calculam pontos, nível, progresso até o próximo nível e conquistas a partir de `db.tasks` — nada fica persistido, é sempre recalculado
  - **Dependência entre tarefas**: campo `dependsOn` (array de ids); `isBlocked`/`blockingTasks` no componente `Tasks` bloqueiam concluir, entregar ou assumir enquanto a dependência não estiver "Concluído" — essa checagem também vale ao arrastar um cartão no quadro Kanban (drag-and-drop chama a mesma `changeTaskStatus`, não existe um caminho alternativo que ignore o bloqueio)
  - **Tarefas recorrentes**: campo `task.recurrence.frequency` (`none`/`weekly`/`monthly`); `nextRecurrenceDue(ymd, frequency)` (função pura) calcula o próximo prazo; `changeTaskStatus` cria a próxima ocorrência automaticamente ao concluir uma tarefa recorrente (nova tarefa com `status: "A fazer"`, sem herdar `deliveries`/`attachments` da anterior)
  - **Anexos em tarefas e entregas**: `task.attachments` e `delivery.attachments` (array, até 5 itens via `MAX_ATTACHMENTS_PER_ITEM`); `buildAttachment(file)` decide entre imagem (`compressImageForAttachment` — redimensiona e comprime para JPEG no navegador via canvas, até `MAX_ATTACHMENT_IMAGE_BYTES`) ou documento (reaproveita `extractDocumentText` e guarda só o texto extraído, até `MAX_ATTACHMENT_TEXT_CHARS`). **Nunca guardar o arquivo bruto no workspace** — o blob sincronizado tem limite de tamanho (ver aviso em Configurações); por isso tudo aqui passa por compressão ou extração de texto antes de entrar em `db`
  - **Visão de calendário de tarefas**: view `"calendario"` em Tarefas (ao lado de Quadro/Lista/Disponíveis); `buildTaskCalendar(yearMonth, tasks)` (função pura) monta o grid mensal agrupando por `task.due`; `shiftYearMonth`/`todayYearMonth` cuidam da navegação de mês
  - **Ações em lote**: na view Lista, cada tarefa tem uma checkbox (`selectedIds`); barra de ações aparece com >=1 selecionada para arquivar, desarquivar ou reatribuir todas de uma vez — implementado só na Lista de propósito (no Kanban o gesto de arrastar já ocupa o clique no cartão)
  - **Auditoria**: tabela `audit_log` (migração `0011_audit_log.sql`), `logAudit()` grava ações administrativas (convite, papel, suspensão...), consultável só pelo dono via `/api/collab/audit`
  - **Notificações in-app**: `pushNotification()` empurra para `db.notifications` (também é um `RESTRICTED_FIELD`, usa `assigneeId` como destinatário); sino no topo do app
  - **Busca global**: campo de busca (Ctrl/Cmd+K) indexa dados reais (tarefas, leads, documentos, contatos, produtos, sites...), não só nomes de seção
  - **Erros técnicos**: cliente reporta falhas para `POST /api/errors` (sem exigir login) desde o `ErrorBoundary`/handlers globais em `src/main.jsx`; `GET /api/errors` (exige sessão) devolve só os erros do próprio usuário logado, consultável em Configurações → "Erros técnicos"
  - **Modal com armadilha de foco**: componente `Modal` (`src/App.jsx`) prende o Tab dentro do diálogo, foca o primeiro elemento focável ao abrir (respeitando um `autoFocus` de algum campo filho) e devolve o foco a quem abriu ao fechar — todos os modais do app usam esse componente, então a correção vale para todos de uma vez
  - **Login tem limite de tentativas por conta, além do limite por IP**: `allowed(`auth-account:${email}`, 8)` em `handleAuth`/`/api/auth/login` — fecha a lacuna de força bruta distribuída entre vários IPs contra uma conta específica. O limite por IP (`allowed(`auth:${ip}`)`) continua valendo para todas as rotas de `/api/auth/*`.
  - **Notificações Web Push**: usa `@block65/webcrypto-web-push` (só Web Crypto API, compatível com Workers — não usar `web-push` do npm, que depende de `node:crypto`). `push_subscriptions` (migração `0012_push_subscriptions.sql`) guarda `endpoint`/`p256dh`/`auth` por usuário; `/api/push/subscribe` e `/api/push/unsubscribe` (exigem sessão) gerenciam a assinatura; `/api/config` expõe `vapidPublicKey` quando `pushEnabled(env)` é verdadeiro. `handleWorkspace` compara `notifications` antes/depois de cada PUT (`notifyNewNotifications`) e envia push só para notificações genuinamente novas (por `id`), para o `assigneeId` — uma assinatura que responde 404/410 é apagada automaticamente. Frontend: toggle em Configurações → "Notificações do navegador" (`AccountSettings`), usa `urlBase64ToUint8Array` para converter a chave VAPID; `sw.js` tem os handlers `push`/`notificationclick`, que reenviam o clique para a aba aberta via `postMessage` → evento `sf-push-navigate` (ouvido no topo de `App`, fora de qualquer `return` condicional — **hooks do componente `App` só podem ficar antes dos primeiros `if (...) return`**, ver `if (!db.user) return <Login />` etc.)
  - **Verificação visual real**: testes automatizados (`npm test`) rodam em jsdom, que não tem motor de CSS/layout real nem `canvas`/`Image` funcionais — para qualquer mudança visual (CSS, drag-and-drop, canvas de compressão de imagem) vale a pena rodar um script Playwright manual (Chromium em `/opt/pw-browsers/chromium`, pacote em `/opt/node22/lib/node_modules/playwright`) além dos testes, porque jsdom já deixou passar bugs visuais reais nesta sessão
  - **Falha de sincronização é visível, nunca silenciosa**: `useDatabase` (`src/App.jsx`) expõe `syncError`/`retrySync`/`logoutFromExpiredSession` além de `syncing`. `performSync` (a função que faz o PUT em `/api/workspace`) trata cada desfecho: 409 vira `workspaceConflict` (já existia); 401 vira banner "Sua sessão expirou" com botão para relogar sem apagar os dados locais (`logoutFromExpiredSession` só limpa o token, não o `db`); qualquer outro erro (500, 429, offline — inclusive exceção lançada pelo `fetch`) vira banner "Suas alterações não foram salvas" com botão "Tentar agora" (`retrySync`), que só limpa quando uma sincronização seguinte realmente for bem-sucedida. Antes disso, qualquer falha fora do 409 era engolida em silêncio (`if (!response.ok) return;`) — sessões de 30 dias (`createSession`) tornam isso um risco real de perda de dados percebida, não hipotético. Ao mexer nesse hook, manter essa cobertura: todo caminho de falha do PUT precisa acabar em algum estado visível.
  - **DAS do MEI**: `db.taxProfile` (`{ isMEI, dueDay, cnpj, dasHistory }`, dasHistory = `"AAAA-MM" → { paid, paidAt }`). Painel no Financeiro (`#finance-das`): toggle "Sou MEI", status do mês (`dasStatus` — função pura), marcar meses como pagos, link para o portal oficial. `buildDasReminder` (pura, testada) gera UMA notificação por mês+tipo (`das-AAAA-MM-lembrete` a partir de 5 dias antes; `das-AAAA-MM-atrasado` depois do vencimento), idempotente pelo id. O efeito que a dispara em `App` roda só no espaço do próprio dono (`if (activeSpaceId()) return`) e o destinatário é sempre `db.user.id` — o Web Push já reaproveita `db.notifications`. `taxProfile` é campo de topo (não entra em `RESTRICTED_FIELDS`, que é para arrays filtrados por `canSeeTask`).
  - **Modelos de WhatsApp**: `db.waTemplates` (array `{ id, name, category, body }`) com fallback para `DEFAULT_WA_TEMPLATES` quando vazio — usuários antigos veem os padrões sem migração. `fillWhatsappTemplate(body, vars)` (pura) troca `{{chave}}` pelo valor ou por `[chave]` quando falta. Envio: hook `useWhatsappSender({ db, setToast })` → `open({ phone, category, vars })` abre o `WhatsappSendModal` (escolhe modelo, preenche variáveis do registro, edita e abre o `wa.me`); cada página que envia instancia o hook e renderiza `{wa.modal}`. Já ligado em CRM (leads), Contatos, Catálogo (pedidos) e Agendamentos. Gerência (CRUD + "Restaurar padrão") fica em Ferramentas (`#wa-templates`, `ToolsHub`). **Não** trocar por API paga do WhatsApp Business — a regra de gratuidade proíbe, e o `wa.me` cobre o caso sem credenciais.
- **Resumo semanal por push**: prova de valor recorrente entregue por Web Push **mesmo com o app fechado**. `computeWeeklySummary(data, start, end)` (pura: vendas/caixa/tarefas + `tasksReward` somando as recompensas das concluídas/novos contatos) existe em DUAS cópias sincronizadas: `src/App.jsx` (card "Sua semana" no Dashboard, `#week-summary`, mostra a semana atual — com estado vazio convidativo via `hasActivity` em vez de parede de zeros) e `worker.js` (envia o push). O envio é um **Cloudflare Cron Trigger** (`wrangler.jsonc` → `triggers.crons: ["0 12 * * 1"]`, segunda 12:00 UTC / 09:00 BRT) que dispara `export default { scheduled }` → `sendWeeklySummaries(env, now)`: itera `workspaces`, computa a semana ANTERIOR (`previousWeekBounds`), e para cada dono com atividade e assinatura ativa reserva a semana em `weekly_summary_log` (migração `0013`, `INSERT OR IGNORE` checando `meta.changes` — o Cron é "pelo menos uma vez", isso impede push duplicado) e manda o push (`link: "inicio"`); assinatura 404/410 é apagada. Semana = segunda–domingo (`weekRangeFrom`). Ao mexer na fórmula, **atualizar as duas cópias juntas** (há testes cobrindo ambas). O push server-side não escreve em `db.notifications` (evita conflito de revisão) — o card no Dashboard é a superfície in-app.
  - **Automações server-side**: além da contingência ao abrir o app, o cron `0 * * * *` chama `runScheduledAutomations()` de hora em hora, usando o dia de São Paulo. Cria tarefas/lembretes com IDs determinísticos por regra+período, marca `rule.history`, protege o PUT por `revision`, salva snapshot antes da mudança, registra cada execução em `automation_runs` (migração `0018`) e envia Web Push quando configurado. Não voltar a depender só do navegador para regras agendadas.
  - **Ativação e retenção V81**: o Dashboard tem “Foco de hoje” (`nextBestAction`) e meta semanal; contas novas recebem onboarding de negócio apenas uma vez, enquanto contas existentes entram direto. Chat oferece ações confirmáveis para criar documento/tarefa. Contatos importam CSV e Financeiro importa CSV/OFX. Métricas minimizadas ficam em `product_events` (migração `0014`) via `/api/events`, sem conteúdo de documentos, chats ou cadastros.
  - **Contexto seguro da IA**: o cliente envia apenas `workspaceOwnerId`/`businessId`; `resolveAiWorkspaceContext` carrega e filtra no backend os dados realmente autorizados. Nunca confiar em `body.business`, `customSpecialist` ou outro contexto sensível enviado pelo navegador.
  - **Operação e parceria**: `/api/status` expõe somente saúde básica e versão; Configurações oferece diagnóstico sem conteúdo e canal de suporte. Planos de piloto, operação e incidentes/LGPD ficam em `docs/`. A definição de público-alvo permanece deliberadamente em aberto; não fixá-la sem decisão da titular.

- **Motor de projetos enterprise (v118)**: a lógica pura vive em
  `src/features/projects/projectDomain.js`. Projetos mantêm compatibilidade com
  o campo histórico `task.project`, mas tarefas novas também gravam
  `task.projectId`. `createProjectRecord` normaliza governança, orçamento,
  horas, datas e marcos; `projectMetrics` calcula progresso, saúde, atrasos,
  variações e próximos marcos sem persistir valores derivados. Riscos,
  problemas, decisões e mudanças ficam dentro do projeto neste estágio. Não
  duplicar esses cálculos no JSX.
- **Cronograma enterprise (v119)**: a lógica pura está em
  `src/features/projects/scheduleDomain.js`. `buildProjectSchedule` usa o grafo
  de `dependsOn`, duração em dias úteis, calendário e feriados do projeto para
  calcular início/fim, ciclos, folga e caminho crítico. A ação "Aplicar
  reprogramação" atualiza `startDate`/`due`, preservando
  `baselineStart`/`baselineDue`. Não substituir por barras baseadas apenas em
  datas digitadas; o Gantt precisa continuar derivado do grafo.
- **Banco de dados relacional (v120)**: relações, lookup, rollup, limpeza de
  referências e estrutura de registro-página vivem em
  `src/features/databases/relational.js`. O formato antigo de relação com um
  único ID continua aceito; relações novas podem persistir arrays e sincronizar
  um `reciprocalFieldId`. Cada linha pode conter `content`, `attachments`,
  `comments`, `createdAt` e `updatedAt`, sem deixar de funcionar nas views
  existentes. Não duplicar os cálculos relacionais no JSX e não transformar
  dados calculados de lookup/rollup em células persistidas.
- **Processos e formulários (v121)**: a lógica pura fica em
  `src/features/processes/processDomain.js` e a interface lazy em
  `src/features/processes/ProcessStudio.jsx`. Definições (`processes`), casos
  (`processCases`) e respostas (`formResponses`) são coleções distintas e
  protegidas por visibilidade no worker. O processo deve funcionar sem conexão;
  `connections.baseId` e `connections.createTask` são integrações opcionais.
  Movimentações usam `transitionProcessCase`, que preserva sequência,
  obrigatoriedade, aprovação, SLA e histórico. Não movimentar casos alterando
  apenas `stageId` no JSX.
- **Capacidade e recursos (v122)**: cálculos puros ficam em
  `src/features/resources/capacityDomain.js` e a interface lazy em
  `src/features/resources/CapacityPlanner.jsx`. Perfis (`resourceProfiles`),
  ausências (`resourceAbsences`) e alocações (`resourceAllocations`) funcionam
  independentemente. Vínculos a `projects` e `timeEntries` são opcionais.
  Disponibilidade, carga, utilização, sobrecarga, custo, receita e margem são
  valores derivados e não devem ser persistidos nem recalculados no JSX.
- **Precificação e impacto (v123)**: lógica pura em
  `src/features/pricing/pricingImpactDomain.js` e interface lazy em
  `src/features/pricing/PricingImpactStudio.jsx`. Modelos (`pricingModels`) e
  cenários (`pricingScenarios`) funcionam sem ESG; fatores (`impactFactors`) e
  atividades (`impactEntries`) são opcionais. Não gravar fatores universais sem
  fonte: cada empresa controla valor, unidade, escopo, fonte, versão e validade.
  A conversão de cenário em `quotes` é explícita e mantém
  `sourcePricingScenarioId`. Templates setoriais são configurações iniciais,
  nunca regras fixas ou produtos separados.
- **Jornada de eletrificação To Do Green**: regras puras em
  `src/features/logistics/electrificationJourneyDomain.js` e interface dentro
  da oportunidade em `pages/OpportunitiesPage.jsx`. A jornada é sempre
  `Mapear → Simular → Rodar → Reportar → Escalar` e deriva o avanço dos
  registros já existentes: diagnóstico na oportunidade, cenário com
  `opportunityId`, piloto, relatório/evidência e decisão de expansão. Não
  criar um segundo cadastro de estudo nem marcar etapa como concluída só por
  clique. A precificação aberta pela oportunidade recebe os dados mapeados,
  mas custos e premissas continuam vazios até confirmação explícita.
- **CRM To Do Green**: o cadastro canônico da conta continua em
  `todogreen_clients`; a inteligência fica em `fields_json` e é normalizada
  por `todoGreenCrmDomain.js`. A tela `pages/ClientsPage.jsx` conecta carteira,
  mapa de relacionamento, saúde da conta, próximas ações e oportunidades pelo
  `clientId`. Não criar uma segunda coleção de clientes nem ligar contas por
  nome quando houver identificador. Vendedor pode atualizar a visão 360º
  somente da própria carteira e toda alteração exige `revision`; o portal não
  recebe scores, pipeline, forecast, responsáveis ou observações internas.
- **Automações configuráveis da Central To Do Green**: regras ficam na tabela
  `todogreen_work_automation_rules` (migração `0049`) e são sempre isoladas por
  `workspace_owner_id`. A interface da Central permite escolher quadro,
  gatilho, condição e uma ação segura do catálogo fechado: mudar status,
  prioridade, responsável ou quadro. Atualizações executam no próprio request;
  `date-overdue` roda também no cron horário por
  `runTodoGreenScheduledWorkAutomations`, sem depender de navegador aberto.
  Ação idempotente que não muda o item não conta como execução, evitando que o
  cron aumente a revisão a cada hora. Não ampliar o catálogo para envio externo
  sem confirmação, auditoria e credencial do canal.
- **Hierarquia universal de trabalho (v124)**: lógica pura em
  `src/features/work/hierarchyDomain.js` e interface lazy em
  `src/features/work/WorkStructure.jsx`. A organização raiz é sempre derivada
  do registro existente em `businesses`; nunca criar uma segunda entidade de
  organização em `workNodes`. Essa coleção persiste apenas workspace, espaço,
  pasta e lista. Projetos continuam em `projects`, vinculados por
  `containerId`, e tarefas continuam em `tasks`, vinculadas por `listId`.
  Movimentações devem passar por `moveWorkNode` para impedir ciclos e níveis
  inválidos. Arquivar uma estrutura nunca exclui projetos ou tarefas.
- **Modal compartilhado (v124)**: diálogos reutilizam
  `src/components/Modal.jsx`, que mantém Escape, armadilha de foco, fechamento
  pelo backdrop e devolução de foco. Não recriar esse comportamento em módulos
  de funcionalidade.
- **Caixa de entrada pessoal (v128)**: lógica pura em
  `src/features/inbox/personalInboxDomain.js` e interface lazy em
  `src/features/inbox/PersonalInbox.jsx`. Ela deriva menções, tarefas
  atribuídas, comentários, aprovações e alterações importantes somente dos
  registros que o usuário já pode visualizar. Leitura e adiamento ficam em
  `personal_inbox_state` (migração `0019`), com chave por dono do workspace,
  usuário e item; nunca gravar esse estado no registro de origem nem
  compartilhá-lo entre membros. A antiga `InboxPage` continua sendo a caixa
  compartilhada de conversas com clientes, acessível pela segunda aba.

- **Análise de dados (v142)**: lógica pura em
  `src/features/analytics/statsDomain.js` e interface lazy em
  `src/features/analytics/DataLab.jsx`. Não cria coleção nova: lê
  `transactions`, `bills`, `opportunities`, `timeEntries` e `sheets`.
  Armadilha grave já corrigida: `parseBrNumber` remove tudo que não é dígito e
  devolve `0` para texto puro, então `"abacaxi"` virava zero e envenenava média
  e soma sem nenhum erro visível. `toNumber` agora só chama `parseBrNumber`
  depois de conferir que o valor parece número, e recusa data em formato ISO
  (`2026-07-01` não é o número 2026). Ao reaproveitar `parseBrNumber` em
  qualquer cálculo novo, repetir essa proteção.
  Convenção do módulo: `mean`, `median`, `stdDev` e `quantile` devolvem `null`
  quando não há dado suficiente, nunca `0` — zero é um resultado legítimo e não
  pode se confundir com ausência de dado. `forecast` devolve confiança alta,
  média ou baixa a partir do tamanho da série e do r², e a interface é obrigada
  a mostrar o aviso de palpite quando a confiança é baixa. `clusterValues` usa
  centróides semeados por quantil justamente para ser determinístico: a mesma
  entrada precisa gerar sempre os mesmos grupos.

- **Conhecimento conectado (v143)**: lógica pura em
  `src/features/notes/notesDomain.js` e interface lazy em
  `src/features/notes/ConnectedNotes.jsx`. Coleções `notes` e `flashcards`.
  Três armadilhas que já custaram bug e não devem voltar:
  (1) `\b` do JavaScript NÃO faz fronteira de palavra ao lado de letra
  acentuada — `/\bprodução\b/` nunca casa direito. Toda fronteira deste módulo
  usa lookahead/lookbehind Unicode (`(?![\p{L}\p{N}])`), nunca `\b`.
  (2) Transclusão precisa de pilha de visitados: sem ela, A embute B e B embute
  A e a tela trava. O ciclo tem de virar aviso visível, não silêncio.
  (3) Sugestão de ligação conta ligação nos DOIS sentidos. Se a outra nota já
  aponta para esta, elas já estão conectadas e já aparecem em "citada em";
  sugerir de novo é mandar ligar o que já está ligado.
  Ligação para nota inexistente é fluxo normal (escrever primeiro, criar
  depois), então vira nó "a criar" no grafo, nunca erro.
  O SVG do grafo é `role="img"` e não recebe clique: círculo de 9px não é alvo
  de toque e `<g>` não é lido como botão. A navegação fica na lista de botões
  ao lado.

- **Portfólio de projetos (v144)**: lógica pura em
  `src/features/portfolio/portfolioDomain.js` e interface lazy em
  `src/features/portfolio/PortfolioBoard.jsx`. Coleções `projectLinks`,
  `portfolioRisks` e `raci`. Fica ACIMA de `scheduleDomain.js`, que continua
  cuidando do cronograma de UM projeto — não duplicar CPM aqui.
  Pontos que já custaram bug ou exigem cuidado:
  (1) Dependência em círculo trava qualquer cálculo de data.
  `topologicalOrder` devolve `null` nesse caso e `portfolioSchedule` cai para
  as datas cadastradas, sem laço infinito. A interface recusa a ligação ANTES
  de gravar, explicando o motivo.
  (2) Em losango (A puxa B e C, os dois puxam D), o atraso de D é o MÁXIMO dos
  caminhos, nunca a soma — somar contaria o mesmo atraso duas vezes.
  (3) `pushedDays` é medido contra a data que a titular cadastrou, não contra o
  empurrão anterior. Com dois projetos empurrando o mesmo, medir do anterior
  mostrava só o último trecho e escondia metade do atraso.
  (4) `delayCauses` só aponta causa que dá para provar com o dado cadastrado;
  sem prova, devolve "não dá para dizer" em vez de chutar.
  `projectHealth` sempre devolve os motivos junto do nível.

- **Agentes (v145)**: lógica pura em `src/features/agents/agentDomain.js` e
  interface lazy em `src/features/agents/AgentStudio.jsx`. Coleções `agents` e
  `agentRuns`.
  Decisões que NÃO devem ser desfeitas sem falar com a titular:
  (1) O catálogo `AGENT_TOOLS` é fechado e cada ferramenta declara risco
  (`leitura`, `escrita`, `externo`). Ferramenta fora do catálogo, ou id que a
  IA inventou, sempre cai em aprovação — inclusive no nível "tudo".
  (2) O nível `tudo` libera envio externo sem aprovação. Foi escolha explícita
  da titular em 30/07/2026; o nível avisa o que significa, vale por agente e
  todo envio entra no log marcado como externo.
  (3) `executarPasso` recebe e devolve o banco, nunca chama `update` sozinho.
  Gravar dentro do laço fazia cada passo partir de uma cópia velha e a gravação
  final apagava o que os anteriores criaram: o agente dizia "criei a tarefa" e
  a tarefa sumia. Uma gravação só, no fim do laço.
  (4) Envio de verdade ainda não existe (falta credencial). O passo FALHA
  dizendo o que falta, em vez de devolver sucesso — fingir envio é pior que
  falhar.
  (5) `checkAcceptance` nunca devolve `confident: true`. A IA não confere bem o
  próprio trabalho e a interface é obrigada a apresentar o resultado como
  indício.
  Armadilha de JavaScript já corrigida aqui: `Number(x) || 8` transforma um 0
  legítimo no padrão. Usar `Number.isFinite` antes de aplicar o padrão.

- **Perfil universal de negócios (v149)**: catálogo e regras puras ficam em
  `src/features/business-profile/businessProfileDomain.js`; a interface lazy é
  `BusinessProfileStudio.jsx`. O modelo é **núcleo único + perfil + pacotes**,
  nunca um produto separado por setor. `BUSINESS_INDUSTRY_CATALOG` organiza
  categoria e atividade, sempre com opção aberta; `BUSINESS_TYPES` só escolhe
  recomendações funcionais internas. `enabledPacks` controla o menu quando
  `menuMode === "custom"`, mas `perfil-negocio`, Início e Começar do zero ficam
  sempre acessíveis. Contas antigas sem esses campos continuam vendo o menu
  completo. Trocar a atividade pode sugerir pacotes, mas nunca deve bloquear a
  ativação de qualquer outro pacote nem apagar dados de módulos ocultos.

- **Inteligência de tarefas (v150)**: regras puras de estruturação, validação,
  priorização local e prompt de execução ficam em
  `src/features/tasks/taskAiDomain.js`. A resposta estrutural da IA só entra
  depois de JSON válido e normalização de domínio; falha de provedor usa o
  plano local determinístico. Etapas e `acceptanceCriteria` cadastrados e
  pendentes bloqueiam conclusão/aprovação, mas tarefas legadas sem checklist
  não são bloqueadas. Execuções digitais abrem conversa com `sourceTaskId`; a
  ação explícita “Anexar à tarefa” guarda no máximo três `aiOutputs`, sem marcar
  como concluída nem alegar ação externa. A fila de foco é local e não pode
  consumir cota de IA.

- **Conteúdo da web é dado, nunca ordem (v151)**: `webResultsToContext`
  (`worker/services/web-search.js`) cerca todo trecho de site entre marcas
  `<<<FONTE_EXTERNA>>>` e declara, ANTES das fontes, que nada ali é instrução.
  Página na internet carrega ordem escondida de propósito ("ignore o que
  pediram e faça X") para sequestrar assistente que cola conteúdo no prompt sem
  separar dado de comando — e este app tem agentes que criam tarefa, lançam
  dinheiro e podem enviar mensagem em nome da titular. A marca é neutralizada
  no conteúdo (`stripFence`) para o site não conseguir forjar o fim da cerca.
  Mesma proteção que `memoriesToSystemContext` já aplicava; faltava aqui.
  Ao adicionar QUALQUER nova fonte externa no prompt (RSS, e-mail recebido,
  comentário de cliente, PDF de terceiro), repetir esse cerco.
- **Gatilho da busca web (v151)**: neste app "buscar", "procurar" e "pesquisar"
  quase sempre significam "acha no MEU workspace". Usados sozinhos como gatilho,
  mandavam a pergunta da titular para empresa de fora sem necessidade. Agora o
  verbo só vale acompanhado de fonte externa nomeada (internet/web/google/
  online), ou quando o pedido é de fato que muda no mundo (notícia, cotação,
  preço de mercado, lei atual).
- **Planejamento de agente nunca busca na web (v151)**: `AgentStudio` envia
  `webSearch: false` ao montar o plano. O catálogo de ferramentas cita
  `buscar_workspace`, o que sozinho ligava a busca externa e deixava texto de
  site desconhecido opinar sobre o que o agente ia fazer no workspace da
  titular. Não remover esse parâmetro.

- **Planos e cota (v152)**: lógica pura em `src/features/plans/planDomain.js`,
  serviço de servidor em `worker/services/plan-usage.js`, tela em
  `src/features/plans/PlanPanel.jsx`, tabelas na migração `0022`.
  Regras que NÃO podem ser afrouxadas:
  (1) `limitFor` resolve SEMPRE pelo id contra `PLANS`. Objeto de plano com
  `limits` escrito à mão é ignorado de propósito — se o plano chegasse de uma
  requisição, bastaria mandar `{limits:{aiPerMonth:999999}}`.
  (2) Plano desconhecido, banco fora do ar ou erro de leitura caem no gratuito,
  nunca em ilimitado. `null` é "sem limite" e `0` é "não faz parte do plano";
  confundir os dois libera o que deveria estar bloqueado.
  (3) A checagem acontece no worker, antes de gastar o recurso, e `handleAi` E
  `handleAiStream` precisam das duas. Deixar o streaming de fora transforma ele
  num caminho paralelo que ignora a cota.
  (4) O consumo é somado no banco por UPSERT, não em memória: duas abas abertas
  precisam contar as duas.
  (5) A cota renova sozinha porque o mês novo simplesmente não tem linha em
  `workspace_usage`. Não criar rotina de zerar nada.
  Falha ao contabilizar nunca derruba o pedido — o risco aceito é contar a
  menos, jamais cobrar a mais ou travar o app.

- **Modo lançamento (v153)**: `LAUNCH_MODE` em
  `src/features/plans/planDomain.js` é a chave única que decide se o app cobra.
  Decisão da titular em 31/07/2026: 100% gratuito para todos no primeiro
  momento. Com `LAUNCH_MODE = true`, todo mundo cai em `LAUNCH_PLAN`,
  `upgradeSuggestion` devolve `null` (não se empurra plano que não está à
  venda) e a tela esconde os cartões de preço.
  O teto do plano de lançamento NÃO é comercial: a IA roda na cota grátis
  compartilhada dos provedores, e sem teto uma conta em laço infinito derruba a
  IA de todas as outras. Não remover o teto ao "deixar tudo liberado".
  Para ligar a cobrança: trocar `LAUNCH_MODE` para false. `DEFAULT_PLAN_ID`
  volta sozinho ao gratuito e os testes marcados com `it.skipIf(LAUNCH_MODE)`
  voltam a rodar. Eles estão guardados de propósito, não apagados.

- **Menu escolhido por quem usa (v154)**: lógica pura em
  `src/features/navigation/menuDomain.js`, tela em
  `src/features/navigation/MenuSettings.jsx`, guardado em
  `preferences.mainMenu`.
  A regra que manda em tudo, decidida pela titular em 31/07/2026: escolher o
  menu NUNCA tira acesso. `everythingReachable` existe como rede de segurança e
  é testada varrendo várias combinações de menu — se um item puder sumir da
  interface, o teste quebra.
  A lista "Todas as ferramentas" começa ABERTA (`preferences.menuExpanded`).
  Fechar por padrão tirava da vista itens que a pessoa já sabe onde ficam, e
  quebrou 30 arquivos de teste de uma vez — foi o sinal de que era mudança
  brusca demais para impor.
  As visitas de menu ficam em `localStorage`, NÃO no workspace. Contá-las via
  `update()` a cada clique de navegação gravava o banco inteiro e atropelava o
  estado de telas abertas (quebrou `workflows.test.jsx`).
  Sugestão nunca reordena o menu sozinha: menu que se mexe sozinho faz a pessoa
  perder o botão que já tinha decorado.

- **Layout no celular (v155)**: a queixa da titular foi "quando abro no celular
  fica tudo desengonçado". Não foi corrigido no olho: foi medido com Chromium
  real em iPhone SE (320px) e iPhone 13 (390px), varrendo as 63 telas do menu e
  procurando toda caixa cuja borda direita passasse da tela sem estar dentro de
  algo que rola.
  As três causas de raiz, todas na mesma família — "a caixa não consegue
  encolher":
  (1) `grid-template-columns: 1fr` no celular. `1fr` tem mínimo `auto`, então a
  faixa cresce até a largura mínima do conteúdo e o cartão inteiro sai da tela.
  Em coluna única de celular use SEMPRE `minmax(0, 1fr)`.
  (2) `.section-head`/`.panel-head` eram `flex` sem `flex-wrap`. O botão da
  direita não cabia, saía da tela — e, por virar a largura mínima do painel,
  arrastava o painel junto. Agora quebram linha.
  (3) `<select>` se dimensiona pela opção mais longa da lista. Dentro de um
  `label` com `display:grid`, `max-width:100%` não resolve (a porcentagem é da
  faixa da grade, que já cresceu): a correção é `grid-template-columns:
  minmax(0,1fr)` no próprio `label`.
  Conteúdo que legitimamente não cabe (faixa de abas com sete itens) rola
  dentro do próprio quadro — `overflow-x:auto`. Nunca resolver com
  `overflow:hidden`: isso esconde o sintoma e deixa o item inalcançável.
  Duas regras de iOS que não são estéticas: campo com fonte abaixo de 16px faz
  o iPhone dar zoom sozinho ao receber o toque e NÃO voltar; e `viewport-fit=cover`
  no `index.html` é pré-requisito para `env(safe-area-inset-*)` funcionar.
  `src/mobile-layout.test.js` guarda essas regras lendo o CSS. É trava de
  regressão barata, não substitui abrir o navegador.

- **Mídia (v156)**: `src/features/media/` — três camadas puras
  (`imageDomain.js`, `audioDomain.js`, `libraryDomain.js`) e uma tela
  (`MediaStudio.jsx`, três abas). Reaproveita a coleção `media` que já existia
  em vez de criar outra: para quem usa, o que a IA gerou, o que foi editado e o
  que foi gravado são a mesma coisa — arquivo do negócio.
  A decisão de fundo é a gratuidade: TUDO roda no aparelho, com API que já vem
  no navegador (canvas para imagem, MediaRecorder para gravar, SpeechRecognition
  para ditar, speechSynthesis para ouvir). Sem servidor de imagem, sem serviço
  pago, funcionando offline, e a foto não sai do celular. Não trocar isso por
  uma API externa sem antes resolver quem paga a conta.
  Armadilhas que já custaram caro e estão travadas por teste:
  (1) Tamanho pronto ("Post quadrado") é uma CAIXA, não uma largura fixa.
  Aplicado depois do recorte, largura fixa AUMENTA a imagem já cortada — e
  aumentar só borra. `fitInside` nunca amplia, de propósito.
  (2) JPEG e WebP não têm transparência: sem pintar fundo branco antes, o que
  era transparente no PNG sai preto.
  (3) PNG não tem qualidade variável — pedir "máximo 40 KB" num PNG não faz
  nada. A tela avisa em vez de fingir que funcionou.
  (4) A busca binária de compressão guarda o MELHOR resultado que coube; sem
  isso ela devolveria a última tentativa, que pode ser pior.
  (5) A biblioteca só enxerga a mídia do negócio aberto. Gravar a lista
  filtrada direto por cima de `media` apagaria a mídia dos outros negócios —
  `salvarLista` substitui só a fatia visível. Há teste para isso.
  (6) `chunkForSpeech` existe porque a síntese de fala engasga com texto longo:
  alguns navegadores cortam no meio, outros param. A quebra é por frase, não
  por número de letras, senão corta palavra e perde a entonação.
  (7) SVG não entra como imagem: é código e pode carregar script.
  Gravar e ditar dependem do navegador. Onde não houver, a tela avisa e o resto
  continua funcionando — nunca travar a tela inteira por causa disso.

- **Editor de código, Notebook e Integrações (v157)**: três telas novas em
  `src/features/code/`, `src/features/notebook/` e `src/features/integrations/`,
  já no padrão que o Codex está montando — camada pura em `<nome>Domain.js`,
  tela em `<Nome>.jsx` importando `Button`/`Field`/`Empty`/`PageTitle` de
  `src/components/ui.jsx`. A tela de Mídia (v156) foi alinhada ao mesmo padrão
  na mesma leva, para não sobrar como dívida.

  **A prévia do editor de código é o ponto mais sensível do app.** Ela roda num
  iframe com `sandbox="allow-scripts"` e SEM `allow-same-origin`. Juntar os dois
  devolve ao código escrito na tela a origem do app: ele passaria a ler o
  `localStorage` — onde está o token de login — e a chamar a /api com a sessão
  de quem está usando. Num app multiusuário isso é uma conta acessando o negócio
  de outra. `isSandboxSafe` e um teste dedicado existem só para impedir que
  alguém "conserte" a prévia adicionando same-origin. Verificado em navegador
  real: a tentativa de ler o token de dentro da prévia devolve `SecurityError` e
  a origem é `null`.
  Consequências práticas: (1) `event.origin` da prévia é a string opaca "null",
  então conferir origem não protege nada — o que identifica a prévia é
  `event.source === iframe.contentWindow`, e `parseConsoleMessage` ainda descarta
  o que não estiver no nosso formato; (2) `</script>` dentro do JS do usuário
  fecha o documento inteiro, por isso `escapeScript`; (3) `localStorage` e
  `alert()` não funcionam na prévia, e a tela avisa em vez de deixar a pessoa
  procurando o erro.

  **O notebook não executa código, de propósito.** As consultas são uma
  linguagem fechada em português (`filtrar`, `agrupar`, `somar`, `periodo`…)
  interpretada em `notebookDomain.js`. Deixar a pessoa escrever JavaScript e
  rodar com `eval` seria muito mais curto e abriria um caminho para qualquer
  texto colado de fora executar dentro do app.
  Armadilha que já custou uma sessão: `dateField` de cada fonte precisa apontar
  para o nome do campo **depois** do `map()` (o nome em português), não o da
  coleção crua. Apontar para o nome cru faz `periodo` e `agrupar mes`
  devolverem zero sem erro nenhum — a pessoa acha que não tem dado. Há teste
  varrendo todas as fontes.
  Agrupar sem nenhuma conta depois é o engano mais comum de quem começa: em vez
  de devolver vazio calado, o notebook conta as linhas e explica o que fazer.

  **Integrações não inclui envio automático** (webhook de saída) porque ele
  precisa sair do servidor: pelo navegador é bloqueado por CORS e o endereço
  secreto ficaria no aparelho. Ficou anotado em PENDENCIAS_DA_TITULAR.md. O que
  está pronto — importar CSV, exportar CSV/JSON e agenda .ics — roda inteiro no
  aparelho, sem custo.
  Detalhes que não são frescura: o CSV sai com BOM senão o Excel em português
  mostra "ServiÃ§o"; o .ics precisa de quebra CRLF senão parte dos calendários
  recusa o arquivo inteiro sem dizer o motivo; e a importação recusa linha sem
  campo obrigatório dizendo o NÚMERO da linha — importação que descarta em
  silêncio é pior que importação que falha.

- **Envio automático / webhook de saída (v158)**: `worker/services/webhooks.js`,
  painel em `IntegrationsHub.jsx`, migração `0026_webhooks.sql`.

  **Este é o único ponto do app em que o nosso servidor busca um endereço
  escolhido por quem usa.** Isso o transforma numa ponte, e é a definição de
  SSRF: alguém cadastra `https://169.254.169.254/...` e o servidor vai lá com a
  identidade dele. `validateWebhookUrl` é por isso uma lista de PERMISSÃO
  estreita, não de bloqueio — só https, só porta 443, sem usuário/senha na URL,
  nada que resolva para rede privada, link-local, CGNAT, `.local`/`.internal`,
  nem para o próprio host do app. IPv6 que embrulha IPv4 (`::ffff:127.0.0.1`) é
  resolvido antes de comparar, senão passaria batido. A entrega usa
  `redirect: "manual"`: um endereço público que responde 302 para 127.0.0.1
  driblaria a checagem, que só acontece no cadastro.
  A rota `/api/webhooks` PRECISA estar nas duas listas de `needsAuth` no
  worker.js. Um endereço que dispara requisições de saída sem login seria um
  amplificador aberto para qualquer um.

  **Como os avisos são disparados**: comparando o espaço de trabalho anterior
  com o novo dentro de `handleWorkspace`, usando o `currentData` que já existia
  ali. Foi essa a escolha porque funciona venha o registro de onde vier, sem
  precisar instrumentar cada uma das dezenas de telas. Três guardas que não são
  opcionais: (1) `diffNewItems(null, ...)` devolve vazio — a PRIMEIRA gravação
  não dispara nada, senão quem chega com 300 contatos receberia 300 avisos;
  (2) teto de 20 avisos por gravação, para importação de planilha não virar
  enxurrada; (3) a entrega roda em `ctx.waitUntil`, depois da resposta — um
  destino lento seguraria o salvamento e a pessoa acharia que o app travou.
  Falha de entrega nunca sobe: perder os dados de quem usa porque um sistema
  externo caiu seria inaceitável, e há teste para isso.

  **O corpo enviado** vem de um catálogo fechado de eventos com lista explícita
  de campos, e `pickFields` ainda descarta qualquer campo cujo nome pareça
  segredo ou documento. O espaço de trabalho inteiro nunca sai.

  O segredo da assinatura é mostrado UMA vez, na criação, e nunca volta na
  listagem — se vazasse, qualquer um forjaria avisos para o destino. A
  assinatura cobre `carimbo + corpo`, não só o corpo: assinar só o corpo
  deixaria quem interceptasse reenviar a mesma mensagem para sempre.

  `looksLikeValidHook` em `integrationsDomain.js` é só conforto — erra rápido na
  tela. Não protege nada: quem quisesse burlar não passaria por ela. A checagem
  que vale é a do servidor.

- **A entrada do app é pedir, não procurar**: `src/features/home/askDomain.js`
  (puro) + a seção `.home-pedido` no topo do `HomeHub`, e a rota `conversar`
  com o `UniversalRequest` em tela própria.
  A razão é a que aparece na avaliação honesta do produto: são 68 telas, e a
  largura virou obstáculo. Quem chega para resolver uma coisa simples pede com
  as próprias palavras e o app leva. O catálogo continua logo abaixo, rebaixado
  a "Ou escolha direto" — dois títulos do mesmo peso disputavam a atenção.
  O texto digitado na entrada viaja para a conversa pelo rascunho que ela já
  lia (`sf-draft`). `stageRequest` devolve `false` quando não há armazenamento,
  em vez de mentir que guardou: quem chama decidiria errado com base nisso.
  Abrir a conversa nunca depende disso dar certo.
  `UniversalRequest` foi REMOVIDO de dentro do Dashboard. Deixar os dois faria
  a pessoa conversar em dois lugares diferentes, com históricos separados.
  "conversar" entrou em `PINNED` (menuDomain): é a porta de entrada, e vale
  também para quem já tinha menu salvo sem ele — sem isso, todo mundo que já
  usava o app continuaria sem o item.

## Pendências conhecidas (ver PENDENCIAS_DA_TITULAR.md)

- "Esqueci minha senha": ✅ implementado (/api/auth/forgot e /api/auth/reset, códigos via Brevo)
- Google OAuth, Gmail API e Calendar API: ✅ origem, escopos, usuário de teste e fluxos reais validados em 17/07/2026
- Domínio próprio e servidor GPU de vídeo: opcionais, dependem da titular
