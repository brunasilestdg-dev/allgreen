# Propriedade de dados da plataforma All Green

Status: decisão arquitetural vigente.

Esta decisão vale para o ERP To Do Green, TMS, Portal do Motorista, Portal do Cliente, APIs e integrações. Uma interface pode exibir dados de outro domínio, mas não passa a ser dona deles por isso.

## Matriz oficial

| Dado ou processo | Dono | Fonte canônica | Quem pode escrever | Consumidores |
|---|---|---|---|---|
| Cliente, contatos e carteira | ERP | `todogreen_clients` e vínculos por ID | CRM/Comercial autorizados | TMS e Portal do Cliente |
| Oportunidade, proposta e aceite | ERP | registros comerciais da vertical | Comercial e alçadas | Contratos e precificação |
| Contrato, SLA e regra de cobrança | ERP | `todogreen_contracts` | Comercial, Jurídico e alçadas | TMS, Fiscal e Financeiro |
| Preço e parâmetros | ERP | cenários, tabelas e parâmetros versionados | Pricing e Deal Desk | Contrato e OS |
| Ordem de serviço | ERP cria a demanda; TMS executa | `todogreen_service_orders` | Planejamento cria/libera; execução canônica conclui | TMS, Fiscal e Financeiro |
| Operação, rota, despacho e eventos | TMS | `todogreen_client_operations`, ledger de eventos e `todogreen_routes` | TMS, Motorista e conectores autorizados | ERP e Portal do Cliente |
| Motorista, veículo e disponibilidade | ERP mantém cadastro; TMS aloca | cadastros mestres e alocação da operação | Cadastros e despacho | Portal do Motorista e torre |
| Vistoria e jornada | TMS pelo Portal do Motorista | checklists e jornadas do motorista | somente o motorista vinculado | Operação e auditoria |
| POD | TMS | `todogreen_proofs_of_delivery`, derivado da entrega canônica | Motorista, Portal TMS ou API autorizada | Cliente, faturamento e fiscal |
| Item faturável, fatura, título e baixa | ERP Financeiro | espinha transacional financeira | Financeiro e automações do domínio | Portal do Cliente e contabilidade |
| Documento fiscal | ERP Fiscal | documentos fiscais e retorno do autorizador | Fiscal e conector autorizado | Financeiro, TMS e cliente |
| Posição e telemetria bruta | Conector TMS | tabelas de integração/telemetria | provedor autenticado | projeção operacional, torre e ESG |
| Solicitação do cliente | Portal do Cliente cria; ERP trata | `todogreen_client_requests` | cliente vinculado e equipe responsável | cliente e equipe interna |

## Regras que não admitem exceção nova

1. Toda OS nova precisa apontar para uma operação canônica pelo `operation_id`.
2. Uma operação possui no máximo uma OS ativa.
3. Tracking externo é entrada do TMS e deve ser projetado no ledger operacional. O log bruto não substitui a operação.
4. “Entregue” sem recebedor, foto ou assinatura não conclui execução.
5. Entrega com POD conclui operação e OS e cria o item elegível de faturamento no mesmo comando de domínio.
6. Operação roteirizada só pode ser executada pelo motorista alocado, com vistoria aprovada e jornada aberta.
7. O Portal do Cliente não aceita `clientId` escolhido pelo navegador. O cliente vem exclusivamente do vínculo da sessão.
8. Documento fiscal preparado não é documento autorizado. A autorização depende da chave e do protocolo retornados pelo provedor oficial.

## Fluxo canônico

`Cliente → proposta → preço → contrato → implantação → operação/OS → despacho → rota → vistoria → jornada → eventos → POD → item faturável → fatura → fiscal → título → baixa`

TRACK3R, Sistemas Tracker, telemetria, CIOT, SEFAZ/prefeitura e OCPP são portas de integração. Nenhuma delas ganha uma segunda tabela de verdade para cliente, contrato, operação, POD ou financeiro.

## Critério para migração ao repositório `allgreen`

A migração só pode começar quando:

- a suíte completa e o build estiverem verdes;
- o teste transversal acima passar sem escrita direta no banco durante o cenário;
- os conectores necessários ao piloto estiverem configurados e com teste de saúde;
- a versão em produção estiver identificada e validada;
- não houver caminho novo criando OS sem operação ou concluindo entrega fora do comando canônico.
