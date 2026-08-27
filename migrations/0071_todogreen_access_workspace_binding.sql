-- 0071_todogreen_access_workspace_binding.sql
--
-- O painel Acessos administrava METADE do modelo de acesso, e isso produzia
-- dois defeitos opostos — ambos silenciosos, ambos invisíveis pelo app.
--
-- `resolveTodoGreenAccess` aceita duas fontes de vínculo: a liberação por
-- e-mail (`todogreen_access_emails`, escrita pelo painel) e a associação ao
-- espaço de trabalho (`tenant_users`, que nenhuma tela mostrava). A tela só
-- escrevia na primeira.
--
-- 1) CONCEDER NÃO LIGAVA À EMPRESA. Sem linha em `tenant_users`, o espaço
--    padrão caía no `user.id` da própria pessoa. Um financeiro recém-liberado
--    recebia a lista inteira de permissões e abria um ERP vazio — sem cliente,
--    sem tesouraria, sem Central de Trabalho. Só vendedor (que o JOIN da
--    carteira alcançava) e motorista (que o cadastro da 0070 alcançava)
--    escapavam, cada um por um remendo diferente.
--
-- 2) REVOGAR NÃO REVOGAVA. Quem já tinha `tenant_users` continuava entrando
--    depois de "acesso removido": a tela confirmava, a auditoria gravava
--    `revoked`, e a pessoa seguia lendo o financeiro da empresa.
--
-- Esta coluna fecha o elo que faltava: a concessão passa a registrar EM QUAL
-- espaço a pessoa trabalha. É por ela que o vínculo nasce no primeiro acesso
-- de quem foi liberado antes de ter conta — o caminho normal, já que ninguém
-- guarda senha no código desde a 0029.

ALTER TABLE todogreen_access_emails
  ADD COLUMN workspace_owner_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_todogreen_access_emails_espaco
  ON todogreen_access_emails (tenant_id, workspace_owner_id)
  WHERE workspace_owner_id <> '';

-- Preenche o histórico: as liberações que já existem passam a apontar para o
-- espaço de quem as concedeu. Sem isto, todo acesso anterior a esta migração
-- continuaria caindo no espaço próprio e vazio.
UPDATE todogreen_access_emails
   SET workspace_owner_id = COALESCE((
         SELECT t.workspace_owner_id
           FROM tenant_users t
          WHERE t.tenant_id = todogreen_access_emails.tenant_id
            AND t.user_id = todogreen_access_emails.created_by
            AND t.status = 'active'
          LIMIT 1
       ), '')
 WHERE workspace_owner_id = '';
