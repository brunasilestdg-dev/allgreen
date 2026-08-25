import { useMemo, useState } from "react";
import { Boxes, Building2, Landmark, Layers, Warehouse } from "lucide-react";
import { UNITS, formatDocument } from "../erpCoreDomain.js";
import "./TodoGreenPages.css";

// Os cadastros de base do ERP. Sem material e depósito não existe estoque, e
// sem fornecedor não existe pedido de compra — por isso esta tela vem antes
// das outras duas na leitura, mesmo aparecendo depois no menu.
//
// As cinco listas dividem a mesma tela porque são todas curtas e todas
// consultadas em conjunto: quem cadastra um material costuma cadastrar o
// depósito dele na sequência, e cinco telas separadas transformariam isso em
// cinco navegações.

const ABAS = [
  { id: "items", titulo: "Materiais", icone: Boxes, singular: "material" },
  { id: "warehouses", titulo: "Depósitos", icone: Warehouse, singular: "depósito" },
  { id: "parties", titulo: "Fornecedores, parceiros e colaboradores", icone: Building2, singular: "pessoa ou parceiro" },
  { id: "costCenters", titulo: "Centros de custo", icone: Layers, singular: "centro de custo" },
  { id: "accounts", titulo: "Plano de contas", icone: Landmark, singular: "conta" },
];

const FORMULARIO_POR_ABA = {
  items: { codigo: "", nome: "", unidade: "UN", categoria: "", estoqueMinimo: "", custoReferencia: "" },
  warehouses: { codigo: "", nome: "", tipo: "proprio", endereco: "" },
  parties: { nome: "", documento: "", papeis: "fornecedor", email: "", telefone: "" },
  costCenters: { codigo: "", nome: "" },
  accounts: { codigo: "", nome: "", tipo: "despesa" },
};

const numero = (valor) => Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export default function ErpRegistriesPage({ registros, criar, setToast }) {
  const [aba, setAba] = useState("items");
  const [form, setForm] = useState(FORMULARIO_POR_ABA.items);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const lista = registros?.[aba] || [];
  const abaAtual = ABAS.find((item) => item.id === aba) || ABAS[0];

  const trocarAba = (id) => {
    setAba(id);
    setForm(FORMULARIO_POR_ABA[id]);
    setMostrarForm(false);
  };

  const alterar = (campo, valor) => setForm((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      const corpo = { ...form };
      // `papeis` é lista no servidor; no formulário é um seletor único porque
      // quase todo cadastro nasce com um papel só, e quem precisa de mais de um
      // edita depois.
      if (aba === "parties") {
        corpo.papeis = [form.papeis];
        corpo.razaoSocial = form.nome;
      }
      if (aba === "items") {
        corpo.estoqueMinimo = form.estoqueMinimo === "" ? 0 : Number(form.estoqueMinimo);
        corpo.custoReferencia = form.custoReferencia === "" ? 0 : Number(form.custoReferencia);
      }
      await criar(aba, corpo);
      setToast?.(`${abaAtual.singular[0].toUpperCase()}${abaAtual.singular.slice(1)} cadastrado.`);
      setForm(FORMULARIO_POR_ABA[aba]);
      setMostrarForm(false);
    } catch (motivo) {
      setToast?.(motivo.message || "Não foi possível cadastrar.");
    } finally {
      setSalvando(false);
    }
  };

  const colunas = useMemo(() => ({
    items: ["Código", "Material", "Unidade", "Categoria", "Estoque mínimo"],
    warehouses: ["Código", "Depósito", "Tipo", "Endereço"],
    parties: ["Pessoa ou parceiro", "Documento", "Papéis", "Canal"],
    costCenters: ["Código", "Centro de custo"],
    accounts: ["Código", "Conta", "Tipo"],
  }[aba]), [aba]);

  const linhaDaTabela = (registro) => {
    if (aba === "items") return [
      registro.codigo, registro.nome, registro.unidade, registro.categoria || "—",
      numero(registro.estoqueMinimo),
    ];
    if (aba === "warehouses") return [
      registro.codigo, registro.nome, registro.tipo, registro.endereco || "—",
    ];
    if (aba === "parties") return [
      registro.razaoSocial || registro.nome,
      registro.documento ? formatDocument(registro.documento) : "—",
      (registro.papeis || []).join(", ") || "—",
      registro.email || registro.telefone || "—",
    ];
    if (aba === "costCenters") return [registro.codigo, registro.nome];
    return [registro.codigo, registro.nome, registro.tipo];
  };

  const Icone = abaAtual.icone;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CADASTROS</span>
          <h2>A base do ERP</h2>
          <p>Cadastros mestres para estoque, compras, financeiro e rateio operacional.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={() => setMostrarForm((v) => !v)}>
            <Icone size={16} />{mostrarForm ? "Fechar" : `Novo ${abaAtual.singular}`}
          </button>
        </div>
      </header>

      {/* Classe própria, e não `tdg-subtabs`: aquela é a navegação ENTRE telas
          da vertical, e reaproveitá-la aqui colocava duas barras idênticas na
          mesma página — a de cima troca de tela, a de baixo troca de lista, e
          nada dizia isso a quem olha. */}
      <nav className="tdg-registry-tabs" aria-label="Listas de cadastro">
        {ABAS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={aba === item.id ? "active" : ""}
            onClick={() => trocarAba(item.id)}
          >
            {item.titulo}
            {registros?.[item.id]?.length ? ` (${registros[item.id].length})` : ""}
          </button>
        ))}
      </nav>

      {mostrarForm && (
        <form className="tdg-panel tdg-form" onSubmit={enviar}>
          {aba === "items" && (
            <>
              <label><span>Código</span><input value={form.codigo} onChange={(e) => alterar("codigo", e.target.value)} required maxLength={40} /></label>
              <label><span>Nome</span><input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required maxLength={200} /></label>
              <label>
                <span>Unidade</span>
                <select value={form.unidade} onChange={(e) => alterar("unidade", e.target.value)}>
                  {UNITS.map((unidade) => (
                    <option value={unidade.code} key={unidade.code}>{unidade.code} — {unidade.name}</option>
                  ))}
                </select>
              </label>
              <label><span>Categoria</span><input value={form.categoria} onChange={(e) => alterar("categoria", e.target.value)} maxLength={120} /></label>
              <label><span>Estoque mínimo</span><input type="number" min="0" step="0.001" value={form.estoqueMinimo} onChange={(e) => alterar("estoqueMinimo", e.target.value)} /></label>
              <label><span>Custo de referência</span><input type="number" min="0" step="0.01" value={form.custoReferencia} onChange={(e) => alterar("custoReferencia", e.target.value)} /></label>
            </>
          )}
          {aba === "warehouses" && (
            <>
              <label><span>Código</span><input value={form.codigo} onChange={(e) => alterar("codigo", e.target.value)} required maxLength={40} /></label>
              <label><span>Nome</span><input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required maxLength={200} /></label>
              <label>
                <span>Tipo</span>
                <select value={form.tipo} onChange={(e) => alterar("tipo", e.target.value)}>
                  <option value="proprio">Próprio</option>
                  <option value="terceiro">De terceiro</option>
                  <option value="transito">Em trânsito</option>
                  <option value="veiculo">Veículo</option>
                </select>
              </label>
              <label className="full"><span>Endereço</span><input value={form.endereco} onChange={(e) => alterar("endereco", e.target.value)} maxLength={240} /></label>
            </>
          )}
          {aba === "parties" && (
            <>
              <label><span>Nome</span><input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required maxLength={200} /></label>
              <label><span>CNPJ ou CPF</span><input value={form.documento} onChange={(e) => alterar("documento", e.target.value)} maxLength={20} /></label>
              <label>
                <span>Papel</span>
                <select value={form.papeis} onChange={(e) => alterar("papeis", e.target.value)}>
                  <option value="fornecedor">Fornecedor</option>
                  <option value="cliente">Cliente</option>
                  <option value="transportador">Transportador</option>
                  <option value="colaborador">Colaborador</option>
                </select>
              </label>
              <label><span>E-mail</span><input type="email" value={form.email} onChange={(e) => alterar("email", e.target.value)} maxLength={160} /></label>
              <label><span>Telefone</span><input value={form.telefone} onChange={(e) => alterar("telefone", e.target.value)} maxLength={40} /></label>
            </>
          )}
          {aba === "costCenters" && (
            <>
              <label><span>Código</span><input value={form.codigo} onChange={(e) => alterar("codigo", e.target.value)} required maxLength={40} /></label>
              <label><span>Nome</span><input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required maxLength={200} /></label>
            </>
          )}
          {aba === "accounts" && (
            <>
              <label><span>Código</span><input value={form.codigo} onChange={(e) => alterar("codigo", e.target.value)} required maxLength={40} /></label>
              <label><span>Nome</span><input value={form.nome} onChange={(e) => alterar("nome", e.target.value)} required maxLength={200} /></label>
              <label>
                <span>Tipo</span>
                <select value={form.tipo} onChange={(e) => alterar("tipo", e.target.value)}>
                  <option value="ativo">Ativo</option>
                  <option value="passivo">Passivo</option>
                  <option value="receita">Receita</option>
                  <option value="despesa">Despesa</option>
                  <option value="resultado">Resultado</option>
                </select>
              </label>
            </>
          )}
          <div className="tdg-form-actions full">
            <button className="tdg-action" type="submit" disabled={salvando}>
              {salvando ? "Cadastrando..." : "Cadastrar"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">{abaAtual.titulo.toUpperCase()}</span><h2>{abaAtual.titulo}</h2></div>
          <Icone size={22} />
        </div>
        {!lista.length
          ? <p className="tdg-empty">Nenhum {abaAtual.singular} cadastrado ainda.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead><tr>{colunas.map((coluna) => <th key={coluna}>{coluna}</th>)}</tr></thead>
                <tbody>
                  {lista.map((registro) => (
                    <tr key={registro.id}>
                      {linhaDaTabela(registro).map((celula, indice) => (
                        // A célula não tem identidade própria; a posição na
                        // linha é o que ela é.
                        <td key={`${registro.id}-${indice}`}>{celula}</td>
                      ))}
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
