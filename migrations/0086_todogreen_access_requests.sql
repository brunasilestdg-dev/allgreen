-- 0086_todogreen_access_requests.sql
-- Solicitação de acesso à To Do Green pela tela de login.
--
-- Antes, quem chegava ao /todogreen sem conta só via um aviso pedindo para
-- procurar um administrador — por fora do app, por WhatsApp ou e-mail, sem
-- rastro. Agora a própria tela de login registra o pedido, e ele cai numa fila
-- de aprovação DENTRO do app, para um administrador liberar, recusar, com o
-- papel já escolhido na hora do aceite.
--
-- O pedido nasce SEM sessão (a pessoa ainda não tem conta), então não tem
-- workspace_owner_id de origem: é do tenant 'todogreen' e todos os
-- administradores o enxergam. O espaço só é gravado na DECISÃO, quando um
-- administrador aprova a partir do seu próprio espaço — é ali que o vínculo
-- nasce certo, como já acontece na liberação manual por e-mail.
--
-- Status é GRAVADO aqui (pending | approved | rejected), não derivado: é o
-- registro de uma decisão humana com autor e data, não um cálculo contra o
-- tempo. Uma vez decidido, fica decidido.

CREATE TABLE IF NOT EXISTS todogreen_access_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'todogreen',
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  -- pending | approved | rejected
  status TEXT NOT NULL DEFAULT 'pending',
  -- Preenchidos só na decisão. O espaço é o de quem aprova (nunca do corpo do
  -- pedido, que veio sem sessão), e o papel é o escolhido no aceite.
  decided_workspace_owner_id TEXT NOT NULL DEFAULT '',
  decided_role TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  decided_at TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
-- A fila é lida por status (os pendentes primeiro) e por data de chegada.
CREATE INDEX IF NOT EXISTS idx_todogreen_access_requests_fila
  ON todogreen_access_requests (tenant_id, status, created_at DESC);
-- Um e-mail que já pediu e ainda está pendente não abre um segundo pedido: o
-- POST público atualiza o que existe em vez de empilhar duplicatas.
CREATE INDEX IF NOT EXISTS idx_todogreen_access_requests_email
  ON todogreen_access_requests (tenant_id, email, status);
