// Apresentação comercial por e-mail: o texto muda conforme a TEMPERATURA da
// conta (a "melhor abordagem por perfil"). Puro e testável — a tela só monta o
// e-mail a partir daqui e envia com o PDF anexado.

export const APRESENTACAO_PDF_URL = "/apresentacao-comercial-todogreen.pdf";
export const APRESENTACAO_PDF_NOME = "Apresentacao-To-Do-Green.pdf";
export const APRESENTACAO_ASSUNTO = "To Do Green — logística 100% elétrica para a sua operação";

const primeiroNome = (nome) => String(nome || "").trim().split(/\s+/)[0] || "";

// Abertura por temperatura: quente retoma, morno reconecta, frio se apresenta.
const ABERTURA = {
  Quente: (conta) =>
    `Que bom seguir com a conversa${conta ? ` sobre a ${conta}` : ""}! Como combinamos, envio em anexo a apresentação da To Do Green para você avançar internamente.`,
  Morno: (conta) =>
    `Retomando nosso contato${conta ? ` sobre a ${conta}` : ""}, segue em anexo a apresentação da To Do Green — assim você tem o panorama completo para a próxima conversa.`,
  Frio: (conta) =>
    `Sou da To Do Green e gostaria de me apresentar${conta ? ` para a ${conta}` : ""}. Somos uma operação logística 100% elétrica, e envio em anexo nossa apresentação para você conhecer a proposta.`,
};

const ABERTURA_PADRAO = (conta) =>
  `Segue em anexo a apresentação da To Do Green${conta ? ` para a ${conta}` : ""} — logística 100% elétrica, com rastreio, comprovação de entrega e relatório de impacto ambiental.`;

const VALOR = [
  "O que a To Do Green entrega:",
  "• Frota 100% elétrica — redução real de emissões, com relatório auditável para o seu ESG.",
  "• Rastreio ao vivo e comprovante de entrega (POD) no portal do cliente.",
  "• Roteirização que entende autonomia e recarga, sem surpresa no prazo.",
].join("\n");

// Monta o e-mail (assunto + corpo) a partir do perfil da conta e do contato.
export const montarEmailApresentacao = ({ contatoNome, contaNome, temperatura } = {}) => {
  const nome = primeiroNome(contatoNome);
  const saudacao = nome ? `Olá, ${nome},` : "Olá,";
  const conta = String(contaNome || "").trim();
  const abertura = (ABERTURA[temperatura] || ABERTURA_PADRAO)(conta);
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
