# Matriz de prontidão do ERP To Do Green

**Revisada em 24/09/2026** contra o código do PR #15 — a `main` até `49adc35`
mais as mudanças do próprio PR. A versão anterior (aberta em 30/08 e "revalidada em
13/09") não refletia as mudanças de 18 a 23/09 (monday.com, tokens do TRACK3R,
separação All Green/`orianone.app`, migrações 0134–0143) e se contradizia em
vários pontos — a lista do que mudou está em
[Divergências corrigidas nesta revisão](#divergências-corrigidas-nesta-revisão).

Esta matriz não mede se existe uma tela. Para cada processo, ela responde a três
perguntas **independentes** — um processo pode estar implementado e testado e,
mesmo assim, nunca ter sido homologado em produção:

| Dimensão | Pergunta | Valores |
| --- | --- | --- |
| **Implementado** | O efeito de negócio existe no servidor — persistência no D1, regra server-side, controle de acesso (e tela, quando o processo tem tela)? | **Sim** · **Parcial** (núcleo real com lacuna declarada) · **Preparado** (código pronto e dormente até credencial, certificado ou infraestrutura externa) · **Não** (só catálogo, simulação ou nada) |
| **Testado** | Há teste automatizado **específico** do comportamento, rodando no gate (`npm run verify`: unidade + worker; ou `npm run test:e2e:critical`)? | **Sim** · **Parcial** (só parte do comportamento, ou só o domínio puro) · **Não** · **n/a** |
| **Homologado em produção** | Há **registro escrito** de validação com dado ou credencial real em produção (`orianone.app`, Worker `allgreen`)? | **Registrado** (com o código da evidência, H1–H7) · **Parcial** (a evidência cobre só parte — ex.: autenticação HTTP, sem dado real) · **Não registrado** |

"Não registrado" não quer dizer que não funcione em produção: quer dizer que
ninguém registrou a validação. Homologação nunca é inferida de "está no ar", de
teste local ou de publicação bem-sucedida.

**Resumo desta revisão:** nenhum processo de negócio tem homologação registrada
com dados reais. As evidências escritas cobrem publicação e smoke HTTP (H1, H2,
H7), a autenticação HTTP dos webhooks do TRACK3R (H3), a resolução de papéis num
deploy paralelo (H4) e login Google/e-mail antes da separação All Green (H5, H6).
Sete controles que a matriz anterior dava como fechados tinham lacuna; três
foram corrigidos neste PR (L4, L5, L7) e quatro seguem abertos — ver
[Lacunas de controle](#lacunas-de-controle). Em 24/09 a produção não rodava a
`main` — ver [Estado observado da publicação](#estado-observado-da-publicação-não-é-homologação).

`src/readiness-matrix.test.js` trava o que dá para provar daqui: o vocabulário
das três colunas, homologação só com código do registro, e que toda linha
"Testado: Sim/Parcial" cite um teste do gate cujo caso exista, literalmente,
no arquivo citado.

## Registro de homologação em produção

Toda validação com dado ou credencial real em produção entra aqui, com data,
ambiente e o que foi conferido. Linha nova no mesmo PR que muda o status.

| Código | Data | Evidência escrita | O que prova — e o que não prova |
| --- | --- | --- | --- |
| **H1** | 13/09/2026 | `docs/DEPLOYMENT_RUNBOOK.md` §13a: publicações com smoke HTTP (`/api/status`, SPA 200, `/api/todogreen/records` 401, `/api/system/version` com SHA e migrações esperadas) | Publicação, migrações aplicadas e rotas vivas. Não prova processo com dado real. Anterior à separação All Green (20/09). |
| **H2** | 19–20/09/2026 | `docs/HOMOLOGACAO_GO_LIVE.md` (versão conferida por HTTP; deploy do Workers Builds) | Publicação. O mesmo documento declara pendentes "homologar com dados/volume reais" e o backup/restore D1/R2. |
| **H3** | 22/09/2026 | Mensagem do commit `3fa3876`: 11 segredos individuais dos webhooks TRACK3R cadastrados no Worker `allgreen` e conferidos no ar (200/401/503) | Só a autenticação HTTP de cada endpoint, sem evento real do fornecedor. |
| **H4** | 20/09/2026 | Commit `913f4ef` ("homologação por perfil"; o doc de apoio foi removido na limpeza de 22/09 e existe só no histórico) | Papéis admin, financeiro, motorista, colaborador e vendedor resolvidos corretamente num deploy **paralelo** (`allgreen.brunapsiles.workers.dev`), com contas de teste. Prova acesso, não processo. |
| **H5** | 17/07/2026 | `AGENTS.md`, "Pendências conhecidas": login Google, Gmail e Agenda com "fluxos reais validados" | Anterior ao domínio `orianone.app` e ao Worker atual. |
| **H6** | antes de 20/09/2026 | `AGENTS.md`: verificação e recuperação por código via Brevo, segredos no cofre | Era do Seu Funcionário; não há registro para o Worker `allgreen`. |
| **H7** | 13/09/2026 | `docs/CLOUDFLARE_BUILDS_SETUP.md`: consolidação que levou `d2396e44d8e4` a produção; `0119` aplicada no D1 de produção | Publicação e schema. |

### Estado observado da publicação (não é homologação)

O que a produção responde publicamente. Serve para saber **qual código está no
ar** — não prova que um processo funciona com dado real.

| Quando | `GET /api/system/version` | Leitura |
| --- | --- | --- |
| 24/09/2026 19:18 UTC | `sha 6399f4a49f18`, build 14:09 UTC, `publishedBy: manual`, `branch: publish-tickets`, última migração `0144_client_requests_operation` | Publicação **manual**: o build não rodou no Workers Builds nem no GitHub Actions (`vite.config.js` só grava o provedor de CI quando há um), e sim a partir de um ramo local. A `main` estava em `49adc35` — o merge do PR #14 às 14:17 UTC ainda não estava no ar cinco horas depois, então **a produção não era a `main`**. O `/api/status` ainda devolvia o bloco `roadmap` fixo que este PR remove. |

## Comercial, cliente e receita

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Cadastro de cliente / Conta 360 | Sim | Sim | Não registrado | `todogreen_clients` (0032) e `todogreen_client_assignments` (0039); `handleTodoGreenClients` com `revision` e auditoria. Testes: `todogreen-client-assignments.worker.test.js`, `todogreen-customer-portal.worker.test.js`, passo 1 da jornada. Fontes proprietárias de inteligência seguem externas. |
| CRM / carteira | Sim | Sim | Não registrado | Inteligência em `fields_json` (`todoGreenCrmDomain.js`), comentários (0078) e interações (0079). Testes: `todogreen-vertical-records.worker.test.js` ("interações do comercial…", "carteira: o vendedor nao ve a oportunidade do colega"), `interacoesDomain.test.js`. LinkedIn oficial não integrado — só busca pública `site:linkedin.com`. Até 24/09 os comentários e as interações salvos não apareciam em Clientes, Oportunidades e Avanços da semana (`montarDadosDaVertical` não os repassava); corrigido, teste `shell/dadosDaVertical.test.js`. |
| Oportunidade | Sim | Sim | Não registrado | `todogreen_opportunities` (0041, título na 0081), vínculo por `client_id` e auditoria. Testes: vertical-records ("oportunidades saem do JSON do espaço", "escrita concorrente…"), `OpportunitiesPage.test.jsx`. |
| Handoff de oportunidade ganha | Sim | Sim | Não registrado | `deveCriarHandoff` → trabalho em `todogreen_work_items` e implantação em `todogreen_implementation_projects`, idempotente. Testes: vertical-records ("remarcar como ganha não duplica a implantação"), `opportunityHandoff.test.js`. |
| Precificação | Sim | Sim | Não registrado | Motor no servidor (`POST /api/todogreen/simulate`, `pricing_scenarios` 0027) e régua versionada (0060, `todogreen-pricing-parameters.js`). Salvar a simulação exige `pricing:simulate` ([L7](#lacunas-de-controle), corrigida). Testes: `todogreen-pricing-parameters.worker.test.js`, `pricingParametersDomain.test.js`, `todogreen-simulate.worker.test.js` e o passo 3 da jornada. |
| Deal Desk | Sim | Sim | Não registrado | Alçada calculada no servidor e segregação solicitante/decisor (0042, `todogreen-deal-desk.js`, gate `proposalLiberada`). Teste: `todogreen-deal-desk.worker.test.js` ("quem pede não decide o próprio pedido, nem chamando a API direto"). |
| Proposta | Sim | Sim | Não registrado | Cenário obrigatório; gates do Deal Desk e da viabilidade na criação e no PATCH. Testes: vertical-records, `todogreen-viability.worker.test.js` ("gate server-side da proposta"). O aceite do cliente é um estado informado ao ERP (`situacao: "accepted"`), não um aceite eletrônico. |
| Contrato / versionamento | Sim | Sim | Não registrado | Nasce de proposta aceita e cliente coerente; cada alteração soma `version` e grava evento (0048/0052). Teste: vertical-records ("versiona alterações e preserva a trilha do ciclo contratual"). A coerência proposta↔cliente vale na criação e em todo PATCH que troca um dos dois ([L5](#lacunas-de-controle), corrigida; teste vertical-records "o contrato não troca de proposta nem de cliente por fora do gate"). |
| Jurídico no ciclo contratual | Parcial | Sim | Não registrado | O gate existe: `juridicoConcluido` exige documento em `todogreen_legal_records` (0090) aprovado/assinado, na criação e na transição do contrato. Testes: jornada (409 antes do Jurídico), vertical-records ("conclui o gate pela página do Jurídico"), `legalWorkflowDomain.test.js`; o endpoint de eventos `POST /records/legal/:id/events` não tem teste de worker. **Lacuna:** o status do documento jurídico pode ser gravado direto ([L1](#lacunas-de-controle)). |
| Assinatura contratual | Parcial | Parcial | Não registrado | `signed` exige anexo no cofre com contexto jurídico (`documentoDeAssinaturaVinculado`). **Lacuna:** o gate confere a existência do anexo, não o conteúdo nem a assinatura ([L2](#lacunas-de-controle)); nos testes o anexo é inserido por SQL, então o upload pelo cofre não é exercitado nesse gate. A validade jurídica do provedor/certificado é externa. |
| Provedor de assinatura | Não | n/a | Não registrado | Não há integração com provedor (ClickSign, DocuSign, ZapSign, D4Sign…); o único "readiness" é `signatureStatus === "signed"` em `clientActivationDomain.js`. |
| Implantação / go-live | Sim | Sim | Não registrado | O readiness exige tabela de preço existente, ativa e do cliente/contrato (`todogreen-client-activation.js`, 0059/0062). Testes: jornada (tabela inativa reprova), `clientActivationDomain.test.js`, `todogreen-client-briefing.worker.test.js`. |
| Portal do cliente | Sim | Sim | Não registrado | Escopo vem da sessão e do banco (`clientScopeForSession`); operações, solicitações (0040), documentos, NPS (0115) e central de atendimento. Testes: `todogreen-customer-portal.worker.test.js` ("o cliente A nunca alcança o cliente B", "campo livre interno (margem, custo, CPF) não vaza no payload do portal"), `todogreen-portal-operacoes`, `todogreen-portal-multiempresa`, `todogreen-portal-nps`, e2e crítico `todogreen-portais-auth.spec.js`. Nas operações, o que sai para o cliente é lista fechada (`customerPortalViewContract.test.js`, `todogreen-portal-contrato.worker.test.js`). **Risco:** as solicitações ainda enviam `fields_json` sem lista fechada — hoje `registradaPor` (e-mail interno), `canalDeOrigem` e `triagemMotivo` — e `abertaPor` mostra o e-mail da equipe quando é ela quem registra; ligar ou desligar o portal de um cliente (`portal_enabled`) vale para quem o alcança na carteira, sem exigir gestão. |

## Operação, frota e execução

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Ordem de Serviço | Sim | Sim | Não registrado | Exige contrato aprovado e assinado e implantação ativa; preço herdado; máquina de estados (`todogreen-transactions.js`, 0056). Teste: `todogreen-transactions.worker.test.js` ("cria uma ordem somente sobre contrato aprovado e assinado", "aceite → OS: a ordem herda o preço"). |
| Planejamento / aceite | Parcial | Parcial | Não registrado | O que persiste é a OS liberada pelo Planejamento, com produto e campos livres; **não há colunas de capacidade, risco ou decisão**. A tela de aceite de viagens (`TripViabilityPage.jsx`) só calcula. Testes: transições da OS e o cálculo (`tripViabilityDomain.test.js`). |
| Operação / viagem | Sim | Sim | Não registrado | `todogreen_client_operations` (0033) é a fonte canônica compartilhada com o portal (a antiga `todogreen_operations` saiu na 0112). Testes: vertical-records ("a operação criada por dentro aparece no Portal do Cliente"), `todogreen-portal-operacoes`. |
| Ocorrências / eventos | Sim | Sim | Não registrado | Ledger `todogreen_client_operation_events` (0045; idempotência 0094; medição 0105) via `aplicarEventoOperacional`. Testes: vertical-records ("linha do tempo operacional"), `todogreen-driver-portal.worker.test.js`, passo 16. |
| POD / comprovante | Sim | Sim | Não registrado | Entrega sem prova é recusada e a OS não conclui por clique. Testes: transactions ("a entrega com POD conclui e gera elegibilidade"), passo 17. O POD pode ser só o nome do recebedor, sem arquivo; a captura física depende do dispositivo. |
| Portal do motorista | Sim | Sim | Parcial (H4) | Recorte por `driver_id` (`todogreen-driver-portal.js`). Testes: driver-portal ("minhas viagens são só as minhas"), e2e crítico `todogreen-portais-auth.spec.js`. H4 cobre só a resolução do papel num deploy paralelo. |
| Frota | Sim | Sim | Não registrado | Veículos, manutenção e eventos (0031), motoristas (0062), classes compatíveis. Teste: `todogreen-fleet.worker.test.js`. Telemetria depende do rastreador. |
| TMS Track3r por arquivo | Sim | Sim | Não registrado | Importação, deduplicação e casamento por CNPJ (`todogreen-tms.js`, 0063). Teste: `todogreen-tms.worker.test.js` ("importação de arquivo — funciona sem credencial"). O gate de go-live pede "arquivo real importado", sem registro até agora. |
| TMS Track3r API/webhook | Sim | Sim | Parcial (H3) | Receptor com inbox (0134), rejeições (0142), projetores (0135–0138), token por endpoint e reprocessamento no cron. Testes: `todogreen-tms-webhook`, `todogreen-tms-webhooks-all`, `todogreen-track3r-webhook-tokens`. Falta evento real do fornecedor. |
| Rastreamento / telemetria | Parcial | Sim | Não registrado | Posições e ponte para a operação (`todogreen-tracker.js`, 0038/0107), retenção no cron. Testes: `todogreen-tracker`, `-readiness`, `-retention`. Só vira "conectado" depois de sincronização real. O cron chama a sincronização uma vez por disparo (eram duas até 24/09 — `test/cron.worker.test.js`); o job não tem trava própria, então uma entrega duplicada do cron (o Cloudflare garante "pelo menos uma vez") sincroniza em dobro com o fornecedor. |
| CIOT interno | Sim | Sim | Não registrado | Payload, piso mínimo, estados e vínculo com a OS (0057). Teste: transactions ("prepara CIOT e bloqueia frete abaixo do piso mínimo"). |
| CIOT oficial ANTT | Preparado | Parcial | Não registrado | Conector host-side (`connectors/antt-ciot/`, `docs/todogreen-ciot-direct-connector.md`). Exige certificado e confirmação oficial. |

## Fiscal, faturamento e financeiro

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Fila de faturamento | Sim | Sim | Não registrado | OS concluída + POD gera item elegível; conferência e fechamento (0056). Teste: transactions ("confere, fecha, prepara documento e cria contas a receber"), passo 18. |
| Faturamento | Sim | Sim | Não registrado | Billing run, invoice e título (0056). O documento fiscal oficial é outra etapa. |
| Motor fiscal | Sim | Sim | Não registrado | Cálculo, validação, XML/DACTE e ciclo de vida (`todogreen-fiscal.js`, 0064/0069). Testes: `todogreen-fiscal.worker.test.js` ("dois documentos assinados nunca dividem o mesmo número"), `fiscalDomain.test.js`. |
| CT-e / MDF-e autorizado | Preparado | Parcial | Não registrado | Só transmite com certificado + conector; `interpretarRetornoSefaz` exige cStat 100/104 **com protocolo**. A ponta real com a SEFAZ é o único `it.todo` da jornada. O ERP também aceita **registro manual** de documento autorizado com protocolo e chave digitados, sem consulta oficial. |
| NFS-e autorizada | Preparado | Parcial | Não registrado | Cálculo e validação internos; depende de município/provedor e credenciais. |
| Contas a receber | Sim | Sim | Não registrado | Título com espelho no razão (ponte 0069). Teste: transactions ("o título a receber aparece no razão como receita"). Cobrança bancária automatizada é externa. |
| Recebimento / baixa | Sim | Sim | Não registrado | Baixa parcial/integral com concorrência e espelho no razão. Testes: transactions ("aceita baixa parcial e depois integral"), vertical-records (estorno), passo 20. |
| Tesouraria / conciliação | Sim | Sim | Não registrado | Extrato, conciliação, saldo e fechamento de período (`todogreen-treasury.js`, 0068). Teste: `todogreen-treasury.worker.test.js`. Conexão bancária direta seria externa. |
| Custos / rateios | Sim | Sim | Não registrado | Rateio multidimensional (0056). Teste: transactions ("recusa custo sem rateio integral…"). |
| Contas a pagar | Sim | Sim | Não registrado | Compras e folha geram obrigações em `todogreen_financial_entries`. Testes: purchasing ("entra no estoque e gera o título a pagar…"), payroll ("fechar gera as quatro contas a pagar…"). Pagamento bancário é externo. |
| Fechamento de competência | Parcial | Parcial | Não registrado | A trava vale na coleção `financial`, nas transações e na tesouraria. Teste: treasury ("mês fechado recusa lançamento novo…"). **Lacuna:** folha, recebimento de compras e NF do PJ gravam no razão sem consultar a trava ([L3](#lacunas-de-controle)). |

## Compras, suprimentos e estoque

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Requisição | Sim | Sim | Não registrado | Itens, requisitante, centro de custo e máquina de estados (0055/0087). Teste: purchasing ("segue o caminho declarado e recusa pulo de etapa"). |
| Alçada de compras | Sim | Sim | Não registrado | Faixas **configuráveis por espaço** (0111, `GET/PUT /api/todogreen/purchasing-params`, `PurchaseApprovalPanel.jsx`), com revisão otimista e auditoria — sem histórico das versões anteriores (UPSERT com contador). O portão (`todogreen-purchasing-enterprise.js`, ligado em `worker-entry.js`) é o único que escreve a trilha de aprovação, e a aprovação só leva a decisão ([L4](#lacunas-de-controle), corrigida). Testes: purchasing ("alçada: o corpo do pedido não contorna o portão", "alçada com segregação para a equipe"), `todogreen-purchasing-params.worker.test.js`, `purchaseApprovalEnterprise.test.js`. **Decisão pendente:** aprovações parciais sobrevivem a uma edição de valor entre etapas — a régua é recalculada e mantém as etapas compatíveis ("recalcula a régua sem apagar aprovações compatíveis"); se a política for "a aprovação vale para o valor aprovado", a trilha precisa guardar o total e recomeçar quando ele muda. |
| Cotação / fornecedor | Parcial | Não | Não registrado | Fornecedores em `todogreen_parties` (0053) e `rfq_id` no pedido; a **comparação de ofertas não está no ERP** (só no app geral, `features/procurement/`). |
| Pedido de compra | Sim | Sim | Não registrado | Nasce de requisição aprovada; editar depois de aprovado derruba a aprovação. Teste: purchasing ("editar depois de aprovado derruba a validade da aprovação"). |
| Recebimento | Sim | Sim | Não registrado | Idempotente, com movimento de estoque e título. Teste: purchasing ("recebimento: o ponto com efeito"). |
| Estoque | Sim | Sim | Não registrado | Movimentos append-only e contagens (0054); saída acima do saldo é 409. Teste: `todogreen-stock.worker.test.js`. WMS externo seria integração. |
| Cadastros de suprimentos | Sim | Sim | Não registrado | Itens, depósitos e fornecedores permissionados. Teste: `todogreen-erp-core.worker.test.js`. |

## RH, Departamento Pessoal e pessoas

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Cadastro de colaboradores | Sim | Sim | Não registrado | `todogreen_employees` e documentos (0062), só `hr:manage`. Teste: payroll ("LGPD: só o RH entra"). |
| RH operacional / alocação | Sim | Sim | Não registrado | Disponibilidade, escalas (0110) e ponto (0066). Testes: payroll ("ponto e férias"), passo 15. |
| Folha | Parcial | Parcial | Não registrado | Cálculo, itens, fechamento e reabertura (0066). Testes: payroll (fechamento, encargo, DSR, 13º); **a reabertura não tem teste**. **Lacuna:** a única tabela de INSS/IRRF/FGTS é `TABELAS_2025` (`payrollDomain.js`, versão "2025.1"), embutida no código — não há tabela de 2026 nem configuração persistida. |
| Férias | Sim | Sim | Não registrado | Cálculo, status e lançamentos (0066). |
| Rescisão | Sim | Sim | Não registrado | Cálculo, desligamento e obrigações. eSocial/FGTS Digital/banco são externos. |
| eSocial / obrigações | Não | n/a | Não registrado | Só a flag `payrollTransmissionEnabled`; não há código de transmissão. |
| Pagamento bancário da folha | Não | n/a | Não registrado | Não há CNAB; o adaptador SysPag atende GreenPay e a NF do PJ, não a folha. |

## Jurídico, Qualidade, Marketing e processos internos

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Workflow Jurídico | Sim | Parcial | Não registrado | Duas etapas (Jurídico + liderança) em `todogreen-enterprise-workflows.js` (0076) e documentos jurídicos (0090/0104). **É lido pelo gate do contrato** (a versão anterior dizia que não era). Testes: `todogreen-enterprise-workflows.worker.test.js` (só casos de Jurídico), jornada. |
| Negociação contratual | Parcial | Parcial | Não registrado | Pontos de negociação e "com quem está a bola" (`contratoNegociacaoDomain.js`) editados na tela; nenhum código de servidor lê nem exige que estejam resolvidos. Teste só do domínio. |
| Qualidade / CAPA / não conformidade | Parcial | Parcial | Não registrado | Registro de NC real (0089, coleção `quality`); o plano de aprovação sequencial existe, mas é contornável ([L6](#lacunas-de-controle)). Testes só do registro de NC (vertical-records, `QualityPage.test.jsx`). |
| Marketing / campanhas | Parcial | Não | Não registrado | Alçada por orçamento no plano (acima de 5 mil liderança; acima de 25 mil financeiro), contornável como a Qualidade. Sem teste. |
| Processos internos gerais | Parcial | Não | Não registrado | O domínio `general` não tem etapas de aprovação (`approvalPlan` vazio) nem tela; a recorrência roda no cron, sem teste. |
| Planner / Projetos / Work Center | Sim | Sim | Não registrado | Boards, membros, visibilidade e recorrência (0030/0065/0067). A tarefa canônica vive em `db.tasks` (ver "To Do Green — task canônica" no `AGENTS.md`). Testes: `todogreen-planner`, `todogreen-work-automations`, `WorkViews.test.jsx`. |
| Metas | Sim | Sim | Não registrado | 0046/0050, `todogreen-goals.js`. Testes: `todogreen-goals.worker.test.js`, `GoalsPage.test.jsx`. |
| Governança / auditoria | Sim | Parcial | Não registrado | `todogreen_audit_events` (0052) e `/api/todogreen/governance` (`audit:read`). A gravação é conferida em outras suítes; o endpoint de leitura não tem teste. Política de retenção/backup a definir. |

## ESG, evidências e documentos

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Impacto ambiental | Sim | Sim | Não registrado | Cálculo auditável com entradas, metodologia e versão do fator (`todogreen-esg.js`, 0103/0108). Testes: `todogreen-esg`, `-esg-regua`, `-esg-report`. |
| Green Score | Sim | Sim | Não registrado | Score persistido e pesos versionados (0033/0074). Indicador proprietário, não certificação. |
| Evidências ESG/operacionais | Sim | Sim | Não registrado | `todogreen_evidences` (0034); impressão digital dos bytes. Teste: `todogreen-evidences.worker.test.js`. |
| Cofre de documentos | Sim | Sim | Não registrado | SHA-256, versões e download autenticado (0076); pastas (0084). Os bytes ficam em chunks no D1: o binding R2 opcional `MEDIA_BUCKET` não está declarado no `wrangler.jsonc` (`docs/SECRETS.md`). Testes: `todogreen-file-vault`, `todogreen-file-store-r2`. |
| Documento contratual | Parcial | Parcial | Não registrado | Mesmo gate e mesma lacuna da assinatura contratual ([L2](#lacunas-de-controle)). |

## Integrações

| Integração / capacidade | Implementado | Testado | Homologado | Situação |
| --- | --- | --- | --- | --- |
| Cloudflare Worker + D1 + Cron | Sim | Sim | Parcial (H1, H2, H7) | Publicação e smoke registrados; não há registro de execução de cron em produção. Testes: `weekly-summary.worker.test.js`, `automations-scheduled.worker.test.js`. |
| Versão publicada (`GET /api/system/version`) | Sim | Sim | Registrado (H1) | SHA, build, branch, `publishedBy`, ambiente e migrações esperadas, sem segredo. Teste: `system-health.worker.test.js`. |
| Saúde do sistema (Administração) | Sim | Sim | Não registrado | `/api/todogreen/system-health` (`integration:manage`/`audit:read`), métricas (0120). O runbook descreve a conferência, sem resultado registrado. |
| Automações internas | Sim | Sim | Não registrado | Blob (0018) e Central (0049) no cron horário. |
| Webhooks de saída | Parcial | Parcial | Não registrado | O motor (`worker/services/webhooks.js`) só observa coleções do app geral; **nenhum evento das tabelas `todogreen_*`** (OS, POD, fatura, ocorrência) dispara webhook. Testes só do app geral. |
| API pública do TMS / idempotência | Sim | Sim | Não registrado | `/api/tms/v1/*` com chaves `tdg_live_*` e idempotência (0088). Testes: `todogreen-tms-public-api`, `todogreen-routing-api`. |
| Pesquisa web pública | Sim | Sim | Não registrado | Cascata de provedores (`web-search.js`); qualidade depende da fonte. |
| IA BYOK | Sim | Sim | Não registrado | `ai-keys.js`, cifrado com `WORKSPACE_AI_VAULT_KEY`; cada provedor depende de chave e teste positivo. |
| E-mail transacional (Brevo) | Sim | Sim | Parcial (H6) | Em uso em convites, portal, avisos e Central. H6 é da era anterior; o commit `9c760e8` trata falhas de entrega de convites no Worker atual. |
| WhatsApp | Preparado | Sim | Não registrado | Envio pela Cloud API ou Evolution e receptor de entrada, dormentes sem segredo. **Sem `WHATSAPP_APP_SECRET` o webhook de entrada aceita POST sem conferir assinatura** (`docs/SECRETS.md`). |
| Google Login | Sim | Não | Parcial (H5) | `/api/auth/google` valida o ID token; não há teste de worker. H5 é anterior ao domínio atual. |
| Gmail / Google Agenda | Parcial | Parcial | Parcial (H5) | Envio, rascunho e evento **pelo navegador** (`src/integrations/google.js`, usado em `EnviarApresentacao.jsx`), testados com mock em `src/workflows.test.jsx`. Nada no backend; ler o Gmail exige OAuth de autorização com `gmail.readonly`, que não existe. |
| Microsoft 365 | Não | n/a | Não registrado | Só a entrada de catálogo. |
| LinkedIn oficial | Não | n/a | Não registrado | Catálogo e busca pública; não equivale à API. |
| monday.com | Parcial | Não | Não registrado | OAuth 2.1/PKCE, receptor de webhook (JWT) e inbox (0139) existem; **falta a projeção** dos eventos para registros do ERP (ficam `received`) e não há teste. Conta ainda não conectada. |
| Power BI | Não | n/a | Não registrado | Só a entrada de catálogo. |
| SEFAZ | Preparado | Parcial | Não registrado | Ver CT-e/MDF-e. |
| ANTT CIOT | Preparado | Parcial | Não registrado | Ver CIOT oficial. |
| Track3r API/webhook | Sim | Sim | Parcial (H3) | Ver TMS Track3r API/webhook. |

## Eletrificação, roteirização e viabilidade

Módulos de domínio puros, determinísticos e testados; a maioria já está ligada
ao servidor e à tela. Os que ainda são só domínio estão marcados **Parcial**.

| Processo | Implementado | Testado | Homologado | Evidência e fronteira |
| --- | --- | --- | --- | --- |
| Estimativa de energia/autonomia | Sim | Sim | Não registrado | `energyEstimationDomain.js`, usado pela viabilidade, pelo pré-flight e pelo `electric-plan`; elevação e clima com proveniência (0122) — o clima vem da MET Norway, porque a API gratuita do Open-Meteo é só para uso não comercial —, baseline por veículo (0123) devolvido pela API mas ainda sem substituir o consumo nominal. Com `GEOAPIFY_API_KEY`, a elevação vem primeiro da Geoapify. |
| Tarifa de energia de referência (ANEEL) | Sim | Sim | Não registrado | `energyTariffDomain.js` (hierarquia contrato > informada > ANEEL > fallback) e cache 0124. Testes: `energyTariffDomain.test.js`, `todogreen-energy.worker.test.js`. |
| Preço de diesel de referência (ANP) | Sim | Sim | Não registrado | `anpDieselPriceDomain.js`, ingestão semanal ou `POST /energy/anp/import`, stale em 21 dias. |
| Janela energética de recarga (ONS) | Sim | Sim | Não registrado | `gridWindowDomain.js` (pesos 60/40), perfil 24 h por subsistema. Sem fator de emissão horário. |
| Plano de recarga por veículo | Sim | Sim | Não registrado | `planoDeRecargaPorVeiculo` no `/energy/plan`. Testes: `smartChargingPlan.test.js`, `smartChargingDomain.test.js`. Slots de 1 h; não envia comando OCPP. |
| Radar de mercado estruturado (PNCP · Compras.gov · GDELT) | Sim | Sim | Não registrado | `marketSignalDomain.js`, `todogreen-market-signals.js` (0125, preferências 0133), "Criar oportunidade" a partir do sinal. Testes: `marketSignalDomain.test.js`, `todogreen-market-signals.worker.test.js`. |
| Risk Map (PRF · ANTT) | Sim | Sim | Não registrado | `roadRiskDomain.js`, `todogreen-road-risk.js`; sem índice é `RISK_DATA_NOT_AVAILABLE`, nunca zero. PRF exige importação manual. |
| Alternativas de rota com risco como custo | Parcial | Sim | Não registrado | Conectadas no OSRM e no Valhalla (`rankRouteAlternatives`, pedágio). **No caminho Geoapify — o primário quando a chave existe — não há alternativas nem ranking.** Teste: road-risk ("alternativas de rota com risco como custo"). |
| Design system — tokens e regressão visual | Sim | Sim | n/a | Bloco canônico `.tdg` em `LogisticsVertical.css` e `src/design-system/tokens.css`; guarda `src/design-system/designTokens.test.js`; regressão visual em `e2e/visual/` (fora do gate crítico). Baselines gerados na sessão remota; o caminho Docker não foi exercitado. |
| Green On — pontos de recarga e OCPP | Parcial | Sim | Não registrado | Pontos (0114), sessões, reservas e preço por kWh (0130); OCPP só PREPARED — nenhum comando sai do sistema e a sessão nasce digitada. Até 24/09 um PATCH do preço por kWh sem `campos` apagava os campos livres; corrigido (`verticalRecordsContract.test.js`). |
| GreenPay — razão e repasse | Sim (razão) · Preparado (repasse) | Sim | Não registrado | Razão interno e contratos de ganho (0113/0131); repasse PIX via SysPag dormente sem `SYSPAG_API_TOKEN` — "pago" é só o razão interno. |
| Core All Green / Greenmob | Parcial | Parcial | Não registrado | As verticais Greenmob e Green On existem **só no frontend** (dados no blob do workspace), sem backend nem D1; o `tenant_id` é único (`todogreen`). |
| Seleção de motor OSRM×Valhalla | Sim | Sim | Não registrado | `routingEngineSelectionDomain.js`, `routing-providers.js`; pesado sem Valhalla → `NO_SAFE_ROUTING_ENGINE` (409). Com Geoapify, pesados vão como `heavy_truck` pela Geoapify antes do seletor. |
| Restrições viárias (OSM) | Parcial | Parcial | Não registrado | Só o domínio (`roadRestrictionDomain.js`), sem consumidor no worker nem nas telas; depende do grafo OSM/PostGIS. |
| Snapshot de viabilidade | Sim | Sim | Não registrado | Append-only e versionado (0121) com gate server-side da proposta. Testes: `viabilitySnapshotDomain.test.js`, `todogreen-viability.worker.test.js`, passo 4b da jornada. |
| Pré-flight operacional | Sim | Sim | Não registrado | Persistido e ligado à rota (0132); o despacho automático passa pelo mesmo gate. Testes: `preflightDomain.test.js`, `todogreen-preflight.worker.test.js`, `todogreen-dispatch.worker.test.js`. |
| Action Queue | Sim | Sim | Não registrado | BLOCK/WARNING e risco alto viram itens na Torre de Controle, com dedupe. Sem fechamento automático do item. |
| Proveniência de dados | Parcial | Sim | Não registrado | `dataProvenanceDomain.js` usado no worker (pré-flight, viabilidade), ainda não campo a campo nas telas. |
| Perfil físico/energético do veículo | Sim | Sim | Não registrado | Colunas da 0123 gravadas pelo cadastro da frota. |
| Fila offline do motorista | Sim | Sim | Não registrado | `driverOfflineQueueDomain.js` consumido pelo portal, com idempotência no servidor (0094). |

## Módulos que não estavam na matriz

Existem no código com persistência e teste, mas não constavam da versão anterior.

| Módulo | Implementado | Testado | Homologado | Evidência |
| --- | --- | --- | --- | --- |
| Portal do colaborador (PJ e CLT) e NF do PJ | Sim (pagamento: Preparado) | Sim | Não registrado | `todogreen-employee-portal.js`, `pjInvoiceDomain.js`, 0117; rota `/portal-colaborador`. Teste: `todogreen-employee-portal.worker.test.js`. |
| Chamados do colaborador | Sim | Sim | Não registrado | `employeeTicketDomain.js`, 0118. |
| Chave PIX do motorista e adaptador SysPag | Sim (repasse: Preparado) | Sim | Não registrado | 0116, `pixDomain.js`, `syspagDomain.js`, `todogreen-syspag.js`. |
| Portal TMS, projeções TRACK3R, TMS manual e ponte local | Sim | Sim | Parcial (H3) | `TmsPortal.jsx` (`/portal-tms`), `todogreen-track3r-projectors.js` (0135–0138, 0142), `todogreen-tms-manual.js`, `todogreen-tms-local-bridge.js`. |
| Central RFQ/RFI (acervo de habilitação) | Sim | Sim | Não registrado | `habilitacaoDomain.js`, 0083, `CentralRfqPage.jsx`; status é fórmula, nunca coluna. |
| Pastas do cofre | Sim | Sim | Não registrado | `pastasDomain.js`, 0084; visibilidade pela linhagem. |
| "Sobre o negócio", dossiê da IA e Plantû | Sim | Sim | Não registrado | `businessContextDomain.js`, 0082, `todogreen-semente.js`, 0091–0095. |
| Automações configuráveis da Central | Sim | Sim | Não registrado | 0049, `runTodoGreenScheduledWorkAutomations`. Teste: `todogreen-work-automations.worker.test.js`. |
| Radar por busca web e inteligência de mercado/conta | Sim | Parcial | Não registrado | `todogreen-market-radar.js`, `todogreen-market-intelligence.js` (0075), `todogreen-client-intelligence.js`. |
| Acesso: pedidos, convites e senha provisória | Sim | Sim | Parcial (H4) | 0086, 0088, `users.must_change_password` (0143). Testes: `todogreen-access`, `-access-requests`, `-access-binding`, `temp-password-access`. Até 24/09 `compliance:manage` e `business:teach` não podiam ser dados num acesso sob medida (fora do catálogo que o Worker usa como filtro); corrigido, teste access-binding ("jurídico/compliance e o dossiê do assistente podem ser dados sob medida"). |
| Solicitações do cliente, atendimento automatizado e NPS | Sim | Sim | Não registrado | `todogreen-requests.js` (0040), `atendimentoAutomatizadoDomain.js`, 0115. |
| Painel comercial (retrato de receita) | Sim | Parcial | Não registrado | `todogreen-commercial-panel.js` (0140/0141); só teste de unidade. |
| Dashboards configuráveis | Sim | Sim | Não registrado | `todogreen-dashboards.js` (0039). |
| Desempenho de preço (previsto × realizado) | Sim | Parcial | Não registrado | `todogreen-pricing-performance.js` (0051); só teste de unidade. |
| Motor HC + DRE | Sim | Parcial | Não registrado | `todogreen-operation-params.js` (0099), `operationEngineDomain.js`; só teste de unidade. |
| Vistoria, jornada, turnos, CNH e score do motorista | Sim | Sim | Não registrado | 0097, 0109, 0110; `driverChecklistDomain.js`, `driverJourneyDomain.js`, `driverScoreDomain.js`. |
| Rota do dia, roteirizador e despacho inteligente | Sim | Sim | Não registrado | `todogreen_routes` (0100), 0106, `todogreen-dispatch.js`, `worker/vrp/`. Testes: `todogreen-dispatch`, `todogreen-dispatch-vroom`; e2e `todogreen-roteirizacao.spec.js` (fora do gate crítico). Até 24/09 a leitura das rotas dava 500 para planejamento e auditor (recorte de carteira numa tabela sem `client_id`); corrigido, teste vertical-records ("rotas do dia são da operação, não da carteira"). |
| Pedágios, carregadores públicos, CEP e dados abertos | Sim | Sim | Não registrado | `todogreen-pedagios.js`, `todogreen-carregadores.js`, `todogreen-integration-gateway.js`. |
| Conexões MCP | Sim | Sim | Não registrado | `worker/services/mcp-connections.js`. Teste: `mcp-connections.worker.test.js`. |
| Caixa de entrada por e-mail (Brevo Inbound) | Sim | Sim | Não registrado | `worker/mensageria/inbound-email.js`, `/api/inbound/email`. Testes: `inbound.worker.test.js`, `src/inbound-email.test.js`. |
| Itens menores | Sim | Sim | Não registrado | Modelos de importação de operações (0119), avisos de pendência (0101), fechamento ESG mensal (0108), régua ambiental (0103). |
| Telas simuladoras (sem API nem persistência) | Não | Parcial (domínio) | n/a | Green On App, Roaming (OCPI), console OCPP, conta corporativa Green On, BESS/pico, fila de alertas, cobrança SaaS, acessos multi-tenant, grupo de entidades, segurança física, RASCI e locação Greenmob — calculam ou demonstram, sem efeito de negócio no servidor. |

## Lacunas de controle

Controles que a versão anterior da matriz dava como fechados e que o código
permite contornar. Todas foram **reproduzidas por teste exploratório em
24/09/2026** — requisições HTTP reais contra o Worker local, com os papéis
citados. As corrigidas têm teste de regressão que falhava antes da correção.

| Código | Lacuna | Onde | Situação |
| --- | --- | --- | --- |
| **L1** | O status do documento jurídico é gravado direto pela coleção genérica `legal` (`POST`/`PATCH /api/todogreen/records/legal`), que só exige `proposal:manage` — permissão do vendedor. Isso satisfaz `juridicoConcluido` sem passar pela máquina de estados (`registrarEventoJuridico`) nem por `compliance:manage`. A Central Jurídica (`tdgLegalBridge.js`/`useTdgLegalRecords.js`) também grava `situacao` direto. | coleção `legal` em `worker/services/vertical-records/colecoes/juridico.js` | **Aberta.** Reproduzida: um vendedor grava o documento já `aprovado` com `campos.contractId` e o contrato passa pela aprovação (200). O teste de vertical-records também cria o documento já `aprovado`. |
| **L2** | O gate de assinatura confere só a **existência** de um anexo com contexto jurídico — aceita inclusive referência externa sem bytes — e o upload exige só `proposal:manage`. | `documentoDeAssinaturaVinculado` / `temAnexoNoCofre` | **Aberta.** Reproduzida: uma referência externa de 0 byte no cofre, com contexto jurídico, satisfaz o gate. Somada à L1, um vendedor leva o contrato sozinho a aprovado e assinado. |
| **L3** | Folha, recebimento de compras e aprovação da NF do PJ gravam em `todogreen_financial_entries` sem consultar a trava de competência fechada. | `todogreen-payroll.js`, `todogreen-purchasing.js`, `todogreen-employee-portal.js` | **Aberta.** Reproduzida nos três: fechar a folha, receber a compra e aprovar a NF do PJ lançam no razão de um mês fechado. |
| **L4** | A alçada de compras era contornável pelo corpo do pedido: (a) o portão comparava o `status` cru e o serviço de compras apara — `"aprovada "` passava como edição comum e chegava como aprovação, sem faixas nem segregação; (b) a trilha `campos.purchaseApprovalFlow` era aceita do cliente, na criação ou numa edição (inclusive no reenvio do requisitante, que não tem `purchase:manage`), com todas as etapas "aprovadas"; (c) o clique de aprovar podia trocar as linhas: a alçada avaliava R$ 100 gravados e o pedido saía aprovado com R$ 500 mil e `aprovacaoValida: true`. | `todogreen-purchasing-enterprise.js` × `todogreen-purchasing.js` | **Corrigida.** O portão lê o status com o mesmo leitor do serviço (`statusDoCorpo`), é o único que escreve a trilha e a aprovação só leva a decisão (`status`, `revision`, `notaDecisao`). Teste: purchasing ("alçada: o corpo do pedido não contorna o portão"). |
| **L5** | O PATCH do contrato aceitava trocar `propostaId`/`clientId` sem repetir a checagem de proposta aceita e cliente coerente, que só rodava na criação. | `worker/services/vertical-records/crud.js` | **Corrigida.** Reproduzida: o PATCH trocava `propostaId` por uma proposta em rascunho e `clientId` por outro cliente (200). A criação e o PATCH que troca o par usam a mesma checagem (`conferirParDoContrato`), e a linhagem (oportunidade, cenário) acompanha a proposta nova. Teste: vertical-records ("o contrato não troca de proposta nem de cliente por fora do gate"). |
| **L6** | Nos fluxos de Qualidade, Marketing e processos gerais, o PATCH aceita `status` arbitrário sem passar pelas etapas de aprovação, e a criação aceita `requireApproval: false`. | `todogreen-enterprise-workflows.js` | **Aberta.** Reproduzida: `PATCH` com `status: approved` conclui o fluxo sem etapa, e a criação aceita `requireApproval: false`. |
| **L7** | A simulação oficial (`POST /api/todogreen/simulate` com `persist: true`) gravava cenário em `pricing_scenarios` para qualquer papel da vertical, enquanto a coleção de simulações e o Deal Desk exigem `pricing:simulate`. O cenário salvo entra no painel comercial e pode embasar um pedido ao Deal Desk. | `todogreen-core.js` | **Corrigida.** Reproduzida com um usuário de RH (200 e linha gravada); salvar agora exige `pricing:simulate`. Teste: `test/todogreen-simulate.worker.test.js`. |

As abertas mudam comportamento de telas (a Central Jurídica, por exemplo, grava
o status direto) ou pedem decisão de política (quem pode lançar em mês fechado);
cada uma pede o próprio PR, com teste que reproduza o contorno antes da correção.

Ainda sem decisão, fora da tabela: o cálculo sem gravar
(`POST /api/todogreen/calculate` e `simulate` sem `persist`) roda com os
parâmetros de preço do espaço para qualquer papel da vertical, embora ler esses
parâmetros exija `pricing:simulate`, `pricing:manage` ou o papel de auditor.
Nenhuma tela chama esses dois endpoints hoje.

## Jornada order-to-cash

O teste transversal `test/todogreen-erp-journey.worker.test.js` percorre, num
único caso, o caminho correto pelas APIs de negócio — e é a fonte de regressão
da jornada:

1. cliente / CRM · 2. oportunidade · 3. simulação persistida · 4. Deal Desk com
outro decisor · 4b. snapshot de viabilidade · 5. proposta · 6. aceite ·
7. tabela de preço · 8. contrato · 9. workflow Jurídico (pelo caminho de
`enterprise-workflows`) · 10. assinatura e aprovação (o anexo é inserido por SQL)
· 11. metodologia ESG · 12. operação · 13. preparação e ativação da implantação ·
14. OS com preço herdado · 15. execução (despacho com pré-flight PASS, vistoria
reprovada e aprovada, início e fim de jornada) · 16. ocorrência · 17. entrega +
POD · visão do Portal do Cliente · 18. faturamento · 19. CT-e preparado
internamente · 20. título a receber · 21. baixa · 22. razão quitado.

**Gates internos cobertos pela jornada:** Jurídico → contrato (409 antes do
Jurídico); assinatura → evidência; implantação ativa → OS; tabela de preço →
go-live. Os quatro estão implementados e testados, mas o do Jurídico e o da
assinatura têm lacuna (L1, L2) — a afirmação anterior de que "os atalhos foram
fechados" não se sustenta para eles.

**Fronteira externa:** CT-e autorizado só depois do retorno oficial da SEFAZ —
é o único `it.todo` do repositório.

**Homologação:** não registrada. O `docs/HOMOLOGACAO_GO_LIVE.md` lista como
pendente "homologar com dados/volume reais em produção".

## Jornadas internas

| Jornada | Implementado | Testado | Homologado | Observação |
| --- | --- | --- | --- | --- |
| Procure-to-pay (requisição → alçada → pedido → recebimento → estoque → conta a pagar) | Sim (com L3) | Parcial | Não registrado | `todogreen-purchasing.worker.test.js` cobre as etapas em casos separados, inclusive a alçada em várias faixas; envio e tesouraria não têm teste de worker. Liquidação bancária é externa. |
| Hire-to-pay (colaborador → folha/férias/rescisão → fechamento → contas a pagar) | Sim (com L3) | Sim | Não registrado | `todogreen-payroll.worker.test.js`. eSocial, FGTS Digital e banco são externos. |
| Jurídico / Qualidade / Marketing (abertura → aprovação sequencial → histórico → conclusão → recorrência) | Parcial (L6) | Parcial | Não registrado | Só o Jurídico tem teste; Qualidade, Marketing, geral e a recorrência não têm. |

## Prioridades resultantes

- **P0 — pré-flight no despacho automático: fechado.** `/dispatch/aplicar`
  registra o pré-flight, aplica a guarda canônica da rota, recusa BLOCK e exige
  justificativa em WARNING (`test/todogreen-dispatch.worker.test.js`).
- **P0 — produção só publica após gate de navegador: parcial.** `test:e2e:critical`
  é gate antes do merge e no fallback manual `deploy.yml`; dentro do Workers
  Builds ele não roda (o container não instala Chromium). Os E2E críticos
  conferem que as telas e os portais abrem com a sessão real, não efeitos de
  negócio.
- **P0 — lacunas de controle abertas (L1, L2, L3, L6):** cada uma em PR
  próprio, com teste que reproduza o contorno. L4, L5 e L7 foram corrigidas.
- **P1 — publicação automática da `main`:** em 24/09 a produção veio de
  publicação manual e estava atrás da `main`. Depois de um merge,
  `/api/system/version` deve responder o `sha` da `main` com
  `publishedBy: cloudflare-workers-builds`; conferir a configuração do Workers
  Builds (`docs/CLOUDFLARE_BUILDS_SETUP.md`).
- **P1 — proteger a `main`** por configuração do GitHub
  (`docs/GITHUB_MAIN_PROTECTION.md`, `scripts/github/protect-main.sh`); não é
  verificável pelo repositório.
- **P1 — homologar com dado real** e registrar na tabela de homologação: TRACK3R
  (evento real), importação de arquivo real, portal do cliente, e-mail no Worker
  `allgreen`.
- **P1 — tabelas da folha de 2026** e sua configuração fora do código.
- **P2 — capacidade:** o harness k6 (`scripts/load/todogreen-smoke.k6.js`) existe,
  mas não há resultado registrado em `docs/LOAD_TEST.md`.

## Divergências corrigidas nesta revisão

A versão anterior afirmava, e o código não confirma:

1. "Workflow Jurídico — ainda não é hard gate do contrato": é gate
   (`juridicoConcluido`), e a própria matriz dizia isso em outra linha.
2. "Jurídico no ciclo contratual — nenhum atalho interno" e "os quatro atalhos
   foram fechados": ver L1 e L2.
3. "Provedor de assinatura — estrutura de readiness existe": não há.
4. "Alçada de compras — faixas ainda são codificadas": já são configuráveis por
   espaço (0111), sem histórico de versões.
5. "Cotação / fornecedor — comparação de ofertas": não está no ERP.
6. "monday.com — sem conector backend ativo": o conector existe; falta a projeção.
7. "Seleção de motor — alternativas de rota ainda não conectadas": estão, fora do
   caminho Geoapify.
8. "Não há vertical Greenmob": há, só de frontend.
9. "Planejamento / aceite — capacidade, produto, risco e decisão persistidos":
   só a OS é persistida.
10. "Fechamento de competência — nenhum gap": ver L3.
11. "Folha — tabelas versionadas": só existe a tabela de 2025, no código.
12. "Webhooks de saída" REAL para o ERP: nenhum evento `todogreen_*` dispara.
13. "Negociação contratual — falta amarração com o status final": o status final
    já depende do Jurídico; o que falta é amarrar os pontos de negociação.
14. Qualidade, Marketing e processos gerais com "aprovação sequencial" e "motor
    REAL": a aprovação é contornável (L6) e só o Jurídico tem teste.
15. E-mail transacional como EXTERNO: está implementado e em uso.
16. Gmail/Agenda como só EXTERNO: há envio real pelo navegador.
17. O cabeçalho da seção de eletrificação dizia PARCIAL e que o snapshot de
    viabilidade ainda precisava de D1 e gate — ambos existem.
18. Contagens de testes citadas não batiam (ex.: 19 × 18 na tarifa ANEEL; 13 × 11
    no snapshot) — por isso a matriz deixou de citar contagem.
19. Caminhos errados: `design-system/…` fica em `src/design-system/…`.
20. Módulos inteiros ausentes — ver [Módulos que não estavam na matriz](#módulos-que-não-estavam-na-matriz).

## Como manter esta matriz

- Mudou o comportamento de um processo? Atualize a linha **no mesmo PR**.
- **Implementado** e **Testado** se provam com código e teste do repositório;
  **Homologado** só com linha nova no [registro de homologação](#registro-de-homologação-em-produção).
- Cite arquivo de teste e o nome do caso, não contagem de testes nem número de
  linha — os dois envelhecem calados.
- Os caminhos citados nos documentos são conferidos por
  `src/docs-references.test.js`: arquivo renomeado ou removido reprova o teste
  até a documentação acompanhar.
