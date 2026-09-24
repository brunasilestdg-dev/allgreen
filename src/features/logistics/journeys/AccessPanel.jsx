// Jornada de acessos: pedidos feitos na tela de login e a liberação de
// usuários por perfil pronto ou por funcionalidade.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import {
  TODO_GREEN_PERMISSION_CATALOG,
  TODO_GREEN_PERMISSIONS,
  TODO_GREEN_ROLES,
  hasTodoGreenPermission,
} from "../logisticsVerticalDomain.js";
import { ownerId } from "../shell/acesso.js";

export default function AccessPanel({ role, permissions, authHeaders, setToast }) {
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const [form, setForm] = useState({ email: "", role: "admin", note: "", expiresAt: "", customPermissions: false, permissions: [] });
  // Quando o e-mail não está configurado (ou o envio falha), o convite continua
  // válido e o link volta na resposta. Guardamos aqui para o administrador
  // copiar e entregar manualmente (WhatsApp, etc.) — o acesso nunca fica preso
  // à entrega automática. `{ email, link, expiresAt }`.
  const [conviteManual, setConviteManual] = useState(null);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const copiarConvite = async () => {
    if (!conviteManual?.link) return;
    try {
      await navigator.clipboard.writeText(conviteManual.link);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2500);
    } catch {
      setToast?.("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  };
  // Fila dos pedidos feitos na tela de login (migração 0086). Aprovar aqui
  // concede pelo mesmo caminho da liberação manual por e-mail.
  const [pedidos, setPedidos] = useState([]);
  const [carregandoPedidos, setCarregandoPedidos] = useState(false);
  const [papelDoPedido, setPapelDoPedido] = useState({});
  const [decidindo, setDecidindo] = useState("");
  const canManage = hasTodoGreenPermission(role, "access:manage", permissions);
  const carregarPedidos = useCallback(() => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    setCarregandoPedidos(true);
    fetch(`/api/todogreen/access-requests?owner=${encodeURIComponent(ownerId())}`, { headers })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os pedidos.");
        setPedidos(payload.requests || []);
      })
      .catch((error) => setToast?.(error.message))
      .finally(() => setCarregandoPedidos(false));
  }, [authHeaders, canManage, setToast]);
  useEffect(() => { carregarPedidos(); }, [carregarPedidos]);
  const decidirPedido = async (pedido, decisao) => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    if (decisao === "recusar" && !confirm(`Recusar o pedido de ${pedido.email}?`)) return;
    setDecidindo(pedido.id);
    try {
      const body = { id: pedido.id, decisao };
      if (decisao === "aprovar") body.role = papelDoPedido[pedido.id] || "auditor";
      const response = await fetch(`/api/todogreen/access-requests?owner=${encodeURIComponent(ownerId())}`, {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível decidir o pedido.");
      if (decisao === "aprovar" && payload.inviteLink)
        setConviteManual({ email: pedido.email, link: payload.inviteLink, expiresAt: payload.inviteExpiresAt, emailSent: payload.invitationSent });
      setToast?.(decisao === "aprovar"
        ? payload.invitationSent
          ? `Acesso aprovado e convite enviado para ${pedido.email}.`
          : payload.invitationError || `Acesso aprovado para ${pedido.email}.`
        : `Pedido de ${pedido.email} recusado.`);
      carregarPedidos();
      if (decisao === "aprovar") load();
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setDecidindo("");
    }
  };
  const load = useCallback(() => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    setLoading(true);
    fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}`, { headers })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os acessos.");
        setEmails(payload.emails || []);
        setLoadedAt(Date.now());
      })
      .catch((error) => setToast?.(error.message))
      .finally(() => setLoading(false));
  }, [authHeaders, canManage, setToast]);
  useEffect(() => { load(); }, [load]);
  const save = async (event) => {
    event.preventDefault();
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    setSaving(true);
    try {
      const body = {
        email: form.email,
        role: form.role,
        note: form.note,
        ...(form.customPermissions ? { permissions: form.permissions } : {}),
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59.999Z`).toISOString() : "",
      };
      const response = await fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar o acesso.");
      if (payload.inviteLink)
        setConviteManual({ email: payload.email, link: payload.inviteLink, expiresAt: payload.inviteExpiresAt, emailSent: payload.invitationSent });
      setForm({ email: "", role: "admin", note: "", expiresAt: "", customPermissions: false, permissions: [] });
      setToast?.(
        payload.invitationSent
          ? `Acesso salvo e convite enviado para ${payload.email}.`
          : payload.invitationError || "E-mail autorizado na To Do Green",
      );
      load();
    } catch (error) {
      setToast?.(error.message);
    } finally {
      setSaving(false);
    }
  };
  const alternarPermissao = (permission) => setForm((current) => ({
    ...current,
    permissions: current.permissions.includes(permission)
      ? current.permissions.filter((item) => item !== permission)
      : [...current.permissions, permission],
  }));
  const selecionarPerfilAtual = () => setForm((current) => ({
    ...current,
    permissions: (TODO_GREEN_PERMISSIONS[current.role] || []).filter((item) => item !== "*"),
  }));
  const remove = async (email) => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    if (!confirm(`Remover o acesso de ${email}?`)) return;
    try {
      const response = await fetch(`/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}&email=${encodeURIComponent(email)}`, { method: "DELETE", headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível remover o acesso.");
      load();
      setToast?.("Acesso revogado e preservado na auditoria");
    } catch (error) {
      setToast?.(error.message);
    }
  };
  const resend = async (email) => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization || !canManage) return;
    try {
      const response = await fetch(
        `/api/todogreen/access-list?owner=${encodeURIComponent(ownerId())}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ action: "resend", email }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível reenviar o convite.");
      if (payload.inviteLink)
        setConviteManual({ email, link: payload.inviteLink, expiresAt: payload.inviteExpiresAt, emailSent: payload.invitationSent });
      setToast?.(
        payload.invitationSent
          ? `Convite reenviado para ${email}.`
          : `Convite gerado para ${email}. Copie o link abaixo e envie manualmente.`,
      );
    } catch (error) {
      setToast?.(error.message);
    }
  };
  if (!canManage) return <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">ACESSOS</span><h2>Você tem acesso, mas não pode gerenciar usuários.</h2></div><strong>{role || "sem papel"}</strong></div></section>;
  return (
    <section className="tdg-panel tdg-access-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">ACESSOS</span><h2>Autorize usuários por perfil pronto ou selecione cada funcionalidade.</h2></div><strong>{loading ? "carregando" : `${emails.length} e-mail(s)`}</strong></div>
      {conviteManual && (
        <div className="tdg-invite-link" role="status">
          <div className="tdg-invite-link-topo">
            <strong>Link de convite para {conviteManual.email}</strong>
            <button type="button" className="tdg-invite-link-fechar" aria-label="Fechar" onClick={() => setConviteManual(null)}>×</button>
          </div>
          <p>{conviteManual.emailSent
            ? "Convite enviado por e-mail. Você também pode copiar o link e enviar por outro canal (WhatsApp, etc.) — ambos levam à mesma tela onde a pessoa define a própria senha."
            : "O e-mail automático não está configurado (ou o envio falhou). O acesso já está autorizado — copie o link abaixo e envie para a pessoa (WhatsApp, etc.). Nele ela define a própria senha no primeiro acesso."}{conviteManual.expiresAt ? ` O convite expira em ${new Date(conviteManual.expiresAt).toLocaleDateString("pt-BR")}.` : ""}</p>
          <div className="tdg-invite-link-campo">
            <input type="text" readOnly value={conviteManual.link} onFocus={(e) => e.target.select()} />
            <button type="button" className="tdg-action" onClick={copiarConvite}>{linkCopiado ? "Copiado!" : "Copiar link"}</button>
          </div>
        </div>
      )}
      {(() => {
        const pendentes = pedidos.filter((item) => item.status === "pending");
        const decididos = pedidos.filter((item) => item.status !== "pending").slice(0, 20);
        return (
          <div className="tdg-access-requests">
            <div className="tdg-section-head"><div><span className="tdg-kicker">PEDIDOS DE ACESSO</span><h3>Solicitações feitas na tela de login</h3></div><strong>{carregandoPedidos ? "carregando" : `${pendentes.length} pendente(s)`}</strong></div>
            {!carregandoPedidos && pendentes.length === 0 && <p className="tdg-empty">Nenhum pedido pendente.</p>}
            {pendentes.map((pedido) => (
              <div className="tdg-access-request" key={pedido.id}>
                <div className="tdg-access-request-quem">
                  <strong>{pedido.name || pedido.email}</strong>
                  <small>{pedido.email}{pedido.company ? ` · ${pedido.company}` : ""}{pedido.phone ? ` · ${pedido.phone}` : ""}</small>
                  {pedido.message && <p className="tdg-access-request-msg">{pedido.message}</p>}
                  <small className="tdg-access-request-data">Pedido em {new Date(pedido.createdAt).toLocaleString("pt-BR")}</small>
                </div>
                <div className="tdg-access-request-acoes">
                  <label><span>Perfil ao aprovar</span>
                    <select
                      value={papelDoPedido[pedido.id] || "auditor"}
                      onChange={(e) => setPapelDoPedido((atual) => ({ ...atual, [pedido.id]: e.target.value }))}
                    >
                      {TODO_GREEN_ROLES.filter((item) => item !== "owner").map((item) => <option value={item} key={item}>{item.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                  <div className="tdg-access-request-botoes">
                    <button type="button" className="tdg-action" disabled={decidindo === pedido.id} onClick={() => decidirPedido(pedido, "aprovar")}>
                      <ShieldCheck size={16} />{decidindo === pedido.id ? "..." : "Aprovar"}
                    </button>
                    <button type="button" disabled={decidindo === pedido.id} onClick={() => decidirPedido(pedido, "recusar")}>
                      Recusar
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {decididos.length > 0 && (
              <details className="tdg-access-request-historico">
                <summary>{decididos.length} pedido(s) já decidido(s)</summary>
                {decididos.map((pedido) => (
                  <div className="tdg-access-request-decidido" key={pedido.id}>
                    <span><strong>{pedido.name || pedido.email}</strong><small>{pedido.email}</small></span>
                    <span className={pedido.status === "approved" ? "good" : ""}>{pedido.status === "approved" ? `aprovado · ${(pedido.decidedRole || "").replace(/_/g, " ")}` : "recusado"}</span>
                    <small>{pedido.decidedAt ? new Date(pedido.decidedAt).toLocaleDateString("pt-BR") : ""}</small>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })()}
      <form className="tdg-access-form" onSubmit={save}>
        <label><span>E-mail da pessoa</span><input value={form.email} type="email" required placeholder="nome@empresa.com.br" onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /><small>Ela receberá um convite para criar a própria senha.</small></label>
        <label><span>Perfil base</span><select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>{TODO_GREEN_ROLES.filter((item) => item !== "owner").map((item) => <option value={item} key={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
        <label><span>Tipo de acesso</span><select value={form.customPermissions ? "custom" : "profile"} onChange={(event) => setForm((current) => ({ ...current, customPermissions: event.target.value === "custom", permissions: event.target.value === "custom" ? (TODO_GREEN_PERMISSIONS[current.role] || []).filter((item) => item !== "*") : [] }))}><option value="profile">Perfil pronto</option><option value="custom">Funcionalidades selecionadas</option></select></label>
        <label><span>Validade</span><input type="date" value={form.expiresAt} onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))} /><small>Vazio mantém o acesso sem expiração.</small></label>
        <label><span>Observação</span><input value={form.note} placeholder="Ex.: implantação, auditor externo" onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
        {form.customPermissions && <div className="tdg-permission-editor"><div className="tdg-permission-editor-head"><strong>Funcionalidades liberadas</strong><button type="button" onClick={selecionarPerfilAtual}>Restaurar perfil base</button></div>{TODO_GREEN_PERMISSION_CATALOG.map((group) => <fieldset key={group.group}><legend>{group.group}</legend>{group.items.map(([permission, label]) => <label className="tdg-check-field" key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={() => alternarPermissao(permission)} /><span>{label}</span></label>)}</fieldset>)}</div>}
        <button className="tdg-action" type="submit" disabled={saving || (form.customPermissions && !form.permissions.includes("read"))}><Plus size={17} />{saving ? "Enviando..." : "Autorizar e enviar convite"}</button>
      </form>
      {form.customPermissions && !form.permissions.includes("read") && <div className="tdg-alert"><AlertTriangle size={17} />Selecione “Acessar a vertical” para liberar a entrada.</div>}
      <div className="tdg-access-list">{emails.length === 0 && <div className="tdg-empty-access"><ShieldCheck size={18} />Nenhum e-mail autorizado ainda.</div>}{emails.map((item) => { const expired = item.expiresAt && loadedAt > 0 && Date.parse(item.expiresAt) <= loadedAt; const active = item.status === "active" && !item.revokedAt && !expired; const defaults = TODO_GREEN_PERMISSIONS[item.role] || []; const customized = !defaults.includes("*") && JSON.stringify([...(item.permissions || [])].sort()) !== JSON.stringify([...defaults].sort()); return <div className="tdg-access-row" key={item.email}><span><strong>{item.email}</strong><small>{item.note || "sem observação"}{item.lastAccessAt ? ` · último acesso ${new Date(item.lastAccessAt).toLocaleString("pt-BR")}` : ""}</small></span><span>{item.role.replace(/_/g, " ")}<small>{customized ? `${item.permissions?.length || 0} funcionalidades` : "perfil pronto"}</small></span><span className={active ? "good" : ""}>{active ? item.expiresAt ? `ativo até ${new Date(item.expiresAt).toLocaleDateString("pt-BR")}` : "ativo" : item.revokedAt ? "revogado" : expired ? "expirado" : "inativo"}</span>{active && <><button type="button" onClick={() => resend(item.email)} aria-label={`Reenviar convite para ${item.email}`}><RefreshCw size={17} /></button><button type="button" onClick={() => remove(item.email)} aria-label={`Revogar ${item.email}`}><Trash2 size={17} /></button></>}</div>; })}</div>
    </section>
  );
}
