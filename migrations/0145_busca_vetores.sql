-- Busca por significado (Base de conhecimento): vetor de cada texto que a
-- pessoa indexou, calculado uma vez pelo bge-m3 (Workers AI) e reaproveitado.
--
-- Guarda só o hash do texto e o vetor em int8 (1.024 bytes); o texto em si
-- nunca fica aqui. Por pessoa: cada uma só lê os vetores que ela mesma pediu.
-- A comparação com a consulta roda no aparelho (src/features/knowledge/
-- semanticDomain.js), então não há índice vetorial pago nem limite por conta.
CREATE TABLE IF NOT EXISTS busca_vetores (
  user_id TEXT NOT NULL,
  modelo TEXT NOT NULL,
  hash TEXT NOT NULL,
  vetor BLOB NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (user_id, modelo, hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_busca_vetores_user_criado
  ON busca_vetores (user_id, criado_em);
