# Operação de produção

## Superfícies operacionais

- Saúde pública: `GET /api/status`.
- Erros do usuário autenticado: `GET /api/errors`.
- Indicadores agregados do espaço: `GET /api/events` para dono ou administrador.
- Diagnóstico do navegador: Configurações → Ajuda e continuidade.
- E-mail de suporte: segredo `SUPPORT_EMAIL`; quando ausente, utiliza o remetente
  transacional configurado.

## Objetivos de serviço para o piloto

- Disponibilidade mensal observada: 99,5% ou mais.
- Primeira resposta a incidente crítico: até 4 horas no período de suporte.
- Primeira resposta a chamado comum: até 1 dia útil.
- Nenhuma perda silenciosa de alteração: conflitos e falhas de sincronização
  devem permanecer visíveis e a cópia local deve ser preservada.

## Rotina semanal

1. Consultar saúde do Worker e banco.
2. Revisar erros novos e agrupar por versão e página.
3. Verificar funil de onboarding, IA e conclusão de ações.
4. Testar login, sincronização, chat, criação de tarefa e exportação.
5. Registrar incidentes e correções.
6. Conferir consumo e limites dos provedores gratuitos sem expor essa
   infraestrutura ao usuário final.

## Continuidade da IA

- Nenhum provedor gratuito individual é tratado como ilimitado.
- O roteamento usa somente provedores configurados e possui contingência local.
- Chaves ficam exclusivamente no cofre do Worker.
- O produto precisa medir taxa de sucesso e custo operacional por pessoa ativa.
- Ações sobre dados exigem confirmação; uma resposta de texto nunca executa
  automaticamente envio, pagamento, exclusão ou compartilhamento.

## Backup e recuperação

- Manter exportações periódicas do D1 conforme os recursos da conta Cloudflare.
- O usuário pode exportar o próprio workspace em JSON.
- Antes de migração remota, executar testes do Worker com D1 local e build.
- Migrações são somente incrementais; nunca editar uma migração aplicada.
- Exercitar restauração antes de ampliar o piloto.

## Publicação

O caminho normal é o merge na `main`: o Cloudflare Workers Builds roda
`npm ci && npm run verify && npm run build` e depois `npm run deploy:cloudflare`
(migrações + publicação). Antes do merge, e em qualquer publicação manual:

1. `npm run verify` (lint + testes de unidade + testes de worker) — `npm test`
   sozinho não roda o lint.
2. `npm run build`.
3. `npm run test:e2e:critical` (jornadas críticas no Chromium).
4. Revisar `git diff` e ausência de segredos.
5. `npm run deploy:cloudflare` — aplica as migrações remotas e publica o Worker,
   nessa ordem.
6. Validar `/api/system/version` (o `sha` publicado), `/api/status`, login e um
   fluxo autenticado real.
7. Registrar versão, horário e responsável (tabela da seção 13a do
   `docs/DEPLOYMENT_RUNBOOK.md`).
