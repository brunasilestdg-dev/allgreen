# Pendências da Titular

Ações que somente você pode realizar. **Nenhuma delas impede o uso do app**, que está no ar em https://seufuncionario-expo.brunapsiles.workers.dev

## 🔴 Recomendadas agora

### Meio de pagamento — parado por decisão sua

Você definiu que o app é 100% gratuito para todos neste primeiro momento, e
está assim no ar. Não há nada a fazer aqui agora.

Quando quiser começar a cobrar, o trabalho já está pronto e testado: os três
planos existem, as cotas funcionam e a tela de plano está construída. Faltará
só abrir conta no Mercado Pago (aceita Pix) ou Stripe, cadastrar a credencial
com `npx wrangler secret put PAGAMENTO_TOKEN` e me avisar — eu ligo o botão ao
checkout e a confirmação passa a mudar o plano da conta sozinha.

### Ligar o R2 para a mídia do cofre (POD, CNH, comprovantes) — alívio de escala

O código já grava e lê a mídia do R2 (object storage da Cloudflare) **assim que
o binding existir**; sem ele, tudo continua no D1 como antes (nada quebra). Hoje
cada foto vira ~40 linhas de base64 no D1 — o R2 tira esse peso. Passos, uma vez:

```bash
# 1. Criar o bucket (nome livre; use este para casar com o exemplo):
npx wrangler r2 bucket create seu-funcionario-midia
```

2. Adicionar o binding no `wrangler.jsonc` (o **binding TEM que se chamar
   `MEDIA_BUCKET`**, que é o nome que o código procura):

```jsonc
"r2_buckets": [
  { "binding": "MEDIA_BUCKET", "bucket_name": "seu-funcionario-midia" }
]
```

3. Publicar (`npm run deploy` ou o push na `main`). A partir daí, **toda mídia
   nova vai para o R2**; a antiga continua sendo servida do D1 normalmente
   (migração é aditiva, retrocompatível). Não precisa migrar o histórico — se
   quiser, dá para fazer isso depois num passo separado.

Enquanto o binding não existir, não há erro: a mídia só continua no D1.

### 0. Destravar a publicação do site (5 minutos, uma vez só)

Verificado em 30/07/2026: o site no ar responde **v138**, mas o código no GitHub
já está na **v145**. As últimas entregas — quadro visual, diagramas, quadro
rápido, memória e busca, análise de dados, conhecimento conectado, portfólio de
projetos e agentes — **estão prontas e testadas, mas você ainda não as vê**.

O que aconteceu: a publicação automática vinha da integração da Cloudflare com o
GitHub, e ela parou de funcionar depois da v138. O código está salvo e seguro; os
testes passam em todos os commits. Travou só a publicação.

**A solução já está pronta no repositório.** Criei um fluxo de publicação dentro
do próprio GitHub (`.github/workflows/deploy.yml`), que não depende mais daquela
integração. Ele publica sozinho a cada alteração. Falta só você dar a chave a ele
— e isso só você pode fazer, porque é a sua conta da Cloudflare.

**Passo 1 — criar a chave (2 min)**

1. Abra https://dash.cloudflare.com/profile/api-tokens
2. Clique em **Create Token**
3. Na lista de modelos, procure **Edit Cloudflare Workers** e clique em **Use template**
4. Desça até o fim e clique em **Continue to summary**, depois **Create Token**
5. **Copie o token agora** — ele só aparece uma vez

**Passo 2 — guardar a chave no GitHub (2 min)**

1. Abra https://github.com/brunapsiles/Seufuncionario/settings/secrets/actions
2. Clique em **New repository secret**
3. Em *Name*, escreva exatamente: `CLOUDFLARE_API_TOKEN`
4. Em *Secret*, cole o token que você copiou
5. Clique em **Add secret**

**Passo 3 — mandar publicar (1 min)**

1. Abra https://github.com/brunapsiles/Seufuncionario/actions/workflows/deploy.yml
2. Clique em **Run workflow** > **Run workflow**
3. Espere terminar (uns 3 minutos). O último passo mostra a versão que ficou no ar.

**Como saber que deu certo:** abra
https://seufuncionario-expo.brunapsiles.workers.dev/api/status — o campo
`version` tem que mostrar `v145`.

Depois disso, toda alteração publica sozinha. Você não precisa repetir nada.

Se algum passo der erro, o próprio GitHub mostra a mensagem em português na tela
do fluxo, dizendo o que faltou.

### 1. Cadastrar as chaves VAPID (notificações do navegador)

Tudo de notificação push já está construído e no ar — lembrete do DAS do MEI, avisos de missão/entrega e o resumo semanal de segunda-feira — mas **nada é enviado** até estes dois segredos existirem no cofre do Worker. Sem eles o app funciona normalmente, só sem push.

Como fazer (uma vez só, ~2 minutos, no terminal do projeto):

```bash
# 1. Gerar um par de chaves novo (o comando imprime as duas linhas):
node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']).then(async k=>{const b=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');console.log('PUBLICA :',b(await crypto.subtle.exportKey('raw',k.publicKey)));console.log('PRIVADA :',(await crypto.subtle.exportKey('jwk',k.privateKey)).d)})"

# 2. Cadastrar cada uma no cofre (cola o valor quando o comando pedir):
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
```

Alternativa: um par de chaves já foi gerado e compartilhado na conversa com o assistente em 19/07/2026 — pode usar aquele em vez de gerar um novo. As chaves nunca ficam no código, só no cofre (por isso não estão escritas aqui).

Depois de cadastrar, teste: Configurações → "Notificações do navegador" → Ativar. Deve pedir permissão e confirmar.

## 🟡 Opcionais / segurança

### 1. Restringir ou regenerar chaves compartilhadas em conversas

- Chaves que passaram por chats (Codex/Claude): token Cloudflare, Gemini, xAI, Google API key, Brevo. O app guarda todas em cofre seguro; regenerar é só uma camada extra de proteção contra terceiros.
- Google API key: em console.cloud.google.com → Credenciais, dá para **restringir** quais APIs ela pode usar.

### 2. Domínio próprio (ex.: seufuncionario.com.br)

- Pago (~R$ 40/ano em registro.br). Deixa o endereço com a sua marca e habilita e-mails do seu domínio. O endereço gratuito atual continua funcionando para sempre.

### 3. Servidor GPU para vídeo próprio (pasta `video-ai/`)

- Pago. Sem ele, o estúdio já oferece o caminho gratuito (Hugging Face) para vídeos; imagens e logos funcionam normalmente.

### 4. Login com Apple

- Exige conta de desenvolvedor Apple (US$ 99/ano). Recomendação: não fazer por enquanto.

### 5. WhatsApp bidirecional de verdade (receber mensagens no app)

- Hoje a Caixa de entrada registra o WhatsApp que **sai** (pelos botões do app) e recebe **e-mail e formulários do site**. Receber mensagens de WhatsApp dentro do app exige a **WhatsApp Cloud API** da Meta: tem faixa gratuita, mas pede verificação da sua empresa na Meta, um número dedicado e configuração de webhook. É uma decisão sua — sem ela, tudo o mais da caixa funciona normalmente.

## 🔗 Integrações que você autorizou (dependem de cadastro seu)

Você disse "ok para tudo que depende da minha decisão". Ótimo — mas estas
integrações exigem uma configuração **feita por você** (eu não tenho acesso
ao cofre do Worker nem aos consoles do Google/Meta). Assim que você fizer os
passos abaixo, eu construo/ligo o resto no app. Enquanto isso, tudo o mais
funciona normalmente.

### A. Gmail dentro da Caixa de entrada (ler os e-mails recebidos)

Hoje o login com Google só confirma a sua identidade. Ler o Gmail exige um
fluxo de autorização com um segredo que só você pode cadastrar:

1. No **Google Cloud Console → APIs e serviços → Tela de consentimento**:
   adicionar o escopo `https://www.googleapis.com/auth/gmail.readonly`.
2. Em **Credenciais**, no OAuth Client já existente: adicionar como *Authorized
   redirect URI* `https://seufuncionario-expo.brunapsiles.workers.dev/api/auth/google/callback`
   e copiar o **Client secret**.
3. Cadastrar o segredo no cofre: `npx wrangler secret put GOOGLE_CLIENT_SECRET`.

Sem custo (Gmail API é gratuita na sua conta). Feito isso, eu ligo a leitura +
sincronização na Caixa de entrada.

### B. WhatsApp bidirecional (receber mensagens no app)

Exige a **WhatsApp Cloud API** da Meta (faixa gratuita, mas pede verificação da
empresa na Meta, um número dedicado e um token). Passos: criar app em
`developers.facebook.com`, adicionar o produto WhatsApp, obter o
**Permanent Access Token** e o **Phone Number ID**, e cadastrar
`WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID` no cofre. Eu configuro o webhook e a
Caixa de entrada quando os segredos existirem.

### C. Pesquisa na internet ao vivo (concorrentes, preços, pesquisa profunda)

**Atualização (30/08/2026): a pesquisa web JÁ FUNCIONA sem chave nenhuma.** A
afirmação antiga de que "sem uma chave o app não lê a internet" ficou
desatualizada. A cascata de busca (`web-search.js`) inclui provedores gratuitos
sem cadastro (DuckDuckGo, Wikidata, Wikipédia) ligados por padrão — então a
pesquisa de empresa (LinkedIn, decisores, notícias, RFQ) responde mesmo sem
configurar nada. A chave/instância própria só MELHORA a qualidade e tira o
limite.

Para ligar uma fonte melhor **sem terminal**, use a tela do próprio ERP em
**Integrações → Busca web** ("traga sua própria busca"):

- **SearXNG (ilimitado)** — cole a URL da sua instância própria; a cascata a usa
  em primeiro lugar, sem cota. É a saída definitiva do limite.
- **Chaves de reserva** (Serper 2.500/mês, Brave ~2.000/mês, Tavily, Exa, etc.)
  — cole a chave; quando a cota de uma acaba, a busca passa sozinha para a
  próxima. Tudo guardado criptografado no cofre do espaço, nunca no código.

Não é mais necessário `wrangler secret put` para isso. As variáveis de ambiente
antigas (`SEARCH_API_KEY`, `SEARXNG_BASE_URL` no cofre) continuam funcionando
como padrão para todos os espaços, mas a tela acima é o caminho recomendado.

### D. SysPag — repasse PIX (motorista GreenPay e prestador PJ)

O adaptador **já está pronto e desligado** (igual ao fiscal e ao WhatsApp): hoje,
quando você PAGA um lote aprovado do motorista **ou uma nota aprovada de prestador
PJ** (Portal do Colaborador → gestão), o valor vira "pago" no razão interno; com a
SysPag ligada, ele pode SAIR de fato por PIX para a chave que a pessoa informou. A
mesma credencial serve para os dois fluxos. **Nada aqui obriga serviço pago** — só
liga quando você quiser.

Sobre o **prestador PJ**: ele acessa o Portal do Colaborador (`/portal-colaborador`),
informa a própria chave PIX e imputa a nota fiscal do mês (número, competência,
valor, anexo). O valor é conferido contra o "salário"/contrato cadastrado no
colaborador — que o financeiro pode ajustar (ex.: entrada no meio do mês). Nota
aprovada vira conta a pagar; o repasse sai por PIX quando a SysPag estiver ligada.
O **CLT** vê os próprios dados nesse mesmo portal, mas o banco/PIX é cadastrado pelo
RH (Cadastros → Contas bancárias); em caso de divergência, o CLT **abre um chamado**
ali mesmo (categoria, assunto, descrição) — a equipe (RH/financeiro) atende e
responde, e o CLT vê a resposta. Para o PJ prestador ter login sem enxergar o resto
do ERP, use o papel **"Colaborador"** ao liberar o acesso dele.

Para ligar, preciso que você levante com a SysPag e cadastre no cofre:

1. `npx wrangler secret put SYSPAG_API_TOKEN` — a credencial de acesso (o valor
   fica **só** no cofre da Cloudflare; nunca no código nem no banco).
2. `npx wrangler secret put SYSPAG_BASE_URL` — a URL base da API (produção).
3. (Se a SysPag usar outro caminho/cabeçalho) `SYSPAG_PAGAMENTO_PATH`,
   `SYSPAG_AUTH_HEADER`, `SYSPAG_AUTH_SCHEME` — opcionais, com padrões sensatos.

**Chave PIX do motorista — já resolvida (é o destino do repasse).** O motorista
informa a PRÓPRIA chave no portal dele (aba Perfil → "Chave PIX do repasse"),
escolhendo o tipo (CPF, e-mail, telefone ou aleatória); o sistema valida a chave
pelo tipo antes de gravar (chave torta é recusada, nunca "consertada" às
escondidas). A operação **vê e corrige** a mesma chave no cadastro do ERP
(Cadastros → Motoristas), com a mesma validação. Quando a SysPag estiver ligada,
o "Pagar" lê essa chave e dispara o repasse; se o motorista ainda não informou a
chave, o pagamento **não** é marcado como pago — o dinheiro não sai sem destino.

Perguntas a levar à SysPag (para eu terminar de ligar sem retrabalho):

- Qual a URL base da API (produção e homologação)?
- Como se emite a credencial e qual o cabeçalho de autenticação (Bearer?)?
- Qual o endpoint e o corpo para criar um pagamento/repasse PIX?
- Há webhook de confirmação de liquidação do pagamento? (Hoje eu registro o lote
  como pago quando a SysPag aceita o disparo; o id externo do pagamento volta na
  resposta. Guardar esse id junto ao lote é um acréscimo pequeno que faço quando
  o contrato da API estiver confirmado.)


## 🚫 O que não é possível construir, e por quê

Esta seção existe para você não ficar esperando por algo que não vai chegar. Não
é falta de esforço: cada item aqui depende de dinheiro, de aprovação de uma
plataforma, ou de um documento que só você pode obter. Onde existe um caminho
parcial, ele já está construído e está dito abaixo.

### Depende de infraestrutura paga

- **Agente com navegador próprio, sandbox de código e computador virtual**
  (operar sistemas que não têm API, preencher formulários sozinho, executar
  Python). Rodar um navegador de verdade no servidor exige a Browser Rendering
  da Cloudflare, que é **cobrada por uso**. Não há versão gratuita.
- **Edição simultânea entre pessoas** (cursores, seleção visível, resolução de
  conflito em tempo real) em documentos, quadros e diagramas. Exige conexão
  permanente por Durable Objects, que está **fora do plano gratuito**. O que
  existe hoje: cada pessoa edita e a sincronização acontece ao salvar.
- **Reconhecimento de escrita à mão** no quadro rápido. Exige serviço de OCR
  pago. O reconhecimento de **formas** (retângulo, círculo, triângulo, linha)
  está pronto e é gratuito.
- **Busca semântica por embeddings em todo o histórico.** Guardar os vetores de
  milhares de itens exigiria um banco vetorial pago. O que entreguei no lugar:
  busca com radical de palavra, glossário da empresa e sinônimos, que resolve
  plural, sigla e variação — sem custo.

### Depende de aprovação de uma plataforma

- **Bot que entra sozinho em Google Meet, Zoom ou Teams** para gravar. Cada
  plataforma exige um aplicativo aprovado por ela, com revisão. O que existe:
  gravar o áudio da sala pelo navegador e enviar arquivo de áudio — resolve
  reunião presencial e chamada no viva-voz.
- **App na App Store e na Play Store.** Hoje o app instala pela Tela de Início
  do celular e funciona em tela cheia. Estar na loja exige conta de
  desenvolvedor Apple (US$ 99/ano) e Google (US$ 25 uma vez). Consequência
  prática: no iPhone, as notificações só funcionam depois de instalado na Tela
  de Início — é regra da Apple.
- **Assinatura com certificado ICP-Brasil (documentos entre partes).** A
  assinatura eletrônica **simples** (Lei 14.063/2020) está pronta e vale entre
  as partes que a aceitam; a assinatura ICP-Brasil exige o certificado A1/A3 no
  seu CNPJ.

### Emissão fiscal real (CT-e, MDF-e e CIOT) — o ERP está pronto, falta ligar

O lado do ERP das três emissões está **completo e honesto**: monta o documento,
calcula os impostos, gera o XML e **nunca marca nada como transmitido/autorizado
sem a resposta oficial do órgão**. O que falta é infraestrutura que só você pode
prover — igual em CT-e/MDF-e (SEFAZ) e CIOT (ANTT), porque em nenhum dos dois o
servidor assina ICP-Brasil ou faz o mTLS sozinho; quem faz é um **conector** no
seu servidor.

1. **Certificado digital A1 (ou A3) do seu CNPJ.** Base64 do PFX + senha vão para
   o cofre (`NFE_CERT_PFX`/`NFE_CERT_PASSWORD` para SEFAZ; o CIOT usa o seu
   próprio, veja `docs/todogreen-ciot-direct-connector.md`).
2. **Conector SEFAZ** publicado no seu servidor (assina o XML e transmite à SEFAZ
   da sua UF). Contrato e passos: `docs/todogreen-sefaz-connector.md`. Cadastre
   `SEFAZ_CONNECTOR_URL`, `SEFAZ_CONNECTOR_ALLOWED_HOSTS`, `SEFAZ_CONNECTOR_TOKEN`
   e `SEFAZ_AMBIENTE` no cofre.
3. **Conector CIOT** (ANTT) publicado no seu servidor Windows, com o pacote
   oficial da ANTT. Contrato e passos: `docs/todogreen-ciot-direct-connector.md`.
4. **Valide em homologação** antes de operar em produção. Enquanto não estiver
   ligado, o ERP gera XML/DACTE e só aceita registro manual com o protocolo e a
   chave oficiais — nunca um "autorizado" que o órgão não deu.

### Depende de cadastro ou credencial sua

- **Gmail, Outlook, Google Drive, OneDrive, Slack, Teams bidirecionais.**
  Exigem consentimento OAuth na sua conta. Os passos do Gmail estão na seção A.
- **Google Calendar e Outlook Calendar sincronizados.** Mesmo caminho do Gmail:
  escopo de calendário na tela de consentimento + `GOOGLE_CLIENT_SECRET`.
- **WhatsApp, Instagram Direct, Messenger, Telegram, SMS, telefonia.** Cada um
  exige conta de desenvolvedor e verificação. WhatsApp está na seção B.
- **SSO SAML, SCIM e provisionamento automático de usuários.** Exigem um
  provedor de identidade corporativo (Microsoft Entra, Okta, Google Workspace)
  contratado por você. Login com Google já funciona.
- **Pesquisa na internet.** Seção C acima — o item mais barato de destravar.

### Não faz sentido construir

- **Plataforma de IA para terceiros** (API de embeddings, fine-tuning,
  hospedagem de modelos, MLOps, marketplace de modelos). Você mesma escreveu
  isso na sua lista, e concordo: é outra categoria de produto, competindo com
  OpenAI, Azure e Google. O que faz sentido aqui é uma **API pública do Seu
  Funcionário** para integrar com o que você já usa — isso sim é viável, e
  entra na fila quando você quiser.
- **Reconstruir o Microsoft 365 inteiro.** Integrar vale; recriar Word, Excel e
  Teams não. O ganho está na camada de IA e operação sobre eles.

## ✅ Já resolvidas

- Conta Cloudflare conectada, app publicado e permanente
- Deploy automático conectado ao GitHub; alterações na `main` são publicadas sem ação manual
- Publicação real de sites e captação de contatos no banco
- Chaves Gemini/xAI/Google/Brevo no cofre do servidor
- Login com Google: origem autorizada, usuário de teste e fluxo completo validados
- Gmail API e Google Calendar API ativadas com os escopos necessários
- Verificação de e-mail por código no cadastro: entrega real e criação de conta validadas
- Recuperação de senha por código de e-mail
- Guia `AGENTS.md` para revezamento entre assistentes
- Compras e suprimentos: solicitações de cotação, propostas por fornecedor,
  comparação por item, melhor oferta, totais e exportação CSV, com vínculos
  opcionais a negócio, projeto, fornecedor e contrato
- Histórico de recuperação do workspace: até 20 versões anteriores no servidor,
  restauração protegida por revisão e preservação da versão substituída
- Cabeçalhos defensivos nas respostas da API contra incorporação, interpretação
  indevida de conteúdo, vazamento de referência e acesso desnecessário a sensores
- Envio automático para outro sistema (Zapier, Make, n8n, Discord, planilha do
  Google): cadastre o endereço em Integrações e escolha o que avisar. O
  servidor avisa sozinho quando entra pedido, contato, lançamento, agendamento
  ou tarefa — mesmo com o app fechado. Cada aviso vai assinado, para o outro
  sistema conferir que veio mesmo de nós
- Automações executadas de hora em hora no servidor, mesmo com o app fechado,
  com prevenção de duplicidade, snapshots e registro relacional das execuções

## Integração com o TMS TRACK3R — o que perguntar ao fornecedor

A integração está **construída e funcionando no modo arquivo**: você exporta o
relatório da Consulta de Coletas no TRACK3R e sobe na tela do TMS. Isso não
exige credencial, não exige contrato novo e não tem custo. Reimportar o arquivo
do dia seguinte não duplica nada — o sistema reconhece o que já entrou e só
atualiza o status.

### O webhook de ocorrências já tem receptor (31/08)

Você entregou a especificação do fornecedor ("WebHook Envio de
Ocorrências/Tracking"). Ela pede que NÓS exponhamos a API e informemos a URL ao
TRACK3R; ele chama com o cabeçalho `Token`. O receptor está construído e
testado, e **fica desligado até o segredo existir** — sem ele, responde 503 de
propósito, porque aceitar ocorrência sem conferir token é deixar qualquer um
escrever na sua operação.

**Três passos, só você pode dar:**

1. Escolher o token e cadastrar no cofre (o valor nunca entra em código,
   commit, log ou conversa):

   ```
   openssl rand -hex 32                                   # gera um valor forte
   npx wrangler secret put TODOGREEN_TRACK3R_WEBHOOK_SECRET
   ```

2. Pegar o id da sua integração TRACK3R (aparece na tela do TMS, em
   Configuração) e informar ao suporte do TRACK3R a URL e o token:

   `https://seufuncionario-expo.brunapsiles.workers.dev/api/todogreen/tms/webhook/<id-da-integração>`

3. Pedir a eles a **tabela oficial de códigos de ocorrência**. O documento só
   revela `"03" = Entregue`. Sem a lista, quem decide o tipo do evento é a
   descrição em texto, e o código fica guardado cru. Quando a tabela chegar, ela
   entra na configuração da integração (campo `ocorrenciaPorCodigo`) e passa a
   mandar — sem precisar de publicação nova.

**O que perguntar junto**, porque muda o comportamento do receptor:

- o cabeçalho é exatamente `Token` e o valor é fixo por cliente, ou expira?
- um POST traz UMA ocorrência ou uma lista? (hoje o receptor aceita uma)
- o TRACK3R reenvia quando não recebe resposta? Quantas vezes, com que
  intervalo, e qual código ele entende como "recebido"? (respondemos 200 com
  `{"status": true, "descricao": "Recebido com sucesso!"}`, como a
  especificação pede)
- a `encomenda` é estável entre as ocorrências da mesma entrega e é o mesmo
  número do relatório de coletas? (é ela que amarra a ocorrência à operação)
- `ocorrencia.data` vem sempre em dd/mm/aaaa hh:mm:ss no fuso de Brasília?
- o `cnpj_embarcador` vem sempre preenchido? (é o ÚNICO critério de casamento
  com a conta — sem ele o registro entra na fila do que falta casar)
- por quanto tempo os links de comprovante e assinatura ficam disponíveis? (o
  portal do cliente aponta para eles)

Os modos **API** e **webhook** estão prontos; o webhook espera só o segredo e a
URL informada. Enquanto isso, o modo arquivo cobre a operação inteira.

**Segredos a cadastrar no cofre do Worker**:
`TODOGREEN_TRACK3R_API_TOKEN` (quando a API existir) e
`TODOGREEN_TRACK3R_WEBHOOK_SECRET` (o webhook, acima).

**Perguntas ao suporte do TRACK3R** (as mesmas estão na tela, em
`PERGUNTAS_AO_TRACK3R`):

1. Existe API REST? Qual a URL base e onde está a documentação?
2. Como se emite o token de acesso, e em qual cabeçalho ele vai?
3. Existe webhook de mudança de status de coleta e de entrega? Como o segredo é
   validado?
4. Quais campos vêm em Consulta Dados Nota Fiscal (número, série, chave de 44
   dígitos, valor)?
5. O relatório exportado sai em CSV ou XLSX, e com quais colunas exatas no
   cabeçalho?
6. O embarcador vem com CNPJ, ou só com nome e agrupador?
7. O tipo de veículo vem no documento? Com que vocabulário (moto, van, VUC,
   truck, carreta)?
8. Existe identificador estável do documento que não muda quando o status muda?

**Não confundir com a Sistemas Tracker.** São dois fornecedores diferentes: o
TRACK3R traz o DOCUMENTO (o que foi coletado e entregue); a Sistemas Tracker traz
a POSIÇÃO (onde o veículo está). As duas integrações convivem e não se
substituem.

## Dossiê do negócio — o que só você pode cadastrar (31/08)

A IA já sabe da To Do Green tudo o que os documentos que você enviou tornaram
público ou interno: identidade, história, portfólio, malha, indicadores com
fonte, ficha cadastral, CNAEs, alçada societária, seguros e o painel de
validades da Central de RFQ/RFI. Isso vem carregado sozinho na primeira
pergunta feita ao Plantû e fica editável em **Administração › Sobre o negócio**.

O que **não** foi para o código, de propósito, e por isso precisa ser cadastrado
por você na tela com sigilo **Restrito**:

- **Conta bancária** (Santander, agência e conta). Dado bancário não entra em
  repositório de código.
- **CPF da sócia administradora e do administrador não sócio**, e o número da
  CNH. Vale a mesma regra que já vale no resto do produto: documento de pessoa
  só para dona, administração e RH, e nunca no payload do portal do cliente.

Cadastrados com sigilo Restrito, esses pontos entram nas respostas do Plantû
apenas para quem tem `finance:manage` (ou é dona/admin) — para os outros o fato
nem chega ao modelo, então não há o que vazar na resposta.

### Três correções que o dossiê registra e ninguém resolve por você

1. **As apólices RCTR-C e RC-DC constam como vencidas em 13/08/2026.** Existe
   certificado da Porto Seguro emitido em 14/08/2026 com vigência até
   13/02/2027 — confirme com a Prata Corretora qual documento vale e corrija o
   ponto "O que trava um RFQ hoje" na tela.
2. **O número da frota diverge**: +500 na apresentação, 100 próprios + 10
   agregados na apólice, 13 ativos no RNTRC. Enquanto não houver um número
   conferido, a IA foi instruída a dizer que é preciso confirmar antes de
   responder frota em RFI — o que é melhor do que mandar o número errado, mas
   não substitui resolver.
3. **Endereço no RNTRC (Av. Paulista, 1842) diverge do CNPJ (Rua Quatá, 157).**
