# Catálogo de recursos gratuitos e auditoria do que já existe

Levantamento de **24/09/2026**. Pesquisa em GitHub, Hugging Face, npm e nas
páginas oficiais de cada serviço, filtrada contra o que o All Green já tem.
Cada afirmação traz a fonte; o que não deu para confirmar está marcado como
"não verificado". Regra que manda em tudo: **gratuidade** (AGENTS.md, regra 1)
— e o produto é **comercial**, então "grátis só para uso não comercial" não
serve.

Legenda de esforço: **P** = horas · **M** = dias · **G** = semanas.

---

## 1. Resumo

- **O código está ligado.** De 630 arquivos de produção, 623 são carregados
  pelo app; das 162 rotas `/api` que a tela chama, só uma não existia (já
  corrigida). Lint sem erros; suítes de teste verdes.
- **O que não estava funcionando ou estava fora das regras foi corrigido** nesta
  entrega (seção 2.3): cron em dobro, convite legado quebrado, roteirizador
  usando serviços que proíbem uso comercial, clima com licença não comercial,
  GitHub Models aposentado na cascata, dado sensível indo para IA que treina com
  ele, CNPJ alfanumérico recusado, OCR e XLSX instalados mas não aplicados no
  leitor de arquivos, Pix sem QR Code, DACTE sem código de barras.
- **Três coisas só a titular destrava** (seção 2.4): remetente de e-mail
  (`MAIL_SENDER`) — em produção o e-mail transacional parece desligado —,
  chaves VAPID do push (script pronto) e a chave gratuita do Geoapify.
- **Vários "limites pagos" do AGENTS.md caíram** (seção 3): colaboração em tempo
  real, busca semântica e OCR por visão já cabem no plano grátis da Cloudflare.

---

## 2. Auditoria: o que existe hoje está aplicado e em uso?

### 2.1 Código ligado (análise estática)

Alcance calculado a partir dos pontos de entrada reais (`src/main.jsx`,
`worker-entry.js`, `public/sw.js`, extensão), seguindo imports estáticos,
dinâmicos, `React.lazy` e `@import` de CSS.

| Item | Resultado |
| --- | --- |
| Arquivos de produção carregados | **623 de 630** |
| Só testados, fora do app | `logistics/roadRestrictionDomain.js` (restrição OSM × veículo: `chooseCompatibleRoute` não é chamado — falta a malha OSM, ver `system-health`), `verticals/ModuleBadge.jsx` + CSS (substituído a pedido da titular) |
| Nunca carregado | `logistics/AllGreenDesignSystemFinal.css` — o cabeçalho diz "carregada por último e deve ser a referência", mas nenhum arquivo a importa desde que entrou no repositório |
| Rotas `/api` chamadas pela tela | 162 prefixos; só `/api/collab/join` não existia (corrigido) |
| Dependências npm | todas usadas em produção; `@zxing/library` é par obrigatório do `@zxing/browser`; `vite` e `@vitejs/plugin-react` estão em `dependencies` mas só servem ao build (higiene, sem efeito) |
| Variáveis de ambiente | o Worker lê **98**; ~55 não estavam em `docs/SECRETS.md` (agora documentadas) |

### 2.2 Estado em produção (endpoints públicos, 24/09/2026)

`GET /api/status` e `GET /api/config` de https://orianone.app:

| Recurso | Estado | Efeito |
| --- | --- | --- |
| Web Push | `vapidPublicKey: null` → **desligado** | resumo semanal, avisos de automação e de pendências não chegam com o app fechado |
| E-mail transacional | `supportEmail: ""` → pelo código, `SUPPORT_EMAIL` **e** `MAIL_SENDER` vazios → `emailEnabled` falso | "Esqueci minha senha" responde 503; convite sai sem e-mail (há a senha provisória); cadastro não pede código |
| Vídeo | `videoEnabled: false` | servidor opcional `video-ai/` não configurado (esperado) |
| Busca web | `configured: true`, Brave sem chave | funciona pela reserva gratuita (DuckDuckGo/Wikidata/Wikipédia) |

O que não dá para ver sem login (chaves de IA extras, Geoapify, cofre
`WORKSPACE_AI_VAULT_KEY`) aparece em **Administração → Saúde do sistema**.

### 2.3 Corrigido nesta entrega

| Problema encontrado | Correção | Onde |
| --- | --- | --- |
| Job do rastreador rodava **2× por disparo** do cron, sem trava | chamado só no `scheduled` do app | `worker-entry.js`, `worker.js` |
| Às segundas 12h UTC os dois crons disparam e **todos os jobs horários rodavam em dobro** (PNCP, ANEEL, automações…) | o cron semanal só envia o resumo | `worker.js` (`WEEKLY_SUMMARY_CRON`) + teste |
| Link `?convite=` chamava `/api/collab/join`, rota inexistente (404) | redireciona para `/convite/:token` | `src/App.jsx` |
| Roteirizador fazia **autocompletar no Nominatim público** do navegador — a política diz "you must not implement such a service on the client side" | sugestões pelo **Photon** (feito para busca enquanto se digita) + atribuição OSM | `src/App.jsx`, `photonSuggestionLabels` em `src/domain.js` |
| "Tempo e distância" usava o **OSRM de demonstração** — "reasonable, non-commercial use-cases" | novo `/api/rotas/estimativa` no Worker, só com **Geoapify** (plano grátis permite uso comercial); sem chave, manda abrir no Maps | `worker/services/route-estimate.js` + teste |
| Clima do modelo de energia no **Open-Meteo**, cuja API grátis é **só para uso não comercial** | **MET Norway** (CC BY 4.0, uso comercial com atribuição, User-Agent com contato, 4 casas decimais) | `geo-providers.js`, `horarioDaMetNorway`, gateway, saúde do sistema |
| **GitHub Models** na cascata — aposentado em 30/07/2026 ("inference API… no longer available") | removido; cada pedido esperava uma falha certa | `worker/services/ai.js` |
| Gemini gratuito lidera a cascata e **usa o conteúdo para treino, com revisão humana** ("Do not submit sensitive, confidential, or personal information to the Unpaid Services") | **rota sensível**: CPF, cartão, senha/chave, conta bancária ou termo clínico → só IA local, Cerebras, Groq, Workers AI, SambaNova e chaves pagas do espaço | `pedidoSensivel`/`SENSITIVE_ORDER` em `ai.js` + testes |
| IA local (Ollama/vLLM) cadastrada no catálogo, mas **fora da cascata** | entra na cascata e lidera a rota sensível (dado não sai do servidor da empresa) | `ai.js`, `configuredAiProviders` |
| **CNPJ alfanumérico** (emitido desde 31/07/2026) mutilado: validação só numérica em 8 lugares | regra única `normalizeDocument`/`isValidCnpj` com o algoritmo oficial (ASCII − 48); Jurídico aceita letras; XML fiscal preserva; chave de acesso não é montada errada | `erpCoreDomain.js` e consumidores + testes com os exemplos oficiais da Receita |
| `tesseract.js` instalado, mas o **leitor comum recusava imagem e PDF escaneado** ("precisam de OCR") | OCR no aparelho para foto e PDF escaneado (até 10 páginas); **XLSX** pelo `read-excel-file` | `components/leituraDeArquivo.js` (chat, Análise, Compras, Documentos, anexos) |
| `qrcode` instalado, mas a **Cobrança Pix não mostrava QR** | QR do "copia e cola" com download | `components/QrCodeImage.jsx` |
| DACTE em PDF **sem o código de barras** da chave de acesso | CODE-128C gerado por função pura, validado lendo com o `@zxing` | `logistics/code128Domain.js`, `FiscalPage.jsx` |
| Transcrição com o `whisper` antigo (sem idioma) e laço byte a byte que pesa nos 10 ms de CPU do plano Free | `whisper-large-v3-turbo` com base64 direto, `language: "pt"`, VAD e nomes da reunião como dica | `worker.js`, `Meetings.jsx` |
| Tela do Whiteboard dizia a quem usa que escrita à mão e edição simultânea "exigem serviço pago" | texto honesto: ainda não incluído | `QuickWhiteboard.jsx` |
| Push sem caminho claro para ligar | `node scripts/gerar-chaves-vapid.mjs` gera o par no formato exato da lib (teste prova) | `scripts/` |

### 2.4 Pendências que só a titular destrava

| O quê | Por quê | Como |
| --- | --- | --- |
| `MAIL_SENDER` (remetente validado no Brevo) | e-mail transacional parece desligado em produção | `npx wrangler secret put MAIL_SENDER` e validar o remetente/domínio no Brevo |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | push desligado | `node scripts/gerar-chaves-vapid.mjs` → `wrangler secret put` |
| `GEOAPIFY_API_KEY` (grátis, 3.000 créditos/dia, uso comercial ok) | tira a vertical dos serviços públicos que proíbem uso comercial/de rastreio e liga o "Tempo e distância" | criar conta em geoapify.com e cadastrar a chave |
| Groq: ligar *Zero Data Retention*; Mistral: desligar "Anonymous improvement data" | privacidade dos provedores que já recebem pedidos | nos consoles de cada provedor |
| Decidir `AllGreenDesignSystemFinal.css` | nunca foi carregado; ligar muda o visual da vertical inteira | revisão visual antes de importar — ou apagar |
| Limites de D1 no plano Free (desde 01/09/2026: 5 M linhas lidas e 100 mil escritas por dia) | acima disso as consultas são recusadas | acompanhar em Saúde do sistema |

---

## 3. Limites declarados como "pagos" que mudaram

| Limite no AGENTS.md | Situação em set/2026 | Recurso grátis | Fonte |
| --- | --- | --- | --- |
| Edição simultânea/cursores exigiriam Durable Objects pagos | **DO no plano Free** desde abr/2025 (SQLite): 100 mil req/dia, 13.000 GB-s/dia, 5 GB | Yjs (MIT) + `y-partyserver` (ISC, Cloudflare) | developers.cloudflare.com/durable-objects/platform/pricing |
| Embeddings + banco vetorial seriam pagos | **Vectorize no Free**: 5 M dimensões armazenadas, 30 M consultadas/mês (≈4.880 vetores de 1024 dim.); `bge-m3` a 1.075 neurons/M tokens | Vectorize + `@cf/baai/bge-m3`, ou embeddings no navegador | developers.cloudflare.com/vectorize/platform/pricing |
| OCR de escrita à mão exigiria OCR pago | modelos de **visão no Workers AI** (10 mil neurons/dia grátis): `gemma-4-26b-a4b-it`, `llama-4-scout`, `mistral-small-3.1` | testar qualidade em pt-BR antes; nada maduro roda no aparelho | developers.cloudflare.com/workers-ai/platform/pricing |
| Voz/vídeo em tempo real exigiria infra paga | **SFU/TURN: 1.000 GB/mês grátis** (RealtimeKit é pago) | WebRTC + sinalização num DO | developers.cloudflare.com/realtime/sfu/platform/pricing |
| TTS dependeria de conta externa | TTS no Workers AI existe, mas **sem pt-BR** documentado; no aparelho há opções com ressalva de licença (4.3) | manter `speechSynthesis` | — |

Observação: as cotas grátis da Cloudflare são **da conta**, divididas entre
todos os clientes do SaaS, e o Worker no plano Free tem **10 ms de CPU** por
requisição.

---

## 4. Catálogo por área

### 4.1 Plataforma Cloudflare (plano Free)

| Recurso | O que dá | Limites grátis | Encaixe | Esf. |
| --- | --- | --- | --- | --- |
| **Turnstile** | anti-robô sem captcha chato | ilimitado, 20 widgets | formulários públicos (`/api/public-forms`, sites, agendamento, atendimento), cadastro | P |
| **AI Gateway** | cache, limite de taxa, 5 retentativas, painel por provedor | 100 mil logs no total | frente da cascata; `cf-aig-collect-log-payload: false` para não guardar prompt; `byok_only` evita cobrança | P |
| **Workers AI — embeddings/reranker** | `bge-m3`, `qwen3-embedding-0.6b`, `bge-reranker-base` | 10 mil neurons/dia | busca híbrida com o BM25 existente | M |
| **Vectorize** | banco vetorial | ver seção 3 | um namespace por espaço | M |
| **AI Search** (antigo AutoRAG) | RAG pronto | grátis no beta: 20 mil consultas/mês | base de conhecimento sem montar vetor | M |
| **Workers AI — visão** | ler foto/manuscrito/comprovante | cota de neurons | OCR manuscrito, comprovante de despesa, CNH (sem sair da Cloudflare, que não treina com o conteúdo) | M |
| **`env.AI.toMarkdown()`** | PDF/DOCX/XLSX/HTML → Markdown | grátis na maioria dos formatos (imagem gasta neurons) | anexos recebidos por e-mail no servidor | P |
| **Email Routing + Email Workers** | receber e-mail direto no Worker | grátis, sem limite de mensagens | alternativa ao webhook do Brevo, com `postal-mime` (MIT-0). **Enviar** e-mail pela Cloudflare é só no plano pago | P |
| **Durable Objects / Agents SDK** | estado ao vivo, WebSocket com hibernação | ver seção 3 | colaboração, presença, posição do motorista ao vivo | M/G |
| **Servidor MCP** (`createMcpHandler`) | expor tarefas/CRM/TMS para Claude e outros assistentes | roda num Worker comum; OAuth usa KV (1.000 escritas/dia) | integração "traga seu assistente" | G |
| **Queues / Workflows** | tarefas em etapas | Queues 10 mil op./dia; Workflows 3 mil etapas/dia | OCR/PDF pesados fora do limite de CPU | M |
| **Workers Logs / Analytics Engine** | observabilidade | 200 mil eventos/dia (3 dias) | ligar `observability` no `wrangler.jsonc` | P |

### 4.2 IA: provedores gratuitos e privacidade

Matriz do uso **gratuito** (base da rota sensível):

| Provedor | Treina com o conteúdo? | Veredito para dado sensível | Fonte |
| --- | --- | --- | --- |
| Gemini API (flash, flash-lite, Gemma) | **Sim**, com revisão humana; Brasil sem exceção | **Não usar** | ai.google.dev/gemini-api/terms |
| Cerebras | Não; não retém | Seguro | cerebras.ai/terms-of-service |
| Groq | Não; sem retenção por padrão, logs até 30 dias | Seguro (ligar ZDR) | console.groq.com/docs/your-data |
| Workers AI | Não | Seguro | developers.cloudflare.com/workers-ai/platform/data-usage |
| SambaNova | Não (contrato); retenção não documentada | Seguro com ressalva | sambanova.ai/cloud-end-user-license-agreement |
| OpenRouter (free) | depende do provedor final | só com `zdr: true` + `data_collection: "deny"` | openrouter.ai/docs/guides/privacy |
| Mistral (grátis) | **Sim, por padrão** (dá para desligar) | fora da rota sensível | help.mistral.ai |
| Hugging Face (roteador) | HF não; o provedor final decide | fora da rota sensível | huggingface.co/docs/inference-providers/security |
| GitHub Models | — | **aposentado em 30/07/2026** | docs.github.com/en/github-models |

Outros achados:

- **Proteção contra prompt injection:** `meta-llama/llama-prompt-guard-2-86m`
  no Groq (avaliado em português; janela de 512 tokens, fatiar e-mail/página) e
  `openai/gpt-oss-safeguard-20b` (política escrita por você). Encaixe: rodar
  antes de agente ler e-mail recebido ou página da web. Esf. M.
- **Qualidade em pt-BR:** o Open PT LLM Leaderboard (avaliação mais recente em
  01/09/2025) coloca a família **Qwen3** no topo em cada faixa de tamanho
  (Qwen3-8B 78,4; Qwen3-14B 79,9). Vale testar `qwen3-32b` onde a cascata já
  tem chave (disponibilidade por provedor: não verificado).
- **Provedores novos que não servem para produção grátis:** NVIDIA NIM (FAQ
  proíbe produção), Cohere trial (1.000 chamadas/mês), Alibaba (trial de 90
  dias). Z.ai tem GLM Flash a preço zero, mas termos de uso e de dados não
  verificados.
- A lista `cheahjs/free-llm-api-resources` do GitHub saiu do ar (404).

### 4.3 IA no aparelho (navegador)

Base: **Transformers.js 4.3** (Apache-2.0; WebGPU ligado no Safari 26). Modelos
são baixados uma vez e ficam em cache; no celular, mirar em ≤ ~300 MB.

| Recurso | Licença | Tamanho | Encaixe | Esf. |
| --- | --- | --- | --- | --- |
| `Xenova/multilingual-e5-small` (embeddings) | MIT | 118 MB | busca semântica local + triagem da Caixa por similaridade | M |
| `onnx-community/BiRefNet_lite-ONNX` (tirar fundo) | MIT | 115 MB | fotos de produto na Mídia/Catálogo | M |
| `@ricky0123/vad-web` + Silero (detectar voz) | ISC/MIT | ~2 MB | motorista mãos-livres; cortar silêncio antes de transcrever | P |
| `@paddleocr/paddleocr-js` + PP-OCRv6 | Apache-2.0 | ~31 MB, `lang: "pt"` | 2º motor de OCR quando o Tesseract falha (auto-hospedar os modelos) | M |
| `onnx-community/whisper-base` | Apache/MIT | ~77 MB | nota de voz offline no portal do motorista | M |
| Chrome **Translator API** | nativo | — | traduzir mensagem estrangeira na Caixa (só desktop) | P |
| WebLLM / wllama (Qwen3-0.6B…4B) | Apache/MIT | 0,5–3 GB | contingência offline só em desktop | G |

Não há reconhecimento de **manuscrito em português** maduro rodando no aparelho.

### 4.4 Hugging Face em pt-BR

- **BERTimbau** (`neuralmind/bert-base-portuguese-cased`, MIT): base para
  classificador/NER próprio. Esf. M/G.
- **Albertina-100M PT-BR** (MIT) e **Gervásio** (MIT, nota baixa).
- **GAIA 4B** (termos Gemma) e **Tucano2** (Apache-2.0): ganho pequeno e ninguém
  serve de graça.
- Sentimento com uso comercial ok: `lxyuan/distilbert-base-multilingual-cased-sentiments-student`
  (Apache-2.0). A cascata de LLM já resolve sem infraestrutura nova.

### 4.5 Módulos open-source (npm)

| Módulo | Licença | Estado | Encaixe | Esf. |
| --- | --- | --- | --- | --- |
| `write-excel-file` | MIT | 4.1.1 (jun/2026) | exportar .xlsx de verdade no Gerador de planilhas (hoje só CSV) | P |
| Orama (+ `@orama/stemmers`) | Apache-2.0 | 3.1.18 | busca tolerante a erro de digitação com radical português; MiniSearch (MIT) como plano B | M |
| `@simplewebauthn/server` + `/browser` | MIT | 14.0.2 | **passkeys** (digital/rosto) — roda no Worker na prática, sem suporte oficial; testar antes | M |
| Yjs + `y-partyserver` | MIT / ISC | 13.6.33 / 2.2.0 | colaboração em tempo real sobre DO | M/G |
| `postal-mime` | MIT-0 | 3.0.0 | ler e-mail recebido no Email Worker | P |
| `@axe-core/playwright` | MPL-2.0 | 4.13.0 | acessibilidade no E2E (há ~220 avisos jsx-a11y) | P |
| gitleaks (CLI) + osv-scanner | MIT / Apache-2.0 | 8.30 / 2.6 | barrar segredo commitado (regra 2) e dependência vulnerável no CI | P |

### 4.6 Brasil: fiscal, jurídico e compliance

| Recurso | Situação verificada | Encaixe | Esf. |
| --- | --- | --- | --- |
| **CNPJ alfanumérico** | IN RFB 2.229/2024; 1º emitido em 31/07/2026; código oficial da RFB; BrasilAPI já valida o DV | **feito** nesta entrega | — |
| **Unimake.DFe** (.NET) | MIT, NuGet ativo (18/09/2026); NF-e, CT-e, MDF-e, NFS-e | conector SEFAZ no mesmo stack do conector CIOT; validar IBS/CBS (NT 2025.001, obrigatória desde 05/01/2026) em homologação | G |
| ACBr | fontes LGPL; binários "PRO/DEMO" | alternativa ao Unimake | G |
| **NFS-e Padrão Nacional** | adesão obrigatória dos municípios desde 01/01/2026; Emissor e API nacionais | emissão de NFS-e da transportadora | M |
| **Portal da Transparência (CEIS/CNEP)** | chave grátis (login gov.br prata/ouro); 400–700 req/min | due diligence de cliente e fornecedor | M |
| **TCU — consulta consolidada de PJ** | sem chave; bloqueia IP de fora do Brasil; CNPJ só numérico | idem, via conector no Brasil | M |
| **DataJud (CNJ)** | chave pública, mas o termo proíbe uso **comercial** (cl. 3.3 e 3.8) | só após parecer jurídico | — |
| **Assinatura gov.br** | API só para órgão público | fluxo manual: assinar no gov.br e anexar; conferir em validar.iti.gov.br | P |

### 4.7 Logística, mapas, energia e ESG

| Recurso | Situação verificada | Encaixe | Esf. |
| --- | --- | --- | --- |
| **MET Norway** | uso comercial com atribuição | **feito** (clima) | — |
| **Photon** | autocompletar é o uso previsto; "please be fair" | **feito** (Roteirizador); instância própria para volume alto | — |
| **Geoapify Free** | 3.000 créditos/dia, uso comercial ok | **feito** (`/api/rotas/estimativa`); falta cadastrar a chave | P |
| **OpenFreeMap** + `@maplibre/maplibre-gl-leaflet` | tiles vetoriais sem chave, uso comercial ok; MapLibre BSD-3, plugin ISC | trocar `tile.openstreetmap.org` (a política avisa serviços pagos que o acesso "may be withdrawn at any point") mantendo o código Leaflet | M |
| **OpenRouteService** (`driving-hgv`) | plano Standard grátis com uso comercial nos limites; **mudou para `api.heigit.org`** (o domínio antigo saiu do ar em 24/08/2026) | rota de caminhão com altura/peso/eixo sem servidor próprio | M |
| **CitrineOS** | Apache-2.0, OCPP 1.6/2.0.1, API REST | central OCPP para os pontos de recarga ("preparado" hoje) | G |
| `mobilityhouse/ocpp` | MIT (biblioteca Python) | ponte fina carregador ↔ Worker | M |
| **Traccar** | Apache-2.0; envia posições/eventos por `forward.url` (json) | telemetria de frota entrando no TMS | M |
| **Fator do SIN (MCTI)** | planilha mensal oficial para inventários | eletricidade no ESG | P |
| **GLEC Framework v3.2** | PDF gratuito, alinhado à ISO 14083 | referência de metodologia (o ESG já cita GLEC) | — |
| **iLEAP** | especificação aberta (repositório MIT), compatível com PACT | exportar emissões por embarque para o embarcador | M |

### 4.8 Comunicação

- **WhatsApp Cloud API (oficial):** a partir de **01/10/2026** a Meta cobra
  mensagens de serviço acima de **1.000/mês por número** e para de entregar sem
  cartão. Manter o `wa.me`.
- **Evolution API / Baileys** (já há integração no código): protocolo não
  oficial; os Termos do WhatsApp proíbem automação não autorizada — risco de
  banimento do número. Não recomendado.

---

## 5. Não recomendados (licença, termos ou custo)

| Item | Motivo |
| --- | --- |
| API grátis do Open-Meteo, OSRM demo, Nominatim público para autocompletar/rastreio | termos proíbem este uso (substituídos nesta entrega no que é da tela) |
| `briaai/RMBG-1.4` / `RMBG-2.0` | não comercial |
| `@imgly/background-removal`, ISNet | AGPL-3.0 |
| Piper pt_BR (faber, cadu, jeff, edresson) e pacotes com eSpeak NG | vozes derivadas de corpus não comercial; eSpeak é GPL |
| `jina-embeddings-v3`, `tabularisai` sentiment, FastConformer pt da NVIDIA | CC BY-NC |
| `gitleaks-action` em organização | EULA com chave obrigatória (usar a CLI, que é MIT) |
| Documenso / DocuSeal | AGPL + servidor próprio; o app já tem assinatura simples |
| n8n para clientes | Sustainable Use License: só uso interno |
| NVIDIA NIM, Alibaba, Cohere trial | não servem para produção gratuita |
| DataJud no SaaS | termo proíbe uso comercial (depende de parecer) |

---

## 6. Próximos passos sugeridos (valor ÷ esforço)

1. **Titular:** `MAIL_SENDER`, chaves VAPID e `GEOAPIFY_API_KEY` (seção 2.4).
2. **P** — Turnstile nos formulários públicos e no cadastro.
3. **P** — `write-excel-file` no Gerador de planilhas; gitleaks + osv-scanner + axe no CI.
4. **P** — AI Gateway na frente da cascata (cache poupa cota; sem guardar prompt).
5. **M** — Prompt Guard 2 (Groq) antes de agentes lerem conteúdo externo.
6. **M** — Busca semântica híbrida: `bge-m3` + Vectorize (ou e5-small no aparelho) somada ao BM25.
7. **M** — OpenFreeMap + MapLibre no lugar dos tiles do OSM.
8. **M** — OCR de manuscrito no Whiteboard via visão do Workers AI (medir qualidade; "preferir null a chutar").
9. **M** — Passkeys com SimpleWebAuthn (bom para motorista no celular).
10. **M/G** — Colaboração em tempo real (Yjs + y-partyserver) em Documentos/Whiteboard.
11. **M/G** — Traccar no TMS; ponte OCPP (`mobilityhouse/ocpp`) ou CitrineOS.
12. **G** — Conector SEFAZ com Unimake.DFe (CT-e com IBS/CBS, MDF-e, NFS-e nacional).
13. **G** — Servidor MCP do All Green (tarefas, CRM, TMS).

---

## Fontes principais

- Cloudflare: developers.cloudflare.com (durable-objects, vectorize, workers-ai
  pricing e data-usage, ai-gateway, ai-search, turnstile, email-service,
  realtime, workers/platform/limits, changelog 2026-09-01 D1).
- Privacidade de IA: ai.google.dev/gemini-api/terms · docs.github.com/en/github-models ·
  console.groq.com/docs/your-data · cerebras.ai/terms-of-service ·
  openrouter.ai/docs/guides/privacy · help.mistral.ai ·
  huggingface.co/docs/inference-providers/security.
- Mapas e clima: operations.osmfoundation.org/policies/nominatim e /tiles ·
  github.com/Project-OSRM/osrm-backend/wiki/Demo-server · open-meteo.com/en/terms ·
  api.met.no/doc/TermsOfService · photon.komoot.io · geoapify.com/pricing ·
  openfreemap.org · ask.openrouteservice.org/t/7912.
- Brasil: gov.br/receitafederal (CNPJ alfanumérico e código oficial do DV) ·
  developers.facebook.com (preços do WhatsApp) · datajud-wiki.cnj.jus.br ·
  portaldatransparencia.gov.br/api-de-dados · github.com/Unimake/DFe ·
  gov.br/nfse.
- Energia e ESG: gov.br/mcti (fatores de emissão) · GLEC Framework v3.2 ·
  specs.ileap.global.
- IA no aparelho e modelos: huggingface.co (model cards citados) ·
  huggingface.co/blog/transformersjs-v4 · huggingface.co/spaces/eduagarcia/open_pt_llm_leaderboard.
