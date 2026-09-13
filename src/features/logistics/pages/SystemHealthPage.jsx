import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Database,
  RefreshCw,
  ServerCog,
  ShieldAlert,
} from "lucide-react";
import {
  HEALTH_GROUPS,
  SYSTEM_STATES,
  ambienteLabel,
  systemStateLabel,
} from "../systemHealthDomain.js";
import "./TodoGreenPages.css";

// Administração → Saúde do sistema. Mostra o que o Worker COLETOU e o domínio
// puro DERIVOU (`systemHealthDomain.js`). Regras desta tela:
//   - falha de leitura vira "Indisponível", nunca zero nem card vazio;
//   - LOCAL (o build que este navegador carregou) × SERVIDOR (o que o Worker
//     está servindo) × BANCO (migrations aplicadas) sempre lado a lado;
//   - nenhum segredo: só nomes de variáveis e booleanos de presença;
//   - "Testar" reaproveita o mesmo POST do painel de Integrações (uma régua).

const ICONE_POR_ESTADO = {
  [SYSTEM_STATES.OPERATIONAL]: CheckCircle2,
  [SYSTEM_STATES.DEGRADED]: AlertTriangle,
  [SYSTEM_STATES.FALLBACK]: CircleDashed,
  [SYSTEM_STATES.NOT_CONFIGURED]: CircleDashed,
  [SYSTEM_STATES.EXTERNAL_DEPENDENCY]: ServerCog,
  [SYSTEM_STATES.ERROR]: ShieldAlert,
};

const dataHora = (iso) => {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString("pt-BR") : String(iso);
};

export const EstadoBadge = ({ state, label }) => {
  const Icone = ICONE_POR_ESTADO[state] || CircleDashed;
  return (
    <span className={`tdg-health-badge state-${state || "NOT_CONFIGURED"}`} data-state={state}>
      <Icone size={13} aria-hidden="true" />
      {label || systemStateLabel(state)}
    </span>
  );
};

const Metricas = ({ item }) => {
  const partes = [];
  if (Number.isFinite(item.latencyMs)) partes.push(`Latência ${item.latencyMs} ms`);
  if (Number.isFinite(item.recordsProcessed)) partes.push(`${item.recordsProcessed} registro(s) processado(s)`);
  if (item.lastSuccessAt) partes.push(`Último sucesso ${dataHora(item.lastSuccessAt)}`);
  if (item.lastErrorAt) partes.push(`Última falha ${dataHora(item.lastErrorAt)}`);
  if (item.stale) partes.push("Dado antigo (stale)");
  if (!partes.length && item.checkedAt) partes.push(`Verificado ${dataHora(item.checkedAt)}`);
  if (!partes.length) return null;
  return <div className="tdg-health-metrics">{partes.map((p) => <span key={p}>{p}</span>)}</div>;
};

export default function SystemHealthPage({ authHeaders, setToast }) {
  const [relatorio, setRelatorio] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [testando, setTestando] = useState("");

  const clientSha = import.meta.env.VITE_APP_VERSION || "";

  // Começa pelo `await`: nenhum setState síncrono dentro do efeito de montagem
  // (regra react-hooks/set-state-in-effect). O indicador "Lendo..." da
  // atualização manual é ligado por `atualizar`, no clique.
  const carregar = useCallback(async () => {
    try {
      const response = await fetch(`/api/todogreen/system-health?client=${encodeURIComponent(clientSha)}`, {
        headers: authHeaders?.() || {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível ler a saúde do sistema.");
      setRelatorio(data);
      setErro("");
    } catch (e) {
      // Mantém o último relatório bom (se houver) e diz que está indisponível —
      // nunca zera a tela.
      setErro(e.message || "Saúde do sistema indisponível.");
    } finally {
      setCarregando(false);
    }
  }, [authHeaders, clientSha]);

  const atualizar = useCallback(() => {
    setCarregando(true);
    return carregar();
  }, [carregar]);

  // A carga inicial é AGENDADA (não executada no corpo do efeito): o setState
  // acontece num callback, fora do render — e desmontar antes de disparar
  // cancela a leitura em vez de atualizar um componente que já saiu da tela.
  useEffect(() => {
    const agendamento = setTimeout(() => { carregar(); }, 0);
    return () => clearTimeout(agendamento);
  }, [carregar]);

  const testar = async (provider) => {
    setTestando(provider);
    try {
      const response = await fetch("/api/todogreen/integrations", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "O provedor não respondeu.");
      const t = data.integrationTest || data.test || data.searchTest;
      setToast?.(t?.skipped ? (t.detail || "A integração ainda depende de configuração.") : `${provider} respondeu em ${t?.latencyMs ?? "?"} ms.`);
      await carregar();
    } catch (e) {
      setToast?.(e.message);
      await carregar();
    } finally {
      setTestando("");
    }
  };

  const porGrupo = useMemo(() => {
    const mapa = new Map();
    for (const item of relatorio?.integrations || []) {
      if (!mapa.has(item.group)) mapa.set(item.group, []);
      mapa.get(item.group).push(item);
    }
    return mapa;
  }, [relatorio]);

  const versao = relatorio?.version;
  const grupos = relatorio?.groups || HEALTH_GROUPS;

  return (
    <div className="tdg-page tdg-system-health">
      <section className="tdg-panel">
        <div className="tdg-section-head tdg-health-head">
          <div>
            <span className="tdg-kicker">ADMINISTRAÇÃO</span>
            <h2>Saúde do sistema</h2>
            <p>Estado real da plataforma e de cada integração. Zero é resultado; indisponível é indisponível.</p>
          </div>
          <div className="tdg-health-actions">
            {relatorio && <EstadoBadge state={relatorio.overall} />}
            <button type="button" onClick={atualizar} disabled={carregando} aria-label="Atualizar saúde do sistema">
              <RefreshCw size={15} aria-hidden="true" /> {carregando ? "Lendo..." : "Atualizar"}
            </button>
          </div>
        </div>

        {erro && (
          <div className="tdg-health-alert error" role="alert">
            <strong>Saúde do sistema indisponível.</strong> {erro}
            {relatorio ? " Mostrando a última leitura obtida." : ""}
            {" "}
            <button type="button" onClick={atualizar}>Tentar novamente</button>
          </div>
        )}

        {!relatorio && carregando && <div className="tdg-health-unavailable" aria-busy="true">Lendo componentes e integrações…</div>}
        {!relatorio && !carregando && !erro && <div className="tdg-health-unavailable">Nenhuma leitura disponível.</div>}

        {versao && (
          <>
            <div className="tdg-health-version">
              <article>
                <span>Local (este navegador)</span>
                <strong>{versao.clientSha || "—"}</strong>
                <small>Build carregado pelo app. {versao.clientMatchesServer === false ? "Diferente do servidor — recarregue." : versao.clientMatchesServer ? "Igual ao servidor." : ""}</small>
              </article>
              <article>
                <span>Servidor · {ambienteLabel(versao.environment)}</span>
                <strong>{versao.serverSha || "—"}</strong>
                <small>
                  {versao.branch ? `Branch ${versao.branch} · ` : ""}
                  {versao.buildTime ? `build ${dataHora(versao.buildTime)}` : "sem manifesto de build"}
                  {versao.publishedBy ? ` · via ${versao.publishedBy}` : ""}
                </small>
              </article>
              <article>
                <span>Banco (migrations)</span>
                <strong>
                  {versao.appliedMigrations ?? "—"}
                  {versao.expectedMigrations !== null && versao.expectedMigrations !== undefined ? ` / ${versao.expectedMigrations}` : ""}
                </strong>
                <small>
                  {versao.appliedLastMigration ? `Última aplicada: ${versao.appliedLastMigration}` : "Contagem indisponível"}
                  {versao.migrationsInSync === false ? " · fora de sincronia" : versao.migrationsInSync ? " · em sincronia" : ""}
                </small>
              </article>
            </div>
            {Array.isArray(relatorio.alerts) && relatorio.alerts.length > 0 && (
              <div className="tdg-health-alerts">
                {relatorio.alerts.map((a) => (
                  <div key={a.code} className={`tdg-health-alert ${a.severity === "error" ? "error" : ""}`} role={a.severity === "error" ? "alert" : "status"}>
                    <strong>{a.code}</strong> — {a.message}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {relatorio && (
        <section className="tdg-panel">
          <div className="tdg-section-head">
            <div>
              <span className="tdg-kicker">PLATAFORMA</span>
              <h2>Componentes</h2>
            </div>
            <Database size={22} aria-hidden="true" />
          </div>
          <div className="tdg-health-grid">
            {relatorio.components.map((c) => (
              <article className="tdg-health-card" key={c.id} data-component={c.id}>
                <div className="tdg-health-card-head">
                  <strong>{c.name}</strong>
                  <EstadoBadge state={c.state} label={c.label} />
                </div>
                <small>{c.detail}</small>
                <Metricas item={c} />
              </article>
            ))}
          </div>
        </section>
      )}

      {relatorio && grupos.filter((g) => g.id !== "plataforma" && porGrupo.has(g.id)).map((grupo) => (
        <section className="tdg-panel" key={grupo.id}>
          <div className="tdg-section-head">
            <div>
              <span className="tdg-kicker">INTEGRAÇÕES</span>
              <h2>{grupo.label}</h2>
            </div>
            <Activity size={22} aria-hidden="true" />
          </div>
          <div className="tdg-access-list">
            {porGrupo.get(grupo.id).map((item) => (
              <div className="tdg-access-row" key={item.id} data-integration={item.id}>
                <span>
                  <EstadoBadge state={item.state} label={item.label} />
                  <strong>{item.name}</strong>
                  <small className="tdg-health-impl">{item.implementationLabel}</small>
                  <small>{item.detail || "Sem detalhe adicional."}</small>
                  {item.requirement && <small>Necessário: {item.requirement}</small>}
                  {item.error && <small className="tdg-integration-error">Erro: {item.error}</small>}
                  {item.nextAction && <small>Ação disponível: {item.nextAction}</small>}
                  <Metricas item={item} />
                </span>
                {item.canTest && (
                  <button type="button" disabled={testando === item.id} onClick={() => testar(item.id)}>
                    {testando === item.id ? "Testando..." : "Testar"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {relatorio && (
        <p className="tdg-health-foot">
          Leitura em {dataHora(relatorio.checkedAt)}. Nenhum segredo é exibido — apenas nomes de variáveis e presença.
          Integração <em>configurada, sem verificação</em> só vira <em>Operacional</em> depois de um teste ou sincronização real.
        </p>
      )}
    </div>
  );
}
