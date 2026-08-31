import readXlsxFile, { readSheetNames } from "read-excel-file";

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const slug = (value) => normalized(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "conta";
const hash = (value) => {
  let result = 2166136261;
  for (const character of normalized(value)) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0).toString(36);
};
// O id da conta é derivado do nome e é ESTÁVEL: a mesma empresa importada por
// caminhos diferentes (planilha de CRM, quadro de pipeline) cai na mesma conta,
// em vez de virar duas. Por isso é exportado — quem importa qualquer coisa que
// tenha empresa usa este mesmo id.
export const idEstavelDaConta = (company) => `crm-${slug(company)}-${hash(company)}`;
const stableId = idEstavelDaConta;

const canonicalCompany = (value) => {
  const original = text(value).replace(/\s*\((?:grupo|group)\)\s*$/i, "").trim();
  if (/^amazon\b/i.test(original)) return "Amazon";
  if (/^shopee\b/i.test(original)) return "Shopee";
  if (/^mercado\s+livre\b/i.test(original)) return "Mercado Livre";
  return original.replace(/\b(?:grupo)\b$/i, "").trim();
};

const emailFrom = (value) => (text(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "").toLowerCase();
const cleanPhone = (value) => {
  const digits = text(value).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return "";
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
};
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const contact = ({ name, title, department, phone, email, company, row }) => {
  const contactName = text(name);
  const contactEmail = emailFrom(email);
  const contactPhone = cleanPhone(phone);
  if (!contactName && !contactEmail && !contactPhone) return null;
  const finalName = contactName || text(email).replace(/<[^>]+>/g, "").replace(/,\s*/g, " ") || contactEmail.split("@")[0];
  return {
    id: `import-${hash(`${company}|${contactEmail || contactPhone || finalName}|${row}`)}`,
    name: finalName,
    title: text(title),
    department,
    email: contactEmail,
    phone: contactPhone,
    relationshipRole: /suprimentos|compras/i.test(department) ? "Decisor técnico" : "Influenciador",
    source: "Importação CRM",
    country: "Brasil",
    active: true,
  };
};

const dedupeContacts = (contacts) => {
  const identities = new Set();
  return contacts.filter(Boolean).filter((item) => {
    const key = normalized(item.email || item.phone || item.name);
    if (!key || identities.has(key)) return false;
    identities.add(key);
    return true;
  });
};

const mergeCompanyRows = (items) => {
  const companies = new Map();
  for (const item of items) {
    if (!item.nome) continue;
    const key = normalized(item.nome);
    const current = companies.get(key);
    if (!current) { companies.set(key, item); continue; }
    current.crm.contacts = dedupeContacts([...(current.crm.contacts || []), ...(item.crm.contacts || [])]);
    const previousRevenue = Number(current.crm.qualification.totalExpressHistoricalRevenue || 0);
    const nextRevenue = Number(item.crm.qualification?.totalExpressHistoricalRevenue || 0);
    const previousVolume = Number(current.crm.qualification.totalExpressHistoricalVolume || 0);
    const nextVolume = Number(item.crm.qualification?.totalExpressHistoricalVolume || 0);
    current.crm.qualification = { ...(current.crm.qualification || {}), ...(item.crm.qualification || {}) };
    if (previousRevenue || nextRevenue) current.crm.qualification.totalExpressHistoricalRevenue = String(previousRevenue + nextRevenue);
    if (previousVolume || nextVolume) current.crm.qualification.totalExpressHistoricalVolume = String(previousVolume + nextVolume);
    current.observacoes = [current.observacoes, item.observacoes].filter(Boolean).join(" | ").slice(0, 1000);
  }
  return [...companies.values()];
};

const parseLegacyCrm = (rows, headerIndex) => mergeCompanyRows(rows.slice(headerIndex + 1).map((row, index) => {
  const company = canonicalCompany(row[1]);
  if (!company) return null;
  const contacts = dedupeContacts([
    contact({ name: row[5], phone: row[6], email: row[7], company, row: index, title: "Operações", department: "Operações" }),
    contact({ name: row[8], phone: row[9], email: row[10], company, row: index, title: "Suprimentos", department: "Compras / Procurement" }),
  ]);
  return {
    id: stableId(company),
    nome: company,
    status: "ativo",
    observacoes: "Dados históricos de volume e receita pertencem à Total Express e não representam faturamento da To Do Green.",
    crm: {
      temperature: "Frio",
      stage: "Mapeamento",
      source: "CRM legado Total Express",
      contacts,
      qualification: {
        totalExpressHistoricalVolume: String(number(row[2])),
        totalExpressHistoricalRevenue: String(number(row[3])),
        totalExpressHistoricalAverageTicket: String(number(row[4])),
        financialDataOwner: "Total Express",
      },
    },
  };
}).filter(Boolean));

const parsePortfolio = (rows, headerIndex) => mergeCompanyRows(rows.slice(headerIndex + 1).map((row) => {
  const company = canonicalCompany(row[1]);
  if (!company) return null;
  return {
    id: stableId(company),
    nome: company,
    status: "ativo",
    observacoes: [text(row[2]), text(row[14])].filter(Boolean).join(" | "),
    crm: {
      temperature: "Morno",
      stage: text(row[4]) || "Mapeamento",
      source: "Carteira To Do Green",
      contacts: [],
      qualification: {
        opportunity: text(row[2]),
        responsibleArea: text(row[3]),
        product: text(row[13]),
        attentionPoint: text(row[14]),
        portfolioLevel: text(row[15]),
      },
    },
  };
}).filter(Boolean));

const parseGeneric = (rows, headerIndex) => {
  const headers = rows[headerIndex].map(normalized);
  const at = (...names) => headers.findIndex((header) => names.includes(header));
  const nameIndex = at("cliente", "empresa", "nome", "grupo");
  if (nameIndex < 0) throw new Error("Não encontrei uma coluna de cliente ou empresa.");
  const segmentIndex = at("segmento", "setor");
  const emailIndex = at("e-mail", "email", "e-maiil");
  const phoneIndex = at("telefone", "celular", "contato");
  const contactIndex = at("nome contato", "contato nome", "responsavel", "responsável");
  return mergeCompanyRows(rows.slice(headerIndex + 1).map((row, index) => {
    const company = canonicalCompany(row[nameIndex]);
    if (!company) return null;
    return {
      id: stableId(company), nome: company, segmento: segmentIndex >= 0 ? text(row[segmentIndex]) : "", status: "ativo",
      crm: { temperature: "Frio", stage: "Mapeamento", source: "Importação CRM", contacts: dedupeContacts([contact({ name: contactIndex >= 0 ? row[contactIndex] : "", phone: phoneIndex >= 0 ? row[phoneIndex] : "", email: emailIndex >= 0 ? row[emailIndex] : "", company, row: index, department: "Relacionamento" })]) },
    };
  }).filter(Boolean));
};

export function parseCrmRows(rows) {
  const crmHeader = rows.findIndex((row) => row.map(normalized).includes("nucleo") && row.map(normalized).includes("grupo"));
  if (crmHeader >= 0) return parseLegacyCrm(rows, crmHeader);
  const portfolioHeader = rows.findIndex((row) => row.map(normalized).includes("cliente") && row.map(normalized).includes("oportunidade"));
  if (portfolioHeader >= 0) return parsePortfolio(rows, portfolioHeader);
  const genericHeader = rows.findIndex((row) => row.some((cell) => ["cliente", "empresa", "nome", "grupo"].includes(normalized(cell))));
  return genericHeader >= 0 ? parseGeneric(rows, genericHeader) : [];
}

const csvRows = (content) => {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const delimiter = (String(content).split(/\r?\n/, 1)[0].match(/;/g)?.length || 0) > (String(content).split(/\r?\n/, 1)[0].match(/,/g)?.length || 0) ? ";" : ",";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) { row.push(cell); cell = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

export async function parseCrmImportFile(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (extension === "json") {
    const payload = JSON.parse(await file.text());
    const items = Array.isArray(payload?.clientes) ? payload.clientes : Array.isArray(payload) ? payload : [];
    if (!items.length) throw new Error("O arquivo não contém clientes para importar.");
    return items;
  }
  if (extension === "csv") {
    const result = parseCrmRows(csvRows(await file.text()));
    if (!result.length) throw new Error("O CSV não contém clientes reconhecíveis.");
    return result;
  }
  if (extension === "xls") throw new Error("Salve a planilha no formato .xlsx antes de importar.");
  const sheetNames = await readSheetNames(file);
  const groups = await Promise.all(sheetNames.map((sheet) => readXlsxFile(file, { sheet }).then(parseCrmRows)));
  const result = mergeCompanyRows(groups.flat());
  if (!result.length) throw new Error("A planilha não contém clientes reconhecíveis.");
  return result;
}
