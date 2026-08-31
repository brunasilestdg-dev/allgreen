import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cable, CheckCircle2, Loader2, PlugZap, Trash2 } from "lucide-react";

const request = async (options = {}, authHeaders) => {
  const response = await fetch("/api/todogreen/mcp-connections", {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a conexão MCP.");
    error.detail = data.detail || "";
    error.canSaveAnyway = data.canSaveAnyway === true;
    throw error;
  }
  return data;
};

export default function McpConnectionsPanel({ authHeaders, setToast }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [canForce, setCanForce] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", token: "" });

  const load = useCallback(async () => {
    try {
      setData(await request({}, authHeaders));
      setError("");
    } catch (reason) {
      setError(reason.message);
    }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const save = async (saveAnyway = false) => {
    setBusy("save");
    setError("");
    try {
      const result = await request({
        method: "POST",
        body: JSON.stringify({ ...form, saveAnyway }),
      }, authHeaders);
      setToast?.(result.ok
        ? `MCP conectado: ${result.serverName || form.name || "servidor"}.`
        : "MCP salvo, mas ainda não respondeu ao teste.");
      setForm({ name: "", url: "", token: "" });
      setCanForce(false);
      setOpen(false);
      await load();
    } catch (reason) {
      setError([reason.message, reason.detail].filter(Boolean).join(" "));
      setCanForce(reason.canSaveAnyway);
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const result = await request({
        method: "POST",
        body: JSON.stringify({ action: "test" }),
      }, authHeaders);
      setToast?.(`MCP respondeu com protocolo ${result.protocolVersion || "compatível"}.`);
      await load();
    } catch (reason) {
      setToast?.([reason.message, reason.detail].filter(Boolean).join(" "));
      await load();
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!window.confirm("Remover esta conexão MCP e o token guardado no cofre?")) return;
    setBusy("remove");
    try {
      await request({ method: "DELETE" }, authHeaders);
      setToast?.("Conexão MCP removida.");
      await load();
    } finally {
      setBusy("");
    }
  };

  const connection = data?.connection;

  return (
    <section className="tdg-panel tdg-mcp-panel">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">MODEL CONTEXT PROTOCOL</span>
          <h2>Conectar servidor MCP</h2>
          <p>Informe um endpoint Streamable HTTP público. O ERP testa o initialize real antes de guardar; o token fica cifrado e nunca volta para a tela.</p>
        </div>
        <PlugZap size={22} />
      </div>

      {data && !data.vaultAvailable && (
        <div className="tdg-alert" role="alert">
          <AlertTriangle size={18} />
          <span>O cofre de credenciais ainda não está configurado no servidor. Defina <code>WORKSPACE_AI_VAULT_KEY</code> antes de conectar um MCP.</span>
        </div>
      )}
      {error && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}

      {!data && !error && <p aria-busy="true">Carregando conexão MCP...</p>}

      {connection && !open && (
        <article className="tdg-mcp-connection">
          <span className={connection.testOk ? "ok" : "warn"}>
            {connection.testOk ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div>
            <strong>{connection.name}</strong>
            <small>{connection.url}</small>
            <small>
              {connection.testOk ? "Conexão validada" : "Conexão ainda não validada"}
              {connection.testedAt ? ` · teste em ${new Date(connection.testedAt).toLocaleString("pt-BR")}` : ""}
              {connection.hasToken ? " · token no cofre" : " · sem autenticação"}
            </small>
            {!connection.testOk && connection.testError && <p>{connection.testError}</p>}
          </div>
          <div className="tdg-mcp-actions">
            <button type="button" onClick={test} disabled={Boolean(busy)}>
              {busy === "test" ? <Loader2 size={15} /> : <Cable size={15} />} Testar
            </button>
            <button type="button" onClick={() => { setForm({ name: connection.name, url: connection.url, token: "" }); setOpen(true); }} disabled={Boolean(busy)}>
              Alterar
            </button>
            <button type="button" onClick={remove} disabled={Boolean(busy)} aria-label="Remover conexão MCP">
              <Trash2 size={15} />
            </button>
          </div>
        </article>
      )}

      {!connection && !open && data?.vaultAvailable && (
        <button className="tdg-action" type="button" onClick={() => setOpen(true)}>
          <PlugZap size={16} /> Conectar meu MCP
        </button>
      )}

      {open && data?.vaultAvailable && (
        <div className="tdg-mcp-form">
          <label>
            <span>Nome da conexão</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="MCP comercial" />
          </label>
          <label>
            <span>Endpoint Streamable HTTP</span>
            <input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://mcp.suaempresa.com/mcp" />
          </label>
          <label>
            <span>Bearer token (opcional)</span>
            <input type="password" autoComplete="off" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} placeholder={connection?.hasToken ? "Cole novamente para trocar" : "Token do servidor"} />
          </label>
          <p>Compatível agora com Streamable HTTP e bearer token. Servidores que exigem OAuth interativo precisam de uma etapa adicional do provedor.</p>
          <div className="tdg-mcp-actions">
            <button className="tdg-action" type="button" onClick={() => save(false)} disabled={busy === "save" || !form.url}>
              {busy === "save" ? <Loader2 size={15} /> : <PlugZap size={15} />} Testar e conectar
            </button>
            {canForce && <button type="button" onClick={() => save(true)} disabled={Boolean(busy)}>Salvar assim mesmo</button>}
            <button type="button" onClick={() => { setOpen(false); setError(""); setCanForce(false); }} disabled={Boolean(busy)}>Cancelar</button>
          </div>
        </div>
      )}
    </section>
  );
}
