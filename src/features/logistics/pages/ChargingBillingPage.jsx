import { useMemo, useState } from "react";
import { DollarSign, Plus, Receipt, Trash2 } from "lucide-react";
import {
  ESCOPOS_PRECO,
  faturamentoPorCliente,
  precoConfigurado,
  validarRegraPreco,
} from "../chargingBillingDomain.js";
import "./TodoGreenPages.css";

// Cobrança de recarga por kWh (B2B/B2C). A régua de preço tem três escopos —
// base (tabela pública), segmento (B2B/B2C) e cliente (contrato) — e o mais
// específico vence. A fatura de cada cliente é DERIVADA das sessões medidas do
// período: kWh real × preço. Nada digitado à mão.

const formVazio = { escopo: "base", segmento: "", clienteId: "", precoPorKwh: "", observacao: "" };
const rotuloEscopo = { base: "Tabela base", segmento: "Por segmento", cliente: "Por cliente" };
const rotuloOrigem = { base: "tabela base", segmento: "segmento", cliente: "contrato" };
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const hoje = () => new Date().toISOString().slice(0, 10);
const inicioDoMes = () => `${hoje().slice(0, 7)}-01`;

export default function ChargingBillingPage({ regras = [], sessoes = [], clientes = [], criar, arquivar, setToast }) {
  const [form, setForm] = useState(formVazio);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [de, setDe] = useState(inicioDoMes());
  const [ate, setAte] = useState(hoje());

  const configurado = useMemo(() => precoConfigurado(regras), [regras]);
  const faturamento = useMemo(
    () => faturamentoPorCliente(sessoes, regras, { de, ate }),
    [sessoes, regras, de, ate],
  );
  const rotuloCliente = (c) => c.nome || c.razaoSocial || c.name || c.id;

  const salvar = async (event) => {
    event.preventDefault();
    const cliente = (clientes || []).find((c) => c.id === form.clienteId);
    const corpo = { ...form, clienteNome: cliente ? rotuloCliente(cliente) : "" };
    const erro = validarRegraPreco(corpo);
    if (erro) { setToast?.(erro); return; }
    setSalvando(true);
    try {
      await criar?.("chargingPrices", corpo);
      setForm(formVazio);
      setAberto(false);
      setToast?.("Preço por kWh salvo.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (regra) => {
    try {
      await arquivar?.("chargingPrices", regra.id);
      setToast?.("Regra de preço removida.");
    } catch (razao) { setToast?.(razao.message); }
  };

  return (
    <div className="tdg-page tdg-recarga-page">
      <header className="tdg-page-title">
        <div>
          <span>ELETRIFICAÇÃO · FINANCEIRO</span>
          <h2>Cobrança de recarga (kWh)</h2>
          <p>Defina o preço por kWh e fature quem recarrega na rede. A fatura sai das sessões <strong>medidas</strong> do período — kWh real × preço. O preço de contrato do cliente vence o do segmento, que vence a tabela base.</p>
        </div>
        <button className="tdg-action" type="button" onClick={() => setAberto((v) => !v)}>
          <Plus size={16} />Novo preço
        </button>
      </header>

      {aberto && (
        <form className="tdg-recarga-form tdg-panel" onSubmit={salvar}>
          <label><span>Escopo</span>
            <select value={form.escopo} onChange={(e) => setForm({ ...form, escopo: e.target.value })}>
              {ESCOPOS_PRECO.map((s) => <option key={s} value={s}>{rotuloEscopo[s]}</option>)}
            </select>
          </label>
          {form.escopo !== "base" && (
            <label><span>Segmento</span>
              <select value={form.segmento} onChange={(e) => setForm({ ...form, segmento: e.target.value })}>
                <option value="">—</option>
                <option value="b2b">B2B</option>
                <option value="b2c">B2C</option>
              </select>
            </label>
          )}
          {form.escopo === "cliente" && (
            <label className="tdg-recarga-wide"><span>Cliente</span>
              <select value={form.clienteId} onChange={(e) => setForm({ ...form, clienteId: e.target.value })}>
                <option value="">Escolha o cliente…</option>
                {(clientes || []).map((c) => <option key={c.id} value={c.id}>{rotuloCliente(c)}</option>)}
              </select>
            </label>
          )}
          <label><span>Preço por kWh (R$)</span><input type="number" min="0" step="0.01" inputMode="decimal" value={form.precoPorKwh} onChange={(e) => setForm({ ...form, precoPorKwh: e.target.value })} placeholder="ex.: 1.90" /></label>
          <label className="tdg-recarga-wide"><span>Observação</span><input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="opcional" /></label>
          <div className="tdg-recarga-form-actions">
            <button type="button" onClick={() => { setAberto(false); setForm(formVazio); }}>Cancelar</button>
            <button className="tdg-action" type="submit" disabled={salvando}>{salvando ? "Salvando..." : "Salvar preço"}</button>
          </div>
        </form>
      )}

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><DollarSign size={20} /></span><div><strong>Tabela de preço por kWh</strong><small>{configurado ? "Configurada" : "Ainda não configurada"}</small></div></div>
        {(regras || []).length === 0 ? (
          <p className="tdg-driver-nota">Sem preço configurado, nenhuma recarga é faturável — a tela não cobra R$ 0 como se fosse de graça.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Escopo</th><th>Segmento</th><th>Cliente</th><th>R$/kWh</th><th></th></tr></thead>
              <tbody>
                {regras.map((r) => (
                  <tr key={r.id}>
                    <td>{rotuloEscopo[r.escopo] || r.escopo}</td>
                    <td>{r.segmento ? r.segmento.toUpperCase() : "—"}</td>
                    <td>{r.clienteNome || "—"}</td>
                    <td>{moeda.format(r.precoPorKwh)}</td>
                    <td><button type="button" className="tdg-recarga-remover" onClick={() => remover(r)} aria-label="Remover preço"><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Receipt size={20} /></span><div><strong>Faturamento por cliente</strong><small>sessões medidas do período</small></div></div>
        <div className="tdg-recarga-filtros">
          <label>De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>Até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </div>
        {!configurado ? (
          <p className="tdg-driver-nota">Configure ao menos um preço por kWh para faturar.</p>
        ) : faturamento.faturas.length === 0 ? (
          <p className="tdg-driver-nota">Nenhuma sessão faturável no período. {faturamento.usoInterno > 0 ? `${faturamento.usoInterno} recarga(s) de uso interno (não cobram). ` : ""}{faturamento.semPreco > 0 ? `${faturamento.semPreco} sem preço aplicável.` : ""}</p>
        ) : (
          <>
            <div className="tdg-recarga-metrics">
              <article><small>Total a faturar</small><strong>{moeda.format(faturamento.totalGeral)}</strong></article>
              <article><small>Energia faturável</small><strong>{numero.format(faturamento.energiaGeral)} kWh</strong></article>
              <article><small>Clientes</small><strong>{faturamento.faturas.length}</strong></article>
            </div>
            <div className="tdg-tabela-frame">
              <table className="tdg-tabela">
                <thead><tr><th>Cliente</th><th>Sessões</th><th>kWh</th><th>Valor</th></tr></thead>
                <tbody>
                  {faturamento.faturas.map((f) => (
                    <tr key={f.clienteId || f.clienteNome}>
                      <td>{f.clienteNome}</td>
                      <td>{f.sessoes}</td>
                      <td>{numero.format(f.energiaKwh)}</td>
                      <td><strong>{moeda.format(f.valor)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(faturamento.usoInterno > 0 || faturamento.semPreco > 0) && (
              <p className="tdg-driver-nota">Fora da fatura: {faturamento.usoInterno} de uso interno{faturamento.semPreco > 0 ? `, ${faturamento.semPreco} sem preço aplicável` : ""}. A origem do preço em cada sessão segue a régua ({Object.values(rotuloOrigem).join(" › ")}).</p>
            )}
          </>
        )}
      </article>
    </div>
  );
}
