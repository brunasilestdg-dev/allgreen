import { useMemo, useState } from "react";
import { CarFront, ClipboardList, Wrench } from "lucide-react";
import {
  criarContrato,
  registrarAvaria,
  cobrancaFinal,
  registrarDevolucao,
  kmRodados,
} from "../greenmobRentalDomain.js";
import "./TodoGreenPages.css";

// Greenmob — locação (bloco 21). Contrato, avaria com momento (pré/durante),
// cobrança final derivada (mensalidade + km excedente + avarias), devolução
// e isolamento por locatário. A tela abaixo é a operação de UM contrato do
// ponto de vista da locadora — o portal do próprio locatário lê o mesmo
// domínio, mas com scopeContratosDoLocatario aplicado.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const hoje = () => new Date().toISOString().slice(0, 10);

const semente = criarContrato({
  id: "contrato-demo",
  locatarioId: "loc-demo",
  tenantId: "todogreen",
  veiculoId: "VE-047",
  motoristaId: "drv-demo",
  inicioYmd: `${new Date().toISOString().slice(0, 7)}-01`,
  fimContratadoYmd: `${new Date().toISOString().slice(0, 7)}-30`,
  precoMensalReais: 3200,
  franquiaKmMes: 2500,
  precoKmExcedenteReais: 0.6,
  kmSaida: 12000,
  socSaidaPct: 80,
});

export default function GreenmobRentalPage() {
  const [contrato, setContrato] = useState(semente);
  const [avaria, setAvaria] = useState({ descricao: "", momento: "durante-locacao", valorReparoReais: "" });
  const [devolucao, setDevolucao] = useState({ devolvidoEmYmd: hoje(), kmDevolucao: "", socDevolucaoPct: "" });

  const cf = useMemo(() => cobrancaFinal(contrato), [contrato]);
  const km = kmRodados(contrato);

  const adicionarAvaria = (e) => {
    e.preventDefault();
    if (!avaria.descricao.trim()) return;
    setContrato((c) => registrarAvaria(c, {
      ...avaria,
      valorReparoReais: Number(avaria.valorReparoReais) || 0,
      autor: "operacao",
    }));
    setAvaria({ descricao: "", momento: "durante-locacao", valorReparoReais: "" });
  };

  const devolver = (e) => {
    e.preventDefault();
    setContrato((c) => registrarDevolucao(c, {
      devolvidoEmYmd: devolucao.devolvidoEmYmd,
      kmDevolucao: Number(devolucao.kmDevolucao) || null,
      socDevolucaoPct: Number(devolucao.socDevolucaoPct) || null,
      autor: "operacao",
    }));
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>GREENMOB · LOCAÇÃO</span>
          <h2>Contrato, avaria, devolução e cobrança</h2>
          <p>Cobrança final DERIVADA de mensalidade + km excedente + avarias registradas <em>durante a locação</em> (pré-existente não cobra). Nada acumulado à mão. Estado do contrato: <strong>{contrato.estado}</strong>.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><CarFront size={20} /></span><div><strong>Contrato · {contrato.veiculoId}</strong><small>Locatário {contrato.locatarioId} · início {contrato.inicioYmd}</small></div></div>
        <div className="tdg-recarga-metrics">
          <article><small>Mensalidade × meses</small><strong>{cf.mensalidadeReais == null ? "—" : moeda.format(cf.mensalidadeReais)}</strong></article>
          <article><small>Km rodados</small><strong>{numero.format(km)}</strong></article>
          <article><small>Km excedente</small><strong>{numero.format(cf.excedenteKm)} · {moeda.format(cf.excedenteReais)}</strong></article>
          <article><small>Avarias cobradas</small><strong>{cf.avariasCobradas} · {moeda.format(cf.avariasReais)}</strong></article>
          <article><small>Total do contrato</small><strong>{cf.totalReais == null ? "—" : moeda.format(cf.totalReais)}</strong></article>
        </div>
      </article>

      <form className="tdg-recarga-form tdg-panel" onSubmit={adicionarAvaria}>
        <div className="tdg-work-area-heading"><span><Wrench size={20} /></span><div><strong>Registrar avaria</strong><small>o momento decide se cobra ou só documenta</small></div></div>
        <label className="tdg-recarga-wide"><span>Descrição</span><input value={avaria.descricao} onChange={(e) => setAvaria({ ...avaria, descricao: e.target.value })} placeholder="ex.: amassado no para-lama traseiro direito" /></label>
        <label><span>Momento</span>
          <select value={avaria.momento} onChange={(e) => setAvaria({ ...avaria, momento: e.target.value })}>
            <option value="pre-existente">pré-existente (não cobra)</option>
            <option value="durante-locacao">durante a locação (cobra)</option>
          </select>
        </label>
        <label><span>Valor do reparo (R$)</span><input type="number" min="0" step="0.01" value={avaria.valorReparoReais} onChange={(e) => setAvaria({ ...avaria, valorReparoReais: e.target.value })} /></label>
        <div className="tdg-recarga-form-actions"><button className="tdg-action" type="submit">Adicionar</button></div>
      </form>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><ClipboardList size={20} /></span><div><strong>Avarias registradas</strong><small>{contrato.avarias.length} item(ns)</small></div></div>
        {contrato.avarias.length === 0 ? (
          <p className="tdg-driver-nota">Sem avarias registradas neste contrato.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Descrição</th><th>Momento</th><th>Reparo</th><th>Status</th></tr></thead>
              <tbody>
                {contrato.avarias.map((a) => (
                  <tr key={a.id}><td>{a.descricao}</td><td>{a.momento}</td><td>{moeda.format(a.valorReparoReais)}</td><td>{a.status}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <form className="tdg-recarga-form tdg-panel" onSubmit={devolver}>
        <div className="tdg-work-area-heading"><span><CarFront size={20} /></span><div><strong>Registrar devolução</strong><small>fecha o contrato e prepara a cobrança final</small></div></div>
        <label><span>Data</span><input type="date" value={devolucao.devolvidoEmYmd} onChange={(e) => setDevolucao({ ...devolucao, devolvidoEmYmd: e.target.value })} /></label>
        <label><span>Km devolução</span><input type="number" min={contrato.kmSaida} value={devolucao.kmDevolucao} onChange={(e) => setDevolucao({ ...devolucao, kmDevolucao: e.target.value })} /></label>
        <label><span>SOC devolução (%)</span><input type="number" min="0" max="100" value={devolucao.socDevolucaoPct} onChange={(e) => setDevolucao({ ...devolucao, socDevolucaoPct: e.target.value })} /></label>
        <div className="tdg-recarga-form-actions"><button className="tdg-action" type="submit" disabled={contrato.estado === "devolvido"}>Registrar devolução</button></div>
      </form>
    </div>
  );
}
