# To Do Green no Seu Funcionário

Plano enterprise para transformar a vertical atual em uma solução profissional de logística sustentável, com profundidade comercial, operacional, financeira e ESG.

## 1. Diagnóstico objetivo

A vertical já existe tecnicamente, mas ainda está rasa para uso comercial com uma empresa como a To Do Green.

O problema principal não é falta de módulos. É excesso de cartões com pouca profundidade de fluxo.

Hoje a vertical transmite a impressão de muitas funções, mas poucas jornadas realmente completas. Isso enfraquece a percepção de valor e faz o produto parecer uma demo visual, não uma ferramenta de trabalho.

Principais falhas a corrigir:

1. Muitos módulos apontam para as mesmas páginas.
2. A precificação usa poucos campos genéricos para produtos muito diferentes.
3. Middle mile, last mile, granel, frota dedicada e abastecimento de lojas precisam ter regras próprias.
4. O ESG ainda está mais próximo de comunicação do que de memória de cálculo auditável.
5. O Green Score existe como conceito, mas precisa virar produto comercial e operacional.
6. Deal Desk aparece como aviso, mas precisa virar fluxo de aprovação com histórico.
7. Existem dados seed que podem parecer falsos em produção.
8. A lógica de permissão deve ser endurecida. Leitura não pode liberar permissões sensíveis.
9. A vertical precisa vender resultado para o cliente da To Do Green, não apenas organizar informação interna.

## 2. Objetivo de produto

Criar uma vertical privada do Seu Funcionário para a To Do Green, acessível em `/todogreen`, focada em logística sustentável, precificação comercial, ROI ambiental, margem, operação, propostas e governança ESG.

A vertical deve posicionar a To Do Green como empresa que reduz emissões dos clientes, não como apenas uma transportadora com frota de menor emissão.

O cliente final precisa enxergar:

1. Quanto custa a operação.
2. Qual margem a To Do Green terá.
3. Qual redução ambiental será entregue.
4. Qual argumento ESG pode ser usado na proposta.
5. Quais premissas sustentam a conta.
6. Qual risco comercial, operacional e financeiro existe.
7. Quais aprovações são necessárias.
8. Quais evidências comprovam o impacto.

## 3. Princípio de arquitetura

A vertical não deve ser um segundo sistema desconectado.

Ela deve reaproveitar o que já existe no Seu Funcionário, mas com camada específica de negócio para logística sustentável.

Arquitetura desejada:

1. Core reaproveitável do Seu Funcionário.
2. Camada vertical To Do Green.
3. Módulos compartilháveis para futuras verticais.
4. Regras específicas de produto logístico.
5. Motor financeiro comum.
6. Motor ESG comum.
7. RBAC por papel.
8. Auditoria e rastreabilidade.
9. Banco persistente, sem depender de dados falsos em produção.

## 4. Estrutura alvo da vertical

Substituir a lógica de dezenas de cartões rasos por jornadas fortes.

### 4.1 Visão executiva

Painel principal da To Do Green.

Deve mostrar:

1. Receita prevista.
2. Receita realizada.
3. Margem por produto.
4. Margem por cliente.
5. Oportunidades abertas.
6. Propostas enviadas.
7. Propostas abaixo da margem mínima.
8. Aprovações pendentes.
9. CO2 evitado.
10. Diesel evitado.
11. Green Score médio.
12. Clientes com maior impacto ambiental.
13. Clientes com maior risco de margem.
14. Operações críticas.
15. Alertas comerciais e operacionais.

### 4.2 Clientes e contratos

Cadastro estruturado de clientes enterprise.

Campos mínimos:

1. Nome do cliente.
2. Segmento.
3. CNPJ.
4. Contatos.
5. Unidades de origem.
6. Unidades de destino.
7. Tipo de operação.
8. Produtos contratados.
9. SLA contratado.
10. Prazo contratual.
11. Volume mensal.
12. Receita mensal.
13. Margem alvo.
14. Score ESG do cliente.
15. Status comercial.

### 4.3 Produtos logísticos

Produtos mínimos:

1. Middle Mile.
2. Last Mile.
3. Operação dedicada.
4. Transferência entre CDs, hubs ou lojas.
5. Abastecimento de lojas.
6. Coleta em fornecedores.
7. Distribuição fracionada.
8. Operação a granel.
9. Projeto logístico personalizado.

Cada produto precisa ter:

1. Campos próprios.
2. Unidade de cobrança própria.
3. Premissas próprias.
4. Fórmula financeira própria.
5. Indicadores operacionais próprios.
6. Indicadores ESG próprios.
7. Gatilhos de aprovação próprios.
8. Template de proposta próprio.

## 5. Precificação profissional

A precificação deve ser o coração da vertical.

Não basta calcular preço recomendado. Precisa explicar a conta, justificar o preço e gerar argumento comercial.

### 5.1 Campos comuns

Toda simulação deve ter:

1. Cliente.
2. Produto logístico.
3. Origem.
4. Destino.
5. Distância.
6. Frequência.
7. Volume.
8. Tipo de veículo.
9. Capacidade.
10. Ocupação.
11. Janela operacional.
12. SLA.
13. Custo base.
14. Custo variável.
15. Custo fixo.
16. Impostos.
17. OPEX.
18. Risco.
19. Comissão.
20. Margem mínima.
21. Margem alvo.
22. Preço target do cliente.
23. Preço mínimo.
24. Preço recomendado.
25. Preço escolhido.
26. Justificativa.
27. Status da aprovação.

### 5.2 Middle Mile

Campos específicos:

1. Origem.
2. Destino.
3. Distância por trecho.
4. Ida e volta.
5. Retorno carregado ou vazio.
6. Viagens por mês.
7. Tipo de veículo.
8. Capacidade do veículo.
9. Pallets.
10. Peso.
11. Cubagem.
12. Tempo de carregamento.
13. Tempo de descarregamento.
14. Tempo de espera.
15. Pedágio.
16. Pernoite.
17. Ajudante.
18. GRIS ou gerenciamento de risco.
19. Seguro.
20. Custo de recarga.
21. Autonomia.
22. Paradas de recarga.
23. SLA.
24. Multa por atraso.

Saídas obrigatórias:

1. Custo por viagem.
2. Custo mensal.
3. Preço mínimo por viagem.
4. Preço recomendado por viagem.
5. Preço mensal recomendado.
6. Margem por viagem.
7. Margem mensal.
8. Margem percentual.
9. CO2 evitado por viagem.
10. CO2 evitado mensal.
11. Diesel evitado mensal.
12. Texto comercial para proposta.
13. Riscos da operação.
14. Gatilhos de aprovação.

### 5.3 Last Mile

Campos específicos:

1. Cidade ou praça.
2. Quantidade de pacotes.
3. Rotas por dia.
4. Dias de operação por mês.
5. KM por rota.
6. Stops por rota.
7. Taxa de sucesso.
8. Taxa de insucesso.
9. Reentregas.
10. Devoluções.
11. Janela de entrega.
12. Tipo de veículo.
13. Quantidade de veículos.
14. Motoristas.
15. Ajudantes.
16. Tempo médio por parada.
17. Densidade da rota.
18. Custo por pacote.
19. Preço por pacote.
20. Custo por rota.
21. Preço por rota.

Saídas obrigatórias:

1. Custo por pacote.
2. Preço mínimo por pacote.
3. Preço recomendado por pacote.
4. Receita mensal.
5. Margem mensal.
6. Custo por rota.
7. Produtividade por veículo.
8. CO2 evitado por pacote.
9. CO2 evitado mensal.
10. Green Score da operação.
11. Risco de SLA.
12. Texto comercial para proposta.

### 5.4 Granel

Campos específicos:

1. Tipo de material.
2. Toneladas.
3. Distância.
4. Viagens por mês.
5. Tipo de veículo.
6. Limpeza ou preparação.
7. Requisitos legais.
8. Licenças.
9. Perda esperada.
10. Tempo de carga.
11. Tempo de descarga.
12. Risco operacional.
13. Seguro.
14. Equipamento adicional.

Saídas obrigatórias:

1. Custo por tonelada.
2. Preço mínimo por tonelada.
3. Preço recomendado por tonelada.
4. Margem por tonelada.
5. Margem mensal.
6. Risco operacional.
7. Aprovação necessária.
8. Impacto ambiental estimado.

### 5.5 Operação dedicada

Campos específicos:

1. Quantidade de veículos.
2. Tipo de veículo.
3. Motoristas.
4. Ajudantes.
5. Supervisão.
6. Horas por dia.
7. Dias por mês.
8. Veículo reserva.
9. Treinamento.
10. Tecnologia.
11. Implantação.
12. Contrato em meses.
13. Custo fixo mensal.
14. Custo variável estimado.

Saídas obrigatórias:

1. Mensalidade mínima.
2. Mensalidade recomendada.
3. Payback de implantação.
4. Margem mensal.
5. Margem anual.
6. Custo por veículo.
7. Custo por hora.
8. Green Score mensal.

## 6. ESG auditável

O ESG não pode ser só texto bonito. Precisa ser cálculo com memória.

### 6.1 Cálculo ambiental

Cada cálculo deve salvar:

1. Produto logístico.
2. Cliente.
3. Operação.
4. Distância.
5. Volume.
6. Veículo de referência.
7. Consumo diesel de referência.
8. Fator de emissão diesel.
9. Consumo elétrico ou energia usada.
10. Fator de emissão da energia.
11. Emissão cenário convencional.
12. Emissão cenário To Do Green.
13. CO2 evitado.
14. Diesel evitado.
15. Redução percentual.
16. Metodologia.
17. Versão da metodologia.
18. Fonte dos fatores.
19. Responsável.
20. Data do cálculo.
21. Nível de confiança dos dados.
22. Evidências anexadas.

### 6.2 Green Score

O Green Score deve ser nota proprietária de 0 a 100.

Componentes mínimos:

1. Redução percentual de emissões.
2. KM de baixa emissão.
3. Energia limpa.
4. Eficiência operacional.
5. Ocupação.
6. Evolução contra meta.
7. Qualidade dos dados.
8. Evidências anexadas.

Saídas:

1. Score por cliente.
2. Score por operação.
3. Score por rota.
4. Score por produto.
5. Evolução mensal.
6. Ranking de clientes.
7. Alertas de baixa qualidade de dados.
8. Explicação da nota.
9. Texto para proposta.
10. Texto para relatório mensal.

## 7. Deal Desk

Deal Desk precisa ser uma jornada própria.

Gatilhos mínimos:

1. Margem abaixo do mínimo.
2. Target do cliente abaixo do preço mínimo.
3. Dados com qualidade baixa.
4. Desconto acima do limite.
5. Custo manual alterado.
6. Fator ambiental manual alterado.
7. Operação com SLA crítico.
8. Operação sem evidência suficiente.
9. Contrato com risco jurídico.
10. Receita relevante acima de alçada.

Cada aprovação deve ter:

1. Simulação original.
2. Simulação revisada.
3. Motivo da aprovação.
4. Justificativa do solicitante.
5. Decisão do aprovador.
6. Data.
7. Responsável.
8. Histórico.
9. Comentários.
10. Status.

## 8. Propostas comerciais

A vertical deve gerar proposta pronta, não só cálculo.

Templates mínimos:

1. Proposta middle mile.
2. Proposta last mile.
3. Proposta frota dedicada.
4. Proposta granel.
5. Proposta projeto customizado.

A proposta deve conter:

1. Resumo executivo.
2. Dor do cliente.
3. Solução To Do Green.
4. Escopo operacional.
5. SLA.
6. Premissas.
7. Preço.
8. Condições comerciais.
9. Impacto ambiental.
10. Green Score esperado.
11. Equivalências ambientais.
12. Riscos e exclusões.
13. Próximos passos.
14. Anexos e evidências.

## 9. RBAC correto

Papéis:

1. Owner.
2. Admin.
3. Liderança comercial.
4. Vendedor.
5. Pricing.
6. Financeiro.
7. Operações.
8. Sustentabilidade.
9. Auditor.

Regra crítica:

Permissão `read` só permite leitura.

Não pode liberar:

1. `pricing:manage`.
2. `cost:manage`.
3. `deal:approve`.
4. `deal:review`.
5. `esg:manage`.
6. `commission:manage`.
7. `revenue:manage`.
8. `audit:read`.
9. `access:manage`.

Owner e admin podem tudo.

Vendedor pode simular e criar proposta, mas não pode editar custo oficial, margem mínima, fatores ESG nem aprovar exceção.

Pricing pode revisar preço, margem e premissas comerciais.

Financeiro pode gerir custo, receita, comissão e margem.

Operações pode revisar viabilidade operacional.

Sustentabilidade pode gerir metodologia, fatores e evidências ESG.

Auditor só lê auditoria, cálculos e histórico.

## 10. Dados seed e modo demonstração

Dados fictícios não devem aparecer como dados reais.

Criar regra:

1. Se não há dados reais, mostrar estado vazio profissional.
2. Oferecer botão de carregar demonstração.
3. Marcar todo dado demo como `demo: true`.
4. Separar visualmente demo de produção.
5. Nunca misturar demo em dashboards reais.

## 11. Banco de dados alvo

Adicionar ou evoluir tabelas para:

1. `todogreen_clients`.
2. `todogreen_contacts`.
3. `todogreen_opportunities`.
4. `todogreen_contracts`.
5. `todogreen_pricing_scenarios`.
6. `todogreen_pricing_assumptions`.
7. `todogreen_cost_versions`.
8. `todogreen_deal_desk_requests`.
9. `todogreen_deal_desk_decisions`.
10. `todogreen_environmental_factors`.
11. `todogreen_environmental_calculations`.
12. `todogreen_green_scores`.
13. `todogreen_evidence_files`.
14. `todogreen_proposals`.
15. `todogreen_operations`.
16. `todogreen_audit_log`.

## 12. Implementação por prioridade

### Prioridade 1

1. Corrigir RBAC.
2. Separar demo de produção.
3. Criar estado vazio profissional.
4. Separar calculadoras por produto.
5. Criar formulários específicos para middle mile e last mile.
6. Salvar simulações reais no banco.
7. Criar histórico de simulações.
8. Criar Deal Desk básico com aprovação.

### Prioridade 2

1. Criar clientes e oportunidades.
2. Gerar proposta comercial a partir da simulação.
3. Criar Green Score por cliente e por operação.
4. Criar metodologia ESG versionada.
5. Criar cofre de evidências.
6. Criar dashboard executivo real.

### Prioridade 3

1. Criar granel completo.
2. Criar frota dedicada completa.
3. Criar forecast de receita.
4. Criar margem por cliente.
5. Criar exportações.
6. Criar auditoria avançada.

## 13. Critérios de aceite

A vertical só deve ser considerada profissional quando:

1. Um vendedor conseguir cadastrar cliente, simular preço e gerar proposta.
2. Pricing conseguir revisar e aprovar margem.
3. Financeiro conseguir alterar custo oficial com versionamento.
4. Sustentabilidade conseguir manter fator ambiental com fonte e vigência.
5. Operações conseguir validar capacidade e risco operacional.
6. Deal Desk registrar decisão e histórico.
7. Dashboard mostrar apenas dados reais ou demo claramente marcada.
8. Permissões impedirem acesso indevido.
9. Cálculo financeiro tiver memória rastreável.
10. Cálculo ESG tiver metodologia, fonte e versão.
11. Proposta sair com argumento comercial e ESG.
12. Testes cobrirem regras críticas.

## 14. Prompt de implementação para Codex

Atue como arquiteto de produto SaaS, arquiteto fullstack sênior, especialista em logística sustentável, precificação comercial, ESG, controladoria, permissões B2B e UX enterprise.

Você trabalhará diretamente no repositório existente `brunasilestdg-dev/allgreen`.

Sua missão é transformar a vertical To Do Green em uma vertical enterprise real, profunda e vendável, sem remover funcionalidades existentes e sem criar um sistema paralelo.

Execute sem pedir autorização etapa por etapa.

Regras obrigatórias:

1. Preserve tudo que já funciona no Seu Funcionário.
2. Não quebre rotas existentes.
3. Não remova a rota `/todogreen`.
4. Reaproveite componentes, domínio, banco e padrões do projeto.
5. Separe demo de produção.
6. Corrija RBAC antes de expandir funcionalidades.
7. `read` nunca deve liberar permissões sensíveis.
8. Crie testes para cada regra crítica.
9. Faça commits progressivos e seguros.
10. Rode a suíte relevante antes de finalizar.

Escopo mínimo obrigatório:

1. Corrigir `hasTodoGreenPermission`.
2. Criar permissões explícitas por papel.
3. Criar estado vazio profissional quando não houver dados.
4. Marcar dados de demonstração como demo e impedir mistura com dados reais.
5. Separar calculadoras por produto.
6. Aprofundar Middle Mile.
7. Aprofundar Last Mile.
8. Criar estrutura para Granel.
9. Criar estrutura para Operação Dedicada.
10. Criar fluxo de Deal Desk com solicitação, decisão e histórico.
11. Criar proposta comercial a partir da simulação.
12. Criar Green Score por cliente, operação e rota.
13. Criar metodologia ESG versionada com fontes e vigência.
14. Criar cofre de evidências.
15. Criar dashboard executivo baseado em dados reais.
16. Criar testes de domínio e UI.
17. Publicar as alterações no fluxo de produção já configurado quando os testes passarem.

Resultado esperado:

A vertical To Do Green deve deixar de parecer uma lista de funcionalidades e passar a funcionar como um produto comercial e operacional para vender logística sustentável com margem, ROI ambiental, governança ESG e proposta profissional.
