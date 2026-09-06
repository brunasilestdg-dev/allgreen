import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Edit3,
  MapPin,
  MessageSquareText,
  Plus,
  ReceiptText,
  Save,
  Search,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { contactLinks, uid } from "../../domain.js";
import { buildOrderReceita } from "../../domain/vendas.js";
import Modal from "../../components/Modal.jsx";
import { Button, Empty, Field, LIST_PAGE_SIZE, LoadMoreButton, PageTitle } from "../../components/ui.jsx";
import { logInteraction } from "../../session/telemetria.js";
import { money } from "../../components/formato.js";
import SharingFields from "../../components/SharingFields.jsx";

const orderStatuses = [
  "Novo",
  "Preparando",
  "Pronto",
  "Enviado",
  "Entregue",
  "Cancelado",
];
const orderChannels = ["Balcão", "Retirada", "Delivery", "Online", "Mesa"];

function Catalog({ db, update, business, setToast, go: _go, upsertContact, useWhatsappSender }) {
  const wa = useWhatsappSender({ db, setToast });
  const [view, setView] = useState("produtos"),
    [search, setSearch] = useState(""),
    [productModal, setProductModal] = useState(false),
    [editingProduct, setEditingProduct] = useState(null),
    [orderModal, setOrderModal] = useState(false),
    [editingOrder, setEditingOrder] = useState(null),
    [zoneModal, setZoneModal] = useState(false),
    [editingZone, setEditingZone] = useState(null);
  const blankProduct = {
    name: "",
    category: "",
    price: "",
    cost: "",
    stock: "",
    lowStockAlert: "5",
    unit: "un",
    variants: [],
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [productForm, setProductForm] = useState(blankProduct);
  const blankOrder = {
    clientName: "",
    clientContact: "",
    channel: "Balcão",
    status: "Novo",
    notes: "",
    items: [],
    deliveryZoneId: "",
    postToFinance: true,
    visibility: "espaco_todo",
    sharedWith: [],
    sharedTeams: [],
  };
  const [orderForm, setOrderForm] = useState(blankOrder);
  const [pickProduct, setPickProduct] = useState("");
  const [pickVariant, setPickVariant] = useState("");
  const [pickQty, setPickQty] = useState("1");
  const blankZone = { name: "", fee: "", etaMinutes: "" };
  const [zoneForm, setZoneForm] = useState(blankZone);

  const products = (db.products || []).filter(
    (p) => !business || p.businessId === business.id,
  );
  const orders = (db.orders || []).filter(
    (o) => !business || o.businessId === business.id,
  );
  const zones = (db.deliveryZones || []).filter(
    (z) => !business || z.businessId === business.id,
  );
  const filteredProducts = products.filter(
    (p) =>
      !search ||
      `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredOrders = orders
    .filter(
      (o) =>
        !search ||
        `${o.clientName} ${o.items.map((i) => i.name).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  useEffect(() => {
    const id = setTimeout(() => setVisibleCount(LIST_PAGE_SIZE), 0);
    return () => clearTimeout(id);
  }, [search, view]);

  const openProduct = (item = null) => {
    setEditingProduct(item?.id || null);
    setProductForm(item ? { ...blankProduct, ...item } : blankProduct);
    setProductModal(true);
  };
  const addVariantRow = () =>
    setProductForm((current) => ({
      ...current,
      variants: [
        ...(current.variants || []),
        { id: uid(), name: "", price: "", stock: "" },
      ],
    }));
  const updateVariantRow = (id, field, value) =>
    setProductForm((current) => ({
      ...current,
      variants: (current.variants || []).map((v) =>
        v.id === id ? { ...v, [field]: value } : v,
      ),
    }));
  const removeVariantRow = (id) =>
    setProductForm((current) => ({
      ...current,
      variants: (current.variants || []).filter((v) => v.id !== id),
    }));
  const saveProduct = (e) => {
    e.preventDefault();
    if (!productForm.name.trim()) return;
    const now = new Date().toISOString();
    const variants = (productForm.variants || [])
      .filter((v) => v.name.trim())
      .map((v) => ({
        id: v.id || uid(),
        name: v.name.trim(),
        price: Number(v.price) || 0,
        stock: Number(v.stock) || 0,
      }));
    const item = {
      ...productForm,
      name: productForm.name.trim(),
      price: Number(productForm.price) || 0,
      cost: Number(productForm.cost) || 0,
      stock: Number(productForm.stock) || 0,
      lowStockAlert: Number(productForm.lowStockAlert) || 0,
      variants,
      id: editingProduct || uid(),
      businessId: business?.id || null,
      ownerId: productForm.ownerId || db.user.id,
      visibility: productForm.visibility || "espaco_todo",
      sharedWith: Array.isArray(productForm.sharedWith)
        ? productForm.sharedWith
        : [],
      sharedTeams: Array.isArray(productForm.sharedTeams)
        ? productForm.sharedTeams
        : [],
      createdAt: productForm.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      products: editingProduct
        ? (d.products || []).map((p) => (p.id === editingProduct ? item : p))
        : [item, ...(d.products || [])],
    }));
    setProductModal(false);
    setToast(editingProduct ? "Produto atualizado" : "Produto cadastrado");
  };
  const removeProduct = (id) => {
    if (!confirm("Excluir este produto do catálogo?")) return;
    update((d) => ({
      ...d,
      products: (d.products || []).filter((p) => p.id !== id),
    }));
  };
  const productPriceLabel = (p) =>
    (p.variants || []).length > 0
      ? `A partir de ${money(Math.min(...p.variants.map((v) => v.price)))}`
      : money(p.price);
  const productStockTotal = (p) =>
    (p.variants || []).length > 0
      ? p.variants.reduce((sum, v) => sum + v.stock, 0)
      : p.stock;

  const openOrder = (item = null) => {
    setEditingOrder(item?.id || null);
    setOrderForm(item ? { ...blankOrder, ...item } : blankOrder);
    setPickProduct("");
    setPickVariant("");
    setPickQty("1");
    setOrderModal(true);
  };
  const addItemToOrder = () => {
    const product = products.find((p) => p.id === pickProduct);
    const qty = Number(pickQty) || 0;
    if (!product || qty <= 0) return;
    const hasVariants = (product.variants || []).length > 0;
    const variant = hasVariants
      ? product.variants.find((v) => v.id === pickVariant)
      : null;
    if (hasVariants && !variant) return;
    const price = variant ? variant.price : product.price;
    const name = variant ? `${product.name} - ${variant.name}` : product.name;
    setOrderForm((current) => {
      const existing = current.items.find(
        (i) =>
          i.productId === product.id &&
          (i.variantId || null) === (variant?.id || null),
      );
      const items = existing
        ? current.items.map((i) =>
            i.productId === product.id &&
            (i.variantId || null) === (variant?.id || null)
              ? { ...i, quantity: i.quantity + qty }
              : i,
          )
        : [
            ...current.items,
            {
              productId: product.id,
              variantId: variant?.id || null,
              name,
              price,
              quantity: qty,
            },
          ];
      return { ...current, items };
    });
    setPickProduct("");
    setPickVariant("");
    setPickQty("1");
  };
  const removeItemFromOrder = (productId, variantId) =>
    setOrderForm((current) => ({
      ...current,
      items: current.items.filter(
        (i) =>
          !(
            i.productId === productId &&
            (i.variantId || null) === (variantId || null)
          ),
      ),
    }));
  const orderTotal = (items) =>
    (items || []).reduce((sum, i) => sum + i.price * i.quantity, 0);
  const deliveryFeeFor = (zoneId) =>
    zones.find((z) => z.id === zoneId)?.fee || 0;
  const saveOrder = (e) => {
    e.preventDefault();
    if (!orderForm.clientName.trim() || !orderForm.items.length) return;
    const now = new Date().toISOString();
    const deliveryFee =
      orderForm.channel === "Delivery"
        ? deliveryFeeFor(orderForm.deliveryZoneId)
        : 0;
    const item = {
      ...orderForm,
      deliveryZoneId: orderForm.channel === "Delivery" ? orderForm.deliveryZoneId : "",
      deliveryFee,
      clientName: orderForm.clientName.trim(),
      total: orderTotal(orderForm.items) + deliveryFee,
      id: editingOrder || uid(),
      businessId: business?.id || null,
      ownerId: orderForm.ownerId || db.user.id,
      visibility: orderForm.visibility || "espaco_todo",
      sharedWith: Array.isArray(orderForm.sharedWith)
        ? orderForm.sharedWith
        : [],
      sharedTeams: Array.isArray(orderForm.sharedTeams)
        ? orderForm.sharedTeams
        : [],
      createdAt: orderForm.createdAt || now,
      updatedAt: now,
    };
    // Jornada transversal: o pedido também vira receita no caixa (se marcado)
    // e um registro na linha do tempo do cliente.
    const receita =
      !editingOrder && orderForm.postToFinance
        ? buildOrderReceita(item, {
            businessId: item.businessId,
            ownerId: db.user.id,
          })
        : null;
    update((d) => ({
      ...d,
      orders: editingOrder
        ? (d.orders || []).map((o) => (o.id === editingOrder ? item : o))
        : [item, ...(d.orders || [])],
      products: editingOrder
        ? d.products
        : (d.products || []).map((p) => {
            const lines = orderForm.items.filter((i) => i.productId === p.id);
            if (!lines.length) return p;
            if ((p.variants || []).length > 0) {
              return {
                ...p,
                variants: p.variants.map((v) => {
                  const line = lines.find((i) => i.variantId === v.id);
                  return line
                    ? { ...v, stock: Math.max(0, v.stock - line.quantity) }
                    : v;
                }),
              };
            }
            const line = lines[0];
            return { ...p, stock: Math.max(0, p.stock - line.quantity) };
          }),
      contacts:
        item.channel === "Mesa"
          ? d.contacts || []
          : upsertContact(d.contacts || [], {
              name: item.clientName,
              contact: item.clientContact,
              businessId: item.businessId,
              ownerId: db.user.id,
            }),
      transactions: editingOrder
        ? // ao editar, mantém a receita vinculada em sincronia com o novo total
          (d.transactions || []).map((t) =>
            t.sourceOrderId === item.id
              ? {
                  ...t,
                  value: item.total,
                  description: `Pedido — ${item.clientName}`,
                }
              : t,
          )
        : receita
          ? [receita, ...(d.transactions || [])]
          : d.transactions || [],
    }));
    if (!editingOrder && item.channel !== "Mesa" && item.clientName) {
      const links = contactLinks(item.clientContact);
      logInteraction({
        channel: "note",
        direction: "out",
        contactName: item.clientName,
        contactHandle: links.phone || links.email || item.clientContact || "",
        subject: "Pedido registrado",
        body: `Pedido de ${money(item.total)} · ${item.items.length} item(ns).`,
      });
    }
    setOrderModal(false);
    setToast(
      editingOrder
        ? "Pedido atualizado"
        : receita
          ? "Pedido criado — estoque e caixa atualizados"
          : "Pedido criado e estoque atualizado",
    );
  };
  const removeOrder = (id) => {
    if (!confirm("Excluir este pedido?")) return;
    update((d) => ({ ...d, orders: (d.orders || []).filter((o) => o.id !== id) }));
  };
  const changeOrderStatus = (item, status) =>
    update((d) => ({
      ...d,
      orders: (d.orders || []).map((o) =>
        o.id === item.id ? { ...o, status, updatedAt: new Date().toISOString() } : o,
      ),
    }));
  const confirmOrderWhatsapp = (item) => {
    const { phone } = contactLinks(item.clientContact);
    const list = item.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
    wa.open({
      phone,
      category: "Pedido",
      vars: {
        nome: item.clientName || "",
        negocio: business?.name || "",
        itens: list,
        status: item.status || "",
        valor: money(item.total),
      },
    });
  };

  const openZone = (item = null) => {
    setEditingZone(item?.id || null);
    setZoneForm(item ? { ...blankZone, ...item } : blankZone);
    setZoneModal(true);
  };
  const saveZone = (e) => {
    e.preventDefault();
    if (!zoneForm.name.trim()) return;
    const now = new Date().toISOString();
    const item = {
      ...zoneForm,
      name: zoneForm.name.trim(),
      fee: Number(zoneForm.fee) || 0,
      etaMinutes: Number(zoneForm.etaMinutes) || 0,
      id: editingZone || uid(),
      businessId: business?.id || null,
      createdAt: zoneForm.createdAt || now,
      updatedAt: now,
    };
    update((d) => ({
      ...d,
      deliveryZones: editingZone
        ? (d.deliveryZones || []).map((z) => (z.id === editingZone ? item : z))
        : [item, ...(d.deliveryZones || [])],
    }));
    setEditingZone(item.id);
    setZoneForm(item);
    setToast(editingZone ? "Zona de entrega atualizada" : "Zona de entrega cadastrada");
  };
  const removeZone = (id) => {
    if (!confirm("Excluir esta zona de entrega?")) return;
    update((d) => ({
      ...d,
      deliveryZones: (d.deliveryZones || []).filter((z) => z.id !== id),
    }));
    if (editingZone === id) {
      setEditingZone(null);
      setZoneForm(blankZone);
    }
  };

  return (
    <PageTitle
      eyebrow="PRODUTOS E PEDIDOS"
      title="Materiais, estoque e pedidos em um só lugar"
      text="Cadastre materiais e suprimentos da operação (pneus, baterias, peças, uniformes), acompanhe o estoque e registre pedidos com atualização automática."
      action={
        <Button
          icon={Plus}
          onClick={() => (view === "produtos" ? openProduct() : openOrder())}
        >
          {view === "produtos" ? "Novo produto" : "Novo pedido"}
        </Button>
      }
    >
      <div className="toolbar">
        <div className="search">
          <Search />
          <input
            type="search"
            placeholder={view === "produtos" ? "Buscar produto" : "Buscar pedido"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === "produtos" ? "active" : ""}
            onClick={() => setView("produtos")}
          >
            Catálogo
          </button>
          <button
            className={view === "pedidos" ? "active" : ""}
            onClick={() => setView("pedidos")}
          >
            Pedidos
          </button>
        </div>
        {view === "pedidos" && (
          <Button
            variant="secondary"
            icon={MapPin}
            onClick={() => setZoneModal(true)}
          >
            Zonas de entrega
          </Button>
        )}
      </div>

      {view === "produtos" ? (
        filteredProducts.length === 0 ? (
          <Empty
            icon={ShoppingBag}
            title="Nenhum produto cadastrado"
            text="Cadastre produtos com preço e estoque para começar a montar pedidos."
            action="Novo produto"
            onAction={() => openProduct()}
          />
        ) : (
          <div className="data-list">
            {filteredProducts.slice(0, visibleCount).map((p) => (
              <article key={p.id}>
                <span
                  className={`status-dot ${productStockTotal(p) <= 0 ? "cancelado" : productStockTotal(p) <= (p.lowStockAlert || 0) ? "faltou" : "concluído"}`}
                />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.category || "Sem categoria"} · {productPriceLabel(p)} ·{" "}
                    {productStockTotal(p)} {p.unit || "un"} em estoque
                    {(p.variants || []).length > 0 &&
                      ` · ${p.variants.length} variações`}
                    {productStockTotal(p) <= (p.lowStockAlert || 0) &&
                      " · Estoque baixo"}
                  </small>
                </span>
                <span className="task-actions">
                  <button
                    className="icon-button"
                    aria-label={`Editar ${p.name}`}
                    onClick={() => openProduct(p)}
                  >
                    <Edit3 />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={`Excluir ${p.name}`}
                    onClick={() => removeProduct(p.id)}
                  >
                    <Trash2 />
                  </button>
                </span>
              </article>
            ))}
            <LoadMoreButton
              shown={Math.min(visibleCount, filteredProducts.length)}
              total={filteredProducts.length}
              onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
            />
          </div>
        )
      ) : filteredOrders.length === 0 ? (
        <Empty
          icon={ReceiptText}
          title="Nenhum pedido registrado"
          text="Monte um pedido escolhendo produtos do catálogo."
          action="Novo pedido"
          onAction={() => openOrder()}
        />
      ) : (
        <div className="data-list">
          {filteredOrders.slice(0, visibleCount).map((o) => (
            <article key={o.id}>
              <span>
                <strong>
                  {o.clientName} · {money(o.total)}
                </strong>
                <small>
                  {o.items.map((i) => `${i.quantity}x ${i.name}`).join(", ")} ·{" "}
                  {o.channel}
                </small>
              </span>
              <select
                value={o.status}
                onChange={(e) => changeOrderStatus(o, e.target.value)}
              >
                {orderStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span className="task-actions">
                {o.channel === "Mesa" &&
                  !["Entregue", "Cancelado"].includes(o.status) && (
                    <button
                      className="icon-button"
                      aria-label="Fechar comanda"
                      title="Fechar comanda"
                      onClick={() => changeOrderStatus(o, "Entregue")}
                    >
                      <CheckCircle2 />
                    </button>
                  )}
                {contactLinks(o.clientContact).phone && (
                  <button
                    className="icon-button"
                    aria-label={`Avisar ${o.clientName} por WhatsApp`}
                    title="Avisar por WhatsApp"
                    onClick={() => confirmOrderWhatsapp(o)}
                  >
                    <MessageSquareText />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Editar pedido de ${o.clientName}`}
                  onClick={() => openOrder(o)}
                >
                  <Edit3 />
                </button>
                <button
                  className="icon-button danger"
                  aria-label={`Excluir pedido de ${o.clientName}`}
                  onClick={() => removeOrder(o.id)}
                >
                  <Trash2 />
                </button>
              </span>
            </article>
          ))}
          <LoadMoreButton
            shown={Math.min(visibleCount, filteredOrders.length)}
            total={filteredOrders.length}
            onClick={() => setVisibleCount((c) => c + LIST_PAGE_SIZE)}
          />
        </div>
      )}

      {productModal && (
        <Modal
          title={editingProduct ? "Editar produto" : "Novo produto"}
          onClose={() => setProductModal(false)}
        >
          <form className="modal-body" onSubmit={saveProduct}>
            <Field label="Nome do produto">
              <input
                required
                autoFocus
                value={productForm.name}
                onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="Categoria">
                <input
                  value={productForm.category}
                  onChange={(e) =>
                    setProductForm({ ...productForm, category: e.target.value })
                  }
                />
              </Field>
              <Field label="Preço de venda">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.price}
                  onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                />
              </Field>
              <Field label="Custo (opcional)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productForm.cost}
                  onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })}
                />
              </Field>
              <Field label="Estoque atual">
                <input
                  type="number"
                  min="0"
                  value={productForm.stock}
                  onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                />
              </Field>
              <Field label="Alertar quando estoque for menor que">
                <input
                  type="number"
                  min="0"
                  value={productForm.lowStockAlert}
                  onChange={(e) =>
                    setProductForm({ ...productForm, lowStockAlert: e.target.value })
                  }
                />
              </Field>
              <Field label="Unidade">
                <input
                  value={productForm.unit}
                  onChange={(e) => setProductForm({ ...productForm, unit: e.target.value })}
                  placeholder="un, litro, pallet..."
                />
              </Field>
            </div>
            <div className="field">
              <span>Variações (opcional — tamanho, cor...)</span>
              <div className="variant-rows">
                {(productForm.variants || []).map((v) => (
                  <div key={v.id} className="variant-row">
                    <input
                      value={v.name}
                      onChange={(e) =>
                        updateVariantRow(v.id, "name", e.target.value)
                      }
                      placeholder="Nome da variação (ex.: aro 22.5, 12V)"
                      aria-label="Nome da variação"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={v.price}
                      onChange={(e) =>
                        updateVariantRow(v.id, "price", e.target.value)
                      }
                      placeholder="Preço"
                      aria-label={`Preço da variação ${v.name || ""}`}
                    />
                    <input
                      type="number"
                      min="0"
                      value={v.stock}
                      onChange={(e) =>
                        updateVariantRow(v.id, "stock", e.target.value)
                      }
                      placeholder="Estoque"
                      aria-label={`Estoque da variação ${v.name || ""}`}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remover variação"
                      onClick={() => removeVariantRow(v.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="secondary" onClick={addVariantRow}>
                  Adicionar variação
                </Button>
              </div>
            </div>
            <SharingFields
              value={{
                visibility: productForm.visibility,
                sharedWith: productForm.sharedWith,
                sharedTeams: productForm.sharedTeams,
              }}
              onChange={(next) => setProductForm({ ...productForm, ...next })}
              teams={db.teams}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setProductModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save}>
                {editingProduct ? "Salvar alterações" : "Salvar produto"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {orderModal && (
        <Modal
          title={editingOrder ? "Editar pedido" : "Novo pedido"}
          wide
          onClose={() => setOrderModal(false)}
        >
          <form className="modal-body" onSubmit={saveOrder}>
            <div className="form-grid">
              <Field label={orderForm.channel === "Mesa" ? "Mesa / Comanda" : "Cliente"}>
                <input
                  required
                  autoFocus
                  value={orderForm.clientName}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, clientName: e.target.value })
                  }
                  placeholder={orderForm.channel === "Mesa" ? "Mesa 5" : undefined}
                />
              </Field>
              {orderForm.channel !== "Mesa" && (
                <Field label="WhatsApp ou e-mail">
                  <input
                    value={orderForm.clientContact}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, clientContact: e.target.value })
                    }
                    placeholder="(11) 98888-7777"
                  />
                </Field>
              )}
              <Field label="Canal">
                <select
                  value={orderForm.channel}
                  onChange={(e) => setOrderForm({ ...orderForm, channel: e.target.value })}
                >
                  {orderChannels.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              {orderForm.channel === "Delivery" && (
                <Field label="Zona de entrega">
                  <select
                    value={orderForm.deliveryZoneId}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, deliveryZoneId: e.target.value })
                    }
                  >
                    <option value="">A combinar (sem taxa)</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.name} · {money(z.fee)}
                        {z.etaMinutes ? ` · ${z.etaMinutes} min` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Status">
                <select
                  value={orderForm.status}
                  onChange={(e) => setOrderForm({ ...orderForm, status: e.target.value })}
                >
                  {orderStatuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Adicionar produto">
              <div className="order-item-picker">
                <select
                  value={pickProduct}
                  onChange={(e) => {
                    setPickProduct(e.target.value);
                    setPickVariant("");
                  }}
                  aria-label="Escolher produto"
                >
                  <option value="">Escolha um produto</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {productPriceLabel(p)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  aria-label="Quantidade"
                />
                <Button type="button" variant="secondary" onClick={addItemToOrder}>
                  Adicionar
                </Button>
              </div>
              {(() => {
                const selected = products.find((p) => p.id === pickProduct);
                if (!selected || !(selected.variants || []).length) return null;
                return (
                  <select
                    className="variant-picker"
                    value={pickVariant}
                    onChange={(e) => setPickVariant(e.target.value)}
                    aria-label="Escolha a variação"
                  >
                    <option value="">Escolha a variação</option>
                    {selected.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {money(v.price)}
                      </option>
                    ))}
                  </select>
                );
              })()}
            </Field>
            {orderForm.items.length > 0 && (
              <div className="order-items">
                {orderForm.items.map((i) => (
                  <div
                    key={`${i.productId}-${i.variantId || "base"}`}
                    className="order-item-row"
                  >
                    <span>
                      {i.quantity}x {i.name}
                    </span>
                    <span>{money(i.price * i.quantity)}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remover ${i.name} do pedido`}
                      onClick={() => removeItemFromOrder(i.productId, i.variantId)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {orderForm.channel === "Delivery" &&
                  deliveryFeeFor(orderForm.deliveryZoneId) > 0 && (
                    <div className="order-item-row">
                      <span>Taxa de entrega</span>
                      <span>{money(deliveryFeeFor(orderForm.deliveryZoneId))}</span>
                    </div>
                  )}
                <div className="order-item-row order-total">
                  <span>Total</span>
                  <span>
                    {money(
                      orderTotal(orderForm.items) +
                        (orderForm.channel === "Delivery"
                          ? deliveryFeeFor(orderForm.deliveryZoneId)
                          : 0),
                    )}
                  </span>
                </div>
              </div>
            )}
            {!editingOrder && (
              <label className="cost-check">
                <input
                  type="checkbox"
                  checked={orderForm.postToFinance !== false}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, postToFinance: e.target.checked })
                  }
                />
                <span>Lançar este pedido como receita no Financeiro</span>
              </label>
            )}
            <Field label="Observações">
              <textarea
                value={orderForm.notes}
                onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
              />
            </Field>
            <SharingFields
              value={{
                visibility: orderForm.visibility,
                sharedWith: orderForm.sharedWith,
                sharedTeams: orderForm.sharedTeams,
              }}
              onChange={(next) => setOrderForm({ ...orderForm, ...next })}
              teams={db.teams}
            />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setOrderModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" icon={Save} disabled={!orderForm.items.length}>
                {editingOrder ? "Salvar alterações" : "Salvar pedido"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {zoneModal && (
        <Modal
          title="Zonas de entrega"
          wide
          onClose={() => {
            setZoneModal(false);
            setEditingZone(null);
            setZoneForm(blankZone);
          }}
        >
          <form className="modal-body" onSubmit={saveZone}>
            <div className="form-grid">
              <Field label="Nome da zona">
                <input
                  required
                  autoFocus
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                  placeholder="Grande SP, interior, até 50 km..."
                />
              </Field>
              <Field label="Taxa de entrega">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={zoneForm.fee}
                  onChange={(e) => setZoneForm({ ...zoneForm, fee: e.target.value })}
                />
              </Field>
              <Field label="Tempo estimado (minutos)">
                <input
                  type="number"
                  min="0"
                  value={zoneForm.etaMinutes}
                  onChange={(e) =>
                    setZoneForm({ ...zoneForm, etaMinutes: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="modal-actions">
              {editingZone && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditingZone(null);
                    setZoneForm(blankZone);
                  }}
                >
                  Cancelar edição
                </Button>
              )}
              <Button type="submit" icon={Save}>
                {editingZone ? "Salvar alterações" : "Adicionar zona"}
              </Button>
            </div>
          </form>
          {zones.length === 0 ? (
            <Empty
              icon={MapPin}
              title="Nenhuma zona de entrega cadastrada"
              text="Cadastre zonas com taxa fixa para calcular o total do pedido automaticamente."
            />
          ) : (
            <div className="data-list">
              {zones.map((z) => (
                <article key={z.id}>
                  <span>
                    <strong>{z.name}</strong>
                    <small>
                      {money(z.fee)}
                      {z.etaMinutes ? ` · ${z.etaMinutes} min` : ""}
                    </small>
                  </span>
                  <span className="task-actions">
                    <button
                      className="icon-button"
                      aria-label={`Editar ${z.name}`}
                      onClick={() => openZone(z)}
                    >
                      <Edit3 />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Excluir ${z.name}`}
                      onClick={() => removeZone(z.id)}
                    >
                      <Trash2 />
                    </button>
                  </span>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
      {wa.modal}
    </PageTitle>
  );
}

export default Catalog;
