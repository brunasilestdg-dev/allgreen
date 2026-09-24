// ===== Atalhos de ambiente =====
//
// Camada pura. O app geral é o núcleo: para quem está logado, é o que a raiz
// abre — e a raiz é também onde o app instalado (PWA) começa. As verticais
// moram em /todogreen, /greenon e /greenmob. Sem atalho, quem trabalha na
// To Do Green e abria o app pela raiz só voltava ao ERP digitando a URL.
//
// Quem decide o acesso é o servidor (/api/todogreen/access). Aqui a resposta
// só vira destinos; a vertical confere tudo de novo quando a pessoa chega.
import { VERTICAIS } from "./verticalsCatalog.js";

// O mesmo recorte de espaço que a vertical usa ao perguntar o acesso.
export const todoGreenOwnerId = (storage) => {
  try {
    return storage?.getItem("sf-space") || storage?.getItem("sf-active-user") || "";
  } catch {
    return "";
  }
};

// Papéis que não enxergam a vertical (sem "read"): o atalho certo é o próprio
// portal, não o ERP que os recusaria.
export const PORTAL_DO_PAPEL = Object.freeze({
  motorista: Object.freeze({
    id: "portal-motorista",
    name: "Portal do motorista",
    subtitle: "Suas viagens, rotas, entregas e comprovantes",
    route: "/portal-motorista",
  }),
  colaborador: Object.freeze({
    id: "portal-colaborador",
    name: "Portal do colaborador",
    subtitle: "Seus dados, chave PIX, notas e chamados",
    route: "/portal-colaborador",
  }),
});

export const destinosDoAcesso = (payload) => {
  const role = String(payload?.role || "").trim();
  if (!role) return [];
  if (PORTAL_DO_PAPEL[role]) return [PORTAL_DO_PAPEL[role]];
  return VERTICAIS.map(({ id, name, subtitle, route }) => ({ id, name, subtitle, route }));
};

// O caminho inverso: da vertical para o núcleo, onde ficam as ferramentas
// gerais (agentes, wiki, reuniões com transcrição, diagramas, metas…).
export const NUCLEO_ALL_GREEN = Object.freeze({
  id: "allgreen",
  name: "All Green — ferramentas gerais",
  subtitle: "Agentes, wiki, reuniões, diagramas, metas e mais",
  route: "/",
});
