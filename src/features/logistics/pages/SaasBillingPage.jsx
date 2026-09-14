import { useMemo, useState } from "react";
import { Layers, Package, TrendingDown } from "lucide-react";
import {
  MODULOS,
  METRICAS,
  normalizarPlano,
  faturarCiclo,
  analisarDowngrade,
} from "../saasBillingDomain.js";
import "./TodoGreenPages.css";

// SaaS · Billing multi-tenant (bloco 24). Este é o simulador do comercial:
// escolhe módulos, define preço base e franquia por métrica, e vê a fatura
// do ciclo em tempo real. Faz também a análise de downgrade para não perder
// um cliente que ainda usa o módulo que o novo plano tira.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const MODULO_LABELS = {
  planejamento: "Planejamento",
  frota: "Frota e veículos",
  motorista: "Motoristas e app",
  operacao: "Operação e torre",
  "portal-cliente": "Portal do cliente",
  recarga: "Recarga (Green On)",
  energia: "Energia + BESS/solar",
  greenpay: "GreenPay",
  esg: "ESG",
  seguranca: "Segurança",
  greenmob: "Greenmob (locação)",
  ai: "IA (premium)",
  bi: "BI (premium)",
};

export default function SaasBillingPage() {
  const [nome, setNome] = useState("Plano All Green");
  const [ciclo, setCiclo] = useState("mensal");
  const [precoBase, setPrecoBase] = useState("990");
  const [descontoAnual, setDescontoAnual] = useState("15");
  const [modulos, setModulos] = useState(["frota", "motorista", "operacao"]);
  const [uso, setUso] = useState({ veiculo: 40, motorista: 30, "rota-planejada": 500, "sessao-recarga": 120 });
  const [porUnidade, setPorUnidade] = useState({
    veiculo: { precoReais: 30, franquia: 25 },
    motorista: { precoReais: 12, franquia: 20 },
    "rota-planejada": { precoReais: 0.5, franquia: 400 },
    "sessao-recarga": { precoReais: 0.4, franquia: 100 },
    estacao: { precoReais: 100, franquia: 0 },
    carregador: { precoReais: 25, franquia: 0 },
    enterprise: { precoReais: 0, franquia: 0 },
  });

  const plano = useMemo(
    () => normalizarPlano({
      id: "plano", nome, ciclo, precoBaseReais: Number(precoBase) || 0,
      descontoAnualPct: Number(descontoAnual) || 0, modulos, porUnidade,
    }),
    [nome, ciclo, precoBase, descontoAnual, modulos, porUnidade],
  );
  const fatura = useMemo(() => faturarCiclo({ plano }, uso), [plano, uso]);
  const downgrade = useMemo(
    () => analisarDowngrade({ plano }, { ...plano, modulos: modulos.slice(0, Math.max(1, modulos.length - 1)) }, uso),
    [plano, modulos, uso],
  );

  const toggleModulo = (m) => {
    setModulos((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>SAAS · BILLING</span>
          <h2>Contratação e faturamento por módulo</h2>
          <p>Cliente contrata um módulo isolado, uma combinação ou o pacote inteiro. A fatura do ciclo é base + excedente sobre franquia por métrica; desconto anual só quando o ciclo é anual; consumo de métrica sem preço não vira cobrança silenciosa — vira aviso.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Package size={20} /></span><div><strong>Plano</strong><small>{plano.modulos.length} módulo(s) · {plano.ciclo}</small></div></div>
        <div className="tdg-recarga-form">
          <label className="tdg-recarga-wide"><span>Nome</span><input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label><span>Ciclo</span>
            <select value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
              <option value="mensal">mensal</option>
              <option value="anual">anual</option>
            </select>
          </label>
          <label><span>Preço base (R$)</span><input type="number" min="0" step="0.01" value={precoBase} onChange={(e) => setPrecoBase(e.target.value)} /></label>
          <label><span>Desconto anual (%)</span><input type="number" min="0" max="100" step="0.1" value={descontoAnual} onChange={(e) => setDescontoAnual(e.target.value)} disabled={ciclo !== "anual"} /></label>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Layers size={20} /></span><div><strong>Módulos contratados</strong><small>marque os que entram no plano</small></div></div>
        <div className="tdg-recarga-form">
          {MODULOS.map((m) => (
            <label key={m}><span>{MODULO_LABELS[m] || m}</span>
              <input type="checkbox" checked={modulos.includes(m)} onChange={() => toggleModulo(m)} />
            </label>
          ))}
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Package size={20} /></span><div><strong>Métricas do plano</strong><small>franquia inclusa + preço do excedente</small></div></div>
        <div className="tdg-tabela-frame">
          <table className="tdg-tabela">
            <thead><tr><th>Métrica</th><th>Franquia</th><th>Preço unitário (R$)</th><th>Uso no ciclo</th></tr></thead>
            <tbody>
              {METRICAS.map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td><input type="number" min="0" step="1" value={porUnidade[k]?.franquia ?? 0} onChange={(e) => setPorUnidade({ ...porUnidade, [k]: { ...porUnidade[k], franquia: Number(e.target.value) || 0 } })} /></td>
                  <td><input type="number" min="0" step="0.01" value={porUnidade[k]?.precoReais ?? 0} onChange={(e) => setPorUnidade({ ...porUnidade, [k]: { ...porUnidade[k], precoReais: Number(e.target.value) || 0 } })} /></td>
                  <td><input type="number" min="0" step="1" value={uso[k] ?? 0} onChange={(e) => setUso({ ...uso, [k]: Number(e.target.value) || 0 })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Package size={20} /></span><div><strong>Fatura do ciclo</strong><small>{fatura.ciclo}</small></div></div>
        <div className="tdg-recarga-metrics">
          <article><small>Base</small><strong>{moeda.format(fatura.baseReais)}</strong></article>
          <article><small>Excedente por uso</small><strong>{moeda.format(fatura.usoReais)}</strong></article>
          <article><small>Bruto</small><strong>{moeda.format(fatura.brutoReais)}</strong></article>
          <article><small>Desconto anual</small><strong>{moeda.format(fatura.descontoAnualReais)}</strong></article>
          <article><small>Total do ciclo</small><strong>{moeda.format(fatura.totalReais)}</strong></article>
        </div>
        {fatura.avisos.length > 0 && (
          <p className="tdg-driver-nota">Avisos: {fatura.avisos.map((a) => `${a.metrica} (${a.motivo}) usou ${a.consumido}`).join(" · ")}. Configure preço para essas métricas ou ative o módulo correspondente.</p>
        )}
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><TrendingDown size={20} /></span><div><strong>Simulação de downgrade</strong><small>o que o cliente perde se cair um módulo</small></div></div>
        {downgrade.perdendo.length === 0 ? (
          <p className="tdg-driver-nota">Plano com um módulo só — nada a perder num downgrade adicional.</p>
        ) : (
          <div className="tdg-tabela-frame">
            <table className="tdg-tabela">
              <thead><tr><th>Módulo perdido</th><th>Métrica associada</th><th>Uso ativo hoje</th></tr></thead>
              <tbody>
                {downgrade.impacto.map((i) => (
                  <tr key={i.modulo}><td>{MODULO_LABELS[i.modulo] || i.modulo}</td><td>{i.metrica || "—"}</td><td>{i.consumido}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}
