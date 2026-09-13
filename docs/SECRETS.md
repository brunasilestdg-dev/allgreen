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
`OPENROUTER_API_KEY`, `GITHUB_MODELS_TOKEN`, `HF_TOKEN` — cada um liga um
provedor gratuito na cascata quando cadastrado.

### Notificações push (pendente da titular)

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e (opcional) `VAPID_SUBJECT`. Sem eles,
`pushEnabled(env)` é `false` e o app funciona normalmente, sem notificações do
navegador. Ver `handleAuth`/`vapidHeaders` em `worker.js` para o formato.

### Busca web (todas com cota gratuita; cascata, nunca paralelo)

`SEARXNG_BASE_URL` (instância própria, sem cota), `SERPER_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `JINA_API_KEY`,
`FIRECRAWL_API_KEY`, `SEARCH1_API_KEY`, `YOU_API_KEY`, `SERPAPI_API_KEY`,
`GOOGLE_SEARCH_API_KEY` + `SEARCH_ENGINE_ID`. `SEM_BUSCA_GRATUITA=1` desliga a
reserva gratuita. Ver `AGENTS.md` para a ordem da cascata.

## Roteirização auto‑hospedada (opcionais — seção 35)

| Variável | Uso | Sem ela |
| --- | --- | --- |
| `TDG_ROUTING_URL` | endpoint do otimizador VROOM (`/routes/optimize`) | otimização responde `routing_not_configured` (503) |
| `TDG_ROUTING_TOKEN` | bearer do VROOM auto‑hospedado | chamada sem autenticação |
| `TDG_OSRM_BASE_URL` | motor OSRM (perfil genérico) | OSRM não é oferecido na seleção de motor |
| `TDG_VALHALLA_BASE_URL` | motor Valhalla (truck costing / restrições) | Valhalla não é oferecido; pesado sem motor seguro |

A seleção de motor (`routingEngineSelectionDomain`) usa a presença dessas URLs
para saber quais motores estão disponíveis — sem forjar disponibilidade.

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
