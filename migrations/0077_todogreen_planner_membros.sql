-- 0077_todogreen_planner_membros.sql
-- "O planner pode ser compartilhado com pessoas específicas" (titular, 30/08).
-- Um plano PRIVADO ganha uma lista de pessoas do espaço que também o veem e
-- trabalham nas tarefas dele; 'shared' segue sendo o espaço inteiro. O CHECK
-- de visibility não muda: private/shared continuam os únicos valores — a
-- lista só estende o alcance do privado (reconstruir a tabela para um
-- terceiro valor não paga o custo). Coluna própria, e não fields_json,
-- porque a lista é FILTRO de toda consulta do Planner (convenção da 0041:
-- coluna própria para o que é filtrado ou somado).
ALTER TABLE todogreen_planner_plans
  ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]';
