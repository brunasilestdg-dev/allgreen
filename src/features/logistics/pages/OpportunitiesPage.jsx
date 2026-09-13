import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Leaf,
  LockKeyhole,
  Mail,
  Plus,
  Save,
  Search,
  Trash2,
  Target,
  Upload,
} from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import ComentariosPanel from "./ComentariosPanel.jsx";
import InteracoesPanel from "./InteracoesPanel.jsx";
import ImportarPipelineModal from "./ImportarPipelineModal.jsx";
import EnviarApresentacao from "../EnviarApresentacao.jsx";
import { interacoesVisiveis } from "../interacoesDomain.js";
import TopScrollRow from "./TopScrollRow.jsx";
import {
  ESTAGIOS_FUNIL,
  ESTAGIOS_OPORTUNIDADE,
  analisarOportunidade,
  normalizarOportunidade,
  resumirPipeline,
  subtituloDaOportunidade,
  tituloDaOportunidade,
} from "../opportunityIntelligenceDomain.js";
import { forecastPor, montarForecast, pendenciasDoForecast, riscoDeConcentracao } from "../forecastDomain.js";
import {
  OBJETIVOS_ELETRIFICACAO,
  avaliarJornadaEletrificacao,
} from "../electrificationJourneyDomain.js";
import OpportunityViabilityPanel from "./OpportunityViabilityPanel.jsx";
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
  titulo: "",
  clientId: "",
  cliente: "",
  productId: "middle-mile",
  tabelaPrecoId: "",
  // Começa na primeira etapa do funil. "Diagnóstico" era estágio de CONTA, não
  // de oportunidade — não existia no seletor e o servidor o rebaixava para
  // "Prospecção" na surdina, gravando um valor diferente do que a tela mostrava.
  estagio: "Prospecção",
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
  // O nome do negócio entra aqui porque este é o único lugar onde uma
  // oportunidade JÁ criada pode ser editada — sem ele, os 67 projetos que
  // vieram do quadro ficariam presos ao nome que a importação deu.
  "titulo",
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

function EstudoEletrificacaoModal({ registro, conta, onClose, onSave, onDelete, setToast, comments = [], onComment, interactions = [], onInteraction, pessoas = [], onCreateTask, currentUserId }) {
  const [enviarApresentacao, setEnviarApresentacao] = useState(false);
  // Regra da titular (30/08): comentário feito AQUI fica só nesta
  // oportunidade; comentário feito na conta aparece em todas as
  // oportunidades dela — por isso a lista junta os dois, rotulando a origem.
  const comentariosVisiveis = comments.filter((item) =>
    item.opportunityId === registro.id
    || (!item.opportunityId && registro.clientId && item.clientId === registro.clientId));
  const [form, setForm] = useState(() =>
    Object.fromEntries(CAMPOS_ESTUDO.map((campo) => [campo, registro[campo] ?? ""])),
  );
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const excluir = async () => {
    const titulo = tituloDaOportunidade(registro);
    if (!window.confirm(`Excluir a oportunidade "${titulo}"? Ela sairá do pipeline e esta ação não pode ser desfeita pela tela.`)) return;
    setExcluindo(true);
    try {
      await onDelete?.(registro.id);
      setToast?.(`Oportunidade "${titulo}" excluída.`);
      onClose();
    } catch (erro) {
      setToast?.(erro?.message || "Não foi possível excluir a oportunidade.");
    } finally {
      setExcluindo(false);
    }
  };
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
    <Modal title={`Estudo de eletrificação · ${tituloDaOportunidade(registro)}`} onClose={onClose} wide>
      <form className="tdg-estudo-form" onSubmit={salvar}>
        <p className="tdg-estudo-intro">
          O diagnóstico alimenta a precificação, o plano do piloto e o relatório. Campos sem
          informação permanecem pendentes e não recebem estimativas automáticas.
        </p>

        <fieldset>
          <legend>1. Rota e demanda</legend>
          <div className="tdg-estudo-grid">
            <CampoEstudo form={form} campo="titulo" rotulo="Nome do negócio" onChange={mudar} />
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
          {onDelete && <button className="tdg-danger-action" type="button" onClick={excluir} disabled={salvando || excluindo}><Trash2 size={16} />{excluindo ? "Excluindo..." : "Excluir oportunidade"}</button>}
          <button type="button" onClick={() => setEnviarApresentacao(true)} disabled={salvando || excluindo}>
            <Mail size={16} /> Enviar apresentação
          </button>
          <button type="button" onClick={onClose} disabled={excluindo}>Cancelar</button>
          <button className="tdg-action" type="submit" disabled={salvando}>
            <Save size={16} />
            {salvando ? "Salvando..." : "Salvar estudo"}
          </button>
        </footer>
      </form>
      {onInteraction && (
        <InteracoesPanel
          interacoes={interacoesVisiveis({ interacoes: interactions, clientId: registro.clientId || "", opportunityId: registro.id })}
          escopo="oportunidade"
          pessoas={pessoas}
          onCriarTarefa={onCreateTask ? async (passo) => onCreateTask({
            id: crypto.randomUUID(), title: passo.title, due: passo.due || "",
            description: `Follow-up da oportunidade: ${tituloDaOportunidade(registro)}`,
            priority: "Alta", status: "A fazer", area: "Comercial",
            assigneeType: "real", assignee: passo.assignee, assigneeId: passo.assigneeId,
            project: "", isMission: false, distribution: "atribuida", visibility: "privado",
            recurrence: { frequency: "none" }, ownerId: currentUserId || null,
            clientId: registro.clientId || "", clientName: registro.cliente || registro.client || "",
            opportunityId: registro.id, source: "todogreen-crm-followup", businessId: "todogreen",
            createdAt: new Date().toISOString(),
          }) : undefined}
          aviso="Reunião, ligação, visita e tentativa de contato desta negociação. O que for da conta inteira, registre na conta — aparece aqui marcado como interação da conta."
          onRegistrar={async (interacao) => {
            await onInteraction({ ...interacao, clientId: registro.clientId || "", opportunityId: registro.id });
            setToast?.("Interação registrada nesta oportunidade.");
          }}
          setToast={setToast}
        />
      )}
      {onComment && (
        <ComentariosPanel
          comentarios={comentariosVisiveis}
          aviso="O que você escrever aqui fica só nesta oportunidade. Comentário feito na conta aparece em todas as oportunidades dela."
          placeholder="Escreva um comentário desta oportunidade"
          onEnviar={async (comentario) => {
            await onComment({ clientId: registro.clientId || "", opportunityId: registro.id, comentario });
            setToast?.("Comentário registrado nesta oportunidade.");
          }}
          setToast={setToast}
        />
      )}
      {enviarApresentacao && (
        <EnviarApresentacao
          conta={conta}
          onRegistrar={async (interacao) => {
            if (!onInteraction) return;
            await onInteraction({ ...interacao, clientId: registro.clientId || "", opportunityId: registro.id });
          }}
          onMoverEstagio={async () => {
            const atual = ESTAGIOS_OPORTUNIDADE.indexOf(registro.estagio);
            const alvo = ESTAGIOS_OPORTUNIDADE.indexOf("Apresentação");
            // Só avança do começo do funil — nunca puxa de volta uma negociação
            // que já passou de Apresentação. Devolve se moveu, para o aviso ser
            // honesto.
            if (atual >= 0 && atual >= alvo) return false;
            await onSave?.({ estagio: "Apresentação", revision: registro.revision });
            return true;
          }}
          setToast={setToast}
          onClose={() => setEnviarApresentacao(false)}
        />
      )}
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

function CartaoOportunidade({ registro, analise, jornada, aberta, alternar, onEdit, onSimulate, onAvancarEtapa, cenarios = [], authHeaders, setToast }) {
  const { ambiental, greenScore, financeiro, operacional, expansao, riscos } = analise;
  const criticos = riscos.filter((risco) => risco.gravidade === "alta").length;
  return (
    <article className={`tdg-opp-card${aberta ? " aberta" : ""}`}>
      <button type="button" className="tdg-opp-head" onClick={alternar} aria-expanded={aberta}>
        {aberta ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        <span className="tdg-opp-head-nome">
          <strong>{tituloDaOportunidade(registro)}</strong>
          <small>
            {[subtituloDaOportunidade(registro), analise.estagio, `${financeiro.probabilidade}% de probabilidade`]
              .filter(Boolean)
              .join(" · ")}
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

          <OpportunityViabilityPanel oportunidade={registro} cenarios={cenarios} authHeaders={authHeaders} setToast={setToast} />

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
  comments = [],
  onComment,
  interactions = [],
  onInteraction,
  authHeaders,
  espacoId = "",
  currentUserId,
  onCreateTask,
  onCreate,
  onUpdate,
  onDelete,
  onNavigate,
  setToast,
}) {
  const [form, setForm] = useState(FORM_VAZIO);
  const [pessoas, setPessoas] = useState([]);
  useEffect(() => {
    if (!espacoId) return undefined;
    let ativo = true;
    fetch(`/api/collab?owner=${encodeURIComponent(espacoId)}`, { headers: authHeaders?.() || {} })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!ativo || !data) return;
        const membros = [data.owner, ...(data.members || []).filter((m) => m.status === "ativo")];
        setPessoas(membros.filter((p, i, lista) => p?.id && p?.name && lista.findIndex((m) => m?.id === p.id) === i));
      })
      .catch(() => { if (ativo) setPessoas([]); });
    return () => { ativo = false; };
  }, [authHeaders, espacoId]);
  const [tabelasDePreco, setTabelasDePreco] = useState([]);
  const [abertaId, setAbertaId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);

  // As tabelas de preço cadastradas (Cadastro · Tabelas de preço) para escolher
  // qual vale nesta oportunidade — o preço não é escolhido no ar, sai da tabela.
  useEffect(() => {
    let ativo = true;
    fetch("/api/todogreen/master-data/price-tables?limit=200", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : { records: [] }))
      .then((d) => { if (ativo) setTabelasDePreco(d.records || d.items || []); })
      .catch(() => {});
    return () => { ativo = false; };
  }, [authHeaders]);
  const [filtroEstagio, setFiltroEstagio] = useState("todas");
  const [busca, setBusca] = useState("");
  // Clicar num cartão de "O que trava o forecast" filtra o pipeline exatamente
  // para aquelas oportunidades (não manda para tarefa nenhuma). { rotulo, ids:Set }
  const [filtroPendencia, setFiltroPendencia] = useState(null);
  const abrirPendencia = (trava) => {
    setFiltroPendencia({ rotulo: trava.rotulo, ids: new Set(trava.ids || []) });
    setFiltroEstagio("todas");
    setBusca("");
    trocarVisao("lista");
  };
  // A análise do forecast (concentração, por etapa, travas, projeção mensal) fica
  // recolhida por padrão — pedido da titular (03/09): tela limpa, e um botão traz
  // a leitura quando ela quiser. A escolha fica gravada por navegador.
  const [analiseAberta, setAnaliseAberta] = useState(() => {
    try { return localStorage.getItem("todogreen-opp-analise") === "1"; } catch { return false; }
  });
  const alternarAnalise = () => setAnaliseAberta((v) => {
    const proximo = !v;
    try { localStorage.setItem("todogreen-opp-analise", proximo ? "1" : "0"); } catch { /* ok */ }
    return proximo;
  });
  const [visao, setVisao] = useState(() => {
    // O kanban simplificado é a visão pedida pela titular como padrão do
    // pipeline; a lista continua a um clique e a escolha fica gravada.
    try { return localStorage.getItem("todogreen-opp-view") || "kanban"; } catch { return "kanban"; }
  });
  const trocarVisao = (v) => { setVisao(v); try { localStorage.setItem("todogreen-opp-view", v); } catch { /* ok */ } };
  // Kanban dinâmico: a titular escolhe quais etapas quer ver. A escolha fica
  // gravada por navegador; por padrão todas aparecem.
  const [colunasOcultas, setColunasOcultas] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("todogreen-opp-cols-hidden") || "[]")); } catch { return new Set(); }
  });
  const alternarColuna = (estagio) => {
    setColunasOcultas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(estagio)) proximo.delete(estagio); else proximo.add(estagio);
      try { localStorage.setItem("todogreen-opp-cols-hidden", JSON.stringify([...proximo])); } catch { /* ok */ }
      return proximo;
    });
  };

  // A conta vinda pela URL (?client=) pré-preenche o formulário UMA vez, quando
  // ela aparece na lista carregada. Sem a trava, todo refetch de `clients`
  // reaplicava a conta da URL e sobrescrevia a que a pessoa acabou de escolher —
  // dava a impressão de que "não salva o cliente".
  const clienteDaUrlAplicado = useRef(false);
  useEffect(() => {
    if (clienteDaUrlAplicado.current) return;
    const clientId = new URLSearchParams(window.location.search).get("client") || "";
    if (!clientId) {
      clienteDaUrlAplicado.current = true;
      return;
    }
    const client = clients.find((item) => item.id === clientId);
    if (client) {
      setForm((current) => ({ ...current, clientId: client.id, cliente: client.name }));
      clienteDaUrlAplicado.current = true;
    }
  }, [clients]);

  const registros = useMemo(
    () => opportunities.map((item) => normalizarOportunidade(item)),
    [opportunities],
  );
  useEffect(() => {
    const opportunityId = new URLSearchParams(window.location.search).get("opportunity") || "";
    if (opportunityId && registros.some((item) => item.id === opportunityId)) setEditandoId(opportunityId);
  }, [registros]);
  const resumo = useMemo(() => resumirPipeline(registros), [registros]);
  const forecast = useMemo(() => {
    const agora = new Date();
    const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
    const meses = Array.from({ length: 6 }, (_, index) => {
      const data = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + index, 1));
      const mes = data.toISOString().slice(0, 7);
      return { mes, ...montarForecast({ oportunidades: registros, periodo: mes }) };
    });
    return {
      meses,
      pendencias: pendenciasDoForecast({ oportunidades: registros }),
      concentracao: riscoDeConcentracao({ oportunidades: registros }),
      // O mesmo forecast recortado por etapa do funil: onde o commit está parado.
      porEstagio: forecastPor("estagio", { oportunidades: registros }).filter((linha) => linha.pipeline > 0),
    };
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
  // O funil tem SÓ as 5 etapas abertas. "Fechada ganha"/"Fechada perdida" são
  // desfechos, não colunas — mostrar o negócio ganho como se ainda estivesse
  // "numa etapa" era o que confundia a leitura do funil.
  const etapas = useMemo(() => ESTAGIOS_FUNIL.map((estagio) => {
    const itens = registros.filter((registro) => registro.estagio === estagio);
    return {
      estagio,
      quantidade: itens.length,
      valor: itens.reduce((sum, item) => sum + analisarOportunidade(item).financeiro.valorContrato, 0),
    };
  }), [registros]);
  const desfechos = useMemo(() => {
    const somar = (lista) => lista.reduce((sum, item) => sum + analisarOportunidade(item).financeiro.valorContrato, 0);
    const ganhas = registros.filter((registro) => registro.estagio === "Fechada ganha");
    const perdidas = registros.filter((registro) => registro.estagio === "Fechada perdida");
    return {
      ganhas: { quantidade: ganhas.length, valor: somar(ganhas) },
      perdidas: { quantidade: perdidas.length, valor: somar(perdidas) },
    };
  }, [registros]);
  const visiveis = useMemo(() => registros.filter((registro) => {
    const stageMatches = filtroEstagio === "todas" || registro.estagio === filtroEstagio;
    const queryMatches = `${tituloDaOportunidade(registro)} ${registro.cliente} ${registro.nextStep || ""} ${registro.source || ""}`.toLowerCase().includes(busca.toLowerCase());
    const pendenciaMatches = !filtroPendencia || filtroPendencia.ids.has(registro.id);
    return stageMatches && queryMatches && pendenciaMatches;
  }), [busca, filtroEstagio, filtroPendencia, registros]);

  const campo = (key) => (event) =>
    setForm((atual) => ({ ...atual, [key]: event.target.value }));

  const [novaAberta, setNovaAberta] = useState(false);
  const [importacaoAberta, setImportacaoAberta] = useState(false);

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
      // O servidor esquenta a conta Fria (ou sem classificação) quando a
      // oportunidade nasce vinculada a ela; o aviso aqui espelha essa régua
      // para a pessoa saber na hora, sem precisar abrir o CRM.
      const contaVinculada = clients.find((item) => item.id === form.clientId);
      const estavaFria = contaVinculada && ["", "Frio"].includes(contaVinculada.crm?.temperature || "");
      setForm(FORM_VAZIO);
      setNovaAberta(false);
      setToast?.(estavaFria
        ? `Oportunidade registrada — a conta ${contaVinculada.name} saiu de Frio para Morno.`
        : "Oportunidade registrada com potencial ESG calculado.");
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
        <div className="tdg-page-actions">
          {authHeaders && (
            <button type="button" onClick={() => setImportacaoAberta(true)}>
              <Upload size={16} /> Importar pipeline
            </button>
          )}
          <button type="button" className="tdg-action" onClick={() => setNovaAberta(true)}>
            <Plus size={16} /> Nova oportunidade
          </button>
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

      <div className="tdg-analise-toggle">
        <button type="button" aria-expanded={analiseAberta} onClick={alternarAnalise}>
          {analiseAberta ? "Ocultar análise do forecast" : "Ver análise do forecast"}
        </button>
      </div>

      {analiseAberta && (<>
      <section className="tdg-pipeline-strip" aria-label="Forecast comercial mensal">
        {forecast.meses.map((item) => <article key={item.mes}><strong>{new Date(`${item.mes}-01T00:00:00Z`).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })}</strong><span>{item.quantidade} negócio(s)</span><small>{BRL.format(item.commit)} commit · {BRL.format(item.ponderado)} ponderado · {BRL.format(item.bestCase)} best case</small></article>)}
      </section>

      {/* Risco de concentração: um forecast em que 3 negócios são metade do
          aberto é aposta, não previsão. A distribuição mostra o que o número
          agregado esconde. */}
      <section className={`tdg-forecast-concentracao${forecast.concentracao.concentrado ? " atencao" : ""}`} aria-label="Concentração do pipeline">
        <div><span className="tdg-kicker">CONCENTRAÇÃO DO PIPELINE</span><strong>{forecast.concentracao.leitura}</strong></div>
        {forecast.concentracao.maiores.length > 0 && (
          <ul>{forecast.concentracao.maiores.map((maior) => <li key={maior.nome}><span>{maior.nome}</span><b>{BRL.format(maior.valor)}</b></li>)}</ul>
        )}
      </section>

      {forecast.porEstagio.length > 0 && (
        <section className="tdg-forecast-dimensao" aria-label="Forecast por etapa do funil">
          <span className="tdg-kicker">FORECAST POR ETAPA</span>
          <div className="tdg-forecast-dimensao-linhas">
            {forecast.porEstagio.map((linha) => (
              <article key={linha.chave}>
                <strong>{linha.chave}</strong>
                <small>{linha.quantidade} negócio(s)</small>
                <b>{BRL.format(linha.commit)} commit · {BRL.format(linha.ponderado)} ponderado</b>
              </article>
            ))}
          </div>
        </section>
      )}

      {forecast.pendencias.length > 0 && (
        <section className="tdg-forecast-travas" aria-label="O que trava o forecast">
          <span className="tdg-kicker">O QUE TRAVA O FORECAST</span>
          <div className="tdg-forecast-travas-lista">
            {forecast.pendencias.map((trava) => (
              <button type="button" className="tdg-forecast-trava-card" key={trava.id} onClick={() => abrirPendencia(trava)} title="Ver estas oportunidades na lista">
                <header><strong>{trava.rotulo}</strong><b>{trava.quantidade}</b></header>
                <p>{trava.contas.join(" · ")}{trava.restantes > 0 ? ` · +${trava.restantes}` : ""}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      </>)}

      {/* Ação em janela própria: o formulário não corta mais a página entre o
          forecast e o pipeline (pedido da titular, 30/08). Em erro o modal
          continua aberto — nada digitado se perde. */}
      {novaAberta && <Modal title="Nova oportunidade" onClose={() => setNovaAberta(false)} wide>
      <form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={salvar}>
        <div className="tdg-form-row">
          <label>
            <span>Nome do negócio</span>
            <input
              value={form.titulo}
              onChange={campo("titulo")}
              placeholder="Middle Mile Sorocaba, Same Day, retomada..."
            />
          </label>
          <label>
            <span>Cliente</span>
            {clients.length ? <select required value={form.clientId} onChange={(event) => { const client = clients.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, clientId: event.target.value, cliente: client?.name || "" })); }}><option value="">Selecione a conta</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select> : <input required value={form.cliente} onChange={campo("cliente")} />}
          </label>
          <label>
            <span>Estágio</span>
            {/* Só etapas ABERTAS aqui: um negócio nasce no funil, não já ganho ou
                perdido — fechar é ação deliberada no cartão da oportunidade. */}
            <select value={form.estagio} onChange={campo("estagio")}>
              {ESTAGIOS_FUNIL.map((estagio) => (
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
          <label>
            <span>Tabela de preço</span>
            <select value={form.tabelaPrecoId} onChange={campo("tabelaPrecoId")}>
              <option value="">Sem tabela definida</option>
              {tabelasDePreco.map((tabela) => (
                <option value={tabela.id} key={tabela.id}>
                  {tabela.name || tabela.code || tabela.id}{tabela.productId ? ` · ${tabela.productId}` : ""}
                </option>
              ))}
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
        <div className="tdg-form-actions">
          <button type="button" onClick={() => setNovaAberta(false)}>Cancelar</button>
          <button className="tdg-action" type="submit" disabled={salvando}>
            <Plus size={16} />
            {salvando ? "Registrando..." : "Registrar oportunidade"}
          </button>
        </div>
      </form>
      </Modal>}

      <section className="tdg-pipeline-strip" aria-label="Etapas do pipeline">
        <button type="button" className={filtroEstagio === "todas" ? "active" : ""} onClick={() => setFiltroEstagio("todas")}><strong>Pipeline completo</strong><span>{registros.length} negócio(s)</span><small>{BRL.format(resumo.valorTotal)}</small></button>
        {etapas.map((item) => <button type="button" className={filtroEstagio === item.estagio ? "active" : ""} onClick={() => setFiltroEstagio(item.estagio)} key={item.estagio}><strong>{item.estagio}</strong><span>{item.quantidade} negócio(s)</span><small>{BRL.format(item.valor)}</small></button>)}
      </section>
      {filtroPendencia && (
        <div className="tdg-opp-pendencia-filtro" role="status">
          <span>Filtrando: <strong>{filtroPendencia.rotulo}</strong> · {visiveis.length} oportunidade(s)</span>
          <button type="button" onClick={() => setFiltroPendencia(null)}>Limpar filtro</button>
        </div>
      )}
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
          <div className="tdg-opp-kb-cabecalho">
            <p className="tdg-opp-kb-resumo">{visiveis.length} oportunidade(s) no funil, cada uma na etapa em que está hoje. Clique no cartão para abrir.</p>
            {(desfechos.ganhas.quantidade > 0 || desfechos.perdidas.quantidade > 0) && (
              <p className="tdg-opp-kb-desfechos">
                <span className="ganhas">✓ Ganhas: {desfechos.ganhas.quantidade} · {BRL.format(desfechos.ganhas.valor)}</span>
                <span className="perdidas">✗ Perdidas: {desfechos.perdidas.quantidade}</span>
              </p>
            )}
          </div>
          <div className="tdg-opp-kb-colunas" role="group" aria-label="Escolher quais etapas do funil aparecem no quadro">
            <span>Etapas no quadro:</span>
            {ESTAGIOS_FUNIL.map((estagio) => (
              <button
                type="button"
                key={estagio}
                className={colunasOcultas.has(estagio) ? "" : "active"}
                aria-pressed={!colunasOcultas.has(estagio)}
                onClick={() => alternarColuna(estagio)}
              >
                {estagio}
              </button>
            ))}
          </div>
          <TopScrollRow className="tdg-opp-kanban-wrap" ariaLabel="Kanban de oportunidades por etapa">
            <div className="tdg-opp-kanban">
              {etapas.map((coluna, indice) => {
                if (colunasOcultas.has(coluna.estagio)) return null;
                const itens = visiveis.filter((registro) => registro.estagio === coluna.estagio);
                return (
                  <section
                    className="tdg-opp-kb-col"
                    style={{ "--kb-tom": Math.min(indice, 5) }}
                    key={coluna.estagio}
                  >
                    <header>
                      <strong>{coluna.estagio} · {coluna.quantidade}</strong>
                      <span>{BRL.format(coluna.valor)}</span>
                    </header>
                    <div className="tdg-opp-kb-body">
                      {itens.map((registro) => (
                        <button type="button" className="tdg-opp-kb-card" key={registro.id} onClick={() => setEditandoId(registro.id)} title={`${tituloDaOportunidade(registro)}${subtituloDaOportunidade(registro) ? ` — ${subtituloDaOportunidade(registro)}` : ""}`}>
                          <span>{tituloDaOportunidade(registro)}</span>
                          {subtituloDaOportunidade(registro) && <em>{subtituloDaOportunidade(registro)}</em>}
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
            cenarios={scenarios}
            authHeaders={authHeaders}
            setToast={setToast}
            onSimulate={() => onNavigate?.(`/todogreen/precificacao?opportunity=${encodeURIComponent(registro.id)}`)}
            onAvancarEtapa={(estagio) => { if (estagio !== registro.estagio) onUpdate?.(registro.id, { estagio, revision: registro.revision }); }}
          />
        ))}
      </div>
      {editando && (
        <EstudoEletrificacaoModal
          registro={editando}
          conta={clients.find((c) => c.id === editando.clientId) || null}
          onClose={() => setEditandoId(null)}
          onSave={(alteracoes) => onUpdate?.(editando.id, alteracoes)}
          onDelete={onDelete}
          setToast={setToast}
          comments={comments}
          onComment={onComment}
          interactions={interactions}
          onInteraction={onInteraction}
          pessoas={pessoas}
          onCreateTask={onCreateTask}
          currentUserId={currentUserId}
        />
      )}
      <ImportarPipelineModal
        aberto={importacaoAberta}
        onClose={() => setImportacaoAberta(false)}
        authHeaders={authHeaders}
        opportunities={opportunities}
        interactions={interactions}
        onCriarOportunidade={onCreate}
        onCriarInteracao={onInteraction}
        setToast={setToast}
      />
    </section>
  );
}
