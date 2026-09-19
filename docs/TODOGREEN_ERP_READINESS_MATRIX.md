# Matriz de prontidão do ERP To Do Green

Instantâneo originalmente aberto em 30/08/2026 e **revalidado em 13/09/2026** contra o `main` atual. O teste transversal `test/todogreen-erp-journey.worker.test.js` é a fonte de regressão da jornada order-to-cash. Os quatro antigos atalhos internos (Jurídico, evidência de assinatura, implantação ativa e tabela de preço real) já foram fechados; o único `it.todo` remanescente é a autorização oficial de CT-e pela SEFAZ, uma fronteira externa.

Esta matriz não mede se existe uma tela. Mede se o processo tem persistência real, regra de negócio no servidor, controle de acesso, trilha de auditoria e efeito verificável. Quando uma etapa depende de governo, banco, certificado, OAuth ou fornecedor, ela fica marcada como externa em vez de ganhar um falso status verde.

## Legenda

| Status | Critério |
| --- | --- |
| **REAL** | Executa e persiste o efeito de negócio no backend/D1, com regras server-side. |
| **PARCIAL** | O núcleo é real, mas existe gate contornável, handoff não obrigatório ou fechamento ainda incompleto. |
| **SIMULADO** | Calcula ou demonstra sem produzir o efeito de negócio que o nome sugere. |
| **EXTERNO** | O fechamento depende de autoridade, certificado, OAuth, banco, provedor ou infraestrutura fora do ERP. |

## Comercial, cliente e receita

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Cadastro de cliente / Conta 360 | **REAL** | `todogreen_clients`, carteira, contatos, revisão e auditoria | Fontes proprietárias de inteligência continuam externas |
| CRM / carteira | **REAL** | temperatura, estágio, decisores, contatos, responsáveis, comentários e ações persistidos | LinkedIn oficial não está integrado |
| Oportunidade | **REAL** | tabela própria, `revision`, vínculo por `client_id` e auditoria | Nenhum gap estrutural encontrado |
| Handoff de oportunidade ganha | **REAL** | `Fechada ganha` cria trabalho de implantação para Operações | Não substitui os gates de contrato/go-live |
| Precificação | **REAL** | motor no servidor, parâmetros versionados e cenário em `pricing_scenarios` | Dados externos de rota podem depender de serviço público, com fallback manual |
| Deal Desk | **REAL** | alçada calculada no servidor, segregação solicitante/decisor, versões e histórico | Nenhum gap estrutural encontrado |
| Proposta | **REAL** | cenário obrigatório e bloqueio server-side quando Deal Desk não liberou | Aceite do cliente ainda é um estado de negócio informado ao ERP |
| Contrato / versionamento | **REAL** | contrato só nasce de proposta aceita e cliente coerente, com SLA, faturamento, preço e auditoria | Aprovação, Jurídico e assinatura ainda têm gaps abaixo |
| Jurídico no ciclo contratual | **REAL** | workflow legal real, sequencial e auditável; a transição do contrato para aprovado/assinado consulta a conclusão do Jurídico no servidor | Nenhum atalho interno conhecido |
| Assinatura contratual | **REAL** | `signature_status=signed` exige documento assinado vinculado ao fluxo jurídico e registra status/data | Validade jurídica externa do provedor/certificado continua fora do ERP |
| Provedor de assinatura | **EXTERNO** | estrutura de readiness existe | Depende do provedor e do método de identidade/certificado aplicável |
| Implantação / go-live | **REAL** | readiness, centro de custo, dashboard, portal, tracking e ESG são reais; o gate consulta a tabela de preço e exige que exista, esteja ativa e pertença ao cliente/contrato | Integrações externas continuam dependendo dos provedores correspondentes |
| Portal do cliente | **REAL** | escopo vem da sessão/banco, com operações, solicitações, documentos e indicadores | Canais externos dependem dos provedores correspondentes |

## Operação, frota e execução

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Ordem de Serviço | **REAL** | contrato aprovado+assinado e implantação ativa são exigidos no servidor; preço é herdado e há máquina de estados | Nenhum atalho interno conhecido |
| Planejamento / aceite | **REAL** | capacidade, produto, risco e decisão persistidos | Fontes externas podem enriquecer rota/telemetria |
| Operação / viagem | **REAL** | `todogreen_client_operations` é fonte canônica compartilhada com o portal | Sincronização automática depende da integração configurada |
| Ocorrências / eventos | **REAL** | eventos, timeline, SLA e evidências persistidos | Nenhum gap estrutural encontrado |
| POD / comprovante | **REAL** | conclusão da OS é bloqueada sem POD; entrega pode gerar POD da OS vinculada | Captura física depende do canal/dispositivo |
| Portal do motorista | **REAL** | recorte por motorista, viagens e eventos próprios | GPS/hardware depende do dispositivo/rastreador |
| Frota | **REAL** | veículos, motoristas, custos, manutenção, disponibilidade e classes compatíveis | Telemetria depende do rastreador |
| TMS Track3r por arquivo | **REAL** | importação, deduplicação, atualização e casamento por CNPJ | Nenhuma credencial necessária |
| TMS Track3r API/webhook | **EXTERNO** | backend/readiness existem | Requer URL, token/webhook e teste real com fornecedor |
| Rastreamento / telemetria | **PARCIAL** | posições e ponte para operação existem | Só pode ser chamado conectado depois de sincronização/teste bem-sucedido |
| CIOT interno | **REAL** | payload, piso mínimo, estados, vínculo com OS e registro persistido | Emissão oficial é externa |
| CIOT oficial ANTT | **EXTERNO** | conector preparado | Exige conector/certificado e confirmação oficial |

## Fiscal, faturamento e financeiro

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Fila de faturamento | **REAL** | OS concluída + POD gera item elegível; conferência e fechamento persistem | Nenhum gap estrutural encontrado |
| Faturamento | **REAL** | billing run, invoice e título a receber são gerados | Documento fiscal oficial é outra etapa |
| Motor fiscal | **REAL** | cálculo, validação, XML/DACTE, referências, eventos e ciclo de vida | Transmissão oficial depende de integração externa |
| CT-e / MDF-e autorizado | **EXTERNO** | documento pode ser preparado e validado localmente | Só é autorizado depois do retorno oficial da SEFAZ; `CTE-*` interno não é autorização |
| NFS-e autorizada | **EXTERNO** | preparação interna possível | Depende de município/provedor e credenciais |
| Contas a receber | **REAL** | faturamento gera título e espelho no razão | Cobrança bancária automatizada é externa |
| Recebimento / baixa | **REAL** | parcial/integral, concorrência e espelho no razão | Liquidação/retorno bancário automático depende do banco |
| Tesouraria / conciliação | **REAL** | extrato, conciliação, saldo, aging e fechamento | Conexão bancária direta seria externa |
| Custos / rateios | **REAL** | rateio por OS, operação, cliente, contrato, veículo, fornecedor e centro de custo | Nenhum gap estrutural encontrado |
| Contas a pagar | **REAL** | compras e folha geram obrigações no razão | Pagamento bancário automático é externo |
| Fechamento de competência | **REAL** | período fechado bloqueia alteração posterior | Nenhum gap estrutural encontrado |

## Compras, suprimentos e estoque

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Requisição | **REAL** | itens, requisitante, centro de custo e estados persistidos | Nenhum gap estrutural encontrado |
| Alçada de compras | **REAL** | etapas por valor no servidor, segregação e recálculo do valor | Faixas ainda são codificadas; devem virar configuração versionada |
| Cotação / fornecedor | **REAL** | fornecedores e comparação de ofertas | Portal externo de fornecedor dependeria de integração |
| Pedido de compra | **REAL** | nasce de requisição aprovada, com aprovação e estados | Nenhum gap estrutural encontrado |
| Recebimento | **REAL** | idempotência, movimento de estoque e obrigação financeira | Nenhum gap estrutural encontrado |
| Estoque | **REAL** | entradas, saídas, transferências, contagens e saldos | WMS externo seria integração |
| Cadastros de suprimentos | **REAL** | materiais, depósitos e fornecedores persistidos e permissionados | Nenhum gap estrutural encontrado |

A suíte `todogreen-purchasing.worker.test.js` já funciona como teste transversal de **procure-to-pay**: requisição → aprovação → pedido → recebimento → estoque + conta a pagar, incluindo bloqueio de pulo de etapa e invalidação de aprovação quando o valor muda.

## RH, Departamento Pessoal e pessoas

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Cadastro de colaboradores | **REAL** | pessoas, vínculo, cargo, centro de custo, documentos e revisão | Nenhum gap estrutural encontrado |
| RH operacional / alocação | **REAL** | disponibilidade, escalas e vínculos operacionais | Ponto/benefícios podem depender de terceiros |
| Folha | **REAL** | cálculo, itens, fechamento/reabertura e tabelas versionadas | Obrigações oficiais precisam de transmissão externa |
| Férias | **REAL** | cálculo, status e lançamentos financeiros | Governo/banco são externos |
| Rescisão | **REAL** | cálculo, desligamento e obrigações financeiras | eSocial/FGTS Digital/banco são externos |
| eSocial / obrigações trabalhistas | **EXTERNO** | cálculo interno não é transmissão | Exige integração e credenciais oficiais |
| Pagamento bancário da folha | **EXTERNO** | contas a pagar são geradas | Requer banco/CNAB/API |

## Jurídico, Qualidade, Marketing e processos internos

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Workflow Jurídico | **REAL** | processos, eventos, responsáveis, duas aprovações e histórico | Ainda não é hard gate do contrato |
| Negociação contratual | **REAL** | vínculo com cliente/contrato, pontos e histórico podem ser persistidos | Falta amarração obrigatória com o status final do contrato |
| Qualidade / CAPA / não conformidade | **REAL** | aprovação sequencial Operação + Qualidade/Auditoria | Certificadoras externas continuam externas |
| Marketing / campanhas | **REAL** | workflow persistido; orçamento eleva alçada para liderança/financeiro | Publicação em canais externos depende do canal |
| Processos internos gerais | **REAL** | responsável, prazo, status, aprovação, histórico e recorrência | Casos específicos podem exigir template/regra própria |
| Planner / Projetos / Work Center | **REAL** | tarefas, membros, visibilidade, boards, recorrência e handoffs | Nenhum gap transacional crítico encontrado |
| Metas | **REAL** | CRUD, check-ins, aprovação e permissões | Nenhum gap estrutural encontrado |
| Governança / auditoria | **REAL** | trilha de auditoria e eventos de negócio | Política de retenção/backup deve ser definida operacionalmente |

## ESG, evidências e documentos

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Impacto ambiental | **REAL** | cálculo auditável com inputs, metodologia e versões | Fatores precisam de governança quando atualizados |
| Green Score | **REAL** | score persistido, pesos versionados e componentes abertos | É indicador proprietário, não certificação |
| Evidências ESG/operacionais | **REAL** | vínculo por cliente/cálculo e rastreabilidade | Evidência de terceiro depende da fonte |
| Cofre de documentos | **REAL** | upload interno, SHA-256, versionamento, download autenticado e referência externa | Arquivos grandes usam referência externa |
| Documento contratual | **REAL** | arquivo pode ser guardado/versionado e a transição para `signed` exige evidência assinada vinculada ao fluxo jurídico | Provedor de assinatura/certificado permanece externo |

## Integrações

| Integração / capacidade | Status | Situação |
| --- | --- | --- |
| Cloudflare Worker + D1 + Cron | **REAL** | infraestrutura nativa ativa |
| Versão publicada (`GET /api/system/version`) | **REAL** | SHA, `buildTime`, `branch`, `publishedBy`, `environment` (var do Worker) e migrations esperadas, a partir do manifesto do build — sem segredo; público como `/api/status` |
| Saúde do sistema (Administração) | **REAL** | `GET /api/todogreen/system-health` (sessão + `integration:manage`/`audit:read`) → componentes (Worker, App, D1 c/ latência e migrations aplicadas × esperadas, R2, IA, busca) e integrações da seção 113 com estado canônico (`systemHealthDomain` reaproveita `integrationStatusDomain`), métricas por integração (migration `0120`: latência, volume, último sucesso/falha) e alertas nomeados (`D1_BEHIND_CODE`, `CLIENT_SERVER_MISMATCH`); testes unitários + worker. Integração só vira *Operacional* com teste/sincronização real |
| Automações internas | **REAL** | executadas no servidor e persistidas |
| Webhooks de saída | **REAL** | motor existe; destino precisa estar configurado |
| API pública / idempotência | **REAL** | infraestrutura disponível |
| Pesquisa web pública | **PARCIAL** | funciona conforme provedores disponíveis; qualidade depende da fonte |
| IA BYOK | **PARCIAL** | motor existe; cada provedor depende da conta/chave e teste positivo |
| E-mail transacional | **EXTERNO** | exige provedor/remetente |
| WhatsApp | **EXTERNO** | exige instância/Meta, chave e webhook conforme solução |
| Google Login | **PARCIAL** | login OAuth não equivale a Gmail/Agenda |
| Gmail / Google Agenda | **EXTERNO** | OAuth e escopos por usuário |
| Microsoft 365 | **EXTERNO** | Graph/Entra ainda não conectado |
| LinkedIn oficial | **EXTERNO** | pesquisa pública não equivale à API do LinkedIn |
| monday.com | **EXTERNO** | sem conector backend ativo |
| Power BI | **EXTERNO** | sem conector backend ativo |
| SEFAZ | **EXTERNO** | certificado + homologação + transmissão |
| ANTT CIOT | **EXTERNO** | conector + certificado + confirmação oficial |
| Track3r API/webhook | **EXTERNO** | só vira conectado após sincronização real |

## Jornada order-to-cash auditada

O teste transversal `test/todogreen-erp-journey.worker.test.js` percorre o caminho correto pelas APIs de negócio:

1. cliente / CRM
2. oportunidade
3. simulação persistida
4. Deal Desk com outro decisor
5. proposta
6. aceite
7. tabela de preço
8. contrato
9. workflow Jurídico completo
10. assinatura e aprovação registradas
11. metodologia ESG
12. operação real
13. preparação e ativação da implantação
14. OS com preço herdado
15. execução
16. ocorrência
17. entrega + POD
18. faturamento
19. CT-e preparado internamente
20. título a receber
21. baixa
22. razão quitado

### Gates internos da jornada

Os quatro atalhos internos que esta matriz registrava foram fechados e estão cobertos no happy path transversal:

1. **Jurídico → contrato:** aprovado/assinado exige workflow jurídico concluído.
2. **Assinatura → evidência:** `signed` exige documento assinado vinculado.
3. **Implantação → OS:** a OS exige `client_activation_state.status=active`.
4. **Tabela de preço → go-live:** o readiness valida existência, estado ativo e vínculo correto da tabela.

O limite restante não é um bug interno: **CT-e autorizado é EXTERNO** e só pode aparecer como autorizado após retorno oficial da SEFAZ. O teste transversal mantém exatamente esse caso como `it.todo`.

## Jornadas internas auditadas

**Procure-to-pay:** requisição → alçada → pedido → envio → recebimento → estoque → conta a pagar → tesouraria. Núcleo **REAL**. Liquidação bancária automática **EXTERNA**.

**Hire-to-pay / DP:** colaborador → folha/férias/rescisão → fechamento → obrigação financeira → contas a pagar. Núcleo **REAL**. eSocial, FGTS Digital e banco **EXTERNOS**.

**Legal / Quality / Marketing:** abertura → responsável → aprovação sequencial → histórico → conclusão → recorrência. Motor **REAL**. Integrações/autoridades externas ficam separadas.

## Prioridades resultantes

**P0:** impedir bypass do pré-flight no despacho automático — **FECHADO nesta rodada de hardening**: `/dispatch/aplicar` registra o pré-flight, aplica a mesma guarda canônica da rota, recusa BLOCK, exige justificativa para WARNING e grava `preflight_id/status`.

**P0:** produção só publica após gate mínimo de navegador — **PARCIAL (honesto)**: a suíte `test:e2e:critical` existe e é gate obrigatório **antes do merge** (local/sessão remota) e no fallback manual `deploy.yml` (instala Chromium); dentro do Workers Builds ela **não roda** — o container não instala navegador e a tentativa de embutir o Playwright no `deploy:cloudflare` (`cd8f90b`, 13/09) travou a publicação da `main` até ser revertida. Fechar de verdade exige o runner self-hosted (`GITHUB_SELF_HOSTED_RUNNER.md`) ou proteger a `main` com PR obrigatório + gate declarado (P1 abaixo) — decisão da titular.

**P1:** proteger `main` por configuração administrativa do GitHub (PR obrigatório e bloqueio de push direto). Esta proteção não é representável apenas por código versionado.

**P1:** manter esta matriz sincronizada com `test/todogreen-erp-journey.worker.test.js` e com o runbook.

**P2:** medir capacidade com o harness k6 em `scripts/load/todogreen-smoke.k6.js`; sem execução controlada não existe número honesto de usuários simultâneos.

## Eletrificação, roteirização e viabilidade (camada de decisão)

Iteração recente: módulos de domínio PUROS, DETERMINÍSTICOS e testados que
transformam frota/rota/energia/restrições em decisão. Seguindo o critério
honesto desta matriz, ficam **PARCIAL** enquanto não têm persistência D1
dedicada e UI própria — o núcleo (regra + teste) é real e parte já responde por
endpoint. Não são marcados REAL para não inflar status (seções 14, 55).

**Reconciliação puro→conectado (sem 3ª camada):** a regra de decisão mora num
único domínio puro e o caminho conectado o REUSA — não há reimplementação no
worker. Hoje o `POST /routes/electric-plan` já devolve, sobre o MESMO par
veículo/rota, `energyEstimate` (energia/autonomia), `routingEngineSelection`
(OSRM×Valhalla) e `preflight` (PASS/WARNING/BLOCK + sugestões calculadas).
Faltam ligar ao caminho conectado, nesta ordem de valor: `viabilitySnapshot`
(persistência D1 + bloqueio de avanço da proposta) e a aplicação de
`dataProvenance` campo a campo na UI. `roadRestriction` só vira efetivo com o
grafo OSM/PostGIS carregado.

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Estimativa de energia/autonomia | **REAL** | `energyEstimationDomain` (puro) consumido pelo electric-plan, pelo pré-flight e pela **viabilidade persistida** (`POST /api/todogreen/viability-snapshots`, energia estimada no servidor); **elevação** via Valhalla `/height` (DEM aberto, cache 30 d) e **temperatura** na hora de saída via Open-Meteo (cache 1 h) preenchem o que o chamador não informou, com proveniência (`DERIVED`/`EXTERNAL`) — indisponível vira `ELEVATION_NOT_AVAILABLE`/`WEATHER_NOT_AVAILABLE` e confiança menor, nunca número inventado; **baseline por veículo** (`todogreen_vehicle_energy_observations`, mediana/p90/correção sobre o nominal) pronto para substituir o consumo nominal | Ingestão automática de observações por telemetria/OCPP ainda não ligada (hoje POST manual/importado); relevo depende dos tiles do Valhalla |
| Tarifa de energia de referência (ANEEL) | **REAL** | `energyTariffDomain` (puro, 19 testes): hierarquia **contrato > informada > ANEEL > fallback declarado** com proveniência (INFORMED/EXTERNAL/DERIVED), curva 24 h por posto (ponta/fora/intermediário; faixas da distribuidora ou da tarifa branca como *assumption*), vigência e `stale`; cache `todogreen_energy_tariff_reference` ingerido do datastore de dados abertos da ANEEL (só *Tarifa de Aplicação* em MWh, por distribuidora/subgrupo/modalidade do **perfil de energia** do espaço — `todogreen_energy_profiles`, `GET/PUT /api/todogreen/energy/profile`); `GET /api/todogreen/energy/plan` devolve a tarifa em uso com origem, data da fonte e vigência; Saúde do sistema mostra a fonte (NOT_CONFIGURED sem perfil, STALE quando velha) | Faixas horárias de ponta por distribuidora não vêm da ANEEL (informadas no perfil ou régua padrão); a lista de distribuidoras é a sigla `SigAgente` do datastore |
| Preço de diesel de referência (ANP) | **REAL** | `anpDieselPriceDomain` (puro): parser do CSV oficial do levantamento (`;`, vírgula decimal, dd/mm/aaaa, BOM), agregação em **mediana por município/UF/região/país e semana** — nenhum posto/CNPJ retido — e `resolveDieselPrice` pela hierarquia **contrato > frota > ANP município > UF > região > país > fallback** com `stale` (21 d); ingestão semanal pelo cron (arquivo "últimas 4 semanas") ou `POST /api/todogreen/energy/anp/import`; o plano devolve o preço com origem, data de coleta e amostras | Série histórica longa não é ingerida (só o arquivo corrente das últimas semanas); município precisa estar grafado como na ANP (maiúsculas, sem acento — normalizado) |
| Janela energética de recarga (ONS) | **REAL** | `gridWindowDomain` (puro, 14 testes): perfil médio das 24 h da **curva de carga horária do SIN** por subsistema (ONS, dados abertos; cache `todogreen_grid_load_profiles`, ingestão diária) → janela **financeira** (menor tarifa), **energética** (menor carga do SIN — proxy de sistema leve, não medição de carbono) e **recomendada** (ponderada 60/40) restritas às horas em que a frota está parada (retorno→saída; sem retorno, 12 h antes da saída como *assumption* declarada); sem ONS a energética é `ONS_NOT_AVAILABLE` e a recomendada iguala a financeira | Sem fator de emissão horário (o ONS não publica intensidade de carbono horária em dado aberto estável); pesos fixos 60/40 |
| Plano de recarga por veículo (Smart Charging) | **REAL** | `planoDeRecargaPorVeiculo` (`smartChargingDomain`, 8 testes): veículos × pontos × curva tarifária × demanda contratada → agenda determinística (saída mais cedo primeiro; horas mais baratas em que o veículo está parado; potência = mín(ponto, veículo, folga da demanda); um ponto por veículo por hora) com sessões (início/fim/kW/kWh/custo), **motivo** para quem não fecha a energia (sem ponto compatível, demanda limitante, horas insuficientes), pico kW, custo e economia vs. hora mais cara; servido em `GET /api/todogreen/energy/plan` a partir da frota elétrica (bateria × (1 − SOC de chegada)) e dos pontos cadastrados; tela Energia (`EnergyReferenceSection`) mostra tudo com origem e premissas | Slots de 1 h e potência constante (sem curva de carga da bateria); SOC de chegada é um valor único do perfil (não por veículo/telemetria); não envia comandos OCPP |
| Radar de mercado — fontes estruturadas (PNCP · Compras.gov · GDELT) | **REAL** | `marketSignalDomain` (puro, 9 testes): normalização das três fontes num só `market_signal`, **fingerprint** determinístico (número de controle do PNCP > URL canônica > título) para dedupe entre fontes e execuções, **score explicável** (cada ponto com motivo; rejeições contadas por motivo: fora de escopo, equipamento incompatível, sem transporte, prazo/processo encerrado) e o mesmo léxico do radar web; `todogreen-market-signals.js`: sync PNCP (API de busca do portal, editais recebendo proposta), Compras.gov (contratações Lei 14.133, pregão/concorrência) e GDELT (DOC 2.0, país BR, 1 termo por hora), cron auto-limitado, `GET /api/todogreen/market-signals` (filtros por fonte/UF/score/status) com triagem por espaço (`PATCH …/:id`), `POST …/sync`; Saúde do sistema com data da fonte/ingestão; painel na Inteligência (RFQs/RFIs) ao lado do radar web — e o endpoint `/api/todogreen/market-radar` da tela, que estava sem rota, voltou a ser servido | Compras.gov filtra só pelas modalidades configuradas; GDELT depende do limite de taxa da fonte (1 consulta/5 s); UF de foco entra como bônus no score, não como filtro obrigatório. **Complementos (rodada 3):** termos PNCP/GDELT e UFs de foco **configuráveis por espaço** (`todogreen_market_radar_prefs`, migration `0133`; `GET/PUT /api/todogreen/market-signals/prefs`; a sincronização manual usa os do espaço, o cron a união padrão + espaços) e **"Criar oportunidade"** a partir do sinal (`POST …/:id/opportunity` → mesma esteira de `records/opportunities`, triagem `converted` com o id; exige `market:research` + `crm:manage`) |
| Risk Map — risco viário histórico (PRF · ANTT) | **REAL** | `roadRiskDomain` (puro, 10 testes): parser do CSV oficial da PRF (ocorrências com lat/lon, UPS DENATRAN 1/5/13) → **células de ~1,1 km**; parser do demonstrativo por km da ANTT → **segmentos rodovia/km**; `riscoDaRota` amostra o traçado a cada 250 m e devolve score 0–100 (UPS/km saturada), trechos críticos, confiança e metodologia; sem índice → `RISK_DATA_NOT_AVAILABLE` (nunca zero). `todogreen-road-risk.js`: `POST /api/todogreen/risk/import/prf` (CSV, teto 40 MB), ANTT via CKAN um recurso por hora (cron), `POST /api/todogreen/risk/route`, `GET /api/todogreen/risk/status`; Saúde do sistema com PRF/ANTT reais | Sem fator de exposição (VDM) — o score compara trechos pela UPS histórica, não calcula probabilidade; ANTT não traz gravidade (UPS = 1 por acidente); PRF exige importação manual (links da fonte em armazenamento sem API) |
| Alternativas de rota com risco como custo | **REAL** | `POST /api/todogreen/maps/route` aceita `alternatives: true` → OSRM (`alternatives=true`, `steps` para refs das vias) ou Valhalla (`alternates: 2`); cada rota recebe `risk` (Risk Map) e `roadRefs`; `rankRouteAlternatives` (routeAlternativesDomain, agora **conectado**) devolve `ranking` (mais rápida, menor custo total com risco como dinheiro, menor risco, menor consumo, equilibrada); Roteirização mostra o cartão *Risco viário histórico* (score, ocorrências, vias, avisos por rodovia) e as alternativas com "Usar esta rota" | Custo monetário usa a régua padrão (`DEFAULT_COST_ASSUMPTIONS`); Valhalla alternativas dependem do servidor self-hosted. **Complemento (rodada 3):** com `tolls: true` o backend conta as praças da ANTT em CADA alternativa (mesma consulta da tela, injetável) e, com a tarifa média informada (`tollPerPlaza`, vinda do campo da Roteirização), o pedágio entra no custo total do ranking; sem tarifa a contagem aparece e a nota do ranking declara que o pedágio valeu 0; a ANTT não publica tarifa nem cobre concessões estaduais |
| Design system — tokens canônicos, aliases legados e regressão visual (P1.4) | **REAL** | Um único bloco canônico `.tdg` em `LogisticsVertical.css` (claro) + `:root[data-theme="dark"] .tdg` (escuro) com os valores efetivos de antes (o segundo bloco `.tdg` que sobrescrevia bg/card/muted/line/shadow foi removido); **16 aliases legados** (`--tdg-surface`, `--tdg-text`, `--tdg-border`, `--tdg-danger`, `--tdg-warning`, `--tdg-primary`, `--tdg-accent`…) que só valiam pelo fallback passam a existir com o valor do fallback predominante e a seguir o tema escuro; `--ds-*` continua em `design-system/tokens.css`; **guarda** `design-system/designTokens.test.js` (sem duplicata por arquivo+seletor, tokens de base num arquivo só, todo `var(--tdg-…)` definido); **regressão visual** numa suíte só (`playwright.visual.config.js` + `e2e/visual/regressao-visual.spec.js`, consolidando o spec do PR #371 e o porte do Codex): 16 telas do ERP em desktop claro e escuro, 8 em mobile, portal TMS e entrada dos portais externos, relógio congelado, máscaras para relógio/versão/latência/mapa, baselines versionados em `e2e/visual/__baselines__/` — ao lado dos e2e de layout e legibilidade já existentes | `--ds-*` referenciam `--tdg-*` com fallback no `:root`, então herdam o tema só quando o `.tdg` está acima — fora da vertical valem os fallbacks; baselines gerados na sessão remota (Chromium/Linux); o caminho Docker (`npm run test:visual:docker`) ainda não foi exercitado — ver `docs/VISUAL_REGRESSION.md` |
| Green On — pontos de recarga próprios e OCPP | **PARCIAL** | Cadastro de pontos (`todogreen_charging_points`, servem pesado, mapa da Roteirização), plano de recarga por veículo (P4) e status OCPP **PREPARED** (`ocppStatus`: catálogo/probe, sem sessão viva). **Na `main` pelo Codex (`c38c627`, migration `0130`):** sessões de recarga com energia **MEDIDA** por medidor (`todogreen_charging_sessions`, `source` manual hoje, `ocpp` reservado), **reservas** de carregador e **regras de preço por kWh** (base/segmento/cliente, `chargingBillingDomain`), servidas como coleções de `records` e com telas próprias (Sessões, Reservas, Cobrança) | Sem CSMS/OCPP conectado: nenhum comando de recarga sai do sistema e a sessão nasce digitada (a medição automática entra quando a central alimentar `source: ocpp`); a energia medida das sessões ainda não alimenta o baseline de consumo do veículo (P3) — ligação natural, não feita — decisão de produto/infra (P7) |
| GreenPay — razão interno e repasse | **REAL (razão) / EXTERNAL (repasse)** | Ledger interno operacional (`greenpay` OPERATIONAL na Saúde do sistema); **fase 2 na `main` pelo Codex (`0131`)**: contratos de ganho fixo mensal do motorista (`todogreen_driver_earning_contracts`) com "gerar mês" explícito e referência única anti-duplicata (`greenPayStatementDomain`); repasse PIX via SysPag **NOT_CONFIGURED** sem `SYSPAG_API_TOKEN` — "pago" é só o razão interno, declarado | Dinheiro só sai quando o token existir e o contrato de repasse for definido pela titular (P7) |
| Core All Green / Greenmob — identidade e multi-vertical | **PREPARADO** | `tenant_id` único (`todogreen`), espaços por `workspace_owner_id`, SSO interno ERP/TMS/Central da Frota com portais externos isolados (guarda estática, #358); referências públicas (energia, mercado, risco) já são tenant-wide para reuso por outra vertical | Não há vertical Greenmob nem catálogo compartilhado ainda; identidade multi-tenant real exige decisão de arquitetura (P7) |
| Seleção de motor OSRM×Valhalla | **REAL** | `routingProvidersDomain` + `routing-providers.js`: `POST /api/todogreen/maps/route` recebe `vehicle`, escolhe o motor pela classe/restrição (`routingEngineSelectionDomain`), chama OSRM (próprio → público como contingência declarada) ou **Valhalla real** (truck costing com altura/largura/comprimento/peso/eixos/hazmat, polyline6 → GeoJSON) e devolve o mesmo formato à tela com `engine/profile/fallback`; pesado sem Valhalla → `NO_SAFE_ROUTING_ENGINE` (409). Catálogo/probe (`/status`) e Saúde do sistema; `infra/tms-routing` com serviço `valhalla` atrás do gateway | Valhalla precisa existir (self-hosted); alternativas de rota (seção 83) ainda não conectadas |
| Restrições viárias (OSM) | **PARCIAL** | `roadRestrictionDomain` (13 testes): tags maxheight/weight/width/length/hgv/access → compatibilidade e rota mais curta compatível com motivo | Depende do grafo OSM local/PostGIS com as tags carregadas em lote |
| Snapshot de viabilidade | **REAL** | `viabilitySnapshotDomain` (puro, 13 testes) + tabela `todogreen_viability_snapshots` (migration `0121`, append-only, `UNIQUE(owner, oportunidade, cenário, versão)`) + `GET/POST /api/todogreen/viability-snapshots` (permissão, energia ESTIMADA no servidor pelo `energyEstimationDomain`, proveniência em `dataSources`, auditoria `viability.calculated`) + painel na oportunidade (última versão, faltas, proveniência expansível, recálculo) + **gate server-side**: proposta ligada a oportunidade só é liberada (sent/approved/accepted, no POST e na transição do PATCH) com snapshot sem faltas, e grava em `campos.viabilidade` qual versão a autorizou; testes worker dedicados + jornada order-to-cash com o passo de viabilidade | Snapshot parte de números informados/estimados; elevação e clima reais dependem de fonte DEM/clima (P3) |
| Pré‑flight operacional | **REAL** | `preflightDomain` (13 testes): PASS/WARNING/BLOCK (motorista/veículo/capacidade/autonomia/SLA) + sugestões CALCULADAS; **agora persistido e ligado à rota** (migration `0132`, `todogreen_preflight_results` só-INSERT + `preflight_id`/`preflight_status` em `todogreen_routes`): `POST /api/todogreen/preflight` resolve a entrada pelo **cadastro** (motorista: disponibilidade e CNH; veículo da frota: status, documentos, manutenção, capacidade, bateria, consumo, SOC da telemetria; pontos de recarga próprios + carregadores do mapa; veículos alternativos disponíveis), roda o domínio e grava checagens, sugestões, energia e proveniência; **gate server-side** na coleção `rotas` (`guardaDeEscrita`): atribuir/mudar o par motorista+veículo+paradas exige pré-flight do MESMO par (assinatura `routeFingerprint`), dentro do prazo (`TDG_PREFLIGHT_TTL_HOURS`, 24 h), não-BLOCK — WARNING só com justificativa, gravada na linha e na auditoria (`preflight.overridden`); editar nome/notas/status não reabre o gate; sem veículo da frota é WARNING honesto, nunca PASS por omissão; **Roteirização** ganhou o passo "Rodar pré-flight" (veículo da frota, checagens, sugestões, justificativa) e o botão de atribuir obedece à mesma régua (`decisaoDoPreflight`); 13 testes de worker (gate, override, kill switch, fila) + 3 de endpoint do electric-plan continuam | Rotas criadas pelo **despacho automático** (`todogreen-dispatch.js`) **agora passam pelo gate**: `/dispatch/aplicar` registra o pré-flight, aplica a mesma guarda canônica da rota, recusa BLOCK, exige justificativa em WARNING e grava `preflight_id`/`preflight_status` (cobertura em `test/todogreen-dispatch.worker.test.js`) — coerente com o P0 marcado FECHADO na seção "Prioridades resultantes"; jornada e treinamento do motorista não são rastreados no cadastro (não entram como checagem); `TDG_PREFLIGHT_GATE_DISABLED=1` desliga só o gate (decisão da titular; padrão ligado) |
| Action Queue — fila de ação operacional | **REAL** | Reutiliza a Central de Trabalho: checagens BLOCK/WARNING do pré-flight e **risco viário alto** do traçado (Risk Map, score ≥ `TDG_RISK_ACTION_THRESHOLD`, padrão 60) viram itens `plano-de-acao` no quadro seed **Torre de Controle** (`enfileirarAcoesOperacionais`, `todogreen-work-center.js`), com prioridade (alta para BLOCK/risco), descrição com motivo e sugestões calculadas, `relations` para pré-flight/rota/motorista/veículo e **dedupe** por `fields.sourceKey` (a mesma causa no mesmo par não duplica item aberto) — sem entidade paralela | Sem fechamento automático do item quando a causa é resolvida (o operador conclui no quadro); sem notificação push além do que a Central já faz |
| Proveniência de dados | **PARCIAL** | `dataProvenanceDomain` (12 testes): envelope medido×estimado, frescor (stale), melhor fonte por hierarquia | Aplicação campo a campo nas telas ainda a fazer |
| Perfil físico/energético do veículo | **REAL** | `todogreen_fleet_vehicles` ganhou altura/largura/comprimento/tara/PBT/eixos/conector/potência de recarga/consumo de referência (migration `0123`), gravados no cadastro (POST/PATCH `/api/todogreen/fleet`) e no formulário da Frota; alimentam o truck costing do Valhalla e o pré-flight | Preenchimento depende da operação |
| Fila offline do motorista | **REAL (núcleo)** | `driverOfflineQueueDomain` (12 testes) extraído do `DriverPortalPage` e consumido pelo dreno: dedupe idempotente, colapso de singletons, ordem, remoção por chave | Chave determinística por parada (evitar duplicidade em clique repetido no servidor) fica como próximo passo com id de parada |

Todos os módulos acima entram na suíte `npm run test:unit` e não dependem de
credencial externa para rodar. O que os torna REAL de ponta a ponta é
persistência D1 + UI no momento da decisão (seção 50) + auditoria — o backlog
está nomeado acima, sem status verde antecipado.
