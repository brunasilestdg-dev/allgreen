# Extensão do navegador — To Do Green ERP

Leva o Plantû para **qualquer página** do navegador: resumir uma página para o
ERP, preparar resposta de e-mail, sugerir tarefa, sugerir próxima ação do CRM ou
perguntar sobre o que você está vendo. Quando a IA sugerir uma ação suportada,
a extensão mostra **Executar ação no ERP** para gravar depois da sua confirmação.

É a **frente 4** do pacote de funções grandes. Não é uma página do app: é um
pequeno pacote de extensão que conversa com o endpoint da vertical
`/api/todogreen/semente`, usando o seu token de acesso.

## Onde baixar

O próprio app entrega o pacote: o build grava esta pasta em
`/extensao-todogreen.zip` (`scripts/extension-package.js`). O botão
**Baixar a extensão** aparece em dois lugares:

- **To Do Green**: avatar no cabeçalho → **Meu perfil** → **Extensão do navegador**.
- **App geral**: **Configurações** → **Extensão do navegador**.

Descompacte o arquivo: a pasta `extensao-todogreen` é a que se escolhe abaixo.

## Como instalar (Chrome / Edge / Brave)

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao-todogreen`
   (ou esta pasta `extension/`, para quem trabalha no código).
4. Fixe a extensão na barra (ícone de quebra-cabeça → alfinete).

O `manifest.json` usa `default_locale: "pt_BR"`, então a pasta
`_locales/pt_BR/messages.json` é obrigatória: sem ela o Chrome recusa carregar
a extensão inteira. `src/extension-manifest.test.js` trava isso.

## Como instalar (Firefox)

1. Abra `about:debugging#/runtime/this-firefox`.
2. **Carregar extensão temporária…** e selecione o arquivo `manifest.json`
   desta pasta.

## Como conectar

1. No mesmo lugar do download, copie o **token de acesso**.
2. Clique no ícone da extensão → **Config** → cole o token → **Salvar**.
   O token fica salvo só no seu navegador.
3. O token é o da sua sessão e **vale por 24 horas**. Quando entrar de novo no
   app, copie o novo e cole outra vez. A extensão conversa com o Plantû da
   To Do Green, então precisa de uma conta com acesso à vertical.

## O que ela faz

- **Resumo para o ERP** — transforma a página em leitura operacional curta.
- **Sugerir tarefa** — pede ao Plantû uma tarefa para a Central de Implantação.
- **Próxima ação CRM** — sugere atualização da próxima ação da conta.
- **Executar ação no ERP** — cria tarefa, atualiza próxima ação ou dispara
  pesquisa externa somente depois do clique de confirmação.
- **Responder e-mail** — prepara resposta profissional com contexto da página.
- **Perguntar ao Plantû** — pergunta qualquer coisa sobre a página aberta.

Também há um item no **menu do botão direito**: "Perguntar ao Plantû no ERP".

## Gratuidade e privacidade

- Usa o mesmo endpoint de IA do app (sem serviço novo, sem custo extra).
- Só envia o conteúdo para a IA quando **você** clica em uma ação.
- O token fica apenas no seu navegador (`chrome.storage.local`).

## Publicar na loja (opcional)

- **Firefox**: gratuito.
- **Chrome Web Store**: taxa única de US$ 5 para conta de desenvolvedor. Não é
  necessário para uso pessoal via "Carregar sem compactação".

## Manutenção

A lógica de montagem do prompt fica em `prompt.js` (`buildExtensionPrompt`),
importada pelo `popup.js` e coberta por testes em
`src/extension-prompt.test.js`. Se mudar o comportamento, atualize os dois.
