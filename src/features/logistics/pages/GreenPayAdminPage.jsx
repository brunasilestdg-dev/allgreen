import "./TodoGreenPages.css";
import { useCallback, useEffect, useState } from "react";
import { Wallet, Check, DollarSign, RefreshCw } from "lucide-react";

// GreenPay do lado da gestão: define a régua de ganhos (o motorista vê o
// resultado no app), sincroniza as entregas já feitas e aprova/paga a carteira
// de cada motorista. O cálculo é do servidor; aqui só se decidem os valores e
// os status. Gate real é finance:manage no worker.

const reais = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GreenPayAdminPage({ authHeaders, setToast }) {
  const [regua, setRegua] = useState(null);
  const [motoristas, setMotoristas] = useState([]);
  const [form, setForm] = useState({ valorPorEntrega: "", valorPorKm: "", bonusEntregaSemOcorrencia: "", metaMensal: "" });
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(true);

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
      const [rg, mt] = await Promise.all([api("/regua"), api("/motoristas")]);
      setRegua(rg);
      setForm({
        valorPorEntrega: String(rg.regra?.valorPorEntrega ?? ""),
        valorPorKm: String(rg.regra?.valorPorKm ?? ""),
        bonusEntregaSemOcorrencia: String(rg.regra?.bonusEntregaSemOcorrencia ?? ""),
        metaMensal: rg.regra?.metaMensal ? String(rg.regra.metaMensal) : "",
      });
      setMotoristas(mt.motoristas || []);
    } catch (e) { setToast?.(e.message); }
    finally { setCarregando(false); }
  }, [api, setToast]);
  useEffect(() => { carregar(); }, [carregar]);

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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tdg-driver-nota">Aprovar move o pendente para aprovado; pagar registra o pagamento de tudo que está aprovado, num lote. GreenPay é a carteira do motorista — não é a folha (essa fica no RH).</p>
      </article>
    </section>
  );
}
