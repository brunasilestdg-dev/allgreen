import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, FileText, PackageCheck, Paperclip, RefreshCw } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import AnexosContexto from "./AnexosContexto.jsx";
import {
  ORDER_STATUSES,
  REQUEST_STATUSES,
  previsaoDeCompra,
  totalDaLinha,
  totalDoPedido,
} from "../purchaseDomain.js";
import "./TodoGreenPages.css";
import { comRotulo } from "../rotulosDomain.js";

// Compras, da requisição ao recebimento. As três etapas moram na mesma tela de
// propósito: quem abre "Compras" quer saber onde cada pedido parou, e separar
// em três telas obrigaria a caçar o mesmo pedido em três lugares.

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/purchasing${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível acessar as compras.");
  return corpo;
};

const dinheiro = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (valor) => (valor
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(valor))
  : "—");

const NOME_DO_STATUS_DA_REQUISICAO = Object.fromEntries(REQUEST_STATUSES.map((s) => [s.id, s.name]));
const NOME_DO_STATUS_DO_PEDIDO = Object.fromEntries(ORDER_STATUSES.map((s) => [s.id, s.name]));

const ROTULO_DA_DECISAO = {
  devolvida: "Requisição devolvida ao requisitante com o motivo.",
  recusada: "Requisição recusada.",
  em_gestao: "Requisição direcionada à gestão.",
};
const TITULO_DA_DECISAO = {
  devolvida: "Devolver para ajuste",
  recusada: "Recusar requisição",
  em_gestao: "Direcionar à gestão",
};

const REQUISICAO_VAZIA = {
  title: "",
  justificativa: "",
  area: "",
  prioridade: "media",
  precisaEm: "",
  costCenterId: "",
  linhas: [{ itemId: "", descricao: "", quantity: "", estimatedUnitPrice: "" }],
};

// A requisição pode vir de qualquer área — não é Suprimentos que pede. Não é
// campo obrigatório de esquema (mora em campos), mas registrar a origem ajuda
// Suprimentos a triar.
const AREAS_SOLICITANTES = ["Operação", "Comercial", "Frota", "Manutenção", "Administrativo", "Financeiro", "TI", "RH", "Qualidade", "Outra"];

const proximaAprovacao = (registro) => registro?.campos?.purchaseApprovalFlow?.next?.label || "";
const aprovacoesFeitas = (registro) => registro?.campos?.purchaseApprovalFlow?.approvals || [];

export default function PurchasingPage({ authHeaders, setToast, registros }) {
  const [anexosAbertos, setAnexosAbertos] = useState(null);
  const [requisicoes, setRequisicoes] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [movimentos, setMovimentos] = useState([]);
  const [acesso, setAcesso] = useState({ podeComprar: false });
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState(REQUISICAO_VAZIA);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [formPedido, setFormPedido] = useState(null);
  const [recebimento, setRecebimento] = useState(null);

  const itens = registros?.items || [];
  const centrosDeCusto = registros?.costCenters || [];
  const fornecedores = registros?.parties || [];
  const depositos = registros?.warehouses || [];

  const nomeDoItem = (id) => {
    const item = itens.find((registro) => registro.id === id);
    if (!item) return id || "—";
    return item.codigo ? `${item.codigo} · ${item.nome}` : item.nome || id;
  };

  const carregar = async () => {
    setOcupado("carregando");
    setErro("");
    try {
      const [requisicaoResposta, pedidoResposta] = await Promise.all([
        request("/requisicoes?limit=50", authHeaders),
        request("/pedidos?limit=50", authHeaders),
      ]);
      setRequisicoes(requisicaoResposta.registros || []);
      setPedidos(pedidoResposta.registros || []);
      setAcesso({ podeComprar: Boolean(pedidoResposta.access?.podeComprar ?? true) });
      setOcupado("");
      // Estoque para a previsão de compra: leitura segue o vínculo, então
      // Compras consegue ler. Melhor esforço — se o papel não puder ou falhar,
      // a previsão só não aparece; não derruba a tela de compras.
      try {
        const estoque = await fetch("/api/todogreen/stock/movimentos?limit=500", {
          headers: { ...(authHeaders?.() || {}) },
        });
        const dados = await estoque.json().catch(() => ({}));
        setMovimentos(estoque.ok ? dados.registros || [] : []);
      } catch {
        setMovimentos([]);
      }
    } catch (motivo) {
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { carregar(); }, []);

  const indicadores = useMemo(() => {
    const aguardando = requisicoes.filter((r) => r.status === "pendente").length;
    const abertos = pedidos.filter((p) => !["encerrado", "cancelado"].includes(p.status)).length;
    const comprometido = pedidos
      .filter((p) => !["encerrado", "cancelado"].includes(p.status))
      .reduce((soma, p) => soma + totalDoPedido(p, p.items || []).total, 0);
    return { aguardando, abertos, comprometido, requisicoes: requisicoes.length };
  }, [requisicoes, pedidos]);

  const previsao = useMemo(() => previsaoDeCompra(itens, movimentos), [itens, movimentos]);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const alterarLinha = (indice, campo, valor) => setForm((atual) => ({
    ...atual,
    linhas: atual.linhas.map((linha, i) => (i === indice ? { ...linha, [campo]: valor } : linha)),
  }));
  const novaLinha = () => setForm((atual) => ({
    ...atual,
    linhas: [...atual.linhas, { itemId: "", descricao: "", quantity: "", estimatedUnitPrice: "" }],
  }));
  const removerLinha = (indice) => setForm((atual) => ({
    ...atual,
    linhas: atual.linhas.length > 1 ? atual.linhas.filter((_, i) => i !== indice) : atual.linhas,
  }));

  const enviar = async (evento) => {
    evento.preventDefault();
    setOcupado("salvando");
    try {
      await request("/requisicoes", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          justificativa: form.justificativa,
          prioridade: form.prioridade,
          precisaEm: form.precisaEm || undefined,
          costCenterId: form.costCenterId || undefined,
          campos: form.area ? { area: form.area } : undefined,
          status: "pendente",
          items: form.linhas
            .filter((linha) => (linha.itemId || linha.descricao) && linha.quantity)
            .map((linha) => ({
              itemId: linha.itemId,
              descricao: linha.descricao,
              quantity: Number(linha.quantity),
              estimatedUnitPrice: linha.estimatedUnitPrice === ""
                ? undefined
                : Number(linha.estimatedUnitPrice),
            })),
        }),
      });
      setToast?.("Requisição registrada e enviada para a alçada aplicável.");
      setForm(REQUISICAO_VAZIA);
      setMostrarForm(false);
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado("");
    }
  };

  const aprovarRequisicao = async (req) => {
    try {
      const resultado = await request(`/requisicoes/${req.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ status: "aprovada", revision: req.revision }),
      });
      setToast?.(resultado.approvalPending
        ? resultado.message
        : "Todas as etapas foram aprovadas. Requisição liberada para gerar pedido.");
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); }
  };

  // Devolver, recusar e direcionar à gestão pedem um porquê — a decisão de
  // Suprimentos volta ao requisitante (ou sobe à gestão) com o motivo à vista.
  // O reenvio de uma devolvida não pede nota: é o requisitante retomando.
  const [decisao, setDecisao] = useState(null);
  const abrirDecisao = (req, novoStatus) => setDecisao({ req, novoStatus, nota: "" });
  const confirmarDecisao = async (evento) => {
    evento.preventDefault();
    const { req, novoStatus, nota } = decisao;
    if (!nota.trim()) { setToast?.("Diga o motivo para o requisitante entender."); return; }
    setOcupado("salvando");
    try {
      await request(`/requisicoes/${req.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ status: novoStatus, notaDecisao: nota.trim(), revision: req.revision }),
      });
      setToast?.(ROTULO_DA_DECISAO[novoStatus] || "Requisição atualizada.");
      setDecisao(null);
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); } finally { setOcupado(""); }
  };
  const reenviarRequisicao = async (req) => {
    try {
      await request(`/requisicoes/${req.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ status: "pendente", revision: req.revision }),
      });
      setToast?.("Requisição reenviada a Suprimentos.");
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); }
  };

  const abrirPedido = (req) => setFormPedido({
    requestId: req?.id || "", supplierPartyId: "", warehouseId: "", esperadoEm: "", notas: "",
    titulo: req?.title || "",
  });

  const enviarPedido = async (evento) => {
    evento.preventDefault();
    if (!formPedido.supplierPartyId) { setToast?.("Escolha o fornecedor."); return; }
    setOcupado("salvando");
    try {
      await request("/pedidos", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          requestId: formPedido.requestId || undefined,
          supplierPartyId: formPedido.supplierPartyId,
          warehouseId: formPedido.warehouseId || undefined,
          esperadoEm: formPedido.esperadoEm || undefined,
          notas: formPedido.notas || undefined,
        }),
      });
      setToast?.("Pedido criado. A alçada será recalculada pelo valor real antes do envio.");
      setFormPedido(null);
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); } finally { setOcupado(""); }
  };

  const mudarStatusPedido = async (pedido, status) => {
    try {
      const resultado = await request(`/pedidos/${pedido.id}`, authHeaders, {
        method: "PATCH",
        body: JSON.stringify({ status, revision: pedido.revision }),
      });
      setToast?.(resultado.approvalPending
        ? resultado.message
        : `Pedido: ${comRotulo(NOME_DO_STATUS_DO_PEDIDO, status)}.`);
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); }
  };

  const abrirRecebimento = async (pedido) => {
    try {
      const { registro } = await request(`/pedidos/${pedido.id}`, authHeaders);
      const linhas = (registro.recepcao?.linhas || []).filter((l) => l.pendente > 0);
      if (!linhas.length) { setToast?.("Nada pendente para receber neste pedido."); return; }
      setRecebimento({
        pedido: registro,
        linhasPendentes: linhas,
        quantidades: Object.fromEntries(linhas.map((l) => [l.orderItemId, String(l.pendente)])),
        warehouseId: registro.warehouseId || depositos[0]?.id || "",
        receivedAt: new Date().toISOString().slice(0, 10),
        invoiceNumber: "",
        gerarConta: true,
      });
    } catch (motivo) { setToast?.(motivo.message); }
  };

  const enviarRecebimento = async (evento) => {
    evento.preventDefault();
    if (!recebimento.warehouseId) { setToast?.("Escolha o depósito que recebeu."); return; }
    setOcupado("salvando");
    try {
      await request("/recebimentos", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          orderId: recebimento.pedido.id,
          warehouseId: recebimento.warehouseId,
          receivedAt: recebimento.receivedAt,
          invoiceNumber: recebimento.invoiceNumber || undefined,
          gerarConta: recebimento.gerarConta,
          linhas: recebimento.linhasPendentes
            .map((l) => ({ orderItemId: l.orderItemId, quantidade: Number(recebimento.quantidades[l.orderItemId] || 0) }))
            .filter((l) => l.quantidade > 0),
        }),
      });
      setToast?.("Recebimento lançado: estoque e conta a pagar atualizados.");
      setRecebimento(null);
      await carregar();
    } catch (motivo) { setToast?.(motivo.message); } finally { setOcupado(""); }
  };

  if (ocupado === "carregando" && !requisicoes.length && !pedidos.length)
    return <section className="tdg-panel" aria-busy="true">Carregando compras...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>COMPRAS</span>
          <h2>Da requisição ao recebimento</h2>
          <p>Alçada por valor, pedido, recebimento, estoque e conta a pagar no mesmo fluxo.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar} disabled={Boolean(ocupado)}>
            <RefreshCw size={16} />Atualizar
          </button>
          {/* Requisitar é de qualquer área — o botão aparece para todos. Quem
              seleciona fornecedor e fecha o pedido é Suprimentos, mais abaixo. */}
          <button className="tdg-action" type="button" onClick={() => setMostrarForm(true)}>
            <FileText size={16} />Nova requisição
          </button>
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className={`tdg-metric ${indicadores.aguardando ? "warn" : ""}`}>
          <span>Aguardando aprovação</span>
          <strong>{indicadores.aguardando}</strong>
          <small>{indicadores.aguardando ? "requisições paradas em uma etapa da alçada" : "nenhuma pendência"}</small>
        </article>
        <article className="tdg-metric"><span>Pedidos abertos</span><strong>{indicadores.abertos}</strong><small>ainda não encerrados</small></article>
        <article className="tdg-metric"><span>Valor comprometido</span><strong>{dinheiro(indicadores.comprometido)}</strong><small>somente pedidos abertos</small></article>
        <article className="tdg-metric"><span>Requisições</span><strong>{indicadores.requisicoes}</strong><small>no total</small></article>
      </section>

      {/* Previsão de compra: o que o estoque indica que precisa ser reposto,
          com custo estimado pela referência do item, mais o que já está
          comprometido em pedidos abertos. Serve à gestão para planejar antes
          da ruptura. Só aparece quando há item abaixo do mínimo. */}
      {previsao.itens > 0 && (
        <section className="tdg-panel tdg-previsao-compra">
          <div className="tdg-section-head">
            <div>
              <span className="tdg-kicker">SUPRIMENTOS · PREVISÃO</span>
              <h3>Previsão de compra</h3>
              <p className="tdg-fiscal-nota">Itens abaixo do estoque mínimo, com sugestão de quantidade e custo estimado pela referência do cadastro. É estimativa para planejar — o preço fechado vem do pedido.</p>
            </div>
            <div className="tdg-previsao-totais">
              <div><span>A repor (estimado)</span><strong>{dinheiro(previsao.totalEstimado)}</strong></div>
              <div><span>Já comprometido</span><strong>{dinheiro(indicadores.comprometido)}</strong></div>
              <div className="tdg-previsao-total"><span>Previsão total</span><strong>{dinheiro(previsao.totalEstimado + indicadores.comprometido)}</strong></div>
            </div>
          </div>
          <div className="tdg-table-wrap">
            <table className="tdg-table">
              <thead><tr><th>Item</th><th>Saldo</th><th>Mínimo</th><th>Sugerido</th><th>Custo unit.</th><th>Estimado</th></tr></thead>
              <tbody>
                {previsao.linhas.map((linha) => (
                  <tr key={linha.id}>
                    <td>{linha.nome}{linha.status === "sem_estoque" && <span className="tdg-tag-risco"> sem estoque</span>}</td>
                    <td>{linha.saldo}{linha.unidade ? ` ${linha.unidade}` : ""}</td>
                    <td>{linha.minimo}</td>
                    <td><strong>{linha.sugerido}{linha.unidade ? ` ${linha.unidade}` : ""}</strong></td>
                    <td>{linha.custoUnit ? dinheiro(linha.custoUnit) : "—"}</td>
                    <td>{linha.custoEstimado ? dinheiro(linha.custoEstimado) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Ação em janela própria: o formulário não empurra mais as tabelas
          da tela (rodada "nada corta a tela", 30/08). */}
      {mostrarForm && (
        <Modal title="Nova requisição" onClose={() => setMostrarForm(false)} wide>
        <form className="tdg-form tdg-form-em-modal" onSubmit={enviar}>
          <label className="full"><span>O que precisa ser comprado</span><input value={form.title} onChange={(e) => alterar("title", e.target.value)} required maxLength={160} /></label>
          <label><span>Área solicitante</span><select value={form.area} onChange={(e) => alterar("area", e.target.value)}><option value="">Não informada</option>{AREAS_SOLICITANTES.map((a) => <option value={a} key={a}>{a}</option>)}</select></label>
          <label><span>Prioridade</span><select value={form.prioridade} onChange={(e) => alterar("prioridade", e.target.value)}><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option><option value="critica">Crítica</option></select></label>
          <label><span>Precisa em</span><input type="date" value={form.precisaEm} onChange={(e) => alterar("precisaEm", e.target.value)} /></label>
          <label><span>Centro de custo</span><select value={form.costCenterId} onChange={(e) => alterar("costCenterId", e.target.value)}><option value="">Não informado</option>{centrosDeCusto.map((centro) => <option value={centro.id} key={centro.id}>{centro.nome}</option>)}</select></label>
          <label className="full"><span>Justificativa</span><input value={form.justificativa} onChange={(e) => alterar("justificativa", e.target.value)} maxLength={400} /></label>
          <div className="full">
            <strong>Itens</strong>
            {form.linhas.map((linha, indice) => (
              <div className="tdg-form-row" key={`linha-${indice}`}>
                <select value={linha.itemId} onChange={(e) => alterarLinha(indice, "itemId", e.target.value)} aria-label="Material">
                  <option value="">Selecione o material</option>
                  {itens.map((item) => <option value={item.id} key={item.id}>{nomeDoItem(item.id)}</option>)}
                </select>
                <input placeholder="Descrição livre" aria-label="Descrição do item" value={linha.descricao} onChange={(e) => alterarLinha(indice, "descricao", e.target.value)} />
                <input type="number" step="0.001" min="0" placeholder="Quantidade" aria-label="Quantidade" value={linha.quantity} onChange={(e) => alterarLinha(indice, "quantity", e.target.value)} />
                <input type="number" step="0.01" min="0" placeholder="Preço estimado" aria-label="Preço unitário estimado" value={linha.estimatedUnitPrice} onChange={(e) => alterarLinha(indice, "estimatedUnitPrice", e.target.value)} />
                <span>{dinheiro(totalDaLinha({ quantity: Number(linha.quantity || 0), unitPrice: Number(linha.estimatedUnitPrice || 0) }))}</span>
                <button type="button" onClick={() => removerLinha(indice)} disabled={form.linhas.length === 1}>Remover</button>
              </div>
            ))}
            <button type="button" onClick={novaLinha}>+ Adicionar item</button>
          </div>
          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>{ocupado === "salvando" ? "Registrando..." : "Registrar requisição"}</button>
            <button type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
        </Modal>
      )}

      {decisao && (
        <Modal title={TITULO_DA_DECISAO[decisao.novoStatus] || "Decisão"} onClose={() => setDecisao(null)}>
          <form className="tdg-form tdg-form-em-modal" onSubmit={confirmarDecisao}>
            <p className="tdg-dd-contexto">{decisao.req.title}{decisao.req.campos?.area ? ` · ${decisao.req.campos.area}` : ""}</p>
            <label className="full">
              <span>{decisao.novoStatus === "em_gestao" ? "O que a gestão precisa decidir" : "Motivo (o requisitante vai ler)"}</span>
              <textarea rows={3} value={decisao.nota} maxLength={2000} onChange={(e) => setDecisao((d) => ({ ...d, nota: e.target.value }))} required />
            </label>
            <div className="tdg-form-actions full">
              <button type="button" onClick={() => setDecisao(null)}>Cancelar</button>
              <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>{ocupado === "salvando" ? "Enviando..." : "Confirmar"}</button>
            </div>
          </form>
        </Modal>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head"><div><span className="tdg-kicker">REQUISIÇÕES</span><h2>O que foi pedido</h2></div><ClipboardCheck size={22} /></div>
        {!requisicoes.length ? <p className="tdg-empty">Nenhuma requisição registrada.</p> : (
          <div className="tdg-table-wrap"><table className="tdg-table">
            <thead><tr><th>Documento</th><th>O quê</th><th>Área</th><th>Prioridade</th><th>Precisa em</th><th>Situação</th><th>Ações</th></tr></thead>
            <tbody>{requisicoes.map((requisicao) => (
              <Fragment key={requisicao.id}>
              <tr>
                <td>{requisicao.numeroDocumento || "—"}</td><td>{requisicao.title}</td><td>{requisicao.campos?.area || "—"}</td><td>{requisicao.prioridade}</td><td>{dia(requisicao.precisaEm)}</td>
                <td>
                  <span>{comRotulo(NOME_DO_STATUS_DA_REQUISICAO, requisicao.status)}</span>
                  {proximaAprovacao(requisicao) && <small>Próxima: {proximaAprovacao(requisicao)} · {aprovacoesFeitas(requisicao).length} etapa(s) concluída(s)</small>}
                  {["devolvida", "recusada", "em_gestao"].includes(requisicao.status) && requisicao.notaDecisao && <small className="tdg-req-motivo">Motivo: {requisicao.notaDecisao}</small>}
                </td>
                <td className="tdg-fiscal-acoes">
                  {/* Suprimentos (e a gestão) triam o que chega. Devolver ou
                      reenviar não é privilégio de Suprimentos: o requisitante
                      retoma a própria requisição devolvida. */}
                  {acesso.podeComprar && (requisicao.status === "pendente" || requisicao.status === "em_gestao") && <>
                    <button type="button" onClick={() => aprovarRequisicao(requisicao)}>Aprovar</button>
                    <button type="button" onClick={() => abrirDecisao(requisicao, "devolvida")}>Devolver</button>
                    <button type="button" onClick={() => abrirDecisao(requisicao, "recusada")}>Recusar</button>
                    {requisicao.status === "pendente" && <button type="button" onClick={() => abrirDecisao(requisicao, "em_gestao")}>Direcionar à gestão</button>}
                  </>}
                  {requisicao.status === "devolvida" && <button type="button" onClick={() => reenviarRequisicao(requisicao)}>Reenviar a Suprimentos</button>}
                  {acesso.podeComprar && requisicao.status === "aprovada" && <button type="button" onClick={() => abrirPedido(requisicao)}>Gerar pedido</button>}
                  <button type="button" onClick={() => setAnexosAbertos((a) => (a === requisicao.id ? null : requisicao.id))}><Paperclip size={13} /> Anexos</button>
                </td>
              </tr>
              {anexosAbertos === requisicao.id && (
                <tr className="tdg-anexos-row">
                  <td colSpan={7}>
                    <AnexosContexto contextType="purchase_request" contextId={requisicao.id} titulo="Anexos da requisição" setToast={setToast} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="tdg-panel">
        <div className="tdg-section-head"><div><span className="tdg-kicker">PEDIDOS</span><h2>O que foi comprado</h2></div>{acesso.podeComprar ? <button type="button" className="tdg-action" onClick={() => abrirPedido(null)}><PackageCheck size={16} />Novo pedido</button> : <PackageCheck size={22} />}</div>
        {!pedidos.length ? <p className="tdg-empty">Nenhum pedido de compra emitido.</p> : (
          <div className="tdg-table-wrap"><table className="tdg-table">
            <thead><tr><th>Documento</th><th>Fornecedor</th><th>Total</th><th>Previsto para</th><th>Situação</th>{acesso.podeComprar && <th>Ações</th>}</tr></thead>
            <tbody>{pedidos.map((pedido) => (
              <tr key={pedido.id}>
                <td>{pedido.numeroDocumento || "—"}</td><td>{pedido.supplierName || "—"}</td><td>{dinheiro(totalDoPedido(pedido, pedido.items || []).total)}</td><td>{dia(pedido.esperadoEm)}</td>
                <td><span>{comRotulo(NOME_DO_STATUS_DO_PEDIDO, pedido.status)}</span>{proximaAprovacao(pedido) && <small>Próxima: {proximaAprovacao(pedido)} · {aprovacoesFeitas(pedido).length} etapa(s) concluída(s)</small>}</td>
                {acesso.podeComprar && <td className="tdg-fiscal-acoes">{pedido.status === "rascunho" && <button type="button" onClick={() => mudarStatusPedido(pedido, "aprovado")}>Aprovar minha etapa</button>}{pedido.status === "aprovado" && <button type="button" onClick={() => mudarStatusPedido(pedido, "enviado")}>Enviar</button>}{["aprovado", "enviado"].includes(pedido.status) && <button type="button" onClick={() => abrirRecebimento(pedido)}>Receber</button>}{pedido.status === "enviado" && <button type="button" onClick={() => mudarStatusPedido(pedido, "encerrado")}>Encerrar</button>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      {formPedido && (
        <Modal title={formPedido.requestId ? `Pedido da requisição: ${formPedido.titulo}` : "Novo pedido de compra"} onClose={() => setFormPedido(null)}>
          <form className="tdg-planner-form" onSubmit={enviarPedido}>
            {formPedido.requestId
              ? <p className="tdg-fiscal-nota">Os itens vêm da requisição aprovada. O pedido terá nova alçada calculada pelo preço real.</p>
              : <p className="tdg-fiscal-nota">Sem requisição vinculada, o pedido nasce vazio. Prefira gerar a partir de uma requisição aprovada.</p>}
            <label>Fornecedor *<select value={formPedido.supplierPartyId} onChange={(e) => setFormPedido((f) => ({ ...f, supplierPartyId: e.target.value }))} required><option value="">— selecione —</option>{fornecedores.map((p) => <option key={p.id} value={p.id}>{p.razaoSocial || p.nomeFantasia || p.id}</option>)}</select></label>
            <div className="tdg-planner-grid3">
              <label>Depósito<select value={formPedido.warehouseId} onChange={(e) => setFormPedido((f) => ({ ...f, warehouseId: e.target.value }))}><option value="">— opcional —</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nome || d.id}</option>)}</select></label>
              <label>Previsto para<input type="date" value={formPedido.esperadoEm} onChange={(e) => setFormPedido((f) => ({ ...f, esperadoEm: e.target.value }))} /></label>
              <label>Observações<input value={formPedido.notas} onChange={(e) => setFormPedido((f) => ({ ...f, notas: e.target.value }))} maxLength={400} /></label>
            </div>
            <div className="tdg-form-actions"><button type="button" onClick={() => setFormPedido(null)}>Cancelar</button><button type="submit" className="tdg-action" disabled={ocupado === "salvando"}>Criar pedido</button></div>
          </form>
        </Modal>
      )}

      {recebimento && (
        <Modal title={`Receber pedido ${recebimento.pedido.numeroDocumento || ""}`.trim()} onClose={() => setRecebimento(null)} wide>
          <form className="tdg-planner-form" onSubmit={enviarRecebimento}>
            <div className="tdg-planner-grid3">
              <label>Depósito *<select value={recebimento.warehouseId} onChange={(e) => setRecebimento((r) => ({ ...r, warehouseId: e.target.value }))} required><option value="">— selecione —</option>{depositos.map((d) => <option key={d.id} value={d.id}>{d.nome || d.id}</option>)}</select></label>
              <label>Data *<input type="date" value={recebimento.receivedAt} onChange={(e) => setRecebimento((r) => ({ ...r, receivedAt: e.target.value }))} required /></label>
              <label>Nota fiscal<input value={recebimento.invoiceNumber} onChange={(e) => setRecebimento((r) => ({ ...r, invoiceNumber: e.target.value }))} maxLength={60} /></label>
            </div>
            <div className="tdg-table-wrap"><table className="tdg-table">
              <thead><tr><th>Item</th><th>Pendente</th><th>Receber agora</th></tr></thead>
              <tbody>{recebimento.linhasPendentes.map((l) => (
                <tr key={l.orderItemId}><td>{nomeDoItem(l.itemId) || l.descricao || l.orderItemId}</td><td>{l.pendente}</td><td><input type="number" min="0" max={l.pendente} step="0.001" value={recebimento.quantidades[l.orderItemId] || ""} onChange={(e) => setRecebimento((r) => ({ ...r, quantidades: { ...r.quantidades, [l.orderItemId]: e.target.value } }))} /></td></tr>
              ))}</tbody>
            </table></div>
            <label className="tdg-check-field"><input type="checkbox" checked={recebimento.gerarConta} onChange={(e) => setRecebimento((r) => ({ ...r, gerarConta: e.target.checked }))} /><span>Gerar conta a pagar deste recebimento</span></label>
            <div className="tdg-form-actions"><button type="button" onClick={() => setRecebimento(null)}>Cancelar</button><button type="submit" className="tdg-action" disabled={ocupado === "salvando"}>Lançar recebimento</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
