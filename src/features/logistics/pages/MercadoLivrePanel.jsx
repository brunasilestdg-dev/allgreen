import { useEffect, useState } from "react";
import { ExternalLink, Search, Trash2, Truck } from "lucide-react";

// Consulta fiscal do Mercado Envios (linehaul de venda e MWH, Carrito V3,
// shipment e CT-e). O conector só faz GET em api.mercadolibre.com com o token
// OAuth do espaço — o token nunca chega aqui. Os caminhos de cada consulta
// seguem a documentação do Mercado Envios, listada abaixo do formulário.

const BASE = "/api/todogreen/integrations/mercadolivre";

// "chave=valor" por linha → objeto de query string.
export const parseMercadoLivreQuery = (texto) => Object.fromEntries(
  String(texto || "")
    .split(/\r?\n|&/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const i = linha.indexOf("=");
      return i < 0 ? [linha, ""] : [linha.slice(0, i).trim(), linha.slice(i + 1).trim()];
    })
    .filter(([chave]) => chave),
);

export default function MercadoLivrePanel({ authHeaders, setToast, onChange }) {
  const [info, setInfo] = useState(null);
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [resultado, setResultado] = useState(null);
  const [consultando, setConsultando] = useState(false);

  const carregar = async () => {
    try {
      const response = await fetch(`${BASE}/connection`, { headers: authHeaders?.() || {} });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setInfo(data);
    } catch {
      setInfo(null);
    }
  };

  useEffect(() => { carregar(); }, []);

  const consultar = async (event) => {
    event.preventDefault();
    setConsultando(true);
    setResultado(null);
    try {
      const response = await fetch(`${BASE}/consulta`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ path: path.trim(), query: parseMercadoLivreQuery(query) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "O Mercado Livre não respondeu à consulta.");
      setResultado(data);
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setConsultando(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm("Desconectar a conta do Mercado Livre deste espaço?")) return;
    const response = await fetch(`${BASE}/connection`, { method: "DELETE", headers: authHeaders?.() || {} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setToast?.(data.error || "Não foi possível desconectar.");
    setToast?.("Conta do Mercado Livre desconectada.");
    setResultado(null);
    await carregar();
    onChange?.();
  };

  if (!info) return null;
  const conexao = info.connection;
  const conectada = conexao?.status === "connected";

  return (
    <section className="tdg-panel">
      <div className="tdg-section-head">
        <div><span className="tdg-kicker">MERCADO ENVIOS</span><h2>Consulta fiscal do Mercado Livre</h2></div>
        <Truck size={22} />
      </div>
      <p>
        {conectada
          ? `Conta ${conexao.nickname || conexao.userId} autorizada neste espaço.`
          : info.config?.configured
            ? "Conecte a conta da transportadora em “Operação e fiscal” para liberar as consultas."
            : "O App do Mercado Livre ainda não foi cadastrado no cofre do Worker (APP ID e segredo)."}
      </p>

      {conectada && (
        <form className="tdg-client-admin-form" onSubmit={consultar}>
          <div className="tdg-form-row">
            <label>
              <span>Caminho da API (GET)</span>
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/shipments/123456789" required />
            </label>
            <label>
              <span>Parâmetros (chave=valor por linha)</span>
              <textarea rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="opcional" />
            </label>
          </div>
          <div className="tdg-page-actions">
            <button className="tdg-action" type="submit" disabled={consultando || !path.trim()}>
              <Search size={16} />{consultando ? "Consultando..." : "Consultar"}
            </button>
            <button className="tdg-danger-action" type="button" onClick={desconectar}>
              <Trash2 size={16} />Desconectar
            </button>
          </div>
          {resultado && (
            <div>
              <small>HTTP {resultado.status} · {resultado.latencyMs} ms · {resultado.path}</small>
              <pre className="tdg-mercadolivre-result">{typeof resultado.data === "string" ? resultado.data : JSON.stringify(resultado.data, null, 2)}</pre>
            </div>
          )}
        </form>
      )}

      <div className="tdg-access-list">
        {(info.docs || []).map((doc) => (
          <div className="tdg-access-row" key={doc.id}>
            <span><strong>{doc.label}</strong></span>
            <a className="tdg-secondary-action" href={doc.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />Documentação
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
