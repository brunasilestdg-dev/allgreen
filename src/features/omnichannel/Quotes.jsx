import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Link2,
  Pencil,
  Plus,
  ReceiptText,
  Send,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, PageTitle } from "../../components/ui.jsx";
import { contactLinks, uid } from "../../domain.js";

const money = (v) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const QUOTE_STATUS = {
  rascunho: { label: "Rascunho", tone: "muted" },
  enviado: { label: "Enviado", tone: "info" },
  aprovado: { label: "Aprovado", tone: "ok" },
  recusado: { label: "Recusado", tone: "bad" },
};

export default function Quotes({
  db,
  update,
  business,
  setToast,
  go,
  authHeaders,
  buildOrderReceita,
  logInteraction,
  orderFromQuote,
  quoteTotal,
  SharingFields,
  upsertContact,
  useWhatsappSender,
}) {
  const blankItem = () => ({ id: uid(), name: "", quantity: 1, price: "" });
  const blankQuote = {
    clientName: "",
    clientContact: "",
    items: [blankItem()],
    discount: "",
    validUntil: "",
    notes: "",
    status: "rascunho",
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankQuote);
  const [publicStatus, setPublicStatus] = useState({});
  const wa = useWhatsappSender({ db, setToast });
  const quotes = (db.quotes || []).filter(
    (q) => !business || !q.businessId || q.businessId === business.id,
  );
  useEffect(() => {
    fetch("/api/quotes/status", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const map = {};
        for (const it of d.items || []) map[it.quoteId] = it;
        setPublicStatus(map);
      })
      .catch(() => {});
  }, [authHeaders, db.quotes?.length]);
  const shareQuote = async (q) => {
    try {
      const r = await fetch("/api/quotes/share", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ quote: q, businessName: business?.name || "" }),
      });
      const d = await r.json();
      if (!r.ok || !d.url) throw new Error(d.error || "Falha ao gerar o link");
      setPublicStatus((prev) => ({
        ...prev,
        [q.id]: { quoteId: q.id, token: d.token, status: "pendente" },
      }));
      try {
        await navigator.clipboard.writeText(d.url);
        setToast("Link do orçamento copiado — envie ao cliente");
      } catch {
        setToast(`Link do orçamento: ${d.url}`);
      }
    } catch (error) {
      setToast(error.message || "Não foi possível gerar o link agora");
    }
  };
  const openQuote = (q = null) => {
    setEditing(q?.id || null);
    setForm(
      q
        ? {
            ...blankQuote,
            ...q,
            items: (q.items || []).length ? q.items : [blankItem()],
          }
        : { ...blankQuote, items: [blankItem()] },
    );
    setModal(true);
  };
  const setItem = (id, patch) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  const addItem = () =>
    setForm((f) => ({ ...f, items: [...f.items, blankItem()] }));
  const removeItem = (id) =>
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((i) => i.id !== id) : f.items,
    }));
  const save = (e) => {
    e.preventDefault();
    if (!form.clientName.trim()) return;
    const now = new Date().toISOString();
    const items = form.items
      .filter((i) => i.name.trim())
      .map((i) => ({
        ...i,
        name: i.name.trim(),
        quantity: Number(i.quantity) || 1,
        price: Number(i.price) || 0,
      }));
    if (!items.length) {
      setToast("Adicione ao menos um item ao orçamento");
      return;
    }
    const item = {
      ...form,
      items,
      clientName: form.clientName.trim(),
      discount: Number(form.discount) || 0,
      id: editing || uid(),
      businessId: business?.id || form.businessId || null,
      ownerId: form.ownerId || db.user.id,
      createdAt: form.createdAt || now,
      updatedAt: now,
    };
    item.total = quoteTotal(item);
    update((d) => ({
      ...d,
      quotes: editing
        ? (d.quotes || []).map((q) => (q.id === editing ? item : q))
        : [item, ...(d.quotes || [])],
      contacts: upsertContact(d.contacts || [], {
        name: item.clientName,
        contact: item.clientContact,
        businessId: item.businessId,
        ownerId: db.user.id,
      }),
    }));
    setModal(false);
    setEditing(null);
    setForm(blankQuote);
    setToast(editing ? "Orçamento atualizado" : "Orçamento criado");
  };
  const setStatus = (quote, status) =>
    update((d) => ({
      ...d,
      quotes: (d.quotes || []).map((q) =>
        q.id === quote.id
          ? { ...q, status, updatedAt: new Date().toISOString() }
          : q,
      ),
    }));
  const sendWhatsapp = (quote) => {
    const links = contactLinks(quote.clientContact);
    if (!links.phone) {
      setToast("Este cliente não tem um WhatsApp válido");
      return;
    }
    const lines = (quote.items || [])
      .map(
        (i) =>
          `• ${i.quantity}x ${i.name} — ${money((Number(i.price) || 0) * (Number(i.quantity) || 0))}`,
      )
      .join("\n");
    wa.open({
      phone: links.phone,
      category: "orcamento",
      contactName: quote.clientName,
      vars: { nome: quote.clientName, total: money(quoteTotal(quote)) },
    });
    if (quote.status === "rascunho") setStatus(quote, "enviado");
    logInteraction({
      channel: "note",
      direction: "out",
      contactName: quote.clientName,
      contactHandle: links.phone,
      subject: "Orçamento enviado",
      body: `Orçamento de ${money(quoteTotal(quote))}:\n${lines}`,
    });
  };
  const approveToOrder = (quote) => {
    const order = orderFromQuote(quote, {
      businessId: business?.id || quote.businessId || null,
      ownerId: db.user.id,
    });
    const receita = buildOrderReceita(order, {
      businessId: order.businessId,
      ownerId: db.user.id,
    });
    update((d) => ({
      ...d,
      orders: [order, ...(d.orders || [])],
      transactions: receita
        ? [receita, ...(d.transactions || [])]
        : d.transactions || [],
      quotes: (d.quotes || []).map((q) =>
        q.id === quote.id
          ? {
              ...q,
              status: "aprovado",
              convertedOrderId: order.id,
              updatedAt: new Date().toISOString(),
            }
          : q,
      ),
      contacts: upsertContact(d.contacts || [], {
        name: quote.clientName,
        contact: quote.clientContact,
        businessId: order.businessId,
        ownerId: db.user.id,
      }),
    }));
    const links = contactLinks(quote.clientContact);
    logInteraction({
      channel: "note",
      direction: "out",
      contactName: quote.clientName,
      contactHandle: links.phone || links.email || quote.clientContact || "",
      subject: "Orçamento aprovado",
      body: `Orçamento aprovado e convertido em pedido — ${money(quoteTotal(quote))}.`,
    });
    setToast("Orçamento aprovado — pedido gerado e receita lançada");
  };
  const remove = (id) =>
    update((d) => ({
      ...d,
      quotes: (d.quotes || []).filter((q) => q.id !== id),
    }));
  const previewTotal = quoteTotal({
    items: form.items.map((i) => ({
      price: Number(i.price) || 0,
      quantity: Number(i.quantity) || 0,
    })),
    discount: Number(form.discount) || 0,
  });
  return (
    <PageTitle
      eyebrow="VENDAS E CLIENTES"
      title="Orçamentos"
      text="Monte um orçamento, envie ao cliente e, quando aprovado, vire pedido com um clique — a receita entra no caixa sozinha."
      action={
        <Button icon={Plus} onClick={() => openQuote()}>
          Novo orçamento
        </Button>
      }
    >
      {quotes.length === 0 ? (
        <Empty
          icon={ReceiptText}
          title="Nenhum orçamento ainda"
          text="Crie um orçamento para o cliente. Quando ele aprovar, você gera o pedido e a receita entra no caixa automaticamente."
          action="Criar orçamento"
          onAction={() => openQuote()}
        />
      ) : (
        <div className="quote-list">
          {quotes.map((q) => {
            const st = QUOTE_STATUS[q.status] || QUOTE_STATUS.rascunho;
            return (
              <div key={q.id} className="quote-card">
                <div className="quote-head">
                  <div>
                    <strong>{q.clientName}</strong>
                    <small>
                      {(q.items || []).length} item(ns)
                      {q.validUntil ? ` · válido até ${q.validUntil}` : ""}
                    </small>
                  </div>
                  <span className={`quote-status ${st.tone}`}>{st.label}</span>
                </div>
                <div className="quote-total">{money(quoteTotal(q))}</div>
                {publicStatus[q.id]?.status === "aprovado" &&
                  q.status !== "aprovado" && (
                    <div className="quote-client-decision ok">
                      <CheckCircle2 /> Aprovado pelo cliente — gere o pedido
                      abaixo
                    </div>
                  )}
                {publicStatus[q.id]?.status === "recusado" &&
                  q.status !== "recusado" && (
                    <div className="quote-client-decision bad">
                      <CircleAlert /> Recusado pelo cliente
                    </div>
                  )}
                <div className="quote-actions">
                  <Button variant="ghost" icon={Pencil} onClick={() => openQuote(q)}>
                    Editar
                  </Button>
                  {q.status !== "aprovado" &&
                    contactLinks(q.clientContact).phone && (
                      <Button
                        variant="ghost"
                        icon={Send}
                        onClick={() => sendWhatsapp(q)}
                      >
                        Enviar
                      </Button>
                    )}
                  {q.status !== "aprovado" && (
                    <Button
                      variant="ghost"
                      icon={Link2}
                      onClick={() => shareQuote(q)}
                    >
                      {publicStatus[q.id] ? "Copiar link" : "Link para aprovar"}
                    </Button>
                  )}
                  {q.status !== "aprovado" && (
                    <Button icon={CheckCircle2} onClick={() => approveToOrder(q)}>
                      Aprovar e gerar pedido
                    </Button>
                  )}
                  {q.status === "aprovado" && q.convertedOrderId && (
                    <Button
                      variant="ghost"
                      icon={ShoppingBag}
                      onClick={() => go("produtos")}
                    >
                      Ver pedido
                    </Button>
                  )}
                  {q.status !== "aprovado" && q.status !== "recusado" && (
                    <Button variant="ghost" onClick={() => setStatus(q, "recusado")}>
                      Recusar
                    </Button>
                  )}
                  <Button variant="ghost" icon={Trash2} onClick={() => remove(q.id)}>
                    Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal && (
        <Modal
          title={editing ? "Editar orçamento" : "Novo orçamento"}
          wide
          onClose={() => {
            setModal(false);
            setEditing(null);
          }}
        >
          <form className="modal-body" onSubmit={save}>
            <div className="form-grid">
              <Field label="Cliente">
                <input
                  value={form.clientName}
                  onChange={(e) =>
                    setForm({ ...form, clientName: e.target.value })
                  }
                  placeholder="Nome do cliente"
                />
              </Field>
              <Field label="WhatsApp ou e-mail">
                <input
                  value={form.clientContact}
                  onChange={(e) =>
                    setForm({ ...form, clientContact: e.target.value })
                  }
                  placeholder="(11) 90000-0000 ou email@..."
                />
              </Field>
            </div>
            <div className="field">
              <span>Itens</span>
              <div className="quote-items">
                {form.items.map((i) => (
                  <div key={i.id} className="quote-item-row">
                    <input
                      className="qi-name"
                      value={i.name}
                      onChange={(e) => setItem(i.id, { name: e.target.value })}
                      placeholder="Descrição (ex.: Frete Middle Mile SP→RJ, 12 t)"
                    />
                    <input
                      className="qi-qty"
                      type="number"
                      min="1"
                      value={i.quantity}
                      onChange={(e) =>
                        setItem(i.id, { quantity: e.target.value })
                      }
                    />
                    <input
                      className="qi-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={i.price}
                      onChange={(e) => setItem(i.id, { price: e.target.value })}
                      placeholder="Preço un."
                    />
                    <button
                      type="button"
                      className="qi-remove"
                      onClick={() => removeItem(i.id)}
                      aria-label="Remover item"
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" icon={Plus} onClick={addItem}>
                Adicionar item
              </Button>
            </div>
            <div className="form-grid">
              <Field label="Desconto (R$)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: e.target.value })}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Válido até">
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={(e) =>
                    setForm({ ...form, validUntil: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Observações">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Condições, prazos, forma de pagamento..."
              />
            </Field>
            <div className="quote-total-preview">
              Total: <strong>{money(previewTotal)}</strong>
            </div>
            <SharingFields
              value={{
                visibility: form.visibility,
                sharedWith: form.sharedWith,
                sharedTeams: form.sharedTeams,
              }}
              onChange={(next) => setForm({ ...form, ...next })}
              teams={db.teams}
              hideProjectField
            />
            <div className="wa-send-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setModal(false);
                  setEditing(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" icon={Check}>
                {editing ? "Salvar" : "Criar orçamento"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {wa.modal}
    </PageTitle>
  );
}
