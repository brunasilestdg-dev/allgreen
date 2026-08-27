# CIOT direto: checklist operacional

Este checklist fecha o que precisa existir fora do ERP para a integração direta sem IPEF funcionar com frota própria ou ETC subcontratada.

Fonte oficial da ANTT: https://www.gov.br/antt/pt-br/assuntos/cargas/ciot-para-todos-1/documentos-tecnicos/piso-minimo-ciot

## Itens obrigatórios

| Item | Como fica pronto | Evidência |
| --- | --- | --- |
| DCS vigente | Baixado da página oficial da ANTT e salvo em `C:\ANTT\CIOT\downloads` | Caminho registrado em `C:\ToDoGreen\AnttCiotConnector\ops\antt-ciot-install-manifest.json` |
| DLL oficial ANTT | Baixada da página oficial, quando a operação usar biblioteca | Caminho registrado no manifesto |
| EXE oficial ou adaptador EXE | Baixado da ANTT ou informado via `-AnttExecutablePath` | `AnttProcess:ExecutablePath` no `appsettings.Production.json` |
| Servidor Windows | Windows com .NET 8, acesso ao certificado A1/A3 e saída HTTPS para ANTT | Serviço `ToDoGreenAnttCiotConnector` iniciado |
| URL HTTPS do conector | Reverse proxy ou tunnel apontando para `http://127.0.0.1:8088` | `https://<host>/health` retorna `operacional` |
| Token interno | Gerado pelo bootstrap ou informado via `-ConnectorToken` | `connector-token.txt` e `erp-ciot-connector.env` criados |
| ERP configurado | Variáveis `TODOGREEN_ANTT_CIOT_CONNECTOR_URL` e `TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN` aplicadas | Tela CIOT consegue testar credencial e enviar |

## Comando padrão no servidor Windows

```powershell
cd C:\repos\Seufuncionario\connectors\antt-ciot\scripts

.\bootstrap-windows.ps1 `
  -AnttExeUrl "https://url-oficial-da-antt/executavel-ciot-producao.exe" `
  -AnttDllUrl "https://url-oficial-da-antt/biblioteca-ciot-producao.dll" `
  -DcsUrl "https://url-oficial-da-antt/dcs-ciot.pdf" `
  -PublicConnectorUrl "https://ciot.todogreen.com.br"
```

Se a ANTT entregar ZIP único, use `-AnttPackageUrl` no lugar de `-AnttExeUrl` e `-AnttDllUrl`.

Se os arquivos já foram baixados manualmente, use `-AnttExePath`, `-AnttDllPath` e `-DcsPath`.

## Saídas geradas pelo bootstrap

| Arquivo | Uso |
| --- | --- |
| `C:\ToDoGreen\AnttCiotConnector\app\appsettings.Production.json` | Configuração do serviço Windows |
| `C:\ToDoGreen\AnttCiotConnector\secrets\connector-token.txt` | Token interno do conector |
| `C:\ToDoGreen\AnttCiotConnector\ops\erp-ciot-connector.env` | Variáveis para colar no ambiente do ERP |
| `C:\ToDoGreen\AnttCiotConnector\ops\antt-ciot-install-manifest.json` | Prova dos artefatos usados na instalação |

## Publicação HTTPS

O microsserviço deve ficar local em `http://127.0.0.1:8088`. A exposição externa precisa ser HTTPS.

Opções prontas no repo:

| Opção | Arquivo |
| --- | --- |
| Cloudflare Tunnel | `connectors/antt-ciot/deploy/cloudflared-config.example.yml` |
| Caddy | `connectors/antt-ciot/deploy/Caddyfile.example` |

## Verificação

```powershell
.\verify-connector.ps1 `
  -HealthUrl "https://ciot.todogreen.com.br/health" `
  -ConnectorUrl "https://ciot.todogreen.com.br/ciot" `
  -Token "<TOKEN_DO_CONNECTOR>"
```

O teste de token não emite CIOT. Ele autentica a chamada e espera uma recusa por modo inválido. Se vier HTTP 400, o token passou. Se vier HTTP 401, o token está errado.

## O que ainda é externo ao código

- A empresa precisa fornecer o certificado digital ICP-Brasil A1 ou A3.
- A URL pública precisa existir no DNS ou tunnel escolhido.
- O pacote oficial da ANTT precisa ser baixado da página oficial vigente.
- Se a ANTT exigir chamada via DLL sem EXE, o `-AnttExecutablePath` deve apontar para o adaptador EXE que encapsula a DLL conforme o DCS.
