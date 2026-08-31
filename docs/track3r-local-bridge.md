# TRACK3R Local Bridge

Ponte provisória para alimentar o ERP sem depender da API oficial do TRACK3R.

## O que permanece intacto

O conector TMS existente continua com os modos atuais:

- arquivo manual;
- API oficial;
- webhook oficial de ocorrências.

O agente local é uma entrada adicional. Ele não altera `sync_mode`, não remove configuração e não substitui o endpoint oficial.

## Fluxo

```text
Máquina Windows
  -> Playwright reutiliza a sessão autenticada do TRACK3R
  -> coleta o relatório
  -> converte XLSX/CSV/tabela/JSON em linhas
  -> calcula hash do conjunto
  -> envia somente quando houver mudança
  -> POST /api/todogreen/tms/local-bridge/:integrationId
  -> mesmo banco/canonicalização do TMS
```

A tarefa do Windows executa a coleta a cada 10 minutos.

## Estratégias disponíveis

### `download`

Abre a página do relatório e clica no botão configurado em `downloadSelector`. Aceita XLSX, XLS, CSV, TXT e JSON.

### `table`

Lê uma tabela HTML diretamente da tela. Útil quando não há botão de exportação.

### `json-endpoint`

Usa a sessão autenticada do navegador para chamar um endpoint interno do próprio portal. É a opção preferida quando o modo `probe` revelar uma consulta JSON estável.

## 1. Criar a configuração local

Na máquina que ficará ligada:

```powershell
Copy-Item scripts\track3r-local-bridge\config.example.json scripts\track3r-local-bridge\config.local.json
```

Preencha:

- `portalUrl`: endereço inicial do TRACK3R;
- `reportUrl`: tela de consulta/relatório;
- `erpBridgeUrl`: endpoint do ERP com o ID da integração TMS;
- `strategy`: `download`, `table` ou `json-endpoint`;
- seletor/endereço específico da estratégia.

`config.local.json` é ignorado pelo Git.

## 2. Criar um segredo exclusivo do agente local

Gere um segredo forte:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Cadastre o mesmo valor nos dois lados.

No Cloudflare Worker:

```powershell
npx wrangler secret put TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET
```

Na máquina Windows:

```powershell
setx TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET "COLE-O-SEGREDO-AQUI"
```

Abra um novo terminal depois do `setx`.

Esse segredo é independente do token da API e do segredo do webhook oficial do TRACK3R.

## 3. Instalar o navegador do agente

```powershell
npm install
npx playwright install chromium
```

## 4. Gravar a sessão do TRACK3R

```powershell
npm run track3r:login
```

Uma janela será aberta. Faça login normalmente e feche a janela quando o portal estiver autenticado. A sessão fica no perfil local ignorado pelo Git.

Não salve usuário ou senha no repositório.

## 5. Descobrir a melhor forma de coleta

Se ainda não soubermos qual botão, tabela ou endpoint usar:

```powershell
npm run track3r:probe
```

Navegue pela consulta desejada no TRACK3R e feche a janela. O agente salva apenas metadados das respostas JSON em `.track3r-network-candidates.json`, sem salvar corpos das respostas.

Se houver endpoint JSON estável, configure `strategy: "json-endpoint"`. Caso contrário, use `download` ou `table`.

## 6. Testar manualmente

```powershell
npm run track3r:sync
```

O log deve terminar com `sync_complete`. Se o relatório não mudou desde a última execução, retorna `no_changes` e não envia novamente.

## 7. Registrar a execução a cada 10 minutos

Abra PowerShell na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\track3r-local-bridge\install-windows-task.ps1
```

A tarefa criada chama `run-sync.cmd` a cada 10 minutos e grava o resultado em:

```text
logs/track3r-local-bridge.log
```

## Segurança

- a sessão do TRACK3R fica somente na máquina;
- credenciais do portal não entram no código;
- o token do agente local fica no cofre do Worker e na variável de ambiente do Windows;
- o endpoint do agente não aceita sessão de usuário como autenticação;
- cada lote tem limite de 300 linhas e 5 MB;
- chamadas possuem rate limit;
- a integração oficial permanece separada.

## Troca futura pela API oficial

Quando o TRACK3R disponibilizar a API:

1. configurar o modo API existente no ERP;
2. validar uma sincronização oficial;
3. desabilitar a tarefa `ToDoGreen Track3r Local Bridge` no Windows.

Nenhuma tabela precisa ser migrada. Os documentos continuam no mesmo modelo canônico do TMS.
