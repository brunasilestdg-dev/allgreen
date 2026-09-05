-- Correção assistida (#128, fase 2b): quando a pessoa dá 👎 numa resposta do
-- Plantû, ela pode escrever qual era a resposta certa. Essa correção fica na
-- própria linha da resposta e volta como contexto nas próximas perguntas — o
-- assistente aprende com o que a pessoa corrigiu, em vez de repetir o erro.
-- A correção é privada de quem corrigiu (mesmo escopo do histórico) e herda a
-- mesma guarda de restrito (restricted_context) da resposta original.
ALTER TABLE todogreen_ai_messages ADD COLUMN correction TEXT;
