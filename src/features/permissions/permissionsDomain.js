// ===== Permissões por funcionário e área =====
// Camada de lógica pura. Cada colaborador do espaço pode receber permissões
// específicas por área — jurídico, financeiro, RH, comercial, operação, TI,
// diretoria — sem depender de um papel fixo. As permissões vivem no blob do
// workspace em `memberPermissions[memberId] = { keys: {...}, updatedAt }`.
//
// Regras que não se quebram:
// - "Permissão" é chave stringy declarada no CATÁLOGO abaixo. Chave desconhecida
//   é ignorada — não vira botão no painel nem "true" mágico em `hasPermission`.
// - Presets são atalhos: aplicam N chaves de uma vez, mas o painel continua
//   permitindo mexer chave a chave (sem "papel oculto" que a UI não mostre).
// - Removê-las é imediato (`setPermission(..., false)` ou `clearMember`); nunca
//   guardamos um "papel" separado da lista.
// - Regras do AGENTS.md ("todos os papéis acessam TODAS as ferramentas, o
//   controle é sobre os DADOS") continuam válidas: nenhuma permissão ESCONDE
//   tela — o que ela muda é o que o módulo aceita ler/gravar dentro dela.

// ---------- Catálogo ----------

export const PERMISSION_AREAS = Object.freeze([
  { id: "juridico", label: "Jurídico" },
  { id: "financeiro", label: "Financeiro" },
  { id: "rh", label: "Recursos humanos" },
  { id: "comercial", label: "Comercial e Clientes" },
  { id: "operacao", label: "Operação" },
  { id: "ti_dados", label: "TI e Dados" },
  { id: "diretoria", label: "Diretoria" },
]);

// Cada permissão tem `key` estável (usada no banco e em código), rótulo e
// descrição curta que aparece no painel para não deixar dúvida do que libera.
export const AREA_PERMISSION_CATALOG = Object.freeze([
  {
    area: "juridico",
    permissions: [
      { key: "juridico.solicitar", label: "Abrir solicitações", description: "Registrar demanda para o Jurídico e acompanhar as próprias submissões." },
      { key: "juridico.ver_fila", label: "Ver fila do Jurídico", description: "Enxergar a fila completa (demandas, contratos, processos, prazos)." },
      { key: "juridico.gerenciar_demandas", label: "Gerenciar demandas", description: "Editar situação, risco, responsável e escritório externo." },
      { key: "juridico.gerenciar_contratos", label: "Gerenciar contratos", description: "Cadastrar contratos e conduzir o fluxo de aprovação." },
      { key: "juridico.gerenciar_processos", label: "Gerenciar processos", description: "Cadastrar e acompanhar processos judiciais e administrativos." },
      { key: "juridico.aprovar", label: "Aprovar / reprovar", description: "Aprovar minutas e contratos no fluxo do Jurídico (Head)." },
      { key: "juridico.honorarios", label: "Honorários e provisões", description: "Cadastrar e baixar honorários, custas e provisões." },
      { key: "juridico.confidencial", label: "Assuntos confidenciais", description: "Acessar documentos jurídicos confidenciais (nível Diretoria)." },
    ],
  },
  {
    area: "financeiro",
    permissions: [
      { key: "financeiro.ver", label: "Ver Financeiro", description: "Ler caixa, contas a pagar/receber e DRE do mês." },
      { key: "financeiro.lancar", label: "Lançar movimentações", description: "Registrar receitas, despesas e conciliações." },
      { key: "financeiro.aprovar_pagamento", label: "Aprovar pagamento", description: "Autorizar pagamentos e baixa de contas." },
      { key: "financeiro.ver_resultados", label: "Ver indicadores", description: "Acessar resultado do mês, funil e dashboards financeiros." },
    ],
  },
  {
    area: "rh",
    permissions: [
      { key: "rh.ver", label: "Ver dados de RH", description: "Ler cadastros de colaborador (sem CPF/salário)." },
      { key: "rh.sensivel", label: "Dados sensíveis (CPF/salário)", description: "Acessar folha, DP e informações protegidas." },
      { key: "rh.contratar", label: "Contratar / dispensar", description: "Registrar contratações e desligamentos." },
      { key: "rh.gerir_ponto", label: "Gerir ponto e horas", description: "Aprovar apontamentos e escalas." },
    ],
  },
  {
    area: "comercial",
    permissions: [
      { key: "comercial.ver_carteira", label: "Ver carteira", description: "Ver contatos, clientes, pedidos e conversas do time comercial." },
      { key: "comercial.editar_pipeline", label: "Editar pipeline", description: "Alterar oportunidades e etapas do funil de vendas." },
      { key: "comercial.ver_receita", label: "Ver receita", description: "Ver valores fechados e ticket médio." },
      { key: "comercial.aprovar_desconto", label: "Aprovar desconto", description: "Autorizar descontos fora da política." },
    ],
  },
  {
    area: "operacao",
    permissions: [
      { key: "operacao.ver", label: "Ver operação", description: "Ver tarefas, quadros, missões e rota do dia." },
      { key: "operacao.atribuir", label: "Atribuir tarefas", description: "Reatribuir tarefas para outros colaboradores." },
      { key: "operacao.arquivar", label: "Arquivar em lote", description: "Arquivar e mover tarefas em massa." },
    ],
  },
  {
    area: "ti_dados",
    permissions: [
      { key: "ti.integracoes", label: "Gerir integrações", description: "Cadastrar e revogar chaves, webhooks e integrações." },
      { key: "ti.exportar", label: "Exportar dados", description: "Gerar CSV/exports de bases relacionais." },
      { key: "ti.automacoes", label: "Editar automações", description: "Criar e desativar regras da Central de Automações." },
    ],
  },
  {
    area: "diretoria",
    permissions: [
      { key: "diretoria.ver_tudo", label: "Ver todos os módulos", description: "Ler todos os módulos, inclusive confidenciais, sem editar." },
      { key: "diretoria.aprovar_estrategico", label: "Aprovar decisões estratégicas", description: "Aprovar decisões que travam áreas — orçamento, PDV, planos." },
    ],
  },
]);

// Um "índice" para busca rápida por key (a UI usa isso para renderizar o rótulo
// certo mesmo quando a permissão é aplicada por preset).
const KEYS_MAP = (() => {
  const map = new Map();
  for (const area of AREA_PERMISSION_CATALOG) {
    for (const perm of area.permissions) {
      map.set(perm.key, { ...perm, area: area.area });
    }
  }
  return map;
})();

export const isKnownPermission = (key) => KEYS_MAP.has(String(key || ""));
export const permissionInfo = (key) => KEYS_MAP.get(String(key || "")) || null;

// ---------- Presets ----------

// Presets são atalhos curados. NÃO existem como "papéis ocultos": a UI expande
// o preset em chaves individuais que a titular pode desmarcar depois.
export const PERMISSION_PRESETS = Object.freeze([
  {
    key: "solicitante",
    label: "Solicitante (padrão)",
    description: "Abre solicitações para o Jurídico e demais áreas. Sem gerir nada.",
    keys: ["juridico.solicitar"],
  },
  {
    key: "juridico_analista",
    label: "Analista Jurídico",
    description: "Acompanha a fila e gerencia demandas, contratos e processos, sem aprovar.",
    keys: [
      "juridico.solicitar",
      "juridico.ver_fila",
      "juridico.gerenciar_demandas",
      "juridico.gerenciar_contratos",
      "juridico.gerenciar_processos",
      "juridico.honorarios",
    ],
  },
  {
    key: "juridico_head",
    label: "Head Jurídico",
    description: "Todo o Jurídico, inclusive aprovação e assuntos confidenciais.",
    keys: [
      "juridico.solicitar",
      "juridico.ver_fila",
      "juridico.gerenciar_demandas",
      "juridico.gerenciar_contratos",
      "juridico.gerenciar_processos",
      "juridico.aprovar",
      "juridico.honorarios",
      "juridico.confidencial",
    ],
  },
  {
    key: "financeiro_analista",
    label: "Analista Financeiro",
    description: "Ver, lançar e conciliar movimentações.",
    keys: ["financeiro.ver", "financeiro.lancar", "financeiro.ver_resultados"],
  },
  {
    key: "financeiro_head",
    label: "Head Financeiro",
    description: "Financeiro + autorização de pagamento.",
    keys: [
      "financeiro.ver",
      "financeiro.lancar",
      "financeiro.aprovar_pagamento",
      "financeiro.ver_resultados",
      "juridico.honorarios",
    ],
  },
  {
    key: "rh_generico",
    label: "RH — Consulta",
    description: "Ver cadastros de colaborador sem acessar dados sensíveis.",
    keys: ["rh.ver"],
  },
  {
    key: "rh_dp",
    label: "RH / Departamento Pessoal",
    description: "Dados sensíveis, contratação e ponto.",
    keys: ["rh.ver", "rh.sensivel", "rh.contratar", "rh.gerir_ponto"],
  },
  {
    key: "comercial_vendedor",
    label: "Comercial — Vendedor",
    description: "Ver carteira, editar pipeline e ver receita.",
    keys: ["comercial.ver_carteira", "comercial.editar_pipeline", "comercial.ver_receita"],
  },
  {
    key: "comercial_head",
    label: "Head Comercial",
    description: "Tudo do vendedor + aprovar desconto.",
    keys: [
      "comercial.ver_carteira",
      "comercial.editar_pipeline",
      "comercial.ver_receita",
      "comercial.aprovar_desconto",
    ],
  },
  {
    key: "operacao_lider",
    label: "Operação — Líder",
    description: "Ver operação e atribuir tarefas em massa.",
    keys: ["operacao.ver", "operacao.atribuir", "operacao.arquivar"],
  },
  {
    key: "ti_dados",
    label: "TI e Dados",
    description: "Integrações, exportação e automações.",
    keys: ["ti.integracoes", "ti.exportar", "ti.automacoes"],
  },
  {
    key: "diretoria",
    label: "Diretoria",
    description: "Vê todos os módulos e aprova decisões estratégicas.",
    keys: [
      "diretoria.ver_tudo",
      "diretoria.aprovar_estrategico",
      "juridico.ver_fila",
      "juridico.confidencial",
      "financeiro.ver",
      "financeiro.ver_resultados",
    ],
  },
]);

// ---------- Estado por membro ----------

const emptySlot = () => ({ keys: {}, presets: [], updatedAt: new Date().toISOString() });

const asMap = (memberPermissions) => {
  if (!memberPermissions || typeof memberPermissions !== "object") return {};
  return memberPermissions;
};

export const getMemberPermissions = (memberPermissions, memberId) => {
  const map = asMap(memberPermissions);
  const slot = map[memberId];
  return slot && typeof slot === "object" ? slot : emptySlot();
};

// Chave desconhecida sempre retorna `false`, mesmo se alguém gravou `true`
// direto no banco — evita "flags fantasmas" quando a UI não sabe explicar.
export const hasPermission = (memberPermissions, memberId, key) => {
  if (!isKnownPermission(key)) return false;
  const slot = getMemberPermissions(memberPermissions, memberId);
  return Boolean(slot.keys?.[key]);
};

// Retorna todas as chaves ligadas para um membro (somente as conhecidas).
export const listPermissions = (memberPermissions, memberId) => {
  const slot = getMemberPermissions(memberPermissions, memberId);
  return Object.entries(slot.keys || {})
    .filter(([k, v]) => v && isKnownPermission(k))
    .map(([k]) => k);
};

// Atualização imutável: devolve um novo objeto de permissões com a chave
// ativada/desativada. Chave desconhecida é ignorada em silêncio (não vamos
// deixar a UI persistir chave que ninguém explica).
export const setPermission = (memberPermissions, memberId, key, value) => {
  if (!memberId || !isKnownPermission(key)) return asMap(memberPermissions);
  const map = asMap(memberPermissions);
  const current = getMemberPermissions(map, memberId);
  const nextKeys = { ...(current.keys || {}) };
  if (value) nextKeys[key] = true;
  else delete nextKeys[key];
  return {
    ...map,
    [memberId]: {
      ...current,
      keys: nextKeys,
      updatedAt: new Date().toISOString(),
    },
  };
};

// Aplicar um preset EXPANDE as chaves — o que fica registrado no banco são as
// próprias chaves, não o nome do preset (evita "papel oculto"). Guardamos o
// preset em `presets[]` só para a UI mostrar "Aplicado: Head Jurídico" como
// rastro; a fonte da verdade é sempre `keys`.
export const applyPreset = (memberPermissions, memberId, presetKey) => {
  const preset = PERMISSION_PRESETS.find((p) => p.key === presetKey);
  if (!preset || !memberId) return asMap(memberPermissions);
  let next = asMap(memberPermissions);
  for (const key of preset.keys) next = setPermission(next, memberId, key, true);
  const current = getMemberPermissions(next, memberId);
  return {
    ...next,
    [memberId]: {
      ...current,
      presets: [...new Set([...(current.presets || []), preset.key])],
      updatedAt: new Date().toISOString(),
    },
  };
};

export const clearMember = (memberPermissions, memberId) => {
  if (!memberId) return asMap(memberPermissions);
  const map = { ...asMap(memberPermissions) };
  delete map[memberId];
  return map;
};

// ---------- Adaptadores ----------

// Traduz o conjunto de permissões jurídicas em um "papel" para o LegalHub.
// Ordem de precedência: aprovar → head_juridico; ver_fila+gerenciar_*
// → juridico; só solicitar → solicitante; sem permissão → solicitante mesmo
// (todo mundo pode registrar solicitação — regra da titular).
export const permissionsToLegalRole = (memberPermissions, memberId) => {
  if (!memberId) return "solicitante";
  const has = (key) => hasPermission(memberPermissions, memberId, key);
  if (has("juridico.aprovar") || has("diretoria.ver_tudo")) return "head_juridico";
  if (
    has("juridico.ver_fila") ||
    has("juridico.gerenciar_demandas") ||
    has("juridico.gerenciar_contratos") ||
    has("juridico.gerenciar_processos")
  )
    return "juridico";
  return "solicitante";
};

// Devolve o número de chaves ativas por área — útil para renderizar chips
// resumo "3 permissões no Jurídico · 1 no Financeiro" no painel.
export const summarizeByArea = (memberPermissions, memberId) => {
  const keys = listPermissions(memberPermissions, memberId);
  const summary = {};
  for (const key of keys) {
    const area = permissionInfo(key)?.area || "outro";
    summary[area] = (summary[area] || 0) + 1;
  }
  return summary;
};

// ---------- Estatística agregada ----------

// Conta quantos membros têm cada permissão — usado no painel para o operador
// entender rapidamente se alguma área ficou sem gente.
export const permissionCoverage = (memberPermissions) => {
  const counts = {};
  for (const slot of Object.values(asMap(memberPermissions))) {
    for (const [key, value] of Object.entries(slot?.keys || {})) {
      if (!value || !isKnownPermission(key)) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
};
