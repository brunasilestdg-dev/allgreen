// ===== Registros da vertical: acesso por coleção =====
//
// Contrato: decide QUEM lê cada coleção e ATÉ ONDE a escrita alcança.
// Entradas: o vínculo resolvido da sessão (`access`: role, permissions,
// ownerId), o e-mail da sessão e o descritor da coleção.
// - `podeLerColecao`: qualquer uma de `permissoesLeitura` (ou a de escrita).
// - `podeLerCenarios`: precificação, Deal Desk ou auditoria.
// - `recorteDaColecao`: o corte de carteira em SQL — vazio para cadastro da
//   empresa (`escopoDeCarteira: false`).
// - `noAlcanceDaCarteira`: confirma, ANTES de escrever, que o registro está no
//   espaço e na carteira de quem pede; fora dela é o mesmo "não encontrado"
//   de um registro inexistente (404, nunca 403).
// Invariante: tenant e espaço (`workspace_owner_id` do vínculo) valem sempre;
// nada aqui lê escopo do corpo do pedido.

import { TENANT_ID, podeNaVertical, recorteDeCarteira } from "../todogreen-access.js";

// `read` abre a vertical, não o razão financeiro inteiro. Cada coleção
// declara pelo menos uma capacidade funcional que dá acesso ao seu conteúdo.
// A regra é "qualquer uma", porque auditoria pode consultar sem administrar.
export const podeLerColecao = (access, colecao) =>
  (colecao.permissoesLeitura || [colecao.permissao]).some((permissao) =>
    podeNaVertical(access, permissao));

export const podeLerCenarios = (access) =>
  ["pricing:simulate", "pricing:manage", "deal:review", "deal:approve", "audit:read"]
    .some((permissao) => podeNaVertical(access, permissao));

// O recorte de carteira só faz sentido em coleção que pertence a um cliente.
// Um cadastro da empresa — material, depósito, plano de contas, centro de custo,
// fornecedor — não tem dono comercial, e essas tabelas não têm sequer a coluna
// `client_id` que o recorte referencia. Sem esta saída, o SQL do recorte
// quebraria a leitura para todo papel que não vê a carteira inteira e, pior,
// faria `noAlcanceDaCarteira` devolver 404 em silêncio (ele engole o erro no
// `.catch`), o que pareceria "registro não encontrado" em vez de defeito.
//
// Quem declara `escopoDeCarteira: false` está dizendo "isto é cadastro da
// empresa, não carteira de ninguém" — e continua protegido pelos outros dois
// cortes, tenant e espaço, que valem sempre.
export const recorteDaColecao = (colecao, access, email) =>
  colecao.escopoDeCarteira === false
    ? { sql: "", params: [] }
    : recorteDeCarteira(access, email, "t");

// Confirma que o registro está na carteira de quem pede, ANTES de escrever.
// 404 e não 403 quando está fora: dizer "existe mas não é sua" já entrega que
// o registro existe.
export const noAlcanceDaCarteira = async (env, colecao, access, email, id) => {
  const recorte = recorteDaColecao(colecao, access, email);
  return env.DB
    .prepare(
      `SELECT t.id FROM ${colecao.tabela} t
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${recorte.sql}
        LIMIT 1`,
    )
    .bind(id, TENANT_ID, access.ownerId, ...recorte.params)
    .first()
    .catch(() => null);
};
