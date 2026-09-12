// ===== Portal do Cliente: regras de isolamento =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A regra que sustenta o portal inteiro: o cliente de uma sessão é decidido
// pelo vínculo gravado no banco, nunca por algo que veio na requisição. Um
// portal que aceita "?cliente=X" é um portal onde trocar X vaza o concorrente.

export const CLIENT_PORTAL_ROLES = [
  "cliente_admin",
  "cliente_gestor",
  "cliente_leitor",
];

// O que cada papel do lado do cliente pode fazer. Nenhum deles enxerga CRM,
// financeiro interno, comissões, pipeline ou operação de terceiros — essas
// capacidades simplesmente não existem neste conjunto.
export const CLIENT_PORTAL_PERMISSIONS = {
  cliente_admin: [
    "portal:read",
    "portal:document:download",
    "portal:request:create",
    "portal:report:export",
    "portal:user:manage",
  ],
  cliente_gestor: [
    "portal:read",
    "portal:document:download",
    "portal:request:create",
    "portal:report:export",
  ],
  cliente_leitor: ["portal:read"],
};

// Capacidades internas que jamais podem aparecer para o lado do cliente.
// A lista existe para ser testada: se alguém acrescentar uma delas a um papel
// de cliente, o teste quebra antes de virar vazamento.
export const INTERNAL_ONLY_PERMISSIONS = [
  "crm:view",
  "opportunity:manage",
  "pricing:simulate",
  "pricing:manage",
  "deal:review",
  "deal:approve",
  "proposal:create",
  "revenue:manage",
  "cost:manage",
  "commission:manage",
  "access:manage",
  "audit:read",
];

export const normalizeEmail = (value) =>
  String(value ?? "").trim().toLowerCase().slice(0, 200);

export const isValidEmail = (value) => {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
};

export const clientPortalRole = (value) =>
  CLIENT_PORTAL_ROLES.includes(value) ? value : "cliente_leitor";

export const permissionsForRole = (role) =>
  CLIENT_PORTAL_PERMISSIONS[clientPortalRole(role)] || CLIENT_PORTAL_PERMISSIONS.cliente_leitor;

export const clientCan = (access, permission) => {
  if (!access || access.status !== "active") return false;
  const granted = Array.isArray(access.permissions) ? access.permissions : [];
  return granted.includes(permission);
};

// O coração do isolamento.
//
// Recebe o vínculo encontrado para o e-mail da sessão e devolve o escopo. Se
// não há vínculo ativo, devolve null — e quem chama não tem cliente nenhum
// para consultar, então não existe consulta a fazer.
//
// Repare que não há parâmetro para "cliente pedido": não dá para pedir outro.
export const resolveClientScope = (vinculo) => {
  if (!vinculo) return null;
  if (vinculo.status !== "active") return null;
  if (!vinculo.client_id && !vinculo.clientId) return null;
  if (vinculo.client_status && vinculo.client_status !== "ativo") return null;
  if (vinculo.portal_enabled === 0 || vinculo.portalEnabled === false) return null;
  const role = clientPortalRole(vinculo.role);
  return {
    tenantId: vinculo.tenant_id || vinculo.tenantId || "todogreen",
    clientId: vinculo.client_id || vinculo.clientId,
    clientName: vinculo.client_name || vinculo.clientName || "",
    workspaceOwnerId: vinculo.workspace_owner_id || vinculo.workspaceOwnerId || "",
    email: normalizeEmail(vinculo.email),
    role,
    permissions: permissionsForRole(role),
    status: "active",
  };
};

// Toda consulta do portal passa por aqui antes de virar SQL. Se o chamador
// esqueceu de amarrar o cliente, o erro estoura no desenvolvimento em vez de
// virar vazamento silencioso em produção.
export const scopedWhere = (escopo, extra = "") => {
  if (!escopo?.clientId || !escopo?.tenantId || !escopo?.workspaceOwnerId)
    throw new Error("Consulta do portal sem cliente na sessão.");
  const base = "tenant_id = ? AND workspace_owner_id = ? AND client_id = ?";
  return {
    sql: extra ? `${base} AND ${extra}` : base,
    params: [escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId],
  };
};

// Os itens do menu do portal. Nada aqui abre tela interna: são os assuntos do
// próprio cliente, com a linguagem dele.
export const CLIENT_PORTAL_MENU = [
  { id: "inicio", label: "Início", permission: "portal:read" },
  { id: "operacoes", label: "Operações", permission: "portal:read" },
  { id: "green-score", label: "Green Score", permission: "portal:read" },
  { id: "esg", label: "Emissões e impacto ambiental", permission: "portal:read" },
  // Simulação da eletrificação da própria operação: só cálculo, no navegador do
  // cliente, com referências que ele ajusta. Nenhum dado interno passa por aqui.
  { id: "planejar", label: "Planejar", permission: "portal:read" },
  { id: "relatorios", label: "Relatórios", permission: "portal:report:export" },
  // Fatura é assunto do próprio cliente: o que ele deve, quando vence e a
  // 2ª via do documento. Nada do financeiro INTERNO (margem, custo, comissão)
  // passa por aqui — o endpoint só lê títulos do cliente da sessão.
  { id: "financeiro", label: "Faturas", permission: "portal:document:download" },
  { id: "documentos", label: "Documentos", permission: "portal:document:download" },
  { id: "solicitacoes", label: "Solicitações", permission: "portal:request:create" },
  { id: "assistente", label: "Assistente", permission: "portal:read" },
];

export const menuForAccess = (access) =>
  CLIENT_PORTAL_MENU.filter((item) => clientCan(access, item.permission));
