// ===== Interações do comercial =====
//
// Pedido da titular (30/08): "preciso registrar as interações, atas de agenda
// com o cliente, tentativas de contato, etc nas oportunidades e clientes".
//
// A regra de alcance é a mesma dos comentários e mora no DADO, não numa tabela
// de espelhamento: interação com clientId e sem opportunityId é da CONTA e
// aparece em todas as oportunidades dela; interação com opportunityId fica só
// naquela oportunidade, ainda que atrelada ao cliente.
//
// A tentativa de contato é um tipo de primeira classe de propósito: é o registro
// de que se tentou e não houve retorno que explica uma conta esfriando — sem
// ele, o histórico mostra silêncio e parece descuido de quem cuida da conta.

export const TIPOS_DE_INTERACAO = Object.freeze([
  { id: "reuniao", rotulo: "Reunião", ata: true },
  { id: "ligacao", rotulo: "Ligação", ata: false },
  { id: "email", rotulo: "E-mail", ata: false },
  { id: "visita", rotulo: "Visita", ata: true },
  { id: "whatsapp", rotulo: "WhatsApp", ata: false },
  { id: "tentativa", rotulo: "Tentativa de contato", ata: false },
  { id: "proposta", rotulo: "Proposta enviada", ata: false },
  { id: "outro", rotulo: "Outro", ata: false },
]);

const POR_ID = new Map(TIPOS_DE_INTERACAO.map((tipo) => [tipo.id, tipo]));

export const RESULTADOS_DA_INTERACAO = Object.freeze([
  { id: "", rotulo: "Sem resultado registrado" },
  { id: "avancou", rotulo: "Avançou" },
  { id: "manteve", rotulo: "Sem mudança" },
  { id: "sem-retorno", rotulo: "Sem retorno do cliente" },
  { id: "recuou", rotulo: "Recuou" },
]);

export const rotuloDoTipo = (tipo) => POR_ID.get(String(tipo || "").trim())?.rotulo || "Interação";

export const tipoValido = (tipo) => (POR_ID.has(String(tipo || "").trim()) ? String(tipo).trim() : "reuniao");

const texto = (valor) => String(valor ?? "").trim();

const dataHoje = (agora = new Date()) => agora.toISOString().slice(0, 10);

// Reunião marcada para o futuro é interação AGENDADA — a titular pediu para
// registrar "vou reunir com fulano semana que vem". Derivado da data para não
// precisar de coluna nova: ocorridaEm > hoje ⇒ agendada. Uma agendada NÃO
// conta como contato feito (não zera o "dias sem contato") e aparece na lista
// de próximos compromissos.
export const interacaoAgendada = (interacao = {}, agora = new Date()) => {
  const quando = texto(interacao.ocorridaEm);
  if (!quando) return false;
  return quando > dataHoje(agora);
};

// O corte que cada tela faz. Passar opportunityId significa "estou dentro desta
// oportunidade": vejo o que é dela MAIS o que foi registrado na conta. Passar só
// clientId significa "estou na conta": vejo o que é da conta, sem puxar para cá
// a conversa específica de cada oportunidade.
export const interacoesVisiveis = ({ interacoes = [], clientId = "", opportunityId = "" } = {}) => {
  const conta = texto(clientId);
  const oportunidade = texto(opportunityId);
  const filtradas = interacoes.filter((item) => {
    const daOportunidade = texto(item.opportunityId);
    const daConta = texto(item.clientId);
    if (oportunidade) {
      if (daOportunidade) return daOportunidade === oportunidade;
      return Boolean(conta) && daConta === conta;
    }
    if (!conta) return false;
    return daConta === conta && !daOportunidade;
  });
  return ordenarInteracoes(filtradas);
};

// Mais recente primeiro, pela data em que a interação ACONTECEU — não pela data
// em que foi digitada. Uma ata lançada com atraso pertence ao dia da reunião.
export const ordenarInteracoes = (interacoes = []) =>
  [...interacoes].sort((a, b) => {
    const porData = texto(b.ocorridaEm).localeCompare(texto(a.ocorridaEm));
    return porData || texto(b.criadoEm).localeCompare(texto(a.criadoEm));
  });

export const ultimaInteracao = (interacoes = []) => ordenarInteracoes(interacoes)[0] || null;

// Dias desde a última interação registrada. Devolve null (nunca 0) quando não há
// interação nenhuma: "nunca falamos" e "falamos hoje" não podem virar o mesmo
// número na tela. Reunião AGENDADA (data futura) não conta como contato feito —
// se a única coisa registrada é uma reunião marcada para semana que vem, ainda
// é "nunca falamos".
export const diasSemContato = (interacoes = [], agora = new Date()) => {
  const passadas = interacoes.filter((item) => !interacaoAgendada(item, agora));
  const ultima = ultimaInteracao(passadas);
  if (!ultima || !texto(ultima.ocorridaEm)) return null;
  const quando = new Date(ultima.ocorridaEm);
  if (Number.isNaN(quando.getTime())) return null;
  const dias = Math.floor((agora.getTime() - quando.getTime()) / 86400000);
  return dias < 0 ? 0 : dias;
};

// Compromissos combinados: próximo passo textual com data futura MAIS reuniões
// agendadas (a própria interação com ocorridaEm no futuro). Some da tela quando
// vence — próximo passo vencido vira ação atrasada, reunião passada vira
// histórico.
export const proximosPassos = (interacoes = [], agora = new Date()) => {
  const hoje = dataHoje(agora);
  const passos = interacoes
    .filter((item) => texto(item.proximoPasso) && texto(item.proximoPassoEm) >= hoje)
    .map((item) => ({
      id: `passo:${item.id}`,
      passo: texto(item.proximoPasso),
      quando: texto(item.proximoPassoEm),
      origem: texto(item.opportunityId) ? "oportunidade" : "conta",
      tipo: "proximo-passo",
    }));
  const agendadas = interacoes
    .filter((item) => interacaoAgendada(item, agora))
    .map((item) => ({
      id: `agendada:${item.id}`,
      passo: `${rotuloDoTipo(item.tipo)}${texto(item.assunto) ? ` · ${texto(item.assunto)}` : ""}`,
      quando: texto(item.ocorridaEm),
      origem: texto(item.opportunityId) ? "oportunidade" : "conta",
      tipo: "agendada",
    }));
  return [...passos, ...agendadas].sort((a, b) => a.quando.localeCompare(b.quando));
};

// Uma linha de resumo por interação, do jeito que aparece no histórico.
export const resumoDaInteracao = (interacao = {}) => {
  const partes = [rotuloDoTipo(interacao.tipo)];
  if (texto(interacao.assunto)) partes.push(texto(interacao.assunto));
  return partes.join(" · ");
};
