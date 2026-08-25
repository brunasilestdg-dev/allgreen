// ===== Cadastros de base do ERP: as regras, sem React e sem banco =====
//
// Tudo aqui é função pura sobre dado simples, para poder ser testada sem subir
// Worker nem renderizar tela. O que mora neste arquivo é o que precisa dar a
// MESMA resposta no navegador e no servidor: normalizar um SKU, decidir se um
// CNPJ é válido, formatar o número de um documento. Uma segunda cópia de
// qualquer uma dessas regras é uma divergência esperando para aparecer.

const texto = (valor) => String(valor ?? "").trim();
const digitos = (valor) => texto(valor).replace(/\D+/g, "");

// ---------------------------------------------------------------------------
// SKU
// ---------------------------------------------------------------------------

// Maiúsculas, sem espaço interno e sem pontuação decorativa. O código do item é
// usado para casar planilha de fornecedor com cadastro, e " pn-100 " x "PN100"
// x "pn.100" seriam três itens diferentes num inventário que deveria ter um.
export const normalizeSku = (valor) =>
  texto(valor).toUpperCase().replace(/[^A-Z0-9._-]+/g, "").slice(0, 40);

// ---------------------------------------------------------------------------
// Unidade de medida
// ---------------------------------------------------------------------------

// Lista curta e fechada de propósito: unidade livre transforma soma de estoque
// em soma de coisas diferentes ("cx" + "CX" + "caixa" = três saldos).
export const UNITS = Object.freeze([
  { code: "UN", name: "Unidade" },
  { code: "PC", name: "Peça" },
  { code: "CX", name: "Caixa" },
  { code: "KG", name: "Quilograma" },
  { code: "G", name: "Grama" },
  { code: "TON", name: "Tonelada" },
  { code: "L", name: "Litro" },
  { code: "ML", name: "Mililitro" },
  { code: "M", name: "Metro" },
  { code: "M2", name: "Metro quadrado" },
  { code: "M3", name: "Metro cúbico" },
  { code: "KM", name: "Quilômetro" },
  { code: "H", name: "Hora" },
  { code: "PAR", name: "Par" },
  { code: "KWH", name: "Quilowatt-hora" },
]);

const UNIT_CODES = new Set(UNITS.map((item) => item.code));

const UNIT_ALIASES = Object.freeze({
  UNID: "UN", UNIDADE: "UN", PECA: "PC", PEÇA: "PC", CAIXA: "CX",
  QUILO: "KG", QUILOGRAMA: "KG", KILO: "KG", GRAMA: "G", TONELADA: "TON", T: "TON",
  LITRO: "L", LT: "L", MILILITRO: "ML", METRO: "M", MT: "M",
  HORA: "H", HR: "H", "KW/H": "KWH", KWHORA: "KWH",
});

// Devolve "" quando não reconhece, em vez de inventar "UN": um item sem unidade
// declarada é um problema de cadastro que precisa aparecer, não ser silenciado
// com um palpite que depois soma errado.
export const normalizeUnit = (valor) => {
  const bruto = texto(valor).toUpperCase().replace(/\s+/g, "");
  if (!bruto) return "";
  if (UNIT_CODES.has(bruto)) return bruto;
  return UNIT_ALIASES[bruto] || "";
};

// ---------------------------------------------------------------------------
// CNPJ e CPF
// ---------------------------------------------------------------------------

// Guardamos e comparamos só dígitos. Duas grafias do mesmo CNPJ
// ("12.345.678/0001-95" e "12345678000195") viram dois fornecedores se a
// pontuação entrar no banco.
export const normalizeDocument = (valor) => digitos(valor).slice(0, 14);

export const documentKind = (valor) => {
  const limpo = normalizeDocument(valor);
  if (limpo.length === 14) return "cnpj";
  if (limpo.length === 11) return "cpf";
  return "";
};

// Dígito verificador por módulo 11, com os pesos de cada documento.
const checkDigit = (base, pesos) => {
  const soma = pesos.reduce((total, peso, indice) => total + peso * Number(base[indice]), 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
};

const repetido = (valor) => /^(\d)\1+$/.test(valor);

export const isValidCnpj = (valor) => {
  const n = normalizeDocument(valor);
  // Repetido passa na conta do módulo 11 (11111111111111 fecha), então tem de
  // ser recusado antes — é o CNPJ de teste que mais aparece em planilha real.
  if (n.length !== 14 || repetido(n)) return false;
  const d1 = checkDigit(n, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(n, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(n[12]) && d2 === Number(n[13]);
};

export const isValidCpf = (valor) => {
  const n = normalizeDocument(valor);
  if (n.length !== 11 || repetido(n)) return false;
  const d1 = checkDigit(n, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(n, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(n[9]) && d2 === Number(n[10]);
};

export const isValidDocument = (valor) => {
  const tipo = documentKind(valor);
  if (tipo === "cnpj") return isValidCnpj(valor);
  if (tipo === "cpf") return isValidCpf(valor);
  return false;
};

// Só para exibir. O banco continua guardando dígitos.
export const formatDocument = (valor) => {
  const n = normalizeDocument(valor);
  if (n.length === 14) return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (n.length === 11) return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return n;
};

// ---------------------------------------------------------------------------
// Papéis da parte (cliente ≡ fornecedor ≡ transportadora)
// ---------------------------------------------------------------------------

export const PARTY_ROLES = Object.freeze([
  { id: "cliente", name: "Cliente" },
  { id: "fornecedor", name: "Fornecedor" },
  { id: "transportador", name: "Transportadora" },
  { id: "prestador", name: "Prestador de serviço" },
  { id: "colaborador", name: "Colaborador" },
]);

const PARTY_ROLE_IDS = new Set(PARTY_ROLES.map((item) => item.id));

// Recusa papel desconhecido em vez de guardá-lo: a lista é o que a tela filtra,
// e um valor fora dela sumiria de todos os filtros sem erro nenhum.
export const normalizePartyRoles = (valor) => {
  const lista = Array.isArray(valor) ? valor : [valor];
  return [...new Set(lista.map((item) => texto(item).toLowerCase()).filter((item) => PARTY_ROLE_IDS.has(item)))];
};

export const partyHasRole = (party, role) => normalizePartyRoles(party?.roles).includes(texto(role).toLowerCase());

// ---------------------------------------------------------------------------
// Numeração de documentos
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPES = Object.freeze([
  { id: "requisicao", name: "Requisição de compra", prefix: "RC" },
  { id: "pedido_compra", name: "Pedido de compra", prefix: "PC" },
  { id: "recebimento", name: "Recebimento", prefix: "RE" },
  { id: "ordem_servico", name: "Ordem de serviço", prefix: "OS" },
  { id: "nota_fiscal", name: "Nota fiscal", prefix: "NF" },
  { id: "titulo", name: "Título financeiro", prefix: "TT" },
  { id: "inventario", name: "Inventário", prefix: "IN" },
]);

const DOCUMENT_TYPE_IDS = new Set(DOCUMENT_TYPES.map((item) => item.id));

export const isDocumentType = (valor) => DOCUMENT_TYPE_IDS.has(texto(valor));

export const defaultPrefixFor = (docType) =>
  DOCUMENT_TYPES.find((item) => item.id === texto(docType))?.prefix || "";

// Formata o número já reservado. Quem reserva é o servidor, com UPDATE atômico;
// esta função só monta o rótulo, e por isso pode viver no navegador.
export const formatDocumentNumber = ({ prefix = "", series = "", number = 0, padding = 6 } = {}) => {
  const n = Math.max(0, Math.trunc(Number(number) || 0));
  // `padding` só cai no padrão quando não foi informado. `|| 6` trataria 0 como
  // ausente e transformaria "sem zeros à esquerda" em seis zeros — é a mesma
  // armadilha de fallback por valor falsy que já zerou os pesos das metas.
  const informado = padding === null || padding === undefined || padding === "" ? 6 : Number(padding);
  const casas = Number.isFinite(informado) ? Math.min(12, Math.max(1, Math.trunc(informado))) : 6;
  const corpo = String(n).padStart(casas, "0");
  const serie = texto(series);
  const pre = texto(prefix);
  return [pre, serie, corpo].filter(Boolean).join("-");
};

// ---------------------------------------------------------------------------
// Hierarquia de plano de contas e centro de custo
// ---------------------------------------------------------------------------

// Uma árvore só, usada pelas duas coleções — elas têm a mesma forma
// (código, nome, pai) e duas implementações divergiriam na primeira correção.
// Nó cujo pai não existe sobe para a raiz em vez de desaparecer: um cadastro
// órfão precisa ficar visível para ser consertado.
export const buildCodeTree = (nodes = []) => {
  const validos = nodes.filter((item) => item && item.id);
  const ids = new Set(validos.map((item) => item.id));
  const filhos = new Map();
  for (const node of validos) {
    const pai = ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : "";
    if (!filhos.has(pai)) filhos.set(pai, []);
    filhos.get(pai).push(node);
  }
  const ordenar = (lista) =>
    [...lista].sort((a, b) =>
      texto(a.code).localeCompare(texto(b.code), "pt-BR", { numeric: true }) ||
      texto(a.name).localeCompare(texto(b.name), "pt-BR"));

  const montar = (paiId, nivel, vistos) =>
    ordenar(filhos.get(paiId) || []).flatMap((node) => {
      // Um pai que aponta para um descendente faria a recursão não terminar.
      if (vistos.has(node.id)) return [];
      const proximos = new Set(vistos).add(node.id);
      return [{ ...node, nivel }, ...montar(node.id, nivel + 1, proximos)];
    });

  return montar("", 0, new Set());
};

// Lançamento só entra em conta analítica (folha). Aceitar em conta sintética faz
// o total somar duas vezes: uma no filho e outra no pai que agrupa.
export const accountAcceptsPosting = (account, accounts = []) => {
  if (!account?.id) return false;
  if (account.analytical === false) return false;
  return !accounts.some((item) => item?.parentId === account.id && !item.archivedAt);
};

// ---------------------------------------------------------------------------
// Validação de cadastro
// ---------------------------------------------------------------------------

// Devolvem "" quando está tudo certo, e a frase do problema quando não. É o
// mesmo contrato do `exigido` das coleções do worker
// (todogreen-vertical-records.js), para o handler poder usar sem adaptador.
export const validateItem = (item = {}) => {
  if (!texto(item.name)) return "Informe o nome do material.";
  if (!normalizeUnit(item.unit)) return "Escolha uma unidade de medida válida.";
  const ncm = digitos(item.ncm);
  if (ncm && ncm.length !== 8) return "O NCM tem 8 dígitos.";
  if (Number(item.standardCost) < 0) return "O custo de referência não pode ser negativo.";
  if (Number(item.minStock) < 0) return "O estoque mínimo não pode ser negativo.";
  return "";
};

export const validateParty = (party = {}) => {
  if (!texto(party.legalName)) return "Informe a razão social.";
  if (!normalizePartyRoles(party.roles).length) return "Escolha ao menos um papel (cliente, fornecedor...).";
  const doc = normalizeDocument(party.document);
  // Documento é opcional — parte estrangeira e produtor rural sem inscrição
  // existem. Mas documento PREENCHIDO e inválido é erro de digitação, e deixar
  // passar quebra o casamento por CNPJ que a integração com o TMS depende.
  if (doc && !isValidDocument(doc)) return "CNPJ ou CPF inválido.";
  if (Number(party.paymentTermDays) < 0) return "O prazo de pagamento não pode ser negativo.";
  return "";
};

export const validateWarehouse = (warehouse = {}) => {
  if (!texto(warehouse.name)) return "Informe o nome do depósito.";
  if (warehouse.kind === "veiculo" && !texto(warehouse.vehicleId))
    return "Depósito do tipo veículo precisa apontar para um veículo da frota.";
  return "";
};

export const validateAccount = (account = {}) => {
  if (!texto(account.name)) return "Informe o nome da conta.";
  if (!["receita", "despesa", "ativo", "passivo", "resultado"].includes(texto(account.kind)))
    return "Escolha a natureza da conta.";
  return "";
};

export const validateCostCenter = (costCenter = {}) => {
  if (!texto(costCenter.name)) return "Informe o nome do centro de custo.";
  return "";
};
