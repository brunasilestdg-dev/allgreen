# Gate de integrações externas da All Green

Status: critério obrigatório para piloto e para a futura migração ao repositório `allgreen`.

Uma integração só recebe o estado **conectada** depois de uma troca real bem-sucedida e registrada. Tela, tabela, credencial cadastrada ou documento preparado não equivalem a conexão em produção.

| Integração | O que já existe no produto | O que falta para conectar | Evidência exigida para liberar |
|---|---|---|---|
| TRACK3R | importação por arquivo, cadastro API/webhook, receptor autenticado, idempotência e projeção de ocorrências | segredo de webhook ou URL/token da API, documentação e tabela oficial de códigos | arquivo real importado ou webhook/API recebido sem erro, com operação atualizada |
| Sistemas Tracker | cadastro por espaço, modos API/webhook/híbrido, ingestão de posição e telemetria, saúde e último sucesso | credencial, URL/documentação, amostra de payload e mapa de veículos | posição real associada ao veículo e exibida na torre, com `last_success_at` |
| CIOT/ANTT | preparação, validações regulatórias, cofre de certificado e conector Windows | artefatos oficiais/DCS, servidor Windows, certificado ICP-Brasil, URL/token do conector e homologação | CIOT autorizado em homologação com código e protocolo retornados pelo serviço oficial |
| Fiscal CT-e/MDF-e | preparação, cálculo, fila fiscal e vínculo com faturamento | certificado A1, credenciamento, endpoints/autorizador e homologação SEFAZ | documento autorizado em homologação, com chave e protocolo oficiais consultáveis |
| Telemetria | modelo canônico de posição/odômetro/energia e projeção para torre/ESG | alimentação real da Sistemas Tracker ou outro provedor contratado | sequência de posições reais sem duplicidade e com sinalização de dado atrasado |
| OCPP | cadastro de pontos de recarga e dependência exibida de forma explícita | escolha da central OCPP ou API da rede, credenciais e mapa dos carregadores | sessão real com disponibilidade e medição de uma recarga piloto |

## Ordem de fechamento

1. TRACK3R e Sistemas Tracker, porque alimentam a execução e a visibilidade do cliente.
2. CIOT e Fiscal, porque liberam a operação regulatória e o ciclo financeiro real.
3. Telemetria, validada junto da Sistemas Tracker e do cálculo ESG.
4. OCPP, depois da definição da rede/central usada no piloto elétrico.

## Regra de produto

- nenhuma nova integração cria uma segunda operação, POD, OS ou fatura;
- eventos externos entram no ledger canônico do TMS;
- credenciais permanecem em secrets/cofre, nunca no Git;
- falha externa mantém o registro bruto e um erro auditável, sem declarar o processo concluído;
- o repositório `allgreen` só recebe a plataforma depois que os conectores obrigatórios do piloto estiverem verdes e a versão implantada estiver identificada.
