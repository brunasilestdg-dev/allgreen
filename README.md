# All Green

**Comercial, operação, financeiro, gestão e ESG no mesmo fluxo.**

All Green é uma plataforma de gestão empresarial em português do Brasil, publicada em https://orianone.app — uma equipe digital que acompanha o negócio do primeiro cliente até a expansão:

- **Time de especialistas com IA**: Estratégia, Comercial, Operações, Financeiro, Jurídico, Marketing, RH, Projetos, Dados, Logística, Compras, Compliance, Segurança da Informação e ESG, cada um com instruções próprias.
- **Direção de Inteligência**: entende o pedido, aciona as áreas certas, quebra demandas complexas em etapas e consolida um plano único — sem exigir que o usuário saiba qual área chamar.
- **Módulos sob medida**: crie novos especialistas por setor, profissão, projeto ou problema direto no fluxo, sem reconstruir a aplicação.
- **Adaptação por segmento**: as respostas se ajustam a setor, porte, estágio e objetivo do negócio cadastrado.
- **Operação completa**: painel de tarefas, CRM de leads, controle financeiro, documentos versionados, criador de sites com captação de contatos, estúdio de imagens com IA e trilhas de certificação.
- **Aplicativo instalável (PWA)**: funciona como site e como app no celular e no computador.
- **Sincronização multi-dispositivo**: os projetos acompanham a conta — entre de qualquer aparelho e continue de onde parou.
- **Central Hoje**: prioriza tarefas, clientes, agenda e meta da semana em uma única próxima ação.
- **Importação aberta**: contatos por CSV, financeiro por CSV/OFX e documentos em formatos comuns.
- **Ações confirmáveis da IA**: respostas viram tarefa, documento ou projeto sem executar alterações silenciosas.

O núcleo combina as cotas gratuitas de Google, Cloudflare, Groq, Cerebras, Mistral, OpenRouter, GitHub Models e Hugging Face. O provedor pago (xAI) fica fora da cascata automática e só é acionado após confirmação explícita. Se todas as rotas gratuitas falharem, o app entrega um plano de contingência local sem inventar informações.

## Estrutura

| Caminho           | O que é                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `src/`            | Interface do aplicativo (React + Vite); cada área em `src/features/<área>/`                      |
| `worker-entry.js` | Entrada do Worker publicado (`wrangler.jsonc → main`): API do TMS e rotas da To Do Green         |
| `worker.js`       | Composição do app geral (roteador e tarefas agendadas), para onde a entrada delega o resto       |
| `worker/`         | Tabela de rotas (`worker/http/`), serviços por domínio (`worker/services/`), auth e mensageria   |
| `migrations/`     | Banco de dados (Cloudflare D1), migrações numeradas e incrementais                               |
| `public/`         | Arquivos estáticos (ícones, manifest, service worker)                                            |
| `test/`, `e2e/`   | Testes de worker (D1 local) e de ponta a ponta (Playwright)                                      |
| `docs/`           | Runbooks de deploy e operação, segredos (`docs/SECRETS.md`) e matriz de prontidão do ERP         |
| `video-ai/`       | Servidor próprio e opcional de geração de vídeo (GPU, Docker)                                    |

## Rodar no seu computador

```bash
npm ci         # instala as dependências travadas no lockfile
npm run dev    # abre a interface em modo desenvolvimento
npm test       # roda os testes
npm run verify # roda lint e todos os testes
```

## Publicar na Cloudflare

1. Crie uma conta em [dash.cloudflare.com](https://dash.cloudflare.com).
2. No terminal, dentro da pasta do projeto:
   ```bash
   npx wrangler login                        # conecta sua conta
   npx wrangler d1 create allgreen-db        # cria o banco de contas
   ```
   Copie o `database_id` que aparecer e cole no campo `database_id` do arquivo `wrangler.jsonc`.
3. Crie as tabelas e cadastre a chave de IA (gratuita em [aistudio.google.com/apikey](https://aistudio.google.com/apikey)):
   ```bash
   npm run db:migrate
   npx wrangler secret put GEMINI_API_KEY
   ```
4. Publique (o comando aplica as migrações antes do Worker):
   ```bash
   npm run deploy
   ```
   O Worker `allgreen` responde nos domínios `orianone.app` e `www.orianone.app` configurados em `wrangler.jsonc`.

### Chaves opcionais

| Segredo                           | Para quê                                           |
| --------------------------------- | -------------------------------------------------- |
| `GEMINI_API_KEY`                  | Gemini e Gemma                                     |
| `GROQ_API_KEY`                    | Groq Free                                          |
| `SAMBANOVA_API_KEY`               | SambaNova Free                                     |
| `CEREBRAS_API_KEY`                | Cerebras Free                                      |
| `MISTRAL_API_KEY`                 | Mistral Free                                       |
| `OPENROUTER_API_KEY`              | Roteador gratuito do OpenRouter                    |
| `GITHUB_MODELS_TOKEN`             | GitHub Models, token limitado ao escopo de modelos |
| `HF_TOKEN`                        | Hugging Face, crédito gratuito muito limitado      |
| `XAI_API_KEY`                     | Uso pago opcional e sempre confirmado pelo usuário |
| `VIDEO_AI_URL` + `VIDEO_AI_TOKEN` | Servidor próprio de vídeo (`video-ai/`)            |
| `SUPPORT_EMAIL`                   | Canal de suporte mostrado no aplicativo            |

Cadastre cada segredo com `npx wrangler secret put NOME_DO_SEGREDO`. A rede de provedores é uma decisão interna do backend: nomes, chaves, custos e estado da infraestrutura não são exibidos ao usuário final.

Sem as opcionais o app continua funcionando: o chat usa a cascata disponível, imagens e logos usam o FLUX na cota gratuita do Cloudflare, e o gerador de vídeo indica a alternativa gratuita no Hugging Face.

## Segurança

- Senhas protegidas com PBKDF2 (100.000 iterações) e sal individual; a sessão vale 24 horas (prazo absoluto) e, na To Do Green, termina após 30 minutos sem uso.
- As rotas de IA exigem login, evitando que estranhos consumam a cota gratuita.
- Limite de requisições por IP contra abuso.
- Sites públicos recebem HTML higienizado e uma política CSP; os leads ficam vinculados ao dono do site.

## Operação e piloto

- [Plano de piloto institucional](docs/PILOTO_INSTITUCIONAL.md)
- [Operação de produção](docs/OPERACAO_PRODUCAO.md)
- [Resposta a incidentes e LGPD](docs/RESPOSTA_A_INCIDENTES_E_LGPD.md)
- [Política de segurança](SECURITY.md)
