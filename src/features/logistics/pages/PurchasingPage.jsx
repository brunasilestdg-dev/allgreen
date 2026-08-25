import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, FileText, PackageCheck, RefreshCw } from "lucide-react";
import {
  ORDER_STATUSES,
  REQUEST_STATUSES,
  totalDaLinha,
  totalDoPedido,
} from "../purchaseDomain.js";
import "./TodoGreenPages.css";

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

const REQUISICAO_VAZIA = {
  title: "",
  justificativa: "",
  prioridade: "media",
  precisaEm: "",
  costCenterId: "",
  linhas: [{ itemId: "", descricao: "", quantity: "", estimatedUnitPrice: "" }],
};

export default function PurchasingPage({ authHeaders, setToast, registros }) {
  const [requisicoes, setRequisicoes] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [acesso, setAcesso] = useState({ podeComprar: false });
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState(REQUISICAO_VAZIA);
  const [mostrarForm, setMostrarForm] = useState(false);

  const itens = registros?.items || [];
  const centrosDeCusto = registros?.costCenters || [];

  // Campos em português, como o resto dos registros da vertical.
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
    } catch (motivo) {
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { carregar(); }, []);

  const indicadores = useMemo(() => {
    const aguardando = requisicoes.filter((r) => r.status === "pendente").length;
    const abertos = pedidos.filter((p) => !["encerrado", "cancelado"].includes(p.status)).length;
    // O valor comprometido é o dos pedidos que ainda vão gerar pagamento.
    // Incluir encerrado e cancelado responderia outra pergunta.
    const comprometido = pedidos
      .filter((p) => !["encerrado", "cancelado"].includes(p.status))
      .reduce((soma, p) => soma + totalDoPedido(p, p.items || []).total, 0);
    return { aguardando, abertos, comprometido, requisicoes: requisicoes.length };
  }, [requisicoes, pedidos]);

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
      setToast?.("Requisição registrada.");
      setForm(REQUISICAO_VAZIA);
      setMostrarForm(false);
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado("");
    }
  };

  if (ocupado === "carregando" && !requisicoes.length && !pedidos.length)
    return <section className="tdg-panel" aria-busy="true">Carregando compras...</section>;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>COMPRAS</span>
          <h2>Da requisição ao recebimento</h2>
          <p>Quem pediu, o que foi aprovado, o que já chegou e o que ainda falta chegar.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar} disabled={Boolean(ocupado)}>
            <RefreshCw size={16} />Atualizar
          </button>
          {acesso.podeComprar && (
            <button className="tdg-action" type="button" onClick={() => setMostrarForm((v) => !v)}>
              <FileText size={16} />{mostrarForm ? "Fechar" : "Nova requisição"}
            </button>
          )}
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className={`tdg-metric ${indicadores.aguardando ? "warn" : ""}`}>
          <span>Aguardando aprovação</span>
          <strong>{indicadores.aguardando}</strong>
          <small>{indicadores.aguardando ? "requisições paradas esperando decisão" : "nenhuma pendência"}</small>
        </article>
        <article className="tdg-metric">
          <span>Pedidos abertos</span>
          <strong>{indicadores.abertos}</strong>
          <small>ainda não encerrados</small>
        </article>
        <article className="tdg-metric">
          <span>Valor comprometido</span>
          <strong>{dinheiro(indicadores.comprometido)}</strong>
          <small>somente pedidos abertos</small>
        </article>
        <article className="tdg-metric">
          <span>Requisições</span>
          <strong>{indicadores.requisicoes}</strong>
          <small>no total</small>
        </article>
      </section>

      {mostrarForm && acesso.podeComprar && (
        <form className="tdg-panel tdg-form" onSubmit={enviar}>
          <label className="full">
            <span>O que precisa ser comprado</span>
            <input value={form.title} onChange={(e) => alterar("title", e.target.value)} required maxLength={160} />
          </label>
          <label>
            <span>Prioridade</span>
            <select value={form.prioridade} onChange={(e) => alterar("prioridade", e.target.value)}>
              <option value="baixa">Baixa</option>
              <option value="media">Média</option>
              <option value="alta">Alta</option>
              <option value="critica">Crítica</option>
            </select>
          </label>
          <label>
            <span>Precisa em</span>
            <input type="date" value={form.precisaEm} onChange={(e) => alterar("precisaEm", e.target.value)} />
          </label>
          <label>
            <span>Centro de custo</span>
            <select value={form.costCenterId} onChange={(e) => alterar("costCenterId", e.target.value)}>
              <option value="">Não informado</option>
              {centrosDeCusto.map((centro) => (
                <option value={centro.id} key={centro.id}>{centro.nome}</option>
              ))}
            </select>
          </label>
          <label className="full">
            <span>Justificativa</span>
            <input
              value={form.justificativa}
              onChange={(e) => alterar("justificativa", e.target.value)}
              maxLength={400}
            />
          </label>

          <div className="full">
            <strong>Itens</strong>
            {form.linhas.map((linha, indice) => (
              // A chave é o índice porque a linha não tem id antes de existir
              // no banco, e a ordem só muda por ação explícita de quem escreve.
              <div className="tdg-form-row" key={`linha-${indice}`}>
                <select
                  value={linha.itemId}
                  onChange={(e) => alterarLinha(indice, "itemId", e.target.value)}
                  aria-label="Material"
                >
                  <option value="">Selecione o material</option>
                  {itens.map((item) => (
                    <option value={item.id} key={item.id}>{nomeDoItem(item.id)}</option>
                  ))}
                </select>
                <input
                  placeholder="Descrição livre"
                  aria-label="Descrição do item"
                  value={linha.descricao}
                  onChange={(e) => alterarLinha(indice, "descricao", e.target.value)}
                />
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Quantidade"
                  aria-label="Quantidade"
                  value={linha.quantity}
                  onChange={(e) => alterarLinha(indice, "quantity", e.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Preço estimado"
                  aria-label="Preço unitário estimado"
                  value={linha.estimatedUnitPrice}
                  onChange={(e) => alterarLinha(indice, "estimatedUnitPrice", e.target.value)}
                />
                <span>{dinheiro(totalDaLinha({
                  quantity: Number(linha.quantity || 0),
                  unitPrice: Number(linha.estimatedUnitPrice || 0),
                }))}</span>
                <button type="button" onClick={() => removerLinha(indice)} disabled={form.linhas.length === 1}>
                  Remover
                </button>
              </div>
            ))}
            <button type="button" onClick={novaLinha}>+ Adicionar item</button>
          </div>

          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>
              {ocupado === "salvando" ? "Registrando..." : "Registrar requisição"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">REQUISIÇÕES</span><h2>O que foi pedido</h2></div>
          <ClipboardCheck size={22} />
        </div>
        {!requisicoes.length
          ? <p className="tdg-empty">Nenhuma requisição registrada.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead>
                  <tr><th>Documento</th><th>O quê</th><th>Prioridade</th><th>Precisa em</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {requisicoes.map((requisicao) => (
                    <tr key={requisicao.id}>
                      <td>{requisicao.numeroDocumento || "—"}</td>
                      <td>{requisicao.title}</td>
                      <td>{requisicao.prioridade}</td>
                      <td>{dia(requisicao.precisaEm)}</td>
                      <td>{NOME_DO_STATUS_DA_REQUISICAO[requisicao.status] || requisicao.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">PEDIDOS</span><h2>O que foi comprado</h2></div>
          <PackageCheck size={22} />
        </div>
        {!pedidos.length
          ? <p className="tdg-empty">Nenhum pedido de compra emitido.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead>
                  <tr><th>Documento</th><th>Fornecedor</th><th>Total</th><th>Previsto para</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {pedidos.map((pedido) => (
                    <tr key={pedido.id}>
                      <td>{pedido.numeroDocumento || "—"}</td>
                      <td>{pedido.supplierName || "—"}</td>
                      <td>{dinheiro(totalDoPedido(pedido, pedido.items || []).total)}</td>
                      <td>{dia(pedido.esperadoEm)}</td>
                      <td>{NOME_DO_STATUS_DO_PEDIDO[pedido.status] || pedido.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
