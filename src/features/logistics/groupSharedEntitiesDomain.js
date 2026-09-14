// ===== Core All Green · Entidades compartilhadas do Grupo (P0) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A titular disse: "hoje a arquitetura ainda gira em torno da vertical To Do
// Green". Este módulo faz o oposto — modela veículo, motorista, energia,
// carregador e pagamento como registros do GRUPO, e cada negócio (TDG, Green
// On, Greenmob) enxerga a mesma coisa por uma VIEW.
//
// Regra 1 · propriedade única: cada entidade tem UM `groupId` e UM `ownerBu`
// (unidade de negócio dona do cadastro). Isso é o que impede a duplicação
// que a titular pediu para evitar.
//
// Regra 2 · exposição por CONTRATO: um veículo pode estar EXPOSTO ao To Do
// Green (para operar entrega), à Greenmob (para locar), e ao Green On (como
// consumidor de energia). Cada exposição registra INÍCIO, FIM e ESCOPO — o
// que aquele negócio pode ver e fazer com o registro.
//
// Regra 3 · vista projetada: o negócio nunca lê o registro cru. Lê pela
// `projectFor(entity, bu)` que aplica o escopo e RETIRA campos que aquela
// visão não pode ver (custo interno para o Portal do Cliente; dado pessoal
// do motorista para outra base). Sem isso, o compartilhamento vira vazamento.

const now = () => new Date().toISOString();

export const BUSINESS_UNITS = Object.freeze(["todogreen", "greenon", "greenmob"]);
export const ENTITY_TYPES = Object.freeze([
  "vehicle", "driver", "charger", "energyPoint", "paymentAccount",
]);
export const EXPOSURE_SCOPES = Object.freeze(["operate", "rent", "consume", "view"]);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// A ID do grupo é o primeiro campo verificado em toda leitura. Sem groupId,
// a entidade não é do grupo — é um esqueleto e nenhuma view a devolve.
export const requireGroupId = (entity) => {
  if (!entity?.groupId) throw new Error("Entidade sem groupId — Core All Green exige registro no grupo.");
  return entity.groupId;
};

// Cria uma entidade compartilhada. `ownerBu` é quem cadastrou; `exposedTo`
// nasce vazia — a exposição é ato explícito da tela de gestão.
export const createSharedEntity = (bruto = {}) => {
  const type = ENTITY_TYPES.includes(bruto.type) ? bruto.type : null;
  if (!type) throw new Error(`Tipo desconhecido: ${bruto.type}`);
  const ownerBu = BUSINESS_UNITS.includes(bruto.ownerBu) ? bruto.ownerBu : null;
  if (!ownerBu) throw new Error(`ownerBu obrigatório e válido: ${bruto.ownerBu}`);
  return {
    id: String(bruto.id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    groupId: String(bruto.groupId || "grupo-all-green"),
    ownerBu,
    type,
    data: bruto.data || {},
    exposures: Array.isArray(bruto.exposures) ? bruto.exposures.slice() : [],
    createdAt: bruto.createdAt || now(),
    updatedAt: bruto.updatedAt || now(),
  };
};

// Expõe a entidade a outra unidade de negócio. Um veículo do TDG pode ser
// exposto à Greenmob como "rent" e ao Green On como "consume". A mesma
// entidade nunca duplica no banco — é uma linha só.
export const exposeToBusiness = (entity, { bu, scope, startYmd, endYmd, restrictions }) => {
  if (!entity) throw new Error("Entidade nula.");
  if (!BUSINESS_UNITS.includes(bu)) throw new Error(`bu inválido: ${bu}`);
  if (!EXPOSURE_SCOPES.includes(scope)) throw new Error(`scope inválido: ${scope}`);
  const exposure = {
    bu,
    scope,
    startYmd: String(startYmd || now().slice(0, 10)),
    endYmd: endYmd ? String(endYmd) : null,
    restrictions: Array.isArray(restrictions) ? restrictions : [],
    createdAt: now(),
  };
  return {
    ...entity,
    exposures: [...(entity.exposures || []), exposure],
    updatedAt: now(),
  };
};

// Encerra a exposição a uma BU (o veículo saiu da locação, o motorista saiu
// da base). Mantém histórico — nunca apaga a linha.
export const closeExposure = (entity, bu, { endYmd } = {}) => {
  const ymd = endYmd || now().slice(0, 10);
  const exposures = (entity.exposures || []).map((e) =>
    e.bu === bu && !e.endYmd ? { ...e, endYmd: ymd, closedAt: now() } : e,
  );
  return { ...entity, exposures, updatedAt: now() };
};

// Verifica se, hoje, a entidade está exposta àquela BU no escopo pedido.
// Uma exposição vencida (endYmd < hoje) NÃO conta — o compartilhamento tem prazo.
export const isExposedTo = (entity, bu, scope, hojeYmd) => {
  const hoje = String(hojeYmd || now().slice(0, 10));
  return (entity?.exposures || []).some((e) => {
    if (e.bu !== bu) return false;
    if (scope && e.scope !== scope) return false;
    if (e.startYmd && hoje < e.startYmd) return false;
    if (e.endYmd && hoje > e.endYmd) return false;
    return true;
  });
};

// Filtro por BU: SÓ o que aquela BU pode ver hoje. É o único caminho que o
// UI de cada negócio deveria usar para listar entidades do Grupo.
export const listForBusiness = (entities = [], bu, scope, hojeYmd) => {
  if (!BUSINESS_UNITS.includes(bu)) return [];
  return (Array.isArray(entities) ? entities : []).filter((e) => isExposedTo(e, bu, scope, hojeYmd));
};

// Projeção: cada BU vê o registro FILTRADO por restrictions. O Portal do
// Cliente NUNCA vê custo interno; o outro locatário NUNCA vê dado pessoal
// do motorista. As restrictions listam OS CAMPOS proibidos naquela exposição.
export const projectFor = (entity, bu) => {
  if (!entity) return null;
  const exposicao = (entity.exposures || []).find((e) => e.bu === bu);
  if (!exposicao) return null;
  const proibidos = new Set(exposicao.restrictions || []);
  const data = { ...(entity.data || {}) };
  for (const campo of proibidos) delete data[campo];
  // Sempre expor a IDENTIDADE base e a exposição atual, para a tela dizer
  // "esse veículo é do Grupo e está locado para você desde X".
  return {
    id: entity.id,
    groupId: entity.groupId,
    type: entity.type,
    ownerBu: entity.ownerBu,
    exposureScope: exposicao.scope,
    exposureStart: exposicao.startYmd,
    exposureEnd: exposicao.endYmd,
    data,
  };
};

// Consolida uso da entidade entre as BUs — a mesma linha do veículo mostra
// "TDG rodou 4200 km, Greenmob locou 15 dias, Green On registrou 12 sessões".
// É o número que finalmente prova o valor da arquitetura compartilhada.
export const consolidatedUsage = (entity, movements = []) => {
  const porBu = new Map();
  for (const m of movements) {
    if (!m || m.entityId !== entity.id) continue;
    const bu = m.bu;
    if (!BUSINESS_UNITS.includes(bu)) continue;
    const cur = porBu.get(bu) || { bu, km: 0, kwh: 0, sessoes: 0, receitaReais: 0, custoReais: 0, dias: 0 };
    cur.km += num(m.km);
    cur.kwh += num(m.kwh);
    cur.sessoes += num(m.sessoes);
    cur.receitaReais += num(m.receitaReais);
    cur.custoReais += num(m.custoReais);
    cur.dias += num(m.dias);
    porBu.set(bu, cur);
  }
  return Array.from(porBu.values()).sort((a, b) => (b.receitaReais - b.custoReais) - (a.receitaReais - a.custoReais));
};

// Guarda contra registro duplicado: se um "veículo" foi cadastrado direto
// no TDG e outro na Greenmob com a mesma placa, o motor deveria ter usado
// a mesma linha. Este helper acha conflitos por identidade natural.
export const findDuplicates = (entities = []) => {
  const porChave = new Map();
  const dupes = [];
  for (const e of entities) {
    const key = naturalKey(e);
    if (!key) continue;
    if (!porChave.has(key)) porChave.set(key, []);
    porChave.get(key).push(e);
  }
  for (const [key, list] of porChave) {
    if (list.length > 1) dupes.push({ key, entities: list });
  }
  return dupes;
};

const naturalKey = (e) => {
  if (!e?.type || !e?.data) return null;
  const t = e.type;
  if (t === "vehicle") return e.data.placa ? `vehicle:${String(e.data.placa).toUpperCase().replace(/\s+/g, "")}` : null;
  if (t === "driver") return e.data.cpf ? `driver:${String(e.data.cpf).replace(/\D/g, "")}` : null;
  if (t === "charger") return e.data.serial ? `charger:${String(e.data.serial).toUpperCase()}` : null;
  if (t === "energyPoint") return e.data.medidor ? `energy:${String(e.data.medidor).toUpperCase()}` : null;
  if (t === "paymentAccount") return e.data.chavePix ? `pay:${String(e.data.chavePix).toLowerCase()}` : null;
  return null;
};

// Métricas do painel Core: quantidade por tipo, quantidade compartilhada
// (exposta a mais de uma BU), e quantas exposições vencidas ainda no ar.
export const groupMetrics = (entities = [], hojeYmd) => {
  const hoje = String(hojeYmd || now().slice(0, 10));
  const porTipo = new Map(ENTITY_TYPES.map((t) => [t, { type: t, total: 0, compartilhados: 0 }]));
  let expostosVencidos = 0;
  for (const e of entities) {
    const item = porTipo.get(e.type);
    if (!item) continue;
    item.total += 1;
    const busVivos = new Set(
      (e.exposures || [])
        .filter((x) => (!x.endYmd || hoje <= x.endYmd) && (!x.startYmd || hoje >= x.startYmd))
        .map((x) => x.bu),
    );
    if (busVivos.size >= 2) item.compartilhados += 1;
    expostosVencidos += (e.exposures || []).filter((x) => x.endYmd && hoje > x.endYmd).length;
  }
  return {
    tipos: Array.from(porTipo.values()),
    expostosVencidos,
    total: entities.length,
  };
};
