// Jornada de proposta e contrato: a proposta nasce de simulação confirmada e
// liberada pelo Deal Desk; o contrato, de proposta aceita.
import { useEffect, useState } from "react";
import { AlertTriangle, FileCheck, Plus } from "lucide-react";
import { esgTranslator } from "../logisticsVerticalDomain.js";
import { cenarioConfirmado } from "../pricingPremisesDomain.js";
import { liberacaoDaProposta } from "../dealDeskDomain.js";
import { sugestaoDeContrato } from "../contratoSugeridoDomain.js";
import { BRL, number } from "./formatos.js";

const rotuloDoCenario = (item, clients = []) => {
  const nome = clients.find((client) => client.id === item.clientId)?.name || item.inputs?.client || item.clientId || "Cliente não identificado";
  const produto = item.result?.productName || item.productId || "Produto não informado";
  const dateValue = item.criadoEm || item.createdAt;
  const dataCriacao = dateValue && !Number.isNaN(Date.parse(dateValue))
    ? new Date(dateValue).toLocaleDateString("pt-BR")
    : "sem data";
  return `${nome} · ${produto} · ${dataCriacao}`;
};

const propostaAceita = (proposal) => ["accepted", "approved", "aceita", "aprovada"].includes(String(proposal?.status || proposal?.situacao || "").toLowerCase());
const escaparHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export default function ProposalPanel({ data, criar, atualizar, pedidosDeAprovacao = [], setToast }) {
  // A proposta é o documento que sai da empresa. Ela só pode nascer de uma
  // simulação cujas premissas alguém declarou como vindas do cliente ou de
  // medição — não da última simulação qualquer que passou pela tela.
  // `data.pricingScenarios` já chega filtrado: só entra ali o que tem
  // procedência. O que sobrou de fora vem contado à parte, para a tela poder
  // dizer por que a proposta não sai em vez de fingir que não há simulação.
  const cenariosDisponiveis = (data.pricingScenarios || []).filter(cenarioConfirmado);
  const [cenarioId, setCenarioId] = useState("");
  const latest = cenariosDisponiveis.find((item) => item.id === cenarioId) || cenariosDisponiveis[0];
  const oportunidade = (data.opportunities || []).find((item) => item.id === latest?.opportunityId);
  const clienteId = latest?.clientId || oportunidade?.clientId || "";
  const cliente = (data.clients || []).find((item) => item.id === clienteId);
  const nomeCliente = cliente?.name || oportunidade?.cliente || oportunidade?.clientName || "";
  const existemNaoConfirmadas = !latest && Number(data.simulacoesSemProcedencia || 0) > 0;
  // O Deal Desk manda por cima da confirmação de premissas: premissa
  // confirmada com condição fora da régua ainda depende de aprovação.
  const liberacao = liberacaoDaProposta(latest?.id, pedidosDeAprovacao);
  const podeSalvar = Boolean(latest) && liberacao.liberada;
  const translated = esgTranslator(latest?.result?.impact?.co2AvoidedKg || 0);
  const [form, setForm] = useState({ title: "Proposta logística sustentável", scope: "", commercialTerms: "", risks: "" });
  const proposalText = latest
    ? `Proposta ${latest.result.productName}: preço recomendado ${BRL.format(latest.result.recommendedPrice)}, margem estimada ${number.format(latest.result.marginPercent)}%, CO2 evitado estimado de ${number.format(latest.result.impact.co2AvoidedKg / 1000)} tCO2e. ${translated.proposalText}`
    : existemNaoConfirmadas
      ? "As simulações existentes ainda estão como hipótese. Abra Precificação, confirme as premissas e salve. Só então o preço e o ESG podem virar proposta."
      : "Nenhuma simulação confirmada disponível para proposta.";
  const [salvando, setSalvando] = useState(false);
  const propostasAceitas = (data.proposals || []).filter(propostaAceita);
  const [propostaContratoId, setPropostaContratoId] = useState("");
  const propostaContrato = propostasAceitas.find((item) => item.id === propostaContratoId) || propostasAceitas[0];
  const contratoVazio = { titulo: "Contrato de operação logística", inicioEm: "", fimEm: "", valorMensal: "", tipoCobranca: "mensal", valorTotal: "", termos: "", assinatura: "pending", aprovacao: "pending", renovacao: "manual", avisoRenovacaoEm: "", diaFaturamento: "", antecedenciaAvisoDias: "60", servicoId: "", tabelaPrecoId: "", indiceReajuste: "", dataBaseReajuste: "", compromissoMinimo: "", slaPrazoHoras: "", prazoPagamentoDias: "", aliquotaImposto: "", eventoFaturamento: "delivery" };
  const [contrato, setContrato] = useState(contratoVazio);
  const [salvandoContrato, setSalvandoContrato] = useState(false);
  // Quando a proposta selecionada muda, o contrato nasce já preenchido com o
  // que a simulação aprovou (valor, serviço, imposto) — sugestão, não trava:
  // os campos seguem editáveis. É o que impede o valor negociado de divergir
  // do preço aprovado por um erro de digitação.
  useEffect(() => {
    setContrato({ ...contratoVazio, ...sugestaoDeContrato(propostaContrato, data.pricingScenarios || []) });
    // Re-semeia só quando a proposta escolhida troca; contratoVazio é literal
    // constante e não precisa entrar nas dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propostaContrato?.id]);
  const save = async (event) => {
    event.preventDefault();
    if (!latest) {
      setToast?.("Sem simulação com premissas confirmadas, a proposta não pode ser gerada.");
      return;
    }
    // Guarda no código, não só no `disabled`: era exatamente aqui que faltava
    // impedimento — o Deal Desk avisava e a proposta saía do mesmo jeito.
    if (!liberacao.liberada) {
      setToast?.(liberacao.motivo);
      return;
    }
    setSalvando(true);
    try {
      await criar("proposals", {
        clientId: clienteId,
        cliente: nomeCliente,
        oportunidadeId: latest.opportunityId || "",
        titulo: form.title,
        escopo: form.scope,
        condicoes: form.commercialTerms,
        riscos: form.risks,
        texto: proposalText,
        cenarioId: latest.id,
      });
      setForm({ title: "Proposta logística sustentável", scope: "", commercialTerms: "", risks: "" });
      setToast?.("Proposta To Do Green salva");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };
  const aceitarProposta = async (proposal) => {
    try {
      await atualizar("proposals", proposal.id, { situacao: "accepted", revision: proposal.revision });
      setToast?.("Proposta marcada como aceita. O contrato já pode ser gerado.");
    } catch (error) { setToast?.(error.message); }
  };
  const baixarProposta = (proposal) => {
    const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escaparHtml(proposal.title)}</title><style>body{font:16px/1.55 system-ui;margin:48px auto;max-width:760px;color:#17372d}h1{color:#075c45}section{margin:28px 0}small{color:#547067}</style><body><small>To Do Green · proposta vinculada ${escaparHtml(proposal.id)}</small><h1>${escaparHtml(proposal.title)}</h1><p><strong>Cliente:</strong> ${escaparHtml(proposal.client)}</p><section><h2>Proposta</h2><p>${escaparHtml(proposal.proposalText)}</p></section><section><h2>Escopo</h2><p>${escaparHtml(proposal.scope)}</p><h2>Condições comerciais</h2><p>${escaparHtml(proposal.commercialTerms)}</p><h2>Riscos e ressalvas</h2><p>${escaparHtml(proposal.risks)}</p></section><small>Gerada a partir da simulação ${escaparHtml(proposal.scenarioId)}. Valide termos, evidências e aprovações antes do envio.</small></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `proposta-${String(proposal.client || proposal.id).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const salvarContrato = async (event) => {
    event.preventDefault();
    if (!propostaContrato) { setToast?.("Aceite uma proposta antes de gerar o contrato."); return; }
    setSalvandoContrato(true);
    try {
      await criar("contracts", {
        clientId: propostaContrato.clientId,
        cliente: propostaContrato.client,
        oportunidadeId: propostaContrato.opportunityId,
        propostaId: propostaContrato.id,
        cenarioId: propostaContrato.scenarioId,
        ...contrato,
        valorMensal: Number(contrato.valorMensal || 0),
        valorTotal: Number(contrato.valorTotal || 0),
        compromissoMinimo: Number(contrato.compromissoMinimo || 0),
        // A OS lê isto do fields_json do contrato para saber se o valor
        // negociado é mensal (não multiplica) ou por unidade (× quantidade).
        campos: { pricingMode: contrato.tipoCobranca === "por_unidade" ? "por_unidade" : "mensal" },
        sla: { prazoEntregaHoras: Number(contrato.slaPrazoHoras || 0) },
        condicoesComerciais: { prazoPagamentoDias: Number(contrato.prazoPagamentoDias || 0) },
        impostos: { aliquotaPercentual: Number(contrato.aliquotaImposto || 0) },
        regrasFaturamento: { evento: contrato.eventoFaturamento },
        situacao: "draft",
      });
      setContrato(contratoVazio);
      setToast?.("Contrato criado e vinculado à proposta, oportunidade e cliente.");
    } catch (error) { setToast?.(error.message); }
    finally { setSalvandoContrato(false); }
  };
  const mudarContrato = async (item, changes, message) => {
    try {
      await atualizar("contracts", item.id, { ...changes, revision: item.revision, nota: message });
      setToast?.(message);
    } catch (error) { setToast?.(error.message); }
  };
  return (
    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">PROPOSTAS</span><h2>Proposta comercial com preço, operação e ROI ambiental</h2></div><strong>{data.proposals.length} proposta(s)</strong></div>
      <form className="tdg-access-form" onSubmit={save}>
        <label><span>Simulação confirmada</span><select value={latest?.id || ""} onChange={(event) => setCenarioId(event.target.value)} disabled={!cenariosDisponiveis.length}><option value="">Selecione</option>{cenariosDisponiveis.map((item) => <option value={item.id} key={item.id}>{rotuloDoCenario(item, data.clients || [])}</option>)}</select></label>
        <label><span>Cliente vinculado</span><input value={nomeCliente || "Cliente não identificado"} readOnly /></label>
        {[ ["title", "Título"], ["scope", "O que está incluído na operação"], ["commercialTerms", "Condições comerciais"], ["risks", "Riscos e ressalvas"]].map(([key, label]) => <label key={key}><span>{label}</span><input value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
        <button className="tdg-action" type="submit" disabled={!podeSalvar || !clienteId || !nomeCliente || salvando}><Plus size={17} />{salvando ? "Salvando..." : "Salvar proposta"}</button>
      </form>
      {latest && (!clienteId || !nomeCliente) && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>A simulação não está vinculada a um cliente válido. Abra a oportunidade, confirme o cliente e gere uma nova simulação.</span></div>}
      {latest && !liberacao.liberada && (
        <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{liberacao.motivo}</span></div>
      )}
      {latest && liberacao.liberada && liberacao.pedido && (
        <p className="tdg-esg-nota">{liberacao.motivo}</p>
      )}
      <div className="tdg-method"><strong>Prévia da proposta</strong><p>{proposalText}</p><small>Valide preço, escopo, evidências ESG e aprovações antes do envio.</small></div>
      <div className="tdg-access-list">{data.proposals.map((item) => <div className="tdg-access-row" key={item.id}><span><strong>{item.title}</strong><small>{item.client || "cliente não informado"}</small></span><span>{propostaAceita(item) ? "aceita" : item.scenarioId ? "com simulação" : "rascunho"}</span><button type="button" onClick={() => baixarProposta(item)}>Baixar documento</button>{!propostaAceita(item) && <button type="button" onClick={() => aceitarProposta(item)}>Registrar aceite</button>}</div>)}</div>
      <div className="tdg-section-head"><div><span className="tdg-kicker">CONTRATOS</span><h2>Gerar contrato a partir de proposta aceita</h2></div><strong>{data.contracts.length} contrato(s)</strong></div>
      <form className="tdg-access-form" onSubmit={salvarContrato}>
        <label><span>Proposta aceita</span><select value={propostaContrato?.id || ""} onChange={(event) => setPropostaContratoId(event.target.value)}><option value="">Selecione</option>{propostasAceitas.map((item) => <option key={item.id} value={item.id}>{item.client || "Cliente"} · {item.title}</option>)}</select><small>Valor, serviço e imposto vêm preenchidos da simulação aceita — confira e ajuste antes de gerar.</small></label>
        <label><span>Título</span><input value={contrato.titulo} onChange={(event) => setContrato((current) => ({ ...current, titulo: event.target.value }))} /></label>
        <label><span>Início</span><input type="date" value={contrato.inicioEm} onChange={(event) => setContrato((current) => ({ ...current, inicioEm: event.target.value }))} /></label>
        <label><span>Fim</span><input type="date" value={contrato.fimEm} onChange={(event) => setContrato((current) => ({ ...current, fimEm: event.target.value }))} /></label>
        <label><span>Valor negociado</span><input type="number" value={contrato.valorMensal} onChange={(event) => setContrato((current) => ({ ...current, valorMensal: event.target.value }))} /></label>
        <label><span>Tipo de cobrança</span><select value={contrato.tipoCobranca} onChange={(event) => setContrato((current) => ({ ...current, tipoCobranca: event.target.value }))}><option value="mensal">Mensal (operação dedicada)</option><option value="por_unidade">Por viagem/entrega</option></select><small>Decide como a OS usa o valor: "mensal" é fechado no período; "por viagem" multiplica pela quantidade.</small></label>
        <label><span>Valor total</span><input type="number" value={contrato.valorTotal} onChange={(event) => setContrato((current) => ({ ...current, valorTotal: event.target.value }))} /></label>
        <label><span>Serviço</span><input value={contrato.servicoId} onChange={(event) => setContrato((current) => ({ ...current, servicoId: event.target.value }))} placeholder="Código do serviço" /></label>
        <label><span>Tabela de preço</span><input value={contrato.tabelaPrecoId} onChange={(event) => setContrato((current) => ({ ...current, tabelaPrecoId: event.target.value }))} placeholder="Código da tabela" /></label>
        <label><span>SLA de entrega</span><input type="number" min="0" value={contrato.slaPrazoHoras} onChange={(event) => setContrato((current) => ({ ...current, slaPrazoHoras: event.target.value }))} placeholder="Horas" /></label>
        <label><span>Prazo de pagamento</span><input type="number" min="0" value={contrato.prazoPagamentoDias} onChange={(event) => setContrato((current) => ({ ...current, prazoPagamentoDias: event.target.value }))} placeholder="Dias" /></label>
        <label><span>Imposto estimado</span><input type="number" min="0" step="0.01" value={contrato.aliquotaImposto} onChange={(event) => setContrato((current) => ({ ...current, aliquotaImposto: event.target.value }))} placeholder="%" /></label>
        <label><span>Compromisso mínimo</span><input type="number" min="0" step="0.01" value={contrato.compromissoMinimo} onChange={(event) => setContrato((current) => ({ ...current, compromissoMinimo: event.target.value }))} /></label>
        <label><span>Índice de reajuste</span><input value={contrato.indiceReajuste} onChange={(event) => setContrato((current) => ({ ...current, indiceReajuste: event.target.value }))} placeholder="Ex.: IPCA" /></label>
        <label><span>Data-base do reajuste</span><input type="date" value={contrato.dataBaseReajuste} onChange={(event) => setContrato((current) => ({ ...current, dataBaseReajuste: event.target.value }))} /></label>
        <label><span>Gatilho do faturamento</span><select value={contrato.eventoFaturamento} onChange={(event) => setContrato((current) => ({ ...current, eventoFaturamento: event.target.value }))}><option value="delivery">Entrega concluída</option><option value="monthly">Fechamento mensal</option><option value="milestone">Marco contratual</option></select></label>
        <label><span>Termos e condições</span><input value={contrato.termos} onChange={(event) => setContrato((current) => ({ ...current, termos: event.target.value }))} /></label>
        <label><span>Renovação</span><select value={contrato.renovacao} onChange={(event) => setContrato((current) => ({ ...current, renovacao: event.target.value }))}><option value="manual">Manual</option><option value="automatic">Automática</option><option value="none">Sem renovação</option></select></label>
        <label><span>Aviso de renovação</span><input type="date" value={contrato.avisoRenovacaoEm} onChange={(event) => setContrato((current) => ({ ...current, avisoRenovacaoEm: event.target.value }))} /></label>
        <label><span>Dia de faturamento</span><input type="number" min="1" max="31" value={contrato.diaFaturamento} onChange={(event) => setContrato((current) => ({ ...current, diaFaturamento: event.target.value }))} /></label>
        <label><span>Antecedência do aviso</span><input type="number" min="0" max="365" value={contrato.antecedenciaAvisoDias} onChange={(event) => setContrato((current) => ({ ...current, antecedenciaAvisoDias: event.target.value }))} /></label>
        <button className="tdg-action" type="submit" disabled={!propostaContrato || salvandoContrato}><FileCheck size={17} />{salvandoContrato ? "Gerando..." : "Gerar contrato"}</button>
      </form>
      <div className="tdg-access-list">{data.contracts.map((item) => <div className="tdg-access-row" key={item.id}><span><strong>{item.title}</strong><small>{item.client || "cliente não informado"} · versão {item.version || 1} · {item.serviceId || "serviço pendente"} · mínimo {BRL.format(item.minimumCommitment || 0)}</small></span><span>{item.approvalStatus === "approved" ? "aprovado" : "aprovação pendente"}</span><span>{item.signatureStatus === "signed" ? "assinado" : item.signatureStatus === "sent" ? "aguardando assinatura" : "assinatura pendente"}</span>{item.approvalStatus !== "approved" && <button type="button" onClick={() => mudarContrato(item, { aprovacao: "approved" }, "Contrato aprovado e liberado para assinatura.")}>Aprovar</button>}{item.signatureStatus === "pending" && <button type="button" onClick={() => mudarContrato(item, { assinatura: "sent" }, "Envio para assinatura registrado. Nenhuma mensagem externa foi disparada.")}>Registrar envio</button>}{item.signatureStatus === "sent" && <button type="button" onClick={() => mudarContrato(item, { assinatura: "signed", assinadoEm: new Date().toISOString(), situacao: "active" }, "Assinatura confirmada e contrato ativado.")}>Confirmar assinatura</button>}</div>)}</div>
    </section>
  );
}
