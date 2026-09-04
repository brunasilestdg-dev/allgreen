-- Avaliação das respostas do Plantû (fase 2 da memória, 0091).
--
-- A pessoa marca a resposta como útil ou não (👍/👎). Guardar isso é o começo
-- do "aprendizado": com o tempo dá para ver o que ajuda e o que erra, sem
-- inventar nada — é só um voto por mensagem do assistente.
--
-- Coluna nova na tabela append-only de mensagens (a avaliação é do turno, não
-- um lançamento novo): NULL = sem voto, 1 = útil (👍), -1 = não ajudou (👎).
-- Só mensagens do assistente recebem voto.

ALTER TABLE todogreen_ai_messages ADD COLUMN rating INTEGER;
