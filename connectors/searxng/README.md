# Busca sem cota: SearXNG do Seu Funcionário

O SearXNG é o único provedor da cascata de busca **sem cota**. Ele não tem
índice próprio: consulta Google, Bing, DuckDuckGo e outros por baixo e devolve
o resultado unificado. Quem cobra cota é a API, e aqui não existe API no meio.

Por isso ele é o **primeiro** da cascata em `worker/services/web-search.js` —
atende antes de gastar a chave paga (hoje, a Tavily), que passa a ser reserva.

O que ele destrava na To Do Green: pesquisa de empresa, monitoramento de conta,
notícias do cliente, sinais ESG e o `site:linkedin.com/in` da busca de contato.

## O preço, dito antes

- Precisa de **um servidor seu** rodando 24h. Uma VPS de 1 vCPU e 1 GB dá
  conta; qualquer provedor serve.
- Precisa de **um subdomínio** apontando para ele (ex.:
  `busca.suaempresa.com.br`).
- "Sem cota" tem asterisco: quem tem cota são os motores por baixo. Em volume
  muito alto e concentrado, o Google devolve captcha para o IP do servidor. No
  volume de uma equipe comercial isso não acontece.
- **Não use instância pública** (`searx.be` e afins): quase todas bloqueiam
  `format=json`, que é exatamente o que o app usa.

## Passo a passo

### 1. Um servidor com Docker

Qualquer VPS Linux. Instale o Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Um subdomínio apontando para ele

No seu DNS, um registro `A` de `busca.suaempresa.com.br` para o IP da VPS.
Espere resolver antes de seguir — o Caddy só emite o certificado depois.

### 3. Suba

```bash
git clone https://github.com/brunapsiles/Seufuncionario.git
cd Seufuncionario/connectors/searxng

cp .env.example .env
openssl rand -hex 32          # → cole em SEARXNG_SECRET
openssl rand -hex 32          # → cole em SEARXNG_TOKEN (guarde: vai para o cofre)
nano .env                     # preencha também SEARXNG_HOSTNAME

docker compose up -d
```

### 4. Confira antes de cadastrar

```bash
./verificar.sh https://busca.suaempresa.com.br SEU_TOKEN
```

Ele testa as quatro coisas que costumam falhar e diz o que corrigir em cada
uma. Só siga quando as quatro passarem.

### 5. Cadastre no cofre do Worker

```bash
npx wrangler secret put SEARXNG_BASE_URL     # https://busca.suaempresa.com.br
npx wrangler secret put SEARXNG_TOKEN        # o mesmo token do .env
```

Pronto. Nada mais muda no app: a cascata passa a começar pelo SearXNG.

## As duas armadilhas

Estão resolvidas no `settings.yml` deste diretório, mas vale saber por que
existem — se você editar o arquivo, não desfaça:

**`search.formats` precisa incluir `json`.** Vem só com `html` de fábrica. Sem
isso o SearXNG responde 200 com HTML, o app não acha `results`, e o sintoma
aparece como "a pesquisa não traz nada" — que manda depurar no lugar errado.
O `web-search.js` detecta esse caso e diz a frase certa.

**`server.limiter` precisa ser `false`.** É a proteção contra robô, e um Worker
chamando a API é exatamente o que ela foi feita para barrar. Com ele ligado,
403 em toda consulta. A proteção que ele daria fica no Caddy, por token.

## Por que existe token

Uma instância aberta com JSON habilitado é um proxy de busca gratuito para o
mundo inteiro. Ela é encontrada e abusada em dias, e o abuso termina com o IP
do servidor banido no Google — matando exatamente o "sem cota" que motivou
hospedá-la.

O SearXNG não tem autenticação própria. Quem a faz é o Caddy: `/search` só
responde a quem apresenta `x-searxng-token`; qualquer outro caminho é 404. O
Worker envia o cabeçalho quando `SEARXNG_TOKEN` existe no cofre.

Instância já existente sem token continua funcionando: sem a variável, o
cabeçalho não é enviado.

## Manutenção

```bash
docker compose logs -f searxng     # o que os motores responderam
docker compose logs -f caddy       # certificado e recusas de token
docker compose pull && docker compose up -d    # atualizar
```

Se a busca de contato começar a render pouco, olhe o log do `searxng`: o Google
pedindo captcha aparece ali, e é o sinal de que o volume passou do que aquele
IP aguenta. A cascata continua respondendo pelos outros motores enquanto isso.
