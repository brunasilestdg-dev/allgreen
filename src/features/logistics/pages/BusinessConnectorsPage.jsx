import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  CircleDashed,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import "./TodoGreenPages.css";

// Conectores de NEGÓCIO (monday.com, Power BI, ...) visíveis para quem
// administra integrações — owner/admin/operações. É de propósito SEPARADA da
// Central de Integrações (dev-only): aqui não há chaves de IA, automações
// auto-hospedadas nem chaves por ambiente, só o "Conectar" das contas externas
// que o negócio usa. A titular pediu as telas técnicas invisíveis; conectar o
// monday.com nunca foi uma tela técnica — ele só tinha ficado preso lá dentro.

const STATUS = {
  connected: { label: "Conectada e validada", Icon: CheckCircle2 },
  configured: { label: "Configurada, autorização pendente", Icon: CircleDashed },
  requires_setup: { label: "Configuração necessária", Icon: CircleDashed },
  external_dependency: { label: "Depende de serviço externo", Icon: ServerCog },
  error: { label: "Erro na integração", Icon: AlertTriangle },
};

export default function BusinessConnectorsPage({ authHeaders, setToast }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/todogreen/integrations", { headers: authHeaders?.() || {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os conectores.");
      setStatus(data);
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // O monday.com devolve o usuário para a tela com ?monday=... após a
  // autorização. Traduz o resultado num aviso e limpa o parâmetro para não repetir.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const monday = params.get("monday");
    if (!monday) return;
    if (monday === "connected") setToast?.("Conta monday.com conectada. Use “Testar” após mapear os boards.");
    else if (monday === "denied") setToast?.("A autorização com o monday.com foi cancelada.");
    else setToast?.("Não foi possível concluir a conexão com o monday.com.");
    params.delete("monday");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  // Inicia o OAuth: pede a URL de autorização (autenticado por Bearer, como o
  // resto do app) e só então navega o navegador até o provedor. Assim o botão
  // não depende do cookie de sessão e falhas viram aviso, não tela em branco.
  const connect = async (item) => {
    const path = item?.connectPath || "/api/todogreen/integrations/monday/oauth/start";
    try {
      const response = await fetch(path, { headers: authHeaders?.() || {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.authorizeUrl) {
        throw new Error(data.error || "Não foi possível iniciar a conexão.");
      }
      window.location.href = data.authorizeUrl;
    } catch (error) {
      setToast?.(error.message);
    }
  };

  const test = async (provider) => {
    setTesting(provider);
    try {
      const response = await fetch("/api/todogreen/integrations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "O provedor não respondeu.");
      if (data.integrationTest?.skipped) {
        setToast?.(data.integrationTest.detail || "A integração ainda depende de configuração.");
      } else if (data.integrationTest) {
        setToast?.(`${data.integrationTest.provider} respondeu em ${data.integrationTest.latencyMs} ms.`);
      } else if (data.test) {
        setToast?.(`${data.test.provider} respondeu em ${data.test.latencyMs} ms.`);
      } else {
        setToast?.("Teste concluído.");
      }
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setTesting("");
    }
  };

  const healthById = useMemo(
    () => new Map((status?.health || []).map((item) => [item.integrationId, item])),
    [status],
  );

  // Só os conectores de negócio: o backend já entrega os provedores externos
  // gerenciáveis em `management` (monday.com, Power BI...).
  const connectors = status?.management || [];

  if (loading && !status)
    return <section className="tdg-panel" aria-busy="true">Carregando conectores...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CONECTORES</span>
          <h2>Conectores de negócio</h2>
          <p>Autorize as contas externas que a operação usa — monday.com e afins. “Configurada” não é “conectada”: a conta só fica verde depois de autorizar e validar. As telas técnicas (cascata de IA, chaves e automações) seguem no perfil de desenvolvedor.</p>
        </div>
        <button className="tdg-action" type="button" onClick={load}><RefreshCw size={16} />Atualizar</button>
      </header>

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">INTEGRAÇÕES</span><h2>Contas externas</h2></div>
          <Cable size={22} />
        </div>
        <div className="tdg-access-list">
          {connectors.length === 0 && <p>Nenhum conector de negócio disponível.</p>}
          {connectors.map((item) => {
            const state = STATUS[item.status] || STATUS[item.configured ? "configured" : "requires_setup"];
            const StateIcon = state.Icon;
            const health = healthById.get(item.id);
            return (
              <div className="tdg-access-row" key={item.id}>
                <span>
                  <StateIcon size={16} />
                  <strong>{item.name || item.id}</strong>
                  <small><b>{state.label}.</b> {item.detail || "Sem detalhe adicional."}</small>
                  {item.requirement && <small>Necessário: {item.requirement}</small>}
                  {health && (
                    <small className="tdg-integration-health">
                      Configurada: {health.configured ? "sim" : "não"} · Autenticada: {health.authenticated ? "sim" : "não"} · Online: {health.online ? "sim" : "não"}
                      {health.checkedAt ? ` · Verificada: ${new Date(health.checkedAt).toLocaleString("pt-BR")}` : ""}
                    </small>
                  )}
                  {health?.error && <small className="tdg-integration-error">Erro: {health.error}</small>}
                </span>
                {item.canConnect && (
                  <button
                    type="button"
                    className="tdg-action"
                    onClick={() => connect(item)}
                  >
                    {item.status === "connected" ? "Reconectar" : "Conectar"}
                  </button>
                )}
                {item.canTest && (
                  <button
                    type="button"
                    disabled={!item.configured || testing === item.id}
                    onClick={() => test(item.id)}
                  >
                    {testing === item.id ? "Testando..." : "Testar"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
