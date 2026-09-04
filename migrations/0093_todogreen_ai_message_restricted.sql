-- Memória por cliente (fase 2b): marca se a resposta do Plantû foi montada com
-- os fatos RESTRITOS do dossiê no contexto (CPF, salário, conta bancária — que
-- só quem tem finance:manage enxerga). Sem esta marca, a memória por cliente
-- reexporia esses dados a quem hoje já não tem o acesso, pela lembrança de uma
-- conversa antiga — furando a mesma guarda que o dossiê aplica.
-- 0 = contexto sem restrito (padrão); 1 = restrito estava disponível ao modelo.
ALTER TABLE todogreen_ai_messages ADD COLUMN restricted_context INTEGER NOT NULL DEFAULT 0;
