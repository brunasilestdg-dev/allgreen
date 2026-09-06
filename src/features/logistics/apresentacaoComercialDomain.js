// Apresentação comercial por e-mail: o texto muda conforme a TEMPERATURA da
// conta (a "melhor abordagem por perfil"). Puro e testável — a tela só monta o
// e-mail a partir daqui e envia com o PDF anexado.

export const APRESENTACAO_PDF_URL = "/apresentacao-comercial-todogreen.pdf";
export const APRESENTACAO_PDF_NOME = "Apresentacao-To-Do-Green.pdf";
export const APRESENTACAO_ASSUNTO = "To Do Green — logística 100% elétrica para a sua operação";

const primeiroNome = (nome) => String(nome || "").trim().split(/\s+/)[0] || "";

// Abertura QUENTE/MORNO só é usada quando houve contato de verdade — senão o
// e-mail mentiria "retomando nosso contato" para quem nunca foi abordado.
const ABERTURA = {
  Quente: (conta) =>
    `Que bom seguir com a conversa${conta ? ` sobre a ${conta}` : ""}! Como combinamos, envio em anexo a apresentação da To Do Green para você avançar internamente.`,
  Morno: (conta) =>
    `Retomando nosso contato${conta ? ` sobre a ${conta}` : ""}, segue em anexo a apresentação da To Do Green — assim você tem o panorama completo para a próxima conversa.`,
  Frio: (conta) =>
    `Sou da To Do Green e gostaria de me apresentar${conta ? ` para a ${conta}` : ""}. Somos uma operação logística 100% elétrica, e envio em anexo nossa apresentação para você conhecer a proposta.`,
};

// Distila o contexto de mercado da empresa (pesquisa/inteligência externa) em
// sinais simples que o e-mail pode CITAR sem inventar — só o que a pesquisa
// comprovou. Devolve { rfqAberta, esgRelevante, segmento, temContexto }.
export const contextoDeMercado = (report = {}, { segmento } = {}) => {
  const r = report && typeof report === "object" ? report : {};
  const rfqAberta = Array.isArray(r.openRfqs) && r.openRfqs.length > 0;
  const esgRelevante = /alt|relevan/i.test(String(r.esg?.relevance || ""));
  const setor = String(r.suggestedSegment?.value || segmento || "").trim();
  return { rfqAberta, esgRelevante, segmento: setor, temContexto: rfqAberta || esgRelevante || !!setor };
};

// Abertura personalizada pelo momento da empresa. `retoma` = houve contato real
// (só então dá para "retomar"); sem contato, a mesma personalização entra como
// apresentação, nunca como retomada.
const aberturaPersonalizada = (contexto, conta, retoma) => {
  const alvo = conta ? ` a ${conta}` : "";
  if (contexto.rfqAberta) {
    return retoma
      ? `Retomando o contato${conta ? ` sobre${alvo}` : ""}: vi que vocês estão com cotações de transporte em aberto e a To Do Green pode participar — operação 100% elétrica, com custo por km competitivo e relatório de impacto para o seu ESG. Segue a apresentação em anexo.`
      : `Sou da To Do Green e queria me apresentar${alvo}: vi que vocês estão com cotações de transporte em aberto, e somos uma operação logística 100% elétrica — envio nossa apresentação para você conhecer a proposta.`;
  }
  const setor = contexto.segmento ? ` em ${contexto.segmento}` : "";
  return retoma
    ? `Retomando nosso contato${conta ? ` sobre${alvo}` : ""}: acompanho empresas${setor} que estão levando a pauta ESG para a logística, e trago a apresentação da To Do Green para avançarmos.`
    : `Sou da To Do Green e gostaria de me apresentar${alvo}: empresas${setor} têm buscado tirar emissão da operação logística, e é exatamente isso que entregamos — frota 100% elétrica. Segue nossa apresentação em anexo.`;
};

const VALOR = [
  "O que a To Do Green entrega:",
  "• Custo competitivo — preço de frete alinhado ao mercado, com economia de diesel e menor custo por km da frota elétrica repassada na operação.",
  "• Previsibilidade de custo — sem exposição à variação do diesel; TCO por rota transparente na proposta.",
  "• Frota 100% elétrica — redução real de emissões, com relatório auditável para o seu ESG (Escopo 3).",
  "• Rastreio ao vivo e comprovante de entrega (POD) no portal do cliente.",
  "• Roteirização que entende autonomia e recarga, sem surpresa no prazo.",
].join("\n");

// Monta o e-mail (assunto + corpo) a partir do perfil da conta e do contato.
// `houveContato`: houve interação registrada? Só então o texto pode "retomar" —
// senão nunca afirma um contato que não existiu (pedido da titular).
// `contexto`: saída de contextoDeMercado — quando há contexto da empresa, a
// abertura é personalizada; sem ele, cai no genérico por temperatura.
export const montarEmailApresentacao = ({ contatoNome, contaNome, temperatura, houveContato = false, contexto = null } = {}) => {
  const nome = primeiroNome(contatoNome);
  const saudacao = nome ? `Olá, ${nome},` : "Olá,";
  const conta = String(contaNome || "").trim();
  // "Retomar" exige contato real E uma temperatura morna/quente.
  const retoma = !!houveContato && (temperatura === "Quente" || temperatura === "Morno");
  let abertura;
  if (contexto && contexto.temContexto) {
    abertura = aberturaPersonalizada(contexto, conta, retoma);
  } else if (retoma) {
    abertura = ABERTURA[temperatura](conta);
  } else {
    // Sem contexto e sem contato comprovado: apresentação honesta (nunca "retomando").
    abertura = ABERTURA.Frio(conta);
  }
  const corpo = [
    saudacao,
    "",
    abertura,
    "",
    VALOR,
    "",
    "Fico à disposição para agendar uma conversa e adaptar a proposta à sua operação.",
    "",
    "Abraço,",
    "Equipe comercial · To Do Green",
  ].join("\n");
  return { assunto: APRESENTACAO_ASSUNTO, corpo };
};

// Link de compose do Gmail (fallback quando o envio direto não está disponível):
// leva to/assunto/corpo prontos; o anexo a pessoa põe manualmente.
export const linkComposeGmail = ({ para, assunto, corpo } = {}) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para || "")}` +
  `&su=${encodeURIComponent(assunto || "")}&body=${encodeURIComponent(corpo || "")}`;
