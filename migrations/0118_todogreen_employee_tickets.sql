-- Chamado do colaborador — o canal para o CLT (e o PJ) reportar divergência.
--
-- O colaborador CLT vê os próprios dados no portal, mas NÃO edita: banco/PIX,
-- salário e cadastro são responsabilidade do RH (dado sensível, LGPD). Quando ele
-- vê uma inconsistência, abre um CHAMADO em vez de corrigir — a equipe (RH/
-- financeiro) resolve. Registro próprio (não é o todogreen_client_requests, que é
-- do cliente): aqui o dono do chamado é o colaborador (employee_id), com o mesmo
-- espírito de SLA/transições, sem carregar o vocabulário do cliente.
--
-- Ciclo: aberto → em_andamento → resolvido (ou cancelado). A resposta da equipe
-- fica em `response` — o colaborador vê o que foi feito.

CREATE TABLE IF NOT EXISTS todogreen_employee_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  workspace_owner_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'outro'
    CHECK (categoria IN ('dados_cadastrais','banco_pix','pagamento','documento','ferias_ponto','outro')),
  assunto TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto','em_andamento','resolvido','cancelado')),
  response TEXT NOT NULL DEFAULT '',           -- resposta da equipe (o colaborador vê)
  resolved_by TEXT,
  resolved_at TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (workspace_owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_tickets_ws
  ON todogreen_employee_tickets (workspace_owner_id, archived_at, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_tickets_emp
  ON todogreen_employee_tickets (workspace_owner_id, employee_id, archived_at);
