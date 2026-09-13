import "./TodoGreenPages.css";
import { useCallback, useEffect, useState } from "react";
import { Wallet, Check, DollarSign, RefreshCw, FileDown, Scale, CalendarClock, Plus, Trash2 } from "lucide-react";
import { linhasDoExtrato, extratoCsv } from "../greenPayStatementDomain.js";

// GreenPay do lado da gestão: define a régua de ganhos (o motorista vê o
// resultado no app), sincroniza as entregas já feitas e aprova/paga a carteira
// de cada motorista. Fase 2 acrescenta extrato exportável, conciliação do
// repasse e contratos de ganho recorrente. O cálculo é do servidor; aqui só se
// decidem os valores e os status. Gate real é finance:manage no worker.

const reais = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Retornos externos colados (settlementId;valor por linha) → lista para conciliar.
const parseRetornos = (texto) =>
  String(texto || "")
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const [ref, valor] = linha.split(/[;,\t]/);
      return { referenciaExterna: String(ref || "").trim(), valor: Number(String(valor || "").replace(",", ".")) || 0 };
    })
    .filter((r) => r.referenciaExterna);

// Download de um CSV no app real (fora do sandbox de artefato). BOM UTF-8 para
// abrir com acento no Excel/Planilhas.
const baixarCsv = (nome, csv) => {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default function GreenPayAdminPage({ authHeaders, setToast }) {
  const [regua, setRegua] = useState(null);
  const [motoristas, setMotoristas] = useState([]);
  const [form, setForm] = useState({ valorPorEntrega: "", valorPorKm: "", bonusEntregaSemOcorrencia: "", metaMensal: "" });
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [contratos, setContratos] = useState([]);
  const [contratoForm, setContratoForm] = useState({ driverId: "", descricao: "", valor: "", diaDoMes: "1" });
  const [repasses, setRepasses] = useState([]);
  const [retornosTexto, setRetornosTexto] = useState("");
  const [conciliacao, setConciliacao] = useState(null);

  const api = useCallback(async (caminho, options = {}) => {
    const r = await fetch(`/api/todogreen/greenpay${caminho}`, {
      ...options,
      headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Não foi possível concluir no GreenPay.");
    return d;
  }, [authHeaders]);

  const carregar = useCallback(async () => {
    try {
      const [rg, mt, ct, rp] = await Promise.all([api("/regua"), api("/motoristas"), api("/contratos"), api("/repasses")]);
      setRegua(rg);
      setForm({
        valorPorEntrega: String(rg.regra?.valorPorEntrega ?? ""),
        valorPorKm: String(rg.regra?.valorPorKm ?? ""),
        bonusEntregaSemOcorrencia: String(rg.regra?.bonusEntregaSemOcorrencia ?? ""),
        metaMensal: rg.regra?.metaMensal ? String(rg.regra.metaMensal) : "",
      });
      setMotoristas(mt.motoristas || []);
      setContratos(ct.contratos || []);
      setRepasses(rp.repasses || []);
    } catch (e) { setToast?.(e.message); }
    finally { setCarregando(false); }
  }, [api, setToast]);
  useEffect(() => { carregar(); }, [carregar]);

  // Extrato de um motorista → CSV (fase 2). Busca a carteira, monta as linhas e
  // baixa no navegador. Sem serviço pago: é o mesmo padrão do gerador de planilha.
  const baixarExtrato = async (motorista) => {
    try {
      const carteira = await api(`/motoristas/${encodeURIComponent(motorista.driverId)}`);
      const linhas = linhasDoExtrato(carteira.extrato || []);
      if (!linhas.length) { setToast?.("Sem lançamentos para exportar."); return; }
      baixarCsv(`extrato-${(motorista.nome || motorista.driverId).replace(/\s+/g, "-")}.csv`, extratoCsv(linhas));
      setToast?.("Extrato exportado.");
    } catch (e) { setToast?.(e.message); }
  };

  const conciliar = async () => {
    setOcupado(true);
    try {
      const r = await api("/conciliar", { method: "POST", body: JSON.stringify({ retornos: parseRetornos(retornosTexto) }) });
      setConciliacao(r);
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  const salvarContrato = async (event) => {
    event.preventDefault();
    setOcupado(true);
    try {
      await api("/contratos", {
        method: "POST",
        body: JSON.stringify({
          driverId: contratoForm.driverId,
          descricao: contratoForm.descricao,
          valor: Number(contratoForm.valor) || 0,
          diaDoMes: Number(contratoForm.diaDoMes) || 1,
        }),
      });
      setContratoForm({ driverId: "", descricao: "", valor: "", diaDoMes: "1" });
      setToast?.("Contrato criado.");
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  const removerContrato = async (contrato) => {
    try {
      await api(`/contratos/${encodeURIComponent(contrato.id)}`, { method: "DELETE" });
      setToast?.("Contrato removido.");
      await carregar();
    } catch (e) { setToast?.(e.message); }
  };

  const gerarMesContratos = async () => {
    setOcupado(true);
    try {
      const r = await api("/gerar-contratos", { method: "POST", body: JSON.stringify({}) });
      setToast?.(`${r.gerados} lançamento(s) de contrato gerado(s) para ${r.mes}.`);
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  const salvarRegua = async () => {
    setOcupado(true);
    try {
      await api("/regua", {
        method: "PUT",
        body: JSON.stringify({
          valorPorEntrega: Number(form.valorPorEntrega) || 0,
          valorPorKm: Number(form.valorPorKm) || 0,
          bonusEntregaSemOcorrencia: Number(form.bonusEntregaSemOcorrencia) || 0,
          metaMensal: Number(form.metaMensal) || 0,
        }),
      });
      setToast?.("Régua de ganhos salva. Sincronize para aplicar às entregas já feitas.");
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  const sincronizar = async () => {
    setOcupado(true);
    try {
      const r = await api("/sincronizar", { method: "POST" });
      setToast?.(`${r.lancamentosCriados} lançamento(s) gerado(s) de ${r.viagensComGanhoNovo} viagem(ns).`);
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  const acao = async (driverId, tipo) => {
    setOcupado(true);
    try {
      const r = await api(`/${tipo}`, { method: "POST", body: JSON.stringify({ driverId }) });
      setToast?.(tipo === "aprovar" ? `${r.aprovados} lançamento(s) aprovado(s).` : `${r.pagos} lançamento(s) pago(s).`);
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setOcupado(false); }
  };

  return (
    <section className="tdg-panel tdg-greenpay">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">GREENPAY</span>
          <h2>Carteira dos motoristas</h2>
          <p>Defina quanto o motorista ganha por entrega e por km. O valor de cada viagem é calculado sozinho — o motorista vê no app dele, sem digitar nada.</p>
        </div>
        <Wallet size={26} />
      </div>

      <article className="tdg-work-area">
        <div className="tdg-work-area-heading"><span><DollarSign size={20} /></span><div><strong>Régua de ganhos</strong><small>{regua?.configurada ? "Configurada — em vigor" : "Ainda não configurada"}</small></div></div>
        <div className="tdg-greenpay-form">
          <label>Por entrega (R$)<input type="number" min="0" step="0.01" value={form.valorPorEntrega} onChange={(e) => setForm((f) => ({ ...f, valorPorEntrega: e.target.value }))} /></label>
          <label>Por km (R$)<input type="number" min="0" step="0.01" value={form.valorPorKm} onChange={(e) => setForm((f) => ({ ...f, valorPorKm: e.target.value }))} /></label>
          <label>Bônus sem ocorrência (R$)<input type="number" min="0" step="0.01" value={form.bonusEntregaSemOcorrencia} onChange={(e) => setForm((f) => ({ ...f, bonusEntregaSemOcorrencia: e.target.value }))} /></label>
          <label>Meta de ganho do mês (R$)<input type="number" min="0" step="0.01" value={form.metaMensal} onChange={(e) => setForm((f) => ({ ...f, metaMensal: e.target.value }))} placeholder="opcional" /></label>
        </div>
        <div className="tdg-greenpay-acoes">
          <button type="button" className="tdg-action" onClick={salvarRegua} disabled={ocupado}>Salvar régua</button>
          <button type="button" onClick={sincronizar} disabled={ocupado || !regua?.configurada}><RefreshCw size={15} /> Sincronizar entregas</button>
        </div>
        {!regua?.configurada && <p className="tdg-driver-nota">Sem régua com valor, a carteira do motorista aparece como "não configurada" — não mostramos R$ 0 como se fosse ganho.</p>}
      </article>

      {/* Conexão SysPag (repasse PIX). Só status — o segredo mora no cofre.
          Enquanto não configurada, pagar mantém o valor no razão interno. */}
      {regua?.syspag && (
        <article className="tdg-work-area">
          <div className="tdg-work-area-heading">
            <span><Wallet size={20} /></span>
            <div>
              <strong>Repasse SysPag (PIX)</strong>
              <small className={regua.syspag.habilitado ? "tdg-syspag-on" : "tdg-syspag-off"}>
                {regua.syspag.habilitado ? "Conectado — pronto para repassar" : "Não configurado"}
              </small>
            </div>
          </div>
          <p className="tdg-driver-nota">{regua.syspag.mensagem}</p>
          {regua.syspag.faltando?.length > 0 && (
            <ul className="tdg-syspag-faltando">
              {regua.syspag.faltando.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
        </article>
      )}

      <article className="tdg-work-area">
        <div className="tdg-work-area-heading"><span><Wallet size={20} /></span><div><strong>Por motorista</strong><small>saldo, aprovação e pagamento</small></div></div>
        {carregando ? (
          <p>Carregando…</p>
        ) : motoristas.length === 0 ? (
          <p className="tdg-driver-vazio">Nenhum motorista cadastrado ainda.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela tdg-greenpay-tabela">
              <thead><tr><th>Motorista</th><th>Pendente</th><th>Aprovado</th><th>Pago</th><th>A receber</th><th>Ações</th></tr></thead>
              <tbody>
                {motoristas.map((m) => (
                  <tr key={m.driverId}>
                    <td>{m.nome}</td>
                    <td>{reais(m.pendente)}</td>
                    <td>{reais(m.aprovado)}</td>
                    <td>{reais(m.pago)}</td>
                    <td><strong>{reais(m.aReceber)}</strong></td>
                    <td className="tdg-greenpay-linha-acoes">
                      <button type="button" onClick={() => acao(m.driverId, "aprovar")} disabled={ocupado || m.pendente <= 0}><Check size={14} /> Aprovar</button>
                      <button type="button" onClick={() => acao(m.driverId, "pagar")} disabled={ocupado || m.aprovado <= 0}><DollarSign size={14} /> Pagar</button>
                      <button type="button" onClick={() => baixarExtrato(m)} disabled={m.lancamentos <= 0}><FileDown size={14} /> Extrato</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tdg-driver-nota">Aprovar move o pendente para aprovado; pagar registra o pagamento de tudo que está aprovado, num lote. Extrato exporta os lançamentos do motorista em CSV. GreenPay é a carteira do motorista — não é a folha (essa fica no RH).</p>
      </article>

      {/* Contratos de ganho recorrente: valor fixo mensal (ajuda de custo,
          retainer). O mês é gerado por ação explícita — nada de dinheiro criado
          sozinho. */}
      <article className="tdg-work-area">
        <div className="tdg-work-area-heading"><span><CalendarClock size={20} /></span><div><strong>Contratos de ganho recorrente</strong><small>valor fixo mensal por motorista</small></div></div>
        <form className="tdg-greenpay-form" onSubmit={salvarContrato}>
          <label>Motorista
            <select value={contratoForm.driverId} onChange={(e) => setContratoForm((f) => ({ ...f, driverId: e.target.value }))} required>
              <option value="">Escolha…</option>
              {motoristas.map((m) => <option key={m.driverId} value={m.driverId}>{m.nome}</option>)}
            </select>
          </label>
          <label>Descrição<input value={contratoForm.descricao} onChange={(e) => setContratoForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="ex.: Ajuda de custo" /></label>
          <label>Valor mensal (R$)<input type="number" min="0" step="0.01" value={contratoForm.valor} onChange={(e) => setContratoForm((f) => ({ ...f, valor: e.target.value }))} /></label>
          <label>Dia do mês<input type="number" min="1" max="28" value={contratoForm.diaDoMes} onChange={(e) => setContratoForm((f) => ({ ...f, diaDoMes: e.target.value }))} /></label>
        </form>
        <div className="tdg-greenpay-acoes">
          <button type="button" className="tdg-action" onClick={salvarContrato} disabled={ocupado}><Plus size={15} /> Adicionar contrato</button>
          <button type="button" onClick={gerarMesContratos} disabled={ocupado || contratos.length === 0}><RefreshCw size={15} /> Gerar mês atual</button>
        </div>
        {contratos.length === 0 ? (
          <p className="tdg-driver-nota">Nenhum contrato recorrente. Um contrato gera um lançamento de ganho por mês — idempotente, sem duplicar ao gerar de novo.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Motorista</th><th>Descrição</th><th>Valor</th><th>Dia</th><th></th></tr></thead>
              <tbody>
                {contratos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.driverNome || c.driverId}</td>
                    <td>{c.descricao}</td>
                    <td>{reais(c.valor)}</td>
                    <td>{c.diaDoMes}</td>
                    <td><button type="button" className="tdg-recarga-remover" onClick={() => removerContrato(c)} aria-label="Remover contrato"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* Conciliação: casa o pago no razão com o retorno externo (SysPag/banco).
          Enquanto o repasse externo não é confirmado, os lotes ficam "sem
          retorno" — honesto, não finge que conferiu. */}
      <article className="tdg-work-area">
        <div className="tdg-work-area-heading"><span><Scale size={20} /></span><div><strong>Conciliação do repasse</strong><small>{repasses.length} lote(s) pago(s)</small></div></div>
        {repasses.length === 0 ? (
          <p className="tdg-driver-nota">Nenhum repasse pago ainda. Ao pagar um lote, ele aparece aqui para conciliar com o retorno da SysPag ou do extrato bancário.</p>
        ) : (
          <>
            <p className="tdg-driver-nota">Cole os retornos externos (um por linha: <code>referência;valor</code>) — da SysPag ou do extrato bancário — para conferir contra os {repasses.length} lote(s) pago(s). Sem retorno, o lote fica &ldquo;pago no razão, repasse não confirmado&rdquo;.</p>
            <textarea className="tdg-conciliacao-textarea" rows={3} value={retornosTexto} onChange={(e) => setRetornosTexto(e.target.value)} placeholder={"s-abc123;150.00\ns-def456;80.00"} />
            <div className="tdg-greenpay-acoes">
              <button type="button" className="tdg-action" onClick={conciliar} disabled={ocupado}><Scale size={15} /> Conciliar</button>
            </div>
            {conciliacao && (
              <div className="tdg-recarga-metrics" style={{ marginTop: 12 }}>
                <article><small>Conferidos</small><strong>{conciliacao.resumo.conferidos}</strong></article>
                <article className={conciliacao.resumo.divergentes > 0 ? "risk" : ""}><small>Divergentes</small><strong>{conciliacao.resumo.divergentes}</strong></article>
                <article><small>Sem retorno</small><strong>{conciliacao.resumo.semRetorno}</strong></article>
                <article className={conciliacao.resumo.semLancamento > 0 ? "risk" : ""}><small>Saída órfã</small><strong>{conciliacao.resumo.semLancamento}</strong></article>
              </div>
            )}
            {conciliacao?.divergente?.length > 0 && (
              <p className="tdg-driver-nota">Divergências: {conciliacao.divergente.map((d) => `${d.settlementId} (${reais(d.diferenca)})`).join(", ")}. A conciliação aponta — não conserta sozinha.</p>
            )}
          </>
        )}
      </article>
    </section>
  );
}
