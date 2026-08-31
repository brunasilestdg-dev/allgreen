# TRACK3R — receptor de ocorrências (webhook de entrada)

Este documento descreve o endpoint que o TRACK3R chama para nos entregar
ocorrências e tracking. Ele existe porque a especificação do fornecedor inverte
a direção do resto da integração: no modo arquivo e no modo API **nós puxamos**;
aqui **eles empurram**.

## O contrato (é do fornecedor, não nosso)

| | |
|-|-|
| Método | `POST` |
| URL | `https://<domínio>/api/todogreen/tms/webhook/<id da integração>` |
| Cabeçalho | `Token: <o segredo combinado>` |
| Corpo | `application/json`, uma ocorrência por chamada |

Respostas, na forma que a especificação pede:

```json
200 {"status": true,  "descricao": "Recebido com sucesso!"}
401 {"status": false, "descricao": "O Token informado é inválido!"}
```

E as que a especificação não previu, mas um receptor público precisa ter:

| Situação | Código |
|-|-|
| Corpo que não é JSON | 400 |
| Método diferente de POST | 405 |
| Corpo acima de 1 MB | 413 |
| Rajada acima do teto (por integração e por IP) | 429 |
| Segredo não cadastrado no cofre | 503 |

**A resposta 401 não ecoa o token recebido.** O exemplo do fornecedor devolve o
valor no texto; nós não repetimos segredo — nem em resposta, nem em log. Se a
homologação deles exigir o eco literal, é ajuste de uma linha, mas a decisão
consciente é não ecoar.

## Como a chamada é autorizada

1. O `id da integração` na URL diz **de qual espaço** é a chamada. É o único
   jeito de resolver isso sem sessão — o CNPJ do corpo identifica CLIENTE, não
   espaço, e usá-lo para descobrir o espaço seria ligar conta por dado do
   payload.
2. O segredo mora no **cofre do Worker**; a linha da integração guarda apenas o
   NOME da variável (`webhook_secret_env_key`, padrão
   `TODOGREEN_TRACK3R_WEBHOOK_SECRET`). Nenhum segredo no banco, nunca.
3. A comparação é em tempo constante (`sameHash`).
4. **Token ausente, token errado e integração inexistente respondem igual.** Se
   o id desconhecido tivesse resposta própria, a URL viraria um oráculo de quais
   integrações existem.
5. Sem segredo cadastrado, o receptor **recusa** (503). Não existe "aceita
   enquanto não configuram".

## O que acontece com a ocorrência

1. O corpo aninhado é achatado e passa pelo mesmo normalizador do relatório e da
   API (`normalizarOcorrenciaDoWebhook` → `normalizarDocumento`): um registro
   canônico só para os três transportes.
2. O documento é gravado em `todogreen_tms_documents` com `origem = 'webhook'`,
   `kind = 'ocorrencia'`, a encomenda em `order_ref` e o código em
   `occurrence_code`. O payload original inteiro fica em `payload_json`.
3. O embarcador é casado **só por CNPJ**. Sem conta com aquele CNPJ, o registro
   entra sem vínculo e aparece na fila do que falta casar — faltar vínculo não é
   erro.
4. Se a remessa já tiver operação projetada, a ocorrência vira **evento da linha
   do tempo** dela; quando o evento é entrega, carimba a entrega, o comprovante
   e o POD que a régua de faturamento exige. Criar operação continua sendo ato
   explícito de uma pessoa — um fornecedor não abre operação no nosso ERP.

## Idempotência

O TRACK3R reenvia quando não recebe 200. O mesmo evento reenviado cai no mesmo
`import_hash` (encomenda + nota + código + data do evento) e **atualiza uma
linha só**. Uma ocorrência diferente da mesma encomenda muda o código ou a data,
gera hash diferente e vira linha nova — que é o histórico que o rastreio exige.

Por isso o webhook tem hash próprio (`hashDaOcorrencia`) e **não usa** o hash do
documento: aquele prioriza o id externo justamente para o relatório diário
colapsar na mesma linha. E por isso a encomenda vive em `order_ref`, não em
`external_id`: essa coluna é única por espaço, e a mesma encomenda tem muitas
ocorrências.

## Tabela de códigos de ocorrência

A especificação só revela `"03" = Entregue`. Enquanto a lista oficial não vier,
**o código não decide o evento**: quem decide é a descrição em texto, e o código
é guardado cru. Quando a tabela chegar, ela entra em
`field_map_json.ocorrenciaPorCodigo` da integração e passa a mandar — sem
publicação nova.

## Não confundir com a Sistemas Tracker

São dois fornecedores diferentes. O TRACK3R traz o **documento** (o que foi
coletado e entregue); a Sistemas Tracker traz a **posição** (onde o veículo
está). As duas integrações convivem e não se substituem — inclusive os dois
receptores de webhook são separados, com segredos separados.
