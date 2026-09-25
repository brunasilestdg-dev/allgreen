// Jornada ESG: o painel de Green Score e emissões, a metodologia por produto e
// o editor da régua ESG (fatores de CO₂ e pesos do Green Score).
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, FileCheck } from "lucide-react";
import {
  LOGISTICS_PRODUCTS,
  TODO_GREEN_PRODUCTION_DATA_POLICY,
  esgTranslator,
  getProductPricingBlueprint,
} from "../logisticsVerticalDomain.js";
import { number } from "./formatos.js";
import { MetricCard } from "./compartilhados.jsx";

export default function EsgPanel({ dashboard, data, onNavigate }) {
  const translator = esgTranslator(dashboard.co2Evitado);
  const latest = data.pricingScenarios[0]?.result?.impact;
  const hasImpact = Number(dashboard.co2Evitado || 0) > 0 || Boolean(latest);
  const dataState = hasImpact ? "Impacto calculado" : "Sem simulação validada";
  const nextActions = hasImpact
    ? [
        ["Emitir relatório", "/todogreen/relatorios"],
        ["Abrir evidências", "/todogreen/documentos"],
        ["Revisar metodologia", "/todogreen/metodologia"],
      ]
    : [
        ["Gerar simulação", "/todogreen/precificacao"],
        ["Parâmetros ESG", "/todogreen/parametros-simulador"],
        ["Ver oportunidades", "/todogreen/oportunidades"],
      ];
  return (
    <section className={`tdg-panel tdg-esg tdg-esg-ops ${hasImpact ? "" : "empty"}`}>
      <div className="tdg-esg-command">
        <div>
          <span className="tdg-kicker">ESG OPERACIONAL</span>
          <h2>Green Score e emissões</h2>
          <p>{hasImpact ? "Resultado ambiental ligado a simulações, evidências e relatórios." : "Calcule uma simulação confirmada para liberar números ambientais auditáveis."}</p>
        </div>
        <strong>{dataState}</strong>
      </div>
      <div className="tdg-esg-layout">
        <div className={`tdg-esg-score${hasImpact ? "" : " pending"}`}>
          <span>Green Score</span>
          <strong>{hasImpact ? number.format(dashboard.greenScore) : "Pendente"}</strong>
          <small>{hasImpact ? "Indicador proprietário, não certificação" : "Depende de preço, rota, distância e evidências"}</small>
        </div>
        <div className="tdg-result tdg-esg-kpis">
          <MetricCard label="CO2 evitado" value={hasImpact ? `${number.format(dashboard.co2Evitado / 1000)} t` : "Pendente"} detail="com memória de cálculo" tone={hasImpact ? "good" : "neutral"} />
          <MetricCard label="Diesel evitado" value={hasImpact ? `${number.format(dashboard.dieselNaoConsumido)} L` : "Pendente"} detail="comparação operacional" />
          <MetricCard label="Redução" value={hasImpact ? `${number.format(dashboard.reducaoEmissoesPercent)}%` : "Pendente"} detail="vs referência" />
        </div>
        <aside className="tdg-esg-next">
          <strong>Próximas ações</strong>
          {nextActions.map(([label, route]) => (
            <button type="button" onClick={() => onNavigate?.(route)} key={route}>{label}<ArrowRight size={14} /></button>
          ))}
        </aside>
      </div>
      {hasImpact ? <div className="tdg-method"><strong>Texto para proposta</strong><p>{translator.proposalText}</p><small>{translator.disclaimer}</small></div> : <div className="tdg-method tdg-esg-empty-state"><strong>Sem número publicado</strong><p>Evitei mostrar zero como resultado. Zero aqui significa ausência de simulação confirmada, não ausência de impacto.</p><small>Use Precificação para gerar a memória de cálculo e depois publique relatório.</small></div>}
      <div className="tdg-output-grid">
        <span><small>Versão metodologia</small><strong>{latest?.methodologyVersion || "tdg-env-v1"}</strong></span>
        <span><small>Fórmula</small><strong>{latest?.formula || "Aguardando simulação"}</strong></span>
        <span><small>Unidades</small><strong>{latest?.units || "kgCO2e, litros, km, kWh"}</strong></span>
      </div>
    </section>
  );
}

// Rótulos legíveis dos fatores da régua ESG. A chave é a mesma do motor
// (DEFAULT_ENVIRONMENTAL_FACTORS); a ordem aqui é a ordem na tela.
const ROTULOS_FATORES_ESG = [
  ["dieselKgCo2ePerLiter", "Diesel — kg CO₂e por litro", 0.01],
  ["gasolineKgCo2ePerLiter", "Gasolina — kg CO₂e por litro", 0.01],
  ["dieselKmPerLiter", "Diesel — km por litro", 0.1],
  ["electricKgCo2ePerKwh", "Elétrico — kg CO₂e por kWh (grid BR)", 0.0001],
  ["electricKwhPerKm", "Elétrico — kWh por km", 0.01],
  ["treeKgCo2eYear", "Equivalência — kg CO₂e por árvore/ano", 1],
  ["carKgCo2eYear", "Equivalência — kg CO₂e por carro/ano", 1],
  ["flightKgCo2e", "Equivalência — kg CO₂e por voo", 1],
  ["homeKwhMonth", "Equivalência — kWh por casa/mês", 1],
];
const ROTULOS_PESOS_ESG = [
  ["reduction", "Redução de emissão"],
  ["lowEmissionKm", "Km de baixa emissão"],
  ["cleanEnergy", "Energia limpa"],
  ["efficiency", "Eficiência (ocupação/produtividade)"],
  ["targetEvolution", "Evolução vs. meta"],
  ["dataQuality", "Qualidade do dado"],
];

// Editor da régua ESG (fatores de CO₂ + pesos do Green Score). É o que torna o
// número ESG do simulador editável — antes era constante no código. Sem régua
// salva, mostra os defaults de fábrica; salvar cria uma versão nova, auditada.
function ReguaEsgEditor({ authHeaders, setToast }) {
  const [dados, setDados] = useState(null);
  const [fatores, setFatores] = useState({});
  const [pesos, setPesos] = useState({});
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(() => {
    const headers = authHeaders?.() || {};
    if (!headers.authorization) return;
    fetch("/api/todogreen/environmental-parameters", { headers })
      .then(async (r) => { const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p.error || "Falha ao carregar a régua ESG."); return p; })
      .then((p) => { setDados(p); setFatores({ ...p.atual.fatores }); setPesos({ ...p.atual.pesos }); })
      .catch((e) => setToast?.(e.message));
  }, [authHeaders, setToast]);
  useEffect(() => { carregar(); }, [carregar]);
  if (!dados) return null;
  const restaurarPadrao = () => { setFatores({ ...dados.padrao.fatores }); setPesos({ ...dados.padrao.pesos }); };
  const salvar = async (event) => {
    event.preventDefault();
    if (justificativa.trim().length < 5) { setToast?.("Escreva a justificativa da mudança — ela fica no registro."); return; }
    setSalvando(true);
    try {
      const headers = { ...(authHeaders?.() || {}), "content-type": "application/json" };
      const r = await fetch("/api/todogreen/environmental-parameters", {
        method: "POST", headers, body: JSON.stringify({ fatores, pesos, justificativa }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Não foi possível salvar a régua ESG.");
      setJustificativa("");
      if (p.atual) { setFatores({ ...p.atual.fatores }); setPesos({ ...p.atual.pesos }); }
      setToast?.("Régua ESG salva. O simulador já usa os novos fatores.");
      carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setSalvando(false); }
  };
  const somaPesos = Object.values(pesos).reduce((s, v) => s + (Number(v) || 0), 0);
  return (
    <form className="tdg-access-form tdg-esg-regua" onSubmit={salvar}>
      <div className="tdg-section-head"><div><span className="tdg-kicker">RÉGUA ESG</span><h3>Fatores de CO₂ e pesos do Green Score</h3></div><strong>{dados.atual.deFabrica ? "padrão de fábrica" : `versão ${dados.atual.versao}`}</strong></div>
      <p className="tdg-esg-nota">Estes números movem o CO₂ evitado e o Green Score do simulador oficial. Campo em branco ou inválido volta ao padrão de fábrica ao salvar.</p>
      <fieldset disabled={!dados.podeEditar} className="tdg-esg-campos">
        <legend>Fatores de emissão e equivalências</legend>
        {ROTULOS_FATORES_ESG.map(([chave, rotulo, passo]) => (
          <label key={chave}><span>{rotulo}</span><input type="number" step={passo} min="0" value={fatores[chave] ?? ""} onChange={(e) => setFatores((v) => ({ ...v, [chave]: e.target.value }))} /></label>
        ))}
      </fieldset>
      <fieldset disabled={!dados.podeEditar} className="tdg-esg-campos">
        <legend>Pesos do Green Score {somaPesos > 0 ? `(somam ${somaPesos})` : ""}</legend>
        {ROTULOS_PESOS_ESG.map(([chave, rotulo]) => (
          <label key={chave}><span>{rotulo}</span><input type="number" step="1" min="0" value={pesos[chave] ?? ""} onChange={(e) => setPesos((v) => ({ ...v, [chave]: e.target.value }))} /></label>
        ))}
      </fieldset>
      {dados.podeEditar ? <>
        <label><span>Justificativa da mudança</span><input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Por que está mudando a régua? Fica no registro." /></label>
        <div className="tdg-form-actions"><button type="button" onClick={restaurarPadrao}>Restaurar padrão de fábrica</button><button className="tdg-action" type="submit" disabled={salvando}><FileCheck size={17} />{salvando ? "Salvando..." : "Salvar régua ESG"}</button></div>
      </> : <p className="tdg-esg-nota">Você pode consultar a régua, mas só quem administra ESG pode alterá-la.</p>}
    </form>
  );
}

export function MethodologyPanel({ authHeaders, setToast }) {
  const rows = LOGISTICS_PRODUCTS.map((product) => ({ product, blueprint: getProductPricingBlueprint(product.id) }));
  return (
    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">METODOLOGIA</span><h2>Premissas, evidências e rastreabilidade por produto</h2></div><strong>tdg-env-v1</strong></div>
      <div className="tdg-access-list">{rows.map(({ product, blueprint }) => <div className="tdg-access-row" key={product.id}><span><strong>{product.name}</strong><small>{blueprint.requiredEvidence.join(" · ")}</small></span><span>{blueprint.pricingUnit}</span></div>)}</div>
      <div className="tdg-method"><strong>Regra de dados</strong><p>{TODO_GREEN_PRODUCTION_DATA_POLICY.rule}</p><small>Estimativas ESG não são certificação oficial; servem como memória de cálculo comercial e operacional.</small></div>
      <ReguaEsgEditor authHeaders={authHeaders} setToast={setToast} />
    </section>
  );
}
