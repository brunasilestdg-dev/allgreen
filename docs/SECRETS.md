# Segredos, variáveis e bindings do Worker

Inventário de **tudo o que o Worker lê de `env`** — segredos, variáveis e
bindings. **Nenhum valor entra em código, commit, log ou frontend.** Segredos vão
no cofre do Worker (`wrangler secret put NOME`); variáveis públicas ficam em
`wrangler.jsonc → vars`. O app sobe sem os opcionais: a integração fica
`NOT_CONFIGURED` até a chave existir, nunca forjada como ativa.

> **Este arquivo é conferido por teste.** `src/secrets-inventory.test.js` varre
> `worker.js`, `worker-entry.js` e `worker/**` e reprova se o código passar a
> ler um `env.NOME` que não esteja listado aqui. Variável nova entra no código
> **e** nesta página no mesmo commit.

## Bindings (`wrangler.jsonc`)

| Binding | Tipo | Sem ele |
| --- | --- | --- |
| `DB` | D1 `allgreen-db` | contas e dados não existem; rotas autenticadas respondem 503 (modo local sem banco usa o usuário `local`) |
| `AI` | Workers AI | cai a contingência de IA do próprio Cloudflare (FLUX, Whisper da transcrição, modelos Llama/GLM/gpt-oss da cascata) |
| `ASSETS` | Assets estáticos (`./dist`) | não há SPA; `run_worker_first` lista os caminhos que o Worker atende antes dos assets (API e páginas públicas renderizadas no servidor: `/f/`, `/s/`, `/loja/`, `/orcamento/`, `/portal/`, `/agenda/`, `/atendimento/`) |
| `MEDIA_BUCKET` | R2 (**opcional, não declarado hoje**) | fotos/assinaturas do POD e arquivos do cofre ficam em chunks base64 no D1 (`worker/services/todogreen-file-store.js`); com o binding, os bytes vão para o R2 |

## Variáveis públicas (`wrangler.jsonc → vars`, não são segredo)

| Nome | Uso |
| --- | --- |
| `GEMINI_MODEL` | modelo Gemini padrão |
| `XAI_MODEL` | modelo xAI (Grok) — exige confirmação paga |
| `MONDAY_CLIENT_ID` | client id público do app OAuth do monday.com |
| `TODOGREEN_ADMIN_EMAILS` | e-mails (vírgula) com papel de administrador da vertical |
| `TDG_ENVIRONMENT` | ambiente declarado pelo Worker (`production`, `preview`…), mostrado em `/api/system/version` e na Saúde do sistema |

## Conta, e-mail e suporte

| Segredo | Para quê | Sem ele |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | login com Google (publicado em `/api/config`) | só login por e-mail e senha |
| `GOOGLE_API_KEY` | serviços Google do frontend | recurso correspondente indisponível |
| `BREVO_API_KEY` | e-mail transacional (verificação, recuperação, convites, avisos) | nada é enviado; o convite mostra o motivo e o link continua valendo |
| `MAIL_SENDER` / `MAIL_SENDER_NAME` | remetente dos e-mails | idem |
| `SUPPORT_EMAIL` | canal de suporte mostrado no app | usa `MAIL_SENDER` |
| `PUBLIC_APP_URL` | URL pública informada ao OpenRouter (`HTTP-Referer`) | `https://orianone.app` |

Em 24/09/2026 o `/api/config` de produção devolvia `supportEmail: ""`, o que só
acontece com `SUPPORT_EMAIL` e `MAIL_SENDER` vazios — e sem `MAIL_SENDER` o
`emailEnabled` é falso: "Esqueci minha senha" responde 503, convite sai sem
e-mail e o cadastro não pede código. Conferir no cofre.

## Chaves de cifragem (cofres internos)

São **pré-requisito** do recurso: sem elas o recurso recusa gravar em vez de
guardar credencial em texto puro. Mínimo de 32 caracteres. **Rotacionar uma
delas torna ilegível o que foi cifrado com a anterior** — planeje a troca.

| Segredo | Protege | Observação |
| --- | --- | --- |
| `WORKSPACE_AI_VAULT_KEY` | chaves de IA trazidas pelo espaço (BYOK) e conexões MCP | não cai em `SESSION_SECRET` de propósito |
| `TODOGREEN_CIOT_VAULT_KEY` | credenciais do conector CIOT | se ausente, usa `SESSION_SECRET` (legado) |
| `SESSION_SECRET` | só o fallback do cofre CIOT acima | a sessão em si não usa este segredo (token aleatório + hash no D1) |
| `MONDAY_TOKEN_ENCRYPTION_KEY` | tokens OAuth do monday.com | se ausente, deriva de `MONDAY_CLIENT_SECRET` + `MONDAY_SIGNING_SECRET` |

## IA

### Cascata gratuita da plataforma

Cada chave liga um provedor na cascata (`worker/services/ai.js`); só entram os
configurados, e ao final há contingência local.

| Segredo | Provedor | Modelo (opcional) |
| --- | --- | --- |
| `GEMINI_API_KEY` | Google Gemini/Gemma | `GEMINI_MODEL` (var) |
| `GROQ_API_KEY` | Groq | `GROQ_MODEL` |
| `SAMBANOVA_API_KEY` | SambaNova | `SAMBANOVA_MODEL` |
| `CEREBRAS_API_KEY` | Cerebras | `CEREBRAS_MODEL` |
| `MISTRAL_API_KEY` | Mistral | `MISTRAL_MODEL` |
| `OPENROUTER_API_KEY` | OpenRouter (rota gratuita) | — |
| `HF_TOKEN` | Hugging Face | `HF_MODEL` |

`GITHUB_MODELS_TOKEN` não é mais lido: o GitHub Models foi aposentado em
30/07/2026 (docs.github.com/en/github-models) e saiu da cascata.

**Rota sensível (LGPD)**: pedido com CPF, cartão, senha/chave, conta bancária ou
termo clínico vai só para quem não treina com o conteúdo (IA local, Cerebras,
Groq, Workers AI, SambaNova e chaves pagas do próprio espaço). A Gemini API
gratuita usa o conteúdo para melhorar produtos e pode ter revisão humana
(ai.google.dev/gemini-api/terms), por isso fica fora dessa rota. Para o Groq,
ligue o *Zero Data Retention* em Data Controls no console.

### Provedores pagos

| Segredo | Regra |
| --- | --- |
| `XAI_API_KEY` | Grok; **fora da cascata automática** — só com `confirmPaid: true` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude. Pensado para **chave trazida pelo espaço** (tela de chaves de IA, cifrada com `WORKSPACE_AI_VAULT_KEY`), que o espaço paga. ⚠️ Se for cadastrado no cofre **da plataforma**, entra no fim da cascata automática **sem** confirmação paga — contraria a regra de gratuidade do `AGENTS.md`; não cadastrar no Worker |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | ChatGPT; mesma regra e mesmo aviso do Claude |

### IA auto-hospedada (opcional)

| Variável | Uso |
| --- | --- |
| `TODOGREEN_OLLAMA_BASE_URL` + `TODOGREEN_OLLAMA_MODEL` | servidor Ollama (API compatível com a OpenAI em `/v1`); entra na cascata e lidera a rota sensível |
| `TODOGREEN_OLLAMA_API_KEY` | só se o Ollama estiver atrás de um proxy com autenticação |
| `TODOGREEN_VLLM_BASE_URL` + `TODOGREEN_VLLM_MODEL` + `TODOGREEN_VLLM_API_KEY` | servidor vLLM |

## Notificações push

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e (opcional) `VAPID_SUBJECT` (`mailto:`
ou URL do operador; padrão: URL de produção). Sem o par, `pushEnabled(env)` é
`false` e o app funciona sem notificações do navegador (em 24/09/2026 o
`/api/config` de produção ainda devolvia `vapidPublicKey: null`). Para gerar um
par no formato certo: `node scripts/gerar-chaves-vapid.mjs` e depois
`npx wrangler secret put` de cada um.

## Busca web (cota gratuita; cascata, nunca paralelo)

`SEARXNG_BASE_URL` (instância própria, sem cota) e `SEARXNG_TOKEN` (opcional,
para instância protegida), `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`,
`TAVILY_API_KEY`, `EXA_API_KEY`, `JINA_API_KEY`, `FIRECRAWL_API_KEY`,
`SEARCH1_API_KEY`, `YOU_API_KEY`, `SERPAPI_API_KEY`, `GOOGLE_SEARCH_API_KEY` +
`SEARCH_ENGINE_ID`. `SEARCH_API_KEY` é o nome legado: sem `SEARCH_ENGINE_ID`
vale como chave do Brave; com ele, como chave do Google CSE.
`SEM_BUSCA_GRATUITA=1` desliga a reserva gratuita (DuckDuckGo/Wikidata/
Wikipédia). Ordem da cascata: `AGENTS.md`.

## Mídia

| Segredo | Uso | Sem ele |
| --- | --- | --- |
| `VIDEO_AI_URL` + `VIDEO_AI_TOKEN` | servidor próprio de vídeo (`video-ai/`) | o gerador de vídeo indica a alternativa gratuita; nada de crédito de terceiros |

## Mensageria e caixa de entrada

| Nome | Uso | Sem ele |
| --- | --- | --- |
| `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` | envio pela WhatsApp Cloud API | o envio fica pelo `wa.me` (sem API) |
| `WHATSAPP_API_VERSION` | versão da Graph API | `v20.0` |
| `WHATSAPP_VERIFY_TOKEN` | verificação do webhook de entrada (GET da Meta) | a Meta não consegue validar o webhook |
| `WHATSAPP_APP_SECRET` | assinatura `x-hub-signature-256` do webhook de entrada | ⚠️ **sem ele o POST de entrada é aceito sem conferir assinatura** — cadastre antes de apontar o webhook para produção |
| `WHATSAPP_INBOUND_OWNER_ID` | dono do espaço que recebe o WhatsApp quando o número não está mapeado | usa `INBOUND_WEBHOOK_OWNER_ID` |
| `EVOLUTION_API_BASE_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | envio pelo WhatsApp via Evolution API (alternativa à Cloud API) | não usa a Evolution |
| `INBOUND_EMAIL_SECRET` | segredo do webhook de e-mail recebido (`/api/inbound/email`) | o webhook responde 403 |
| `EMAIL_INBOUND_OWNER_ID` | dono do espaço que recebe o e-mail quando o domínio não está mapeado | usa `INBOUND_WEBHOOK_OWNER_ID` |
| `INBOUND_WEBHOOK_OWNER_ID` | dono padrão das mensagens recebidas sem mapeamento | a mensagem sem dono é descartada |

Custos e riscos antes de ligar: a partir de 01/10/2026 a Meta cobra mensagens de
serviço acima de 1.000 por mês por número e para de entregar sem cartão
cadastrado. A Evolution API usa o protocolo não oficial do WhatsApp Web — os
Termos do WhatsApp proíbem automação não autorizada (risco de banimento do
número).

## monday.com

`MONDAY_CLIENT_ID` (var pública), `MONDAY_CLIENT_SECRET`, `MONDAY_SIGNING_SECRET`
e `MONDAY_TOKEN_ENCRYPTION_KEY` (ver cofres). As três primeiras juntas habilitam
o OAuth e o receptor de webhooks; sem elas o botão "Conectar" nem aparece.

## Pagamentos (repasse SysPag)

| Nome | Uso |
| --- | --- |
| `SYSPAG_API_TOKEN` | liga o repasse PIX; sem ele o "pago" do GreenPay e da nota do PJ é só o razão interno |
| `SYSPAG_BASE_URL` / `SYSPAG_PAGAMENTO_PATH` | endereço da API e caminho do pagamento |
| `SYSPAG_AUTH_HEADER` / `SYSPAG_AUTH_SCHEME` | cabeçalho e esquema de autenticação (padrão `Authorization: Bearer`) |

## Emissão fiscal — SEFAZ (CT-e/MDF-e) e CIOT (ANTT)

O Worker não assina ICP-Brasil nem faz mTLS: a transmissão real passa por um
**conector host-side**. Nada é marcado como transmitido/autorizado sem a resposta
oficial do órgão. Detalhes: `docs/todogreen-sefaz-connector.md` e
`docs/todogreen-ciot-direct-connector.md`.

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `NFE_CERT_PFX` | Certificado A1 (PFX base64) enviado ao conector SEFAZ para assinar | ERP gera XML/DACTE, não transmite |
| `NFE_CERT_PASSWORD` | Senha do PFX | idem |
| `SEFAZ_CONNECTOR_URL` | URL HTTPS do conector SEFAZ host-side | transmissão real desligada; só registro manual com protocolo |
| `SEFAZ_CONNECTOR_TOKEN` | Bearer do conector SEFAZ (opcional) | chamada sem autenticação |
| `SEFAZ_CONNECTOR_ALLOWED_HOSTS` | Hosts autorizados do conector (o certificado sai daqui) | transmissão bloqueada (destino não pode ser aberto) |
| `SEFAZ_AMBIENTE` | `homologacao` (padrão) ou `producao` | assume homologação |
| `TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX` / `TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD` | certificado A1 do CIOT direto | CIOT depende do conector Windows/ANTT |
| `TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL` | conector de certificado A3 (alternativa ao A1) | idem |
| `TODOGREEN_ANTT_CIOT_BASE_URL` / `TODOGREEN_ANTT_CIOT_CONNECTOR_URL` / `TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN` | serviço da ANTT e conector host-side | CIOT fica preparado, não emitido |
| `TODOGREEN_ANTT_CIOT_ALLOWED_HOSTS` | hosts permitidos para o conector CIOT | o destino é recusado |

Os nomes do CIOT são os padrões: a integração pode apontar outros nomes de
segredo por espaço, sempre lidos de `env`.

## TMS, rastreamento e webhooks de transporte

| Nome | Uso |
| --- | --- |
| `TODOGREEN_TRACK3R_API_TOKEN` | API do TRACK3R (nome padrão; a integração pode indicar outro) |
| `TODOGREEN_TRACK3R_WEBHOOK_SECRET` | segredo legado compartilhado dos webhooks — prefira um token por endpoint (`docs/TRACK3R_TOKENS_INDIVIDUAIS.md`) |
| `TODOGREEN_TRACK3R_LOCAL_BRIDGE_SECRET` | ponte local do TRACK3R (`scripts/track3r-local-bridge/`) |
| `TODOGREEN_TRACKER_API_TOKEN` / `TODOGREEN_TRACKER_WEBHOOK_SECRET` | rastreador (nomes padrão; configuráveis por integração) |
| `TODOGREEN_TRACKER_RETENTION_DAYS` | retenção das posições do rastreador (padrão 90, piso 7) |

## Roteirização, mapas e recarga

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `GEOAPIFY_API_KEY` | geocodificação, roteamento cloud (leves e pesados) e elevação; também calcula o "Tempo e distância" do Roteirizador das Ferramentas (`/api/rotas/estimativa`). Plano grátis: 3.000 créditos/dia, uso comercial permitido com atribuição | a vertical usa Nominatim/OSRM/Valhalla conforme contingências configuradas (as instâncias públicas proíbem uso comercial/de rastreio — ver `docs/CATALOGO_RECURSOS_GRATUITOS.md`); o Roteirizador manda abrir no Maps |
| `TDG_ROUTING_URL` / `TDG_ROUTING_TOKEN` | otimizador VROOM auto-hospedado (`/routes/optimize`) e seu bearer | otimização responde `routing_not_configured` (503) |
| `TDG_OSRM_BASE_URL` / `TODOGREEN_OSRM_BASE_URL` | motor OSRM (perfil genérico) | OSRM não é oferecido na seleção de motor |
| `TDG_VALHALLA_BASE_URL` / `TODOGREEN_VALHALLA_BASE_URL` | motor Valhalla (truck costing, restrições, elevação) | pesado sem motor seguro: `NO_SAFE_ROUTING_ENGINE` (409) |
| `TODOGREEN_VROOM_BASE_URL` | VROOM pelo gateway de integrações | — |
| `TODOGREEN_NOMINATIM_BASE_URL` | geocodificação própria | Nominatim público |
| `TODOGREEN_DISPATCH_DETOUR_FACTOR` | fator de desvio do despacho (1–2) | 1,3 |
| `OPENCHARGEMAP_API_KEY` | carregadores públicos com potência/soquete detalhados | cai para o OSM |
| `MET_NORWAY_USER_AGENT` | identificação enviada à MET Norway (clima), que exige contato no User-Agent | `AllGreen/1.0 (+URL do app)` |
| `TDG_WEATHER_DISABLED=1` | desliga a consulta de clima (MET Norway) do modelo de energia | — |

A seleção de motor (`routingEngineSelectionDomain`) usa a presença dessas URLs
para saber quais motores estão disponíveis — sem forjar disponibilidade.

## Referências públicas (energia, mercado, risco) e pré-flight

Endereços e desligadores das ingestões de dados abertos (ANEEL, ONS, ANP, PNCP,
Compras.gov, GDELT, ANTT/PRF) — todos opcionais, com padrão nos endereços
oficiais. Descrição completa na seção 14 do `docs/DEPLOYMENT_RUNBOOK.md`:
`TDG_ANEEL_BASE_URL`, `TDG_ANEEL_TARIFAS_RESOURCE_ID`, `TDG_ONS_CURVA_CARGA_URL`,
`TDG_ANP_DIESEL_URL`, `TDG_ENERGY_REFERENCE_DISABLED`, `TDG_PNCP_BASE_URL`,
`TDG_COMPRAS_GOV_BASE_URL`, `TDG_COMPRAS_GOV_MODALIDADES`, `TDG_GDELT_BASE_URL`,
`TDG_MARKET_SIGNALS_DISABLED`, `TDG_ANTT_BASE_URL`, `TDG_ANTT_ACIDENTES_PACKAGE`,
`TDG_ROAD_RISK_DISABLED`, `TDG_CRON_EXTERNAL_DISABLED` (kill switch único dos
crons que saem para a internet — ligado no ambiente de teste).

| Variável | Uso |
| --- | --- |
| `TDG_PREFLIGHT_GATE_DISABLED=1` | desliga o gate de pré-flight da coleção `rotas` (padrão: ligado) |
| `TDG_PREFLIGHT_TTL_HOURS` | validade do pré-flight que libera a rota (padrão 24 h) |
| `TDG_RISK_ACTION_THRESHOLD` | score de risco viário que vira item na Torre de Controle (padrão 60) |

## Só para teste

| Nome | Uso |
| --- | --- |
| `OUTBOX_TEST_DELIVERY=mock` | envio de e-mail/mensagem simulado nos testes de worker — nunca em produção |
| `TEST_MIGRATIONS` | binding do `vitest.worker.config.js` com as migrações do D1 de teste |

## Como cadastrar

```bash
npx wrangler secret put NOME_DO_SEGREDO   # cola o valor quando pedir
npx wrangler secret list                  # confere o que está no cofre
```

Segredos são lidos em tempo de execução: não exigem novo deploy.
