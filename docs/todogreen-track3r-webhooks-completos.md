# TRACK3R — webhooks documentados

Base: documentação "Documentação de Webhooks – Track3R TMS" fornecida pela titular.

## Contrato comum

O fornecedor envia os eventos para uma WEB API da To Do Green com:

- método `POST`;
- corpo `application/json`;
- header `Token` para autenticação;
- resposta HTTP 200 quando recebido com sucesso.

O contrato com o fornecedor exige **um token diferente por URL**, cadastrado
no cofre do Cloudflare Worker. Os nomes e a ordem de ativação constam em
`docs/TRACK3R_TOKENS_INDIVIDUAIS.md`. O segredo anterior,
`TODOGREEN_TRACK3R_WEBHOOK_SECRET`, só é aceito como compatibilidade quando
NENHUM segredo individual existe. O banco guarda apenas o nome da variável.

## URLs da To Do Green

A integração usa um ID próprio por espaço:

```text
https://<dominio>/api/todogreen/tms/webhook/<integrationId>/<tipo>
```

O caminho legado sem `<tipo>` continua significando `ocorrencias`.

| Evento da documentação TRACK3R | Tipo da URL |
| --- | --- |
| Webhook envio de ocorrências | `ocorrencias` |
| Webhook envio de encomendas | `encomendas` |
| Envio de valores das encomendas | `valores-encomendas` |
| Envio de alterações embarcador | `embarcadores` |
| Envio de alterações tomador | `tomadores` |
| Envio de CTEs | `ctes` |
| Envio de alterações das unidades | `unidades` |
| Envio de averbação | `averbacoes` |
| Envio de cotações | `cotacoes` |
| Envio de faturas | `faturas` |
| Envio de faturas motorista | `faturas-motorista` |
| Envio de faturas rede terceira | `faturas-rede-terceira` |
| Envio de listas | `listas` |

## Estado de processamento

### Ocorrências

Continuam no caminho já existente e canônico:

1. autentica o header `Token`;
2. normaliza a ocorrência;
3. deduplica reenvio;
4. casa embarcador somente por CNPJ;
5. grava em `todogreen_tms_documents`;
6. quando existe operação projetada, aplica o evento nela;
7. entrega pode carregar POD/comprovante sem criar operação inventada.

### Demais webhooks

Entram primeiro em `todogreen_tms_webhook_events`.

A inbox preserva o payload original e registra:

- tipo do evento;
- referência externa principal;
- horário informado pelo TRACK3R;
- hash SHA-256 do payload canônico;
- quantidade de vezes que o mesmo evento foi recebido;
- primeira e última recepção;
- status de processamento.

O mesmo payload reenviado não cria outra linha: incrementa `receive_count`.

Essa inbox é deliberada. Receber um CT-e, fatura ou alteração cadastral não deve
escrever diretamente em fiscal/financeiro/cadastro sem uma regra de projeção
específica. Primeiro garantimos que o evento real nunca seja perdido; depois
cada tipo é conectado ao ledger canônico do módulo correspondente.

## Segurança

- sem segredo configurado: 503;
- Token ausente/incorreto: 401;
- integração inexistente responde igual a Token incorreto;
- método diferente de POST: 405;
- JSON inválido: 400;
- corpo acima de 1 MB: 413;
- rajada acima do teto: 429;
- tipo de evento desconhecido: 400;
- nenhum segredo é ecoado em resposta ou log;
- a integração é resolvida pelo ID na URL, nunca pelo CNPJ do payload.

## Próximo bloco

Projetar os eventos da inbox, um domínio por vez:

1. `encomendas` e `listas` → TMS/operação;
2. `ctes` e `averbacoes` → fiscal/documental;
3. `valores-encomendas`, `faturas`, `faturas-motorista` e
   `faturas-rede-terceira` → financeiro;
4. `embarcadores`, `tomadores` e `unidades` → cadastros, com política
   explícita de atualização;
5. `cotacoes` → pricing/comercial.

Nenhum webhook cria uma segunda fonte de verdade: ele alimenta o modelo canônico
já existente.
