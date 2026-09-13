# Matriz de prontidão do ERP To Do Green

Instantâneo de 30/08/2026, revisado em 01/09/2026 e ainda coerente com o estado
atual: as fronteiras marcadas aqui como PARCIAL/EXTERNO são exatamente os gates
guardados pelo teste transversal `test/todogreen-erp-journey.worker.test.js`
(os `it.todo` do fim do arquivo). Reveja esta matriz sempre que um desses gates
fechar.

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
| Jurídico no ciclo contratual | **PARCIAL** | workflow legal real, sequencial e auditável | O contrato ainda consegue ser aprovado/assinado sem o workflow jurídico ter terminado |
| Assinatura contratual | **PARCIAL** | status e data ficam persistidos | `signature_status=signed` ainda pode entrar pelo payload sem evidência de assinatura obrigatória |
| Provedor de assinatura | **EXTERNO** | estrutura de readiness existe | Depende do provedor e do método de identidade/certificado aplicável |
| Implantação / go-live | **PARCIAL** | readiness, centro de custo, dashboard, portal, tracking, ESG e ativação são reais | `priceTableId` hoje é testado por presença, não por existência de tabela real; além disso a OS não exige implantação ativa |
| Portal do cliente | **REAL** | escopo vem da sessão/banco, com operações, solicitações, documentos e indicadores | Canais externos dependem dos provedores correspondentes |

## Operação, frota e execução

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Ordem de Serviço | **PARCIAL** | contrato aprovado+assinado é exigido, preço é herdado e há máquina de estados | Falta exigir `client_activation_state.status=active`; hoje a OS consegue pular implantação |
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
| Documento contratual | **PARCIAL** | arquivo pode ser guardado e versionado | `signed` ainda não exige apontar para a evidência assinada |

## Integrações

| Integração / capacidade | Status | Situação |
| --- | --- | --- |
| Cloudflare Worker + D1 + Cron | **REAL** | infraestrutura nativa ativa |
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

### O que ainda impede chamar o ciclo de “sem atalhos”

A auditoria encontrou quatro gates internos que precisam ser endurecidos:

1. **Jurídico → contrato:** o workflow existe, mas o contrato ainda não consulta sua conclusão antes de aceitar `approved`/`signed`.
2. **Assinatura → contrato:** `signature_status=signed` ainda não exige evidência de assinatura vinculada.
3. **Implantação → OS:** a implantação pode ser feita corretamente, mas a criação da OS ainda não exige que ela esteja `active`.
4. **Tabela de preço no go-live:** o readiness verifica se o contrato contém um `priceTableId`, mas ainda não confirma se essa tabela existe, está ativa e pertence ao mesmo espaço/cliente.

O quinto limite não é um bug interno: **CT-e autorizado é EXTERNO** e só deve aparecer como autorizado após retorno oficial da SEFAZ.

O teste transversal segue deliberadamente o caminho correto e deixa esses cinco pontos como `it.todo`. Eles são backlog técnico explícito, não aprovação silenciosa de atalhos.

## Jornadas internas auditadas

**Procure-to-pay:** requisição → alçada → pedido → envio → recebimento → estoque → conta a pagar → tesouraria. Núcleo **REAL**. Liquidação bancária automática **EXTERNA**.

**Hire-to-pay / DP:** colaborador → folha/férias/rescisão → fechamento → obrigação financeira → contas a pagar. Núcleo **REAL**. eSocial, FGTS Digital e banco **EXTERNOS**.

**Legal / Quality / Marketing:** abertura → responsável → aprovação sequencial → histórico → conclusão → recorrência. Motor **REAL**. Integrações/autoridades externas ficam separadas.

## Prioridades resultantes

**P0:** tornar o repositório privado.

**P0:** fechar os gates Jurídico → contrato, evidência → assinatura e implantação ativa → OS.

**P0:** manter CT-e/MDF-e com status local até confirmação oficial da SEFAZ.

**P1:** validar existência/estado/escopo da tabela de preço no gate de implantação.

**P1:** transformar alçadas de compras codificadas em configuração versionada e auditável.

**P1:** manter testes transversais permanentes para order-to-cash, procure-to-pay e hire-to-pay, além das suítes por módulo.

## Eletrificação, roteirização e viabilidade (camada de decisão)

Iteração recente: módulos de domínio PUROS, DETERMINÍSTICOS e testados que
transformam frota/rota/energia/restrições em decisão. Seguindo o critério
honesto desta matriz, ficam **PARCIAL** enquanto não têm persistência D1
dedicada e UI própria — o núcleo (regra + teste) é real e parte já responde por
endpoint. Não são marcados REAL para não inflar status (seções 14, 55).

| Processo | Status | O que já é real | Fronteira encontrada |
| --- | --- | --- | --- |
| Estimativa de energia/autonomia | **PARCIAL** | `energyEstimationDomain` (puro, 13 testes): elevação, carga, temperatura, SoH, SOC de chegada/mínimo, proveniência e confiança; contrato versionado (`energy-model@1.0.0`); anexado ao `POST /routes/electric-plan` como `energyEstimate` | Sem UI dedicada e sem telemetria medida por sessão (kWh é ESTIMADO); elevação/temperatura reais dependem de fonte DEM/clima |
| Seleção de motor OSRM×Valhalla | **PARCIAL** | `routingEngineSelectionDomain` (11 testes): classe/restrição → motor, fallback seguro; exposto no `electric-plan` como `routingEngineSelection` a partir de `TDG_OSRM_BASE_URL`/`TDG_VALHALLA_BASE_URL` | Valhalla/OSRM auto‑hospedados ainda não conectados (infra `infra/tms-routing`) |
| Restrições viárias (OSM) | **PARCIAL** | `roadRestrictionDomain` (13 testes): tags maxheight/weight/width/length/hgv/access → compatibilidade e rota mais curta compatível com motivo | Depende do grafo OSM local/PostGIS com as tags carregadas em lote |
| Snapshot de viabilidade | **PARCIAL** | `viabilitySnapshotDomain` (13 testes): imutável, versionado por conteúdo (FNV‑1a), consome a estimativa de energia, bloqueio de avanço | Sem tabela D1 própria e sem tela; persistência via handler ainda a ligar |
| Pré‑flight operacional | **PARCIAL** | `preflightDomain` (7 testes): PASS/WARNING/BLOCK (motorista/veículo/capacidade/autonomia/SLA) + sugestões CALCULADAS (trocar veículo, inserir recarga, reduzir carga, dividir viagem) | Sem persistência de auditoria dedicada e sem UI; consome disponibilidade informada |
| Proveniência de dados | **PARCIAL** | `dataProvenanceDomain` (12 testes): envelope medido×estimado, frescor (stale), melhor fonte por hierarquia | Aplicação campo a campo nas telas ainda a fazer |
| Fila offline do motorista | **REAL (núcleo)** | `driverOfflineQueueDomain` (12 testes) extraído do `DriverPortalPage` e consumido pelo dreno: dedupe idempotente, colapso de singletons, ordem, remoção por chave | Chave determinística por parada (evitar duplicidade em clique repetido no servidor) fica como próximo passo com id de parada |

Todos os módulos acima entram na suíte `npm run test:unit` e não dependem de
credencial externa para rodar. O que os torna REAL de ponta a ponta é
persistência D1 + UI no momento da decisão (seção 50) + auditoria — o backlog
está nomeado acima, sem status verde antecipado.
