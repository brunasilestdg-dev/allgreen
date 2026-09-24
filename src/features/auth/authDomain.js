// ===== Regras do fluxo de acesso (puras, sem React) =====
//
// A mesma tela de login atende portas diferentes: o ERP da To Do Green (raiz e
// /todogreen), os portais externos (cliente, motorista, TMS, colaborador) e o
// acesso geral do produto. Cada porta decide o texto da tela, o título da aba
// e para onde a pessoa vai depois de autenticar. Tudo isso é dado — morava
// espalhado em ternários encadeados dentro do componente, e mudar um portal
// exigia acertar cinco lugares iguais.

// Portas externas com destino e textos próprios. A identidade é a mesma para
// todas: o que muda é o portal que abre depois do login.
export const PORTAIS_DE_ENTRADA = Object.freeze({
  cliente: Object.freeze({
    destino: "/portal-cliente",
    titulo: "Entre no Portal do Cliente",
    aba: "To Do Green | Portal do Cliente",
    kicker: "PORTAL DO CLIENTE",
    helper:
      "Acompanhe pedidos, entregas, ocorrências, comprovantes e indicadores da sua operação.",
    secondary: "Primeiro acesso",
  }),
  motorista: Object.freeze({
    destino: "/portal-motorista",
    titulo: "Entre no Portal do Motorista",
    aba: "To Do Green | Portal do Motorista",
    kicker: "PORTAL DO MOTORISTA",
    helper:
      "Acesse viagens, coletas, entregas, ocorrências, documentos e comprovantes operacionais.",
    secondary: "Primeiro acesso",
  }),
  tms: Object.freeze({
    destino: "/portal-tms",
    titulo: "Entre no Portal TMS",
    aba: "To Do Green | Portal TMS",
    kicker: "TMS",
    helper:
      "Gerencie cargas, viagens, roteirização, ocorrências, POD e faturamento operacional.",
    secondary: "Alterar senha inicial",
  }),
  colaborador: Object.freeze({
    destino: "/portal-colaborador",
    titulo: "Entre no Portal do Colaborador",
    aba: "To Do Green | Portal do Colaborador",
    kicker: "PORTAL DO COLABORADOR",
    helper: "Acesse suas rotinas, documentos e informações de trabalho.",
    secondary: "Primeiro acesso",
  }),
});

// A entrada do ERP (raiz e /todogreen) quando nenhum portal foi escolhido.
export const ENTRADA_DO_ERP = Object.freeze({
  destino: "/todogreen",
  titulo: "Entre no ambiente To Do Green",
  aba: "To Do Green",
  kicker: "LOGIN PRIVADO",
  helper:
    "Use o e-mail e a senha inicial recebidos. No primeiro acesso, altere a senha antes de usar a operação.",
  secondary: "Alterar senha inicial",
});

export const portalDeEntrada = (entryPortal = "") =>
  PORTAIS_DE_ENTRADA[entryPortal] || ENTRADA_DO_ERP;

// A raiz é a porta de entrada da To Do Green. Cliente e motorista usam a
// mesma identidade, mas seguem para o próprio portal depois do login.
export const ehEntradaToDoGreen = ({ vertical = false, entryPortal = "", pathname = "" } = {}) =>
  Boolean(vertical) || Boolean(entryPortal) || /^\/todogreen(\/|$)/.test(pathname || "");

// A identidade da porta de entrada define o destino. Não voltamos ao produto
// genérico depois de autenticar uma pessoa da To Do Green; no acesso geral não
// há redirecionamento (string vazia).
export const destinoAposLogin = ({ entradaToDoGreen, entryPortal = "" }) =>
  entradaToDoGreen ? portalDeEntrada(entryPortal).destino : "";

// ===== Validações de formulário =====
// Devolvem a mensagem a mostrar, ou "" quando está tudo certo. O servidor
// valida de novo; aqui é só para errar rápido, na língua de quem usa.

export const SENHA_MINIMA = 8;
const EMAIL_VALIDO = /^\S+@\S+\.\S+$/;

export const normalizarEmail = (email = "") => String(email).trim().toLowerCase();

export const emailValido = (email = "") => EMAIL_VALIDO.test(normalizarEmail(email));

export function validarCredenciais({ email = "", password = "", name = "", mode = "login" } = {}) {
  if (!emailValido(email)) return "Informe um e-mail válido.";
  if (password.length < SENHA_MINIMA)
    return "A senha precisa ter pelo menos 8 caracteres.";
  if (mode === "register" && name.trim().length < 2) return "Informe seu nome.";
  return "";
}

// "Esqueci minha senha" usa o e-mail já digitado no formulário de login.
export const validarPedidoDeRecuperacao = (email = "") =>
  emailValido(email) ? "" : "Digite seu e-mail no campo acima e clique de novo.";

export function validarRedefinicao({ code = "", password = "" } = {}) {
  if (code.length < 6) return "Digite o código de 6 dígitos.";
  if (password.length < SENHA_MINIMA)
    return "A nova senha precisa ter pelo menos 8 caracteres.";
  return "";
}

// Troca da senha provisória no primeiro acesso.
export function validarTrocaDeSenhaProvisoria({ current = "", next = "", confirm = "" } = {}) {
  if (next.length < SENHA_MINIMA)
    return "A nova senha precisa ter pelo menos 8 caracteres.";
  if (next !== confirm) return "A confirmação não confere com a nova senha.";
  if (next === current) return "Escolha uma senha diferente da provisória.";
  return "";
}

// O campo do código aceita só os 6 dígitos, mesmo quando a pessoa cola o
// texto do e-mail inteiro.
export const normalizarCodigo = (valor = "") => String(valor).replace(/\D/g, "").slice(0, 6);

// O navegador diz "Failed to fetch" quando o servidor não responde; isso não
// pode aparecer em inglês para quem usa (produto 100% em português).
export const mensagemDeFalha = (reason, padrao = "Não foi possível concluir o acesso.") => {
  const message = reason?.message || "";
  if (message === "Failed to fetch")
    return "Não foi possível conectar ao servidor. Tente novamente.";
  return message || padrao;
};

// ===== Primeiro acesso com senha provisória =====
// Nada do app abre antes de a pessoa trocar a senha provisória — exceto as
// rotas que não dependem da conta dela (site público e os convites, que podem
// estar sendo abertos justamente para entrar com outra conta).
export const ROTAS_SEM_TROCA_DE_SENHA = Object.freeze([
  "public-site",
  "invite",
  "todogreen-access-invite",
]);

export const exigeTrocaDeSenha = ({ user, sessionStatus, routeKind }) =>
  Boolean(user?.mustChangePassword) &&
  sessionStatus === "authenticated" &&
  !ROTAS_SEM_TROCA_DE_SENHA.includes(routeKind);

// Papéis de convite de colaboração, como aparecem para quem foi convidado.
export const ROLE_LABELS_PT = Object.freeze({
  admin: "Administrador",
  gestor: "Gestor",
  colaborador: "Colaborador",
});

// Código de convite para espaço compartilhado vindo na URL (`?convite=...`).
export const codigoDeConviteDaUrl = (search = "") => {
  const m = String(search).match(/[?&]convite=([^&]+)/);
  if (!m) return "";
  // `%` solto na URL faria o decodeURIComponent lançar e derrubar a tela; o
  // servidor recusa o código torto com mensagem própria.
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
};
