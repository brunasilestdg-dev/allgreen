import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ClipboardList, Package, RefreshCw } from "lucide-react";
import {
  MOVEMENT_KINDS,
  custoMedioPonderado,
  itensAbaixoDoMinimo,
  saldoPorItem,
  situacaoDoEstoque,
  valorDoEstoque,
} from "../stockDomain.js";
import "./TodoGreenPages.css";
import Modal from "../../../components/Modal.jsx";
import { comRotulo } from "../rotulosDomain.js";

// A tela do estoque. O saldo NUNCA é digitado: ele nasce da soma dos
// movimentos, e é por isso que a tela oferece "entrada", "saída" e
// "transferência" em vez de um campo de saldo editável. Corrigir estoque
// errado é lançar um ajuste — que fica no histórico — e não sobrescrever um
// número, que apagaria a explicação junto.

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/stock${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível acessar o estoque.");
  return corpo;
};

const numero = (valor) => Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const dinheiro = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (valor) => (valor
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(valor))
  : "—");

// O nome de cada tipo vem do próprio domínio. Uma tabela paralela aqui
// envelheceria calada no dia em que um tipo novo entrasse lá.
const ROTULO_DO_MOVIMENTO = Object.fromEntries(MOVEMENT_KINDS.map((t) => [t.id, t.name]));

// A data nasce com hoje porque quase todo lançamento é do dia. Deixar em
// branco obrigaria a preencher sempre para atender uma validação do servidor
// que a pessoa nem sabe que existe — foi assim que o primeiro teste de ponta a
// ponta bateu num 400 "Informe a data do movimento".
const hojeISO = () => new Date().toISOString().slice(0, 10);

const FORMULARIO_VAZIO = {
  kind: "entrada",
  occurredAt: hojeISO(),
  itemId: "",
  warehouseId: "",
  quantity: "",
  unitCost: "",
  notes: "",
  destinoId: "",
};

export default function StockPage({ authHeaders, setToast, registros }) {
  const [saldos, setSaldos] = useState([]);
  const [movimentos, setMovimentos] = useState([]);
  const [acesso, setAcesso] = useState({ podeMovimentar: false });
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState(() => ({ ...FORMULARIO_VAZIO, occurredAt: hojeISO() }));
  const [mostrarForm, setMostrarForm] = useState(false);

  const itens = registros?.items || [];
  const depositos = registros?.warehouses || [];

  // Os registros da vertical usam nomes de campo em português (`nome`,
  // `codigo`, `unidade`) — não `name`/`sku`/`unit`. Trocar isso deixa o
  // seletor vazio sem nenhum erro no console, que é o pior tipo de quebra.
  const cadastroDoItem = (id) => itens.find((item) => item.id === id);
  const nomeDoItem = (id) => {
    const item = cadastroDoItem(id);
    if (!item) return id || "—";
    return item.codigo ? `${item.codigo} · ${item.nome}` : item.nome || id;
  };
  const nomeDoDeposito = (id) => depositos.find((d) => d.id === id)?.nome || id || "—";

  const carregar = async () => {
    setOcupado("carregando");
    setErro("");
    try {
      const [saldoResposta, movimentoResposta] = await Promise.all([
        request("/saldos", authHeaders),
        request("/movimentos?limit=60", authHeaders),
      ]);
      setSaldos(saldoResposta.saldos || []);
      setMovimentos(movimentoResposta.registros || []);
      setAcesso({ podeMovimentar: Boolean(movimentoResposta.access?.podeMovimentar ?? true) });
      setOcupado("");
    } catch (motivo) {
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { carregar(); }, []);

  // Os indicadores saem do domínio puro, dos MESMOS movimentos que a lista
  // mostra: assim o número do topo e a linha de baixo nunca discordam.
  //
  // `valorDoEstoque` é por item e devolve null quando não há custo registrado.
  // Somar tratando null como zero seria mentir para baixo; por isso o total
  // acompanha quantos materiais ficaram de fora por falta de custo.
  const indicadores = useMemo(() => {
    const abaixo = itensAbaixoDoMinimo(itens, movimentos);
    const comSaldo = [...saldoPorItem(movimentos).entries()].filter(([, saldo]) => saldo !== 0);
    let total = 0;
    let semCusto = 0;
    for (const [itemId] of comSaldo) {
      const valor = valorDoEstoque(movimentos, itemId);
      if (valor === null) semCusto += 1;
      else total += valor;
    }
    return { itensComSaldo: saldos.length, valor: total, semCusto, abaixoDoMinimo: abaixo.length };
  }, [movimentos, saldos, itens]);

  const situacaoPorItem = useMemo(() => {
    const mapa = new Map();
    for (const linha of situacaoDoEstoque(itens, movimentos).rows) mapa.set(linha.id, linha);
    return mapa;
  }, [itens, movimentos]);

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (evento) => {
    evento.preventDefault();
    setOcupado("salvando");
    try {
      const transferencia = form.kind === "transferencia";
      const corpo = transferencia
        ? {
          itemId: form.itemId,
          origemId: form.warehouseId,
          destinoId: form.destinoId,
          quantity: Number(form.quantity),
          occurredAt: form.occurredAt,
          notes: form.notes,
        }
        : {
          kind: form.kind,
          itemId: form.itemId,
          warehouseId: form.warehouseId,
          quantity: Number(form.quantity),
          unitCost: form.unitCost === "" ? undefined : Number(form.unitCost),
          occurredAt: form.occurredAt,
          notes: form.notes,
        };
      await request(transferencia ? "/transferencias" : "/movimentos", authHeaders, {
        method: "POST",
        body: JSON.stringify(corpo),
      });
      setToast?.(transferencia ? "Transferência registrada." : "Movimento registrado.");
      setForm({ ...FORMULARIO_VAZIO, occurredAt: hojeISO() });
      setMostrarForm(false);
      await carregar();
    } catch (motivo) {
      setToast?.(motivo.message);
    } finally {
      setOcupado("");
    }
  };

  if (ocupado === "carregando" && !movimentos.length && !saldos.length)
    return <section className="tdg-panel" aria-busy="true">Carregando estoque...</section>;

  const transferencia = form.kind === "transferencia";

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>ESTOQUE</span>
          <h2>Saldos, movimentos e contagens</h2>
          <p>
            O saldo é calculado pelos movimentos, não digitado. Para corrigir, lance
            um ajuste — a explicação fica no histórico.
          </p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar} disabled={Boolean(ocupado)}>
            <RefreshCw size={16} />Atualizar
          </button>
          {acesso.podeMovimentar && (
            <button className="tdg-action" type="button" onClick={() => setMostrarForm(true)}>
              <Package size={16} />Novo movimento
            </button>
          )}
        </div>
      </header>

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className="tdg-metric">
          <span>Materiais com saldo</span>
          <strong>{indicadores.itensComSaldo}</strong>
          <small>posições com quantidade diferente de zero</small>
        </article>
        <article className="tdg-metric">
          <span>Valor em estoque</span>
          <strong>{dinheiro(indicadores.valor)}</strong>
          <small>{indicadores.semCusto
            ? `${indicadores.semCusto} material(is) sem custo registrado ficaram de fora`
            : "pelo custo médio ponderado"}</small>
        </article>
        <article className={`tdg-metric ${indicadores.abaixoDoMinimo ? "warn" : ""}`}>
          <span>Abaixo do mínimo</span>
          <strong>{indicadores.abaixoDoMinimo}</strong>
          <small>{indicadores.abaixoDoMinimo ? "precisa de reposição" : "nenhum material em falta"}</small>
        </article>
        <article className="tdg-metric">
          <span>Movimentos</span>
          <strong>{movimentos.length}</strong>
          <small>últimos registrados</small>
        </article>
      </section>

      {/* Ação em janela própria: o formulário não empurra mais as tabelas
          da tela (rodada "nada corta a tela", 30/08). */}
      {mostrarForm && acesso.podeMovimentar && (
        <Modal title="Novo movimento de estoque" onClose={() => setMostrarForm(false)} wide>
        <form className="tdg-form tdg-form-em-modal" onSubmit={enviar}>
          <label>
            <span>Tipo</span>
            <select value={form.kind} onChange={(e) => alterar("kind", e.target.value)}>
              {MOVEMENT_KINDS.map((tipo) => (
                <option value={tipo.id} key={tipo.id}>{tipo.name}</option>
              ))}
              <option value="transferencia">Transferência entre depósitos</option>
            </select>
          </label>
          <label>
            <span>Material</span>
            <select value={form.itemId} onChange={(e) => alterar("itemId", e.target.value)} required>
              <option value="">Selecione</option>
              {itens.map((item) => (
                <option value={item.id} key={item.id}>{nomeDoItem(item.id)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{transferencia ? "Depósito de origem" : "Depósito"}</span>
            <select value={form.warehouseId} onChange={(e) => alterar("warehouseId", e.target.value)} required>
              <option value="">Selecione</option>
              {depositos.map((d) => <option value={d.id} key={d.id}>{d.nome}</option>)}
            </select>
          </label>
          {transferencia && (
            <label>
              <span>Depósito de destino</span>
              <select value={form.destinoId} onChange={(e) => alterar("destinoId", e.target.value)} required>
                <option value="">Selecione</option>
                {depositos.filter((d) => d.id !== form.warehouseId).map((d) => (
                  <option value={d.id} key={d.id}>{d.nome}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Quantidade</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={(e) => alterar("quantity", e.target.value)}
              required
            />
          </label>
          <label>
            <span>Data do movimento</span>
            <input
              type="date"
              value={form.occurredAt}
              onChange={(e) => alterar("occurredAt", e.target.value)}
              required
            />
          </label>
          {!transferencia && (
            <label>
              <span>Custo unitário (opcional)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.unitCost}
                onChange={(e) => alterar("unitCost", e.target.value)}
              />
            </label>
          )}
          <label className="full">
            <span>Observação</span>
            <input value={form.notes} onChange={(e) => alterar("notes", e.target.value)} maxLength={280} />
          </label>
          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>
              {ocupado === "salvando" ? "Registrando..." : "Registrar"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
        </Modal>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">SALDOS</span><h2>Posição por material e depósito</h2></div>
          <ClipboardList size={22} />
        </div>
        {!saldos.length
          ? <p className="tdg-empty">Nenhum saldo ainda. Registre uma entrada para começar.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead>
                  <tr><th>Material</th><th>Depósito</th><th>Saldo</th><th>Custo médio</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {saldos.map((linha) => {
                    const cadastro = cadastroDoItem(linha.itemId);
                    const situacao = situacaoPorItem.get(linha.itemId);
                    return (
                      <tr key={`${linha.itemId}-${linha.warehouseId}`}>
                        <td>{nomeDoItem(linha.itemId)}</td>
                        <td>{nomeDoDeposito(linha.warehouseId)}</td>
                        <td>{numero(linha.saldo)}{cadastro?.unidade ? ` ${cadastro.unidade}` : ""}</td>
                        <td>{custoMedioPonderado(movimentos, linha.itemId) === null
                          ? "sem custo"
                          : dinheiro(custoMedioPonderado(movimentos, linha.itemId))}</td>
                        <td>{situacao?.status === "normal" ? "Normal" : situacao?.status ? "Abaixo do mínimo" : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">HISTÓRICO</span><h2>Movimentos recentes</h2></div>
          <ArrowLeftRight size={22} />
        </div>
        {!movimentos.length
          ? <p className="tdg-empty">Nenhum movimento registrado.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead>
                  <tr><th>Quando</th><th>Tipo</th><th>Material</th><th>Depósito</th><th>Quantidade</th><th>Origem</th></tr>
                </thead>
                <tbody>
                  {movimentos.map((mov) => (
                    <tr key={mov.id}>
                      <td>{data(mov.occurredAt || mov.createdAt)}</td>
                      <td>{comRotulo(ROTULO_DO_MOVIMENTO, mov.kind)}</td>
                      <td>{nomeDoItem(mov.itemId)}</td>
                      <td>{nomeDoDeposito(mov.warehouseId)}</td>
                      <td>{numero(mov.quantity)}</td>
                      <td>{mov.originNumber || mov.originType || "manual"}</td>
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
