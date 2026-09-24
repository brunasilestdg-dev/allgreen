// Jornada de precificação: a calculadora por produto, com premissas, régua em
// vigor, custos ajustáveis na simulação, pedido de aprovação comercial e a
// simulação salva no servidor.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, ShieldCheck } from "lucide-react";
import {
  LOGISTICS_PRODUCTS,
  DEFAULT_PRICING_ASSUMPTIONS,
  TODO_GREEN_TENANT,
  centralPricingEngine,
  createPricingScenarioSnapshot,
  getProductPricingBlueprint,
  hasTodoGreenPermission,
  productSpecificOutputs,
  pricingDecisionSummary,
} from "../logisticsVerticalDomain.js";
import {
  NIVEIS,
  premissasDaSimulacao,
  registroDaConfirmacao,
  situacaoDoResultado,
} from "../pricingPremisesDomain.js";
import { inputsDePrecificacaoDaOportunidade } from "../electrificationJourneyDomain.js";
import { comRotulo } from "../rotulosDomain.js";
import { calcularDistancia, resumoDaDistancia } from "../distanciaRodoviariaDomain.js";
import { produtoDaRota, navigate } from "../shell/rotas.js";
import { ownerId } from "../shell/acesso.js";
import { BRL, number } from "./formatos.js";
import {
  fieldLabels,
  textFields,
  booleanFields,
  VEHICLE_TYPES,
  productDefaults,
} from "./formularioDePrecificacao.js";
import { ProductCard } from "./compartilhados.jsx";

const PricingPerformancePanel = lazy(() => import("../PricingPerformancePanel.jsx"));

const outputLabels = {
  custoTotal: "Custo mensal da operação",
  precoMinimo: "Menor preço recomendado",
  precoRecomendado: "Preço recomendado",
  margem: "Margem estimada",
  resultadoMensal: "Resultado mensal estimado",
  resultadoAnual: "Resultado anual estimado",
  impactoAmbiental: "CO₂ evitado",
  custoPorVeiculo: "Custo mensal por veículo",
  custoPorDia: "Custo por dia",
  impactoVeiculoReserva: "Custo do veículo reserva",
};

const formatOutputValue = (key, value) => {
  if (typeof value !== "number") return value;
  if (["margem", "ocupacao", "ocupacaoMinima", "produtividadeMinima"].includes(key)) return `${number.format(value)}%`;
  if (key === "impactoAmbiental") return `${number.format(value / 1000)} t`;
  return BRL.format(value);
};

const friendlyCommercialText = (value) =>
  String(value || "")
    .replace(/Encaminhar ao Deal Desk/gi, "Enviar para aprovação comercial")
    .replace(/Deal Desk/gi, "aprovação comercial")
    .replace(/target/gi, "valor esperado pelo cliente")
    .replace(/parâmetros/gi, "dados da operação");

// ===== Distância que a própria operação calcula =====
//
// `distanceKm` era digitado à mão em Middle Mile, Last Mile, Transferência e
// Coleta em fornecedores — a premissa mais frágil da conta inteira, porque
// multiplica combustível, pedágio, hora de motorista e emissão de CO2. Errar
// 40 km numa operação de 44 viagens/mês erra o preço do contrato.
//
// O app já sabia traçar rota (Nominatim + OSRM, sem chave e sem cota); só não
// estava ligado aqui. Oferece como SUGESTÃO: quem precifica pode ter motivo
// para outro número — rota que o cliente exige, restrição de circulação,
// trecho que a operação faz diferente do que o roteirizador acha.
function BotaoDistancia({ origem, destino, idaEVolta, onAceitar }) {
  const [estado, setEstado] = useState({ fase: "parado" });
  const podeCalcular = String(origem || "").trim().length >= 3 && String(destino || "").trim().length >= 3;

  const calcular = async () => {
    setEstado({ fase: "calculando" });
    const resultado = await calcularDistancia({ origem, destino, idaEVolta });
    setEstado(resultado.ok ? { fase: "pronto", resultado } : { fase: "erro", motivo: resultado.motivo });
  };

  if (!podeCalcular)
    return <small className="tdg-distancia-dica">Preencha origem e destino para calcular a distância pelo mapa.</small>;

  return (
    <div className="tdg-distancia">
      {estado.fase !== "pronto" && (
        <button type="button" className="tdg-distancia-botao" onClick={calcular} disabled={estado.fase === "calculando"}>
          {estado.fase === "calculando" ? "Consultando o mapa…" : "Calcular pelo mapa"}
        </button>
      )}
      {estado.fase === "erro" && <small className="tdg-distancia-erro">{estado.motivo}</small>}
      {estado.fase === "pronto" && (
        <div className="tdg-distancia-resultado">
          <strong>{resumoDaDistancia(estado.resultado)}</strong>
          <small>{estado.resultado.origem} → {estado.resultado.destino}</small>
          <div>
            {/* A pessoa aceita; a tela não sobrescreve o que ela digitou. */}
            <button type="button" onClick={() => { onAceitar(estado.resultado.distanciaKm); setEstado({ fase: "parado" }); }}>
              Usar {estado.resultado.distanciaKm} km
            </button>
            <button type="button" className="secundario" onClick={() => setEstado({ fase: "parado" })}>Descartar</button>
          </div>
          <small className="tdg-distancia-fonte">{estado.resultado.fonte}</small>
        </div>
      )}
    </div>
  );
}

function FieldInput({ name, value, required, onChange, inputs }) {
  if (booleanFields.has(name)) {
    return (
      <label className="tdg-check-field">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(name, event.target.checked)} />
        <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
      </label>
    );
  }
  if (name === "distanceKm") {
    return (
      <label>
        <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
        <input
          value={value ?? ""}
          inputMode="decimal"
          onChange={(event) => onChange(name, event.target.value === "" ? "" : Number(event.target.value) || 0)}
        />
        <BotaoDistancia
          origem={inputs?.origin}
          destino={inputs?.destination}
          // Middle Mile cobra o ciclo completo quando o retorno é carregado ou
          // vazio: a viagem é ida e volta, e só a ida subestima o custo.
          idaEVolta={inputs?.returnLoaded === true || inputs?.roundTrip === true}
          onAceitar={(km) => onChange(name, km)}
        />
      </label>
    );
  }
  if (name === "vehicleType") {
    const valorAtual = value ?? "";
    // Preserva um valor antigo que não esteja na lista (ex.: "moto" digitado
    // antes de existir a escolha) para não sumir com a premissa gravada.
    const opcoes = valorAtual && !VEHICLE_TYPES.includes(valorAtual)
      ? [valorAtual, ...VEHICLE_TYPES]
      : VEHICLE_TYPES;
    return (
      <label>
        <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
        <select value={valorAtual} onChange={(event) => onChange(name, event.target.value)}>
          <option value="">Selecione o veículo</option>
          {opcoes.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label>
      <span>{comRotulo(fieldLabels, name)}{required ? " *" : ""}</span>
      <input
        value={value ?? ""}
        inputMode={textFields.has(name) ? "text" : "decimal"}
        // Campo numérico apagado vira "" e não 0: zero é uma resposta, vazio é
        // a ausência dela, e a tela precisa saber a diferença para não
        // calcular preço em cima de premissa que ninguém informou.
        onChange={(event) =>
          onChange(
            name,
            textFields.has(name) || event.target.value === ""
              ? event.target.value
              : Number(event.target.value) || 0,
          )
        }
      />
    </label>
  );
}

export default function PricingPanel({ role, criar, db, authHeaders, setToast, opportunities = [] }) {
  const opportunityId =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("opportunity") || "";
  const sourceOpportunity = opportunities.find((item) => item.id === opportunityId) || null;
  // O produto sai da rota primeiro; a oportunidade e o padrão só entram quando
  // a rota não traz produto. O painel é remontado ao trocar de produto (ver o
  // `key` no render), então ler a rota no início basta.
  const rotaProduto =
    typeof window === "undefined" ? "" : produtoDaRota(window.location.pathname);
  const initialProductId = rotaProduto || sourceOpportunity?.productId || "middle-mile";
  const [productId, setProductId] = useState(initialProductId);
  const [inputs, setInputs] = useState(() =>
    sourceOpportunity
      ? inputsDePrecificacaoDaOportunidade(
          sourceOpportunity,
          productDefaults[initialProductId] || productDefaults["middle-mile"],
        )
      : productDefaults["middle-mile"],
  );
  // Declaração de procedência das premissas. Cai a cada mudança: confirmar um
  // cenário e depois trocar a distância deixaria a declaração valendo para um
  // cálculo que já não é o mesmo.
  const [premissasConfirmadas, setPremissasConfirmadas] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // O id da simulação que acabou de ser salva. A aprovação é sobre a condição
  // exata; sem simulação gravada não há o que aprovar.
  const [cenarioSalvoId, setCenarioSalvoId] = useState("");
  const [justificativaDeAprovacao, setJustificativaDeAprovacao] = useState("");
  const [enviandoAprovacao, setEnviandoAprovacao] = useState(false);
  // Os parâmetros em vigor, administrados pelo gestor na tela de parâmetros.
  // Sem ela carregada ainda, a calculadora usa o padrão — e diz qual régua
  // está aplicando, porque preço sem régua identificada não se defende.
  const [regua, setRegua] = useState(null);
  // Custos da operação editáveis na própria calculadora. Nascem da régua em
  // vigor (ou do padrão) e, quando a pessoa mexe, sobrescrevem as premissas SÓ
  // nesta simulação — a régua versionada continua intacta. Era o pedido: ver e
  // ajustar motorista, energia e veículo aqui, sem abrir outra tela.
  const [custosManuais, setCustosManuais] = useState({});
  useEffect(() => {
    let vivo = true;
    const consulta = new URLSearchParams({ productId });
    if (inputs.modality) consulta.set("modality", inputs.modality);
    if (inputs.vehicleType) consulta.set("vehicleType", inputs.vehicleType);
    if (inputs.region || inputs.city) consulta.set("region", inputs.region || inputs.city);
    if (inputs.clientId) consulta.set("clientId", inputs.clientId);
    if (inputs.contractId) consulta.set("contractId", inputs.contractId);
    fetch(`/api/todogreen/pricing-parameters?${consulta}`, { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.atual) {
          const aplicados = d.resolvido?.aplicados || [];
          setRegua({
            ...d.atual,
            deFabrica: d.atual.deFabrica && aplicados.length === 0,
            parametros: d.resolvido?.parametros || d.atual.parametros,
            aplicados,
            versao: aplicados.map((item) => item.versao).join(" + ") || d.atual.versao,
          });
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [authHeaders, productId, inputs.modality, inputs.vehicleType, inputs.region, inputs.city, inputs.clientId, inputs.contractId]);
  const allowed = hasTodoGreenPermission(role, "pricing:simulate");
  const blueprint = getProductPricingBlueprint(productId);
  const product = LOGISTICS_PRODUCTS.find((item) => item.id === productId);
  // A base é a régua (ou o padrão); os custos manuais entram por cima. Só
  // valores realmente digitados sobrescrevem — campo vazio mantém a régua.
  const custosEfetivos = useMemo(() => ({ ...DEFAULT_PRICING_ASSUMPTIONS, ...(regua?.parametros || {}) }), [regua]);
  const assumptionsComOverride = useMemo(() => {
    const overrides = Object.fromEntries(
      Object.entries(custosManuais).filter(([, v]) => v !== "" && v != null && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]),
    );
    return { ...(regua?.parametros || {}), ...overrides };
  }, [regua, custosManuais]);
  const houveOverride = Object.values(custosManuais).some((v) => v !== "" && v != null);
  const result = useMemo(
    () =>
      centralPricingEngine(
        productId,
        inputs,
        { assumptions: assumptionsComOverride, parameterVersion: (regua?.versao || "padrão") + (houveOverride ? " · custo ajustado" : "") },
      ),
    [inputs, productId, assumptionsComOverride, regua, houveOverride],
  );
  const outputs = productSpecificOutputs(productId, result);
  const decision = pricingDecisionSummary(result);
  const hasEnvironmentalInputs = Number(inputs.distanceKm || inputs.kmPerRoute || 0) > 0;
  const selectProduct = (nextProductId) => {
    // Navega em vez de só trocar estado: a URL passa a refletir o produto, e o
    // painel remonta (pelo `key`) já com as premissas do produto novo — o
    // mesmo reset que este método fazia à mão, agora dirigido pela rota.
    const busca = typeof window === "undefined" ? "" : window.location.search;
    navigate(`/todogreen/precificacao/${nextProductId}${busca}`);
  };
  const changeInput = (key, value) => {
    setInputs((current) => ({ ...current, [key]: value }));
    // Escolher o veículo re-consulta a régua com aquele veículo (efeito abaixo),
    // e o custo de referência do veículo (fábrica) — ou o perfil do admin, se
    // houver — passa a valer como base do cálculo. Sem override forçado aqui: os
    // "Custos da operação" seguem editáveis por cotação, e o durável é a régua.
    setPremissasConfirmadas(false);
    // Mudou a premissa, mudou a condição: o pedido de aprovação teria que ser
    // sobre a simulação nova, não sobre a que foi salva antes.
    setCenarioSalvoId("");
  };

  const pedirAprovacao = async () => {
    if (!cenarioSalvoId) return;
    setEnviandoAprovacao(true);
    try {
      const resposta = await fetch("/api/todogreen/deal-desk", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
        body: JSON.stringify({
          cenarioId: cenarioSalvoId,
          cliente: inputs.client || "",
          justificativa: justificativaDeAprovacao,
        }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || "Não foi possível abrir o pedido.");
      setJustificativaDeAprovacao("");
      setToast?.("Pedido enviado para aprovação comercial. A proposta fica bloqueada até a decisão.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setEnviandoAprovacao(false);
    }
  };
  const camposDesenhados = new Set(blueprint.inputGroups.flatMap(([, fields]) => fields));
  const obrigatoriasForaDoFormulario = (product?.requiredFields || []).filter(
    (campo) => !camposDesenhados.has(campo),
  );
  const premissas = premissasDaSimulacao(product, inputs);
  const situacao = situacaoDoResultado(
    premissas,
    premissasConfirmadas,
    (campo) => fieldLabels[campo] || campo,
  );
  const saveScenario = () => {
    // Guarda no código, não só no `disabled` do botão: um atalho de teclado ou
    // uma chamada por fora não podem salvar cenário sem procedência.
    if (!situacao.podeSalvar) {
      setToast?.(situacao.resumo);
      return;
    }
    // A simulação salva nasce com a MESMA régua exibida na tela — snapshot e
    // resultado mostrado nunca podem divergir.
    const snapshot = createPricingScenarioSnapshot(
      productId,
      inputs,
      { userId: db?.user?.id || "local", tenantId: TODO_GREEN_TENANT.id, justification: `Simulação criada pela calculadora To Do Green (régua ${regua?.versao || "padrão"}${houveOverride ? ", com custos ajustados na simulação" : ""}).` },
      // O snapshot leva os MESMOS custos que a tela mostrou — incluindo os
      // ajustes manuais. Salvar a régua pura enquanto a tela usou outro custo
      // faria o histórico divergir do que a pessoa viu.
      { assumptions: assumptionsComOverride, parameterVersion: (regua?.versao || "padrão") + (houveOverride ? " · custo ajustado" : "") },
    );
    // A simulação vai para o banco, não para o JSON do espaço. Era daqui que
    // saía a gravação genérica que sobrescrevia o trabalho de quem estivesse
    // no mesmo espaço — e que o portal do cliente nunca enxergava.
    //
    // Aqui também ficava `tenantAccess.todogreen = { role: role || "admin" }`:
    // salvar simulação concedia acesso a quem salvou.
    setSalvando(true);
    criar("scenarios", {
      id: snapshot.id,
      productId,
      clientId: snapshot.clientId || inputs.clientId || "",
      opportunityId: sourceOpportunity?.id || "",
      ruleVersion: regua?.versao || "padrao",
      inputs,
      result: snapshot.result,
      approvals: snapshot.result?.approval || {},
      premissas: registroDaConfirmacao(situacao, { userId: db?.user?.id || "" }),
    })
      .then(() => {
        setCenarioSalvoId(snapshot.id);
        fetch(`/api/todogreen/audit?owner=${encodeURIComponent(ownerId())}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
          body: JSON.stringify({ action: "pricing_snapshot_created", target: snapshot.id, details: `Simulação ${product?.name || productId} salva.` }),
        }).catch(() => {});
        setToast?.("Simulação To Do Green salva");
      })
      // A falha aparece. Antes a chamada ao servidor era só auditoria e o
      // `.catch(() => {})` engolia qualquer erro — a tela dizia "salvo" mesmo
      // quando nada tinha sido salvo.
      .catch((razao) => setToast?.(razao.message))
      .finally(() => setSalvando(false));
  };
  if (!allowed) return <section className="tdg-panel"><h2>Sem permissão para simular</h2><p>Seu papel pode visualizar dados, mas não alterar premissas comerciais.</p></section>;
  return (
    <section className="tdg-panel tdg-pricing">
      <div className="tdg-section-head"><div><span className="tdg-kicker">CALCULAR PREÇO</span><h2>{blueprint.title}</h2><p>Preencha os dados da operação. O preço e a margem são atualizados automaticamente.</p></div><strong>{friendlyCommercialText(result.recommendation.decision)}</strong></div>
      <p className="tdg-esg-nota">
        {regua && !regua.deFabrica
          ? `Parâmetros ${regua.versao} · margem mínima ${regua.parametros.minimumMarginPercent}% · alvo ${regua.parametros.targetMarginPercent}% · ${regua.aplicados?.length || 1} regra(s) aplicada(s)`
          : "Usando os valores padrão de margem e custos. Um gestor pode definir os seus em Parâmetros do simulador."}
      </p>
      <div className="tdg-product-strip">{LOGISTICS_PRODUCTS.map((item) => <ProductCard product={item} active={item.id === productId} onSelect={selectProduct} key={item.id} />)}</div>
      <div className={`tdg-premissas tdg-premissas-${situacao.nivel}`} role="status">
        <strong>{situacao.rotulo}</strong>
        <p>{situacao.resumo}</p>
        {premissas.podeConfirmar && (
          <label className="tdg-check-field">
            <input
              type="checkbox"
              checked={premissasConfirmadas}
              onChange={(event) => setPremissasConfirmadas(event.target.checked)}
            />
            <span>Confirmo que estas premissas vieram do cliente ou de medição, e não de estimativa.</span>
          </label>
        )}
      </div>
      <div className="tdg-calculator-workspace">
        <form className="tdg-form">
          {/* Campo obrigatório que nenhum grupo do produto desenhou. O
              "middle-mile", por exemplo, exige o cliente e não tinha onde
              informá-lo — a premissa era impossível de completar, e antes
              isso não aparecia porque nada era exigido. */}
          {obrigatoriasForaDoFormulario.length > 0 && (
            <fieldset>
              <legend>Identificação</legend>
              {obrigatoriasForaDoFormulario.map((field) => (
                <FieldInput key={field} name={field} value={inputs[field]} required onChange={changeInput} inputs={inputs} />
              ))}
            </fieldset>
          )}
          {blueprint.inputGroups.map(([group, fields]) => (
            <fieldset key={group}><legend>{group}</legend>{fields.map((field) => <FieldInput key={field} name={field} value={inputs[field]} required={product?.requiredFields?.includes(field)} onChange={changeInput} inputs={inputs} />)}</fieldset>
          ))}
          {/* Custos da operação, editáveis aqui mesmo. Vêm da régua em vigor;
              ajustar sobrescreve só esta simulação. Recolhidos por padrão: a
              maioria das simulações usa a régua e nunca precisa abrir isto —
              deixá-los sempre abertos era metade da poluição da tela. */}
          <details className={`tdg-form-avancado tdg-custos-op${houveOverride ? " tdg-custos-op-ativo" : ""}`}>
            <summary>Custos da operação (motorista, energia, veículo){houveOverride ? " · ajustados" : ""}</summary>
            <div>
              {[
                ["driverDailyCost", "Motorista por dia (R$)"],
                ["energyCostPerKm", "Energia por km (R$)"],
                ["vehicleMonthlyCost", "Veículo por mês (R$)"],
                ["vehicleDailyCost", "Veículo por dia (R$)"],
                ["maintenancePerKm", "Manutenção por km (R$)"],
              ].map(([campo, rotulo]) => (
                <label key={campo}>
                  <span>{rotulo}</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={custosManuais[campo] ?? ""}
                    placeholder={String(custosEfetivos[campo] ?? 0)}
                    onChange={(e) => { setCustosManuais((c) => ({ ...c, [campo]: e.target.value })); setPremissasConfirmadas(false); setCenarioSalvoId(""); }}
                  />
                </label>
              ))}
              <p className="tdg-custos-nota">{houveOverride ? "Usando custos ajustados só nesta simulação — a régua não muda." : "Em branco = usa a régua em vigor (valor cinza é o atual)."}</p>
            </div>
          </details>
          <details className="tdg-form-avancado"><summary>Dados usados no cálculo</summary><div><FieldInput name="dataQuality" value={inputs.dataQuality} onChange={changeInput} /><FieldInput name="occupancyPercent" value={inputs.occupancyPercent} onChange={changeInput} /></div></details>
        </form>
        <div
          className={`tdg-price-summary${situacao.nivel === NIVEIS.confirmada ? "" : " tdg-price-summary-provisorio"}`}
          aria-label={
            situacao.nivel === NIVEIS.confirmada
              ? "Resultado da precificação"
              : "Resultado provisório da precificação — premissas não confirmadas"
          }
        >
          <div><span>Custo mensal</span><strong>{BRL.format(result.loadedCost)}</strong><small>custo estimado da operação</small></div>
          <div><span>Piso</span><strong>{BRL.format(decision.floor)}</strong><small>abaixo disso perde margem ou viola regra</small></div>
          <div className="featured"><span>Preço recomendado</span><strong>{BRL.format(decision.recommended)}</strong><small>preço que devemos defender</small></div>
          <div><span>Preço estratégico</span><strong>{BRL.format(decision.strategic)}</strong><small>limite com justificativa comercial</small></div>
          <div className={result.marginPercent < 18 ? "risk" : "good"}><span>Margem estimada</span><strong>{number.format(result.marginPercent)}%</strong><small>{BRL.format(result.marginValue)} por mês</small></div>
        </div>
      </div>
      <section className="tdg-price-guidance">
        <div>
          <span className="tdg-kicker">RECOMENDAÇÃO: {decision.decision}</span>
          <h3>{BRL.format(decision.recommended)}</h3>
          <p>Defenda o preço recomendado. Abaixo de <strong>{BRL.format(decision.floor)}</strong>, a condição perde sustentação. O preço estratégico de <strong>{BRL.format(decision.strategic)}</strong> exige justificativa comercial.</p>
          {result.recommendation.reasons.length > 0 && <ul>{result.recommendation.reasons.map((reason) => <li key={reason}>{friendlyCommercialText(reason)}</li>)}</ul>}
        </div>
        <div className="tdg-environmental-summary">
          <span>Impacto ambiental estimado</span>
          {hasEnvironmentalInputs ? <><strong>{number.format(result.impact.co2AvoidedKg / 1000)} t de CO₂ evitadas</strong><small>{number.format(result.impact.reductionPercent)}% de redução em relação à referência informada</small></> : <><strong>Aguardando dados da rota</strong><small>Informe a quilometragem e o veículo de referência para calcular a redução de emissões.</small></>}
        </div>
      </section>
      {/* Tudo o que não é a decisão em si — indicadores secundários, saídas por
          produto e documentos — recolhido num lugar só. O preço, o piso, a
          margem e a recomendação ficam à vista; o resto abre quando precisa.
          Era essa pilha de blocos repetindo margem e CO₂ que poluía a tela. */}
      <details className="tdg-price-mais">
        <summary>Todos os indicadores e detalhes do cálculo</summary>
        <div className="tdg-price-details" aria-label="Indicadores da decisão comercial">
          <span><small>Margem</small><strong>{number.format(decision.marginPercent)}%</strong></span>
          <span><small>Payback</small><strong>{decision.paybackMonths ? `${number.format(decision.paybackMonths)} meses` : "Não aplicável"}</strong></span>
          <span><small>Capacidade</small><strong>{decision.capacity}</strong></span>
          <span><small>Risco principal</small><strong>{friendlyCommercialText(decision.risk)}</strong></span>
          <span><small>CO₂</small><strong>{hasEnvironmentalInputs ? `${number.format(decision.co2AvoidedKg / 1000)} t evitadas` : "Aguardando rota"}</strong></span>
          <span><small>Aprovação necessária</small><strong>{friendlyCommercialText(decision.approval)}</strong></span>
        </div>
        <div className="tdg-price-details">
          {Object.entries(outputs)
            .filter(([key]) => !["custoTotal", "precoMinimo", "precoRecomendado", "margem"].includes(key))
            .map(([key, value]) => <span key={key}><small>{outputLabels[key] || key.replace(/[A-Z]/g, " $&").toLowerCase()}</small><strong>{formatOutputValue(key, value)}</strong></span>)}
        </div>
        <div className="tdg-method"><strong>Documentos necessários</strong><p>{blueprint.requiredEvidence.join(" · ")}</p><small>Relatórios: {blueprint.executiveOutputs.join(" · ")}</small></div>
      </details>
      {result.approval.required && (
        // Antes isto era só um aviso: a tela dizia que precisava de aprovação e
        // a simulação era salva do mesmo jeito. Agora o aviso vem com o caminho.
        <div className="tdg-alert" role="status">
          <AlertTriangle size={18} />
          <span>Esta condição precisa de aprovação comercial: {result.approval.triggers.join(", ")}.</span>
        </div>
      )}
      {result.approval.required && (
        <div className="tdg-dd-pedido">
          <label>
            <span>Justificativa comercial para aprovação</span>
            <input
              value={justificativaDeAprovacao}
              onChange={(event) => setJustificativaDeAprovacao(event.target.value)}
              placeholder="Por que vale a pena aceitar esta condição fora da régua"
            />
          </label>
          <button
            type="button"
            className="tdg-action"
            disabled={!cenarioSalvoId || justificativaDeAprovacao.trim().length < 20 || Boolean(enviandoAprovacao)}
            onClick={pedirAprovacao}
          >
            <ShieldCheck size={16} />
            {enviandoAprovacao ? "Enviando..." : "Enviar para aprovação"}
          </button>
          <small>
            {!cenarioSalvoId
              ? "Salve a simulação antes: a aprovação é sobre a condição exata, não sobre o cliente."
              : "A alçada, o prazo e o desvio são calculados a partir desta simulação e da régua vigente."}
          </small>
        </div>
      )}
      <div className="tdg-pricing-actions">
        <button className="tdg-action" type="button" onClick={saveScenario} disabled={!situacao.podeSalvar || salvando}>
          <Plus size={17} />{salvando ? "Salvando..." : "Salvar simulação"}
        </button>
        {!situacao.podeSalvar && <small>{situacao.resumo}</small>}
      </div>
      {/* O comparativo planejado × realizado é acompanhamento, não parte do ato
          de calcular — recolhido para a tela abrir focada no preço. */}
      <details className="tdg-price-mais tdg-price-performance">
        <summary>Comparar planejado × realizado</summary>
        <Suspense fallback={<p>Carregando planejado × realizado...</p>}><PricingPerformancePanel authHeaders={authHeaders} canManage={hasTodoGreenPermission(role, "pricing:manage")} setToast={setToast} /></Suspense>
      </details>
    </section>
  );
}
