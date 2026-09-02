import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Boxes,
  Cable,
  CircleDollarSign,
  Copy,
  FileCheck2,
  FileText,
  Gauge,
  KeyRound,
  MapPinned,
  PackageSearch,
  RefreshCw,
  Route,
  ScanLine,
  Trash2,
  Truck,
  Waypoints,
  Zap,
} from "lucide-react";
import {
  createTmsApiKey,
  loadTmsPortalData,
  revokeTmsApiKey,
} from "./tmsPortalData.js";
import "./TmsPortal.css";
import "./TmsApiManager.css";

const SECTIONS = [
  { id: "controle", label: "Torre de controle", icon: Gauge },
  { id: "cargas", label: "Cargas e pedidos", icon: PackageSearch },
  { id: "fracionada", label: "Carga fracionada", icon: Boxes },
  { id: "roteirizacao", label: "Roteirização", icon: Route },
  { id: "viagens", label: "Viagens", icon: Truck },
  { id: "fiscal", label: "CT-e, MDF-e e CIOT", icon: FileCheck2 },
  { id: "faturamento", label: "Faturamento", icon: CircleDollarSign },
  { id: "integracoes", label: "Integrações e API", icon: Cable },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const labelStatus = (value) => String(value || "—")
  .replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const pathSection = () => {
  if (typeof window === "undefined") return "controle";
  const part = window.location.pathname.replace(/^\/portal-tms\/?/, "").split("/")[0];
  return SECTIONS.some((item) => item.id === part) ? part : "controle";
};

function StatusPill({ value }) {
  const normalized = String(value || "").toLowerCase();
  const tone = ["completed", "concluida", "autorizado", "issued", "closed", "ativa", "ready"].includes(normalized)
    ? "ok"
    : ["cancelled", "canceled", "cancelado", "error", "erro", "failed", "revogada"].includes(normalized)
      ? "danger"
      : "pending";
  return <span className={`tms-status ${tone}`}>{labelStatus(value)}</span>;
}

function Metric({ label, value, detail, alert = false }) {
  return (
    <article className={`tms-metric ${alert && Number(value) > 0 ? "is-alert" : ""}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      <small>{detail}</small>
    </article>
  );
}

const Empty = ({ children }) => <div className="tms-empty">{children}</div>;

function OrdersTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhuma ordem de serviço registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>OS</th><th>Origem</th><th>Destino</th><th>Quantidade</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.number || row.id}</strong></td>
            <td>{row.origin?.city || row.origin?.cidade || row.origin?.name || "—"}</td>
            <td>{row.destination?.city || row.destination?.cidade || row.destination?.name || "—"}</td>
            <td>{number.format(row.quantity || 0)} {row.chargeUnit || ""}</td>
            <td>{money.format(row.netAmount || 0)}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OperationsTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhuma movimentação do TMS registrada.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Referência</th><th>Trecho</th><th>Veículo</th><th>Motorista</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.reference || row.id}</strong><small>{row.serviceDate || ""}</small></td>
            <td>{row.origin || "—"} <span className="tms-arrow">→</span> {row.destination || "—"}</td>
            <td>{row.vehiclePlate || "—"}</td>
            <td>{row.driverName || "—"}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function FiscalTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhum CT-e ou MDF-e disponível para este acesso.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Documento</th><th>Número</th><th>Emissão</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{String(row.docType || "").toUpperCase()}</strong></td>
            <td>{row.number || "—"}{row.series ? ` / ${row.series}` : ""}</td>
            <td>{row.issuedAt || "—"}</td>
            <td>{money.format(row.serviceValue || 0)}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function CiotTable({ rows = [] }) {
  if (!rows.length) return <Empty>Nenhum CIOT preparado ou emitido.</Empty>;
  return (
    <div className="tms-table-wrap">
      <table className="tms-table">
        <thead><tr><th>Registro</th><th>CIOT</th><th>Trecho</th><th>Veículo</th><th>Frete</th><th>Status</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.id}>
            <td><strong>{row.number || row.id}</strong></td>
            <td>{row.ciotCode || "Aguardando"}</td>
            <td>{row.origin || "—"} <span className="tms-arrow">→</span> {row.destination || "—"}</td>
            <td>{row.vehiclePlate || "—"}</td>
            <td>{money.format(row.freightAmount || 0)}</td>
            <td><StatusPill value={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Readiness({ data }) {
  const items = [
    ["Roteirização", data?.routing, Route],
    ["API TMS", data?.api, Cable],
    ["Faturamento", data?.billing, CircleDollarSign],
    ["CT-e", data?.cte, FileText],
    ["MDF-e", data?.mdfe, FileText],
    ["CIOT", data?.ciot, FileCheck2],
  ];
  return (
    <div className="tms-readiness">
      {items.map(([label, ready, Icon]) => (
        <div key={label} className={ready ? "ready" : "pending"}>
          <Icon size={17} />
          <span>{label}</span>
          <strong>{ready ? "Disponível" : "Construir/configurar"}</strong>
        </div>
      ))}
    </div>
  );
}

function ControlTower({ data, onSection }) {
  const indicators = data?.indicators || {};
  return (
    <>
      <div className="tms-metrics">
        <Metric label="OS abertas" value={indicators.ordersOpen} detail="pedidos ainda em execução" />
        <Metric label="Em trânsito" value={indicators.operationsInTransit} detail="movimentações sem conclusão" />
        <Metric label="TMS sem vínculo" value={indicators.unlinkedExternalDocs} detail="documentos para tratar" alert />
        <Metric label="Faturar" value={indicators.billingPending} detail="itens elegíveis" />
        <Metric label="CT-e pendente" value={indicators.ctePending} detail="ainda não autorizado" alert />
        <Metric label="MDF-e pendente" value={indicators.mdfePending} detail="ainda não autorizado" alert />
        <Metric label="CIOT pendente" value={indicators.ciotPending} detail="ainda não emitido" alert />
      </div>

      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Esteira operacional</span><h2>First, middle e last mile em uma só execução</h2></div></div>
        <div className="tms-flow">
          {[
            ["Pedido", "Portal, arquivo ou API", ScanLine],
            ["First mile", "Coleta e chegada à base", MapPinned],
            ["Consolidação", "Agrupamento para transferência", Boxes],
            ["Middle mile", "Transferência entre bases", Waypoints],
            ["Desconsolidação", "Separação para distribuição", Boxes],
            ["Last mile", "Roteiro, entrega e POD", Truck],
            ["Fiscal", "CT-e, MDF-e e CIOT", FileCheck2],
            ["Faturamento", "Cobrança após execução", CircleDollarSign],
          ].map(([title, detail, Icon]) => (
            <div className="tms-flow-step" key={title}>
              <div className="tms-flow-icon"><Icon size={19} /></div>
              <div><strong>{title}</strong><small>{detail}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="tms-panel">
        <div className="tms-panel-head">
          <div><span>Prontidão</span><h2>Capacidades do TMS</h2></div>
          <button type="button" className="tms-link" onClick={() => onSection("integracoes")}>Ver integrações</button>
        </div>
        <Readiness data={data?.readiness} />
      </section>

      <section className="tms-panel">
        <div className="tms-panel-head">
          <div><span>Execução</span><h2>Movimentações recentes</h2></div>
          <button type="button" className="tms-link" onClick={() => onSection("viagens")}>Ver viagens</button>
        </div>
        <OperationsTable rows={data?.recent?.operations} />
      </section>
    </>
  );
}

function ElectricRouting({ rows = [] }) {
  return (
    <>
      <section className="tms-panel tms-route-hero tms-electric-hero">
        <BatteryCharging size={30} />
        <div>
          <span>ROTEIRIZAÇÃO ELÉTRICA NATIVA</span>
          <h2>A rota entende bateria, carga e carregador</h2>
          <p>O planejamento cruza autonomia real, peso transportado, reserva mínima, conector, potência, acesso para pesados e impacto total da recarga no SLA.</p>
        </div>
        <span className="tms-electric-live"><Zap size={14} /> API ativa</span>
      </section>

      <div className="tms-electric-grid">
        <section className="tms-electric-card">
          <span>01 · Veículo</span>
          <strong>Perfil energético por modelo</strong>
          <p>Bateria, SOC, consumo, carga útil, Type 2/CCS2/CHAdeMO, potência AC/DC e reserva operacional.</p>
        </section>
        <section className="tms-electric-card">
          <span>02 · Eletroposto</span>
          <strong>Compatibilidade antes da distância</strong>
          <p>Elimina ponto offline, fechado, incompatível, sem acesso autorizado ou sem manobra para caminhão/carreta.</p>
        </section>
        <section className="tms-electric-card">
          <span>03 · Decisão</span>
          <strong>Menor impacto na operação</strong>
          <p>Compara desvio, tempo de carga, potência aceita pelo veículo e confiabilidade. O mais perto nem sempre vence.</p>
        </section>
      </div>

      <section className="tms-panel">
        <div className="tms-panel-head">
          <div><span>API externa</span><h2>Planejamento de recarga disponível</h2></div>
          <code className="tms-electric-endpoint">POST /api/tms/v1/routes/electric-plan</code>
        </div>
        <div className="tms-electric-result">
          <BatteryCharging size={24} />
          <div>
            <strong>Resposta operacional, não só mapa</strong>
            <p>Retorna rota viável sem carga, recarga recomendada com minutos adicionados, ou motivo exato da inviabilidade.</p>
          </div>
        </div>
      </section>

      <OperationsTable rows={rows} />
    </>
  );
}

function FractionalCargo() {
  return (
    <div className="tms-two-columns">
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Modelo operacional</span><h2>Carga fracionada</h2></div></div>
        <div className="tms-feature-list">
          <div><Boxes size={20} /><span><strong>Volumes e unidades logísticas</strong><small>Track ID, peso, dimensões, NF-e, código de barras, pallet, gaiola ou mala.</small></span></div>
          <div><Waypoints size={20} /><span><strong>Consolidação por trecho</strong><small>Agrupa remessas em uma transferência sem perder o vínculo de cada volume.</small></span></div>
          <div><ScanLine size={20} /><span><strong>Cross-docking e leitura</strong><small>Entrada, triagem, transferência, desconsolidação e saída por evento.</small></span></div>
          <div><Route size={20} /><span><strong>Última milha</strong><small>Após a desconsolidação, os volumes entram na roteirização local e seguem até o POD.</small></span></div>
        </div>
      </section>
      <section className="tms-panel">
        <div className="tms-panel-head"><div><span>Núcleo nativo</span><h2>Próxima construção</h2></div></div>
        <p className="tms-copy">A camada visual já está separada. O próximo bloco é criar consolidação, viagem, trecho, hub e leitura como entidades próprias. Os volumes/Track IDs já fazem parte do núcleo da API externa.</p>
      </section>
    </div>
  );
}

const SCOPE_LABELS = {
  "shipments:read": "Consultar cargas",
  "shipments:write": "Criar cargas",
  "tracking:write": "Enviar tracking",
  "pod:write": "Enviar POD",
  "fiscal:read": "Consultar CT-e/MDF-e",
  "ciot:read": "Consultar CIOT",
  "billing:read": "Consultar faturamento",
};

function ApiManager({ api, onReload }) {
  const availableScopes = api?.availableScopes || [];
  const keys = api?.keys || [];
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [scopes, setScopes] = useState(["shipments:read"]);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleScope = (scope) => {
    setScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  };

  const issueKey = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await createTmsApiKey({ name, clientId, scopes });
      setCreated(result);
      setName("");
      setClientId("");
      setScopes(["shipments:read"]);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível criar a chave.");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (key) => {
    if (!window.confirm(`Revogar a chave ${key.name}? A integração para de funcionar imediatamente.`)) return;
    setError("");
    try {
      await revokeTmsApiKey(key.id);
      await onReload();
    } catch (reason) {
      setError(reason?.message || "Não foi possível revogar a chave.");
    }
  };

  const copyCreatedKey = async () => {
    if (!created?.key) return;
    try { await navigator.clipboard.writeText(created.key); } catch { /* o valor continua visível */ }
  };

  return (
    <div className="tms-api-manager">
      <div className="tms-api-grid">
        <div className="tms-api-card">
          <h3>Nova chave de integração</h3>
          <p>Crie uma credencial por cliente ou parceiro. A chave completa aparece uma única vez.</p>
          <form className="tms-api-form" onSubmit={issueKey}>
            <label>
              <span>Nome da integração</span>
              <input className="tms-api-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Amazon produção" required />
            </label>
            <label>
              <span>Cliente ID, opcional</span>
              <input className="tms-api-input" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Limita a chave a um cliente" />
            </label>
            <div>
              <span style={{ display: "block", marginBottom: 6, color: "var(--tms-muted)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Permissões</span>
              <div className="tms-api-scopes">
                {availableScopes.map((scope) => (
                  <label className="tms-api-scope" key={scope}>
                    <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                    <span>{SCOPE_LABELS[scope] || scope}</span>
                  </label>
                ))}
              </div>
            </div>
            {error ? <p className="tms-api-inline-error">{error}</p> : null}
            <button className="tms-api-submit" type="submit" disabled={saving || !scopes.length}>{saving ? "Criando..." : "Gerar chave TMS"}</button>
          </form>
        </div>

        <div className="tms-api-card">
          <h3>Endpoints</h3>
          <p>API versionada e independente da sessão do ERP.</p>
          <div className="tms-api-endpoints">
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/shipments/:id</code>
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments/:id/tracking</code>
            <code>POST {api?.basePath || "/api/tms/v1"}/shipments/:id/pod</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/fiscal</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/ciot</code>
            <code>GET {api?.basePath || "/api/tms/v1"}/invoices</code>
            <code>OpenAPI: {api?.documentationPath || "/api/tms/v1/openapi.json"}</code>
          </div>
        </div>
      </div>

      {created?.key ? (
        <div className="tms-api-secret">
          <strong>Chave criada. Copie agora.</strong>
          <small>Depois que esta tela atualizar, o segredo completo não será mostrado de novo.</small>
          <div className="tms-api-secret-row">
            <code>{created.key}</code>
            <button type="button" className="tms-api-mini-button" onClick={copyCreatedKey}><Copy size={14} /> Copiar</button>
          </div>
        </div>
      ) : null}

      <div className="tms-api-card">
        <h3>Chaves do TMS</h3>
        <p>{api?.activeKeys || 0} chave(s) ativa(s). Cada chave pode ter escopo e cliente próprios.</p>
        <div className="tms-api-keys">
          {!keys.length ? <Empty>Nenhuma chave TMS criada ainda.</Empty> : keys.map((key) => (
            <div className={`tms-api-key-row ${key.revokedAt ? "is-revoked" : ""}`} key={key.id}>
              <div>
                <strong><KeyRound size={12} style={{ marginRight: 6, verticalAlign: -2 }} />{key.name}</strong>
                <small>{key.keyPrefix}•••• · {key.clientId ? `cliente ${key.clientId}` : "todos os clientes"} · {(key.scopes || []).join(", ")}</small>
              </div>
              {key.revokedAt ? <StatusPill value="revogada" /> : <button type="button" className="tms-api-mini-button" onClick={() => revoke(key)}><Trash2 size={13} /> Revogar</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Integrations({ data, onReload }) {
  const rows = [
    { name: "TRACK3R", detail: "Importação, documentos e ocorrências", value: data?.integrations?.track3r },
    { name: "CIOT / ANTT", detail: "Integração direta e certificado", value: data?.integrations?.ciot },
    { name: "Fiscal / SEFAZ", detail: "CT-e e MDF-e", value: data?.integrations?.fiscal },
    { name: "API TMS", detail: "API externa própria para clientes e parceiros", value: data?.integrations?.api },
  ];
  return (
    <section className="tms-panel">
      <div className="tms-panel-head"><div><span>Conectividade</span><h2>Integrações do TMS</h2></div></div>
      <div className="tms-integration-list">
        {rows.map((row) => (
          <div key={row.name}>
            <div className="tms-integration-icon"><Cable size={19} /></div>
            <span><strong>{row.name}</strong><small>{row.detail}</small></span>
            <StatusPill value={row.value?.status || "configurar"} />
          </div>
        ))}
      </div>
      <div className="tms-api-note">
        <div>
          <strong>API TMS externa ativa</strong>
          <p>Clientes e parceiros podem criar shipments, consultar cargas, enviar tracking/POD e consultar CT-e, MDF-e, CIOT e faturamento sem entrar no ERP. A autenticação usa chaves próprias `tdg_live_`, com isolamento por cliente e escopo.</p>
        </div>
      </div>
      <ApiManager api={data?.integrations?.api} onReload={onReload} />
    </section>
  );
}

export default function TmsPortal() {
  const [section, setSection] = useState(pathSection);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadTmsPortalData());
      setError("");
    } catch (reason) {
      setError(reason?.message || "Não foi possível abrir o Portal TMS.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onPopState = () => setSection(pathSection());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next) => {
    const valid = SECTIONS.some((item) => item.id === next) ? next : "controle";
    window.history.pushState({}, "", valid === "controle" ? "/portal-tms" : `/portal-tms/${valid}`);
    setSection(valid);
  }, []);

  const active = useMemo(() => SECTIONS.find((item) => item.id === section) || SECTIONS[0], [section]);
  let content;
  if (section === "controle") content = <ControlTower data={data} onSection={navigate} />;
  if (section === "cargas") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Entrada operacional</span><h2>Cargas e ordens de serviço</h2></div></div><OrdersTable rows={data?.recent?.orders} /></section>;
  if (section === "fracionada") content = <FractionalCargo />;
  if (section === "roteirizacao") content = <ElectricRouting rows={data?.recent?.operations} />;
  if (section === "viagens") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Execução</span><h2>Viagens e movimentações</h2></div></div><OperationsTable rows={data?.recent?.operations} /></section>;
  if (section === "fiscal") content = <div className="tms-stack"><section className="tms-panel"><div className="tms-panel-head"><div><span>Documentos fiscais</span><h2>CT-e e MDF-e</h2></div></div><FiscalTable rows={data?.recent?.fiscal} /></section><section className="tms-panel"><div className="tms-panel-head"><div><span>ANTT</span><h2>CIOT</h2></div></div><CiotTable rows={data?.recent?.ciots} /></section></div>;
  if (section === "faturamento") content = <section className="tms-panel"><div className="tms-panel-head"><div><span>Receita operacional</span><h2>Faturamento</h2></div></div><div className="tms-billing-highlight"><CircleDollarSign size={30} /><div><strong>{data?.indicators?.billingPending || 0} item(ns) elegível(is)</strong><p>A OS concluída com POD entra na régua de faturamento já existente na Vertical. O TMS mantém o vínculo entre execução, documento fiscal e cobrança.</p></div></div></section>;
  if (section === "integracoes") content = <Integrations data={data} onReload={load} />;

  return (
    <div className="tms-portal">
      <aside className="tms-sidebar">
        <div className="tms-brand"><div className="tms-brand-mark">TDG</div><div><strong>TO DO GREEN</strong><span>Transportation Management</span></div></div>
        <nav aria-label="Navegação do TMS">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="tms-sidebar-foot"><Activity size={16} /><span>Portal operacional separado do ERP</span></div>
      </aside>
      <main className="tms-main">
        <header className="tms-topbar">
          <div><span>PORTAL TMS</span><h1>{active.label}</h1></div>
          <button type="button" className="tms-refresh" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Atualizando" : "Atualizar"}</button>
        </header>
        {error ? <div className="tms-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        {loading && !data ? <div className="tms-loading"><RefreshCw size={22} className="spin" /><span>Carregando torre de controle...</span></div> : content}
      </main>
    </div>
  );
}
