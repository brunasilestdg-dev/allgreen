# Matriz de cobertura TRACK3R → TMS To Do Green

Inventário criado a partir do HTML do menu TRACK3R fornecido em 02/09/2026. O HTML bruto não é versionado porque contém estado de sessão, identificadores de usuário e dados do ambiente.

## Como usar esta matriz

- **Referência**: função identificada no menu da TRACK3R.
- **TDG**: capacidade que o TMS To Do Green deve entregar.
- **Situação**: `pronto`, `em construção`, `planejado`, `avaliar` ou `não replicar`.
- A existência de um item no menu prova apenas que a rota existe. Não prova regra de negócio, qualidade ou completude.
- Nenhum item vira menu principal automaticamente. Funções relacionadas devem compor uma jornada única, com busca global, ações em lote, API, auditoria e permissões.

## Princípios para ser melhor que a TRACK3R

1. Uma fonte de verdade para pedido, volume, viagem, documento fiscal, ocorrência e cobrança.
2. First, middle e last mile conectados por trechos e eventos, sem listas soltas.
3. Roteirização elétrica nativa: capacidade, janela, autonomia, SOC, carga, conector e recarga.
4. API externa, webhooks, idempotência, escopos e isolamento por cliente.
5. Busca global por Track ID, NF-e, pedido, volume, CT-e, CPF/CNPJ, nome e referência externa.
6. Ações em lote reversíveis, validadas e auditadas. Nada de “ferramentas” perigosas espalhadas.
7. Configuração por regra, com simulação, versão, aprovação e data de vigência.
8. Painéis acionáveis: todo indicador abre a fila correspondente.
9. Financeiro ligado à execução e ao contrato, com memória de cálculo.
10. Interface moderna e responsiva, sem postback, plugins legados ou telas duplicadas.

## 1. Busca e rastreabilidade transversal

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Busca por encomenda | Busca global por Track ID/OS | em construção |
| Nota fiscal | Busca por número e chave NF-e | planejado |
| Pedido | Referência do embarcador e pedido | em construção |
| Volume | Volume físico/Track ID individual | em construção |
| CT-e | Número, chave, XML e viagem | em construção |
| CPF/CNPJ e nome | Remetente, destinatário, motorista e cliente | planejado |
| Rastreio embarcador | Referência externa por integração | em construção |
| CT-e de subcontratação | Documento vinculado ao trecho subcontratado | planejado |
| Tracking | Linha do tempo única e append-only | em construção |
| Log de leitura | Eventos de scan por volume, operador, base e dispositivo | planejado |
| Log de alteração | Auditoria antes/depois, usuário, origem e justificativa | planejado |

## 2. Cadastros mestres

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Contratante | Empresa/tenant e configuração operacional | pronto |
| Embarcador | Cliente/embarcador com contratos e integrações | em construção |
| Embarcador agrupador | Grupo econômico e hierarquia de clientes | planejado |
| Embarcador remetente / Loja remetente | Pontos de origem vinculados ao cliente | planejado |
| Remetente, expedidor, emitente, destinatário | Partes da prestação e endereços versionados | planejado |
| Tomador do serviço | Tomador fiscal/comercial por operação | planejado |
| Transportadora / unidade | Rede própria e terceira, bases, hubs e cross-docks | em construção |
| Consolidador | Operador/unidade de consolidação | planejado |
| Doca | Docas, capacidade, agenda e fila | planejado |
| Endereço de armazenagem | Endereçamento de volume/gaiola/pallet | planejado |
| Motorista | Cadastro, documentos, RNTRC/vínculos e disponibilidade | em construção |
| Motorista ajudante | Equipe de viagem | planejado |
| Motorista empresa / tipo | Vínculo e classificação operacional | planejado |
| Subcontratação | Parceiro, contrato, trecho e responsabilidade | planejado |
| Veículo / tipo | Frota de moto a carreta, capacidade e restrições | em construção |
| Perfil energético do veículo | Bateria, SOC, consumo, conectores e potência | em construção |
| Espécie de embalagem | Volume, caixa, pallet, gaiola, mala e unidade logística | planejado |
| Impressora | Impressoras por base e formato de etiqueta | planejado |
| Usuário / perfil | RBAC por portal, capacidade e cliente | em construção |

## 3. Pedidos, encomendas e volumes

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Gerar encomenda digitada | Criar shipment/OS na interface e API | em construção |
| Gerar ordem de coleta | Solicitação → coleta → execução | planejado |
| Entregas / por status | Fila operacional com filtros e ações | em construção |
| Volumes | Unidade física com Track ID, peso, cubagem e NF-e | em construção |
| Itens notas / notas encomendas | Relação pedido-volume-item-documento | planejado |
| Estornadas | Cancelamento/estorno com histórico | planejado |
| Retira / entrega na loja | Modalidades de serviço e fluxo próprio | planejado |
| Agendamento | Janela, capacidade e confirmação do destinatário | planejado |
| Aguardando agendamento | Fila de exceção e SLA | planejado |
| Limite de tentativas | Política por cliente/serviço e cobrança | planejado |
| Alterar dados em lote | Comando validado, prévia e auditoria | planejado |
| Alterar volumes/itens/tentativas/unidade | Correção controlada sem perder histórico | planejado |
| Cancelar/estornar tracking | Evento compensatório; nunca apagar linha do tempo | não replicar como exclusão |

## 4. First mile e coleta

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Coletas | Planejamento e acompanhamento de coleta | planejado |
| Coleta embarcador: programação | Grade, janela, veículo e capacidade | planejado |
| Coleta embarcador: recebimento | Check-in, volumes previstos x recebidos | planejado |
| Coleta embarcador: painel | SLA, ocupação e divergências | planejado |
| Recusa de coleta | Ocorrência, motivo, evidência e reprogramação | planejado |
| Voucher de coleta | Documento/QR operacional | planejado |
| Coleta reversa | Pedido reverso, kit, coleta e retorno | planejado |
| Kit reversa | Geração e impressão controladas | planejado |

## 5. Recebimento, armazenagem e cross-docking

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Conferência de recebimento | Scan esperado x recebido, sobra/falta/avaria | planejado |
| Armazenar encomenda por rota | Endereçamento e staging por onda/rota | planejado |
| Consolidação | Agrupar volumes sem perder rastreabilidade | planejado |
| Desconsolidação | Quebrar unidade logística no hub destino | planejado |
| Consultar consolidação | Conteúdo, lacre, peso, cubagem e histórico | planejado |
| Cancelar consolidação | Reversão validada e auditada | planejado |
| Recuperar falta de recebimento | Investigação e reconciliação por evento | planejado |
| Suspeita de extravio | Fila de risco com evidências e prazo | planejado |

## 6. Middle mile, transferência e rede

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Transferência | Viagem entre bases com trechos, carga e capacidade | planejado |
| Ocorrência de transferência | Evento no trecho com impacto em SLA | planejado |
| Transbordo | Mudança de veículo/unidade preservando cadeia de custódia | planejado |
| Receber transferência | Check-in, lacre, divergência e aceite | planejado |
| Lista de lotação | Manifesto operacional de viagem | planejado |
| Lista de subcontrato | Trecho subcontratado + fiscal/financeiro | planejado |
| Lista de integração | Intercâmbio com parceiro/rede terceira | planejado |
| Painel de lotação | Torre de middle mile | planejado |
| Custo rede terceira | Tabela, conferência, fatura e pagamento | planejado |
| Custo parceiro | Regra, conferência, fatura e pagamento | planejado |

## 7. Last mile, listas e baixa

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Gerar lista | Onda/manifesto de distribuição | planejado |
| Baixa/recebimento de lista | Fechamento e reconciliação | planejado |
| Lista roteirizada | Resultado versionado do otimizador | em construção |
| Inserir/retirar item da lista | Reotimização com justificativa | planejado |
| Alterar motorista/placa | Reatribuição com impacto e auditoria | planejado |
| Recebimento de lista roteirizada | Retorno à base e pendências | planejado |
| Lista de devolução | Fluxo reverso por motivo e destino | planejado |
| Receber devolução | Conferência física e destino final | planejado |
| Baixa interna | Movimento interno separado de entrega ao destinatário | avaliar |
| Baixar entrega na loja | Confirmação de modalidade store pickup | planejado |
| POD/fotos | Foto, assinatura, recebedor, geolocalização e hash | em construção |
| Aprovar/reprovar fotos | Validação por regra e fila de exceção | planejado |
| Inserir recebedor/comprovante | Correção controlada do POD | planejado |

## 8. Roteirização

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Perfil de rota | Política por serviço, cliente, região e frota | planejado |
| Planejamento | Alocação + sequência + capacidade + janelas | em construção |
| Roteirizar por lista | Otimização de uma onda existente | em construção |
| Mapa de calor | Demanda, falhas, SLA e densidade | planejado |
| Exportar roteirizador | Exportação do plano e geometria | planejado |
| Status roteirizador | Saúde do motor, fila, versão e fallback | planejado |
| VROOM/OSRM | Fallback auto-hospedado sem custo por chamada | em construção |
| Valhalla/PyVRP/OR-Tools | Motor avançado e regras TDG | planejado |
| Elétrico | Autonomia, carga, SOC e reserva | em construção |
| Carregadores | OCM/OSM, compatibilidade e acesso a pesados | em construção |
| Recarga na rota | Menor impacto total, não só ponto mais próximo | em construção |
| Reotimização dinâmica | Ocorrência, trânsito, recarga e novas coletas | planejado |

## 9. Ocorrências, tratativas e atendimento

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Agrupamento de status | Status canônico + mapeamentos por cliente/integração | planejado |
| De/para envio e recebimento | Mapeamento versionado e testável | planejado |
| Inserir tracking | Evento manual com permissão e justificativa | planejado |
| Tratar ocorrências | Fila, responsável, SLA, evidência e resolução | planejado |
| Tratativas | Playbooks e automações por motivo | planejado |
| Cadastro de alertas | Regras, canais, destinatários e escalonamento | planejado |
| Notificações | Central unificada e preferências | planejado |
| SMS/mensagens | Provedor intercambiável e templates | planejado |
| Central de atendimento | Visão 360º da entrega e comunicação | planejado |
| Assuntos de atendimento | Taxonomia e SLA | planejado |
| Assistente virtual | Copiloto com acesso controlado e trilha de auditoria | planejado |
| Chat com motorista | Canal contextual da viagem/entrega | planejado |

## 10. Insucesso, avaria, perda e indenização

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Insucessos de visita | Motivo, evidência, reentrega e cobrança | planejado |
| Performance de tratativas | Tempo, recuperação e causa raiz | planejado |
| Avaria, extravio e perda | Caso vinculado ao volume e cadeia de custódia | planejado |
| Análise de indenização | Workflow, documentos, valor e aprovação | planejado |
| Painel de indenização | Estoque, aging e impacto financeiro | planejado |
| Recuperar suspeita de extravio | Encerrar suspeita sem apagar histórico | planejado |
| Nova cobrança por tentativa | Regra contratual e memória de cálculo | planejado |

## 11. Fiscal e regulatório

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Emitir/consultar CT-e | Emissão, autorização, eventos, XML e DACTE | em construção |
| CT-e complementar | Vínculo com original e motivo | planejado |
| Carta de correção | Evento fiscal controlado | planejado |
| Substituição/anulação | Workflow fiscal e documentos relacionados | planejado |
| Observação CT-e | Templates e regras por cliente/operação | planejado |
| XML CT-e em lote | Download/exportação segura | planejado |
| Emitir/consultar MDF-e | Autorização, inclusão, encerramento e DAMDFE | em construção |
| CIOT | Geração, consulta, encerramento e vínculo à viagem | em construção |
| DC-e | Avaliar obrigação e aderência operacional | avaliar |
| Produto predominante | Derivação da carga e informação fiscal | planejado |
| ICMS/alíquotas | Regra fiscal versionada por UF/operação | planejado |
| Averbação | Integração com seguradora e status | planejado |
| Dados NF-e | Importação, chave, validação e vínculo | planejado |
| Feriados | Calendário por localidade e impacto em SLA | planejado |

## 12. Comercial, cotação e receita

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Nova/consultar cotação | Cotação → aprovação → contrato → OS | planejado |
| Calcular frete | Motor tarifário com memória de cálculo | planejado |
| Fretes / por km | Tabelas por serviço, faixa, região, peso e cubagem | planejado |
| Generalidades | Adicionais parametrizados, sem campo genérico obscuro | planejado |
| Abrangência padrão/personalizada | Rede, CEP, região, prazo e capacidade | planejado |
| Regiões de entrega | Geografia operacional versionada | planejado |
| Produtos | Produto tarifário/serviço | planejado |
| Desconto de cotação | Regra e alçada de aprovação | planejado |
| Reajuste/recalcular em lote | Simulação, impacto e vigência | planejado |
| Log do frete | Fórmula, entradas, regra e versão | planejado |
| Comissões | Política, cálculo e conferência | planejado |

## 13. Faturamento e contas a receber

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Pré-fatura | Execuções elegíveis, divergências e aceite | planejado |
| Ajustar encomendas faturáveis | Correção com justificativa e recálculo | planejado |
| Gerar fatura de cliente | Contrato + execução + fiscal | em construção |
| Consultar faturas | Status, documentos, pagamentos e contestação | em construção |
| Layout de exportação | Layout por cliente e versão | planejado |
| Relatório de faturamento | Receita, volume, cliente e período | planejado |
| Contas a receber | Títulos, baixa e conciliação | planejado |
| Histórico de pagamentos | Linha do tempo financeira | planejado |
| Baixar/cancelar pagamento de encomenda | Fluxo de COD quando aplicável | avaliar |
| Fluxo de caixa / bancos / extratos | Manter no ERP financeiro; TMS integra | não replicar no portal TMS |

## 14. Custos, pagamentos e margem

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Configuração pagamento motorista | Regra por vínculo, veículo, rota e serviço | planejado |
| Conferência de fretes | Previsto x realizado x aprovado | planejado |
| Crédito/desconto motorista | Lançamento justificado e aprovado | planejado |
| Custo coleta embarcador | Custo por coleta/cliente | planejado |
| Gerar pagamento motorista | Fechamento e exportação financeira | planejado |
| Recalcular pagamento | Simulação e versionamento | planejado |
| Regiões dos motoristas | Área, disponibilidade e restrições | planejado |
| Pagamento rede terceira/parceiro | Conferência, fatura, taxas e pagamento | planejado |
| Taxas complementares | Regra clara e memória de cálculo | planejado |
| Relatório de margem | Receita - custos diretos - adicionais | planejado |
| Margem analítica | Entrega/rota/cliente/veículo | planejado |

## 15. Arquivos e integrações

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Importar arquivo | Upload, mapeamento, prévia, validação e rejeições | planejado |
| Importar chave NF-e | Consulta/importação fiscal autorizada | planejado |
| Exportar | Exportações assíncronas e auditadas | planejado |
| Layouts | Editor/versionamento por integração | planejado |
| Painel de arquivos | Processamento, erros e reprocessamento | planejado |
| FTP | SFTP/objeto/API; FTP simples apenas se obrigatório | avaliar |
| API externa | Shipments, tracking, POD, fiscal, CIOT, invoices e routing | em construção |
| Webhooks | Assinatura, retry, idempotência e dead-letter | planejado |
| TRACK3R bridge | Conector temporário, nunca fonte canônica | em construção |

## 16. Painéis e relatórios

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Dashboard transportador | KPIs operacionais acionáveis | em construção |
| Torre de controle | Eventos, riscos, SLA e ações em tempo real | em construção |
| Gestão de encomendas | Fluxo, aging, status e causa | planejado |
| Localização de motoristas | Mapa, jornada e privacidade | planejado |
| Painel de mensagens | Conversas e pendências | planejado |
| Indicadores | Catálogo, fórmula, meta e drill-down | planejado |
| Performance operacional | Cliente, base, rota, serviço e período | planejado |
| Performance motorista | Qualidade, produtividade e segurança | planejado |
| Insucessos | Motivos, recuperação e reincidência | planejado |
| Relatórios agendados | Exportação e distribuição com permissão | planejado |

## 17. Configuração, segurança e governança

| Referência TRACK3R | Alvo TDG | Situação |
| --- | --- | --- |
| Configuração de status | Máquina de estados com transições válidas | planejado |
| Configuração de notificações | Regras e preferências | planejado |
| Configuração de agendamento | Capacidade, calendário e SLA | planejado |
| Configuração app baixa | Política do Portal Motorista | planejado |
| Configuração de painel | Cards e filtros por papel | planejado |
| Workflow | Builder de regras com versão e aprovação | planejado |
| Senha de processo | Substituir por permissão + reautenticação + aprovação | não replicar literalmente |
| Temas | Tema TDG consistente; sem 12 skins operacionais | não replicar |
| Perfil/usuário | Menor privilégio, sessão separada por portal | em construção |
| Logs | Auditoria imutável e exportável | planejado |
| Suporte | Central de ajuda contextual | planejado |

## 18. Diferenciais obrigatórios TDG

| Diferencial | Critério de aceite |
| --- | --- |
| Elétrico de verdade | Rota inviável é bloqueada antes do despacho; recarga compatível é sugerida |
| Moto a carreta | Capacidades, matrizes e restrições por categoria |
| Carga fracionada | Volume permanece rastreável na consolidação, transferência e desconsolidação |
| Multimile | Um shipment pode atravessar vários trechos conectados |
| API first | Toda jornada operacional relevante possui contrato de API e webhook |
| Automação | Ocorrências acionam playbooks, alertas e replanejamento |
| Explicabilidade | Otimizador informa por que alocou, rejeitou ou inseriu recarga |
| Sustentabilidade mensurável | Energia, km elétrico, CO₂ evitado e custo energético por operação |
| UX enxuta | Busca global + filas por contexto; não reproduzir o menu gigante |
| Segurança | Segredos fora do front-end, chaves por hash, escopos, rate limit e idempotência |

## Lacunas que este HTML não resolve

Para auditar regra por regra, ainda são necessárias evidências de outras telas/fluxos:

- campos e validações das telas principais;
- formatos de importação/exportação;
- regras de status e ocorrências;
- cálculo de frete, custos, taxas e comissões;
- emissão e eventos de CT-e/MDF-e/CIOT;
- consolidação, transferência, lista e baixa;
- roteirização, mapa e retorno do otimizador;
- perfis/permissões;
- endpoints/chamadas de rede observadas no navegador;
- relatórios e filtros;
- aplicativo de baixa do motorista.

Cada nova evidência deve atualizar esta matriz, nunca virar implementação solta.
