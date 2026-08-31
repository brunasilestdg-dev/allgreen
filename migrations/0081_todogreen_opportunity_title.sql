-- ===== O negócio ganha nome próprio =====
--
-- Até aqui a oportunidade só tinha CLIENTE. Na tela, o cartão e o cartão do
-- kanban mostravam o nome da conta como se fosse o nome do negócio — e uma
-- conta com três frentes abertas (Middle Mile, Same Day, retomada) virava três
-- cartões idênticos, indistinguíveis. A importação do quadro de Novos Negócios
-- deixou isso evidente: 67 projetos entraram com nome próprio guardado em
-- `fields_json.nomeDoProjeto` e nenhum deles aparecia.
--
-- O nome vira COLUNA porque é o que se lê, se ordena e se busca. Continua
-- opcional: negócio sem nome cai no rótulo derivado (cliente · estágio), nunca
-- em "sem título".

ALTER TABLE todogreen_opportunities ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- Backfill: quem já tem nome de projeto guardado no payload passa a exibi-lo.
-- Não inventa nome para quem nunca teve — linha sem `nomeDoProjeto` fica vazia
-- e a tela deriva o rótulo.
UPDATE todogreen_opportunities
   SET title = TRIM(COALESCE(json_extract(fields_json, '$.nomeDoProjeto'), ''))
 WHERE title = ''
   AND TRIM(COALESCE(json_extract(fields_json, '$.nomeDoProjeto'), '')) <> '';

CREATE INDEX IF NOT EXISTS idx_todogreen_opp_titulo
  ON todogreen_opportunities (workspace_owner_id, archived_at, title);
