# Extensão do navegador — To Do Green ERP

Leva o Plantû para **qualquer página** do navegador: resumir uma página para o
ERP, preparar resposta de e-mail, sugerir tarefa, sugerir próxima ação do CRM ou
perguntar sobre o que você está vendo. Quando a IA sugerir uma ação suportada,
a extensão mostra **Executar ação no ERP** para gravar depois da sua confirmação.

É a **frente 4** do pacote de funções grandes. Não é uma página do app: é um
pequeno pacote de extensão que conversa com o endpoint da vertical
`/api/todogreen/semente`, usando o seu token de acesso.

## Como instalar (Chrome / Edge / Brave)

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta `extension/`.
4. Fixe a extensão na barra (ícone de quebra-cabeça → alfinete).

## Como instalar (Firefox)

1. Abra `about:debugging#/runtime/this-firefox`.
2. **Carregar extensão temporária…** e selecione o arquivo `manifest.json`
   desta pasta.

## Como conectar

1. No app, vá em **Administração → Integrações → Extensão do navegador** e copie o **token**.
2. Clique no ícone da extensão → **Config** → cole o token → **Salvar**.
   O token fica salvo só no seu navegador.

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
