import { useCallback, useEffect, useRef, useState } from "react";
import { contractToTdgLegal, tdgLegalToContract } from "./tdgLegalBridge.js";

// Hook que mantém a lista de documentos jurídicos canônicos do TDG (D1)
// carregada e oferece as mesmas operações da `useCollection` da LegalHub
// (add / replace / remove) — só que aqui as escritas VAO PELO endpoint
// `/api/todogreen/records/legal`, respeitando gates operacionais reais
// (`juridicoConcluido`, `documentoDeAssinaturaVinculado`).
//
// Contrato:
// - `records` — array já traduzido para o shape da nova UI (via
//   `tdgLegalToContract`), incluindo `source: "tdg"` para a UI mostrar o
//   badge "Jurídico canônico".
// - `loading` / `error` — estado da carga.
// - `refresh()` — força reload.
// - `add(contract)` — POST; devolve o registro traduzido ou lança erro.
// - `replace(id, patch)` — PATCH; devolve o registro atualizado.
// - `remove(id)` — DELETE.
//
// Se `authHeaders` for undefined, o hook fica em standby (nada carrega e
// as escritas rejeitam com mensagem clara). Se o endpoint responder 401/403
// não retentamos — a mensagem sobe intacta para o toast.
export function useTdgLegalRecords({ authHeaders, enabled = true, setToast } = {}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Espelho síncrono do estado para as escritas usarem — o setter do useState
  // é assíncrono, então `replace(id, patch)` não pode buscar `revision` do
  // state diretamente. O ref é atualizado no `setRecords`.
  const recordsRef = useRef(records);

  const load = useCallback(async () => {
    if (!enabled || !authHeaders) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/todogreen/records/legal", {
        headers: { ...(authHeaders() || {}) },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Falha ao carregar Jurídico (HTTP ${res.status}).`);
      }
      const body = await res.json();
      const rows = Array.isArray(body?.registros) ? body.registros : body?.records || [];
      const next = rows.map(tdgLegalToContract);
      recordsRef.current = next;
      setRecords(next);
    } catch (err) {
      setError(err.message);
      setToast?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, enabled, setToast]);

  useEffect(() => {
    load();
  }, [load]);

  // Utilitário que atualiza o state e o ref juntos — mantém o `revision`
  // que a `replace` precisa ler sem async.
  const commitRecords = useCallback((next) => {
    const value = typeof next === "function" ? next(recordsRef.current) : next;
    recordsRef.current = value;
    setRecords(value);
  }, []);

  const post = useCallback(
    async (path, payload, method = "POST") => {
      const res = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(authHeaders?.() || {}),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Falha (HTTP ${res.status}).`);
      return body;
    },
    [authHeaders],
  );

  const add = useCallback(
    async (contract) => {
      if (!enabled || !authHeaders) {
        throw new Error("Jurídico canônico do TDG indisponível nesta sessão.");
      }
      const payload = { ...contractToTdgLegal(contract), situacao: "rascunho" };
      const body = await post("/api/todogreen/records/legal", payload, "POST");
      const row = body?.registro || body?.record;
      const traduzido = row ? tdgLegalToContract(row) : null;
      if (traduzido) {
        commitRecords((prev) => [traduzido, ...prev.filter((r) => r.id !== traduzido.id)]);
      } else {
        await load();
      }
      return traduzido;
    },
    [authHeaders, enabled, load, post, commitRecords],
  );

  const replace = useCallback(
    async (id, patch) => {
      if (!enabled || !authHeaders) {
        throw new Error("Jurídico canônico do TDG indisponível nesta sessão.");
      }
      // Optimistic locking: passamos a `revision` do registro atual (a que
      // veio na última leitura). Sem isso, dois membros editando o mesmo
      // contrato sobrescreviam-se em silêncio; com isso, o backend responde
      // 409 quando a revisão local está atrás — recarregamos e mostramos
      // mensagem clara para o usuário aplicar o patch de novo.
      const current = recordsRef.current.find((r) => r.id === id);
      if (Object.hasOwn(patch, "status") && patch.status !== current?.status)
        throw new Error("Mude a situação pelas ações da linha do tempo do Jurídico.");
      const currentRevision = current?.revision;
      const partial = contractToTdgLegal({ ...patch, id, revision: currentRevision });
      partial.situacao = current?.tdgStatus || "rascunho";
      const res = await fetch(`/api/todogreen/records/legal/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(authHeaders() || {}),
        },
        body: JSON.stringify(partial),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Conflito de versão: outra pessoa mexeu depois da nossa última
        // leitura. Recarrega para sincronizar e devolve uma exceção clara —
        // a UI mostra a mensagem no toast e o usuário reaplica o patch.
        await load();
        throw new Error(
          "Este contrato foi editado por outra pessoa desde que você abriu a página. Recarreguei os dados; revise e tente de novo.",
        );
      }
      if (!res.ok) throw new Error(body.error || `Falha (HTTP ${res.status}).`);
      const row = body?.registro || body?.record;
      const traduzido = row ? tdgLegalToContract(row) : null;
      if (traduzido) {
        commitRecords((prev) => prev.map((r) => (r.id === id ? traduzido : r)));
      } else {
        await load();
      }
      return traduzido;
    },
    [authHeaders, enabled, load, commitRecords],
  );

  const remove = useCallback(
    async (id) => {
      if (!enabled || !authHeaders) {
        throw new Error("Jurídico canônico do TDG indisponível nesta sessão.");
      }
      const res = await fetch(`/api/todogreen/records/legal/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...(authHeaders() || {}) },
      });
      if (!res.ok && res.status !== 404) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Falha ao remover (HTTP ${res.status}).`);
      }
      commitRecords((prev) => prev.filter((r) => r.id !== id));
    },
    [authHeaders, enabled, commitRecords],
  );

  // Timeline canônica: lê os eventos que vivem em `todogreen_legal_events`.
  // A UI usa isto no `LegalTimeline` da aba Contratos quando `tdgLegal` está
  // ativo, para não depender do array `events[]` que morava no blob.
  const listEvents = useCallback(
    async (id) => {
      if (!enabled || !authHeaders) return { situacao: "", eventos: [] };
      const res = await fetch(
        `/api/todogreen/records/legal/${encodeURIComponent(id)}/events`,
        { headers: { ...(authHeaders() || {}) } },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(body.error || `Falha ao ler timeline (HTTP ${res.status}).`);
      return { situacao: body.situacao || "", eventos: body.eventos || [] };
    },
    [authHeaders, enabled],
  );

  // Aplica uma AÇÃO do fluxo jurídico via endpoint oficial: o backend
  // valida na máquina de estados (`resolverAcaoJuridica`), grava o evento
  // imutável em `todogreen_legal_events` e move a situação em
  // `todogreen_legal_records` no mesmo `DB.batch` — é o caminho que aciona
  // os gates `juridicoConcluido` / `documentoDeAssinaturaVinculado`. Sem
  // isto, o botão "Aprovar" ficava só na UI e não abria a proposta.
  const postEvent = useCallback(
    async (id, action, { mensagem = "", anexoUrl = "", anexoNome = "" } = {}) => {
      if (!enabled || !authHeaders) {
        throw new Error("Jurídico canônico do TDG indisponível nesta sessão.");
      }
      const body = await post(
        `/api/todogreen/records/legal/${encodeURIComponent(id)}/events`,
        { acao: action, mensagem, anexoUrl, anexoNome },
      );
      // O endpoint devolve `{ situacao, eventos }`; atualizamos a situação
      // local via re-tradução ligeira: como a resposta traz só o status,
      // fazemos merge no registro atual e mantemos os demais campos como
      // estavam. Recarrego completo fica para o próximo `refresh`.
      const nextStatus = body?.situacao;
      if (nextStatus) {
        commitRecords((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, tdgStatus: nextStatus, status: mapTdgStatusToUi(nextStatus, r.status) }
              : r,
          ),
        );
      }
      return body;
    },
    [authHeaders, enabled, post, commitRecords],
  );

  return { records, loading, error, refresh: load, add, replace, remove, listEvents, postEvent };
}

// Mapeamento local só para o `postEvent` — preserva o status atual quando o
// backend devolveu algo que a UI não reconhece.
function mapTdgStatusToUi(tdgStatus, fallback) {
  const map = {
    rascunho: "rascunho",
    em_analise: "em_analise",
    ajuste_solicitado: "ajuste_solicitado",
    aprovado: "aprovado",
    assinado: "vigente",
    arquivado: "arquivado",
    recusado: "rescindido",
  };
  return map[tdgStatus] || fallback || "rascunho";
}
