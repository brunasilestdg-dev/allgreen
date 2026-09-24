import { useState } from "react";
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Download,
  FileUp,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  bestOffersByItem,
  buildProcurementCsv,
  compareSupplierBids,
  parseSupplierProposal,
  procurementNumber,
  uid,
} from "../../domain.js";
import { DOCUMENT_ACCEPT } from "../../components/leituraDeArquivo.js";

const money = (value) =>
  Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

const blankItem = () => ({ id: uid(), name: "", quantity: 1, unit: "un" });
const blankRfq = () => ({
  title: "",
  description: "",
  deadline: "",
  priority: "equilibrio",
  status: "aberta",
  items: [blankItem()],
  bids: [],
});

function Dialog({ title, children, onClose, wide = false }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ProposalForm({
  rfq,
  initial,
  extractDocumentText,
  authHeaders,
  onSave,
  onClose,
  setToast,
}) {
  const emptyOffers = Object.fromEntries(
    rfq.items.map((item) => [item.id, { unitPrice: "", notes: "" }]),
  );
  const [form, setForm] = useState(
    initial || {
      supplierName: "",
      supplierContact: "",
      freight: "",
      taxes: "",
      discount: "",
      deliveryDays: "",
      paymentTerms: "",
      notes: "",
      offers: emptyOffers,
      addToContacts: false,
    },
  );
  const [reading, setReading] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setOffer = (itemId, key, value) =>
    setForm((current) => ({
      ...current,
      offers: {
        ...current.offers,
        [itemId]: { ...(current.offers[itemId] || {}), [key]: value },
      },
    }));
  const readFile = async (file) => {
    if (!file) return;
    setReading(true);
    try {
      const extracted = await extractDocumentText(file);
      const text = typeof extracted === "string" ? extracted : extracted?.content;
      if (!text?.trim()) throw new Error("Não encontrei texto legível no arquivo");
      const itemNames = rfq.items.map((i) => i.name).join(" | ");
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          specialist: "Compras",
          prompt:
            `Extraia esta cotação de fornecedor. Responda somente JSON válido com: ` +
            `supplierName, contact, freight, taxes, discount, deliveryDays, paymentTerms, notes ` +
            `e items:[{name,unitPrice,notes}]. Associe somente estes itens: ${itemNames}. ` +
            `Não invente valores ausentes, use 0 ou texto vazio.\n\nARQUIVO:\n${text.slice(0, 18000)}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "A IA não conseguiu ler a proposta");
      const parsed = parseSupplierProposal(data.content || data.text || "", rfq);
      if (!parsed) throw new Error("Não consegui estruturar os dados da proposta");
      setForm((current) => ({
        ...current,
        ...parsed,
        supplierName: parsed.supplierName || current.supplierName,
        offers: Object.fromEntries(
          rfq.items.map((item) => [
            item.id,
            {
              ...(current.offers[item.id] || {}),
              ...(parsed.offers[item.id] || {}),
            },
          ]),
        ),
        sourceFile: file.name,
      }));
      setToast("Proposta lida. Confira os valores antes de salvar.");
    } catch (error) {
      setToast(error.message || "Não foi possível ler o arquivo");
    } finally {
      setReading(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    if (!form.supplierName.trim()) {
      setToast("Informe o fornecedor");
      return;
    }
    onSave({
      ...form,
      id: form.id || uid(),
      supplierName: form.supplierName.trim(),
      updatedAt: new Date().toISOString(),
    });
  };
  return (
    <Dialog title={initial ? "Editar proposta" : "Adicionar proposta"} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="modal-body">
          <label className="rfq-file-import">
            <FileUp />
            <span>
              <strong>{reading ? "Lendo proposta..." : "Importar proposta"}</strong>
              <small>PDF, DOCX, XLSX, TXT, CSV ou foto (lida por OCR no aparelho). A IA extrai e padroniza os valores.</small>
            </span>
            <input
              type="file"
              accept={DOCUMENT_ACCEPT}
              disabled={reading}
              onChange={(e) => readFile(e.target.files?.[0])}
            />
          </label>
          <div className="form-grid">
            <label>
              Fornecedor
              <input
                value={form.supplierName}
                onChange={(e) => set("supplierName", e.target.value)}
                placeholder="Nome da empresa"
                autoFocus
              />
            </label>
            <label>
              Contato
              <input
                value={form.supplierContact}
                onChange={(e) => set("supplierContact", e.target.value)}
                placeholder="E-mail ou WhatsApp"
              />
            </label>
            <label>
              Frete
              <input value={form.freight} onChange={(e) => set("freight", e.target.value)} />
            </label>
            <label>
              Impostos adicionais
              <input value={form.taxes} onChange={(e) => set("taxes", e.target.value)} />
            </label>
            <label>
              Desconto
              <input value={form.discount} onChange={(e) => set("discount", e.target.value)} />
            </label>
            <label>
              Prazo em dias
              <input
                type="number"
                min="0"
                value={form.deliveryDays}
                onChange={(e) => set("deliveryDays", e.target.value)}
              />
            </label>
            <label className="span-2">
              Condição de pagamento
              <input
                value={form.paymentTerms}
                onChange={(e) => set("paymentTerms", e.target.value)}
                placeholder="Ex.: 30 dias, 50% no pedido"
              />
            </label>
          </div>
          <div className="rfq-offer-editor">
            <h3>Preços por item</h3>
            {rfq.items.map((item) => (
              <div className="rfq-offer-line" key={item.id}>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.quantity} {item.unit}
                  </small>
                </span>
                <label>
                  Preço unitário
                  <input
                    value={form.offers?.[item.id]?.unitPrice ?? ""}
                    onChange={(e) => setOffer(item.id, "unitPrice", e.target.value)}
                    placeholder="0,00"
                  />
                </label>
                <label>
                  Observação
                  <input
                    value={form.offers?.[item.id]?.notes ?? ""}
                    onChange={(e) => setOffer(item.id, "notes", e.target.value)}
                    placeholder="Marca, embalagem, MOQ..."
                  />
                </label>
              </div>
            ))}
          </div>
          <label>
            Observações gerais
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Validade da proposta, riscos, condições..."
            />
          </label>
          <div className="check-row">
            <input
              id="rfq-add-contact"
              aria-label="Adicionar este fornecedor aos Contatos"
              type="checkbox"
              checked={form.addToContacts === true}
              onChange={(e) => set("addToContacts", e.target.checked)}
            />
            <span>
              <strong>Adicionar este fornecedor aos Contatos</strong>
              <small>
                Opcional. A proposta e a comparação funcionam normalmente sem
                criar nenhum vínculo.
              </small>
            </span>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
          <button className="button primary" type="submit"><Save /> Salvar proposta</button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Procurement({
  db,
  update,
  business,
  setToast,
  extractDocumentText,
  authHeaders,
}) {
  const rfqs = (db.supplierRfqs || []).filter(
    (rfq) => !business || !rfq.businessId || rfq.businessId === business.id,
  );
  const [selectedId, setSelectedId] = useState(null);
  const [editingRfq, setEditingRfq] = useState(false);
  const [rfqForm, setRfqForm] = useState(blankRfq());
  const [proposal, setProposal] = useState(null);
  const selected = rfqs.find((rfq) => rfq.id === selectedId) || null;
  const ranked = compareSupplierBids(selected);
  const bestByItem = bestOffersByItem(selected);

  const openNew = () => {
    setRfqForm(blankRfq());
    setEditingRfq(true);
  };
  const openEdit = () => {
    setRfqForm({ ...selected, items: selected.items.map((item) => ({ ...item })) });
    setEditingRfq(true);
  };
  const setRfq = (key, value) =>
    setRfqForm((current) => ({ ...current, [key]: value }));
  const setItem = (id, key, value) =>
    setRfqForm((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    }));
  const saveRfq = (event) => {
    event.preventDefault();
    const items = rfqForm.items
      .filter((item) => item.name.trim())
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        quantity: procurementNumber(item.quantity) || 1,
      }));
    if (!rfqForm.title.trim() || !items.length) {
      setToast("Informe o título e pelo menos um item");
      return;
    }
    const now = new Date().toISOString();
    const saved = {
      ...rfqForm,
      title: rfqForm.title.trim(),
      items,
      id: rfqForm.id || uid(),
      ownerId: rfqForm.ownerId || db.user.id,
      businessId: rfqForm.businessId || business?.id || null,
      createdAt: rfqForm.createdAt || now,
      updatedAt: now,
    };
    update((current) => ({
      ...current,
      supplierRfqs: rfqForm.id
        ? (current.supplierRfqs || []).map((rfq) => (rfq.id === saved.id ? saved : rfq))
        : [saved, ...(current.supplierRfqs || [])],
    }));
    setSelectedId(saved.id);
    setEditingRfq(false);
    setToast(rfqForm.id ? "RFQ atualizada" : "RFQ criada");
  };
  const saveProposal = (bid) => {
    update((current) => ({
      ...current,
      supplierRfqs: (current.supplierRfqs || []).map((rfq) =>
        rfq.id !== selected.id
          ? rfq
          : {
              ...rfq,
              bids: (rfq.bids || []).some((item) => item.id === bid.id)
                ? rfq.bids.map((item) => (item.id === bid.id ? bid : item))
                : [...(rfq.bids || []), bid],
              updatedAt: new Date().toISOString(),
            },
      ),
      contacts: bid.addToContacts
        ? [
            {
              id:
                (current.contacts || []).find(
                  (contact) =>
                    contact.name?.trim().toLowerCase() ===
                    bid.supplierName.trim().toLowerCase(),
                )?.id || uid(),
              name: bid.supplierName,
              contact: bid.supplierContact || "",
              type: "Fornecedor",
              businessId: business?.id || null,
              ownerId: db.user.id,
              createdAt: new Date().toISOString(),
            },
            ...(current.contacts || []).filter(
              (contact) =>
                contact.name?.trim().toLowerCase() !==
                bid.supplierName.trim().toLowerCase(),
            ),
          ]
        : current.contacts || [],
    }));
    setProposal(null);
    setToast(
      bid.addToContacts
        ? "Proposta adicionada e fornecedor salvo em Contatos"
        : "Proposta adicionada à comparação",
    );
  };
  const chooseWinner = (bid) => {
    update((current) => ({
      ...current,
      supplierRfqs: (current.supplierRfqs || []).map((rfq) =>
        rfq.id === selected.id
          ? {
              ...rfq,
              winnerBidId: bid.id,
              status: "decidida",
              decidedAt: new Date().toISOString(),
            }
          : rfq,
      ),
    }));
    setToast(`${bid.supplierName} selecionado. A decisão ficou registrada.`);
  };
  const createNegotiationTask = (bid) => {
    update((current) => ({
      ...current,
      tasks: [
        {
          id: uid(),
          title: `Negociar ${selected.title} com ${bid.supplierName}`,
          description:
            `Proposta de ${money(bid.metrics.total)}, prazo de ${bid.deliveryDays || 0} dias ` +
            `e cobertura de ${bid.metrics.coverage}%. Validar frete, impostos, pagamento e condições antes de fechar.`,
          status: "A fazer",
          priority: "Alta",
          due: selected.deadline || "",
          area: "Compras",
          businessId: selected.businessId || null,
          ownerId: db.user.id,
          sourceSupplierRfqId: selected.id,
        },
        ...(current.tasks || []),
      ],
    }));
    setToast("Tarefa de negociação criada em Operação");
  };
  const exportCsv = () => {
    const blob = new Blob(["\ufeff" + buildProcurementCsv(selected)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `comparacao-${selected.title.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (selected) {
    return (
      <main className="page procurement-page">
        <button className="text-button" onClick={() => setSelectedId(null)}>
          <ArrowLeft /> Voltar às cotações
        </button>
        <header className="page-title">
          <div>
            <span className="eyebrow">COMPRAS E FORNECEDORES</span>
            <h1>{selected.title}</h1>
            <p>
              {selected.items.length} item(ns) · prioridade{" "}
              {selected.priority === "prazo" ? "menor prazo" : selected.priority === "preco" ? "menor preço" : "equilíbrio"}
              {selected.deadline ? ` · respostas até ${selected.deadline}` : ""}
            </p>
          </div>
          <div className="page-actions">
            <button className="button ghost" onClick={openEdit}>Editar RFQ</button>
            <button className="button ghost" onClick={exportCsv} disabled={!ranked.length}>
              <Download /> Exportar
            </button>
            <button className="button primary" onClick={() => setProposal({})}>
              <Plus /> Adicionar proposta
            </button>
          </div>
        </header>

        {!ranked.length ? (
          <section className="empty">
            <Users />
            <h2>Nenhuma proposta recebida</h2>
            <p>Importe arquivos ou registre os valores enviados pelos fornecedores.</p>
            <button className="button primary" onClick={() => setProposal({})}>
              Adicionar primeira proposta
            </button>
          </section>
        ) : (
          <>
            <section className="section rfq-ranking">
              <div className="section-head">
                <div>
                  <span className="eyebrow">RANKING CALCULADO</span>
                  <h2>Comparação geral</h2>
                </div>
              </div>
              <div className="rfq-rank-grid">
                {ranked.map((bid) => (
                  <article
                    className={`rfq-rank-card ${selected.winnerBidId === bid.id ? "winner" : ""}`}
                    key={bid.id}
                  >
                    <div className="rfq-rank-number">#{bid.rank}</div>
                    <div>
                      <strong>{bid.supplierName}</strong>
                      <small>
                        {bid.metrics.coverage}% dos itens · {bid.deliveryDays || "?"} dias
                      </small>
                    </div>
                    <b>{money(bid.metrics.total)}</b>
                    <div className="rfq-rank-actions">
                      <button className="text-button" onClick={() => setProposal(bid)}>Editar</button>
                      <button className="text-button" onClick={() => createNegotiationTask(bid)}>
                        Negociar
                      </button>
                      <button className="button primary" onClick={() => chooseWinner(bid)}>
                        {selected.winnerBidId === bid.id ? <CheckCircle2 /> : <Award />}
                        {selected.winnerBidId === bid.id ? "Selecionado" : "Selecionar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="section rfq-table-wrap">
              <div className="section-head">
                <div>
                  <span className="eyebrow">ITEM A ITEM</span>
                  <h2>Mapa de cotação</h2>
                </div>
              </div>
              <div className="table-scroll">
                <table className="rfq-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantidade</th>
                      {ranked.map((bid) => <th key={bid.id}>{bid.supplierName}</th>)}
                      <th>Melhor preço</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item) => {
                      const best = bestByItem.find((entry) => entry.itemId === item.id)?.best;
                      return (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.quantity} {item.unit}</td>
                          {ranked.map((bid) => {
                            const price = procurementNumber(bid.offers?.[item.id]?.unitPrice);
                            return <td key={bid.id}>{price ? money(price) : "Não cotado"}</td>;
                          })}
                          <td className="rfq-best">
                            {best ? `${best.supplierName} · ${money(best.unitPrice)}` : "Sem proposta"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {proposal && (
          <ProposalForm
            rfq={selected}
            initial={proposal.id ? proposal : null}
            extractDocumentText={extractDocumentText}
            authHeaders={authHeaders}
            onSave={saveProposal}
            onClose={() => setProposal(null)}
            setToast={setToast}
          />
        )}
        {editingRfq && renderRfqDialog()}
      </main>
    );
  }

  function renderRfqDialog() {
    return (
      <Dialog title={rfqForm.id ? "Editar RFQ" : "Nova solicitação de cotação"} onClose={() => setEditingRfq(false)} wide>
        <form onSubmit={saveRfq}>
          <div className="modal-body">
            <div className="form-grid">
              <label className="span-2">
                Título
                <input value={rfqForm.title} onChange={(e) => setRfq("title", e.target.value)} placeholder="Ex.: Embalagens para lavanderia" autoFocus />
              </label>
              <label>
                Prazo para resposta
                <input type="date" value={rfqForm.deadline} onChange={(e) => setRfq("deadline", e.target.value)} />
              </label>
              <label>
                Prioridade
                <select value={rfqForm.priority} onChange={(e) => setRfq("priority", e.target.value)}>
                  <option value="equilibrio">Equilíbrio</option>
                  <option value="preco">Menor preço</option>
                  <option value="prazo">Menor prazo</option>
                </select>
              </label>
              <label className="span-2">
                Escopo e requisitos
                <textarea value={rfqForm.description} onChange={(e) => setRfq("description", e.target.value)} placeholder="Qualidade esperada, local de entrega, condições obrigatórias..." />
              </label>
            </div>
            <div className="rfq-items-editor">
              <div className="section-head">
                <h3>Itens solicitados</h3>
                <button type="button" className="text-button" onClick={() => setRfq("items", [...rfqForm.items, blankItem()])}>
                  <Plus /> Adicionar item
                </button>
              </div>
              {rfqForm.items.map((item) => (
                <div className="rfq-item-line" key={item.id}>
                  <input value={item.name} onChange={(e) => setItem(item.id, "name", e.target.value)} placeholder="Descrição do item" />
                  <input type="number" min="0.01" step="any" value={item.quantity} onChange={(e) => setItem(item.id, "quantity", e.target.value)} />
                  <input value={item.unit} onChange={(e) => setItem(item.id, "unit", e.target.value)} placeholder="un" />
                  <button type="button" className="icon-button" aria-label="Remover item" onClick={() => setRfq("items", rfqForm.items.length > 1 ? rfqForm.items.filter((current) => current.id !== item.id) : rfqForm.items)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={() => setEditingRfq(false)}>Cancelar</button>
            <button className="button primary" type="submit"><Save /> Salvar RFQ</button>
          </div>
        </form>
      </Dialog>
    );
  }

  return (
    <main className="page procurement-page">
      <header className="page-title">
        <div>
          <span className="eyebrow">COMPRAS E FORNECEDORES</span>
          <h1>Cotações de fornecedores</h1>
          <p>Crie RFQs, importe propostas em formatos diferentes, compare custo e prazo e registre a decisão.</p>
        </div>
        <button className="button primary" onClick={openNew}><Plus /> Nova RFQ</button>
      </header>
      {!rfqs.length ? (
        <section className="empty">
          <Sparkles />
          <h2>Compare fornecedores com os mesmos critérios</h2>
          <p>Comece pelos itens necessários. Depois importe cada proposta para montar o mapa de cotação.</p>
          <button className="button primary" onClick={openNew}>Criar primeira RFQ</button>
        </section>
      ) : (
        <div className="rfq-list">
          {rfqs.map((rfq) => {
            const winner = rfq.bids?.find((bid) => bid.id === rfq.winnerBidId);
            return (
              <button className="rfq-list-card" key={rfq.id} onClick={() => setSelectedId(rfq.id)}>
                <span className={`quote-status ${rfq.status === "decidida" ? "ok" : "info"}`}>
                  {rfq.status === "decidida" ? "Decidida" : "Em cotação"}
                </span>
                <strong>{rfq.title}</strong>
                <small>{rfq.items.length} item(ns) · {rfq.bids?.length || 0} proposta(s)</small>
                {winner && <span className="rfq-winner"><Award /> {winner.supplierName}</span>}
              </button>
            );
          })}
        </div>
      )}
      {editingRfq && renderRfqDialog()}
    </main>
  );
}
