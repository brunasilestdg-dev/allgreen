# Segredos e variáveis de ambiente

Lista centralizada (seção 42 do plano de produto). **Nenhum valor entra em
código, commit, log ou frontend.** Segredos vão no cofre do Worker
(`wrangler secret put NOME`); variáveis públicas ficam em `wrangler.jsonc →
vars`. O app sobe sem os opcionais — a integração fica `NOT_CONFIGURED` até a
chave existir (seção 32), nunca forjada como ativa (seção 14).

## Variáveis públicas (`wrangler.jsonc → vars`, não são segredo)

| Nome | Uso |
| --- | --- |
| `GEMINI_MODEL` | modelo Gemini padrão |
| `XAI_MODEL` | modelo xAI (Grok) — exige confirmação paga |
| `TODOGREEN_ADMIN_EMAILS` | e‑mails com acesso administrativo da vertical |

## Segredos já usados (cofre do Worker)

| Segredo | Necessário para | Sem ele |
| --- | --- | --- |
| `GEMINI_API_KEY` | IA (Gemini/Gemma) | cai para outros provedores/contingência |
| `XAI_API_KEY` | xAI (Grok), pago | Grok indisponível (fora da cascata automática) |
| `GOOGLE_CLIENT_ID` | login Google | só login e‑mail/senha |
| `GOOGLE_API_KEY` | serviços Google | recurso correspondente indisponível |
| `BREVO_API_KEY` | e‑mail (verificação, notificações) | sem envio de e‑mail |
| `MAIL_SENDER` / `MAIL_SENDER_NAME` | remetente dos e‑mails | idem |

### IA gratuita adicional (opcionais)

`GROQ_API_KEY`, `SAMBANOVA_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`,
`OPENROUTER_API_KEY`, `HF_TOKEN` — cada um liga um provedor gratuito na cascata
quando cadastrado. `GITHUB_MODELS_TOKEN` não é mais lido: o GitHub Models foi
aposentado em 30/07/2026 (docs.github.com/en/github-models) e saiu da cascata.

Modelo de cada provedor (opcional, sobrescreve o padrão do código):
`GROQ_MODEL`, `SAMBANOVA_MODEL`, `CEREBRAS_MODEL`, `MISTRAL_MODEL`, `HF_MODEL`,
`OPENAI_MODEL`, `ANTHROPIC_MODEL`.

**Rota sensível (LGPD)**: pedido com CPF, cartão, senha/chave, conta bancária ou
termo clínico vai só para quem não treina com o conteúdo (IA local, Cerebras,
Groq, Workers AI, SambaNova e chaves pagas do próprio espaço). A Gemini API
gratuita usa o conteúdo para melhorar produtos e pode ter revisão humana
(ai.google.dev/gemini-api/terms), por isso fica fora dessa rota. Para o Groq,
ligue o *Zero Data Retention* em Data Controls no console.

### AI Gateway da Cloudflare (opcional, grátis)

Painel com pedidos, tokens, erros e latência de cada provedor; cache e limite de
taxa configurados no próprio gateway (`worker/services/ai-gateway.js`).

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `AI_GATEWAY_ID` (var) | nome do gateway. `default` é criado sozinho no primeiro pedido do Workers AI; outro nome precisa ser criado antes em AI → AI Gateway | nada passa pelo gateway |
| `AI_GATEWAY_TOKEN` (segredo) | token com a permissão **AI Gateway Run**. Liga também Gemini, Groq, Cerebras, Mistral, OpenAI e Claude pelo gateway (o gateway autenticado recusa chamada por URL sem ele) | só o Workers AI passa pelo gateway |
| `CLOUDFLARE_ACCOUNT_ID` (var) | reserva para montar o endereço do gateway se o binding `AI` não souber | usa o binding |

- **Conteúdo nunca fica guardado:** Workers AI vai com `collectLog: false`, e
  as chamadas por URL levam `cf-aig-collect-log-payload: false`, que guarda só
  modelo, tokens, tempo e status. Pedido da rota sensível não gera log nem usa
  cache.
- **Nada é cobrado sem chave:** a chave do provedor segue em cada pedido e
  `cf-aig-no-wholesale: true` faz o gateway devolver 400 em vez de cobrar pelo
  Unified Billing. No painel, ligue também **Require provider credentials**
  (`byok_only`) e não compre créditos.
- **Cache e limite de taxa:** ficam desligados por padrão e se configuram no
  painel do gateway (Settings). Com cache ligado, pedir de novo a mesma pergunta
  devolve a mesma resposta.
- **Se o gateway falhar** (token errado, gateway inexistente), o provedor é
  chamado direto e o gateway fica de lado por 10 minutos.
- **Logs no plano grátis:** a conta que criar o primeiro gateway a partir de
  24/09/2026 segue as regras do Workers Logs: 200 mil eventos por dia, guardados
  por 3 dias. Contas que já tinham gateway antes dessa data têm 100 mil logs no
  total.
- O streaming do chat (`/api/ai/stream`) continua indo direto ao Gemini.

### Prompt Guard (opcional; usa a `GROQ_API_KEY`)

Conteúdo externo passa por duas camadas antes de a IA ler: resultado de busca
na web, pesquisa de empresa, pergunta no portal do cliente e dado de
ferramenta da Semente. As camadas estão em `worker/services/prompt-guard.js`:

1. **Heurística local:** sempre ligada, sem custo.
2. **Llama Prompt Guard 2 86M na Groq:** avaliado em português. Está em
   "Preview" na Groq e pode sair do ar sem aviso; se falhar, a heurística
   continua valendo. O plano grátis dá 30 pedidos/min e 14,4 mil/dia.

| Variável | Uso |
| --- | --- |
| `PROMPT_GUARD_MODEL` | troca o modelo (padrão `meta-llama/llama-prompt-guard-2-86m`) |
| `PROMPT_GUARD_LIMIAR` | nota a partir da qual o texto é barrado, entre 0 e 1 (padrão 0,8) |

### IA auto-hospedada (opcional)

| Variável | Uso |
| --- | --- |
| `TODOGREEN_OLLAMA_BASE_URL` + `TODOGREEN_OLLAMA_MODEL` | servidor Ollama (API compatível com a OpenAI em `/v1`); entra na cascata e lidera a rota sensível |
| `TODOGREEN_OLLAMA_API_KEY` | só se o Ollama estiver atrás de um proxy com autenticação |
| `TODOGREEN_VLLM_BASE_URL` + `TODOGREEN_VLLM_MODEL` + `TODOGREEN_VLLM_API_KEY` | servidor vLLM |

### Chaves trazidas pelo espaço (cofre cifrado)

`WORKSPACE_AI_VAULT_KEY` (mínimo 32 caracteres) cifra as chaves que cada espaço
cadastra em Integrações: IA ("traga sua chave"), busca web e conexões MCP. Sem
ele, essas três telas mostram "Cofre indisponível".

### Anti-robô: Cloudflare Turnstile (opcional, grátis)

Protege cadastro, login, "esqueci a senha", reenvio do código, pedido de acesso
à To Do Green e os formulários públicos: formulário `/f/`, contato do site,
checkout da loja, agenda e central de atendimento. O código está em
`worker/lib/turnstile.js`. Só liga com **as duas** chaves; com uma só, nada
muda.

| Variável | Uso |
| --- | --- |
| `TURNSTILE_SITE_KEY` (var, pública) | chave do widget, entregue à tela pelo `/api/config` |
| `TURNSTILE_SECRET_KEY` (segredo) | confere o token no siteverify |

Para criar: Cloudflare → Turnstile → Add widget, em modo **Managed**, com os
domínios `orianone.app` e `www.orianone.app`. O plano grátis não tem limite de
desafios e permite 20 widgets com 10 domínios cada. Para testar em
localhost/E2E, use as chaves de teste da Cloudflare: site
`1x00000000000000000000AA` e secret `1x0000000000000000000000000000000AA`, que
sempre passam. Se o siteverify ficar fora do ar, o pedido segue e o limite de
tentativas continua valendo. Token recusado sempre barra.

### Busca por significado (sem variável nova)

A Memória e busca soma a busca por significado à busca por palavra. O código
está em `worker/services/busca-semantica.js` e na migração `0145`.

- **Como funciona:** o `bge-m3` do Workers AI (binding `AI`) gera os vetores, e
  o D1 guarda um vetor int8 por texto e por pessoa, sem guardar o texto. A
  comparação roda no aparelho.
- **Por que não o Vectorize:** não roda localmente, o deploy falha sem o índice
  e o plano Free cabe uns 4.900 textos na conta inteira.
- **Teto:** 2.000 textos novos por pessoa por dia, para poupar os 10 mil
  neurons diários que a cascata de IA também usa.

### Notificações push (pendente da titular)

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e (opcional) `VAPID_SUBJECT`. Sem eles,
`pushEnabled(env)` é `false` e o app funciona normalmente, sem notificações do
navegador (em 24/09/2026 o `/api/config` de produção ainda devolvia
`vapidPublicKey: null`). Para gerar um par no formato certo:
`node scripts/gerar-chaves-vapid.mjs` e depois `npx wrangler secret put` de cada um.

### E-mail (envio e recebimento)

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `SUPPORT_EMAIL` | canal de suporte mostrado no app | usa `MAIL_SENDER` |
| `INBOUND_EMAIL_SECRET` | autentica o webhook de e-mail recebido (`/api/inbound/email`, Brevo Inbound Parsing) | e-mail recebido é recusado |
| `EMAIL_INBOUND_OWNER_ID` / `INBOUND_WEBHOOK_OWNER_ID` | dono do espaço que recebe o e-mail | — |

Em 24/09/2026 o `/api/config` de produção devolvia `supportEmail: ""`, o que só
acontece com `SUPPORT_EMAIL` e `MAIL_SENDER` vazios — e sem `MAIL_SENDER` o
`emailEnabled` é falso: "Esqueci minha senha" responde 503, convite sai sem
e-mail e o cadastro não pede código. Conferir no cofre.

### Mensageria (opcional — ver custos antes de ligar)

`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_API_VERSION`, `WHATSAPP_INBOUND_OWNER_ID` (API
oficial da Meta). A partir de 01/10/2026 a Meta cobra mensagens de serviço
acima de 1.000 por mês por número e para de entregar sem cartão cadastrado.
`EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` ligam a
Evolution API, que usa o protocolo não oficial do WhatsApp Web — os Termos do
WhatsApp proíbem automação não autorizada (risco de banimento do número).

### Outras integrações opcionais

| Variável | Uso |
| --- | --- |
| `OPENCHARGEMAP_API_KEY` | pontos de recarga públicos (Open Charge Map) |
| `MET_NORWAY_USER_AGENT` | identificação enviada à MET Norway (clima); padrão `AllGreen/1.0 (+URL do app)` |
| `TDG_WEATHER_DISABLED=1` | desliga a consulta de clima do modelo de energia |
| `TODOGREEN_NOMINATIM_BASE_URL`, `TODOGREEN_OSRM_BASE_URL`, `TODOGREEN_VROOM_BASE_URL` | instâncias próprias de geocodificação/rota/otimização |
| `MONDAY_CLIENT_ID` (var), `MONDAY_CLIENT_SECRET`, `MONDAY_SIGNING_SECRET`, `MONDAY_TOKEN_ENCRYPTION_KEY` | integração monday.com |
| `SYSPAG_API_TOKEN`, `SYSPAG_AUTH_HEADER`, `SYSPAG_AUTH_SCHEME` | repasse PIX (GreenPay/PJ) — dormente sem token |
| `TODOGREEN_CIOT_VAULT_KEY` | cifra credenciais do CIOT (cai em `SESSION_SECRET` se ausente) |
| `TODOGREEN_TRACKER_RETENTION_DAYS` | retenção das posições do rastreador (padrão 90, mínimo 7) |
| `PUBLIC_APP_URL` | URL pública usada em links e identificação junto a APIs |
| `OUTBOX_TEST_DELIVERY` | só para testes |

### Busca web (todas com cota gratuita; cascata, nunca paralelo)

`SEARXNG_BASE_URL` (instância própria, sem cota), `SERPER_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `JINA_API_KEY`,
`FIRECRAWL_API_KEY`, `SEARCH1_API_KEY`, `YOU_API_KEY`, `SERPAPI_API_KEY`,
`GOOGLE_SEARCH_API_KEY` + `SEARCH_ENGINE_ID`. `SEM_BUSCA_GRATUITA=1` desliga a
reserva gratuita. Ver `AGENTS.md` para a ordem da cascata.

## Roteirização auto‑hospedada (opcionais — seção 35)

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `GEOAPIFY_API_KEY` | geocodificação e roteamento cloud para leves e pesados; também calcula o "Tempo e distância" do Roteirizador das Ferramentas (`/api/rotas/estimativa`). Plano grátis: 3.000 créditos/dia, uso comercial permitido com atribuição | a vertical usa Nominatim/OSRM/Valhalla conforme contingências configuradas (as instâncias públicas proíbem uso comercial/de rastreio — ver `docs/CATALOGO_RECURSOS_GRATUITOS.md`); o Roteirizador manda abrir no Maps |
| `TDG_ROUTING_URL` | endpoint do otimizador VROOM (`/routes/optimize`) | otimização responde `routing_not_configured` (503) |
| `TDG_ROUTING_TOKEN` | bearer do VROOM auto‑hospedado | chamada sem autenticação |
| `TDG_OSRM_BASE_URL` | motor OSRM (perfil genérico) | OSRM não é oferecido na seleção de motor |
| `TDG_VALHALLA_BASE_URL` | motor Valhalla (truck costing / restrições) | Valhalla não é oferecido; pesado sem motor seguro |

A seleção de motor (`routingEngineSelectionDomain`) usa a presença dessas URLs
para saber quais motores estão disponíveis — sem forjar disponibilidade.

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
| `TODOGREEN_ANTT_CIOT_*` | Conector/cert do CIOT direto (ver doc CIOT) | CIOT depende do conector Windows/ANTT |

## Integrações de dados públicos (preparadas, ativam com credencial/infra)

Quando os conectores de ANEEL, ONS, ANP, PNCP, Compras.gov, GDELT, PRF e ANTT
forem ligados, seus segredos/URLs entram aqui, um por linha, seguindo o mesmo
padrão: lidos de `env`, com estado `NOT_CONFIGURED`/`FALLBACK` explícito
enquanto ausentes (seções 6–15, 32, 34).

## Como cadastrar

```bash
wrangler secret put NOME_DO_SEGREDO      # cola o valor quando pedir
wrangler secret list                     # confere o que está no cofre
```
