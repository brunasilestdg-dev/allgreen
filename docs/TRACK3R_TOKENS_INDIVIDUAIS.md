# TRACK3R: um token por endpoint

**Contrato com o fornecedor (Lucas, 18/09/2026):** a TRACK3R cadastra uma URL e
um token para CADA webhook. Os 13 endpoints continuam separados e os tokens
nunca são colocados na URL, no banco ou no GitHub.

## Preparar sem token

1. Criar a configuração da TRACK3R no TMS em modo **Arquivo**, que não requer token.
2. Copiar o `webhookKit` da configuração, com 13 URLs completas e o
   `integrationId` real. O padrão é
   `https://orianone.app/api/todogreen/tms/webhook/<integrationId>/<tipo>`.
   Não enviar URLs com o placeholder `ID_DA_INTEGRACAO`.
3. Gerar cada token aleatório e DIFERENTE dos outros, com pelo menos 32 bytes de
   entropia (por exemplo, `openssl rand -hex 32`). **Não comitar nem enviar
   tokens no chat, em planilhas públicas ou em screenshots.**
4. No cofre do Cloudflare Worker que atende `orianone.app`, cadastrar os
   seguintes nomes, com valores distintos. Exemplo de comando para cada chave:
   `npx wrangler secret put TODOGREEN_TRACK3R_TOKEN_OCORRENCIAS`.
5. Depois de cadastrar os tokens dos endpoints que serão ativados, mudar a
   integração para modo **Webhook** e homologar 200/401/503 por endpoint.
   Enviar ao Lucas cada par URL + token por canal seguro.

| Evento | Tipo de URL | Nome do segredo no Cloudflare |
| --- | --- | --- |
| Ocorrências | `ocorrencias` | `TODOGREEN_TRACK3R_TOKEN_OCORRENCIAS` |
| Encomendas | `encomendas` | `TODOGREEN_TRACK3R_TOKEN_ENCOMENDAS` |
| Valores das encomendas | `valores-encomendas` | `TODOGREEN_TRACK3R_TOKEN_VALORES_ENCOMENDAS` |
| Embarcadores | `embarcadores` | `TODOGREEN_TRACK3R_TOKEN_EMBARCADORES` |
| Tomadores | `tomadores` | `TODOGREEN_TRACK3R_TOKEN_TOMADORES` |
| CT-es | `ctes` | `TODOGREEN_TRACK3R_TOKEN_CTES` |
| Unidades | `unidades` | `TODOGREEN_TRACK3R_TOKEN_UNIDADES` |
| Averbações | `averbacoes` | `TODOGREEN_TRACK3R_TOKEN_AVERBACOES` |
| Cotações | `cotacoes` | `TODOGREEN_TRACK3R_TOKEN_COTACOES` |
| Faturas | `faturas` | `TODOGREEN_TRACK3R_TOKEN_FATURAS` |
| Faturas de motorista | `faturas-motorista` | `TODOGREEN_TRACK3R_TOKEN_FATURAS_MOTORISTA` |
| Faturas de rede terceira | `faturas-rede-terceira` | `TODOGREEN_TRACK3R_TOKEN_FATURAS_REDE_TERCEIRA` |
| Listas / romaneios | `listas` | `TODOGREEN_TRACK3R_TOKEN_LISTAS` |

Os valores NÃO podem ser obtidos pelo GET da configuração; o kit retorna apenas
`tokenEnvKey` (nome da variável) e `tokenConfigurado` (booleano), nunca o token.

## Compatibilidade e ativação segura

O receptor já usava o segredo legado da integração
(`TODOGREEN_TRACK3R_WEBHOOK_SECRET`, ou o nome configurado).
**Enquanto nenhum dos 13 novos segredos existir**, o token compartilhado
continua aceito nos 13 endpoints para não quebrar uma integração já ativa.

**Assim que qualquer token individual existir, a compatibilidade legada deixa
de valer para todos os endpoints.** Um evento sem token individual retorna 503
e nenhum evento de outro tipo aceita o token daquela rota (401). Repetir o
MESMO valor em dois segredos individuais também falha fechado (503).
Por isso cadastrar os tokens dos eventos ativos **antes** de liberar o disparo.
Webhooks que não serão usados podem ficar sem segredo e responderão 503 se
a TRACK3R tentar chamá-los.

O caminho antigo de ocorrências
`/api/todogreen/tms/webhook/<integrationId>` continua existente e exige
o MESMO token individual de `/ocorrencias`.

O token de leitura da API TRACK3R, `TODOGREEN_TRACK3R_API_TOKEN`, NÃO serve
para autenticar webhook. Não misturar as duas credenciais.

## Contrato HTTP e checagem

- Método: `POST`.
- Corpo: `application/json`.
- Cabeçalho enviado pela TRACK3R: `Token: <token_exclusivo_deste_endpoint>`.
- Token válido + evento recebido: 200; token incorreto/ausente: 401;
  segredo individual faltando ou repetido: 503.
- Validar eventos reais: inbox, encomendas/listas, ocorrências/POD,
  títulos a receber, custos de motorista/terceiro e documentos fiscais,
  somente para as frentes ativadas.

O PR #440 deve ser incorporado antes da configuração em produção; ele contém
as correções das projeções de encomenda e fatura. O Cloudflare Workers Builds
não substitui os testes reais com o fornecedor.
