// Acesso à vertical — JS puro, sem React: o dono do espaço ativo, o modo
// demonstração, os estados da confirmação de acesso e a leitura da resposta
// do servidor.
import { TODO_GREEN_PRODUCTION_DATA_POLICY, TODO_GREEN_ROLES } from "../logisticsVerticalDomain.js";

export const ownerId = () => {
  try {
    return localStorage.getItem("sf-space") || localStorage.getItem("sf-active-user") || "";
  } catch {
    return "";
  }
};

export const demoModeEnabled = (db = {}, access = {}) => Boolean(db?.[TODO_GREEN_PRODUCTION_DATA_POLICY.demoModeFlag] || access.demoMode);

// ===== Quem entra na vertical =====
//
// Só a API responde essa pergunta. A regra anterior abria a tela por quatro
// caminhos que o próprio navegador controla:
//
//   1. e-mail terminado no domínio da empresa;
//   2. um negócio chamado "To Do Green" no espaço — nome que a própria pessoa
//      digita no cadastro;
//   3. `tenantAccess.todogreen` gravado no estado local;
//   4. a chamada de acesso falhando, e o estado anterior mantendo a tela
//      aberta.
//
// O quarto era o mais silencioso e o terceiro o mais grave: era a própria
// tela de precificação que gravava `tenantAccess.todogreen` ao salvar uma
// simulação, então o acesso se autoconcedia e sobrevivia a qualquer correção
// feita no servidor.
//
// O backend já decide certo. Enquanto ele não confirmar vínculo e permissões,
// aqui não abre — e "não respondeu ainda" não é "pode entrar".
export const ACESSO = {
  verificando: "verificando",
  liberado: "liberado",
  negado: "negado",
};

// A resposta só vale se trouxer um papel conhecido. Corpo vazio, papel
// desconhecido ou 200 sem conteúdo não viram acesso — muito menos "admin".
export const lerRespostaDeAcesso = (payload) => {
  const role = String(payload?.role || "").trim();
  if (!TODO_GREEN_ROLES.includes(role)) return null;
  return { ...payload, role, allowed: true };
};
