# Mercado Livre / Mercado Envios — dados fiscais e CT-e

A To Do Green atua como transportadora de middle-mile/linehaul do Mercado
Envios. Para emitir o próprio CT-e ela consulta, na API do Mercado Livre, os
dados fiscais de cada rota/envio. O acesso é liberado pelo Mercado Livre para um
**APP ID** específico. Sem esse APP ID liberado, nenhuma consulta fiscal responde,
mesmo com o OAuth funcionando.

Código: `worker/services/todogreen-mercadolivre.js` (rotas),
`migrations/0144_todogreen_mercadolivre_integration.sql` (tabelas),
`src/features/logistics/pages/MercadoLivrePanel.jsx` (tela), testes em
`test/todogreen-mercadolivre.worker.test.js`.

## Documentação oficial (Mercado Envios)

| Etapa | Link |
| --- | --- |
| 2.1.1 Criação do App ID | https://developers.mercadoenvios.com/pt_br/oauth_access_control |
| 2.1.2 Como obter dados fiscais de envio | https://developers.mercadoenvios.com/pt_br/how-obtain-shipping-tax-data |
| 2.1.3 Linehaul · fluxo de venda | https://developers.mercadoenvios.com/pt_br/consult-linehaul-routes-and-shipments |
| 2.1.3 Linehaul · MWH (transferências) | https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-mwh |
| 2.1.4 Carrito V3 | https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-carrito-v3 |
| 2.1.5 Shipment | https://developers.mercadoenvios.com/pt_br/consult-fiscal-info-shipment |
| 2.1.6 Consulta de CT-e | https://developers.mercadoenvios.com/pt_br/cte-consult |

## Passo a passo (quem administra a conta)

1. Entre no DevCenter do Mercado Livre com a conta da transportadora
   (https://developers.mercadolivre.com.br/devcenter) e crie uma aplicação,
   seguindo a etapa 2.1.1.
2. **URI de redirecionamento** — cadastre exatamente:
   `https://orianone.app/api/todogreen/integrations/mercadolivre/oauth/callback`
   O Mercado Livre exige correspondência exata (sem `www`, sem barra no fim).
3. Ative **PKCE** se o DevCenter oferecer a opção. O conector sempre envia
   `code_challenge` S256.
4. Copie o **APP ID** (Client ID) e a **Chave secreta** (Client Secret) e
   cadastre os dois no cofre do Worker:
   ```bash
   wrangler secret put MERCADOLIVRE_CLIENT_ID
   wrangler secret put MERCADOLIVRE_CLIENT_SECRET
   ```
5. Responda ao e-mail do Mercado Livre com `APP ID <o número do APP ID>` para
   pedir a liberação das consultas fiscais.
6. No ERP: **Integrações → Operação e fiscal → Mercado Livre → Conectar**. O
   login é feito no próprio Mercado Livre e a volta cai de novo nessa tela.
   Depois use **Testar**, que chama `/users/me` com o token do espaço.
7. Com o APP ID liberado, use o painel **Consulta fiscal do Mercado Livre** com
   os caminhos descritos em cada link da tabela acima.

## Contrato do conector

- `GET /api/todogreen/integrations/mercadolivre/oauth/start` exige
  `integration:manage`. Devolve `{ authorizeUrl }` para
  `https://auth.mercadolivre.com.br/authorization` com `response_type=code`, `state` de uso
  único (10 min) e PKCE S256.
- `GET …/oauth/callback` é público. O `state` é consumido **antes** da troca. O
  code vai para `POST https://api.mercadolibre.com/oauth/token`
  (`application/x-www-form-urlencoded`), e `/users/me` identifica a conta. Os
  tokens ficam cifrados em AES-GCM em `todogreen_mercadolivre_connections` (um
  vínculo por espaço). A resposta redireciona para
  `/todogreen/integracoes?mercadolivre=connected|denied|error`.
- `GET …/connection` devolve um resumo sem nenhum token, mais os links da documentação.
  `DELETE …/connection` exige `integration:manage` e apaga o vínculo.
- `POST …/consulta` com `{ path, query }` exige `integration:manage` **ou**
  `fiscal:manage`. Aceita só `GET` em `https://api.mercadolibre.com`. O caminho
  precisa casar `^/[A-Za-z0-9._~\-/]+$`, sem `..`, sem `//` e fora de `/oauth`.
  Devolve `{ ok, status, path, query, latencyMs, data }`.
- **Renovação**: faltando menos de 5 min para expirar, o token é renovado com
  `grant_type=refresh_token`. O refresh do Mercado Livre é de **uso único**, então
  o par novo é gravado com `UPDATE … WHERE refresh_token_enc = <antigo>`, e quem
  perde a corrida usa o par gravado pela outra requisição. Um `invalid_grant` marca o
  vínculo como `reauthorize`, a tela mostra erro e pede para conectar de novo. Um
  401 numa consulta força uma única renovação e uma nova tentativa.

## Próximo passo depois da liberação

Quando os caminhos exatos de cada consulta forem confirmados na documentação
(acesso liberado ao APP ID), vale transformar cada um num atalho nomeado no
painel. Vale também ligar a resposta ao Fiscal To Do Green (`fiscalDomain.js`)
para pré-preencher o CT-e. O CT-e continua passando pelo ciclo e pela SEFAZ de
sempre: dado do Mercado Livre não autoriza documento.
