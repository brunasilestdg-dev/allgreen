import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Plus, ReceiptText, Split } from "lucide-react";
import "./TransactionalSpinePage.css";
import { comRotulo } from "../rotulosDomain.js";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const today = () => new Date().toISOString().slice(0, 10);
const apiPath = "/api/todogreen/transactions";
const statusLabel = { draft: "Rascunho", ready: "Pronto", sending: "Enviando", issued: "Emitido", failed: "Falha", contingency: "Contingência", released: "Liberada", in_progress: "Em execução", completed: "Concluída", cancelled: "Cancelada", eligible: "Elegível", checked: "Conferido", blocked: "Bloqueado", billed: "Faturado", open: "Em aberto", partial: "Parcial", settled: "Liquidado", overdue: "Vencido" };
const nextStatus = { draft: "released", released: "in_progress", in_progress: "completed" };
const nextLabel = { draft: "Aceitar viagem", released: "Enviar à operação", in_progress: "Concluir execução" };

const request = async (path, authHeaders, options = {}) => {
  const response = await fetch(`${apiPath}/${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
};

const clientName = (clients, id) => clients.find((item) => item.id === id)?.name || clients.find((item) => item.id === id)?.nome || id || "Sem cliente";
const contractName = (contracts, id) => contracts.find((item) => item.id === id)?.titulo || contracts.find((item) => item.id === id)?.title || id || "Sem contrato";

function Empty({ children }) { return <div className="tdg-txn-empty">{children}</div>; }
function Status({ value }) { return <span className={`tdg-txn-status ${value}`}>{comRotulo(statusLabel, value)}</span>; }

function ServiceOrders({ authHeaders, clients, contracts, operations, setToast }) {
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ clientId: "", contractId: "", operationId: "", quantity: "", chargeUnit: "entrega", unitPrice: "", discountAmount: "0", taxAmount: "0", scheduledStartAt: "", scheduledEndAt: "" });
  const load = useCallback(() => request("service-orders", authHeaders).then((data) => setRecords(data.records || [])).catch((error) => setToast?.(error.message)), [authHeaders, setToast]);
  useEffect(() => { load(); }, [load]);
  const eligibleContracts = contracts.filter((item) => (!form.clientId || (item.clientId || item.clienteId) === form.clientId) && (item.status === "active" || item.status === "ativo") && (item.aprovacao === "approved" || item.approvalStatus === "approved") && (item.assinatura === "signed" || item.signatureStatus === "signed"));
  const create = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await request("service-orders", authHeaders, { method: "POST", body: JSON.stringify({ ...form, quantity: Number(form.quantity), unitPrice: Number(form.unitPrice), discountAmount: Number(form.discountAmount), taxAmount: Number(form.taxAmount) }) });
      setToast?.("Ordem de serviço criada"); setForm((value) => ({ ...value, quantity: "", unitPrice: "" })); await load();
    } catch (error) { setToast?.(error.message); } finally { setSaving(false); }
  };
  const transition = async (record) => {
    const status = nextStatus[record.status]; if (!status) return;
    try { await request(`service-orders/${record.id}/transition`, authHeaders, { method: "POST", body: JSON.stringify({ status, revision: record.revision }) }); setToast?.(status === "completed" ? "OS concluída: item liberado para a fila de faturamento" : "Ordem atualizada"); await load(); } catch (error) { setToast?.(error.message); if (String(error.message).includes("comprovante")) setPodFor(record.id); }
  };
  // Registro do comprovante de entrega (POD): sem ele, a régua de faturamento
  // recusa a conclusão da OS. Recebedor OU link do arquivo — um dos dois basta.
  const [podFor, setPodFor] = useState("");
  const [pod, setPod] = useState({ recipientName: "", documentUrl: "" });
  const savePod = async (event) => {
    event.preventDefault();
    try {
      await request(`service-orders/${podFor}/pod`, authHeaders, { method: "POST", body: JSON.stringify(pod) });
      setToast?.("Comprovante registrado — a OS já pode ser concluída");
      setPodFor(""); setPod({ recipientName: "", documentUrl: "" });
    } catch (error) { setToast?.(error.message); }
  };
  return <section className="tdg-panel tdg-txn-page"><div className="tdg-section-head"><div><span className="tdg-kicker">PLANEJAMENTO E PRODUTOS</span><h2>Aceite e ordens de serviço</h2><p>Planejamento/Produtos aceita a viagem e libera a OS. Operação executa depois; Financeiro entra com CT-e, documento fiscal, título e baixa.</p></div><strong>{records.length} ordem(ns)</strong></div>
    <form className="tdg-txn-form" onSubmit={create}>
      <label><span>Cliente</span><select required value={form.clientId} onChange={(e) => setForm((v) => ({ ...v, clientId: e.target.value, contractId: "" }))}><option value="">Selecione</option>{clients.map((item) => <option value={item.id} key={item.id}>{item.name || item.nome}</option>)}</select></label>
      <label><span>Contrato aprovado e assinado</span><select required value={form.contractId} onChange={(e) => setForm((v) => ({ ...v, contractId: e.target.value }))}><option value="">Selecione</option>{eligibleContracts.map((item) => <option value={item.id} key={item.id}>{item.titulo || item.title || item.id}</option>)}</select><small>{form.clientId && !eligibleContracts.length ? "Nenhum contrato elegível para este cliente." : ""}</small></label>
      <label><span>Operação vinculada</span><select value={form.operationId} onChange={(e) => setForm((v) => ({ ...v, operationId: e.target.value }))}><option value="">Vincular depois</option>{operations.filter((item) => !form.clientId || (item.clientId || item.clienteId) === form.clientId).map((item) => <option value={item.id} key={item.id}>{item.referencia || item.reference || item.id}</option>)}</select></label>
      <label><span>Quantidade</span><input required type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => setForm((v) => ({ ...v, quantity: e.target.value }))} /></label>
      <label><span>Unidade de cobrança</span><input required value={form.chargeUnit} onChange={(e) => setForm((v) => ({ ...v, chargeUnit: e.target.value }))} /></label>
      <label><span>Preço unitário</span><input required type="number" min="0.01" step="0.01" value={form.unitPrice} onChange={(e) => setForm((v) => ({ ...v, unitPrice: e.target.value }))} /></label>
      <label><span>Início programado</span><input type="datetime-local" value={form.scheduledStartAt} onChange={(e) => setForm((v) => ({ ...v, scheduledStartAt: e.target.value }))} /></label>
      <label><span>Fim programado</span><input type="datetime-local" value={form.scheduledEndAt} onChange={(e) => setForm((v) => ({ ...v, scheduledEndAt: e.target.value }))} /></label>
      <button className="tdg-action" disabled={saving || !eligibleContracts.length}><Plus size={17} />Criar OS para aceite</button>
    </form>
    <div className="tdg-txn-list">{!records.length && <Empty>Nenhuma ordem de serviço criada.</Empty>}{records.map((record) => <article className="tdg-txn-row" key={record.id}><span><strong>{record.number}</strong><small>{clientName(clients, record.clientId)} · {contractName(contracts, record.contractId)}</small></span><span><small>Valor líquido</small><strong>{BRL.format(record.netAmount || 0)}</strong></span><Status value={record.status} />{record.status === "in_progress" && <button type="button" onClick={() => { setPodFor(record.id); setPod({ recipientName: "", documentUrl: "" }); }}>Registrar comprovante</button>}{nextStatus[record.status] && <button type="button" onClick={() => transition(record)}>{nextLabel[record.status]}<ArrowRight size={14} /></button>}</article>)}</div>
    {podFor && <form className="tdg-txn-form" onSubmit={savePod}>
      <label><span>Quem recebeu a carga</span><input value={pod.recipientName} onChange={(e) => setPod((v) => ({ ...v, recipientName: e.target.value }))} placeholder="Nome do recebedor" /></label>
      <label><span>Link do comprovante (canhoto/foto)</span><input value={pod.documentUrl} onChange={(e) => setPod((v) => ({ ...v, documentUrl: e.target.value }))} placeholder="https://..." /></label>
      <button className="tdg-action" type="submit"><CheckCircle2 size={17} />Registrar POD</button>
      <button type="button" onClick={() => setPodFor("")}>Cancelar</button>
    </form>}
  </section>;
}

function Billing({ authHeaders, clients, setToast }) {
  const [records, setRecords] = useState([]); const [selected, setSelected] = useState([]); const [dueDate, setDueDate] = useState(today()); const [documentType, setDocumentType] = useState("cte");
  const load = useCallback(async () => { try { const parts = await Promise.all(["eligible", "checked", "blocked"].map((status) => request(`billing-items?status=${status}`, authHeaders))); setRecords(parts.flatMap((item) => item.records || [])); } catch (error) { setToast?.(error.message); } }, [authHeaders, setToast]);
  useEffect(() => { load(); }, [load]);
  const check = async (item, approved) => { try { await request(`billing-items/${item.id}/check`, authHeaders, { method: "POST", body: JSON.stringify({ approved, reason: approved ? "" : "Bloqueado na conferência", revision: item.revision }) }); await load(); } catch (error) { setToast?.(error.message); } };
  const close = async () => { try { const result = await request("billing-runs", authHeaders, { method: "POST", body: JSON.stringify({ itemIds: selected, dueDate, competenceDate: today(), documentType }) }); setToast?.(`${result.documentType.toUpperCase()} emitido: ${result.invoiceNumber} · título ${result.titleNumber}`); setSelected([]); await load(); } catch (error) { setToast?.(error.message); } };
  const checked = records.filter((item) => item.status === "checked");
  return <section className="tdg-panel tdg-txn-page"><div className="tdg-section-head"><div><span className="tdg-kicker">OPERAÇÃO → CT-E → TÍTULO</span><h2>Fila de faturamento</h2><p>Somente OS concluída entra no Financeiro. A conferência fiscal fecha CT-e/documento, faturamento e conta a receber.</p></div><strong>{records.length} item(ns)</strong></div>
    {checked.length > 0 && <div className="tdg-txn-close"><label><span>Documento fiscal</span><select value={documentType} onChange={(e) => setDocumentType(e.target.value)}><option value="cte">CT-e</option><option value="nfse">NFS-e</option><option value="nfe">NF-e</option></select></label><label><span>Vencimento do título</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><button className="tdg-action" type="button" disabled={!selected.length} onClick={close}><ReceiptText size={17} />Emitir e fechar {selected.length} item(ns)</button></div>}
      <div className="tdg-txn-list">{!records.length && <Empty>Nenhuma OS concluída aguardando faturamento.</Empty>}{records.map((item) => <article className="tdg-txn-row" key={item.id}>{item.status === "checked" && <input aria-label={`Selecionar ${item.service_order_number}`} type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected((list) => e.target.checked ? [...list, item.id] : list.filter((id) => id !== item.id))} />}<span><strong>{item.service_order_number}</strong><small>{clientName(clients, item.client_id)} · competência {item.competence_date}</small></span><span><small>Faturável</small><strong>{BRL.format(item.amount || 0)}</strong></span><Status value={item.status} />{item.status !== "checked" && <span className="tdg-txn-actions"><button type="button" onClick={() => check(item, true)}>Conferir fiscal</button><button type="button" onClick={() => check(item, false)}>Bloquear</button></span>}</article>)}</div>
  </section>;
}

function Ciot({ authHeaders, clients, contracts, operations, setToast }) {
  const [integration, setIntegration] = useState(null);
  const [regulatoryProfile, setRegulatoryProfile] = useState(null);
  const [integrationForm, setIntegrationForm] = useState({
    environment: "homologation",
    certificateType: "A1",
    certificateEnvKey: "TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX",
    certificatePasswordEnvKey: "TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD",
    a3ConnectorEnvKey: "TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL",
    connectorUrlEnvKey: "TODOGREEN_ANTT_CIOT_CONNECTOR_URL",
    connectorTokenEnvKey: "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN",
    baseUrl: "",
  });
  const [orders, setOrders] = useState([]);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState("");
  const [issuing, setIssuing] = useState(null);
  const [issueForm, setIssueForm] = useState({ ciotCode: "", protocol: "" });
  const [certificateFile, setCertificateFile] = useState(null);
  const [certificatePassword, setCertificatePassword] = useState("");
  const [connectorForm, setConnectorForm] = useState({ connectorUrl: "", connectorToken: "" });
  const [credentialSaving, setCredentialSaving] = useState(false);
  const [form, setForm] = useState({
    serviceOrderId: "", operationType: "carga_lotacao", responsibleType: "etc",
    contractorDocument: "", carrierDocument: "", rntrc: "", driverDocument: "", vehiclePlate: "",
    originCity: "", originState: "", destinationCity: "", destinationState: "", cargoDescription: "",
    freightAmount: "", floorAmount: "", startsAt: "", endsAt: "", contingencyReason: "",
  });
  const load = useCallback(async () => {
    try {
      const [setup, serviceOrders, ciots] = await Promise.all([request("ciot-integration", authHeaders), request("service-orders", authHeaders), request("ciot", authHeaders)]);
      const nextIntegration = setup.integration || null;
      setIntegration(nextIntegration);
      setRegulatoryProfile(setup.regulatoryProfile || null);
      if (setup.regulatoryProfile) setForm((current) => ({
        ...current,
        carrierDocument: current.carrierDocument || setup.regulatoryProfile.document || "",
        rntrc: current.rntrc || setup.regulatoryProfile.rntrc || "",
      }));
      if (nextIntegration) setIntegrationForm({
        environment: nextIntegration.environment || "homologation",
        certificateType: nextIntegration.certificateType || "A1",
        certificateEnvKey: nextIntegration.certificateEnvKey || "TODOGREEN_ANTT_CIOT_CERTIFICATE_PFX",
        certificatePasswordEnvKey: nextIntegration.certificatePasswordEnvKey || "TODOGREEN_ANTT_CIOT_CERTIFICATE_PASSWORD",
        a3ConnectorEnvKey: nextIntegration.a3ConnectorEnvKey || "TODOGREEN_ANTT_CIOT_A3_CONNECTOR_URL",
        connectorUrlEnvKey: nextIntegration.connectorUrlEnvKey || "TODOGREEN_ANTT_CIOT_CONNECTOR_URL",
        connectorTokenEnvKey: nextIntegration.connectorTokenEnvKey || "TODOGREEN_ANTT_CIOT_CONNECTOR_TOKEN",
        baseUrl: nextIntegration.baseUrl || "",
      });
      setOrders(serviceOrders.records || []);
      setRecords(ciots.records || []);
    } catch (error) { setToast?.(error.message); }
  }, [authHeaders, setToast]);
  useEffect(() => { load(); }, [load]);
  const selectedOrder = orders.find((item) => item.id === form.serviceOrderId);
  const selectedContract = contracts.find((item) => item.id === selectedOrder?.contractId);
  const selectedOperation = operations.find((item) => item.id === selectedOrder?.operationId);
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const changeIntegration = (key, value) => setIntegrationForm((current) => ({ ...current, [key]: value }));
  const saveIntegration = async (event) => {
    event.preventDefault();
    try {
      const data = await request("ciot-integration", authHeaders, { method: "POST", body: JSON.stringify({ ...integrationForm, revision: integration?.revision }) });
      setIntegration(data.integration);
      setToast?.(data.integration?.configured ? "Integração direta ANTT pronta" : "Configuração salva; falta base URL, conector ou certificado no ambiente");
    } catch (error) { setToast?.(error.message); }
  };
  const saveCredential = async (event) => {
    event.preventDefault(); setCredentialSaving(true);
    try {
      let body;
      if (integrationForm.certificateType === "A1") {
        if (!certificateFile) throw new Error("Selecione o arquivo .pfx ou .p12.");
        const pfxBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error("Não foi possível ler o certificado.")); reader.readAsDataURL(certificateFile); });
        body = { certificateType: "A1", filename: certificateFile.name, pfxBase64, password: certificatePassword, ...connectorForm };
      } else body = { certificateType: "A3", ...connectorForm };
      const data = await request("ciot-certificate", authHeaders, { method: "POST", body: JSON.stringify(body) });
      setIntegration(data.integration); setCertificatePassword(""); setToast?.(integrationForm.certificateType === "A1" ? "Certificado A1 protegido no cofre CIOT" : "Conector A3 protegido e configurado");
    } catch (error) { setToast?.(error.message); } finally { setCredentialSaving(false); }
  };
  const testCredential = async () => { try { const data = await request("ciot-certificate/test", authHeaders, { method: "POST", body: "{}" }); setToast?.(data.message); } catch (error) { setToast?.(error.message); } };
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      const body = { ...form, fields: { rntrc: form.rntrc }, environment: integrationForm.environment, certificateType: integrationForm.certificateType, operationId: selectedOrder?.operationId || "", freightAmount: Number(form.freightAmount || selectedOrder?.netAmount || 0), floorAmount: Number(form.floorAmount || 0) };
      await request("ciot", authHeaders, { method: "POST", body: JSON.stringify(body) });
      setToast?.(body.contingencyReason ? "CIOT registrado em contingência" : "CIOT preparado para emissão");
      setForm((current) => ({ ...current, floorAmount: "", contingencyReason: "" }));
      await load();
    } catch (error) { setToast?.(error.message); } finally { setSaving(false); }
  };
  const issue = async (event) => {
    event.preventDefault();
    try {
      await request(`ciot/${issuing.id}/issue`, authHeaders, { method: "POST", body: JSON.stringify({ ...issueForm, revision: issuing.revision }) });
      setToast?.("Código CIOT registrado");
      setIssuing(null); setIssueForm({ ciotCode: "", protocol: "" }); await load();
    } catch (error) { setToast?.(error.message); }
  };
  const submit = async (record) => {
    setSubmitting(record.id);
    try {
      const data = await request(`ciot/${record.id}/submit`, authHeaders, { method: "POST", body: JSON.stringify({ revision: record.revision }) });
      setToast?.(`CIOT emitido: ${data.record?.ciotCode || "retorno ANTT registrado"}`);
      await load();
    } catch (error) {
      setToast?.(error.message);
      await load();
    } finally {
      setSubmitting("");
    }
  };
  const readiness = [
    ["Base ANTT", Boolean(integration?.baseUrl), integration?.baseUrl || "Pendente"],
    ["Conector direto", Boolean(integration?.connectorConfigured), integration?.connectorConfigured ? "Configurado" : "Pendente"],
    ["Certificado ICP-Brasil", Boolean(integration?.certificateConfigured), integration?.credentialFilename || (integration?.certificateConfigured ? "Configurado" : "Pendente")],
  ];
  return <section className="tdg-panel tdg-txn-page"><div className="tdg-section-head"><div><span className="tdg-kicker">ANTT · API DIRETA · CIOT</span><h2>Geração e controle de CIOT</h2><p>Integração direta para ETC/frota própria sem IPEF: certificado ICP-Brasil A1/A3, payload regulatório, piso mínimo e retorno do código governamental de 12 dígitos.</p></div><strong>{records.length} CIOT(s)</strong></div>
    <form className="tdg-txn-form" onSubmit={saveIntegration}>
      <label><span>Modo</span><input value="Integração direta ANTT sem IPEF" readOnly /></label>
      <label><span>Ambiente</span><select value={integrationForm.environment} onChange={(e) => changeIntegration("environment", e.target.value)}><option value="homologation">Homologação</option><option value="production">Produção</option></select></label>
      <label><span>Certificado ICP-Brasil</span><select value={integrationForm.certificateType} onChange={(e) => changeIntegration("certificateType", e.target.value)}><option value="A1">A1 em segredo do Worker</option><option value="A3">A3 via conector local seguro</option></select></label>
      <label><span>Base URL ANTT</span><input value={integrationForm.baseUrl} onChange={(e) => changeIntegration("baseUrl", e.target.value)} placeholder="URL da API conforme DCS" /></label>
      {integrationForm.certificateType === "A1" ? <>
        <label><span>Env do PFX A1</span><input value={integrationForm.certificateEnvKey} onChange={(e) => changeIntegration("certificateEnvKey", e.target.value)} /></label>
        <label><span>Env da senha A1</span><input value={integrationForm.certificatePasswordEnvKey} onChange={(e) => changeIntegration("certificatePasswordEnvKey", e.target.value)} /></label>
      </> : <label><span>Env do conector A3</span><input value={integrationForm.a3ConnectorEnvKey} onChange={(e) => changeIntegration("a3ConnectorEnvKey", e.target.value)} /></label>}
      <label><span>Env do conector direto</span><input value={integrationForm.connectorUrlEnvKey} onChange={(e) => changeIntegration("connectorUrlEnvKey", e.target.value)} /></label>
      <label><span>Env do token do conector</span><input value={integrationForm.connectorTokenEnvKey} onChange={(e) => changeIntegration("connectorTokenEnvKey", e.target.value)} /></label>
      <button className="tdg-action"><CheckCircle2 size={17} />Salvar integração direta</button>
    </form>
    <form className="tdg-txn-form" onSubmit={saveCredential}>
      <div className="tdg-txn-form-intro"><strong>{integrationForm.certificateType === "A1" ? "Certificado A1" : "Dispositivo A3"}</strong><small>{integrationForm.certificateType === "A1" ? "O arquivo e a senha são criptografados antes de serem gravados. A senha não volta para a tela." : "Informe o endereço HTTPS do conector instalado no computador ligado ao token/cartão e à leitora."}</small></div>
      {integrationForm.certificateType === "A1" ? <>
        <label><span>Arquivo .pfx ou .p12</span><input required type="file" accept=".pfx,.p12,application/x-pkcs12" onChange={(e) => setCertificateFile(e.target.files?.[0] || null)} /></label>
        <label><span>Senha do certificado</span><input required type="password" autoComplete="new-password" value={certificatePassword} onChange={(e) => setCertificatePassword(e.target.value)} /></label>
      </> : null}
      <label><span>URL HTTPS do conector {integrationForm.certificateType}</span><input required type="url" value={connectorForm.connectorUrl} onChange={(e) => setConnectorForm((v) => ({ ...v, connectorUrl: e.target.value }))} placeholder="https://conector.todogreen.com.br/ciot" /></label>
      <label><span>Token do conector</span><input type="password" autoComplete="new-password" value={connectorForm.connectorToken} onChange={(e) => setConnectorForm((v) => ({ ...v, connectorToken: e.target.value }))} /></label>
      <button className="tdg-action" disabled={credentialSaving}><CheckCircle2 size={17} />{credentialSaving ? "Protegendo..." : integrationForm.certificateType === "A1" ? "Enviar certificado A1" : "Salvar conector A3"}</button>
      {integration?.credentialUploadedAt && <button type="button" onClick={testCredential}>Testar credencial</button>}
    </form>
    <div className="tdg-txn-readiness">
      {readiness.map(([label, ok, value]) => <article className={ok ? "ready" : "pending"} key={label}><CheckCircle2 size={16} /><span><strong>{label}</strong><small>{value}</small></span></article>)}
    </div>
    {regulatoryProfile && <div className="tdg-txn-readiness regulatory"><article className="ready"><CheckCircle2 size={16} /><span><strong>{regulatoryProfile.tradeName}</strong><small>CNPJ {regulatoryProfile.document} · RNTRC {regulatoryProfile.rntrc} · {regulatoryProfile.vehicles?.length || 0} veículos</small></span></article></div>}
    <form className="tdg-txn-form" onSubmit={save}>
      <label><span>OS vinculada</span><select value={form.serviceOrderId} onChange={(e) => { const order = orders.find((item) => item.id === e.target.value); setForm((v) => ({ ...v, serviceOrderId: e.target.value, freightAmount: order?.netAmount ? String(order.netAmount) : v.freightAmount, startsAt: order?.scheduledStartAt || v.startsAt, endsAt: order?.scheduledEndAt || v.endsAt })); }}><option value="">Sem OS</option>{orders.map((item) => <option value={item.id} key={item.id}>{item.number} · {clientName(clients, item.clientId)}</option>)}</select><small>{selectedContract ? `Contrato: ${selectedContract.titulo || selectedContract.title || selectedContract.id}` : ""}</small></label>
      <label><span>Tipo de operação</span><select value={form.operationType} onChange={(e) => change("operationType", e.target.value)}><option value="carga_lotacao">Carga lotação</option><option value="carga_fracionada">Carga fracionada</option><option value="tac_agregado">TAC agregado</option></select></label>
      <label><span>Responsável</span><select value={form.responsibleType} onChange={(e) => change("responsibleType", e.target.value)}><option value="etc">ETC própria</option><option value="tac">TAC/TAC equiparado via pagamento</option><option value="subcontratada">ETC subcontratada</option></select></label>
      <label><span>CNPJ contratante</span><input value={form.contractorDocument} onChange={(e) => change("contractorDocument", e.target.value)} /></label>
      <label><span>CNPJ/CPF transportador</span><input value={form.carrierDocument} onChange={(e) => change("carrierDocument", e.target.value)} /></label>
      <label><span>RNTRC transportador</span><input value={form.rntrc} onChange={(e) => change("rntrc", e.target.value)} /></label>
      <label><span>CPF motorista</span><input value={form.driverDocument} onChange={(e) => change("driverDocument", e.target.value)} /></label>
      <label><span>Placa veículo</span><input list="tdg-ciot-vehicles" value={form.vehiclePlate} onChange={(e) => change("vehiclePlate", e.target.value.toUpperCase())} placeholder={selectedOperation?.vehiclePlate || ""} /><datalist id="tdg-ciot-vehicles">{regulatoryProfile?.vehicles?.map((plate) => <option value={plate} key={plate} />)}</datalist></label>
      <label><span>Origem</span><input value={form.originCity} onChange={(e) => change("originCity", e.target.value)} placeholder="Cidade" /></label>
      <label><span>UF origem</span><input maxLength={2} value={form.originState} onChange={(e) => change("originState", e.target.value.toUpperCase())} /></label>
      <label><span>Destino</span><input value={form.destinationCity} onChange={(e) => change("destinationCity", e.target.value)} placeholder="Cidade" /></label>
      <label><span>UF destino</span><input maxLength={2} value={form.destinationState} onChange={(e) => change("destinationState", e.target.value.toUpperCase())} /></label>
      <label><span>Carga</span><input value={form.cargoDescription} onChange={(e) => change("cargoDescription", e.target.value)} /></label>
      <label><span>Frete declarado</span><input required type="number" min="0.01" step="0.01" value={form.freightAmount} onChange={(e) => change("freightAmount", e.target.value)} /></label>
      <label><span>Piso mínimo calculado</span><input type="number" min="0" step="0.01" value={form.floorAmount} onChange={(e) => change("floorAmount", e.target.value)} /></label>
      <label><span>Início previsto</span><input type="datetime-local" value={form.startsAt} onChange={(e) => change("startsAt", e.target.value)} /></label>
      <label><span>Fim previsto</span><input type="datetime-local" value={form.endsAt} onChange={(e) => change("endsAt", e.target.value)} /></label>
      <label><span>Contingência</span><input value={form.contingencyReason} onChange={(e) => change("contingencyReason", e.target.value)} placeholder="Preencher só se ANTT estiver indisponível" /></label>
      <button className="tdg-action" disabled={saving}><ReceiptText size={17} />Preparar envio direto</button>
    </form>
    <div className="tdg-txn-list">{!records.length && <Empty>Nenhum CIOT preparado.</Empty>}{records.map((record) => <article className="tdg-txn-row" key={record.id}><span><strong>{record.ciotCode || record.number}</strong><small>{record.serviceOrderNumber || "sem OS"} · {record.operationType} · {record.originCity || "origem"} → {record.destinationCity || "destino"}{record.lastError ? ` · ${record.lastError}` : ""}</small></span><span><small>Frete / piso</small><strong>{BRL.format(record.freightAmount || 0)} / {BRL.format(record.floorAmount || 0)}</strong></span><Status value={record.status} />{record.status !== "issued" && <span className="tdg-txn-actions"><button type="button" disabled={submitting === record.id || record.status === "sending"} onClick={() => submit(record)}>Enviar ANTT</button><button type="button" onClick={() => { setIssuing(record); setIssueForm({ ciotCode: record.ciotCode || "", protocol: record.protocol || "" }); }}>Registrar retorno</button></span>}</article>)}</div>
    <div className="tdg-txn-note"><AlertTriangle size={16} /><span>Envio direto sem IPEF. A emissão depende de conector ativo, certificado válido e retorno ANTT com CIOT de 12 dígitos.</span></div>
    {issuing && <form className="tdg-txn-close" onSubmit={issue}><div><strong>Registrar CIOT de {issuing.number}</strong><small>Use o código de 12 dígitos retornado pela API direta da ANTT.</small></div><label><span>Código CIOT</span><input required inputMode="numeric" pattern="\\d{12}" maxLength={12} value={issueForm.ciotCode} onChange={(e) => setIssueForm((v) => ({ ...v, ciotCode: e.target.value.replace(/\D/g, "").slice(0, 12) }))} /></label><label><span>Protocolo</span><input value={issueForm.protocol} onChange={(e) => setIssueForm((v) => ({ ...v, protocol: e.target.value }))} /></label><button className="tdg-action"><CheckCircle2 size={17} />Confirmar</button><button type="button" onClick={() => setIssuing(null)}>Cancelar</button></form>}
  </section>;
}

function Titles({ authHeaders, clients, setToast }) {
  const [records, setRecords] = useState([]); const [paying, setPaying] = useState(null); const [amount, setAmount] = useState("");
  const load = useCallback(() => request("titles", authHeaders).then((data) => setRecords(data.records || [])).catch((error) => setToast?.(error.message)), [authHeaders, setToast]); useEffect(() => { load(); }, [load]);
  const settle = async (event) => { event.preventDefault(); try { await request(`titles/${paying.id}/settle`, authHeaders, { method: "POST", body: JSON.stringify({ amount: Number(amount), settledAt: new Date().toISOString(), method: "pix" }) }); setToast?.("Baixa registrada"); setPaying(null); await load(); } catch (error) { setToast?.(error.message); } };
  const openTotal = useMemo(() => records.reduce((sum, item) => sum + Number(item.open_amount || 0), 0), [records]);
  return <section className="tdg-panel tdg-txn-page"><div className="tdg-section-head"><div><span className="tdg-kicker">RECEBÍVEIS E CONCILIAÇÃO</span><h2>Títulos e baixas</h2><p>Competência, vencimento, parcela, origem fiscal/documental e saldo real em um único razão.</p></div><strong>{BRL.format(openTotal)} em aberto</strong></div><div className="tdg-txn-list">{!records.length && <Empty>Nenhum título financeiro.</Empty>}{records.map((item) => <article className="tdg-txn-row" key={item.id}><span><strong>{item.number}</strong><small>{item.kind === "receivable" ? clientName(clients, item.client_id) : item.supplier_id || "Fornecedor"} · vence {item.due_date}</small></span><span><small>Saldo</small><strong>{BRL.format(item.open_amount || 0)}</strong></span><Status value={item.status} />{["open", "partial", "overdue"].includes(item.status) && <button type="button" onClick={() => { setPaying(item); setAmount(String(item.open_amount)); }}>Dar baixa</button>}</article>)}</div>
    {paying && <form className="tdg-txn-close" onSubmit={settle}><div><strong>Baixa de {paying.number}</strong><small>Saldo atual {BRL.format(paying.open_amount)}</small></div><label><span>Valor</span><input required type="number" min="0.01" max={paying.open_amount} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><button className="tdg-action"><CircleDollarSign size={17} />Confirmar baixa</button><button type="button" onClick={() => setPaying(null)}>Cancelar</button></form>}
  </section>;
}

const allocationEmpty = () => ({ serviceOrderId: "", operationId: "", clientId: "", contractId: "", vehicleId: "", supplierId: "", costCenterId: "", amount: "" });
function Costs({ authHeaders, clients, contracts, operations, setToast }) {
  const [records, setRecords] = useState([]); const [saving, setSaving] = useState(false); const [form, setForm] = useState({ description: "", amount: "", competenceDate: today(), supplierId: "", documentNumber: "", allocations: [allocationEmpty()] });
  const load = useCallback(() => request("costs", authHeaders).then((data) => setRecords(data.records || [])).catch(() => setRecords([])), [authHeaders]); useEffect(() => { load(); }, [load]);
  const allocated = form.allocations.reduce((sum, item) => sum + Number(item.amount || 0), 0); const remaining = Number(form.amount || 0) - allocated;
  const changeAllocation = (index, key, value) => setForm((current) => ({ ...current, allocations: current.allocations.map((item, position) => position === index ? { ...item, [key]: value } : item) }));
  const save = async (event) => { event.preventDefault(); setSaving(true); try { await request("costs", authHeaders, { method: "POST", body: JSON.stringify({ ...form, amount: Number(form.amount), allocations: form.allocations.map((item) => ({ ...item, amount: Number(item.amount) })) }) }); setToast?.("Custo e rateios registrados"); setForm({ description: "", amount: "", competenceDate: today(), supplierId: "", documentNumber: "", allocations: [allocationEmpty()] }); await load(); } catch (error) { setToast?.(error.message); } finally { setSaving(false); } };
  return <section className="tdg-panel tdg-txn-page"><div className="tdg-section-head"><div><span className="tdg-kicker">CUSTO MULTIDIMENSIONAL</span><h2>Rateio de custos</h2><p>Um custo pode ser distribuído entre OS, operação, cliente, contrato, veículo, fornecedor e centro de custo.</p></div><strong>{records.length} custo(s)</strong></div>
    <form className="tdg-txn-cost" onSubmit={save}><div className="tdg-txn-form"><label><span>Descrição</span><input required value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} /></label><label><span>Valor total</span><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm((v) => ({ ...v, amount: e.target.value }))} /></label><label><span>Competência</span><input required type="date" value={form.competenceDate} onChange={(e) => setForm((v) => ({ ...v, competenceDate: e.target.value }))} /></label><label><span>Documento</span><input value={form.documentNumber} onChange={(e) => setForm((v) => ({ ...v, documentNumber: e.target.value }))} /></label></div>
      <div className="tdg-txn-allocation-head"><strong>Distribuição</strong><span className={Math.abs(remaining) < .01 ? "balanced" : ""}>Restante: {BRL.format(remaining)}</span></div>
      {form.allocations.map((item, index) => <div className="tdg-txn-allocation" key={index}><label><span>Valor</span><input required type="number" min="0.01" step="0.01" value={item.amount} onChange={(e) => changeAllocation(index, "amount", e.target.value)} /></label><label><span>Cliente</span><select value={item.clientId} onChange={(e) => changeAllocation(index, "clientId", e.target.value)}><option value="">Sem vínculo</option>{clients.map((x) => <option value={x.id} key={x.id}>{x.name || x.nome}</option>)}</select></label><label><span>Contrato</span><select value={item.contractId} onChange={(e) => changeAllocation(index, "contractId", e.target.value)}><option value="">Sem vínculo</option>{contracts.map((x) => <option value={x.id} key={x.id}>{x.titulo || x.title || x.id}</option>)}</select></label><label><span>Operação</span><select value={item.operationId} onChange={(e) => changeAllocation(index, "operationId", e.target.value)}><option value="">Sem vínculo</option>{operations.map((x) => <option value={x.id} key={x.id}>{x.referencia || x.reference || x.id}</option>)}</select></label><label><span>OS</span><input value={item.serviceOrderId} onChange={(e) => changeAllocation(index, "serviceOrderId", e.target.value)} placeholder="ID da OS" /></label><label><span>Veículo</span><input value={item.vehicleId} onChange={(e) => changeAllocation(index, "vehicleId", e.target.value)} /></label><label><span>Fornecedor</span><input value={item.supplierId} onChange={(e) => changeAllocation(index, "supplierId", e.target.value)} /></label><label><span>Centro de custo</span><input value={item.costCenterId} onChange={(e) => changeAllocation(index, "costCenterId", e.target.value)} /></label>{form.allocations.length > 1 && <button type="button" onClick={() => setForm((v) => ({ ...v, allocations: v.allocations.filter((_, position) => position !== index) }))}>Remover</button>}</div>)}
      <div className="tdg-txn-form-actions"><button type="button" onClick={() => setForm((v) => ({ ...v, allocations: [...v.allocations, allocationEmpty()] }))}><Plus size={16} />Adicionar rateio</button><button className="tdg-action" disabled={saving || Math.abs(remaining) >= .01}><Split size={17} />Salvar custo rateado</button></div>
    </form>
    <div className="tdg-txn-list">{!records.length && <Empty>Nenhum custo rateado registrado.</Empty>}{records.map((item) => <article className="tdg-txn-row" key={item.id}><span><strong>{item.description}</strong><small>{item.document_number || "sem documento"} · {item.allocations?.length || 0} dimensão(ões)</small></span><span><small>Valor</small><strong>{BRL.format(item.amount || 0)}</strong></span><CheckCircle2 size={18} /></article>)}</div>
  </section>;
}

export default function TransactionalSpinePage({ mode, authHeaders, clients = [], contracts = [], operations = [], setToast }) {
  if (mode === "service-orders") return <ServiceOrders {...{ authHeaders, clients, contracts, operations, setToast }} />;
  if (mode === "ciot") return <Ciot {...{ authHeaders, clients, contracts, operations, setToast }} />;
  if (mode === "billing") return <Billing {...{ authHeaders, clients, setToast }} />;
  if (mode === "titles") return <Titles {...{ authHeaders, clients, setToast }} />;
  return <Costs {...{ authHeaders, clients, contracts, operations, setToast }} />;
}
