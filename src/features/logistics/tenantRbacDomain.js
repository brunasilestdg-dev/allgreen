// ===== Core All Green · Tenant + RBAC (bloco 01/24 · isolamento e permissão) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A plataforma é UMA base para os três negócios do grupo — To Do Green, Green On
// e Greenmob. O compartilhamento de veículo/motorista/energia entre eles é o que
// justifica a arquitetura; o que impede o compartilhamento virar vazamento é a
// combinação de duas coisas: TENANT (a qual empresa aquele dado pertence) e
// RBAC (o que aquele papel pode fazer sobre aquele dado). Este módulo é o
// predicado único — não é uma consulta a mais, é a consulta que TODA leitura e
// escrita atravessa antes de virar SQL.
//
// Princípio: perfis diferentes por tipo de usuário; cliente NUNCA vê custos
// internos; locatário NUNCA vê dados de outro locatário; motorista tem os dados
// pessoais dele protegidos. A lista de capacidades ABAIXO é exaustiva — o que
// não está aqui não existe. E o que é INTERNAL_ONLY jamais pode aparecer em
// papel externo, ponto (teste garante).

// Papéis internos da plataforma (opera o negócio).
export const INTERNAL_ROLES = Object.freeze([
  "plataforma_admin",   // dono da plataforma (grupo All Green)
  "tenant_admin",       // dono de uma empresa/tenant (ex.: dono do CD, gerente da base)
  "gestor_operacao",    // torre de controle, operação
  "gestor_frota",       // frota, manutenção, energia
  "gestor_financeiro",  // financeiro, GreenPay, faturamento
  "esg_analista",       // relatórios, fechamento ESG
  "motorista",          // acesso operacional próprio + app do motorista
]);

// Papéis externos: usuários que enxergam SOMENTE o próprio escopo.
export const EXTERNAL_ROLES = Object.freeze([
  "cliente_admin",   // Portal do Cliente — dono da conta cliente
  "cliente_gestor",  // Portal do Cliente — gestor
  "cliente_leitor",  // Portal do Cliente — leitor
  "locatario_admin", // Greenmob — dono do contrato
  "locatario_gestor",// Greenmob — gestor operacional
  "greenon_b2c",     // Green On App B2C — usuário pessoal
  "greenon_b2b",     // Green On App B2B — usuário corporativo (via conta)
]);

export const ALL_ROLES = Object.freeze([...INTERNAL_ROLES, ...EXTERNAL_ROLES]);

// Capacidades por papel. Ausência = negado. O que não está listado NÃO existe.
export const ROLE_PERMISSIONS = Object.freeze({
  plataforma_admin: [
    "tenant:manage", "tenant:read",
    "user:manage", "role:manage",
    "audit:read", "audit:manage",
    "fleet:read", "fleet:write",
    "driver:read", "driver:write",
    "operation:read", "operation:write",
    "charging:read", "charging:write",
    "energy:read", "energy:write",
    "finance:read", "finance:write",
    "esg:read", "esg:write",
    "portal:read", "portal:write",
    "rental:read", "rental:write",
    "billing:read", "billing:write",
    "ai:use", "ai:manage",
  ],
  tenant_admin: [
    "tenant:read",
    "user:manage", "role:manage",
    "audit:read",
    "fleet:read", "fleet:write",
    "driver:read", "driver:write",
    "operation:read", "operation:write",
    "charging:read", "charging:write",
    "energy:read", "energy:write",
    "finance:read", "finance:write",
    "esg:read", "esg:write",
    "portal:read", "portal:write",
    "rental:read", "rental:write",
    "billing:read",
    "ai:use",
  ],
  gestor_operacao: [
    "fleet:read",
    "driver:read",
    "operation:read", "operation:write",
    "charging:read",
    "esg:read",
    "audit:read",
    "ai:use",
  ],
  gestor_frota: [
    "fleet:read", "fleet:write",
    "driver:read",
    "operation:read",
    "charging:read", "charging:write",
    "energy:read", "energy:write",
    "audit:read",
    "ai:use",
  ],
  gestor_financeiro: [
    "finance:read", "finance:write",
    "operation:read",
    "portal:read",
    "billing:read", "billing:write",
    "audit:read",
    "ai:use",
  ],
  esg_analista: [
    "esg:read", "esg:write",
    "operation:read",
    "energy:read",
    "audit:read",
  ],
  motorista: [
    // O motorista SÓ acessa a operação do turno dele e o próprio ganho.
    // Nunca custo, nunca outro motorista, nunca cliente. O predicado
    // driverCan(...) reforça isso além do papel.
    "driver:self", "operation:self", "greenpay:self",
  ],
  cliente_admin: [
    "portal:read", "portal:document:download", "portal:request:create",
    "portal:report:export", "portal:user:manage",
  ],
  cliente_gestor: [
    "portal:read", "portal:document:download", "portal:request:create",
    "portal:report:export",
  ],
  cliente_leitor: ["portal:read"],
  locatario_admin: [
    "rental:self:read", "rental:self:write", "portal:document:download",
  ],
  locatario_gestor: [
    "rental:self:read", "portal:document:download",
  ],
  greenon_b2c: ["charging:self", "greenpay:self"],
  greenon_b2b: ["charging:self", "corporate:read"],
});

// Capacidades INTERNAS que jamais podem aparecer em papel externo (cliente,
// locatário, greenon). O teste percorre EXTERNAL_ROLES e explode se alguém
// acrescentar uma delas por acidente.
export const INTERNAL_ONLY_PERMISSIONS = Object.freeze([
  "fleet:write", "driver:write", "driver:read",
  "operation:write", "operation:read",
  "charging:write",
  "energy:read", "energy:write",
  "finance:read", "finance:write",
  "esg:write",
  "tenant:manage", "user:manage", "role:manage",
  "audit:read", "audit:manage",
  "billing:write",
]);

export const isInternalRole = (role) => INTERNAL_ROLES.includes(role);
export const isExternalRole = (role) => EXTERNAL_ROLES.includes(role);
export const normalizeRole = (role) => (ALL_ROLES.includes(role) ? role : null);

export const permissionsFor = (role) => {
  const r = normalizeRole(role);
  return r ? ROLE_PERMISSIONS[r] || [] : [];
};

// Predicado único de autorização. `session` = { role, tenantId, userId, ... }.
export const can = (session, permission) => {
  if (!session || session.status === "inactive") return false;
  return permissionsFor(session.role).includes(permission);
};

// Regra do motorista: além do papel, o dado tem que ser do próprio userId.
// Um motorista com "operation:self" não pode ler a operação de outro.
export const driverCan = (session, permission, record) => {
  if (!can(session, permission)) return false;
  if (!permission.endsWith(":self")) return true;
  const ownerId = record?.driverId || record?.userId || record?.ownerId;
  return !!ownerId && ownerId === session.userId;
};

// Locatário só vê o próprio contrato/veículo — isolamento por rentalId/tenantId.
export const tenantCan = (session, permission, record) => {
  if (!can(session, permission)) return false;
  if (!permission.startsWith("rental:self")) return true;
  if (!record) return false;
  if (record.tenantId && session.tenantId && record.tenantId !== session.tenantId) return false;
  const contractOwner = record.locatarioId || record.tenantAccountId;
  return !contractOwner || contractOwner === session.tenantAccountId;
};

// Escopo para toda leitura: tenant OBRIGATÓRIO. Sem tenantId, a consulta é
// recusada — falha alto para virar bug em desenvolvimento em vez de vazamento.
export const scopedRead = (session, extra = "") => {
  if (!session?.tenantId) throw new Error("Consulta sem tenant na sessão.");
  const base = "tenant_id = ?";
  return {
    sql: extra ? `${base} AND ${extra}` : base,
    params: [session.tenantId],
  };
};

// Filtro por atributo (o mesmo veículo pode aparecer para todos os três negócios
// do grupo; a "empresa" que enxerga é decidida pela sessão). Nunca aceitar
// `?tenant=X` — o tenant vem da sessão, não da requisição, pelo mesmo motivo do
// Portal do Cliente (customerPortalDomain).
export const filterByTenant = (records, session) => {
  if (!Array.isArray(records)) return [];
  if (!session?.tenantId) return [];
  return records.filter((r) => !r?.tenantId || r.tenantId === session.tenantId);
};

// Ofusca dados pessoais do motorista para leitores que não têm "driver:read":
// nome fica só o primeiro, CPF vira ***, telefone e e-mail cortados. NÃO é
// criptografia; é o que aparece na tela para papéis que NÃO deveriam ver a
// pessoa. O papel de "motorista" recebe os próprios dados sem ofuscar.
export const maskDriverPii = (driver, session) => {
  if (!driver) return driver;
  const own = session?.userId && (driver.id === session.userId || driver.userId === session.userId);
  if (own || can(session, "driver:read")) return driver;
  const nome = String(driver.nome || driver.name || "").trim().split(/\s+/)[0] || "";
  const mask = (v, keep = 0) => {
    const s = String(v || "");
    if (!s) return "";
    return s.slice(0, keep) + "•".repeat(Math.max(0, s.length - keep));
  };
  return {
    ...driver,
    nome,
    name: nome,
    cpf: driver.cpf ? mask(driver.cpf, 3) : "",
    telefone: driver.telefone ? mask(driver.telefone, 2) : "",
    email: driver.email ? driver.email.replace(/(.{1}).*(@.*)/, "$1•••$2") : "",
  };
};
