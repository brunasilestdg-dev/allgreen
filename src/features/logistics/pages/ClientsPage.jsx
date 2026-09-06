import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CircleDollarSign,
  Edit3,
  Eye,
  Filter,
  Globe2,
  LayoutGrid,
  List,
  ListPlus,
  Plus,
  Search,
  Target,
  Trash2,
  Upload,
  ExternalLink,
  Mail,
  MessageCircle,
  RefreshCw,
  Send,
  UserSearch,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { SegmentedControl, Tabs } from "../../../design-system/index.js";
import TopScrollRow from "./TopScrollRow.jsx";
import ComentariosPanel from "./ComentariosPanel.jsx";
import InteracoesPanel from "./InteracoesPanel.jsx";
import SaudeDaContaPanel from "./SaudeDaContaPanel.jsx";
import AccountWorkOverview from "../AccountWorkOverview.jsx";
import EnviarApresentacao from "../EnviarApresentacao.jsx";
import { contextoDeMercado, detectarApresentacaoEnviada, ASSUNTO_APRESENTACAO_ENVIADA } from "../apresentacaoComercialDomain.js";
import { accountWorkTasks, suggestionContext } from "../accountWorkDomain.js";
import { interacoesVisiveis } from "../interacoesDomain.js";
import { ESTAGIOS_OPORTUNIDADE, estagioValido } from "../opportunityIntelligenceDomain.js";
import { inboxUrl } from "../../../session/telemetria.js";
import RelationshipMap from "../RelationshipMap.jsx";
import {
  TODO_GREEN_ACCOUNT_STAGES,
  TODO_GREEN_ACCOUNT_TEMPERATURES,
  TODO_GREEN_ACCOUNT_TIERS,
  TODO_GREEN_RELATIONSHIP_ROLES,
  alertaPrincipal,
  buildCrmCommandCenter,
  buildAccountIntelligence,
  calculatePortfolioPotential,
  crmAccountSummary,
  explicarSaudeDaConta,
  normalizeRelationshipRole,
} from "../todoGreenCrmDomain.js";
import { assessAccount, gmailComposeUrl, outlookComposeUrl, whatsappUrl } from "../accountIntelligenceDomain.js";
import { resumoContaConectada } from "../contaConectadaDomain.js";
import { parseCrmImportFile } from "../crmSpreadsheetImportDomain.js";
import { LOGISTICS_PRODUCTS } from "../logisticsVerticalDomain.js";
import "./TodoGreenPages.css";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

// Valor compacto em reais para o funil: R$ 4,55 MM, R$ 320 mil, R$ 0.
const BRL_COMPACTO = (valor) => {
  const n = Number(valor) || 0;
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MM`;
  if (Math.abs(n) >= 1_000) return `R$ ${Math.round(n / 1_000).toLocaleString("pt-BR")} mil`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
};

// Data legível (AAAA-MM-DD ou ISO) sem quebrar quando o valor falta.
const dataBR = (valor) => {
  if (!valor) return "Não informada";
  const d = new Date(valor.length <= 10 ? `${valor}T00:00:00` : valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("pt-BR");
};

// Liberação e gestão do acesso ao portal do cliente. O endpoint de liberar
// (PUT) existia sem NENHUMA tela que o chamasse: cliente novo só entrava no
// portal por migração de banco. Aqui a liderança liga o portal, convida por
// e-mail e vê quem já está dentro.
function PortalAccessPanel({ client, canManage, authHeaders, onToggle, setToast }) {
  const [usuarios, setUsuarios] = useState([]);
  const [novoEmail, setNovoEmail] = useState("");
  const [novoPapel, setNovoPapel] = useState("cliente_gestor");
  const [ocupado, setOcupado] = useState(false);

  const clientId = client?.id || "";
  const portalLigado = Boolean(client?.portalEnabled);
  const carregarUsuarios = () => {
    if (!canManage || !portalLigado || !clientId) { setUsuarios([]); return; }
    api(`clients/${encodeURIComponent(clientId)}/portal-usuarios`, authHeaders)
      .then((dados) => setUsuarios(dados.usuarios || []))
      .catch(() => setUsuarios([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { carregarUsuarios(); }, [clientId, portalLigado, canManage]);

  const convidar = async (event) => {
    event.preventDefault();
    setOcupado(true);
    try {
      const resultado = await api("clients", authHeaders, {
        method: "PUT",
        body: JSON.stringify({ clienteId: client.id, email: novoEmail, papel: novoPapel }),
      });
      setToast?.(resultado.conviteEnviado
        ? `Acesso liberado e convite enviado para ${resultado.email}`
        : resultado.emailConfigurado
          ? `Acesso liberado para ${resultado.email} — o convite não pôde ser enviado, avise a pessoa`
          : `Acesso liberado para ${resultado.email}. E-mail de convite desativado (sem BREVO_API_KEY) — envie o link do portal por fora.`);
      setNovoEmail("");
      carregarUsuarios();
    } catch (motivo) { setToast?.(motivo.message); } finally { setOcupado(false); }
  };

  const remover = async (email) => {
    setOcupado(true);
    try {
      await api(`clients?cliente=${encodeURIComponent(client.id)}&email=${encodeURIComponent(email)}`, authHeaders, { method: "DELETE" });
      setToast?.(`Acesso de ${email} removido`);
      carregarUsuarios();
    } catch (motivo) { setToast?.(motivo.message); } finally { setOcupado(false); }
  };

  return (
    <div className="tdg-portal-access">
      <span>
        {client.portalEnabled ? "Liberado" : "Bloqueado"}
        {canManage && (
          <button type="button" disabled={ocupado} onClick={onToggle}>
            {client.portalEnabled ? "Bloquear portal" : "Liberar portal"}
          </button>
        )}
      </span>
      {client.portalEnabled && canManage && (
        <>
          <ul className="tdg-portal-users">
            {usuarios.map((usuario) => (
              <li key={usuario.email}>
                <span>{usuario.email} <small>{usuario.papel} · {usuario.status}</small></span>
                <button type="button" aria-label={`Remover ${usuario.email}`} disabled={ocupado} onClick={() => remover(usuario.email)}><X size={12} /></button>
              </li>
            ))}
            {!usuarios.length && <li><small>Ninguém tem acesso ainda — convide a primeira pessoa.</small></li>}
          </ul>
          <form className="tdg-crm-assign" onSubmit={convidar}>
            <input required type="email" aria-label="E-mail da pessoa do cliente" placeholder="pessoa@cliente.com" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} />
            <select aria-label="Papel no portal" value={novoPapel} onChange={(e) => setNovoPapel(e.target.value)}>
              <option value="cliente_admin">Administrador</option>
              <option value="cliente_gestor">Gestor</option>
              <option value="cliente_leitor">Leitura</option>
            </select>
            <button type="submit" disabled={ocupado}><UserPlus size={14} />Convidar</button>
          </form>
        </>
      )}
    </div>
  );
}

const api = async (path, authHeaders, options = {}) => {
  const result = await fetch(`/api/todogreen/${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
};

const trustedCrmContact = (contact) => {
  if (contact?.active === false || contact?.employmentStatus === "former") return false;
  const source = String(contact?.source || "").trim().toLowerCase();
  if (!source.startsWith("pesquisa web")) return true;
  return contact?.verifiedBrazil === true && contact?.currentEmploymentVerified === true &&
    Number(contact?.researchVersion || 0) >= 9 && String(contact?.country || "").toLowerCase() === "brasil";
};

const accountInteractionMatches = (interaction, client, contacts) => {
  const digits = (value) => String(value || "").replace(/\D/g, "");
  const normalized = (value) => String(value || "").trim().toLowerCase();
  if (client?.id && interaction?.contactId === client.id) return true;
  if (normalized(interaction?.contactName) === normalized(client?.name)) return true;
  return (contacts || []).some((contact) => {
    if (contact.id && interaction?.contactId === contact.id) return true;
    const handle = normalized(interaction?.contactHandle);
    if (contact.email && handle === normalized(contact.email)) return true;
    const phone = digits(contact.phone);
    const interactionPhone = digits(interaction?.contactHandle);
    if (phone && interactionPhone && phone.slice(-8) === interactionPhone.slice(-8)) return true;
    return contact.name && normalized(interaction?.contactName) === normalized(contact.name);
  });
};

const accountFromClient = (client) => ({
  ...(client.crm || {}),
  id: client.id,
  legalName: client.legalName,
  tradeName: client.name,
  document: client.document,
  segment: client.segment,
  status: client.status,
  notes: client.notes,
  revision: client.revision,
  ownerId: client.vendedores?.[0]?.email || "",
  contacts: (client.crm?.contacts || []).filter(trustedCrmContact),
});

const opportunityForCrm = (item) => ({
  ...item,
  accountId: item.clientId,
  stage: item.estagio,
  value: Number(item.valorContrato || 0) || Number(item.valorMensal || 0) * Number(item.mesesContrato || 12),
  probability: item.probabilidade,
});

const formatCheckedAt = (value) => value ? new Date(value).toLocaleString("pt-BR") : "Ainda não pesquisado";

const ENGLISH_WORDS = /\b(the|and|with|from|for|across|we|our|their|this|that|company|manager|procurement|supply|chain|transportation|distribution|reports|growth|emissions|business|opportunity|available|current|global|senior|experience|responsible|leading|services|solutions|customers|market|team|role|operations)\b/gi;
const PORTUGUESE_WORDS = /\b(o|a|os|as|um|uma|de|do|da|dos|das|no|na|nos|nas|em|com|para|por|empresa|compras|logística|transporte|transportes|emissões|crescimento|operação|fornecedor|fornecedores|sustentabilidade|resultados|notícias|amplia|brasil|brasileira|brasileiro)\b/gi;
const sourceHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "fonte externa"; } };
const isPortugueseSource = (item) => {
  const text = `${item?.title || ""} ${item?.snippet || ""}`;
  const english = text.match(ENGLISH_WORDS)?.length || 0;
  const portuguese = text.match(PORTUGUESE_WORDS)?.length || 0;
  if (english >= 2 && english > portuguese) return false;
  return portuguese >= 2 || (portuguese >= 1 && /[áàâãéêíóôõúç]|\.br\b/i.test(text));
};

function ResearchLinks({ title, items = [], empty, onDiscard }) {
  return <div className="tdg-crm-research-group"><span>{title}</span>{items.length
    ? <ul>{items.map((item) => { const portuguese = isPortugueseSource(item); return <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{portuguese ? item.title : `Fonte pública · ${sourceHost(item.url)}`}</a>{item.snippet && <small>{portuguese ? item.snippet : "Fonte mantida apenas para conferência. Conteúdo em outro idioma não é reproduzido na ficha."}</small>}{item.validation && <em>{item.validation}</em>}{onDiscard && <button type="button" className="tdg-crm-research-remove" onClick={() => onDiscard(item.url)} title="Remover esta informação; ela não volta nas próximas pesquisas">Remover</button>}</li>; })}</ul>
    : <small>{empty}</small>}</div>;
}

function AccountSource({ url, evidence }) {
  const sourceUrl = evidence?.sourceUrl || url;
  return sourceUrl ? <small><a href={sourceUrl} target="_blank" rel="noreferrer">Ver fonte <ExternalLink size={11} /></a>{evidence?.checkedAt ? ` · ${formatCheckedAt(evidence.checkedAt)}` : ""}{evidence?.confidence ? ` · confiança ${evidence.confidence}` : ""}</small> : null;
}

function ExternalIntelligence({ report, researching, error, onResearch, watch, onToggleWatch, onDiscard, onToggleAction }) {
  return <section className="tdg-crm-web-intelligence">
    <header><div><strong>Inteligência externa</strong><small>{formatCheckedAt(report?.checkedAt)}{watch?.enabled ? ` · monitoramento diário ativo` : ""}</small></div><div><button type="button" onClick={() => onToggleWatch?.(!watch?.enabled)} disabled={researching}>{watch?.enabled ? "Pausar monitoramento" : "Monitorar diariamente"}</button><button type="button" onClick={() => onResearch?.("company")} disabled={researching}><RefreshCw size={14} className={researching ? "spin" : ""} />{researching ? "Pesquisando..." : report ? "Atualizar web" : "Pesquisar empresa"}</button></div></header>
    {error && <p className="tdg-crm-research-error">{error}</p>}
    {!report && !error && <p>A IA ainda não pesquisou esta empresa na web. A busca verifica site, LinkedIn, ESG, fornecedores, RFQs, procurement e notícias.</p>}
    {report && <>
      <div className="tdg-crm-research-identity">{report.officialWebsite && <a href={report.officialWebsite.url} target="_blank" rel="noreferrer">Site provável <ExternalLink size={13} /></a>}{report.linkedinCompany && <a href={report.linkedinCompany.url} target="_blank" rel="noreferrer">LinkedIn da empresa <ExternalLink size={13} /></a>}<b>ESG: {report.esg?.relevance || "A validar"}</b></div>
      <ResearchLinks title="RFQs de transporte abertas" items={report.openRfqs} onDiscard={onDiscard} empty="Nenhuma RFQ acionável comprovada nesta pesquisa." />
      <ResearchLinks title="Cadastro de fornecedores" items={report.supplierLinks} onDiscard={onDiscard} empty="Nenhum portal oficial identificado." />
      <ResearchLinks title="Procurement de Logística e Transportes no Brasil" items={report.procurementPeople} onDiscard={onDiscard} empty="Nenhum contato público passou pelos critérios de empresa, Brasil e escopo logístico." />
      <ResearchLinks title="LinkedIn dos contatos cadastrados" items={report.knownContactProfiles} onDiscard={onDiscard} empty="Nenhum LinkedIn adicional foi confirmado para os contatos já cadastrados." />
      <ResearchLinks title="Candidatos para validação" items={report.reviewCandidates} onDiscard={onDiscard} empty="Nenhum candidato pendente de validação." />
      {report.contactSearchQuality && <div className="tdg-crm-research-enrichment"><strong>Resultado da busca de contatos</strong><small>{report.contactSearchQuality.accepted || 0} com vínculo atual comprovado, {report.contactSearchQuality.formerEmploymentRejected || 0} ex-contato(s) rejeitado(s), {report.contactSearchQuality.currentEmploymentUnverified || 0} sem atualidade comprovada, {report.contactSearchQuality.candidatesForReview || 0} candidato(s) para validação, {report.contactSearchQuality.foreignRejected || 0} estrangeiro(s) e {report.contactSearchQuality.nonLogisticsRejected || 0} sem escopo logístico.</small></div>}
      {report.suggestedLegalName?.value && <div className="tdg-crm-research-enrichment"><strong>Razão social identificada: {report.suggestedLegalName.value}</strong><small>Confiança {report.suggestedLegalName.confidence}. {report.autoEnrichment?.legalNameFilled ? "Preenchida automaticamente na conta." : "A conta já possuía uma razão social e foi preservada."}</small></div>}
      {report.suggestedSegment?.value && <div className="tdg-crm-research-enrichment"><strong>Segmento identificado: {report.suggestedSegment.value}</strong><small>Confiança {report.suggestedSegment.confidence}. {report.autoEnrichment?.segmentFilled ? "Preenchido automaticamente no CRM." : "O CRM já possuía um segmento e foi preservado."}</small></div>}
      {report.suggestedHeadquarters?.value && <div className="tdg-crm-research-enrichment"><strong>Operação brasileira identificada: {report.suggestedHeadquarters.value}</strong><small>Confiança {report.suggestedHeadquarters.confidence}. {report.autoEnrichment?.headquartersFilled ? "Preenchida automaticamente na conta." : "A conta já possuía uma sede e foi preservada."}</small></div>}
      {report.autoEnrichment?.contactsAdded > 0 && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.contactsAdded} contato(s) público(s) incluído(s)</strong><small>A fonte indica vínculo atual, Brasil e escopo logístico na data da pesquisa. Revalide antes da abordagem.</small></div>}
      {report.autoEnrichment?.contactsUpdated > 0 && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.contactsUpdated} contato(s) cadastrado(s) complementado(s)</strong><small>Os dados existentes foram preservados e somente campos vazios receberam evidência pública.</small></div>}
      {report.autoEnrichment?.qualificationFilled?.length > 0 && <div className="tdg-crm-research-enrichment"><strong>Qualificação comercial complementada</strong><small>{report.autoEnrichment.qualificationFilled.join(", ")} preenchido(s) com evidências vinculadas.</small></div>}
      {(report.autoEnrichment?.websiteFilled || report.autoEnrichment?.linkedinFilled) && <div className="tdg-crm-research-enrichment"><strong>Dados institucionais preenchidos</strong><small>{[report.autoEnrichment.websiteFilled && "site", report.autoEnrichment.linkedinFilled && "LinkedIn da empresa"].filter(Boolean).join(" e ")} vinculados à conta.</small></div>}
      {(report.autoEnrichment?.websiteCorrected || report.autoEnrichment?.invalidWebsiteRemoved) && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.websiteCorrected ? "Site oficial corrigido" : "Site incorreto removido"}</strong><small>{report.autoEnrichment.websiteCorrected ? "O endereço anterior era de uma fonte externa e foi substituído pelo domínio da própria empresa." : "O endereço anterior era de uma fonte externa e nenhuma página oficial segura foi encontrada para substituí-lo."}</small></div>}
      {report.autoEnrichment?.legacyContactsRemoved > 0 && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.legacyContactsRemoved} contato(s) web sem vínculo atual removido(s)</strong><small>O CRM retirou do mapa ativo resultados antigos, ex-funcionários e perfis cuja atualidade não pôde ser comprovada.</small></div>}
      {report.autoEnrichment?.formerContactsMarkedInactive > 0 && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.formerContactsMarkedInactive} contato(s) manual(is) preservado(s) como histórico</strong><small>A fonte indica vínculo anterior. A pessoa foi retirada do mapa de decisores ativos, sem apagar o cadastro feito pela equipe.</small></div>}
      {report.autoEnrichment?.legacyContactsRetained > 0 && <div className="tdg-crm-research-enrichment"><strong>{report.autoEnrichment.legacyContactsRetained} contato(s) antigo(s) preservado(s)</strong><small>Continuam no cadastro para revisão manual, mas não contam como decisores brasileiros confirmados.</small></div>}
      <ResearchLinks title="Sinais ESG" items={report.esg?.signals} onDiscard={onDiscard} empty="Nenhuma evidência pública suficiente." />
      <ResearchLinks title="Notícias da empresa" items={report.companyNews} onDiscard={onDiscard} empty="Nenhuma notícia relevante encontrada." />
      <ResearchLinks title="Notícias e tendências do segmento" items={report.segmentNews} onDiscard={onDiscard} empty="Nenhuma notícia setorial relevante encontrada." />
      <div className="tdg-crm-research-next"><span>Próximas ações sugeridas</span>{report.nextActions?.map((item) => {
        const feitaEm = report.nextActionsDone?.[item];
        return <div className={feitaEm ? "tdg-crm-research-acao concluida" : "tdg-crm-research-acao"} key={item}>
          {onToggleAction && <button type="button" onClick={() => onToggleAction(item, Boolean(feitaEm))} aria-label={feitaEm ? "Reabrir ação" : "Concluir ação"}>{feitaEm ? "Desfazer" : "Concluir"}</button>}
          <strong>{item}</strong>
          {feitaEm && <small>concluída em {new Date(feitaEm).toLocaleDateString("pt-BR")}</small>}
        </div>;
      })}</div>
      <small className="tdg-crm-research-note">{report.disclaimer}</small>
    </>}
  </section>;
}

function ClientTaskModal({ client, suggestion, currentUserId, pessoas = [], onClose, onCreate }) {
  const [form, setForm] = useState({
    title: suggestion || `Próxima ação comercial · ${client.name}`,
    description: `Conta vinculada: ${client.name}`,
    priority: "Alta",
    due: "",
    assigneeId: currentUserId || "",
  });
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      await onCreate?.({
        id: crypto.randomUUID(), title: form.title.trim(), description: form.description.trim(),
        priority: form.priority, status: "A fazer", due: form.due, area: "Comercial",
        assigneeType: "real",
        assignee: pessoas.find((pessoa) => pessoa.id === form.assigneeId)?.name || "",
        assigneeId: form.assigneeId,
        project: "",
        isMission: false, distribution: "atribuida", difficulty: "Simples", slots: "1",
        points: "", reward: "", approvalMode: "imediata", allowWithdrawal: true,
        assignees: [], interested: [], missionStatus: "", deliveries: [], attachments: [],
        visibility: "privado", sharedWith: [], sharedTeams: [], subtasks: [], dependsOn: [],
        recurrence: { frequency: "none" }, ownerId: currentUserId || null,
        clientId: client.id, clientName: client.name, source: "todogreen-crm",
        businessId: "todogreen",
        createdAt: new Date().toISOString(),
      });
      onClose();
    } finally { setSaving(false); }
  };
  return <Modal title={`Nova tarefa · ${client.name}`} onClose={onClose}>
    <form className="tdg-crm-task-form" onSubmit={save}>
      <label><span>Tarefa</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label><span>Orientação</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <div>
        <label><span>Responsável</span><select required value={form.assigneeId} onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}><option value="">Selecione um usuário</option>{pessoas.map((pessoa) => <option value={pessoa.id} key={pessoa.id}>{pessoa.name}{pessoa.email ? ` · ${pessoa.email}` : ""}</option>)}</select></label>
        <label><span>Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option>Alta</option><option>Média</option><option>Baixa</option></select></label>
        <label><span>Prazo</span><input type="date" value={form.due} onChange={(event) => setForm({ ...form, due: event.target.value })} /></label>
      </div>
      <footer><button type="button" onClick={onClose}>Cancelar</button><button className="tdg-action" type="submit" disabled={saving}>{saving ? "Criando..." : "Criar tarefa"}</button></footer>
    </form>
  </Modal>;
}

const roleLabel = (role) => ({ cliente_admin: "Administrador do cliente", cliente_gestor: "Gestor do cliente", cliente_leitor: "Leitor" })[role] || role;

function ClientPortalPreview({ client, authHeaders, open, onClose }) {
  const [role, setRole] = useState("cliente_gestor");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !client?.id) return undefined;
    let active = true; setLoading(true); setError("");
    api(`client-portal-preview/${encodeURIComponent(client.id)}?role=${encodeURIComponent(role)}`, authHeaders)
      .then((data) => { if (active) setPreview(data); })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authHeaders, client?.id, open, role]);
  if (!open) return null;
  const summary = preview?.summary;
  return <section className="tdg-crm-portal-preview" aria-label="Prévia do portal do cliente">
    <header><div><span>VISUALIZAÇÃO ADMINISTRATIVA</span><h3>O que {client.name} vê no portal</h3><p>Prévia somente leitura. Nenhuma ação é registrada como se tivesse sido feita pelo cliente.</p></div><button type="button" onClick={onClose}><X size={15} />Fechar prévia</button></header>
    <div className="tdg-crm-portal-bar"><strong className={preview?.portal?.enabled ? "enabled" : "disabled"}>{preview?.portal?.enabled ? "Portal liberado" : "Portal ainda bloqueado"}</strong><label><span>Visualizar como</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="cliente_admin">Administrador do cliente</option><option value="cliente_gestor">Gestor do cliente</option><option value="cliente_leitor">Leitor</option></select></label><small>{preview?.users?.length || 0} acesso(s) ativo(s)</small></div>
    {loading && <p>Montando a visão do cliente...</p>}{error && <p className="tdg-crm-research-error">{error}</p>}
    {!loading && preview && <>
      <nav>{preview.portal.menu.map((item) => <span key={item.id}>{item.label}</span>)}</nav>
      <div className="tdg-crm-portal-metrics"><article><small>Operações</small><strong>{summary?.operacoes?.total || 0}</strong></article><article><small>Entregas</small><strong>{summary?.operacoes?.entregas || 0}</strong></article><article><small>CO₂ evitado</small><strong>{Number(summary?.ambiental?.co2EvitadoKg || 0).toLocaleString("pt-BR")} kg</strong></article><article><small>Green Score</small><strong>{summary?.greenScore?.valor ?? "Sem cálculo"}</strong></article></div>
      <div className="tdg-crm-portal-content"><section><header><strong>Operações recentes</strong><small>{preview.counts.operations} registro(s)</small></header>{preview.recentOperations.length ? preview.recentOperations.map((item) => <article key={item.id}><span><b>{item.reference || "Sem referência"}</b><small>{item.origin || "Origem não informada"} → {item.destination || "Destino não informado"}</small></span><strong>{item.status || "Sem status"}</strong></article>) : <p>Nenhuma operação disponível para o cliente.</p>}</section><section><header><strong>Serviços do portal</strong></header><dl><div><dt>Documentos</dt><dd>{preview.counts.documents}</dd></div><div><dt>Solicitações</dt><dd>{preview.counts.requests}</dd></div><div><dt>Papel simulado</dt><dd>{roleLabel(preview.portal.role)}</dd></div></dl>{preview.users.length > 0 && <div className="tdg-crm-portal-users"><small>Usuários liberados</small>{preview.users.map((user) => <span key={user.email}>{user.email} · {roleLabel(user.role)}</span>)}</div>}</section></div>
    </>}
  </section>;
}

function ContactCard({ contact, clientName }) {
  const details = [...new Set([contact.title, contact.department, contact.specialty, contact.country, contact.relationshipRole].filter(Boolean))];
  const whatsapp = whatsappUrl(contact.phone);
  return <article>
    <div><b>{contact.name}</b><small>{details.join(" · ") || "Função ainda não informada"}</small>{contact.source && <em className="tdg-crm-contact-source">{contact.source}{contact.currentEmploymentVerified ? ` · vínculo atual indicado em ${formatCheckedAt(contact.employmentCheckedAt)}` : " · vínculo não confirmado"}{contact.confidence ? ` · confiança ${contact.confidence}` : ""}</em>}{contact.validation && <em className="tdg-crm-contact-source">{contact.validation}</em>}{(contact.evidence?.sourceUrl || contact.sourceUrl) && <a className="tdg-crm-contact-source" href={contact.evidence?.sourceUrl || contact.sourceUrl} target="_blank" rel="noreferrer">Fonte verificada <ExternalLink size={11} /></a>}</div>
    <div className="tdg-crm-contact-channels">{contact.email && <a href={`mailto:${contact.email}`}><Mail size={13} />{contact.email}</a>}{contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}</div>
    <div className="tdg-crm-contact-actions">{whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>}{contact.email && <><a href={gmailComposeUrl(contact.email, `To Do Green · ${clientName}`)} target="_blank" rel="noreferrer">Gmail</a><a href={outlookComposeUrl(contact.email, `To Do Green · ${clientName}`)} target="_blank" rel="noreferrer">Outlook</a></>}{contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />LinkedIn</a>}</div>
  </article>;
}

const accountForm = (client) => {
  const crm = client?.crm || {};
  return {
    name: client?.name || "",
    legalName: client?.legalName || "",
    document: client?.document || "",
    segment: client?.segment || "",
    notes: client?.notes || "",
    tier: crm.tier || "Enterprise",
    temperature: crm.temperature || "",
    stage: crm.stage || "Mapeamento",
    headquarters: crm.headquarters || "",
    website: crm.website || "",
    linkedinUrl: crm.linkedinUrl || "",
    strategicPotential: crm.strategicPotential || 0,
    relationshipStrength: crm.relationshipStrength || 0,
    operationalFit: crm.operationalFit || 0,
    esgFit: crm.esgFit || 0,
    dataQuality: crm.dataQuality || 0,
    churnRisk: crm.churnRisk || 0,
    nextAction: crm.nextAction || "",
    nextActionAt: crm.nextActionAt || "",
    lastInteractionAt: crm.lastInteractionAt || "",
    contractRenewalDate: crm.contractRenewalDate || "",
    ourAnnualRevenue: crm.ourAnnualRevenue || 0,
    customerAnnualLogisticsSpend: crm.customerAnnualLogisticsSpend || 0,
    potentialAnnual: crm.potentialManual?.annual ?? crm.potentialAnnual ?? 0,
    middleMilePotential: crm.potentialManual?.products?.middleMile ?? crm.productPotential?.middleMile ?? 0,
    lastMilePotential: crm.potentialManual?.products?.lastMile ?? crm.productPotential?.lastMile ?? 0,
    dedicatedPotential: crm.potentialManual?.products?.dedicated ?? crm.productPotential?.dedicated ?? 0,
    middleMileMonthlyTrips: crm.potentialInputs?.middleMileMonthlyTrips || 0,
    middleMileAverageTicket: crm.potentialInputs?.middleMileAverageTicket || 0,
    lastMileMonthlyDeliveries: crm.potentialInputs?.lastMileMonthlyDeliveries || 0,
    lastMileAverageTicket: crm.potentialInputs?.lastMileAverageTicket || 0,
    dedicatedMonthlyVehicles: crm.potentialInputs?.dedicatedMonthlyVehicles || 0,
    dedicatedMonthlyTicket: crm.potentialInputs?.dedicatedMonthlyTicket || 0,
    geographicExpansion: crm.geographicExpansion || "",
    accountPlanObjective: crm.accountPlan?.objective || "",
    accountPlanBarriers: crm.accountPlan?.barriers || "",
    accountPlanCompetitors: crm.accountPlan?.competitors || "",
    accountPlan30: crm.accountPlan?.plan30 || "",
    accountPlan60: crm.accountPlan?.plan60 || "",
    accountPlan90: crm.accountPlan?.plan90 || "",
    contacts: crm.contacts || [],
  };
};

function AccountEditor({ client, onClose, onSave }) {
  const [form, setForm] = useState(() => accountForm(client));
  const [contact, setContact] = useState({ name: "", title: "", email: "", phone: "", linkedinUrl: "", relationshipRole: "Influenciador" });
  const [saving, setSaving] = useState(false);
  const field = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const potentialPreview = useMemo(() => calculatePortfolioPotential({
    potentialManual: {
      annual: Number(form.potentialAnnual || 0),
      products: {
        middleMile: Number(form.middleMilePotential || 0),
        lastMile: Number(form.lastMilePotential || 0),
        dedicated: Number(form.dedicatedPotential || 0),
      },
    },
    potentialInputs: {
      middleMileMonthlyTrips: Number(form.middleMileMonthlyTrips || 0),
      middleMileAverageTicket: Number(form.middleMileAverageTicket || 0),
      lastMileMonthlyDeliveries: Number(form.lastMileMonthlyDeliveries || 0),
      lastMileAverageTicket: Number(form.lastMileAverageTicket || 0),
      dedicatedMonthlyVehicles: Number(form.dedicatedMonthlyVehicles || 0),
      dedicatedMonthlyTicket: Number(form.dedicatedMonthlyTicket || 0),
    },
  }), [form]);
  const addContact = () => {
    if (!contact.name.trim()) return;
    setForm((current) => ({
      ...current,
      contacts: [...current.contacts, { ...contact, id: crypto.randomUUID(), active: true }],
    }));
    setContact({ name: "", title: "", email: "", phone: "", linkedinUrl: "", relationshipRole: "Influenciador" });
  };
  const updateContact = (id, key, value) => setForm((current) => ({
    ...current,
    contacts: current.contacts.map((item) => item.id === id ? { ...item, [key]: value } : item),
  }));
  const updateContactEmployment = (id, status) => setForm((current) => ({
    ...current,
    contacts: current.contacts.map((item) => item.id === id ? {
      ...item,
      employmentStatus: status,
      currentEmploymentVerified: status === "current",
      employmentCheckedAt: new Date().toISOString(),
      active: status !== "former",
      verifiedBrazil: status === "current" ? true : item.verifiedBrazil,
      country: status === "current" ? item.country || "Brasil" : item.country,
      researchVersion: status === "current" ? 12 : item.researchVersion,
      confidence: status === "current" ? "alta" : item.confidence,
      evidence: status === "current" ? { sourceUrl: item.sourceUrl || item.linkedinUrl || "", checkedAt: new Date().toISOString(), method: "Confirmação manual", confidence: "alta" } : item.evidence,
      validation: status === "current"
        ? "Vínculo atual confirmado manualmente no CRM."
        : status === "former"
          ? "Contato preservado como histórico; vínculo marcado manualmente como encerrado."
          : "Vínculo atual ainda não confirmado.",
    } : item),
  }));
  const removeContact = (item) => {
    if (typeof window !== "undefined" && !window.confirm(`Excluir manualmente ${item.name} do CRM? Esta ação remove os dados de contato desta conta.`)) return;
    setForm((current) => ({ ...current, contacts: current.contacts.filter((candidate) => candidate.id !== item.id) }));
  };
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const potentialInputs = {
        middleMileMonthlyTrips: Number(form.middleMileMonthlyTrips || 0),
        middleMileAverageTicket: Number(form.middleMileAverageTicket || 0),
        lastMileMonthlyDeliveries: Number(form.lastMileMonthlyDeliveries || 0),
        lastMileAverageTicket: Number(form.lastMileAverageTicket || 0),
        dedicatedMonthlyVehicles: Number(form.dedicatedMonthlyVehicles || 0),
        dedicatedMonthlyTicket: Number(form.dedicatedMonthlyTicket || 0),
      };
      const potentialManual = {
        annual: Number(form.potentialAnnual || 0),
        products: {
          middleMile: Number(form.middleMilePotential || 0),
          lastMile: Number(form.lastMilePotential || 0),
          dedicated: Number(form.dedicatedPotential || 0),
        },
      };
      const calculatedPotential = calculatePortfolioPotential({ potentialInputs, potentialManual });
      await onSave({
        name: form.name,
        legalName: form.legalName,
        document: form.document,
        segment: form.segment,
        notes: form.notes,
        revision: client.revision,
        crm: {
          ...client.crm,
          tier: form.tier,
          temperature: form.temperature,
          stage: form.stage,
          headquarters: form.headquarters,
          website: form.website,
          linkedinUrl: form.linkedinUrl,
          strategicPotential: Number(form.strategicPotential || 0),
          relationshipStrength: Number(form.relationshipStrength || 0),
          operationalFit: Number(form.operationalFit || 0),
          esgFit: Number(form.esgFit || 0),
          dataQuality: Number(form.dataQuality || 0),
          churnRisk: Number(form.churnRisk || 0),
          nextAction: form.nextAction,
          nextActionAt: form.nextActionAt,
          lastInteractionAt: form.lastInteractionAt,
          contractRenewalDate: form.contractRenewalDate,
          ourAnnualRevenue: Number(form.ourAnnualRevenue || 0),
          customerAnnualLogisticsSpend: Number(form.customerAnnualLogisticsSpend || 0),
          potentialAnnual: calculatedPotential.annual || 0,
          productPotential: {
            middleMile: calculatedPotential.middleMile || 0,
            lastMile: calculatedPotential.lastMile || 0,
            dedicated: calculatedPotential.dedicated || 0,
          },
          potentialManual,
          potentialInputs,
          potentialCalculation: {
            method: calculatedPotential.method,
            calculatedProducts: calculatedPotential.calculatedProducts,
            calculatedAt: new Date().toISOString(),
          },
          geographicExpansion: form.geographicExpansion,
          accountPlan: {
            objective: form.accountPlanObjective,
            barriers: form.accountPlanBarriers,
            competitors: form.accountPlanCompetitors,
            plan30: form.accountPlan30,
            plan60: form.accountPlan60,
            plan90: form.accountPlan90,
          },
          contacts: form.contacts,
        },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Visão 360º · ${client.name}`} onClose={onClose} wide>
      <form className="tdg-crm-editor" onSubmit={save}>
        <fieldset>
          <legend>Conta e estratégia</legend>
          <div className="tdg-crm-form-grid">
            <label><span>Nome da conta</span><input required value={form.name} onChange={field("name")} /></label>
            <label><span>Razão social</span><input value={form.legalName} onChange={field("legalName")} /></label>
            <label><span>Documento</span><input value={form.document} onChange={field("document")} /></label>
            <label><span>Segmento</span><input value={form.segment} onChange={field("segment")} /></label>
            <label><span>Classificação</span><select value={form.tier} onChange={field("tier")}>{TODO_GREEN_ACCOUNT_TIERS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Temperatura</span><select value={form.temperature} onChange={field("temperature")}><option value="">Não classificada</option>{TODO_GREEN_ACCOUNT_TEMPERATURES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Momento da conta</span><select value={form.stage} onChange={field("stage")}>{TODO_GREEN_ACCOUNT_STAGES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Sede / região</span><input value={form.headquarters} onChange={field("headquarters")} /></label>
            <label><span>Site da empresa</span><input type="url" placeholder="https://empresa.com.br" value={form.website} onChange={field("website")} /></label>
            <label><span>LinkedIn da empresa</span><input type="url" placeholder="https://linkedin.com/company/..." value={form.linkedinUrl} onChange={field("linkedinUrl")} /></label>
            <label><span>Próxima ação</span><input value={form.nextAction} onChange={field("nextAction")} /></label>
            <label><span>Prazo da próxima ação</span><input type="date" value={form.nextActionAt} onChange={field("nextActionAt")} /></label>
            <label><span>Última interação</span><input type="date" value={form.lastInteractionAt} onChange={field("lastInteractionAt")} /></label>
            <label><span>Renovação do contrato</span><input type="date" value={form.contractRenewalDate} onChange={field("contractRenewalDate")} /></label>
            <label><span>Receita anual To Do Green (R$)</span><input type="number" min="0" value={form.ourAnnualRevenue} onChange={field("ourAnnualRevenue")} /></label>
            <label><span>Gasto logístico anual do cliente (R$)</span><input type="number" min="0" value={form.customerAnnualLogisticsSpend} onChange={field("customerAnnualLogisticsSpend")} /></label>
          </div>
          <label><span>Contexto e observações</span><textarea value={form.notes} onChange={field("notes")} /></label>
        </fieldset>

        <fieldset>
          <legend>Potencial e plano da conta</legend>
          <p>O CRM calcula o potencial anual por produto. Preencha quantidade mensal e ticket médio; cada resultado usa quantidade × ticket × 12.</p>
          <div className="tdg-crm-potential-preview" aria-label="Prévia do potencial calculado">
            <span><small>Potencial anual calculado</small><strong>{potentialPreview.annual ? BRL.format(potentialPreview.annual) : "Dados insuficientes"}</strong></span>
            <small>{potentialPreview.method}</small>
          </div>
          <div className="tdg-crm-form-grid">
            <label><span>Viagens middle mile / mês</span><input type="number" min="0" value={form.middleMileMonthlyTrips} onChange={field("middleMileMonthlyTrips")} /></label>
            <label><span>Ticket médio por viagem (R$)</span><input type="number" min="0" value={form.middleMileAverageTicket} onChange={field("middleMileAverageTicket")} /></label>
            <label><span>Entregas last mile / mês</span><input type="number" min="0" value={form.lastMileMonthlyDeliveries} onChange={field("lastMileMonthlyDeliveries")} /></label>
            <label><span>Ticket médio por entrega (R$)</span><input type="number" min="0" value={form.lastMileAverageTicket} onChange={field("lastMileAverageTicket")} /></label>
            <label><span>Veículos dedicados / mês</span><input type="number" min="0" value={form.dedicatedMonthlyVehicles} onChange={field("dedicatedMonthlyVehicles")} /></label>
            <label><span>Mensalidade por veículo (R$)</span><input type="number" min="0" value={form.dedicatedMonthlyTicket} onChange={field("dedicatedMonthlyTicket")} /></label>
          </div>
          <p>Valores informados abaixo são usados apenas quando a base de cálculo do produto estiver incompleta.</p>
          <div className="tdg-crm-form-grid">
            <label><span>Potencial anual informado (R$)</span><input type="number" min="0" value={form.potentialAnnual} onChange={field("potentialAnnual")} /></label>
            <label><span>Middle mile informado (R$)</span><input type="number" min="0" value={form.middleMilePotential} onChange={field("middleMilePotential")} /></label>
            <label><span>Last mile informado (R$)</span><input type="number" min="0" value={form.lastMilePotential} onChange={field("lastMilePotential")} /></label>
            <label><span>Dedicada informada (R$)</span><input type="number" min="0" value={form.dedicatedPotential} onChange={field("dedicatedPotential")} /></label>
          </div>
          <label><span>Expansão geográfica</span><textarea value={form.geographicExpansion} onChange={field("geographicExpansion")} /></label>
          <div className="tdg-crm-form-grid">
            <label><span>Objetivo da conta</span><textarea value={form.accountPlanObjective} onChange={field("accountPlanObjective")} /></label>
            <label><span>Barreiras</span><textarea value={form.accountPlanBarriers} onChange={field("accountPlanBarriers")} /></label>
            <label><span>Concorrentes</span><textarea value={form.accountPlanCompetitors} onChange={field("accountPlanCompetitors")} /></label>
            <label><span>Plano 30 dias</span><textarea value={form.accountPlan30} onChange={field("accountPlan30")} /></label>
            <label><span>Plano 60 dias</span><textarea value={form.accountPlan60} onChange={field("accountPlan60")} /></label>
            <label><span>Plano 90 dias</span><textarea value={form.accountPlan90} onChange={field("accountPlan90")} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Score da conta</legend>
          <p>Registre a leitura da equipe. O painel separa potencial, aderência e risco para não esconder uma conta frágil atrás de um único número.</p>
          <div className="tdg-crm-score-inputs">
            {[
              ["strategicPotential", "Potencial estratégico"],
              ["relationshipStrength", "Força do relacionamento"],
              ["operationalFit", "Aderência operacional"],
              ["esgFit", "Aderência ESG"],
              ["dataQuality", "Qualidade dos dados"],
              ["churnRisk", "Risco comercial"],
            ].map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" max="100" value={form[key]} onChange={field(key)} /></label>)}
          </div>
        </fieldset>

        <fieldset>
          <legend>Mapa de relacionamento</legend>
          <div className="tdg-crm-contact-form">
            <input aria-label="Nome do contato" placeholder="Nome" value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} />
            <input aria-label="Cargo do contato" placeholder="Cargo" value={contact.title} onChange={(event) => setContact({ ...contact, title: event.target.value })} />
            <select aria-label="Papel no relacionamento" value={contact.relationshipRole} onChange={(event) => setContact({ ...contact, relationshipRole: event.target.value })}>{TODO_GREEN_RELATIONSHIP_ROLES.map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="E-mail do contato" type="email" placeholder="E-mail" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} />
            <input aria-label="Telefone do contato" placeholder="Telefone" value={contact.phone} onChange={(event) => setContact({ ...contact, phone: event.target.value })} />
            <input aria-label="LinkedIn do contato" type="url" placeholder="https://linkedin.com/in/..." value={contact.linkedinUrl} onChange={(event) => setContact({ ...contact, linkedinUrl: event.target.value })} />
            <button type="button" onClick={addContact}><UserPlus size={15} />Adicionar</button>
          </div>
          <div className="tdg-crm-contact-list">
            {form.contacts.length === 0 && <p>Nenhum contato mapeado. Comece pelo patrocinador e pelos decisores econômico e técnico.</p>}
            {form.contacts.map((item) => <article className="tdg-crm-contact-editor-row" key={item.id}>
              <header><strong>{item.name}</strong><small>{item.source || "Cadastro manual"}{item.email || item.phone ? " · dados preservados até exclusão manual" : ""}</small></header>
              <div className="tdg-crm-contact-editor-grid">
                <label><span>Nome</span><input value={item.name || ""} onChange={(event) => updateContact(item.id, "name", event.target.value)} /></label>
                <label><span>Cargo</span><input value={item.title || ""} onChange={(event) => updateContact(item.id, "title", event.target.value)} /></label>
                <label><span>Papel</span><select value={normalizeRelationshipRole(item.relationshipRole) || "Influenciador"} onChange={(event) => updateContact(item.id, "relationshipRole", event.target.value)}>{TODO_GREEN_RELATIONSHIP_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label>
                <label><span>E-mail</span><input type="email" value={item.email || ""} onChange={(event) => updateContact(item.id, "email", event.target.value)} /></label>
                <label><span>Telefone</span><input value={item.phone || ""} onChange={(event) => updateContact(item.id, "phone", event.target.value)} /></label>
                <label><span>LinkedIn</span><input type="url" placeholder="https://linkedin.com/in/..." value={item.linkedinUrl || ""} onChange={(event) => updateContact(item.id, "linkedinUrl", event.target.value)} /></label>
                <label><span>Situação do vínculo</span><select value={item.employmentStatus || "unknown"} onChange={(event) => updateContactEmployment(item.id, event.target.value)}><option value="unknown">Não confirmado</option><option value="current">Atual confirmado</option><option value="former">Histórico / saiu da empresa</option></select></label>
              </div>
              <button className="tdg-crm-contact-delete" type="button" aria-label={`Excluir ${item.name}`} onClick={() => removeContact(item)}><Trash2 size={14} />Excluir manualmente</button>
            </article>)}
          </div>
        </fieldset>
        <footer><button type="button" onClick={onClose}>Cancelar</button><button className="tdg-action" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar visão 360º"}</button></footer>
      </form>
    </Modal>
  );
}

const clientIdFromLocation = () => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("client") || "";
const contatoVazio = () => ({ name: "", title: "", email: "", phone: "", linkedinUrl: "", relationshipRole: "Influenciador" });

export default function ClientsPage({ authHeaders, opportunities = [], contracts = [], operations = [], financial = [], tasks = [], comments = [], onComment, interactions = [], onInteraction, onNavigate, setToast, onCreateTask, onCompletarTarefa, currentUserId, remetenteNome = "", assinaturaEmail = "", espacoId = "", onClientContextChange }) {
  const [clients, setClients] = useState([]);
  const [pessoas, setPessoas] = useState([]);
  const [access, setAccess] = useState({ podeGerenciar: false, podeEditar: true, somenteCarteira: true });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [quickFilter, setQuickFilter] = useState("all");
  const [temperatureFilter, setTemperatureFilter] = useState("all");
  const [contactFilter, setContactFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "cards";
    const stored = window.localStorage.getItem("todogreen-crm-view");
    return ["cards", "table", "kanban", "funil"].includes(stored) ? stored : "cards";
  });
  // O kanban tem dois formatos (pedido da titular, 30/08): o SIMPLIFICADO do
  // mockup aprovado — etapa, total em R$ e cartão nome+valor — e o detalhado,
  // que continua a um clique. O simplificado é o padrão.
  const [kanbanMode, setKanbanMode] = useState(() => {
    if (typeof window === "undefined") return "simples";
    return window.localStorage.getItem("todogreen-crm-kanban-mode") === "detalhado" ? "detalhado" : "simples";
  });
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(clientIdFromLocation);
  const [editingId, setEditingId] = useState("");
  const [taskClientId, setTaskClientId] = useState("");
  const [deletingClientId, setDeletingClientId] = useState("");
  // Valor de temperatura sendo salvo pelo seletor inline: enquanto salva, o
  // <select> mostra este valor (otimista) e fica desabilitado — senão ele
  // reverte ao valor antigo durante o PATCH+recarga e uma segunda troca com a
  // revisão velha tomaria 409, perdendo a escolha.
  const [salvandoTemperatura, setSalvandoTemperatura] = useState(null);
  const [completingSuggestion, setCompletingSuggestion] = useState(false);
  const [apresentacaoAberta, setApresentacaoAberta] = useState(false);
  const [portalPreviewOpen, setPortalPreviewOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("summary");
  const [accountInteractions, setAccountInteractions] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [interactionFormRequest, setInteractionFormRequest] = useState(0);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState("");
  const [researchReports, setResearchReports] = useState({});
  const [researchWatches, setResearchWatches] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [clientForm, setClientForm] = useState({ nome: "", observacoes: "", documento: "", segmento: "", tier: "", stage: "" });
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [quickContact, setQuickContact] = useState(contatoVazio);
  const [assignment, setAssignment] = useState({ clientId: "", sellerEmail: "", note: "" });
  const [importProgress, setImportProgress] = useState("");
  // "Novo contato" direto da lista, sem abrir a conta antes: o campo Conta
  // sugere as contas cadastradas e o contato nasce vinculado à conta real.
  const [novoContatoAberto, setNovoContatoAberto] = useState(false);
  const [novoContatoGlobal, setNovoContatoGlobal] = useState(() => ({ conta: "", ...contatoVazio() }));

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await api("clients", authHeaders);
      const loaded = data.clientes || [];
      setClients(loaded); setAccess(data.acesso || access);
      setSelectedId((current) => loaded.some((item) => item.id === current)
        ? current
        : loaded.some((item) => item.id === clientIdFromLocation()) ? clientIdFromLocation() : "");
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    let ativo = true;
    // Duas portas de "gente do espaço" — as MESMAS que o servidor aceita como
    // responsável: colaboradores do app (memberships, via /api/collab) E
    // vínculos diretos da vertical (tenant_users, via /planner/pessoas). Antes
    // só a primeira era listada — quem foi cadastrado na vertical existia e era
    // aceito, mas não aparecia para atribuir. Unimos as duas por id.
    const juntar = (listas) => {
      const unicos = [];
      const vistos = new Set();
      for (const pessoa of listas.flat()) {
        if (pessoa?.id && pessoa?.name && !vistos.has(pessoa.id)) {
          vistos.add(pessoa.id);
          unicos.push({ id: pessoa.id, name: pessoa.name, email: pessoa.email || "" });
        }
      }
      return unicos;
    };
    const daVertical = fetch("/api/todogreen/planner/pessoas", { headers: authHeaders?.() || {} })
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo) => corpo?.registros || [])
      .catch(() => []);
    const doCollab = espacoId
      ? fetch(`/api/collab?owner=${encodeURIComponent(espacoId)}`, { headers: authHeaders?.() || {} })
        .then((resposta) => (resposta.ok ? resposta.json() : null))
        .then((corpo) => (corpo ? [corpo.owner, ...(corpo.members || []).filter((m) => m.status === "ativo")] : []))
        .catch(() => [])
      : Promise.resolve([]);
    Promise.all([daVertical, doCollab]).then(([vertical, collab]) => {
      if (!ativo) return;
      setPessoas(juntar([vertical, collab]));
    });
    return () => { ativo = false; };
  }, [authHeaders, espacoId]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => { setSelectedId(clientIdFromLocation()); setPortalPreviewOpen(false); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("todogreen-crm-view", viewMode);
  }, [viewMode]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("todogreen-crm-kanban-mode", kanbanMode);
  }, [kanbanMode]);

  const accounts = useMemo(() => clients.map(accountFromClient), [clients]);
  const crmOpportunities = useMemo(() => opportunities.map(opportunityForCrm), [opportunities]);
  const command = useMemo(() => buildCrmCommandCenter(accounts, crmOpportunities), [accounts, crmOpportunities]);
  const summaryById = useMemo(() => new Map(command.accounts.map((item) => [item.id, item])), [command]);
  // Para quais clientes a apresentação já foi enviada, e quando (a mais recente).
  // Deriva do registro que o próprio envio cria — dá o "já mandei pra esse".
  const apresentacaoPorCliente = useMemo(() => {
    const mapa = {};
    for (const i of interactions) {
      const cid = i?.clientId;
      if (!cid) continue;
      const ehApres = i.assunto === ASSUNTO_APRESENTACAO_ENVIADA
        || /apresenta[çc][aã]o.*enviad/i.test(String(i.assunto || ""))
        || /apresenta[çc][aã]o comercial.*enviad/i.test(String(i.ata || ""));
      if (!ehApres) continue;
      const data = String(i.ocorridaEm || i.criadoEm || "");
      if (!mapa[cid] || data > mapa[cid]) mapa[cid] = data;
    }
    return mapa;
  }, [interactions]);
  const dataBr = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : "");
  const stageOptions = useMemo(() => [...new Set(clients.map((client) => client.crm?.stage).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [clients]);
  const ownerOptions = useMemo(() => [...new Set(clients.flatMap((client) => (client.vendedores || []).map((seller) => seller.email)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [clients]);
  const visible = useMemo(() => clients.filter((client) => {
    const summary = summaryById.get(client.id);
    const contactText = (client.crm?.contacts || []).map((contact) => `${contact.name || ""} ${contact.title || ""} ${contact.department || ""} ${contact.email || ""} ${contact.phone || ""}`).join(" ");
    const ownerText = (client.vendedores || []).map((seller) => seller.email).join(" ");
    const matchesQuery = `${client.accountCode || ""} ${client.id || ""} ${client.name} ${client.legalName || ""} ${client.document || ""} ${client.segment || ""} ${client.crm?.stage || ""} ${contactText} ${ownerText}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || summary?.attention === filter || (filter === "no-decision" && summary?.coverage < 60);
    const hoje = new Date().toLocaleDateString("sv-SE");
    const matchesQuickFilter = quickFilter === "all" || (quickFilter === "overdue" && client.crm?.nextActionAt && client.crm.nextActionAt < hoje);
    const matchesTemperature = temperatureFilter === "all" || client.crm?.temperature === temperatureFilter;
    const hasContact = (client.crm?.contacts || []).some((contact) => contact.active !== false && (contact.email || contact.phone));
    const matchesContact = contactFilter === "all" || (contactFilter === "with" ? hasContact : !hasContact);
    const matchesStage = stageFilter === "all" || client.crm?.stage === stageFilter;
    const matchesOwner = ownerFilter === "all" || (ownerFilter === "unassigned"
      ? !(client.vendedores || []).length
      : (client.vendedores || []).some((seller) => seller.email === ownerFilter));
    return matchesQuery && matchesFilter && matchesQuickFilter && matchesTemperature && matchesContact && matchesStage && matchesOwner;
  }).sort((a, b) => {
    if (sortBy === "name-desc") return String(b.name).localeCompare(String(a.name), "pt-BR", { sensitivity: "base" });
    if (sortBy === "temperature") {
      const rank = { Quente: 0, Morno: 1, Frio: 2 };
      return (rank[a.crm?.temperature] ?? 3) - (rank[b.crm?.temperature] ?? 3) || String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });
    }
    if (sortBy === "next-action") return String(a.crm?.nextActionAt || "9999").localeCompare(String(b.crm?.nextActionAt || "9999")) || String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });
    if (sortBy === "updated") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });
    if (sortBy === "contacts") return (b.crm?.contacts?.length || 0) - (a.crm?.contacts?.length || 0) || String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });
    return String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });
  }), [clients, contactFilter, filter, ownerFilter, query, quickFilter, sortBy, stageFilter, summaryById, temperatureFilter]);
  const renderedClients = visible.slice(0, visibleLimit);
  const kanbanColumns = useMemo(() => {
    const stages = [
      ...TODO_GREEN_ACCOUNT_STAGES,
      ...stageOptions.filter((stage) => !TODO_GREEN_ACCOUNT_STAGES.includes(stage)),
    ];
    return (stageFilter === "all" ? stages : stages.filter((stage) => stage === stageFilter))
      .map((stage) => {
        const accounts = renderedClients.filter((client) => (client.crm?.stage || "Mapeamento") === stage);
        return {
          stage,
          accounts,
          pipeline: accounts.reduce((sum, client) => sum + (summaryById.get(client.id)?.pipeline || 0), 0),
        };
      });
  }, [renderedClients, stageFilter, stageOptions, summaryById]);
  const selected = clients.find((client) => client.id === selectedId) || null;
  const selectedAccount = useMemo(() => selected ? accountFromClient(selected) : null, [selected]);
  const selectedOpportunities = useMemo(() => selected ? crmOpportunities.filter((item) => item.clientId === selected.id) : [], [selected, crmOpportunities]);
  // Ficha comercial do cliente: contrato (produto, tabela, datas, reajuste),
  // primeira coleta (das operações) e um histórico único de tudo que aconteceu.
  const comercial = useMemo(() => {
    if (!selected) return null;
    const nomeProduto = (id) => {
      if (!id) return "";
      const achado = LOGISTICS_PRODUCTS.find((p) => p.id === id || p.code === id || p.name === id);
      return achado ? achado.name : id;
    };
    const contratos = (contracts || []).filter((c) => c.clientId === selected.id);
    const ativo = contratos.find((c) => (c.situacao || "").toLowerCase() === "active" || (c.situacao || "").toLowerCase() === "ativo")
      || [...contratos].sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")))[0]
      || null;
    const ops = (operations || []).filter((o) => o.clientId === selected.id);
    const datasColeta = ops.map((o) => o.dataServico || o.criadoEm || "").filter(Boolean).sort();
    const primeiraColeta = datasColeta[0] || "";
    const produto = ativo ? nomeProduto(ativo.servicoId) : nomeProduto(ops[0]?.produtoId);
    const dataNegociada = ativo?.assinadoEm || ativo?.aprovadoEm || ativo?.inicioEm || "";
    // Histórico único, do mais recente para o mais antigo.
    const eventos = [];
    for (const c of contratos) {
      if (c.criadoEm) eventos.push({ data: c.criadoEm, tipo: "Contrato", texto: `Contrato "${c.titulo || "sem título"}" cadastrado` });
      if (c.assinadoEm) eventos.push({ data: c.assinadoEm, tipo: "Contrato", texto: `Contrato assinado` });
      if (c.aprovadoEm) eventos.push({ data: c.aprovadoEm, tipo: "Contrato", texto: `Contrato aprovado` });
    }
    for (const o of ops) {
      const quando = o.dataServico || o.criadoEm;
      if (quando) eventos.push({ data: quando, tipo: "Operação", texto: `${o.referencia || "Operação"}${o.origem ? ` · ${o.origem} → ${o.destino || ""}` : ""}${o.situacao ? ` (${o.situacao})` : ""}` });
    }
    for (const opp of selectedOpportunities) {
      const quando = opp.atualizadoEm || opp.criadoEm;
      if (quando) eventos.push({ data: quando, tipo: "Oportunidade", texto: `${opp.stage || "Etapa"}${opp.value ? ` · ${BRL.format(opp.value)}` : ""}` });
    }
    eventos.sort((a, b) => String(b.data).localeCompare(String(a.data)));
    return { contrato: ativo, contratos, produto, dataNegociada, primeiraColeta, totalOperacoes: ops.length, eventos };
  }, [selected, contracts, operations, selectedOpportunities]);
  // Conta 360 conectada: operação em andamento, ocorrências e títulos a receber
  // lidos da mesma fonte que Operações, Ocorrências e Contas a receber usam.
  const conectada = useMemo(
    () => resumoContaConectada({ clientId: selected?.id || "", operations, financial }),
    [selected, operations, financial],
  );
  const selectedSummary = selectedAccount ? crmAccountSummary(selectedAccount, selectedAccount.contacts, crmOpportunities) : null;
  const selectedIntelligence = selected && selectedAccount
    ? assessAccount({ ...selected, crm: { ...(selected.crm || {}), contacts: selectedAccount.contacts } }, selectedOpportunities, interactions)
    : null;
  const selectedStrategy = selectedAccount
    ? buildAccountIntelligence({
        account: selectedAccount,
        contacts: selectedAccount.contacts,
        opportunities: crmOpportunities,
      })
    : null;
  const shareOfWalletMissingMessage = selectedStrategy?.shareOfWallet.status === "missing-our-revenue"
    ? "Receita anual da To Do Green ainda não informada. O CRM não calcula participação sem saber quanto esta conta já compra da To Do Green."
    : "Gasto logístico anual do cliente não informado. O CRM não estima participação sem essa base.";
  const selectedReportCandidate = selected ? researchReports[selected.id] || selected.crm?.intelligence || null : null;
  const selectedReport = Number(selectedReportCandidate?.version || 0) >= 9 ? selectedReportCandidate : null;
  const selectedWatch = selected ? researchWatches[selected.id] || null : null;
  const logisticsProcurementNames = selectedIntelligence
    ? [...new Set(selectedIntelligence.logisticsProcurementContacts.map((item) => item.name).filter(Boolean))]
    : [];
  const procurementNames = selectedIntelligence
    ? [...new Set(selectedIntelligence.procurementContacts.map((item) => item.name).filter(Boolean))]
    : [];
  const procurementSummary = logisticsProcurementNames.length
    ? logisticsProcurementNames.join(", ")
    : procurementNames.length
      ? `${procurementNames.join(", ")} (Compras cadastrado; escopo logístico a confirmar)`
      : selectedAccount?.contacts.length
        ? `${selectedAccount.contacts.length} contato(s) cadastrado(s); nenhum de Procurement logístico confirmado.`
        : "Nenhum contato cadastrado.";

  useEffect(() => {
    if (!onClientContextChange) return;
    if (!selected) { onClientContextChange(null); return; }
    onClientContextChange({
      id: selected.id,
      nome: selected.name,
      segmento: selected.segment || "",
      temperatura: selected.crm?.temperature || "",
      etapa: selected.crm?.stage || "",
      proximaAcao: selectedIntelligence?.nextTask || selected.crm?.nextAction || "",
      pesquisaExterna: selectedReport ? {
        consultadaEm: selectedReport.checkedAt,
        relevanciaEsg: selectedReport.esg?.relevance || "A validar",
        contatosProcurementLogistico: selectedReport.procurementPeople?.map((item) => ({ titulo: item.title, url: item.url })) || [],
        fontes: [selectedReport.officialWebsite, selectedReport.linkedinCompany, ...(selectedReport.companyNews || [])].filter(Boolean).slice(0, 8),
      } : null,
      contatos: selectedAccount.contacts.slice(0, 20).map((contact) => ({
        nome: contact.name, cargo: contact.title, area: contact.department,
        email: contact.email, telefone: contact.phone, linkedin: contact.linkedinUrl,
        validacao: contact.validation,
      })),
    });
  }, [onClientContextChange, selected, selectedAccount, selectedIntelligence, selectedReport]);
  useEffect(() => () => onClientContextChange?.(null), [onClientContextChange]);
  useEffect(() => {
    if (detailTab !== "intelligence" || !selected?.id) return;
    let active = true;
    api(`client-intelligence/${encodeURIComponent(selected.id)}`, authHeaders)
      .then((data) => {
        if (!active) return;
        if (data.intelligence) setResearchReports((current) => ({ ...current, [selected.id]: data.intelligence }));
        setResearchWatches((current) => ({ ...current, [selected.id]: data.watch || null }));
      })
      .catch(() => null);
    return () => { active = false; };
  }, [detailTab, selected?.id, authHeaders]);

  const openClient = (clientId) => {
    setSelectedId(clientId); setDetailTab("summary"); setAccountInteractions([]); setPortalPreviewOpen(false); setResearchError(""); setQuickContactOpen(false); setQuickContact(contatoVazio());
    onNavigate?.(`/todogreen/clientes?client=${encodeURIComponent(clientId)}`);
  };
  const closeClient = () => {
    setSelectedId(""); setDetailTab("summary"); setAccountInteractions([]); setPortalPreviewOpen(false); setResearchError(""); setQuickContactOpen(false); setQuickContact(contatoVazio());
    onNavigate?.("/todogreen/clientes");
  };
  const openDetailTab = async (tabId) => {
    setDetailTab(tabId);
    if (tabId !== "activity" || !selected) return;
    setActivityLoading(true);
    try {
      const response = await fetch(inboxUrl(), { headers: authHeaders?.() || {} });
      const payload = response.ok ? await response.json() : { items: [] };
      setAccountInteractions((payload.items || [])
        .filter((item) => accountInteractionMatches(item, selected, selectedAccount?.contacts || []))
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 50));
    } catch {
      setAccountInteractions([]);
    } finally {
      setActivityLoading(false);
    }
  };
  const researchSelected = async (focus = "company") => {
    if (!selected) return;
    setResearching(true); setResearchError("");
    try {
      // Sem `force`. Ele serve para ignorar o cache de 24 horas, e a tela o
      // mandava em TODA pesquisa — então o cache nunca valia pelo botão: cada
      // clique disparava a rodada inteira de consultas ao provedor, mesmo
      // tendo pesquisado a mesma conta minutos antes. Numa cota gratuita isso
      // se gasta rápido, e provedor sem crédito se parece exatamente com "a
      // pesquisa parou de funcionar".
      //
      // "Atualizar contatos" continua sempre indo à web: o servidor já ignora
      // o cache quando `focus` é "contacts", por desenho. Quem pede contato
      // novo quer buscar; quem abre a ficha quer ver a ficha.
      const data = await api(`client-intelligence/${encodeURIComponent(selected.id)}`, authHeaders, {
        method: "POST", body: JSON.stringify({ focus }),
      });
      setResearchReports((current) => ({ ...current, [selected.id]: data.intelligence || null }));
      if (data.client?.id) setClients((current) => current.map((client) => client.id === data.client.id ? {
        ...client,
        legalName: data.client.legalName ?? client.legalName,
        segment: data.client.segment ?? client.segment,
        revision: data.client.revision ?? client.revision,
        updatedAt: data.client.updatedAt ?? client.updatedAt,
        crm: { ...(client.crm || {}), ...(data.client.crm || {}) },
      } : client));
      await load();
      const additions = data.enrichment?.contactsAdded ? ` ${data.enrichment.contactsAdded} contato(s) incluído(s).` : "";
      const updates = data.enrichment?.contactsUpdated ? ` ${data.enrichment.contactsUpdated} contato(s) complementado(s).` : "";
      const legalName = data.enrichment?.legalNameFilled ? " Razão social preenchida." : "";
      const segment = data.enrichment?.segmentFilled ? " Segmento preenchido." : "";
      const institutional = data.enrichment?.websiteFilled || data.enrichment?.linkedinFilled ? " Site ou LinkedIn institucional preenchido." : "";
      const correctedWebsite = data.enrichment?.websiteCorrected ? " Site oficial corrigido." : data.enrichment?.invalidWebsiteRemoved ? " Site incorreto removido." : "";
      const headquarters = data.enrichment?.headquartersFilled ? " Operação brasileira preenchida." : "";
      const qualification = data.enrichment?.qualificationFilled?.length
        ? ` Qualificação preenchida: ${data.enrichment.qualificationFilled.join(", ")}.`
        : "";
      const removed = data.enrichment?.legacyContactsRemoved ? ` ${data.enrichment.legacyContactsRemoved} contato(s) descoberto(s) na web, sem vínculo atual e sem telefone/e-mail, removido(s).` : "";
      setToast?.(`${focus === "contacts" ? "Contatos de Procurement logístico no Brasil pesquisados." : "Empresa pesquisada e ficha atualizada."}${legalName}${segment}${institutional}${correctedWebsite}${headquarters}${qualification}${additions}${updates}${removed}`);
    } catch (reason) { setResearchError(reason.message); }
    finally { setResearching(false); }
  };
  const toggleResearchWatch = async (enabled) => {
    if (!selected) return;
    try {
      const data = await api(`client-intelligence/${encodeURIComponent(selected.id)}/watch`, authHeaders, {
        method: "POST", body: JSON.stringify({ enabled, frequencyHours: 24, focus: "company" }),
      });
      setResearchWatches((current) => ({ ...current, [selected.id]: data.watch || null }));
      setToast?.(enabled ? "Monitoramento diário ativado. Notícias e sinais serão atualizados automaticamente." : "Monitoramento pausado.");
    } catch (reason) { setResearchError(reason.message); }
  };
  // Edição humana sobre a pesquisa: remove item errado (definitivo — a URL
  // entra nos descartes) ou conclui/reabre uma ação sugerida. Sem busca nova.
  const editResearch = async (body, mensagem) => {
    if (!selected) return;
    try {
      const data = await api(`client-intelligence/${encodeURIComponent(selected.id)}`, authHeaders, {
        method: "POST", body: JSON.stringify(body),
      });
      setResearchReports((current) => ({ ...current, [selected.id]: data.intelligence || null }));
      if (data.revision) setClients((current) => current.map((client) => client.id === selected.id
        ? { ...client, revision: data.revision, crm: { ...(client.crm || {}), intelligence: data.intelligence } }
        : client));
      if (mensagem) setToast?.(mensagem);
    } catch (reason) { setToast?.(reason.message); }
  };
  const createTask = async (task) => {
    if (!onCreateTask) throw new Error("Não foi possível vincular a tarefa ao cliente.");
    await onCreateTask(task); setToast?.("Tarefa criada e vinculada ao cliente.");
  };
  const completeSuggestedAction = async () => {
    if (!selected || !selectedIntelligence?.nextTaskKey) return;
    const completed = [...new Set([
      ...(selected.crm?.completedSuggestedActions || []),
      selectedIntelligence.nextTaskKey,
    ])];
    setCompletingSuggestion(true);
    try {
      await api(`clients/${encodeURIComponent(selected.id)}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({
          revision: selected.revision,
          crm: { ...selected.crm, completedSuggestedActions: completed },
        }),
      });
      setClients((atuais) => atuais.map((cliente) => cliente.id === selected.id
        ? { ...cliente, crm: { ...(cliente.crm || {}), completedSuggestedActions: completed } }
        : cliente));
      setToast?.("Ação marcada como concluída. A próxima foi recalculada.");
      await load();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setCompletingSuggestion(false);
    }
  };

  const createClient = async (event) => {
    event.preventDefault(); setError("");
    try {
      await api("clients", authHeaders, { method: "POST", body: JSON.stringify({ ...clientForm, crm: { ...(clientForm.tier ? { tier: clientForm.tier } : {}), ...(clientForm.stage ? { stage: clientForm.stage } : {}) } }) });
      setClientForm({ nome: "", observacoes: "", documento: "", segmento: "", tier: "", stage: "" });
      setShowCreate(false); setToast?.("Cliente cadastrado no CRM."); await load();
    } catch (reason) { setError(reason.message); }
  };
  const deleteClient = async (client) => {
    if (!access.podeGerenciar) return;
    if (!window.confirm(`Excluir o cliente "${client.name}"? A exclusão só será permitida se não houver oportunidades, contratos ou operações ativas vinculadas.`)) return;
    setDeletingClientId(client.id);
    try {
      await api(`clients/${encodeURIComponent(client.id)}`, authHeaders, { method: "DELETE" });
      setClients((atuais) => atuais.filter((item) => item.id !== client.id));
      setSelectedId("");
      setToast?.(`Cliente "${client.name}" excluído.`);
    } catch (reason) {
      setToast?.(reason.message);
    } finally {
      setDeletingClientId("");
    }
  };
  const saveClient = async (client, payload) => {
    try {
      await api(`clients/${encodeURIComponent(client.id)}`, authHeaders, { method: "PATCH", body: JSON.stringify(payload) });
      setToast?.("Visão 360º atualizada."); await load();
    } catch (reason) { setError(reason.message); throw reason; }
  };
  // Salva a temperatura pelo seletor inline sem a corrida de revisão: mostra o
  // valor otimista e trava o seletor até o PATCH+recarga concluírem.
  const salvarTemperatura = async (client, valor) => {
    setSalvandoTemperatura(valor);
    try {
      await saveClient(client, { revision: client.revision, crm: { ...(client.crm || {}), temperature: valor } });
    } catch {
      /* saveClient já mostra o erro; libera o seletor no finally */
    } finally {
      setSalvandoTemperatura(null);
    }
  };
  const saveQuickContact = async (event) => {
    event.preventDefault();
    if (!selected) return;
    const name = quickContact.name.trim();
    if (!name) {
      setToast?.("Informe o nome do contato do cliente.");
      return;
    }
    const novoContato = {
      ...quickContact,
      id: crypto.randomUUID(),
      name,
      email: quickContact.email.trim().toLowerCase(),
      phone: quickContact.phone.trim(),
      source: "Cadastro manual",
      active: true,
    };
    try {
      await saveClient(selected, {
        revision: selected.revision,
        crm: {
          ...(selected.crm || {}),
          contacts: [...(selected.crm?.contacts || []), novoContato],
        },
      });
      setQuickContact(contatoVazio());
      setQuickContactOpen(false);
      setDetailTab("relationship");
      setToast?.("Contato do cliente registrado.");
    } catch (reason) {
      setError(reason.message);
    }
  };
  const salvarContatoGlobal = async (event) => {
    event.preventDefault();
    const nome = novoContatoGlobal.name.trim();
    const nomeDaConta = novoContatoGlobal.conta.trim();
    if (!nome) { setToast?.("Informe o nome do contato."); return; }
    // A sugestão preenche o nome exato; a gravação acontece pelo id da conta
    // encontrada — nunca por nome solto (regra da casa: vínculo é por id).
    const candidatas = clients.filter((c) => String(c.name).trim().toLowerCase() === nomeDaConta.toLowerCase());
    if (candidatas.length !== 1) {
      setToast?.(candidatas.length === 0
        ? "Escolha uma conta da lista de sugestões para vincular o contato."
        : "Há mais de uma conta com esse nome — abra a conta certa e adicione o contato por lá.");
      return;
    }
    const conta = candidatas[0];
    const { conta: _conta, ...camposDoContato } = novoContatoGlobal;
    const contato = {
      ...camposDoContato,
      id: crypto.randomUUID(),
      name: nome,
      email: novoContatoGlobal.email.trim().toLowerCase(),
      phone: novoContatoGlobal.phone.trim(),
      source: "Cadastro manual",
      active: true,
    };
    try {
      await saveClient(conta, {
        revision: conta.revision,
        crm: { ...(conta.crm || {}), contacts: [...(conta.crm?.contacts || []), contato] },
      });
      setNovoContatoGlobal({ conta: "", ...contatoVazio() });
      setNovoContatoAberto(false);
      setToast?.(`Contato registrado em ${conta.name}.`);
    } catch (reason) {
      setError(reason.message);
    }
  };
  const assign = async (event) => {
    event.preventDefault(); setError("");
    try {
      await api("client-assignments", authHeaders, { method: "PUT", body: JSON.stringify(assignment) });
      setAssignment({ clientId: "", sellerEmail: "", note: "" }); setToast?.("Carteira atualizada."); await load();
    } catch (reason) { setError(reason.message); }
  };
  const unassign = async (clientId, sellerEmail) => {
    try {
      await api(`client-assignments?clientId=${encodeURIComponent(clientId)}&sellerEmail=${encodeURIComponent(sellerEmail)}`, authHeaders, { method: "DELETE" });
      await load();
    } catch (reason) { setError(reason.message); }
  };
  const importClients = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const items = await parseCrmImportFile(file);
      for (let index = 0; index < items.length; index += 100) {
        const batch = items.slice(index, index + 100);
        setImportProgress(`Importando ${Math.min(index + batch.length, items.length)} de ${items.length} contas...`);
        await api("clients/import", authHeaders, { method: "POST", body: JSON.stringify({ clientes: batch }) });
      }
      setToast?.(`${items.length} contas importadas e atribuídas à sua carteira.`);
      await load();
    } catch (reason) {
      setError(reason instanceof SyntaxError ? "O arquivo de importação não pôde ser lido." : reason.message);
    } finally {
      setImportProgress("");
      event.target.value = "";
    }
  };

  return <section className="tdg-panel tdg-page tdg-clients-page">
    {error && <div className="tdg-page-error">{error}</div>}
    {!selected && <>
      <header className="tdg-page-title"><div><span>COMANDO COMERCIAL</span><h2>CRM e carteira 360º</h2><p>Priorize contas, acompanhe relacionamentos, forecast e próximas ações. Clique em uma conta para abrir sua visão gerencial.</p></div>{(access.podeGerenciar || access.podeEditar) && <div className="tdg-crm-admin-actions">{access.podeGerenciar && <label className="tdg-action tdg-crm-import"><Upload size={16} />{importProgress || "Importar Excel, CSV ou JSON"}<input type="file" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" disabled={Boolean(importProgress)} onChange={importClients} /></label>}{access.podeGerenciar && <button className="tdg-action" type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} />Nova conta</button>}{access.podeEditar && <button className="tdg-action" type="button" onClick={() => setNovoContatoAberto((value) => !value)}><UserPlus size={16} />Novo contato</button>}</div>}</header>
      <div className="tdg-crm-metrics" aria-label="Atalhos do resumo do CRM">
        <button type="button" className="tdg-crm-metric-card" onClick={() => { setQuery(""); setFilter("all"); setQuickFilter("all"); setTemperatureFilter("all"); setContactFilter("all"); setStageFilter("all"); setOwnerFilter("all"); setViewMode("cards"); setVisibleLimit(100); }} aria-label={`Ver todas as ${command.totalAccounts} contas da carteira`}><Building2 size={18} /><span>Contas na carteira</span><strong>{command.totalAccounts}</strong><small>Ver carteira completa</small></button>
        <button type="button" className="tdg-crm-metric-card" onClick={() => onNavigate?.("/todogreen/oportunidades")} aria-label={`Abrir ${command.openOpportunities} oportunidades`}><BriefcaseBusiness size={18} /><span>Oportunidades abertas</span><strong>{command.openOpportunities}</strong><small>Abrir pipeline</small></button>
        <button type="button" className="tdg-crm-metric-card" onClick={() => onNavigate?.("/todogreen/funil")} aria-label={`Abrir forecast ponderado de ${BRL.format(command.weightedPipeline)}`}><CircleDollarSign size={18} /><span>Forecast ponderado</span><strong>{BRL.format(command.weightedPipeline)}</strong><small>{BRL.format(command.totalPipeline)} em pipeline · abrir funil</small></button>
        <button type="button" className={`tdg-crm-metric-card ${command.overdueActions ? "attention" : ""}`} onClick={() => { setQuickFilter("overdue"); setFilter("all"); setSortBy("next-action"); setViewMode("cards"); setVisibleLimit(100); }} aria-pressed={quickFilter === "overdue"} aria-label={`Filtrar ${command.overdueActions} ações atrasadas`}><CalendarClock size={18} /><span>Ações atrasadas</span><strong>{command.overdueActions}</strong><small>Filtrar pendências vencidas</small></button>
        <button type="button" className={`tdg-crm-metric-card ${command.relationshipGaps ? "attention" : ""}`} onClick={() => { setQuickFilter("all"); setFilter("no-decision"); setViewMode("cards"); setVisibleLimit(100); }} aria-pressed={filter === "no-decision"} aria-label={`Filtrar ${command.relationshipGaps} contas com mapa incompleto`}><Users size={18} /><span>Mapa incompleto</span><strong>{command.relationshipGaps}</strong><small>Filtrar cobertura abaixo de 60%</small></button>
      </div>
      {/* Ação abre em janela própria — a lista não é cortada no meio nem se
          mistura com formulário (pedido da titular, 30/08). */}
      {showCreate && <Modal title="Registrar uma pista" onClose={() => setShowCreate(false)}><form className="tdg-client-admin-form tdg-form-em-modal tdg-progressive-form" onSubmit={createClient}><p>Se você só tem o nome e um contexto, já pode começar. Complete o restante depois na mesma ficha.</p><div className="tdg-form-row"><label><span>Empresa ou pista</span><input required autoFocus value={clientForm.nome} onChange={(e) => setClientForm({ ...clientForm, nome: e.target.value })} placeholder="Ex.: empresa vista em um evento" /></label><label className="tdg-form-wide"><span>O que você sabe até agora</span><textarea value={clientForm.observacoes} onChange={(e) => setClientForm({ ...clientForm, observacoes: e.target.value })} placeholder="Ex.: demonstrou interesse em entregas elétricas; preciso descobrir quem cuida de Logística." /></label></div><details><summary>Adicionar mais informações agora</summary><div className="tdg-form-row"><label><span>Documento</span><input value={clientForm.documento} onChange={(e) => setClientForm({ ...clientForm, documento: e.target.value })} /></label><label><span>Segmento</span><input value={clientForm.segmento} onChange={(e) => setClientForm({ ...clientForm, segmento: e.target.value })} /></label><label><span>Classificação</span><select value={clientForm.tier} onChange={(e) => setClientForm({ ...clientForm, tier: e.target.value })}><option value="">Ainda não classificada</option>{TODO_GREEN_ACCOUNT_TIERS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Momento</span><select value={clientForm.stage} onChange={(e) => setClientForm({ ...clientForm, stage: e.target.value })}><option value="">Ainda não definido</option>{TODO_GREEN_ACCOUNT_STAGES.map((item) => <option key={item}>{item}</option>)}</select></label></div></details><div className="tdg-form-actions"><button type="button" onClick={() => setShowCreate(false)}>Cancelar</button><button className="tdg-action"><Plus size={16} />Salvar pista</button></div></form></Modal>}
      {novoContatoAberto && <Modal title="Novo contato" onClose={() => setNovoContatoAberto(false)}><form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={salvarContatoGlobal}><div className="tdg-form-row"><label><span>Conta</span><input required autoFocus list="tdg-crm-contas" value={novoContatoGlobal.conta} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, conta: e.target.value })} placeholder="Digite para ver as contas cadastradas" /><datalist id="tdg-crm-contas">{clients.map((c) => <option value={c.name} key={c.id} />)}</datalist></label><label><span>Nome</span><input required value={novoContatoGlobal.name} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, name: e.target.value })} /></label><label><span>Cargo</span><input value={novoContatoGlobal.title} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, title: e.target.value })} /></label><label><span>Papel</span><select value={novoContatoGlobal.relationshipRole} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, relationshipRole: e.target.value })}>{TODO_GREEN_RELATIONSHIP_ROLES.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>E-mail</span><input type="email" value={novoContatoGlobal.email} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, email: e.target.value })} /></label><label><span>Telefone</span><input value={novoContatoGlobal.phone} onChange={(e) => setNovoContatoGlobal({ ...novoContatoGlobal, phone: e.target.value })} /></label></div><div className="tdg-form-actions"><button type="button" onClick={() => setNovoContatoAberto(false)}>Cancelar</button><button className="tdg-action"><UserPlus size={16} />Salvar contato</button></div></form></Modal>}
      <div className="tdg-crm-toolbar"><div className="tdg-client-toolbar"><Search size={18} /><input aria-label="Buscar clientes e contatos" placeholder="Buscar ID, conta, contato, e-mail, telefone ou responsável" value={query} onChange={(e) => { setQuery(e.target.value); setVisibleLimit(100); }} /></div><div className="tdg-crm-view-switch" aria-label="Modo de visualização"><button type="button" className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}><LayoutGrid size={15} />Cartões</button><button type="button" className={viewMode === "kanban" ? "active" : ""} onClick={() => setViewMode("kanban")}><BriefcaseBusiness size={15} />Kanban</button><button type="button" className={viewMode === "funil" ? "active" : ""} onClick={() => setViewMode("funil")}><Filter size={15} />Funil</button><button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}><List size={15} />Tabela</button></div><div className="tdg-crm-filter-grid" aria-label="Filtros e ordenação do CRM"><label><span>Ordenar</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="name-asc">Nome (A–Z)</option><option value="name-desc">Nome (Z–A)</option><option value="temperature">Temperatura</option><option value="next-action">Próxima ação</option><option value="updated">Atualização recente</option><option value="contacts">Mais contatos</option></select></label><label><span>Etapa</span><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}><option value="all">Todas as etapas</option>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label><span>Responsável</span><select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}><option value="all">Todos</option><option value="unassigned">Sem responsável</option>{ownerOptions.map((owner) => <option key={owner}>{owner}</option>)}</select></label><label><span>Contatos</span><select value={contactFilter} onChange={(e) => setContactFilter(e.target.value)}><option value="all">Com e sem contato</option><option value="with">Com telefone/e-mail</option><option value="without">Sem telefone/e-mail</option></select></label></div><div className="tdg-crm-filters" aria-label="Temperatura das contas">{[["all", "Todas"], ["Quente", "Quentes"], ["Morno", "Mornas"], ["Frio", "Frias"]].map(([id, label]) => <button type="button" className={temperatureFilter === id ? "active" : ""} onClick={() => { setTemperatureFilter(id); setVisibleLimit(100); }} key={id}>{label}</button>)}</div><div className="tdg-crm-filters" aria-label="Saúde da carteira">{[["all", "Toda saúde"], ["critical", "Críticas"], ["attention", "Atenção"], ["healthy", "Saudáveis"], ["no-decision", "Mapa incompleto"]].map(([id, label]) => <button type="button" className={filter === id ? "active" : ""} onClick={() => { setQuickFilter("all"); setFilter(id); setVisibleLimit(100); }} key={id}>{label}</button>)}</div></div>
      {loading && <p>Carregando carteira...</p>}{!loading && visible.length === 0 && <p className="tdg-crm-empty">Nenhuma conta corresponde aos filtros desta carteira.</p>}
      {!loading && visible.length > 0 && viewMode === "cards" && <div className="tdg-crm-card-grid" aria-label="Contas do CRM em cartões">{renderedClients.map((client) => { const summary = summaryById.get(client.id); const alerta = alertaPrincipal(summary); return <button type="button" className={summary?.attention || ""} onClick={() => openClient(client.id)} key={client.id}><header><span><strong>{client.name}</strong><small>{client.accountCode || client.id} · {client.segment || "Segmento não informado"}</small></span><b>{summary?.score || 0}</b></header><div className="tdg-crm-card-tags"><em>{client.crm?.temperature || "Sem temperatura"}</em><em>{client.crm?.stage || "Mapeamento"}</em>{apresentacaoPorCliente[client.id] && <em className="tdg-crm-card-apres"><Send size={11} /> Apresentação enviada</em>}{alerta && <em className={`tdg-crm-card-alerta ${alerta.severidade}`}><AlertTriangle size={11} /> {alerta.rotulo}</em>}</div><dl><div><dt>Pipeline</dt><dd>{BRL.format(summary?.pipeline || 0)}</dd></div><div><dt>Decisores</dt><dd>{summary?.coverage || 0}%</dd></div><div><dt>Contatos</dt><dd>{client.crm?.contacts?.length || 0}</dd></div></dl><footer><span><small>Próxima ação</small><strong>{summary?.nextAction || "Definir próxima ação"}</strong></span><ArrowRight size={16} /></footer></button>; })}{visible.length > renderedClients.length && <button type="button" className="tdg-crm-card-load-more" onClick={() => setVisibleLimit((current) => current + 100)}>Mostrar mais 100 contas ({renderedClients.length} de {visible.length})</button>}</div>}
      {!loading && visible.length > 0 && viewMode === "kanban" && <>
        <div className="tdg-crm-view-switch tdg-crm-kanban-mode" aria-label="Formato do kanban">
          <button type="button" className={kanbanMode === "simples" ? "active" : ""} onClick={() => setKanbanMode("simples")}>Simplificado</button>
          <button type="button" className={kanbanMode === "detalhado" ? "active" : ""} onClick={() => setKanbanMode("detalhado")}>Detalhado</button>
        </div>
        {/* O kanban SIMPLIFICADO é o mockup aprovado pela titular: as etapas
            do funil de oportunidades (Prospecção → Fechamento, mais os dois
            desfechos), com o total em R$ na cabeça e o cartão só com cliente
            e valor — nada mais. O detalhado (por etapa da CONTA) segue na
            pílula ao lado. */}
        {kanbanMode === "simples" && (() => {
          const colunas = ESTAGIOS_OPORTUNIDADE.map((etapa) => {
            const itens = crmOpportunities.filter((item) => estagioValido(item.estagio || item.stage) === etapa);
            return { etapa, itens, total: itens.reduce((soma, item) => soma + (Number(item.value) || 0), 0) };
          });
          return <>
            <p className="tdg-opp-kb-resumo">{crmOpportunities.length} oportunidade(s), cada uma na etapa em que está hoje. Clique no cartão para abrir a conta.</p>
            <TopScrollRow className="tdg-opp-kanban-wrap" ariaLabel="Kanban simplificado — oportunidades por etapa do funil">
              <div className="tdg-opp-kanban">
                {colunas.map((coluna, indice) => <section className={`tdg-opp-kb-col${coluna.etapa === "Fechada perdida" ? " perdida" : ""}`} style={{ "--kb-tom": Math.min(indice, 5) }} aria-label={`${coluna.etapa}: ${coluna.itens.length} oportunidade(s)`} key={coluna.etapa}>
                  <header>
                    <strong>{coluna.etapa} · {coluna.itens.length}</strong>
                    <span>{BRL_COMPACTO(coluna.total)}</span>
                  </header>
                  <div className="tdg-opp-kb-body">
                    {coluna.itens.map((item) => <button type="button" className="tdg-opp-kb-card" onClick={() => (item.clientId ? openClient(item.clientId) : onNavigate?.("/todogreen/oportunidades"))} title={item.cliente || item.client} key={item.id}>
                      <span>{item.cliente || item.client || "Sem conta"}</span>
                      <b>{BRL_COMPACTO(item.value)}</b>
                    </button>)}
                    {!coluna.itens.length && <p className="tdg-opp-kb-vazio">—</p>}
                  </div>
                </section>)}
              </div>
            </TopScrollRow>
          </>;
        })()}
        {kanbanMode === "detalhado" && <TopScrollRow className="tdg-crm-kanban-wrap" ariaLabel="Kanban de clientes por etapa"><div className="tdg-crm-kanban">{kanbanColumns.map((column) => <section className="tdg-crm-kanban-column" aria-label={`${column.stage}: ${column.accounts.length} conta(s)`} key={column.stage}><header><span><strong>{column.stage}</strong><small>{column.accounts.length} conta(s)</small></span><b>{BRL.format(column.pipeline)}</b></header><div>{column.accounts.length === 0 && <p>Sem contas nesta etapa.</p>}{column.accounts.map((client) => { const summary = summaryById.get(client.id); return <button type="button" className={`tdg-crm-kanban-card ${summary?.attention || ""}`} onClick={() => openClient(client.id)} key={client.id}><span><strong title={client.name}>{client.name}</strong><small>{client.accountCode || client.id} · {client.segment || "Segmento não informado"}</small></span><div><em>{client.crm?.temperature || "Sem temperatura"}</em><em>{summary?.coverage || 0}% decisores</em></div><footer><span><small>Pipeline</small><b>{BRL.format(summary?.pipeline || 0)}</b></span><span><small>Próxima ação</small><b title={summary?.nextAction || "Definir próxima ação"}>{summary?.nextAction || "Definir próxima ação"}</b></span></footer></button>; })}</div></section>)}{visible.length > renderedClients.length && <button type="button" className="tdg-crm-kanban-load-more" onClick={() => setVisibleLimit((current) => current + 100)}>Mostrar mais 100 contas ({renderedClients.length} de {visible.length})</button>}</div></TopScrollRow>}
      </>}
      {!loading && visible.length > 0 && viewMode === "funil" && <div className="tdg-crm-funil-wrap">
        <p className="tdg-crm-funil-legenda">{renderedClients.length} conta(s), cada uma na etapa em que está hoje. Clique numa etapa para ver as contas.</p>
        <TopScrollRow className="tdg-crm-funil-scroll" ariaLabel="Funil de contas por etapa">
          <div className="tdg-crm-funil">
            {kanbanColumns.map((column, indice) => (
              <button
                type="button"
                className="tdg-crm-funil-card"
                style={{ "--funil-passo": kanbanColumns.length > 1 ? indice / (kanbanColumns.length - 1) : 0 }}
                onClick={() => { setStageFilter(column.stage); setViewMode("kanban"); }}
                key={column.stage}
                title={`${column.stage}: ${column.accounts.length} conta(s) · ${BRL.format(column.pipeline)}`}
              >
                <strong>{column.stage.toUpperCase()} · {column.accounts.length}</strong>
                <b>{BRL_COMPACTO(column.pipeline)}</b>
              </button>
            ))}
          </div>
        </TopScrollRow>
      </div>}
      {!loading && visible.length > 0 && viewMode === "table" && <div className="tdg-crm-table" role="table" aria-label="Contas do CRM"><div className="tdg-crm-table-head" role="row"><span>Conta</span><span>Saúde</span><span>Pipeline</span><span>Próxima ação</span></div>{renderedClients.map((client) => { const summary = summaryById.get(client.id); return <button type="button" role="row" className={summary?.attention || ""} onClick={() => openClient(client.id)} key={client.id}><span><strong>{client.name}</strong><small>{client.accountCode || client.id} · {client.crm?.temperature ? `${client.crm.temperature} · ` : ""}{client.segment || "Segmento não informado"} · {client.crm?.stage || "Mapeamento"}</small></span><span><b>{summary?.score || 0}</b><small>{summary?.coverage || 0}% de cobertura</small></span><span><strong>{BRL.format(summary?.pipeline || 0)}</strong><small>{summary?.openOpportunities || 0} aberta(s)</small></span><span><strong>{summary?.nextAction || "Definir próxima ação"}</strong><small>{client.crm?.nextActionAt || "Sem prazo"}</small></span></button>; })}{visible.length > renderedClients.length && <button type="button" className="tdg-crm-load-more" onClick={() => setVisibleLimit((current) => current + 100)}>Mostrar mais 100 contas ({renderedClients.length} de {visible.length})</button>}</div>}
    </>}

    {selected && selectedSummary && <div className="tdg-crm-detail">
      <button className="tdg-crm-back" type="button" onClick={closeClient}><ArrowLeft size={16} />Voltar para a carteira</button>
      <header className="tdg-crm-detail-hero"><div><span>{selected.crm?.tier || "Enterprise"}{selected.crm?.temperature ? ` · ${selected.crm.temperature}` : ""}</span><h2>{selected.name}</h2><p>{selected.segment || "Segmento não informado"} · {selected.crm?.stage || "Mapeamento"}{selected.document ? ` · ${selected.document}` : ""}</p><small>{selected.crm?.source ? `Origem: ${selected.crm.source}` : "Conta da carteira To Do Green"}</small></div><div className="tdg-crm-detail-actions">{access.podeEditar && (
        // Seletor de temperatura direto no detalhe da conta: frio/morno/quente
        // sem precisar abrir o editor 360º (onde ele estava escondido). Salva na
        // hora, na mesma régua de revisão do resto do CRM.
        <div className="tdg-crm-temp-inline" title="Temperatura do lead">
          <span>Temperatura</span>
          <SegmentedControl
            ariaLabel="Temperatura do lead"
            size="sm"
            disabled={salvandoTemperatura !== null}
            value={salvandoTemperatura !== null ? salvandoTemperatura : (selected.crm?.temperature || "")}
            onChange={(valor) => salvarTemperatura(selected, valor)}
            options={[{ value: "", label: "Sem" }, ...TODO_GREEN_ACCOUNT_TEMPERATURES.map((item) => ({ value: item, label: item }))]}
          />
        </div>
      )}{access.podeEditar && <button type="button" onClick={() => setEditingId(selected.id)}><Edit3 size={15} />Editar</button>}{access.podeEditar && onInteraction && <button type="button" className="tdg-action" onClick={() => { setDetailTab("activity"); setInteractionFormRequest((valor) => valor + 1); }}><MessageCircle size={15} />Registrar contato/follow-up</button>}{access.podeEditar && <button type="button" className="tdg-action" onClick={() => setApresentacaoAberta(true)}><Send size={15} />{apresentacaoPorCliente[selected.id] ? "Reenviar apresentação" : "Enviar apresentação"}</button>}{apresentacaoPorCliente[selected.id] && <span className="tdg-crm-apres-selo" title={dataBr(apresentacaoPorCliente[selected.id]) ? `Apresentação enviada em ${dataBr(apresentacaoPorCliente[selected.id])}` : "Apresentação já enviada"}>✓ Enviada{dataBr(apresentacaoPorCliente[selected.id]) ? ` em ${dataBr(apresentacaoPorCliente[selected.id])}` : ""}</span>}<button type="button" onClick={() => setTaskClientId(selected.id)}><ListPlus size={15} />Adicionar tarefa</button><button type="button" onClick={() => onNavigate?.(`/todogreen/oportunidades?client=${encodeURIComponent(selected.id)}`)}>Pipeline <ArrowRight size={15} /></button><details className="tdg-crm-more-actions"><summary>Mais ações</summary><div><button type="button" onClick={() => researchSelected("company")} disabled={researching}><Globe2 size={15} />Pesquisar empresa</button><button type="button" onClick={() => researchSelected("contacts")} disabled={researching}><UserSearch size={15} />Atualizar contatos</button><button type="button" onClick={() => setPortalPreviewOpen(true)}><Eye size={15} />Ver como cliente</button>{access.podeGerenciar && <button type="button" className="tdg-danger-action" onClick={() => deleteClient(selected)} disabled={deletingClientId === selected.id}><Trash2 size={15} />{deletingClientId === selected.id ? "Excluindo..." : "Excluir cliente"}</button>}</div></details></div></header>
      <Tabs
        ariaLabel="Visões da conta"
        className="tdg-crm-account-tabs-ds"
        value={detailTab}
        onChange={openDetailTab}
        tabs={[
          { value: "summary", label: "Resumo" },
          { value: "comercial", label: "Comercial" },
          { value: "operacao", label: "Operação e financeiro" },
          { value: "relationship", label: "Relacionamento" },
          { value: "opportunities", label: "Oportunidades" },
          { value: "strategy", label: "Estratégia" },
          { value: "activity", label: "Conversas realizadas" },
          { value: "next", label: "Próximos passos" },
          { value: "intelligence", label: "Inteligência" },
        ]}
      />
      <div className="tdg-crm-detail-metrics"><article><small>Saúde da conta</small><strong>{selectedSummary.score}</strong><span>{selectedSummary.attention === "healthy" ? "Saudável" : selectedSummary.attention === "critical" ? "Crítica" : "Atenção"}</span></article><article><small>Receita atual</small><strong>{selectedStrategy.shareOfWallet.status === "missing-our-revenue" || selectedAccount.ourAnnualRevenue === "" || selectedAccount.ourAnnualRevenue === undefined ? "Não informada" : BRL.format(selectedStrategy.shareOfWallet.ourRevenue)}</strong><span>receita anual To Do Green</span></article><article><small>Potencial anual</small><strong>{selectedStrategy.potential.annual ? BRL.format(selectedStrategy.potential.annual) : "Não calculado"}</strong><span>sem estimativa quando falta base</span></article><article><small>Share of Wallet</small><strong>{selectedStrategy.shareOfWallet.percentage === null ? "Não calculado" : `${selectedStrategy.shareOfWallet.percentage.toLocaleString("pt-BR")}%`}</strong><span>participação no gasto logístico</span></article><article><small>Cobertura de decisores</small><strong>{selectedSummary.coverage}%</strong><span>{selectedAccount.contacts.length} contato(s)</span></article><article><small>Pipeline da conta</small><strong>{BRL.format(selectedSummary.pipeline || 0)}</strong><span>{selectedSummary.openOpportunities || 0} oportunidade(s)</span></article></div>
      <SaudeDaContaPanel
        conta={selected}
        explicacao={explicarSaudeDaConta(selectedAccount, selectedAccount.contacts, crmOpportunities)}
        podeEditar={access.podeEditar}
        setToast={setToast}
        onSalvar={async (avaliacao) => {
          await saveClient(selected, {
            revision: selected.revision,
            crm: { ...(selected.crm || {}), ...avaliacao },
          });
          setToast?.("Avaliação da conta salva — a saúde já reflete as novas notas.");
        }}
      />
      {selectedAccount.contacts.length === 0 && <section className="tdg-crm-contact-cta"><Users size={18} /><div><strong>Nenhum contato comercial cadastrado</strong><span>Cadastre pessoas do cliente, como Compras, Logística, ESG, influenciadores e decisores.</span></div><button type="button" className="tdg-action" onClick={() => { setDetailTab("relationship"); setQuickContactOpen(true); }}><UserPlus size={14} />Adicionar contato comercial</button></section>}
      {/* Cliente "não tratado": ainda sem nenhuma interação registrada nem
          oportunidade aberta. O primeiro passo comercial é se apresentar — por
          isso o CTA leva direto ao envio da apresentação com a abordagem por
          perfil (temperatura). */}
      {access.podeEditar && interacoesVisiveis({ interacoes: interactions, clientId: selected.id }).length === 0 && (selectedSummary.openOpportunities || 0) === 0 && <section className="tdg-crm-contact-cta tdg-crm-untreated-cta"><Send size={18} /><div><strong>Cliente ainda não tratado</strong><span>Nenhum contato registrado nem oportunidade aberta. Comece se apresentando: a mensagem já vem pronta pela temperatura da conta.</span></div><button type="button" className="tdg-action" onClick={() => setApresentacaoAberta(true)}><Send size={14} />Enviar apresentação</button></section>}
      <section className="tdg-crm-next"><Target size={17} /><div><small>PRÓXIMA AÇÃO SUGERIDA</small><strong>{selectedIntelligence.nextTask}</strong><span>{suggestionContext(selectedIntelligence.nextTaskKey)}</span></div><button type="button" onClick={() => { setDetailTab("relationship"); setQuickContactOpen(true); }}><UserPlus size={14} />Adicionar contato comercial</button><button type="button" onClick={() => setTaskClientId(selected.id)}>Transformar em tarefa</button><button type="button" onClick={completeSuggestedAction} disabled={!selectedIntelligence.nextTaskCanComplete || completingSuggestion}>{completingSuggestion ? "Atualizando..." : "Marcar feita e ver próxima"}</button></section>
      {portalPreviewOpen && <ClientPortalPreview client={selected} authHeaders={authHeaders} open onClose={() => setPortalPreviewOpen(false)} />}
      {apresentacaoAberta && <EnviarApresentacao
        conta={selected}
        houveContato={interacoesVisiveis({ interacoes: interactions, clientId: selected.id }).length > 0}
        contexto={contextoDeMercado(selectedReportCandidate || {}, { segmento: selected.segment })}
        remetenteNome={remetenteNome}
        assinatura={assinaturaEmail}
        onEnviado={async () => {
          // Fecha a tarefa "enviar apresentação" desta conta, se houver uma em
          // aberto. Casa por título (apresenta/apresentação) e status não concluído.
          const alvo = accountWorkTasks(tasks, selected.id).find(
            (t) => t.status !== "Concluído" && /apresenta/i.test(String(t.title || "")),
          );
          if (alvo && onCompletarTarefa) { await onCompletarTarefa(alvo.id); return true; }
          return false;
        }}
        setToast={setToast}
        onClose={() => setApresentacaoAberta(false)}
        onRegistrar={onInteraction ? async (interacao) => {
          await onInteraction({ ...interacao, clientId: selected.id });
          await load();
        } : undefined}
      />}
      <div className={`tdg-crm-detail-grid tdg-account-tab-${detailTab}`}><main>
        <AccountWorkOverview client={selected} contacts={selectedAccount.contacts} interactions={interacoesVisiveis({ interacoes: interactions, clientId: selected.id })} tasks={tasks} onTab={setDetailTab} onNavigate={onNavigate} />
        {comercial && <section className="tdg-crm-detail-section tdg-account-panel tdg-account-comercial">
          <header><strong>Contrato e negociação</strong><small>{comercial.contrato ? (comercial.contrato.titulo || "Contrato ativo") : "Nenhum contrato cadastrado para esta conta"}</small></header>
          <dl className="tdg-crm-account-data tdg-comercial-grid">
            <div><dt>Tipo de produto</dt><dd>{comercial.produto || "Não informado"}</dd></div>
            <div><dt>Tabela negociada</dt><dd>{comercial.contrato?.tabelaPrecoId || comercial.contrato?.cenarioId || "Não informada"}</dd></div>
            <div><dt>Data negociada</dt><dd>{dataBR(comercial.dataNegociada)}</dd></div>
            <div><dt>Primeira coleta</dt><dd>{dataBR(comercial.primeiraColeta)}{comercial.totalOperacoes > 0 ? ` · ${comercial.totalOperacoes} operação(ões)` : ""}</dd></div>
            <div><dt>Data para reajuste</dt><dd>{dataBR(comercial.contrato?.dataBaseReajuste)}{comercial.contrato?.indiceReajuste ? ` · ${comercial.contrato.indiceReajuste}` : ""}</dd></div>
            <div><dt>Vigência</dt><dd>{comercial.contrato?.inicioEm ? `${dataBR(comercial.contrato.inicioEm)} → ${comercial.contrato.fimEm ? dataBR(comercial.contrato.fimEm) : "sem término"}` : "Não informada"}</dd></div>
            <div><dt>Valor mensal</dt><dd>{comercial.contrato?.valorMensal ? BRL.format(comercial.contrato.valorMensal) : "Não informado"}</dd></div>
            <div><dt>Faturamento</dt><dd>{comercial.contrato?.diaFaturamento ? `Dia ${comercial.contrato.diaFaturamento}` : "Não definido"}{comercial.contrato?.situacao ? ` · ${comercial.contrato.situacao}` : ""}</dd></div>
          </dl>
          <header className="tdg-comercial-hist-head"><strong>Histórico de tratativa</strong><small>Contrato, operações e oportunidades, do mais recente ao mais antigo</small></header>
          {comercial.eventos.length ? <ol className="tdg-comercial-timeline">
            {comercial.eventos.slice(0, 60).map((ev, i) => <li key={`${ev.data}-${i}`}><span className="tdg-comercial-tag">{ev.tipo}</span><div><strong>{ev.texto}</strong><small>{dataBR(ev.data)}</small></div></li>)}
          </ol> : <p>Sem histórico de contrato, operação ou oportunidade registrado para esta conta.</p>}
        </section>}
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-operacao tdg-conta-conectada">
          <header><strong>Operação e financeiro ao vivo</strong><small>Lido das operações e das contas a receber desta conta — a mesma fonte das telas de Operação e Financeiro</small></header>
          <div className="tdg-conta-conectada-metrics">
            <article><small>Operações em andamento</small><strong>{conectada.totalAndamento}</strong>{conectada.operacoesAtrasadas > 0 && <span className="risk">{conectada.operacoesAtrasadas} atrasada(s)</span>}</article>
            <article><small>Ocorrências abertas</small><strong className={conectada.totalOcorrencias > 0 ? "risk" : ""}>{conectada.totalOcorrencias}</strong></article>
            <article><small>A receber em aberto</small><strong>{BRL.format(conectada.totalAReceber)}</strong>{conectada.qtdVencidos > 0 && <span className="risk">{BRL.format(conectada.totalVencido)} vencido</span>}</article>
          </div>
          <div className="tdg-conta-conectada-cols">
            <div>
              <header><b>Operações em andamento</b><button type="button" onClick={() => onNavigate?.("/todogreen/operacoes")}>Abrir operações <ArrowRight size={13} /></button></header>
              {conectada.operacoesAndamento.length ? <ul>{conectada.operacoesAndamento.slice(0, 8).map((op) => <li key={op.id} className={op.atrasada ? "risk" : ""}><span><strong>{op.referencia}</strong><small>{[op.origem, op.destino].filter(Boolean).join(" → ") || "Trajeto não informado"}</small></span><em>{op.atrasada ? "Atrasada" : (op.situacao || "").replaceAll("_", " ") || "Em andamento"}</em></li>)}</ul> : <p>Nenhuma operação em andamento para esta conta.</p>}
            </div>
            <div>
              <header><b>Ocorrências</b><button type="button" onClick={() => onNavigate?.("/todogreen/ocorrencias")}>Tratar ocorrências <ArrowRight size={13} /></button></header>
              {conectada.ocorrenciasAbertas.length ? <ul>{conectada.ocorrenciasAbertas.slice(0, 8).map((op) => <li key={op.id} className="risk"><span><strong>{op.referencia}</strong></span><em>{op.ocorrencias} ocorrência(s)</em></li>)}</ul> : <p>Nenhuma ocorrência aberta nesta conta.</p>}
            </div>
            <div>
              <header><b>Títulos a receber em aberto</b><button type="button" onClick={() => onNavigate?.("/todogreen/receita")}>Abrir contas a receber <ArrowRight size={13} /></button></header>
              {conectada.titulosAbertos.length ? <ul>{conectada.titulosAbertos.slice(0, 8).map((t) => <li key={t.id} className={t.atrasado ? "risk" : ""}><span><strong>{t.descricao}</strong><small>{t.vencimentoEm ? `Vence ${dataBR(t.vencimentoEm)}` : "Sem vencimento"}</small></span><em>{BRL.format(t.valor)}{t.atrasado ? " · vencido" : ""}</em></li>)}</ul> : <p>Nenhum título a receber em aberto para esta conta.</p>}
            </div>
          </div>
        </section>
        <section className="tdg-crm-intelligence tdg-account-panel tdg-account-intelligence"><header><strong>IA · mapa da empresa</strong><small>Leitura dos dados do CRM</small></header><div><span>Relevância ESG</span><strong>{selectedIntelligence.esgRelevance}</strong><small>{selectedIntelligence.esgReason}</small></div><button type="button" className="tdg-crm-intel-task" onClick={() => setTaskClientId(selected.id)} title="Transformar em tarefa"><span>Próxima tarefa sugerida</span><strong>{selectedIntelligence.nextTask}</strong></button><div><span>Procurement de Logística e Transportes</span><strong>{procurementSummary}</strong></div></section>
        <section className="tdg-crm-detail-section tdg-crm-account-strategy tdg-account-panel tdg-account-summary"><header><strong>Potencial de carteira</strong><small>Cálculo anual auditável</small></header><div className="tdg-crm-strategy-grid"><span><small>Potencial anual</small><strong>{selectedStrategy.potential.annual ? BRL.format(selectedStrategy.potential.annual) : "Não calculado"}</strong></span><span><small>Middle mile</small><strong>{selectedStrategy.potential.middleMile ? BRL.format(selectedStrategy.potential.middleMile) : "Não calculado"}</strong></span><span><small>Last mile</small><strong>{selectedStrategy.potential.lastMile ? BRL.format(selectedStrategy.potential.lastMile) : "Não calculado"}</strong></span><span><small>Dedicada</small><strong>{selectedStrategy.potential.dedicated ? BRL.format(selectedStrategy.potential.dedicated) : "Não calculado"}</strong></span></div><p><strong>Base:</strong> {selectedStrategy.potential.method}.</p><p><strong>Expansão geográfica:</strong> {selectedStrategy.potential.geographicExpansion || "Ainda não mapeada."}</p>{selectedStrategy.potential.missing && <small>Abra Editar e informe as quantidades mensais e os tickets médios. Sem essa base, o CRM não inventa receita.</small>}</section>
        <section className="tdg-crm-detail-section tdg-crm-account-strategy tdg-account-panel tdg-account-summary"><header><strong>Share of Wallet</strong><small>Participação no gasto logístico do cliente</small></header>{selectedStrategy.shareOfWallet.percentage === null ? <p>{shareOfWalletMissingMessage}</p> : <div className="tdg-crm-strategy-grid"><span><small>Participação To Do Green</small><strong>{selectedStrategy.shareOfWallet.percentage.toLocaleString("pt-BR")}%</strong></span><span><small>Receita anual To Do Green</small><strong>{BRL.format(selectedStrategy.shareOfWallet.ourRevenue)}</strong></span><span><small>Gasto logístico do cliente</small><strong>{BRL.format(selectedStrategy.shareOfWallet.customerSpend)}</strong></span><span><small>Espaço estimado</small><strong>{BRL.format(selectedStrategy.shareOfWallet.remaining)}</strong></span></div>}</section>
        <section className="tdg-crm-detail-section tdg-crm-account-strategy tdg-account-panel tdg-account-relationship"><header><strong>Mapa de relacionamento</strong><small>Papéis associados às pessoas</small></header><div className="tdg-crm-relationship-map">{[["Quem decide", selectedStrategy.relationshipMap.buyers], ["Quem apoia", selectedStrategy.relationshipMap.influencers], ["Quem bloqueia", selectedStrategy.relationshipMap.blockers], ["Usuário operacional", selectedStrategy.relationshipMap.users]].map(([label, names]) => <div className={label === "Quem bloqueia" && names.length ? "risk" : ""} key={label}><span>{label}</span><strong>{names.length ? names.join(", ") : "Não mapeado"}</strong></div>)}</div></section>
        <section className="tdg-crm-detail-section tdg-crm-account-strategy tdg-account-panel tdg-account-opportunities"><header><strong>White Space</strong><small>Produtos ainda não trabalhados com o cliente</small></header><div className="tdg-crm-chip-list">{selectedStrategy.whiteSpace.length ? selectedStrategy.whiteSpace.map((item) => <span key={item}>{item}</span>) : <span>Portfólio principal já coberto</span>}</div></section>
        <section className="tdg-crm-detail-section tdg-crm-account-strategy tdg-account-panel tdg-account-strategy"><header><strong>Account Plan</strong><small>Cadastro e recomendações derivadas do CRM</small></header><dl className="tdg-crm-account-data"><div><dt>Objetivo</dt><dd>{selectedStrategy.accountPlan.objective || "Não definido"}{selectedStrategy.accountPlan.generated?.objective && <small>Sugerido pelos dados atuais</small>}</dd></div><div><dt>Barreiras</dt><dd>{selectedStrategy.accountPlan.barriers || "Não mapeadas"}{selectedStrategy.accountPlan.generated?.barriers && <small>Derivadas dos alertas reais</small>}</dd></div><div><dt>Concorrentes</dt><dd>{selectedStrategy.accountPlan.competitors || "Não mapeados"}</dd></div><div><dt>30 dias</dt><dd>{selectedStrategy.accountPlan.plan30 || "Não definido"}{selectedStrategy.accountPlan.generated?.plan30 && <small>Próxima melhor ação calculada</small>}</dd></div><div><dt>60 dias</dt><dd>{selectedStrategy.accountPlan.plan60 || "Não definido"}{selectedStrategy.accountPlan.generated?.plan60 && <small>Sugerido pelos dados atuais</small>}</dd></div><div><dt>90 dias</dt><dd>{selectedStrategy.accountPlan.plan90 || "Não definido"}{selectedStrategy.accountPlan.generated?.plan90 && <small>Sugerido pelos dados atuais</small>}</dd></div></dl></section>
        <div className="tdg-account-panel tdg-account-intelligence"><ExternalIntelligence report={selectedReport} researching={researching} error={researchError} onResearch={researchSelected} watch={selectedWatch} onToggleWatch={toggleResearchWatch} onDiscard={access.podeEditar ? (url) => editResearch({ descartarUrl: url }, "Informação removida. Ela não volta nas próximas pesquisas.") : undefined} onToggleAction={access.podeEditar ? (acao, desfazer) => editResearch({ concluirAcao: acao, desfazer }, desfazer ? "Ação reaberta." : "Ação concluída.") : undefined} /></div>
        <div className="tdg-account-panel tdg-account-relationship"><RelationshipMap contatos={selectedAccount.contacts} conta={selected.name} /></div>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-relationship">
          <header>
            <strong>Contatos comerciais do cliente</strong>
            <small>{selectedAccount.contacts.length} contato(s)</small>
            {access.podeEditar && <button type="button" onClick={() => setQuickContactOpen(true)}><UserPlus size={13} />Adicionar contato comercial</button>}
          </header>
          {/* Contato em janela própria: o formulário não empurra a lista de
              contatos que a pessoa está olhando. */}
          {quickContactOpen && (
            <Modal title={`Adicionar contato comercial · ${selected.name}`} onClose={() => setQuickContactOpen(false)}>
            <form className="tdg-crm-contact-form tdg-crm-quick-contact tdg-form-em-modal" onSubmit={saveQuickContact}>
              <input aria-label="Nome do novo contato" placeholder="Nome" value={quickContact.name} onChange={(event) => setQuickContact({ ...quickContact, name: event.target.value })} />
              <input aria-label="Cargo do novo contato" placeholder="Cargo" value={quickContact.title} onChange={(event) => setQuickContact({ ...quickContact, title: event.target.value })} />
              <select aria-label="Papel do novo contato" value={quickContact.relationshipRole} onChange={(event) => setQuickContact({ ...quickContact, relationshipRole: event.target.value })}>{TODO_GREEN_RELATIONSHIP_ROLES.map((item) => <option key={item}>{item}</option>)}</select>
              <input aria-label="E-mail do novo contato" type="email" placeholder="E-mail" value={quickContact.email} onChange={(event) => setQuickContact({ ...quickContact, email: event.target.value })} />
              <input aria-label="Telefone do novo contato" placeholder="Telefone" value={quickContact.phone} onChange={(event) => setQuickContact({ ...quickContact, phone: event.target.value })} />
              <button className="tdg-action" type="submit"><UserPlus size={15} />Registrar contato</button>
            </form>
            </Modal>
          )}
          <div className="tdg-crm-roles">{selectedAccount.contacts.map((contact) => <ContactCard key={contact.id} contact={contact} clientName={selected.name} />)}{selectedAccount.contacts.length === 0 && <p>Nenhum decisor ou patrocinador mapeado.</p>}</div>
          {(() => {
            const fora = (selected.crm?.contacts || []).filter((contact) => !trustedCrmContact(contact));
            if (!fora.length) return null;
            return (
              <details className="tdg-crm-contatos-historicos">
                <summary>Fora do mapa ativo ({fora.length}) — históricos ou sem vínculo confirmado</summary>
                <p>Ninguém some do CRM: estes contatos só saíram do mapa de decisores. Para reativar, abra Editar conta e marque o vínculo como atual.</p>
                <ul>{fora.map((contact) => <li key={contact.id || contact.name}><strong>{contact.name}</strong><small>{contact.validation || (contact.employmentStatus === "former" ? "Vínculo marcado como encerrado." : "Vínculo atual não confirmado.")}</small></li>)}</ul>
                {access.podeEditar && <button type="button" onClick={() => setEditingId(selected.id)}><Edit3 size={14} />Abrir edição de contatos</button>}
              </details>
            );
          })()}
        </section>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-activity tdg-account-interacoes">
          <InteracoesPanel
            interacoes={interacoesVisiveis({ interacoes: interactions, clientId: selected.id })}
            escopo="conta"
            aviso="Interação registrada na conta aparece em todas as oportunidades dela. O que for específico de uma negociação, registre dentro da oportunidade."
            podeRegistrar={Boolean(access.podeEditar && onInteraction)}
            abrirRegistro={interactionFormRequest}
            pessoas={pessoas}
            oportunidades={selectedOpportunities}
            onCriarTarefa={async (proximoPasso) => createTask({
              id: crypto.randomUUID(),
              opportunityId: proximoPasso.opportunityId || "",
              title: proximoPasso.title,
              description: `Follow-up da conta: ${selected.name}`,
              priority: "Alta",
              status: "A fazer",
              due: proximoPasso.due || "",
              area: "Comercial",
              assigneeType: "real",
              assignee: proximoPasso.assignee,
              assigneeId: proximoPasso.assigneeId,
              project: "",
              isMission: false,
              distribution: "atribuida",
              visibility: "privado",
              recurrence: { frequency: "none" },
              ownerId: currentUserId || null,
              clientId: selected.id,
              clientName: selected.name,
              source: "todogreen-crm-followup",
              businessId: "todogreen",
              createdAt: new Date().toISOString(),
            })}
            onRegistrar={async (interacao) => {
              await onInteraction({ ...interacao, clientId: selected.id });
              setToast?.(interacao.opportunityId ? "Interação registrada na oportunidade selecionada." : "Interação registrada na conta e disponível nas oportunidades dela.");
              await load();
            }}
            setToast={setToast}
          />
        </section>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-activity tdg-account-comments">
          <ComentariosPanel
            comentarios={comments.filter((item) => item.clientId === selected.id && !item.opportunityId)}
            aviso="Comentário feito na conta aparece em todas as oportunidades dela. Para comentar algo de uma oportunidade específica, abra a oportunidade."
            placeholder="Escreva um comentário desta conta"
            podeComentar={Boolean(access.podeEditar && onComment)}
            onEnviar={async (comentario) => {
              await onComment({ clientId: selected.id, comentario });
              setToast?.("Comentário da conta registrado — visível em todas as oportunidades dela.");
            }}
            setToast={setToast}
          />
        </section>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-activity"><header><strong>Outras atividades da conta</strong><small>Mensagens e movimentações realmente registradas</small></header>{activityLoading ? <p>Carregando histórico...</p> : accountInteractions.length ? <div className="tdg-crm-activity-feed">{accountInteractions.map((item) => <article key={item.id}><span><strong>{item.contactName || item.contactHandle || "Contato"}</strong><small>{item.channel || "atividade"} · {item.direction === "out" ? "enviado" : "recebido"} · {item.createdAt ? new Date(item.createdAt).toLocaleString("pt-BR") : "data não informada"}</small></span>{item.subject && <b>{item.subject}</b>}{item.body && <p>{item.body}</p>}</article>)}</div> : <div className="tdg-crm-activity-empty"><strong>Nenhuma mensagem ou reunião registrada</strong><span>WhatsApp e e-mails enviados pelo app aparecem aqui quando associados a esta conta ou a um de seus contatos.</span></div>}<div className="tdg-crm-activity-list"><article><span>Última atualização da conta</span><strong>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString("pt-BR") : "Ainda não registrada"}</strong></article><article><span>Próxima ação</span><strong>{selected.crm?.nextAction || selectedIntelligence.nextTask || "Ainda não definida"}</strong><small>{selected.crm?.nextActionAt || "Sem prazo registrado"}</small></article><article><span>Histórico comercial</span><strong>{selectedOpportunities.length} oportunidade(s) vinculada(s)</strong></article></div><p>O CRM não cria atividades que não aconteceram.</p></section>
      </main><aside>
        <section className="tdg-crm-alerts tdg-account-panel tdg-account-summary tdg-account-strategy"><strong><AlertTriangle size={15} />Health comercial</strong>{selectedStrategy.commercialHealth.map((alert) => <span key={alert}>{alert}</span>)}</section>
        {selectedSummary.alerts.length > 0 && <section className="tdg-crm-alerts tdg-account-panel tdg-account-intelligence"><strong><AlertTriangle size={15} />Pontos de atenção</strong>{selectedSummary.alerts.map((alert) => <span key={alert}>{alert}</span>)}</section>}
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-opportunities"><header><strong>Oportunidades</strong><button type="button" onClick={() => onNavigate?.(`/todogreen/oportunidades?client=${encodeURIComponent(selected.id)}`)}>Abrir pipeline <ArrowRight size={13} /></button></header>{selectedOpportunities.length === 0 ? <p>Nenhuma oportunidade ligada a esta conta.</p> : <div className="tdg-crm-opps">{selectedOpportunities.slice(0, 6).map((opp) => <article key={opp.id}><span><strong>{opp.stage}</strong><small>{opp.nextStep || "Próximo passo não definido"}</small></span><b>{BRL.format(opp.value || 0)}</b></article>)}</div>}</section>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-summary"><header><strong>Responsáveis internos To Do Green</strong><small>Usuários da equipe responsáveis por esta conta</small></header><div className="tdg-client-sellers">{(selected.vendedores || []).length === 0 && <small>Sem responsável comercial</small>}{(selected.vendedores || []).map((seller) => <span key={seller.email}>{seller.email}{access.podeGerenciar && <button type="button" aria-label={`Remover ${seller.email}`} onClick={() => unassign(selected.id, seller.email)}><X size={12} /></button>}</span>)}</div>{access.podeGerenciar && <form className="tdg-crm-assign" onSubmit={assign}><select required aria-label="Responsável comercial" value={assignment.clientId === selected.id ? assignment.sellerEmail : ""} onChange={(e) => setAssignment({ clientId: selected.id, sellerEmail: e.target.value, note: "" })}><option value="">Selecione um usuário cadastrado</option>{pessoas.filter((pessoa) => pessoa.email).map((pessoa) => <option key={pessoa.id} value={pessoa.email}>{pessoa.name} · {pessoa.email}</option>)}</select><button type="submit"><UserPlus size={14} />Atribuir</button></form>}</section>
        <section className="tdg-crm-detail-section tdg-account-panel tdg-account-summary tdg-account-intelligence"><header><strong>Dados da conta</strong><small>Cadastro e preenchimento público</small></header><dl className="tdg-crm-account-data">
          <div><dt>ID da conta</dt><dd><code>{selected.accountCode || selected.id}</code><small>Código estável para busca, metas, importações e integrações</small></dd></div>
          <div><dt>Portal do cliente</dt><dd><PortalAccessPanel client={selected} canManage={access.podeGerenciar} authHeaders={authHeaders} setToast={setToast} onToggle={() => saveClient(selected, { revision: selected.revision, portalEnabled: !selected.portalEnabled })} /></dd></div>
          <div><dt>Razão social</dt><dd>{selected.legalName || "Não informada"}<AccountSource evidence={selected.crm?.enrichmentEvidence?.legalName} url={selectedReport?.suggestedLegalName?.source?.url} /></dd></div>
          <div><dt>Segmento</dt><dd>{selected.segment || "Não informado"}<AccountSource evidence={selected.crm?.enrichmentEvidence?.segment} url={selectedReport?.suggestedSegment?.source?.url} /></dd></div>
          <div><dt>Sede</dt><dd>{selected.crm?.headquarters || "Não informada"}<AccountSource evidence={selected.crm?.enrichmentEvidence?.headquarters} url={selectedReport?.suggestedHeadquarters?.source?.url} /></dd></div>
          <div><dt>Site</dt><dd>{selected.crm?.website ? <a href={selected.crm.website} target="_blank" rel="noreferrer">{sourceHost(selected.crm.website)} <ExternalLink size={12} /></a> : "Não informado"}<AccountSource evidence={selected.crm?.enrichmentEvidence?.website} /></dd></div>
          <div><dt>LinkedIn</dt><dd>{selected.crm?.linkedinUrl ? <a href={selected.crm.linkedinUrl} target="_blank" rel="noreferrer">Abrir página da empresa <ExternalLink size={12} /></a> : "Não informado"}<AccountSource evidence={selected.crm?.enrichmentEvidence?.linkedinUrl} /></dd></div>
          <div><dt>Perfil público</dt><dd>{selected.crm?.qualification?.publicProfile || "Ainda não identificado"}<AccountSource url={selected.crm?.qualification?.publicProfileSource} /></dd></div>
          <div><dt>Sinais logísticos</dt><dd>{selected.crm?.qualification?.logisticsSignals || "Ainda não identificados"}<AccountSource url={selected.crm?.qualification?.logisticsSignalsSource} /></dd></div>
          <div><dt>Compromissos ESG</dt><dd>{selected.crm?.qualification?.esgCommitments || "Ainda não identificados"}<AccountSource url={selected.crm?.qualification?.esgCommitmentsSource} /></dd></div>
          <div><dt>Última atualização</dt><dd>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString("pt-BR") : "Não informada"}</dd></div>
        </dl></section>
      </aside></div>
    </div>}
    {editingId && <AccountEditor client={clients.find((item) => item.id === editingId)} onClose={() => setEditingId("")} onSave={(payload) => saveClient(clients.find((item) => item.id === editingId), payload)} />}
    {taskClientId && <ClientTaskModal client={clients.find((item) => item.id === taskClientId)} suggestion={selectedIntelligence?.nextTask} currentUserId={currentUserId} pessoas={pessoas} onClose={() => setTaskClientId("")} onCreate={createTask} />}
  </section>;
}
