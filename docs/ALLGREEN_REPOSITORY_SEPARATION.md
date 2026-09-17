# All Green Repository Separation Map

Status: `AG-SEP-01 MAPEAMENTO CONCLUÍDO`

Base analisada: `main` no commit `9fb33404b331a6de3c0e5f5216df8cf6bd7088ad`.

Este documento define a fronteira segura para separar a plataforma All Green do repositório `brunapsiles/Seufuncionario`. Este bloco é somente de mapeamento.

Nenhum código funcional foi movido. Nenhuma funcionalidade foi removida. Nenhuma rota, DNS, domínio, Worker, D1, segredo, cron, integração ou configuração de produção foi alterada por este bloco.

## 1. Regra de segurança da migração

A separação deve seguir a ordem `MAPEAR > COPIAR > VALIDAR > PUBLICAR EM PARALELO > HOMOLOGAR > CORTAR TRÁFEGO > ESTABILIZAR`.

O repositório `Seufuncionario` permanece intacto como origem conhecida e caminho de rollback até aprovação explícita da titular.

Não é permitido durante a migração:

1. Excluir, desabilitar ou esconder funcionalidade existente.
2. Remover módulos, telas, rotas, APIs, tabelas, colunas, permissões, dados, integrações, automações, jobs ou webhooks.
3. Fazer `DROP`, exclusão destrutiva ou migração irreversível de banco.
4. Substituir silenciosamente uma implementação antiga por outra incompatível.
5. Apontar o mesmo webhook produtivo para dois backends que possam processar o mesmo evento e gerar duplicidade.
6. Mover DNS antes de o novo ambiente passar pelos critérios de homologação.
7. Transformar esta separação em monorepo, microserviços ou pacote compartilhado antes de existir necessidade comprovada.

Código compartilhado pode ser duplicado temporariamente no novo repositório. Nesta etapa, compatibilidade e reversibilidade são mais importantes que eliminar duplicação.

## 2. Classificação usada

| Classe | Significado | Regra de migração |
| --- | --- | --- |
| `ALLGREEN` | Código cuja responsabilidade funcional pertence à plataforma All Green e suas verticais | Copiar para o novo repositório no AG-SEP-02; manter no repositório atual durante estabilização |
| `SEUFUNCIONARIO` | Código do produto Seu Funcionário sem dependência necessária para executar o All Green | Não copiar por padrão |
| `COMPARTILHADO` | Código atualmente usado por All Green e pelo produto original, ou bootstrap que ainda mistura os dois | Copiar somente o necessário e preservar compatibilidade; separar depois de validar o novo ambiente |
| `INFRAESTRUTURA` | Build, deploy, Worker, banco, migrations, testes e configuração de ambiente | Recriar de forma explícita e independente para All Green; nunca reutilizar binding produtivo por acidente |

## 3. Fronteira de frontend

### 3.1 ALLGREEN

A área abaixo é a principal fronteira funcional do All Green e deve ser tratada como uma unidade na primeira cópia:

`src/features/logistics/**`

Ela contém a vertical To Do Green, CRM, experiência comercial, operação, páginas de implantação, Portal do Cliente, Portal TMS, Portal do Motorista, Central de Frota, regras de domínio logístico e as camadas visuais específicas do All Green.

Também pertencem ao ecossistema All Green as verticais atualmente roteadas pelo shell principal:

`src/features/greenon/**`

`src/features/greenmob/**`

As rotas atualmente identificadas como superfícies All Green incluem:

| Superfície | Rota atual |
| --- | --- |
| ERP To Do Green | `/todogreen/**` |
| Convite To Do Green | `/todogreen/convite/**` |
| Implantação | `/todogreen/ativacao/**` |
| Portal TMS | `/portal-tms/**` |
| Portal do Cliente | `/portal-cliente/**` |
| Portal do Motorista | `/portal-motorista/**` e `/central-motorista/**` |
| Central de Frota | `/motorista-frota/**` e `/central-frota/**` |
| Portal do Colaborador | `/portal-colaborador/**` |
| Green On | `/greenon/**` |
| Greenmob | `/greenmob/**` |

A rota `/design-system/**` é de referência visual e deve ser tratada como compartilhada enquanto usar o design system global.

### 3.2 COMPARTILHADO

Os seguintes pontos não devem ser simplesmente removidos do repositório atual:

| Caminho | Motivo |
| --- | --- |
| `src/main.jsx` | Bootstrap único atual; importa App, captura erros e carrega as folhas visuais do All Green |
| `src/App.jsx` | Aplicação histórica grande que ainda concentra estado e dependências de mais de um produto |
| `src/routing/**` | O roteador principal decide entre workspace, To Do Green, TMS, cliente, motorista, Green On e Greenmob |
| `src/design-system/**` | Componentes visuais reutilizáveis como Button, Card, DataTable, Tabs e outros |
| `src/session/**` | Sessão, armazenamento, telemetria e saída por inatividade são infraestrutura de autenticação compartilhada |
| componentes/utilitários globais importados pelo All Green | Devem ser identificados pelo grafo de imports no AG-SEP-02 antes da cópia |

No AG-SEP-02, o novo repositório deve receber um bootstrap próprio do All Green. Não se deve copiar `App.jsx` inteiro por comodidade sem antes identificar o conjunto mínimo necessário para manter todas as jornadas existentes.

## 4. Fronteira de backend

### 4.1 ALLGREEN

Os serviços com prefixo `worker/services/todogreen-*.js` são candidatos diretos à propriedade All Green. Eles incluem, entre outros, acesso, core, CRM/registros verticais, pricing, portais, tracker, roteirização, integrações, saúde do sistema e notificações.

O backend All Green também possui dependências de domínio que podem estar fora desse prefixo. Elas devem ser copiadas somente quando um import real do serviço All Green exigir.

### 4.2 COMPARTILHADO

| Caminho | Situação atual |
| --- | --- |
| `worker.js` | Dispatcher principal atual; mistura handlers do produto original e handlers `todogreen-*` |
| `worker-entry.js` | Entrada Cloudflare atual; também executa agenda e serviços do All Green |
| `worker/auth/**` | Autenticação e sessão compartilhadas |
| `worker/lib/**` | HTTP, helpers e utilitários de infraestrutura compartilhados |
| serviços genéricos em `worker/services/**` | Copiar apenas quando houver dependência comprovada do All Green |

O novo repositório deve ter `worker-entry.js` e dispatcher próprios. A primeira versão pode reutilizar código compartilhado copiado, mas não deve depender em runtime do repositório Seu Funcionário.

## 5. Dados e D1

O Worker atual usa o binding `DB` ligado ao banco `seu-funcionario-db`.

O documento `docs/TODOGREEN_DATA_OWNERSHIP.md` já define fontes canônicas do All Green para clientes, contatos, contratos, ordens de serviço, operações, rotas, POD, financeiro, fiscal, telemetria e solicitações do cliente. Essa propriedade deve ser preservada durante a separação.

Migrations com tabelas, índices ou processos `todogreen_*` são candidatas ao novo ambiente, mas a classificação final deve ser feita em nível de tabela antes de criar um D1 independente.

AG-SEP-01 não autoriza copiar, apagar ou alterar dados.

Antes de qualquer split de D1, AG-SEP-02 ou um bloco posterior deve produzir uma matriz com estas colunas:

`objeto | tabela | dono | leitores | escritores | FK/dependências | estratégia de cópia | estratégia de rollback`.

A migração deve preservar IDs e histórico. Nenhuma tabela canônica pode ter dois escritores produtivos durante o corte.

## 6. Infraestrutura Cloudflare atual

A configuração atual está centralizada em `wrangler.jsonc` e usa:

| Recurso | Estado atual |
| --- | --- |
| Worker | `seufuncionario-expo` |
| Entrada | `worker-entry.js` |
| Assets | `./dist`, binding `ASSETS` |
| D1 | binding `DB`, banco `seu-funcionario-db` |
| Workers AI | binding `AI` |
| Cron | a cada hora e segunda-feira às 12:00 conforme `wrangler.jsonc` |
| Ambiente TDG | `TDG_ENVIRONMENT=production` |
| R2 | nenhum binding R2 declarado no `wrangler.jsonc` atual |

Esses recursos não devem ser reutilizados implicitamente pelo futuro deploy independente. O All Green deverá receber Worker, bindings, variáveis e segredos declarados de forma própria.

## 7. Build, testes e deploy

O `package.json` atual ainda representa um único produto e usa o nome `seu-funcionario`.

Ele já contém testes unitários, testes Worker, build Vite, Playwright para jornadas To Do Green, regressão visual e carga k6. Também contém scripts de Track3R.

Os principais artefatos de teste candidatos a acompanhar o All Green incluem:

`e2e/todogreen-*.spec.js`

`e2e/visual/**` quando cobrir telas All Green

`scripts/load/todogreen-smoke.k6.js`

`src/**/*todogreen*.test.*` e testes localizados dentro das verticais All Green

No novo repositório, scripts de build e teste devem ser reduzidos somente depois que for comprovado que não cobrem dependências necessárias. GitHub Actions não é requisito desta migração. O fluxo Cloudflare deve continuar independente de GitHub Actions.

O próprio documento de propriedade de dados estabelece que a migração efetiva ao repositório `allgreen` só deve começar após suíte e build verdes, teste transversal aprovado, conectores do piloto configurados, versão de produção identificada e ausência de caminhos inválidos de OS/operação.

## 8. Integrações

Track3R, Tracker, CIOT, fiscal, telemetria, OCPP e demais conectores devem ter um único ambiente autoritativo durante o cutover.

Regra para webhooks:

`provedor externo > endpoint autoritativo > persistência idempotente > processamento`.

Não configurar o mesmo evento para gravar simultaneamente no Worker antigo e no novo sem uma estratégia explícita de espelhamento somente leitura ou idempotência interambientes.

Segredos nunca devem ser copiados para o Git. O novo ambiente deve recriar os nomes necessários no cofre do Cloudflare e validar cada integração separadamente.

## 9. Domínio e autenticação

Domínio é configuração de infraestrutura, não regra de negócio.

O novo código não deve embutir `orianone.app`, OrianBridge ou qualquer domínio futuro em regras de negócio. URLs públicas, API, portais, origens permitidas e callbacks devem ser resolvidos por configuração de ambiente ou pela origem corrente quando seguro.

A topologia de autenticação precisa ser validada antes de separar SPA e API em hosts diferentes. A sessão atual já possui dependências de frontend e backend compartilhadas, portanto cookies, CORS, CSRF, redirects e compatibilidade Bearer devem ser tratados como uma migração própria, não como efeito colateral da troca de domínio.

Durante estabilização, o domínio e Worker anteriores devem continuar disponíveis como rollback controlado até aprovação explícita.

## 10. Arquitetura alvo

```text
repo allgreen
  frontend All Green
  design system necessário
  portais
  backend All Green
  migrations All Green
  testes All Green
        |
        v
Worker All Green independente
        |
        + D1 All Green
        + R2 All Green quando ativado
        + AI e demais bindings necessários
        + crons/filas declarados explicitamente
        |
        v
domínio configurável
```

O objetivo é que a futura troca de domínio ou reconstrução em outra conta Cloudflare exija configuração e migração de infraestrutura, não alteração da lógica do produto.

## 11. Plano de execução a partir deste mapa

### AG-SEP-02

Criar o repositório dedicado do All Green a partir de uma versão conhecida e estável.

Regras do bloco:

1. Copiar, não mover.
2. Não remover nada de `Seufuncionario`.
3. Preservar todas as rotas e funcionalidades All Green.
4. Criar bootstrap independente.
5. Incluir somente dependências compartilhadas comprovadamente necessárias.
6. Fazer instalação e build local/isolado do novo repositório.
7. Não mudar DNS.
8. Não criar escrita produtiva paralela.
9. Commitar e parar após o repositório independente compilar.

### Blocos posteriores

`AG-SEP-03`: Worker Cloudflare independente e configuração própria.

`AG-SEP-04`: classificação e estratégia de D1, sem corte destrutivo.

`AG-SEP-05`: homologação de autenticação, portais, integrações e jornadas críticas.

`AG-SEP-06`: domínio de homologação e validação ponta a ponta.

`AG-SEP-07`: cutover controlado com rollback documentado.

## 12. Critério de conclusão do AG-SEP-01

AG-SEP-01 está concluído quando este mapa estiver versionado no `main` e nenhuma mudança de runtime tiver sido feita.

O próximo bloco não deve começar automaticamente.