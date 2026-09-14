import { useCallback, useEffect, useState } from "react";
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
      setRecords(rows.map(tdgLegalToContract));
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
      const payload = contractToTdgLegal(contract);
      const body = await post("/api/todogreen/records/legal", payload, "POST");
      const row = body?.registro || body?.record;
      const traduzido = row ? tdgLegalToContract(row) : null;
      if (traduzido) {
        setRecords((prev) => [traduzido, ...prev.filter((r) => r.id !== traduzido.id)]);
      } else {
        await load();
      }
      return traduzido;
    },
    [authHeaders, enabled, load, post],
  );

  const replace = useCallback(
    async (id, patch) => {
      if (!enabled || !authHeaders) {
        throw new Error("Jurídico canônico do TDG indisponível nesta sessão.");
      }
      // Reaproveita o mapeador — patch parcial vira payload TDG completo (só
      // as chaves com valor entram). O endpoint aceita PATCH parcial.
      const partial = contractToTdgLegal({ ...patch, id });
      const body = await post(
        `/api/todogreen/records/legal/${encodeURIComponent(id)}`,
        partial,
        "PATCH",
      );
      const row = body?.registro || body?.record;
      const traduzido = row ? tdgLegalToContract(row) : null;
      if (traduzido) {
        setRecords((prev) => prev.map((r) => (r.id === id ? traduzido : r)));
      } else {
        await load();
      }
      return traduzido;
    },
    [authHeaders, enabled, load, post],
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
      setRecords((prev) => prev.filter((r) => r.id !== id));
    },
    [authHeaders, enabled],
  );

  return { records, loading, error, refresh: load, add, replace, remove };
}
