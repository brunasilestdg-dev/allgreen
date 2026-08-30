import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Leaf,
  LockKeyhole,
  Plus,
  Save,
  Search,
  Target,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import TopScrollRow from "./TopScrollRow.jsx";
import {
  ESTAGIOS_OPORTUNIDADE,
  analisarOportunidade,
  normalizarOportunidade,
  resumirPipeline,
} from "../opportunityIntelligenceDomain.js";
import { montarForecast, pendenciasDoForecast } from "../forecastDomain.js";
import {
  OBJETIVOS_ELETRIFICACAO,
  avaliarJornadaEletrificacao,
} from "../electrificationJourneyDomain.js";
import "./TodoGreenPages.css";

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// Os campos que o motor precisa para responder alguma coisa. Ficam agrupados
// por pergunta de negócio, não por tipo de dado — quem preenche é vendedor
// saindo de reunião, não analista.
const CAMPOS_OPERACAO = [
  { key: "distanciaKm", label: "Distância por viagem (km)", type: "number" },
  { key: "viagensMes", label: "Viagens por mês", type: "number" },
  { key: "ocupacaoPrevistaPercent", label: "Ocupação prevista (%)", type: "number" },
  { key: "frotaLimpaPercent", label: "Frota de baixa emissão (%)", type: "number" },
  { key: "veiculosDisponiveis", label: "Veículos alocados hoje", type: "number" },
];

const CAMPOS_CONTRATO = [
  { key: "valorMensal", label: "Valor mensal (R$)", type: "number" },
  { key: "mesesContrato", label: "Duração (meses)", type: "number" },
  { key: "probabilidade", label: "Probabilidade (%)", type: "number" },
];

const FORM_VAZIO = {
  clientId: "",
  cliente: "",
  productId: "middle-mile",
  estagio: "Diagnóstico",
  tipoVeiculo: "elétrico",
  distanciaKm: "",
  viagensMes: "",
  ocupacaoPrevistaPercent: "",
  frotaLimpaPercent: "",
  veiculosDisponiveis: "",
  valorMensal: "",
  mesesContrato: "12",
  probabilidade: "",
  nextStep: "",
  expectedCloseAt: "",
  source: "",
  priority: "media",
};

const gravidadeRotulo = { alta: "Crítico", media: "Atenção", baixa: "Observação" };

const CAMPOS_ESTUDO = [
  "origin",
  "destination",
  "distanciaKm",
  "viagensMes",
  "deliveryWindows",
  "operationalRestrictions",
  "weightKg",
  "volumeM3",
  "pallets",
  "packages",
  "loadDescription",
  "seasonality",
  "sla",
  "criticalRequirements",
  "trackingSystem",
  "integrationNeeds",
  "primaryObjective",
  "electrificationTarget",
  "pilotStart",
  "pilotEnd",
  "pilotScope",
  "pilotSuccessCriteria",
  "pilotStatus",
  "reportStatus",
  "reportUrl",
  "expansionStatus",
  "expansionPlan",
];

const NUMERICOS_ESTUDO = new Set([
  "distanciaKm",
  "viagensMes",
  "weightKg",
  "volumeM3",
  "pallets",
  "packages",
]);

function CampoEstudo({ form, campo, rotulo, tipo = "text", onChange, opcoes }) {
  return (
    <label>
      <span>{rotulo}</span>
      {opcoes ? (
        <select value={form[campo] || ""} onChange={onChange(campo)}>
          {opcoes.map((opcao) => (
            <option value={opcao.id} key={opcao.id}>
              {opcao.label}
            </option>
          ))}
        </select>
      ) : (
        <input type={tipo} value={form[campo] || ""} onChange={onChange(campo)} />
      )}
    </label>
  );
}

function EstudoEletrificacaoModal({ registro, onClose, onSave, setToast }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(CAMPOS_ESTUDO.map((campo) => [campo, registro[campo] ?? ""])),
  );
  const [salvando, setSalvando] = useState(false);
  const mudar = (campo) => (event) =>
    setForm((atual) => ({ ...atual, [campo]: event.target.value }));
  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    try {
      await onSave({
        ...form,
        ...Object.fromEntries(
          [...NUMERICOS_ESTUDO].map((campo) => [campo, Number(form[campo] || 0)]),
        ),
        revision: registro.revision,
        lastInteractionAt: new Date().toISOString(),
      });
      setToast?.("Estudo de eletrificação atualizado.");
      onClose();
    } catch (erro) {
      setToast?.(erro?.message || "Não foi possível atualizar o estudo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal title={`Estudo de eletrificação · ${registro.cliente}`} onClose={onClose} wide>
      <form className="tdg-estudo-form" onSubmit={salvar}>
        <p className="tdg-estudo-intro">
          O diagnóstico alimenta a precificação, o plano do piloto e o relatório. Campos sem
          informação permanecem pendentes e não recebem estimativas automáticas.
        </p>

        <fieldset>
          <legend>1. Rota e demanda</legend>
          <div className="tdg-estudo-grid">
            <CampoEstudo form={form} campo="origin" rotulo="Origem" onChange={mudar} />
            <CampoEstudo form={form} campo="destination" rotulo="Destino" onChange={mudar} />
            <CampoEstudo form={form} campo="distanciaKm" rotulo="Distância por viagem (km)" tipo="number" onChange={mudar} />
            <CampoEstudo form={form} campo="viagensMes" rotulo="Viagens por mês" tipo="number" onChange={mudar} />
            <CampoEstudo form={form} campo="weightKg" rotulo="Peso médio (kg)" tipo="number" onChange={mudar} />
            <CampoEstudo form={form} campo="volumeM3" rotulo="Cubagem média (m³)" tipo="number" onChange={mudar} />
            <CampoEstudo form={form} campo="pallets" rotulo="Pallets por viagem" tipo="number" onChange={mudar} />
            <CampoEstudo form={form} campo="packages" rotulo="Pacotes por viagem" tipo="number" onChange={mudar} />
          </div>
          <label>
            <span>Descrição da carga</span>
            <textarea value={form.loadDescription || ""} onChange={mudar("loadDescription")} />
          </label>
          <label>
            <span>Sazonalidade e picos</span>
            <textarea value={form.seasonality || ""} onChange={mudar("seasonality")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>2. Serviço, restrições e sistemas</legend>
          <div className="tdg-estudo-grid">
            <CampoEstudo form={form} campo="deliveryWindows" rotulo="Janelas de coleta e entrega" onChange={mudar} />
            <CampoEstudo form={form} campo="sla" rotulo="SLA exigido" onChange={mudar} />
            <CampoEstudo form={form} campo="trackingSystem" rotulo="TMS ou rastreador atual" onChange={mudar} />
            <CampoEstudo form={form} campo="integrationNeeds" rotulo="Integração necessária" onChange={mudar} />
          </div>
          <label>
            <span>Restrições operacionais</span>
            <textarea value={form.operationalRestrictions || ""} onChange={mudar("operationalRestrictions")} />
          </label>
          <label>
            <span>Requisitos críticos</span>
            <textarea value={form.criticalRequirements || ""} onChange={mudar("criticalRequirements")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>3. Objetivo e piloto</legend>
          <div className="tdg-estudo-grid">
            <CampoEstudo
              form={form}
              campo="primaryObjective"
              rotulo="Objetivo principal"
              onChange={mudar}
              opcoes={[{ id: "", label: "Selecione" }, ...OBJETIVOS_ELETRIFICACAO]}
            />
            <CampoEstudo form={form} campo="electrificationTarget" rotulo="Meta de eletrificação" onChange={mudar} />
            <CampoEstudo form={form} campo="pilotStart" rotulo="Início previsto" tipo="date" onChange={mudar} />
            <CampoEstudo form={form} campo="pilotEnd" rotulo="Fim previsto" tipo="date" onChange={mudar} />
            <CampoEstudo
              form={form}
              campo="pilotStatus"
              rotulo="Situação do piloto"
              onChange={mudar}
              opcoes={[
                { id: "", label: "Ainda não planejado" },
                { id: "planejado", label: "Planejado" },
                { id: "em_andamento", label: "Em andamento" },
                { id: "concluido", label: "Concluído" },
                { id: "cancelado", label: "Cancelado" },
              ]}
            />
          </div>
          <label>
            <span>Escopo do piloto</span>
            <textarea value={form.pilotScope || ""} onChange={mudar("pilotScope")} />
          </label>
          <label>
            <span>Critérios de sucesso e decisão Go/No-Go</span>
            <textarea value={form.pilotSuccessCriteria || ""} onChange={mudar("pilotSuccessCriteria")} />
          </label>
        </fieldset>

        <fieldset>
          <legend>4. Relatório e escala</legend>
          <div className="tdg-estudo-grid">
            <CampoEstudo
              form={form}
              campo="reportStatus"
              rotulo="Relatório do piloto"
              onChange={mudar}
              opcoes={[
                { id: "", label: "Não iniciado" },
                { id: "em_preparacao", label: "Em preparação" },
                { id: "publicado", label: "Publicado" },
              ]}
            />
            <CampoEstudo form={form} campo="reportUrl" rotulo="Link do relatório ou evidência" tipo="url" onChange={mudar} />
            <CampoEstudo
              form={form}
              campo="expansionStatus"
              rotulo="Decisão de expansão"
              onChange={mudar}
              opcoes={[
                { id: "", label: "Ainda não avaliada" },
                { id: "em_analise", label: "Em análise" },
                { id: "aprovada", label: "Aprovada" },
                { id: "implantada", label: "Implantada" },
                { id: "nao_aprovada", label: "Não aprovada" },
              ]}
            />
          </div>
          <label>
            <span>Plano de escala</span>
            <textarea value={form.expansionPlan || ""} onChange={mudar("expansionPlan")} />
          </label>
        </fieldset>

        <footer className="tdg-estudo-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button className="tdg-action" type="submit" disabled={salvando}>
            <Save size={16} />
            {salvando ? "Salvando..." : "Salvar estudo"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function JornadaEletrificacao({ jornada, onEdit, onSimulate }) {
  return (
    <section className="tdg-jornada" aria-label="Jornada de eletrificação">
      <header>
        <div>
          <strong>Mapear → Simular → Rodar → Reportar → Escalar</strong>
          <small>
            {jornada.concluida
              ? "Jornada concluída e pronta para acompanhamento da expansão."
              : `Etapa atual: ${jornada.etapaAtual?.label || "—"} · ${jornada.percentual}% concluído`}
          </small>
        </div>
        <div className="tdg-jornada-acoes">
          <button type="button" onClick={onEdit}>Atualizar estudo</button>
          {jornada.etapaAtual?.id === "simular" && (
            <button type="button" className="tdg-action" onClick={onSimulate}>
              <Calculator size={15} /> Simular agora
            </button>
          )}
        </div>
      </header>
      <div className="tdg-jornada-etapas">
        {jornada.etapas.map((etapa) => (
          <article className={`e-${etapa.estado}`} key={etapa.id}>
            {etapa.estado === "concluida" ? (
              <CheckCircle2 size={17} />
            ) : etapa.estado === "bloqueada" ? (
              <LockKeyhole size={15} />
            ) : (
              <CircleDashed size={17} />
            )}
            <span>
              <strong>{etapa.label}</strong>
              <small>{etapa.descricao}</small>
            </span>
          </article>
        ))}
      </div>
      {!jornada.mapeamento.completo && (
        <p>
          Para concluir o mapeamento: {jornada.mapeamento.faltando.join(" · ")}.
        </p>
      )}
    </section>
  );
}

function BlocoAmbiental({ ambiental }) {
  if (!ambiental.disponivel)
    return (
      <div className="tdg-opp-pendente">
        <AlertTriangle size={16} />
        <span>{ambiental.motivo}</span>
      </div>
    );
  return (
    <div className="tdg-opp-bloco">
      <h4>
        <Leaf size={15} />
        Potencial ambiental
      </h4>
      <div className="tdg-opp-numeros">
        <article>
          <small>CO2 evitado no contrato</small>
          <strong>{NUM.format(ambiental.co2ContratoToneladas)} t</strong>
          <span>{NUM.format(ambiental.co2MensalKg)} kg por mês</span>
        </article>
        <article>
          <small>Redução sobre o cenário diesel</small>
          <strong>{NUM.format(ambiental.reducaoPercent)}%</strong>
          <span>{NUM.format(ambiental.dieselEvitadoLitrosMes)} L de diesel por mês</span>
        </article>
        <article>
          <small>Qualidade do dado</small>
          <strong>{ambiental.qualidadeDados}%</strong>
          <span>Fatores {ambiental.versaoFatores}</span>
        </article>
      </div>
      <p className="tdg-opp-ressalva">{ambiental.usoPermitido}</p>
      {ambiental.tipoVeiculoPresumido && (
        <p className="tdg-opp-ressalva">
          Tipo de veículo não informado: o cálculo assumiu frota de baixa emissão. Confirme
          antes de levar o número ao cliente.
        </p>
      )}
      <details className="tdg-opp-memoria">
        <summary>Ver memória de cálculo</summary>
        <ol>
          {ambiental.memoria.passos.map((passo) => (
            <li key={passo.ordem}>
              {passo.descricao} — <em>{passo.formula}</em> ={" "}
              {NUM.format(passo.resultado)} {passo.unidade}
            </li>
          ))}
        </ol>
        <ul>
          {ambiental.memoria.fatoresUsados.map((fator) => (
            <li key={fator.chave}>
              {fator.valor} {fator.unidade} — {fator.fonte} (versão {fator.versao})
            </li>
          ))}
        </ul>
        <p>{ambiental.memoria.ressalva}</p>
      </details>
    </div>
  );
}

function CartaoOportunidade({ registro, analise, jornada, aberta, alternar, onEdit, onSimulate, onAvancarEtapa }) {
  const { ambiental, greenScore, financeiro, operacional, expansao, riscos } = analise;
  const criticos = riscos.filter((risco) => risco.gravidade === "alta").length;
  return (
    <article className={`tdg-opp-card${aberta ? " aberta" : ""}`}>
      <button type="button" className="tdg-opp-head" onClick={alternar} aria-expanded={aberta}>
        {aberta ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        <span className="tdg-opp-head-nome">
          <strong>{registro.cliente || "Oportunidade sem cliente"}</strong>
          <small>
            {analise.estagio} · {financeiro.probabilidade}% de probabilidade
          </small>
        </span>
        <span className="tdg-opp-head-valor">
          <strong>{BRL.format(financeiro.valorContrato)}</strong>
          <small>{BRL.format(financeiro.valorPonderado)} ponderado</small>
        </span>
        <span className="tdg-opp-head-esg">
          {ambiental.disponivel ? (
            <>
              <strong>{NUM.format(ambiental.co2ContratoToneladas)} t</strong>
              <small>CO2 evitado</small>
            </>
          ) : (
            <>
              <strong>—</strong>
              <small>sem dado operacional</small>
            </>
          )}
        </span>
        {criticos > 0 && (
          <span className="tdg-opp-alerta">
            <AlertTriangle size={14} />
            {criticos}
          </span>
        )}
      </button>

      {aberta && (
        <div className="tdg-opp-corpo">
          <div className="tdg-opp-acao">
            <Target size={16} />
            <div>
              <strong>{analise.proximaAcao.acao}</strong>
              <p>{analise.proximaAcao.porque}</p>
            </div>
            <span className={`tdg-opp-urgencia u-${analise.proximaAcao.urgencia}`}>
              {gravidadeRotulo[analise.proximaAcao.urgencia]}
            </span>
          </div>

          <label className="tdg-opp-etapa">
            <span>Etapa do negócio</span>
            <select value={analise.estagio} onChange={(event) => onAvancarEtapa?.(event.target.value)}>
              {ESTAGIOS_OPORTUNIDADE.map((estagio) => (
                <option key={estagio} value={estagio}>{estagio}</option>
              ))}
            </select>
            <small>Ao marcar &quot;Fechada ganha&quot;, a implantação da operação é aberta automaticamente.</small>
          </label>

          <JornadaEletrificacao jornada={jornada} onEdit={onEdit} onSimulate={onSimulate} />

          <BlocoAmbiental ambiental={ambiental} />

          {greenScore.disponivel && (
            <div className="tdg-opp-bloco">
              <h4>Green Score projetado: {NUM.format(greenScore.valor)}</h4>
              <div className="tdg-opp-componentes">
                {Object.entries(greenScore.componentes).map(([chave, componente]) => (
                  <div key={chave}>
                    <span>{componente.rotulo}</span>
                    <div className="tdg-opp-barra">
                      <i style={{ width: `${(componente.contribuicao / componente.maximo) * 100}%` }} />
                    </div>
                    <small>
                      {NUM.format(componente.contribuicao)} de {componente.maximo}
                    </small>
                  </div>
                ))}
              </div>
              <p className="tdg-opp-ressalva">
                {greenScore.ressalva} Pesos {greenScore.versaoPesos}.
              </p>
            </div>
          )}

          <div className="tdg-opp-bloco">
            <h4>Impacto financeiro e operacional</h4>
            <div className="tdg-opp-numeros">
              <article>
                <small>Valor mensal</small>
                <strong>{BRL.format(financeiro.valorMensal)}</strong>
                <span>
                  {financeiro.baseDoValor === "contrato"
                    ? "derivado do valor total informado"
                    : financeiro.baseDoValor === "ausente"
                      ? "valor não informado"
                      : `${financeiro.mesesContrato} meses de contrato`}
                </span>
              </article>
              <article>
                <small>Receita no ano corrente</small>
                <strong>{BRL.format(financeiro.valorNoAnoCorrente)}</strong>
                <span>se fechar agora</span>
              </article>
              <article>
                <small>Frota necessária</small>
                <strong>{operacional.veiculosNecessarios}</strong>
                <span>
                  {NUM.format(operacional.kmMes)} km por mês · {operacional.motoristasNecessarios}{" "}
                  motorista(s)
                </span>
              </article>
            </div>
          </div>

          <div className="tdg-opp-duas">
            <div className="tdg-opp-bloco">
              <h4>Riscos</h4>
              {riscos.length === 0 && <p className="tdg-opp-ressalva">Nenhum risco identificado com os dados atuais.</p>}
              <ul className="tdg-opp-riscos">
                {riscos.map((risco) => (
                  <li key={risco.tipo} className={`g-${risco.gravidade}`}>
                    <span>{gravidadeRotulo[risco.gravidade]}</span>
                    {risco.texto}
                  </li>
                ))}
              </ul>
            </div>
            <div className="tdg-opp-bloco">
              <h4>Potencial de expansão</h4>
              {expansao.caminhos.length === 0 && <p className="tdg-opp-ressalva">{expansao.resumo}</p>}
              <ul className="tdg-opp-expansao">
                {expansao.caminhos.map((caminho) => (
                  <li key={caminho.tipo}>
                    <strong>{caminho.titulo}</strong>
                    <small>{caminho.base}</small>
                    <small>{caminho.ganhoEstimado}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export default function OpportunitiesPage({
  clients = [],
  opportunities = [],
  scenarios = [],
  onCreate,
  onUpdate,
  onNavigate,
  setToast,
}) {
  const [form, setForm] = useState(FORM_VAZIO);
  const [abertaId, setAbertaId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [filtroEstagio, setFiltroEstagio] = useState("todas");
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState(() => {
    // O kanban simplificado é a visão pedida pela titular como padrão do
    // pipeline; a lista continua a um clique e a escolha fica gravada.
    try { return localStorage.getItem("todogreen-opp-view") || "kanban"; } catch { return "kanban"; }
  });
  const trocarVisao = (v) => { setVisao(v); try { localStorage.setItem("todogreen-opp-view", v); } catch { /* ok */ } };

  useEffect(() => {
    const clientId = new URLSearchParams(window.location.search).get("client") || "";
    const client = clients.find((item) => item.id === clientId);
    if (client)
      setForm((current) => ({ ...current, clientId: client.id, cliente: client.name }));
  }, [clients]);

  const registros = useMemo(
    () => opportunities.map((item) => normalizarOportunidade(item)),
    [opportunities],
  );
  const resumo = useMemo(() => resumirPipeline(registros), [registros]);
  const forecast = useMemo(() => {
    const agora = new Date();
    const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
    const meses = Array.from({ length: 6 }, (_, index) => {
      const data = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + index, 1));
      const mes = data.toISOString().slice(0, 7);
      return { mes, ...montarForecast({ oportunidades: registros, periodo: mes }) };
    });
    return { meses, pendencias: pendenciasDoForecast({ oportunidades: registros }) };
  }, [registros]);
  const analises = useMemo(
    () => new Map(registros.map((registro) => [registro.id, analisarOportunidade(registro)])),
    [registros],
  );
  const jornadas = useMemo(
    () =>
      new Map(
        registros.map((registro) => [
          registro.id,
          avaliarJornadaEletrificacao(registro, scenarios),
        ]),
      ),
    [registros, scenarios],
  );
  const editando = registros.find((registro) => registro.id === editandoId) || null;
  const etapas = useMemo(() => ESTAGIOS_OPORTUNIDADE.map((estagio) => {
    const itens = registros.filter((registro) => registro.estagio === estagio);
    return {
      estagio,
      quantidade: itens.length,
      valor: itens.reduce((sum, item) => sum + analisarOportunidade(item).financeiro.valorContrato, 0),
    };
  }), [registros]);
  const visiveis = useMemo(() => registros.filter((registro) => {
    const stageMatches = filtroEstagio === "todas" || registro.estagio === filtroEstagio;
    const queryMatches = `${registro.cliente} ${registro.nextStep || ""} ${registro.source || ""}`.toLowerCase().includes(busca.toLowerCase());
    return stageMatches && queryMatches;
  }), [busca, filtroEstagio, registros]);

  const campo = (key) => (event) =>
    setForm((atual) => ({ ...atual, [key]: event.target.value }));

  const salvar = async (event) => {
    event.preventDefault();
    setSalvando(true);
    try {
      await onCreate?.({
        id: `opp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        lastInteractionAt: new Date().toISOString(),
        ...form,
        // Números saem do formulário como texto; guardar assim faria o motor
        // somar strings e produzir um pipeline errado sem erro nenhum.
        ...Object.fromEntries(
          [...CAMPOS_OPERACAO, ...CAMPOS_CONTRATO].map(({ key }) => [key, Number(form[key] || 0)]),
        ),
      });
      setForm(FORM_VAZIO);
      setToast?.("Oportunidade registrada com potencial ESG calculado.");
    } catch (erro) {
      setToast?.(erro?.message || "Não foi possível registrar a oportunidade.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="tdg-panel tdg-page tdg-opp-page">
      <header className="tdg-page-title">
        <div>
          <span>PIPELINE COMERCIAL</span>
          <h2>Oportunidades</h2>
          <p>
            Cada oportunidade mostra o CO2 que a operação proposta evita, o Green Score que o
            cliente passaria a ter, o que isso vale em dinheiro e em frota, e o que está
            travando o negócio. Os números vêm dos mesmos motores que apuram a operação
            executada — o que é prometido aqui é o que será medido depois.
          </p>
        </div>
      </header>

      <div className="tdg-opp-resumo">
        <article>
          <small>Oportunidades abertas</small>
          <strong>{resumo.total}</strong>
        </article>
        <article>
          <small>Valor em contrato</small>
          <strong>{BRL.format(resumo.valorTotal)}</strong>
        </article>
        <article>
          <small>Ponderado pela probabilidade</small>
          <strong>{BRL.format(resumo.valorPonderado)}</strong>
          <span>é este que vai para o forecast</span>
        </article>
        <article>
          <small>CO2 potencial na carteira</small>
          <strong>{NUM.format(resumo.co2PotencialToneladas)} t</strong>
          {resumo.semDadoAmbiental > 0 && (
            <span>{resumo.semDadoAmbiental} sem dado operacional</span>
          )}
        </article>
      </div>

      <section className="tdg-pipeline-strip" aria-label="Forecast comercial mensal">
        {forecast.meses.map((item) => <article key={item.mes}><strong>{new Date(`${item.mes}-01T00:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })}</strong><span>{item.quantidade} negócio(s)</span><small>{BRL.format(item.commit)} commit · {BRL.format(item.ponderado)} ponderado · {BRL.format(item.bestCase)} best case</small></article>)}
        {forecast.pendencias.find((item) => item.id === "sem-data") && <article className="attention"><strong>Sem previsão</strong><span>{forecast.pendencias.find((item) => item.id === "sem-data").quantidade} negócio(s)</span><small>Fora do calendário até informar a data de fechamento</small></article>}
      </section>

      <form className="tdg-client-admin-form" onSubmit={salvar}>
        <strong>Nova oportunidade</strong>
        <div className="tdg-form-row">
          <label>
            <span>Cliente</span>
            {clients.length ? <select required value={form.clientId} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, clientId: event.target.value, cliente: client?.name || "" })); }}><option value="">Selecione a conta</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select> : <input required value={form.cliente} onChange={campo("cliente")} />}
          </label>
          <label>
            <span>Estágio</span>
            <select value={form.estagio} onChange={campo("estagio")}>
              {ESTAGIOS_OPORTUNIDADE.map((estagio) => (
                <option key={estagio} value={estagio}>
                  {estagio}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tipo de veículo</span>
            <select value={form.tipoVeiculo} onChange={campo("tipoVeiculo")}>
              <option value="elétrico">Elétrico</option>
              <option value="diesel">Diesel</option>
            </select>
          </label>
        </div>
        <div className="tdg-form-row tdg-opp-form-larga">
          {CAMPOS_CONTRATO.map(({ key, label, type }) => (
            <label key={key}>
              <span>{label}</span>
              <input type={type} value={form[key]} onChange={campo(key)} />
            </label>
          ))}
        </div>
        <div className="tdg-form-row tdg-opp-form-larga">
          <label><span>Próximo passo</span><input value={form.nextStep} onChange={campo("nextStep")} placeholder="Ação concreta acordada" /></label>
          <label><span>Previsão de fechamento</span><input type="date" value={form.expectedCloseAt} onChange={campo("expectedCloseAt")} /></label>
          <label><span>Origem</span><input value={form.source} onChange={campo("source")} placeholder="Indicação, prospecção, evento..." /></label>
          <label><span>Prioridade</span><select value={form.priority} onChange={campo("priority")}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label>
        </div>
        <div className="tdg-form-row tdg-opp-form-larga">
          {CAMPOS_OPERACAO.map(({ key, label, type }) => (
            <label key={key}>
              <span>{label}</span>
              <input type={type} value={form[key]} onChange={campo(key)} />
            </label>
          ))}
        </div>
        <p className="tdg-opp-ressalva">
          Distância e viagens por mês são o que destrava o cálculo ambiental. Sem elas a
          oportunidade entra no pipeline, mas sem potencial ESG.
        </p>
        <button className="tdg-action" type="submit" disabled={salvando}>
          <Plus size={16} />
          {salvando ? "Registrando..." : "Registrar oportunidade"}
        </button>
      </form>

      <section className="tdg-pipeline-strip" aria-label="Etapas do pipeline">
        <button type="button" className={filtroEstagio === "todas" ? "active" : ""} onClick={() => setFiltroEstagio("todas")}><strong>Pipeline completo</strong><span>{registros.length} negócio(s)</span><small>{BRL.format(resumo.valorTotal)}</small></button>
        {etapas.map((item) => <button type="button" className={filtroEstagio === item.estagio ? "active" : ""} onClick={() => setFiltroEstagio(item.estagio)} key={item.estagio}><strong>{item.estagio}</strong><span>{item.quantidade} negócio(s)</span><small>{BRL.format(item.valor)}</small></button>)}
      </section>
      <div className="tdg-opp-toolbar"><Search size={17} /><input aria-label="Buscar oportunidades" placeholder="Buscar por conta, próximo passo ou origem" value={busca} onChange={(event) => setBusca(event.target.value)} />{filtroEstagio !== "todas" && <button type="button" onClick={() => setFiltroEstagio("todas")}>Limpar etapa</button>}
        <div className="tdg-view-switch" role="tablist" aria-label="Visão das oportunidades">
          <button type="button" role="tab" aria-selected={visao === "lista"} className={visao === "lista" ? "active" : ""} onClick={() => trocarVisao("lista")}>Lista</button>
          <button type="button" role="tab" aria-selected={visao === "kanban"} className={visao === "kanban" ? "active" : ""} onClick={() => trocarVisao("kanban")}>Kanban</button>
        </div>
      </div>

      {registros.length === 0 && (
        <p className="tdg-opp-vazio">
          Nenhuma oportunidade registrada ainda. A primeira que você cadastrar já sai com
          potencial ambiental, Green Score projetado e próxima ação.
        </p>
      )}

      {visao === "kanban" && registros.length > 0 && (
        <>
          <p className="tdg-opp-kb-resumo">{visiveis.length} oportunidade(s), cada uma na etapa em que está hoje. Clique no cartão para abrir.</p>
          <TopScrollRow className="tdg-opp-kanban-wrap" ariaLabel="Kanban de oportunidades por etapa">
            <div className="tdg-opp-kanban">
              {etapas.map((coluna, indice) => {
                const itens = visiveis.filter((registro) => registro.estagio === coluna.estagio);
                const perdida = coluna.estagio === "Fechada perdida";
                return (
                  <section
                    className={`tdg-opp-kb-col${perdida ? " perdida" : ""}`}
                    style={{ "--kb-tom": Math.min(indice, 5) }}
                    key={coluna.estagio}
                  >
                    <header>
                      <strong>{coluna.estagio} · {coluna.quantidade}</strong>
                      <span>{BRL.format(coluna.valor)}</span>
                    </header>
                    <div className="tdg-opp-kb-body">
                      {itens.map((registro) => (
                        <button type="button" className="tdg-opp-kb-card" key={registro.id} onClick={() => setEditandoId(registro.id)} title={registro.cliente}>
                          <span>{registro.cliente || "Sem conta"}</span>
                          <b>{BRL.format(analisarOportunidade(registro).financeiro.valorContrato)}</b>
                        </button>
                      ))}
                      {!itens.length && <p className="tdg-opp-kb-vazio">—</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </TopScrollRow>
        </>
      )}

      <div className="tdg-opp-lista" hidden={visao === "kanban"}>
        {visiveis.map((registro) => (
          <CartaoOportunidade
            key={registro.id}
            registro={registro}
            analise={analises.get(registro.id)}
            jornada={jornadas.get(registro.id)}
            aberta={abertaId === registro.id}
            alternar={() => setAbertaId((atual) => (atual === registro.id ? null : registro.id))}
            onEdit={() => setEditandoId(registro.id)}
            onSimulate={() => onNavigate?.(`/todogreen/precificacao?opportunity=${encodeURIComponent(registro.id)}`)}
            onAvancarEtapa={(estagio) => { if (estagio !== registro.estagio) onUpdate?.(registro.id, { estagio, revision: registro.revision }); }}
          />
        ))}
      </div>
      {editando && (
        <EstudoEletrificacaoModal
          registro={editando}
          onClose={() => setEditandoId(null)}
          onSave={(alteracoes) => onUpdate?.(editando.id, alteracoes)}
          setToast={setToast}
        />
      )}
    </section>
  );
}
