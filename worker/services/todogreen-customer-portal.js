// ===== Portal do Cliente: API =====
//
// Regra única deste arquivo: o cliente da sessão sai do banco, nunca da
// requisição. Não existe parâmetro `client` em endpoint nenhum daqui. Quem
// tentar passar um é ignorado, porque não há onde ele entrar.
//
// A autenticação, a sessão, os usuários, a auditoria e o banco são os mesmos
// do resto do Seu Funcionário. Isto é outra experiência, não outro sistema.

import { emailEnabled, escMail, sendEmail } from "../mensageria/envio.js";
import {
  filtrarOperacoes,
  ocorrenciasDaLinha,
  ordenarLinhaDoTempo,
  paginar,
  previsaoContraCombinado,
  resumirOperacoes,
  slaDaOperacao,
} from "../../src/features/logistics/operationTrackingDomain.js";
import {
  clientCan,
  isValidEmail,
  menuForAccess,
  normalizeEmail,
  permissionsForRole,
  clientPortalRole,
  resolveClientScope,
  scopedWhere,
} from "../../src/features/logistics/customerPortalDomain.js";
import {
  STATUS_SOLICITACAO,
  TIPOS_LISTA,
  aplicarTransicao,
  prazoDaSolicitacao,
  resumoParaCliente,
  statusValido,
  validarSolicitacao,
} from "../../src/features/logistics/clientRequestDomain.js";
import {
  calcularNPS,
  causasDeInsatisfacao,
  classificarNPS,
  faixaNPS,
  precisaOcorrencia,
} from "../../src/features/logistics/npsDomain.js";
import {
  INSTRUCAO_ASSISTENTE,
  RESPOSTA_FORA_DE_ESCOPO,
  foraDoEscopoDoCliente,
  montarContextoDoCliente,
  validarContexto,
} from "../../src/features/logistics/customerAssistantDomain.js";
import { runWithFallback } from "./ai.js";
import { envComChavesDoEspaco } from "./ai-keys.js";
import { registrarAuditoriaTodoGreen } from "./todogreen-governance.js";
import { blocoDeContexto as blocoDeContextoDoNegocio } from "../../src/features/logistics/businessContextDomain.js";
import { podeVerTodaCarteira } from "./todogreen-access.js";
import { normalizeCrmContacts } from "../../src/features/logistics/crmContactNormalizationDomain.js";

const TENANT_ID = "todogreen";
const MAX_LIMIT = 100;
const CRM_TEMPERATURES = new Set(["Quente", "Morno", "Frio"]);

// ===== O perfil público da To Do Green no portal =====
//
// Lê APENAS as linhas com sigilo 'publico'. O corte é no SQL, de propósito: um
// filtro depois da leitura deixaria o dado interno passar por variável de
// aplicação, e basta um `JSON.stringify` distraído para ele acabar num log ou
// num payload. Aqui o que é interno nunca sai do banco.
const dossiePublicoDoEspaco = async (env, workspaceOwnerId) => {
  try {
    const { results } = await env.DB.prepare(
      `SELECT fact_key, category, title, content, source, effective_at, secrecy, pinned
         FROM todogreen_business_context
        WHERE tenant_id='todogreen' AND workspace_owner_id=? AND archived_at IS NULL
          AND secrecy='publico'
        ORDER BY pinned DESC, updated_at DESC LIMIT 60`,
    ).bind(workspaceOwnerId).all();
    return (results || []).map((row) => ({
      chave: row.fact_key,
      categoria: row.category,
      titulo: row.title,
      conteudo: row.content,
      fonte: row.source,
      vigenteEm: row.effective_at,
      sigilo: "publico",
      fixado: Number(row.pinned || 0) === 1,
    }));
  } catch (erro) {
    // Sem perfil o assistente responde só sobre a operação do cliente, como
    // fazia antes. Perder o perfil não pode derrubar o portal.
    console.error("portal: perfil público indisponível", erro?.message || erro);
    return [];
  }
};

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const sha256 = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const normalizeText = (value) => clean(value, 500).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const accountCode = (id) => `TDG-${clean(id, 60).replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase()}`;

const finite = (value, min = 0, max = 100) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 0;
};

const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

const safeExternalUrl = (value) => {
  try {
    const url = new URL(clean(value, 1000));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
};

const safeLinkedinUrl = (value) => {
  const url = safeExternalUrl(value);
  if (!url) return "";
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname) ? url : "";
  } catch { return ""; }
};

const websiteBelongsToCompany = (value, company) => {
  let host = "";
  try { host = normalizeText(new URL(safeExternalUrl(value)).hostname.replace(/^www\./, "")); } catch { return false; }
  const tokens = normalizeText(company).split(/\s+/).filter((item) => item.length > 3 && !["grupo", "brasil"].includes(item));
  return Boolean(host && tokens.length && tokens.some((token) => host.includes(token)));
};

const sameExternalUrl = (left, right) => {
  const canonical = (value) => safeExternalUrl(value).replace(/[#?].*$/, "").replace(/\/$/, "");
  return Boolean(canonical(left) && canonical(left) === canonical(right));
};

const intelligenceSource = (item = {}) => ({
  title: clean(item.title, 240),
  url: safeExternalUrl(item.url),
  snippet: clean(item.snippet, 700),
  provider: clean(item.provider, 60),
  category: clean(item.category, 40),
  actionable: item.actionable === true,
  validation: clean(item.validation, 500),
  verification: clean(item.verification, 500),
  currentness: clean(item.currentness, 500),
});

const intelligenceSources = (items, limit = 10) => Array.isArray(items)
  ? items.slice(0, limit).map(intelligenceSource).filter((item) => item.title && item.url)
  : [];

const enrichmentEvidenceFields = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(["legalName", "segment", "headquarters", "website", "linkedinUrl"]
    .map((key) => {
      const item = input[key];
      if (!item || typeof item !== "object" || !safeExternalUrl(item.sourceUrl)) return null;
      return [key, {
        value: clean(item.value, 300),
        sourceUrl: safeExternalUrl(item.sourceUrl),
        sourceTitle: clean(item.sourceTitle, 240),
        checkedAt: clean(item.checkedAt, 40),
        confidence: clean(item.confidence, 40),
        method: clean(item.method, 80),
      }];
    }).filter(Boolean));
};

const intelligenceFields = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const version = finite(input.version, 1, 100);
  if (version < 5) return null;
  return {
    version,
    company: clean(input.company, 200),
    segment: clean(input.segment, 120),
    suggestedLegalName: input.suggestedLegalName && typeof input.suggestedLegalName === "object"
      ? {
          value: clean(input.suggestedLegalName.value, 200),
          confidence: clean(input.suggestedLegalName.confidence, 40),
          source: input.suggestedLegalName.source ? intelligenceSource(input.suggestedLegalName.source) : null,
        }
      : null,
    suggestedSegment: input.suggestedSegment && typeof input.suggestedSegment === "object"
      ? {
          value: clean(input.suggestedSegment.value, 120),
          confidence: clean(input.suggestedSegment.confidence, 40),
          source: input.suggestedSegment.source ? intelligenceSource(input.suggestedSegment.source) : null,
        }
      : null,
    suggestedHeadquarters: input.suggestedHeadquarters && typeof input.suggestedHeadquarters === "object"
      ? {
          value: clean(input.suggestedHeadquarters.value, 160),
          confidence: clean(input.suggestedHeadquarters.confidence, 40),
          source: input.suggestedHeadquarters.source ? intelligenceSource(input.suggestedHeadquarters.source) : null,
        }
      : null,
    checkedAt: clean(input.checkedAt, 40),
    officialWebsite: input.officialWebsite ? intelligenceSource(input.officialWebsite) : null,
    linkedinCompany: input.linkedinCompany ? intelligenceSource(input.linkedinCompany) : null,
    publicRegistry: input.publicRegistry && typeof input.publicRegistry === "object"
      ? {
          cnpj: clean(input.publicRegistry.cnpj, 14),
          legalName: clean(input.publicRegistry.legalName, 200),
          tradeName: clean(input.publicRegistry.tradeName, 200),
          city: clean(input.publicRegistry.city, 120),
          state: clean(input.publicRegistry.state, 2),
          mainActivity: clean(input.publicRegistry.mainActivity, 240),
          status: clean(input.publicRegistry.status, 120),
          sourceUrl: safeExternalUrl(input.publicRegistry.sourceUrl),
          source: input.publicRegistry.source ? intelligenceSource(input.publicRegistry.source) : null,
        }
      : null,
    esg: {
      relevance: clean(input.esg?.relevance, 40),
      signals: intelligenceSources(input.esg?.signals),
    },
    logisticsSignals: intelligenceSources(input.logisticsSignals),
    supplierLinks: intelligenceSources(input.supplierLinks),
    supplierRejected: finite(input.supplierRejected, 0, 1000),
    openRfqs: intelligenceSources(input.openRfqs),
    rfqRejected: finite(input.rfqRejected, 0, 1000),
    procurementPeople: intelligenceSources(input.procurementPeople),
    knownContactProfiles: intelligenceSources(input.knownContactProfiles),
    reviewCandidates: intelligenceSources(input.reviewCandidates, 12),
    contactCandidates: Array.isArray(input.contactCandidates)
      ? input.contactCandidates.slice(0, 20).map((contact) => ({
          id: clean(contact?.id, 80),
          name: clean(contact?.name, 160),
          title: clean(contact?.title, 160),
          department: clean(contact?.department, 120),
          email: normalizeEmail(contact?.email),
          phone: clean(contact?.phone, 80),
          linkedinUrl: safeLinkedinUrl(contact?.linkedinUrl),
          relationshipRole: clean(contact?.relationshipRole, 60),
          source: clean(contact?.source, 80),
          sourceUrl: safeExternalUrl(contact?.sourceUrl),
          country: clean(contact?.country, 80),
          specialty: clean(contact?.specialty, 120),
          validation: clean(contact?.validation, 500),
          confidence: clean(contact?.confidence, 40),
          evidence: contact?.evidence && typeof contact.evidence === "object" ? {
            sourceUrl: safeExternalUrl(contact.evidence.sourceUrl),
            checkedAt: clean(contact.evidence.checkedAt, 40),
            method: clean(contact.evidence.method, 80),
            confidence: clean(contact.evidence.confidence, 40),
          } : null,
          verifiedBrazil: contact?.verifiedBrazil === true,
          currentEmploymentVerified: contact?.currentEmploymentVerified === true,
          employmentCheckedAt: clean(contact?.employmentCheckedAt, 40),
          employmentStatus: ["current", "former", "unknown"].includes(clean(contact?.employmentStatus, 20))
            ? clean(contact?.employmentStatus, 20)
            : "unknown",
          researchVersion: finite(contact?.researchVersion, 0, 100),
        })).filter((contact) => contact.name && contact.linkedinUrl)
      : [],
    formerContacts: Array.isArray(input.formerContacts)
      ? input.formerContacts.slice(0, 20).map((contact) => ({
          name: clean(contact?.name, 160),
          linkedinUrl: safeLinkedinUrl(contact?.linkedinUrl),
          sourceUrl: safeExternalUrl(contact?.sourceUrl),
          validation: clean(contact?.validation, 500),
        })).filter((contact) => contact.name)
      : [],
    contactSearchQuality: input.contactSearchQuality && typeof input.contactSearchQuality === "object"
      ? {
          accepted: finite(input.contactSearchQuality.accepted, 0, 1000),
          candidatesForReview: finite(input.contactSearchQuality.candidatesForReview, 0, 1000),
          foreignRejected: finite(input.contactSearchQuality.foreignRejected, 0, 1000),
          noBrazilEvidenceRejected: finite(input.contactSearchQuality.noBrazilEvidenceRejected, 0, 1000),
          nonLogisticsRejected: finite(input.contactSearchQuality.nonLogisticsRejected, 0, 1000),
          otherCompanyRejected: finite(input.contactSearchQuality.otherCompanyRejected, 0, 1000),
          formerEmploymentRejected: finite(input.contactSearchQuality.formerEmploymentRejected, 0, 1000),
          currentEmploymentUnverified: finite(input.contactSearchQuality.currentEmploymentUnverified, 0, 1000),
          vacanciesRejected: finite(input.contactSearchQuality.vacanciesRejected, 0, 1000),
          policy: clean(input.contactSearchQuality.policy, 500),
        }
      : null,
    companyNews: intelligenceSources(input.companyNews),
    segmentNews: intelligenceSources(input.segmentNews),
    nextActions: Array.isArray(input.nextActions) ? input.nextActions.slice(0, 12).map((item) => clean(item, 500)).filter(Boolean) : [],
    providers: Array.isArray(input.providers) ? input.providers.slice(0, 8).map((item) => clean(item, 60)).filter(Boolean) : [],
    failures: Array.isArray(input.failures) ? input.failures.slice(0, 12).map((item) => ({ provider: clean(item?.provider, 60), error: clean(item?.error, 180) })) : [],
    autoEnrichment: input.autoEnrichment && typeof input.autoEnrichment === "object"
      ? {
          legalNameFilled: input.autoEnrichment.legalNameFilled === true,
          segmentFilled: input.autoEnrichment.segmentFilled === true,
          websiteFilled: input.autoEnrichment.websiteFilled === true,
          websiteCorrected: input.autoEnrichment.websiteCorrected === true,
          invalidWebsiteRemoved: input.autoEnrichment.invalidWebsiteRemoved === true,
          linkedinFilled: input.autoEnrichment.linkedinFilled === true,
          headquartersFilled: input.autoEnrichment.headquartersFilled === true,
          contactsAdded: finite(input.autoEnrichment.contactsAdded, 0, 100),
          contactsUpdated: finite(input.autoEnrichment.contactsUpdated, 0, 100),
          legacyContactsRemoved: finite(input.autoEnrichment.legacyContactsRemoved, 0, 100),
          legacyContactsRetained: finite(input.autoEnrichment.legacyContactsRetained, 0, 100),
          formerContactsMarkedInactive: finite(input.autoEnrichment.formerContactsMarkedInactive, 0, 100),
          qualificationFilled: Array.isArray(input.autoEnrichment.qualificationFilled)
            ? input.autoEnrichment.qualificationFilled.slice(0, 8).map((item) => clean(item, 80)).filter(Boolean)
            : [],
        }
      : null,
    excludedVacancies: finite(input.excludedVacancies, 0, 1000),
    disclaimer: clean(input.disclaimer, 1000),
  };
};

const portfolioPotentialFields = (input = {}) => {
  const potentialInputs = {
    middleMileMonthlyTrips: finite(input.potentialInputs?.middleMileMonthlyTrips, 0, 1000000000),
    middleMileAverageTicket: finite(input.potentialInputs?.middleMileAverageTicket, 0, 1000000000),
    lastMileMonthlyDeliveries: finite(input.potentialInputs?.lastMileMonthlyDeliveries, 0, 1000000000),
    lastMileAverageTicket: finite(input.potentialInputs?.lastMileAverageTicket, 0, 1000000000),
    dedicatedMonthlyVehicles: finite(input.potentialInputs?.dedicatedMonthlyVehicles, 0, 1000000),
    dedicatedMonthlyTicket: finite(input.potentialInputs?.dedicatedMonthlyTicket, 0, 1000000000),
  };
  const potentialManual = {
    annual: finite(input.potentialManual?.annual ?? input.potentialAnnual, 0, 1000000000000),
    products: {
      middleMile: finite(input.potentialManual?.products?.middleMile ?? input.productPotential?.middleMile, 0, 1000000000000),
      lastMile: finite(input.potentialManual?.products?.lastMile ?? input.productPotential?.lastMile, 0, 1000000000000),
      dedicated: finite(input.potentialManual?.products?.dedicated ?? input.productPotential?.dedicated, 0, 1000000000000),
    },
  };
  const annual = (quantity, ticket) => quantity > 0 && ticket > 0 ? quantity * ticket * 12 : 0;
  const calculated = {
    middleMile: annual(potentialInputs.middleMileMonthlyTrips, potentialInputs.middleMileAverageTicket),
    lastMile: annual(potentialInputs.lastMileMonthlyDeliveries, potentialInputs.lastMileAverageTicket),
    dedicated: annual(potentialInputs.dedicatedMonthlyVehicles, potentialInputs.dedicatedMonthlyTicket),
  };
  const productPotential = Object.fromEntries(Object.entries(calculated).map(([key, value]) => [
    key,
    value || potentialManual.products[key] || 0,
  ]));
  const productSum = Object.values(productPotential).reduce((sum, value) => sum + value, 0);
  const productsWithValue = Object.values(productPotential).filter(Boolean).length;
  const calculatedProducts = Object.values(calculated).filter(Boolean).length;
  return {
    potentialInputs,
    potentialManual,
    productPotential,
    potentialAnnual: productsWithValue === 3 ? productSum : potentialManual.annual || productSum || 0,
    potentialCalculation: {
      method: productsWithValue === 3 && calculatedProducts
        ? `${calculatedProducts} produto(s) calculado(s) por quantidade mensal × ticket médio × 12`
        : potentialManual.annual && calculatedProducts
          ? `Potencial anual informado; ${calculatedProducts} produto(s) calculado(s) por quantidade mensal × ticket médio × 12`
        : productsWithValue === 3
          ? "Soma dos potenciais cadastrados por produto"
        : potentialManual.annual
          ? "Potencial anual informado manualmente"
        : productSum
          ? "Soma parcial dos produtos com dados informados"
        : "Sem base suficiente para cálculo",
      calculatedProducts,
      calculatedAt: clean(input.potentialCalculation?.calculatedAt, 40),
    },
  };
};

const crmFields = (value = {}, companyName = "") => {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const portfolioPotential = portfolioPotentialFields(input);
  const storedWebsite = safeExternalUrl(input.website);
  const legacyResearchWebsite = safeExternalUrl(input.intelligence?.officialWebsite?.url);
  const website = Number(input.intelligence?.version || 0) < 3 && sameExternalUrl(storedWebsite, legacyResearchWebsite) && !websiteBelongsToCompany(storedWebsite, companyName)
    ? ""
    : storedWebsite;
  const normalizedContacts = Array.isArray(input.contacts)
    ? normalizeCrmContacts(input.contacts.slice(0, 100).map((contact) => ({
        id: clean(contact?.id, 80) || crypto.randomUUID(),
        name: clean(contact?.name, 160),
        title: clean(contact?.title, 120),
        department: clean(contact?.department, 120),
        email: normalizeEmail(contact?.email),
        phone: clean(contact?.phone, 500),
        linkedinUrl: safeLinkedinUrl(contact?.linkedinUrl),
        relationshipRole: clean(contact?.relationshipRole, 60) || "Influenciador",
        influence: finite(contact?.influence),
        supportLevel: finite(contact?.supportLevel, -100, 100),
        accessLevel: finite(contact?.accessLevel),
        priorities: clean(contact?.priorities, 1000),
        objections: clean(contact?.objections, 1000),
        source: clean(contact?.source, 80),
        sourceUrl: safeExternalUrl(contact?.sourceUrl),
        validation: clean(contact?.validation, 500),
        confidence: clean(contact?.confidence, 40),
        evidence: contact?.evidence && typeof contact.evidence === "object" ? {
          sourceUrl: safeExternalUrl(contact.evidence.sourceUrl),
          checkedAt: clean(contact.evidence.checkedAt, 40),
          method: clean(contact.evidence.method, 80),
          confidence: clean(contact.evidence.confidence, 40),
        } : null,
        country: clean(contact?.country, 80),
        specialty: clean(contact?.specialty, 120),
        verifiedBrazil: contact?.verifiedBrazil === true,
        currentEmploymentVerified: contact?.currentEmploymentVerified === true,
        employmentCheckedAt: clean(contact?.employmentCheckedAt, 40),
        employmentStatus: ["current", "former", "unknown"].includes(clean(contact?.employmentStatus, 20))
          ? clean(contact?.employmentStatus, 20)
          : "unknown",
        researchVersion: finite(contact?.researchVersion, 0, 100),
        active: contact?.active !== false,
      })).filter((contact) => contact.name))
    : [];
  return {
    tier: clean(input.tier, 40),
    temperature: CRM_TEMPERATURES.has(clean(input.temperature, 20)) ? clean(input.temperature, 20) : "",
    stage: clean(input.stage, 60),
    headquarters: clean(input.headquarters, 160),
    website,
    linkedinUrl: safeLinkedinUrl(input.linkedinUrl),
    strategicPotential: finite(input.strategicPotential),
    relationshipStrength: finite(input.relationshipStrength),
    operationalFit: finite(input.operationalFit),
    esgFit: finite(input.esgFit),
    dataQuality: finite(input.dataQuality),
    churnRisk: finite(input.churnRisk),
    nextAction: clean(input.nextAction, 500),
    nextActionAt: clean(input.nextActionAt, 40),
    completedSuggestedActions: Array.isArray(input.completedSuggestedActions)
      ? [...new Set(input.completedSuggestedActions.slice(0, 50).map((item) => clean(item, 120)).filter(Boolean))]
      : [],
    lastInteractionAt: clean(input.lastInteractionAt, 40),
    contractRenewalDate: clean(input.contractRenewalDate, 40),
    ourAnnualRevenue: finite(input.ourAnnualRevenue, 0, 1000000000000),
    customerAnnualLogisticsSpend: finite(input.customerAnnualLogisticsSpend, 0, 1000000000000),
    potentialAnnual: portfolioPotential.potentialAnnual,
    productPotential: portfolioPotential.productPotential,
    potentialManual: portfolioPotential.potentialManual,
    potentialInputs: portfolioPotential.potentialInputs,
    potentialCalculation: portfolioPotential.potentialCalculation,
    geographicExpansion: clean(input.geographicExpansion, 1000),
    accountPlan: {
      objective: clean(input.accountPlan?.objective, 2000),
      barriers: clean(input.accountPlan?.barriers, 2000),
      competitors: clean(input.accountPlan?.competitors, 2000),
      plan30: clean(input.accountPlan?.plan30, 2000),
      plan60: clean(input.accountPlan?.plan60, 2000),
      plan90: clean(input.accountPlan?.plan90, 2000),
    },
    source: clean(input.source, 100),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20).map((item) => clean(item, 60)).filter(Boolean) : [],
    qualification:
      input.qualification && typeof input.qualification === "object" && !Array.isArray(input.qualification)
        ? Object.fromEntries(Object.entries(input.qualification).slice(0, 40).map(([key, item]) => [clean(key, 80), clean(item, 1000)]))
        : {},
    contacts: normalizedContacts,
    intelligence:
      input.intelligence && typeof input.intelligence === "object" && !Array.isArray(input.intelligence)
        ? intelligenceFields(input.intelligence)
        : null,
    enrichmentEvidence: enrichmentEvidenceFields(input.enrichmentEvidence),
  };
};

export const mergeImportedCrm = (existing = {}, incoming = {}, companyName = "") => {
  const oldSource = clean(existing?.source, 100);
  const newSource = clean(incoming?.source, 100);
  const fromPortfolio = /carteira\s+to\s+do\s+green/i.test(newSource);
  const fromLegacyCrm = /crm|total\s+express/i.test(newSource);
  const temperature = fromPortfolio || existing?.temperature === "Morno"
    ? "Morno"
    : fromLegacyCrm
      ? "Frio"
      : incoming?.temperature || existing?.temperature || "";
  const sources = [...new Set([oldSource, newSource].filter(Boolean))].join(" + ");
  return crmFields({
    ...existing,
    ...incoming,
    temperature,
    source: sources,
    qualification: { ...(existing?.qualification || {}), ...(incoming?.qualification || {}) },
    contacts: [...(Array.isArray(existing?.contacts) ? existing.contacts : []), ...(Array.isArray(incoming?.contacts) ? incoming.contacts : [])],
    intelligence: existing?.intelligence || incoming?.intelligence || null,
  }, companyName);
};

// Mesma sessão do resto do produto: o portal não tem login próprio.
async function authenticatedUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !env.DB) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), new Date().toISOString())
    .first()
    .catch(() => null);
}


// O ponto onde o isolamento acontece. Uma consulta, pelo e-mail da sessão.
// O resultado carrega o cliente; nada além dele é alcançável depois.
// As empresas que este e-mail alcança. Antes a consulta terminava em `LIMIT 1`
// porque a restrição do banco garantia que só havia uma — e era essa restrição
// que deixava de fora grupo empresarial, consultoria, auditor e gestor de
// subsidiárias, que são justamente quem tem várias empresas e um e-mail só.
async function vinculosDaSessao(env, user) {
  if (!user?.email) return [];
  const { results } = await env.DB.prepare(
    `SELECT v.tenant_id, v.client_id, v.email, v.role, v.status,
            c.name AS client_name, c.status AS client_status,
            c.portal_enabled, c.workspace_owner_id
       FROM todogreen_client_users v
       JOIN todogreen_clients c ON c.id = v.client_id AND c.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.email = ?
      ORDER BY c.name COLLATE NOCASE
      LIMIT 50`,
  )
    .bind(TENANT_ID, normalizeEmail(user.email))
    .all()
    .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  return (results || []).map(resolveClientScope).filter(Boolean);
}

// A empresa da requisição sai SEMPRE da lista que a sessão alcança. Aceitar o
// id que veio na query string sem confrontar seria o mesmo furo do `?owner=`
// que já foi fechado no lado interno: trocar o parâmetro e operar dado alheio.
async function clientScopeForSession(env, user, clientePedido = "") {
  const vinculos = await vinculosDaSessao(env, user);
  if (!vinculos.length) return null;
  const pedido = clean(clientePedido, 120);
  if (pedido) return vinculos.find((v) => v.clientId === pedido) || null;
  // Sem escolha explícita, a primeira em ordem alfabética — determinística, e
  // não "a que o banco devolveu primeiro".
  return vinculos[0];
}

// Campos livres que PODEM sair para o cliente. O fields_json é escrito pela
// equipe interna sem validação de chave: se um operador digitar "margem",
// "custoPorKm" ou um CPF num campo livre, isso NÃO pode vazar no portal. O
// assistente já filtra por lista (CAMPOS_PROIBIDOS); o payload cru não
// filtrava nada — este allowlist fecha o buraco. Só entra o que é operacional
// e do interesse legítimo do embarcador.
const CAMPOS_LIBERADOS_AO_CLIENTE = new Set([
  "deliveries", "entregas", "packages", "pacotes", "trips", "viagens",
  "distanceKm", "occupancyPercent", "dataQuality", "energyKwh",
  "weightKg", "tons", "pallets", "successRate",
]);
const camposParaCliente = (bruto) =>
  Object.fromEntries(
    Object.entries(bruto && typeof bruto === "object" ? bruto : {})
      .filter(([chave, valor]) => CAMPOS_LIBERADOS_AO_CLIENTE.has(chave) && typeof valor !== "object"),
  );

// Uma linha da tabela vira uma operação com os nomes que o domínio entende.
// A tradução fica num lugar só: espalhá-la faria a lista e o detalhe divergirem
// justamente nos campos de prazo, que é onde a divergência custa caro.
const operacaoDoBanco = (linha) => ({
  id: linha.id,
  referencia: linha.reference,
  situacao: linha.status,
  dataServico: linha.service_date,
  origem: linha.origin,
  destino: linha.destination,
  prometidoEm: linha.promised_at || "",
  entregueEm: linha.delivered_at || "",
  previsaoEm: linha.eta_at || "",
  placa: linha.vehicle_plate || "",
  motorista: linha.driver_name || "",
  distanciaKm: linha.distance_km || 0,
  ocorrencias: Number(linha.ocorrencias || linha.incident_count || 0),
  ultimaPosicao:
    linha.last_position_at && linha.last_position_lat !== null
      ? {
          em: linha.last_position_at,
          latitude: linha.last_position_lat,
          longitude: linha.last_position_lng,
        }
      : null,
  campos: camposParaCliente(parse(linha.fields_json, {})),
});

async function logPortalEvent(env, escopo, user, action, target = "", details = "") {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_portal_events
       (id, tenant_id, workspace_owner_id, client_id, user_id, email, action, target, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      user?.id || null,
      escopo.email,
      clean(action, 80),
      clean(target, 200),
      clean(details, 500),
      new Date().toISOString(),
    )
    .run()
    .catch(() => {});
}

// ----- Indicadores do cliente -----
//
// Cada número abaixo é lido das tabelas da vertical, sempre com o cliente da
// sessão amarrado na condição. Sem registro, o número não é inventado: vem
// zero e a tela diz que não há dado.
async function clientOverview(env, escopo) {
  const { sql, params } = scopedWhere(escopo);

  const operacoes = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.deliveries') AS REAL)), 0) AS entregas,
            COALESCE(SUM(CAST(json_extract(fields_json, '$.distanceKm') AS REAL)), 0) AS km,
            COALESCE(AVG(CAST(json_extract(fields_json, '$.occupancyPercent') AS REAL)), 0) AS ocupacao
       FROM todogreen_client_operations
      WHERE ${sql} AND lower(status) != 'rascunho'`,
  )
    .bind(...params)
    .first()
    .catch(() => null);

  // Reusa a tabela que a vertical já grava; os números moram no resultado em
  // JSON, com os mesmos nomes que o motor ambiental produz.
  const ambiental = await env.DB.prepare(
    `SELECT COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2AvoidedKg') AS REAL)), 0) AS co2,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.dieselAvoidedLiters') AS REAL)), 0) AS diesel,
            -- Cenário convencional × operação real: os dois lados da comparação
            -- que a tela promete e que o motor já grava. As chaves são as que o
            -- motor ambiental emite (co2ReferenciaKg/co2ExecutadoKg) — antes esta
            -- consulta lia referenceEmissionsKg/actualEmissionsKg, que não existem
            -- no result_json, então convencional/realizado vinham sempre 0 e o
            -- bloco "Comparação de cenários" nunca renderizava.
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ReferenciaKg') AS REAL)), 0) AS convencional,
            COALESCE(SUM(CAST(json_extract(result_json, '$.impact.co2ExecutadoKg') AS REAL)), 0) AS realizado,
            COALESCE(AVG(CAST(json_extract(result_json, '$.impact.reductionPercent') AS REAL)), 0) AS reducao,
            COALESCE(AVG(data_quality), 0) AS qualidade,
            COUNT(*) AS calculos
       FROM environmental_calculations
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .first()
    .catch(() => null);

  // As duas notas mais recentes: a atual e a anterior. A tela mostra a
  // composição (components_json) e a variação (atual − anterior) — antes o
  // /resumo só devolvia valor/versão/data, então "Composição da nota" caía
  // sempre no texto de fallback e a variação nunca aparecia.
  const scores = await env.DB.prepare(
    `SELECT score, weights_version, components_json, calculated_at
       FROM todogreen_green_scores
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
      ORDER BY calculated_at DESC LIMIT 2`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
    .all()
    .catch(() => null);

  const scoreRows = scores?.results || [];
  const score = scoreRows[0] || null;
  const scoreAnterior = scoreRows[1] || null;

  return {
    operacoes: {
      total: operacoes?.total || 0,
      entregas: operacoes?.entregas || 0,
      distanciaKm: operacoes?.km || 0,
      ocupacaoMedia: operacoes?.ocupacao || 0,
    },
    ambiental: {
      co2EvitadoKg: ambiental?.co2 || 0,
      dieselEvitadoL: ambiental?.diesel || 0,
      // A comparação de cenários do portal lê estes dois campos (antes vinham
      // sempre 0, então o bloco nunca renderizava).
      emissaoConvencionalKg: ambiental?.convencional || 0,
      emissaoTodogreenKg: ambiental?.realizado || 0,
      reducaoPercent: ambiental?.reducao || 0,
      qualidadeDados: ambiental?.qualidade || 0,
      calculos: ambiental?.calculos || 0,
    },
    greenScore: score
      ? {
          valor: score.score,
          versaoPesos: score.weights_version,
          calculadoEm: score.calculated_at,
          componentes: parse(score.components_json, {}),
          anterior: scoreAnterior ? scoreAnterior.score : null,
        }
      : null,
    // Sem dado é sem dado. A tela mostra convite para cadastrar, não número
    // bonito que ninguém pode auditar.
    semDados:
      !(operacoes?.total || 0) && !(ambiental?.calculos || 0) && !score,
  };
}

// Prévia interna e somente leitura. Ela monta o mesmo escopo e o mesmo menu
// usados pelo portal, mas não cria uma sessão de cliente nem grava eventos em
// nome dele. O id ainda passa pela regra da carteira do usuário interno.
export async function handleTodoGreenClientPortalPreview(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "GET") return response({ error: "Método não permitido." }, 405);
  const url = new URL(request.url);
  const clientId = clean(url.pathname.split("/").filter(Boolean)[3], 60);
  if (!clientId) return response({ error: "Informe o cliente." }, 400);
  const canManageInternal = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") || access?.permissions?.includes("clients:manage");
  const sessionEmail = normalizeEmail(user?.email);
  const client = await env.DB.prepare(
    `SELECT c.id,c.name,c.status,c.portal_enabled,c.workspace_owner_id
       FROM todogreen_clients c
      WHERE c.id=? AND c.tenant_id=? AND c.workspace_owner_id=? AND c.archived_at IS NULL
        AND (?=1 OR EXISTS (
          SELECT 1 FROM todogreen_client_assignments a
           WHERE a.tenant_id=c.tenant_id AND a.client_id=c.id
             AND a.status='active' AND lower(a.seller_email)=?
        ))`,
  ).bind(clientId, TENANT_ID, access.ownerId, canManageInternal ? 1 : 0, sessionEmail).first();
  if (!client) return response({ error: "Cliente não encontrado na sua carteira." }, 404);

  const usersResult = await env.DB.prepare(
    `SELECT email,role,status,updated_at AS updatedAt
       FROM todogreen_client_users
      WHERE tenant_id=? AND client_id=? AND status='active'
      ORDER BY email`,
  ).bind(TENANT_ID, client.id).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
  const users = usersResult.results || [];
  const requestedRole = clientPortalRole(url.searchParams.get("role") || users[0]?.role);
  const previewScope = {
    tenantId: TENANT_ID, clientId: client.id, clientName: client.name,
    workspaceOwnerId: client.workspace_owner_id, email: sessionEmail,
    role: requestedRole, permissions: permissionsForRole(requestedRole), status: "active",
  };
  const { sql, params } = scopedWhere(previewScope);
  const [summary, recent, documents, requests] = await Promise.all([
    clientOverview(env, previewScope),
    env.DB.prepare(
      `SELECT id,reference,status,service_date AS serviceDate,origin,destination
         FROM todogreen_client_operations WHERE ${sql} AND lower(status) != 'rascunho'
        ORDER BY service_date DESC,created_at DESC LIMIT 5`,
    ).bind(...params).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_evidences WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM todogreen_client_requests WHERE ${sql}`)
      .bind(...params).first().catch(() => ({ total: 0 })),
  ]);
  return response({
    preview: true,
    client: { id: client.id, name: client.name },
    portal: {
      enabled: client.portal_enabled === 1,
      role: requestedRole,
      permissions: previewScope.permissions,
      menu: menuForAccess(previewScope),
    },
    users: users.map((item) => ({ email: item.email, role: clientPortalRole(item.role), updatedAt: item.updatedAt })),
    summary,
    recentOperations: recent.results || [],
    counts: {
      operations: Number(summary?.operacoes?.total || 0),
      documents: Number(documents?.total || 0),
      requests: Number(requests?.total || 0),
    },
  });
}

export async function handleTodoGreenCustomerPortal(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  const caminho = url.pathname
    .replace(/^\/api\/todogreen\/portal\/?/, "")
    .split("/")
    .filter(Boolean);
  const resource = caminho[0] || "";
  // /portal/evidencias/<id>/link
  const documentoPedido = String(caminho[1] || "").slice(0, 120);
  const subresource = String(caminho[2] || "").slice(0, 40);

  const user = await authenticatedUser(request, env);
  if (!user) return response({ error: "Sessão inválida." }, 401);

  const empresaPedida = url.searchParams.get("empresa") || "";
  const empresas = await vinculosDaSessao(env, user);
  const escopo = await clientScopeForSession(env, user, empresaPedida);
  if (!escopo)
    return response(
      {
        error: empresas.length
          // Mesma resposta para empresa inexistente e para empresa de outra
          // pessoa: distinguir contaria que ela existe.
          ? "Você não tem acesso a esta empresa."
          : "Esta conta não está vinculada a nenhum cliente da To Do Green.",
      },
      403,
    );

  // Sessão — quem sou eu, o que posso ver, qual é o meu menu.
  if (request.method === "GET" && (resource === "" || resource === "sessao")) {
    await logPortalEvent(env, escopo, user, "portal_aberto");
    return response({
      cliente: { id: escopo.clientId, nome: escopo.clientName },
      papel: escopo.role,
      permissoes: escopo.permissions,
      menu: menuForAccess(escopo),
      usuario: { nome: user.name, email: escopo.email },
      // A lista vai junto na abertura: sem ela o portal não teria como oferecer
      // a troca, e um grupo empresarial ficaria preso na primeira empresa.
      empresas: empresas.map((v) => ({ id: v.clientId, nome: v.clientName, papel: v.role })),
    });
  }

  if (request.method === "GET" && resource === "resumo") {
    return response({ resumo: await clientOverview(env, escopo) });
  }

  // A lista de operações. Era referência, status, data, origem e destino, sem
  // busca, filtro, prazo, ocorrência nem paginação — e o cliente entra no
  // portal justamente para acompanhar a carga.
  //
  // Busca, filtro e paginação acontecem no domínio, com o mesmo código que a
  // tela usa: duas implementações da mesma pergunta produzem dois "atrasado"
  // diferentes.
  if (request.method === "GET" && resource === "operacoes" && !documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT o.id, o.reference, o.status, o.service_date, o.origin, o.destination,
              o.fields_json, o.created_at, o.promised_at, o.delivered_at, o.eta_at,
              o.vehicle_plate, o.driver_name, o.distance_km, o.proof_url, o.proof_hash,
              o.last_position_at, o.last_position_lat, o.last_position_lng,
              (SELECT COUNT(*) FROM todogreen_client_operation_events e
                WHERE e.operation_id = o.id AND e.kind = 'ocorrencia') AS ocorrencias
         FROM todogreen_client_operations o
        WHERE ${sql} AND lower(o.status) != 'rascunho'
        ORDER BY o.service_date DESC, o.created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const todas = (linhas.results || []).map(operacaoDoBanco);
    const filtradas = filtrarOperacoes(todas, {
      busca: url.searchParams.get("busca") || "",
      situacao: url.searchParams.get("situacao") || "",
      de: url.searchParams.get("de") || "",
      ate: url.searchParams.get("ate") || "",
    });
    const pagina = paginar(filtradas, {
      pagina: Number(url.searchParams.get("pagina")) || 1,
      porPagina: Math.min(Number(url.searchParams.get("porPagina")) || 20, 100),
    });

    return response({
      // O SLA vai junto de cada linha: calcular de novo na tela seria uma
      // segunda implementação da mesma pergunta, e duas implementações
      // produzem dois "atrasado" diferentes.
      //
      // A posição viva (last_position) NÃO viaja na lista: a tabela nunca a
      // desenha — ela só aparece no DETALHE, e lá com a janela LGPD de 6h e só
      // em trânsito. Deixá-la em toda linha (inclusive entregue/cancelada)
      // furava essa mesma proteção pela lista. Minimização de dados.
      operacoes: pagina.itens.map((operacao) => {
        const linha = { ...operacao, sla: slaDaOperacao(operacao) };
        delete linha.ultimaPosicao;
        return linha;
      }),
      paginacao: {
        pagina: pagina.pagina,
        paginas: pagina.paginas,
        total: pagina.total,
        primeiro: pagina.primeiro,
        ultimo: pagina.ultimo,
      },
      // O resumo é da seleção filtrada, não da carteira inteira: um filtro que
      // muda a lista e não muda o indicador faz a tela contar duas histórias.
      resumo: (({ lista, ...resto }) => resto)(resumirOperacoes(filtradas)),
    });
  }

  // Faturas do cliente: títulos a receber DELE, com vencimento, saldo e a
  // 2ª via do documento fiscal quando existir. Nenhum número interno (margem,
  // custo, comissão) passa por aqui — a consulta lê títulos filtrados pelo
  // cliente da sessão, e o valor de face é exatamente o que ele já recebeu na
  // fatura.
  if (request.method === "GET" && resource === "financeiro" && !documentoPedido) {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não vê faturas." }, 403);
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.number, t.issue_date, t.due_date, t.original_amount, t.open_amount, t.status,
              f.id AS fiscal_id, f.doc_type AS fiscal_tipo, f.numero AS fiscal_numero,
              f.chave_acesso AS fiscal_chave, f.status AS fiscal_status,
              CASE WHEN COALESCE(f.xml_content, '') <> '' THEN 1 ELSE 0 END AS xml_disponivel
         FROM todogreen_financial_titles t
         LEFT JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL
        ORDER BY t.due_date DESC
        LIMIT 200`,
    ).bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    const titulos = (results || []).map((linha) => ({
      id: linha.id,
      numero: linha.number,
      emitidoEm: linha.issue_date,
      venceEm: linha.due_date,
      valor: linha.original_amount,
      emAberto: linha.open_amount,
      status: linha.status,
      documento: linha.fiscal_id ? {
        tipo: linha.fiscal_tipo,
        numero: linha.fiscal_numero,
        chave: linha.fiscal_chave || "",
        status: linha.fiscal_status,
        xmlDisponivel: linha.xml_disponivel === 1,
      } : null,
    }));
    await logPortalEvent(env, escopo, user, "billing_viewed");
    return response({
      titulos,
      totais: titulos.reduce((soma, titulo) => ({
        emAberto: Math.round((soma.emAberto + (["open", "partial", "overdue"].includes(titulo.status) ? titulo.emAberto : 0)) * 100) / 100,
        quitado: Math.round((soma.quitado + (titulo.status === "settled" ? titulo.valor : 0)) * 100) / 100,
      }), { emAberto: 0, quitado: 0 }),
    });
  }

  // 2ª via do XML do documento fiscal de um título do próprio cliente.
  if (request.method === "GET" && resource === "financeiro" && documentoPedido && subresource === "xml") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu papel no portal não baixa documentos." }, 403);
    const linha = await env.DB.prepare(
      `SELECT f.xml_content, f.doc_type, f.numero
         FROM todogreen_financial_titles t
         JOIN todogreen_fiscal_documents f
           ON f.tenant_id = t.tenant_id AND f.workspace_owner_id = t.workspace_owner_id
          AND f.invoice_id = t.invoice_id AND f.invoice_id <> '' AND f.archived_at IS NULL
        WHERE t.id = ? AND t.tenant_id = ? AND t.workspace_owner_id = ? AND t.client_id = ?
          AND t.kind = 'receivable' AND t.archived_at IS NULL`,
    ).bind(documentoPedido, escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId).first().catch(() => null);
    if (!linha || !linha.xml_content) return response({ error: "Documento não encontrado." }, 404);
    await logPortalEvent(env, escopo, user, "invoice_xml_downloaded", documentoPedido);
    return new Response(linha.xml_content, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${linha.doc_type}-${linha.numero || "documento"}.xml"`,
        "cache-control": "no-store",
      },
    });
  }

  // O detalhe de uma operação: linha do tempo, ocorrências, prazo prometido
  // contra realizado, veículo, última posição e comprovante de entrega.
  if (request.method === "GET" && resource === "operacoes" && documentoPedido) {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);

    const eventos = await env.DB.prepare(
      `SELECT id, kind, titulo, descricao, local, ocorrido_em, created_at
         FROM todogreen_client_operation_events
        WHERE operation_id = ? AND tenant_id = ? AND client_id = ?
        ORDER BY ocorrido_em ASC
        LIMIT 300`,
    )
      .bind(documentoPedido, escopo.tenantId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const linhaDoTempo = ordenarLinhaDoTempo(
      (eventos.results || []).map((e) => ({
        id: e.id,
        tipo: e.kind,
        titulo: e.titulo,
        descricao: e.descricao,
        local: e.local,
        ocorridoEm: e.ocorrido_em,
        registradoEm: e.created_at,
      })),
    );

    const operacao = operacaoDoBanco(linha);

    // Rastreio de verdade: sem posição lançada à mão, a última posição vem do
    // TRACKER, casando a placa da operação com o vínculo de rastreamento. O
    // dado já era coletado por veículo e nunca chegava à operação do cliente.
    //
    // LGPD/limite de escopo: a posição do veículo só pode chegar ao embarcador
    // ENQUANTO a operação dele está em trânsito. Depois de entregue/cancelada o
    // caminhão pode estar rodando a rota de OUTRO cliente — mostrar o GPS vivo
    // ali vazaria localização de motorista para fora da operação. Por isso só
    // aplicamos o fallback se a operação não foi entregue nem cancelada e se a
    // posição é recente (janela de 6h); caso contrário fica "sem posição".
    const operacaoEmCurso = !linha.delivered_at && linha.status !== "cancelled";
    const recenteDesde = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    if (!operacao.ultimaPosicao && linha.vehicle_plate && operacaoEmCurso) {
      const rastreada = await env.DB.prepare(
        `SELECT p.latitude, p.longitude, p.recorded_at, p.address
           FROM todogreen_tracker_positions p
           JOIN todogreen_tracker_vehicle_links l ON l.id = p.vehicle_link_id
          WHERE p.workspace_owner_id = ? AND l.active = 1
            AND UPPER(REPLACE(l.plate, '-', '')) = UPPER(REPLACE(?, '-', ''))
            AND p.recorded_at >= ?
          ORDER BY p.recorded_at DESC
          LIMIT 1`,
      ).bind(escopo.workspaceOwnerId, linha.vehicle_plate, recenteDesde).first().catch(() => null);
      if (rastreada) {
        operacao.ultimaPosicao = {
          em: rastreada.recorded_at,
          latitude: rastreada.latitude,
          longitude: rastreada.longitude,
          endereco: rastreada.address || "",
          origem: "rastreador",
        };
      }
    }

    return response({
      operacao,
      sla: slaDaOperacao(operacao),
      previsao: previsaoContraCombinado(operacao),
      linhaDoTempo,
      ocorrencias: ocorrenciasDaLinha(linhaDoTempo),
      // O comprovante sai pelo mesmo link temporário dos documentos: endereço
      // de origem não chega ao navegador do cliente.
      comprovante: linha.proof_url
        ? { disponivel: true, impressaoDigital: linha.proof_hash }
        : { disponivel: false, motivo: "O comprovante ainda não foi anexado a esta entrega." },
    });
  }

  if (request.method === "GET" && resource === "trilha") {
    if (!clientCan(escopo, "portal:user:manage"))
      return response({ error: "Sem permissão para ver a trilha." }, 403);
    const linhas = await env.DB.prepare(
      `SELECT action, target, details, email, created_at
         FROM todogreen_client_portal_events
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
        ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({ eventos: linhas.results || [] });
  }

  // Dados para o relatório. O portal devolve o material bruto e a montagem do
  // documento acontece no navegador, com o mesmo código que a tela interna usa
  // — assim não existem duas versões do mesmo relatório.
  if (request.method === "GET" && resource === "relatorio") {
    if (!clientCan(escopo, "portal:report:export"))
      return response({ error: "Seu acesso não permite exportar relatórios." }, 403);

    const inicio = clean(url.searchParams.get("inicio"), 10);
    const fim = clean(url.searchParams.get("fim"), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim))
      return response({ error: "Informe início e fim no formato AAAA-MM-DD." }, 400);

    const { sql, params } = scopedWhere(escopo, "service_date BETWEEN ? AND ?");
    const operacoes = await env.DB.prepare(
      `SELECT id, reference, status, service_date, origin, destination, fields_json
         FROM todogreen_client_operations
        WHERE ${sql}
        ORDER BY service_date`,
    )
      .bind(...params, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const calculos = await env.DB.prepare(
      `SELECT id, result_json, methodology_version, data_quality, created_at
         FROM environmental_calculations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, inicio, fim)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    const score = await env.DB.prepare(
      `SELECT score, weights_version, components_json, calculated_at
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 1`,
    )
      .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId)
      .first()
      .catch(() => null);

    await logPortalEvent(env, escopo, user, "relatorio_gerado", `${inicio}..${fim}`);

    return response({
      cliente: { nome: escopo.clientName },
      periodo: { inicio, fim },
      operacoes: (operacoes.results || []).map((l) => ({
        id: l.id,
        referencia: l.reference,
        data: l.service_date,
        campos: camposParaCliente(parse(l.fields_json, {})),
      })),
      calculos: (calculos.results || []).map((l, i) => ({
        ...parse(l.result_json, {}),
        referencia: `Cálculo ${i + 1}`,
        qualidadeDados: l.data_quality,
        versaoFatores: l.methodology_version,
      })),
      greenScore: score
        ? {
            score: score.score,
            versaoPesos: score.weights_version,
            componentes: parse(score.components_json, {}),
          }
        : null,
    });
  }

  // Cofre de evidências: os documentos que sustentam os números do período.
  if (request.method === "GET" && resource === "evidencias") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite ver documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const linhas = await env.DB.prepare(
      `SELECT id, titulo, tipo, referencia, emitido_em, hash_conteudo, created_at
         FROM todogreen_evidences
        WHERE ${sql}
        ORDER BY emitido_em DESC, created_at DESC
        LIMIT ?`,
    )
      .bind(...params, MAX_LIMIT)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({
      evidencias: (linhas.results || []).map((l) => ({
        id: l.id,
        titulo: l.titulo,
        tipo: l.tipo,
        referencia: l.referencia,
        emitidoEm: l.emitido_em,
        arquivoNome: l.arquivo_nome,
        arquivoBytes: l.arquivo_bytes,
        // A impressão digital do conteúdo é o que permite provar depois que o
        // documento não mudou desde a emissão.
        impressaoDigital: l.hash_conteudo,
      })),
    });
  }

  // O comprovante de entrega sai pelo mesmo mecanismo dos documentos: link
  // temporário, endereço de origem escondido, cada abertura registrada.
  if (request.method === "POST" && resource === "operacoes" && subresource === "comprovante") {
    const { sql, params } = scopedWhere(escopo);
    const linha = await env.DB.prepare(
      `SELECT id, client_id, proof_url FROM todogreen_client_operations
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    if (!linha) return response({ error: "Operação não encontrada." }, 404);
    if (!linha.proof_url)
      return response({ error: "O comprovante ainda não foi anexado a esta entrega." }, 409);

    const { emitirConcessaoDeArquivo } = await import("./todogreen-evidences.js");
    const concessao = await emitirConcessaoDeArquivo(env, {
      url: linha.proof_url,
      clientId: linha.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
      nome: `comprovante-${linha.id}`,
    });
    await logPortalEvent(env, escopo, user, "comprovante_link_emitido", linha.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // O link de download. Até aqui a aba listava metadado e a permissão se
  // chamava `portal:document:download` — prometia um arquivo e entregava uma
  // linha de tabela.
  //
  // O link é temporário porque link de documento é credencial: quem tem, abre.
  // Um endereço permanente sobrevive em histórico, em print e em e-mail
  // encaminhado, e continua valendo.
  if (request.method === "POST" && resource === "evidencias" && subresource === "link") {
    if (!clientCan(escopo, "portal:document:download"))
      return response({ error: "Seu acesso não permite baixar documentos." }, 403);
    const { sql, params } = scopedWhere(escopo);
    const doc = await env.DB.prepare(
      `SELECT id, client_id, arquivo_url FROM todogreen_evidences
        WHERE ${sql} AND id = ? LIMIT 1`,
    )
      .bind(...params, documentoPedido)
      .first()
      .catch(() => null);
    // 404 e não 403: o escopo já respondeu que não é dele.
    if (!doc) return response({ error: "Documento não encontrado." }, 404);
    if (!doc.arquivo_url)
      return response(
        { error: "Este documento está catalogado, mas o arquivo ainda não foi anexado pela equipe." },
        409,
      );

    const { emitirConcessao } = await import("./todogreen-evidences.js");
    const concessao = await emitirConcessao(env, {
      evidenceId: doc.id,
      clientId: doc.client_id,
      ownerId: escopo.workspaceOwnerId,
      para: user?.id || "",
    });
    await logPortalEvent(env, escopo, user, "documento_link_emitido", doc.id, "");
    return response(
      { url: `/api/todogreen/arquivo?t=${concessao.token}`, expiraEm: concessao.expiraEm },
      201,
    );
  }

  // Assistente. Reusa a IA já configurada no Worker; o que muda é o contexto,
  // montado aqui com o cliente da sessão e mais nada.
  if (request.method === "POST" && resource === "assistente") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const pergunta = clean(body.pergunta ?? body.question, 2000);
    if (pergunta.length < 2)
      return response({ error: "Escreva a sua pergunta." }, 400);

    // Recusa antes de chamar o modelo: garantia que não depende de o modelo
    // obedecer à instrução.
    if (foraDoEscopoDoCliente(pergunta)) {
      await logPortalEvent(env, escopo, user, "assistente_fora_escopo", "", pergunta.slice(0, 120));
      return response({ resposta: RESPOSTA_FORA_DE_ESCOPO, foraDeEscopo: true });
    }

    const resumo = await clientOverview(env, escopo);
    const { sql, params } = scopedWhere(escopo);
    const recentes = await env.DB.prepare(
      `SELECT reference, status, service_date, origin, destination, fields_json
         FROM todogreen_client_operations
        WHERE ${sql}
        ORDER BY service_date DESC LIMIT 20`,
    )
      .bind(...params)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

    let contexto;
    try {
      contexto = montarContextoDoCliente({
        cliente: { id: escopo.clientId, nome: escopo.clientName },
        resumo,
        greenScore: resumo.greenScore,
        operacoes: (recentes.results || []).map((linha) => ({
          referencia: linha.reference,
          data: linha.service_date,
          origem: linha.origin,
          destino: linha.destination,
          status: linha.status,
          campos: camposParaCliente(parse(linha.fields_json, {})),
        })),
      });
      // Se algum campo interno escapou para o contexto, a chamada cai aqui em
      // vez de sair pela rede.
      validarContexto(contexto);
    } catch (erro) {
      console.error("contexto do assistente", erro);
      return response({ error: "Não foi possível preparar o assistente." }, 500);
    }

    // O assistente usa a MESMA cadeia de provedores do resto do produto
    // (worker/services/ai.js). Antes chamava `env.AI.run()` num modelo só:
    // se aquele provedor caísse, o assistente do cliente caía junto, sem
    // tentar nenhum outro — enquanto o app interno seguia funcionando porque
    // tinha catorze alternativas. O cliente ficava com a pior resiliência do
    // produto justamente na parte que ele vê.
    //
    // O que NÃO muda: a recusa antes do modelo, o contexto restrito ao
    // próprio cliente e a validação que barra campo interno. A troca é só de
    // motor.
    try {
      const envIa = await envComChavesDoEspaco(env, escopo.workspaceOwnerId);
      // O portal sabia tudo do CLIENTE e nada da To Do Green: perguntado
      // "vocês atendem Curitiba?" ou "qual é o OTD de vocês?", o assistente
      // não tinha o que responder sobre a própria transportadora.
      //
      // Entra só o que está marcado como PÚBLICO no dossiê — é o conteúdo que
      // a empresa já publica em apresentação comercial. Interno e restrito não
      // chegam ao modelo, então não há o que a resposta possa vazar: a regra de
      // confidencialidade do portal continua sendo cumprida pelo que NÃO é
      // enviado, não pela obediência do modelo.
      const perfilPublico = blocoDeContextoDoNegocio(
        await dossiePublicoDoEspaco(env, escopo.workspaceOwnerId),
        { incluirRestrito: false },
      );
      const { ok, result, errors } = await runWithFallback(envIa, {
        prompt: [
          perfilPublico,
          `Dados do cliente (únicos disponíveis):\n${JSON.stringify(contexto, null, 2)}`,
          `Pergunta: ${pergunta}`,
        ].filter(Boolean).join("\n\n"),
        system: INSTRUCAO_ASSISTENTE,
      });
      if (!ok) {
        console.error("assistente do portal: todos os provedores falharam", errors);
        return response({ error: "O assistente está indisponível agora." }, 502);
      }
      const texto = String(result?.content || "").trim();
      if (!texto)
        return response({ error: "O assistente não respondeu. Tente de novo." }, 502);
      await logPortalEvent(env, escopo, user, "assistente_pergunta", "", pergunta.slice(0, 120));
      return response({ resposta: texto, foraDeEscopo: false });
    } catch (erro) {
      console.error("assistente do portal", erro);
      return response({ error: "O assistente está indisponível agora." }, 502);
    }
  }

  // ----- Solicitações -----
  //
  // A porta que a aba prometia. O cliente da solicitação vem do escopo da
  // sessão; não existe caminho para o corpo da requisição escolher outro.
  if (resource === "solicitacoes") {
    if (!clientCan(escopo, "portal:request:create") && request.method !== "GET")
      return response({ error: "Seu acesso não permite abrir solicitações." }, 403);

    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      const linhas = await env.DB.prepare(
        `SELECT id, type, subject, description, urgency, status, fields_json,
                due_at, opened_by, closed_at, created_at, updated_at
           FROM todogreen_client_requests
          WHERE ${sql}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));

      const solicitacoes = (linhas.results || []).map(linhaParaSolicitacao);
      const detalhe = clean(url.searchParams.get("id"), 60);
      let mensagens = [];
      if (detalhe) {
        // Mensagem interna da equipe não sai daqui. Filtrada no SQL, não na
        // tela — esconder no navegador é entregar o dado e pedir para não olhar.
        const conversa = await env.DB.prepare(
          `SELECT id, author_side, author_name, body, created_at
            FROM todogreen_client_request_messages
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND request_id = ? AND internal = 0
            ORDER BY created_at`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, detalhe)
          .all()
          .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
        mensagens = (conversa.results || []).map((m) => ({
          id: m.id,
          lado: m.author_side,
          autor: m.author_name,
          texto: m.body,
          criadaEm: m.created_at,
        }));
      }

      return response({
        solicitacoes,
        mensagens,
        resumo: resumoParaCliente(solicitacoes),
        tipos: TIPOS_LISTA.map((t) => ({
          id: t.id,
          rotulo: t.rotulo,
          descricao: t.descricao,
          prazoHoras: t.prazoHoras,
          obrigatorios: t.obrigatorios,
          camposRotulo: t.camposRotulo,
        })),
      });
    }

    if (request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      // Uma nova mensagem numa solicitação existente.
      const emResposta = clean(body.solicitacaoId, 60);
      if (emResposta) return responderSolicitacao(env, escopo, user, emResposta, body);

      const validacao = validarSolicitacao(body);
      if (!validacao.valido)
        return response({ error: validacao.erros[0], erros: validacao.erros }, 400);

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();
      const { tipo, assunto, descricao, urgencia, campos } = validacao.limpo;
      await env.DB.prepare(
        `INSERT INTO todogreen_client_requests
           (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
            urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.clientId,
          escopo.workspaceOwnerId || "",
          tipo,
          assunto,
          descricao,
          urgencia,
          JSON.stringify(campos),
          prazoDaSolicitacao(tipo, urgencia, agora),
          escopo.email,
          agora,
          agora,
        )
        .run();

      // A descrição vira a primeira mensagem da conversa: sem isso a thread
      // começaria no meio, sem o que foi pedido originalmente.
      await inserirMensagem(env, escopo, id, {
        lado: "cliente",
        email: escopo.email,
        nome: user?.name || escopo.email,
        texto: descricao,
      });

      await logPortalEvent(env, escopo, user, "solicitacao_aberta", id, assunto);
      return response({ ok: true, id }, 201);
    }

    if (request.method === "PATCH") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }
      const id = clean(body.id, 60);
      if (!id) return response({ error: "Informe a solicitação." }, 400);

      const atual = await env.DB.prepare(
        `SELECT id, status FROM todogreen_client_requests
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
        .first();
      if (!atual) return response({ error: "Solicitação não encontrada." }, 404);

      const movimento = aplicarTransicao(atual, {
        lado: "cliente",
        para: clean(body.status, 30),
        autor: escopo.email,
      });
      if (!movimento.ok) return response({ error: movimento.erro }, 409);

      await env.DB.prepare(
        `UPDATE todogreen_client_requests
            SET status = ?, closed_at = ?, closed_by = ?, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
      )
        .bind(
          movimento.status,
          movimento.encerradoEm,
          movimento.encerradoPor,
          new Date().toISOString(),
          escopo.tenantId,
          escopo.workspaceOwnerId,
          escopo.clientId,
          id,
        )
        .run();

      await logPortalEvent(env, escopo, user, "solicitacao_status", id, movimento.status);
      return response({ ok: true, status: movimento.status });
    }

    return response({ error: "Método não permitido." }, 405);
  }

  // ----- Sua avaliação (NPS) -----
  //
  // A voz do cliente que fecha ciclo. Ele responde de 0 a 10; a nota de
  // detrator (0..6) abre automaticamente uma ocorrência com prazo — a mesma
  // todogreen_client_requests type='ocorrencia' que a equipe já trata. NPS que
  // não vira ação é enquete. O cliente da resposta vem do escopo da sessão,
  // nunca do corpo.
  if (resource === "nps") {
    if (request.method === "GET") {
      const { sql, params } = scopedWhere(escopo);
      const linhas = await env.DB.prepare(
        `SELECT id, operation_id, nota, classe, motivo, comentario,
                incident_request_id, created_at
           FROM todogreen_client_nps
          WHERE ${sql}
          ORDER BY created_at DESC
          LIMIT ?`,
      )
        .bind(...params, MAX_LIMIT)
        .all()
        .catch((erro) => (console.error("Portal do cliente: consulta NPS falhou", erro?.message || erro), { results: [] }));

      const respostas = (linhas.results || []).map((l) => ({
        id: l.id,
        operacaoId: l.operation_id || null,
        nota: l.nota,
        classe: l.classe,
        motivo: l.motivo || "",
        comentario: l.comentario || "",
        ocorrenciaId: l.incident_request_id || null,
        respondidoEm: l.created_at,
      }));

      const resumo = calcularNPS(respostas);
      return response({
        respostas,
        resumo: { ...resumo, faixa: faixaNPS(resumo.nps) },
        causas: causasDeInsatisfacao(respostas),
        // A última avaliação orienta a tela: já respondi? o que respondi?
        ultima: respostas[0] || null,
      });
    }

    if (request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return response({ error: "Corpo JSON inválido." }, 400);
      }

      const classe = classificarNPS(body.nota);
      if (classe == null)
        return response({ error: "Informe uma nota de 0 a 10." }, 400);
      const nota = Number(body.nota);
      const motivo = clean(body.motivo, 120);
      const comentario = clean(body.comentario, 500);
      // A operação avaliada é opcional, mas se vier tem de ser do cliente da
      // sessão — nunca aceito um id de operação de outra carteira.
      let operationId = clean(body.operacaoId, 60) || null;
      if (operationId) {
        const dono = await env.DB.prepare(
          `SELECT 1 FROM todogreen_client_operations
            WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
        )
          .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, operationId)
          .first()
          .catch(() => null);
        if (!dono) operationId = null;
      }

      const agora = new Date().toISOString();
      const id = crypto.randomUUID();

      // A ponte que fecha o ciclo: detrator abre ocorrência com responsável e
      // prazo. Mesma tabela, mesmo motor da fila da equipe. Sem isso, uma nota
      // baixa some — e NPS que não trata detrator é enquete, não gestão.
      let incidentId = null;
      if (precisaOcorrencia(nota)) {
        incidentId = crypto.randomUUID();
        const assunto = `Avaliação baixa (nota ${nota})`;
        const descricao = motivo || comentario
          ? `${motivo ? `Motivo: ${motivo}. ` : ""}${comentario}`.trim()
          : "Cliente registrou nota de detrator na pesquisa de satisfação.";
        await env.DB.prepare(
          `INSERT INTO todogreen_client_requests
             (id, tenant_id, client_id, workspace_owner_id, type, subject, description,
              urgency, status, fields_json, due_at, opened_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ocorrencia', ?, ?, 'alta', 'aberta', ?, ?, ?, ?, ?)`,
        )
          .bind(
            incidentId,
            escopo.tenantId,
            escopo.clientId,
            escopo.workspaceOwnerId || "",
            assunto,
            descricao,
            JSON.stringify(operationId ? { origemNps: id, operacaoId: operationId } : { origemNps: id }),
            prazoDaSolicitacao("ocorrencia", "alta", agora),
            escopo.email,
            agora,
            agora,
          )
          .run();
      }

      await env.DB.prepare(
        `INSERT INTO todogreen_client_nps
           (id, tenant_id, workspace_owner_id, client_id, operation_id, nota, classe,
            motivo, comentario, incident_request_id, respondido_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          escopo.tenantId,
          escopo.workspaceOwnerId || "",
          escopo.clientId,
          operationId,
          nota,
          classe,
          motivo,
          comentario,
          incidentId,
          escopo.email,
          agora,
        )
        .run();

      await logPortalEvent(env, escopo, user, "nps_respondido", id, `nota ${nota} (${classe})`);
      return response({ ok: true, id, classe, ocorrenciaId: incidentId }, 201);
    }

    return response({ error: "Método não permitido." }, 405);
  }

  return response({ error: "Rota do portal não encontrada." }, 404);
}

const linhaParaSolicitacao = (linha) => ({
  id: linha.id,
  tipo: linha.type,
  assunto: linha.subject,
  descricao: linha.description,
  urgencia: linha.urgency,
  status: linha.status,
  campos: parse(linha.fields_json, {}),
  prazoEm: linha.due_at,
  abertaPor: linha.opened_by,
  encerradaEm: linha.closed_at,
  criadaEm: linha.created_at,
  atualizadaEm: linha.updated_at,
});

async function inserirMensagem(env, escopo, requestId, { lado, email, nome, texto, interna = 0 }) {
  await env.DB.prepare(
    `INSERT INTO todogreen_client_request_messages
       (id, tenant_id, workspace_owner_id, client_id, request_id, author_side, author_email, author_name,
        body, internal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      escopo.tenantId,
      escopo.workspaceOwnerId,
      escopo.clientId,
      requestId,
      lado,
      clean(email, 160),
      clean(nome, 120),
      clean(texto, 4000),
      interna ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
}

async function responderSolicitacao(env, escopo, user, id, body) {
  const texto = clean(body.mensagem ?? body.texto, 4000);
  if (texto.length < 2) return response({ error: "Escreva a sua mensagem." }, 400);

  const atual = await env.DB.prepare(
    `SELECT id, status FROM todogreen_client_requests
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .first();
  if (!atual) return response({ error: "Solicitação não encontrada." }, 404);
  if (STATUS_SOLICITACAO[statusValido(atual.status)].encerrado)
    return response(
      { error: "Esta solicitação já foi encerrada. Abra uma nova para retomar o assunto." },
      409,
    );

  await inserirMensagem(env, escopo, id, {
    lado: "cliente",
    email: escopo.email,
    nome: user?.name || escopo.email,
    texto,
  });

  // Cliente respondeu: a bola volta para a equipe e o relógio dela volta a
  // correr. Deixar em "aguardando cliente" esconderia o pedido da fila.
  const proximo = statusValido(atual.status) === "aguardando_cliente" ? "em_analise" : atual.status;
  await env.DB.prepare(
    `UPDATE todogreen_client_requests SET status = ?, updated_at = ?
      WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND id = ?`,
  )
    .bind(proximo, new Date().toISOString(), escopo.tenantId, escopo.workspaceOwnerId, escopo.clientId, id)
    .run();

  await logPortalEvent(env, escopo, user, "solicitacao_mensagem", id, texto.slice(0, 120));
  return response({ ok: true, status: proximo });
}

// ----- Administração do portal, do lado interno -----
//
// Fica aqui porque compartilha as tabelas, mas exige acesso interno de gestão:
// é a To Do Green cadastrando clientes e liberando quem entra em cada sala.
export async function handleTodoGreenClients(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const url = new URL(request.url);
  const agora = new Date().toISOString();
  const podeGerenciar = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") ||
    access?.permissions?.includes("clients:manage") ||
    access?.permissions?.includes("clients:assign");
  const podeCriar = podeGerenciar || access?.permissions?.includes("*") || access?.permissions?.includes("crm:manage");
  const podeVerTodos = podeVerTodaCarteira(access);
  const emailSessao = normalizeEmail(user?.email);
  const clientIdDaRota = clean(url.pathname.split("/").filter(Boolean)[3], 60);
  const subRotaDoCliente = clean(url.pathname.split("/").filter(Boolean)[4], 40);

  // Quem tem acesso ao portal deste cliente. Sem esta lista na tela, liberar
  // acesso era cego: o PUT existia e ninguém via quem já estava dentro.
  if (request.method === "GET" && clientIdDaRota && subRotaDoCliente === "portal-usuarios") {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada vê os usuários do portal." }, 403);
    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientIdDaRota).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    const { results } = await env.DB.prepare(
      `SELECT email, role, status, note, created_at, updated_at
         FROM todogreen_client_users
        WHERE tenant_id = ? AND client_id = ?
        ORDER BY created_at`,
    ).bind(TENANT_ID, clientIdDaRota).all();
    return response({
      usuarios: (results || []).map((linha) => ({
        email: linha.email, papel: linha.role, status: linha.status,
        observacao: linha.note, criadoEm: linha.created_at, atualizadoEm: linha.updated_at,
      })),
    });
  }

  if (request.method === "GET") {
    const linhas = await env.DB.prepare(
      `SELECT c.id, c.account_code, c.name, c.legal_name, c.document, c.segment, c.status, c.portal_enabled,
              c.notes, c.fields_json, c.revision, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM todogreen_client_users v
                WHERE v.client_id = c.id AND v.status = 'active') AS pessoas
         FROM todogreen_clients c
        WHERE c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))
        ORDER BY c.name`,
    )
      .bind(TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao)
      .all()
      .catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    const ids = (linhas.results || []).map((item) => item.id);
    let atribuicoes = [];
    if (ids.length) {
      const resultado = await env.DB.prepare(
        `SELECT a.client_id, a.seller_email, a.note, a.updated_at
           FROM todogreen_client_assignments a
           JOIN todogreen_clients c
             ON c.tenant_id=a.tenant_id AND c.id=a.client_id
          WHERE a.tenant_id=? AND a.status='active' AND c.workspace_owner_id=?
            AND c.archived_at IS NULL
            AND (?=1 OR lower(a.seller_email)=?)
          ORDER BY a.seller_email`,
      ).bind(TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
      atribuicoes = resultado.results || [];
    }
    return response({
      clientes: (linhas.results || []).map((cliente) => ({
        id: cliente.id,
        accountCode: cliente.account_code || accountCode(cliente.id),
        name: cliente.name,
        legalName: cliente.legal_name,
        document: cliente.document,
        segment: cliente.segment,
        status: cliente.status,
        portalEnabled: cliente.portal_enabled === 1,
        portalUserCount: Number(cliente.pessoas || 0),
        notes: cliente.notes,
        revision: cliente.revision,
        createdAt: cliente.created_at,
        updatedAt: cliente.updated_at,
        crm: crmFields(parse(cliente.fields_json, {}), cliente.name),
        vendedores: atribuicoes
          .filter((item) => item.client_id === cliente.id)
          .map((item) => ({ email: item.seller_email, observacao: item.note, atualizadoEm: item.updated_at })),
      })),
      acesso: { podeGerenciar, podeEditar: true, podeCriar, somenteCarteira: !podeVerTodos, vendedor: emailSessao },
    });
  }

  if (request.method === "DELETE" && clientIdDaRota) {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada pode excluir clientes." }, 403);
    const cliente = await env.DB.prepare(
      "SELECT id, name FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientIdDaRota).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const [oportunidades, contratos, operacoes] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_opportunities WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_contracts WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM todogreen_client_operations WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?").bind(TENANT_ID, access.ownerId, clientIdDaRota).first(),
    ]);
    const vinculos = {
      oportunidades: Number(oportunidades?.total || 0),
      contratos: Number(contratos?.total || 0),
      operacoes: Number(operacoes?.total || 0),
    };
    if (Object.values(vinculos).some((total) => total > 0)) {
      const detalhes = [
        vinculos.oportunidades ? `${vinculos.oportunidades} oportunidade(s)` : "",
        vinculos.contratos ? `${vinculos.contratos} contrato(s)` : "",
        vinculos.operacoes ? `${vinculos.operacoes} operação(ões)` : "",
      ].filter(Boolean).join(", ");
      return response({
        error: `Não é possível excluir "${cliente.name}": existem ${detalhes} vinculados. Exclua ou mova esses registros antes de tentar novamente.`,
        vinculos,
      }, 409);
    }

    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_clients
          SET archived_at = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL`,
    ).bind(agora, user.id, agora, TENANT_ID, access.ownerId, clientIdDaRota).run();
    if (!meta?.changes) return response({ error: "Cliente não encontrado." }, 404);
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "archived", resourceType: "client", resourceId: clientIdDaRota,
      clientId: clientIdDaRota, before: { name: cliente.name }, after: { archivedAt: agora },
    });
    return response({ ok: true, id: clientIdDaRota });
  }

  if (request.method === "PATCH" && clientIdDaRota) {
    const body = await request.json().catch(() => ({}));
    const atual = await env.DB.prepare(
      `SELECT c.* FROM todogreen_clients c
        WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))`,
    ).bind(clientIdDaRota, TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).first();
    if (!atual) return response({ error: "Cliente não encontrado." }, 404);
    const revisao = Number(body.revision);
    if (!Number.isFinite(revisao) || revisao <= 0)
      return response({ error: "Informe a revisão do cliente que você leu." }, 400);
    const crm = crmFields({ ...parse(atual.fields_json, {}), ...(body.crm || {}) }, clean(body.name ?? atual.name, 200));
    // Liberar/bloquear o portal era impossível pela tela: o PATCH nem aceitava
    // o campo. Sem isso, cliente novo só entrava por migração de banco.
    const portalEnabled = body.portalEnabled === undefined
      ? atual.portal_enabled
      : (body.portalEnabled ? 1 : 0);
    const { meta } = await env.DB.prepare(
      `UPDATE todogreen_clients
          SET name = ?, legal_name = ?, document = ?, segment = ?, status = ?, notes = ?,
              portal_enabled = ?, fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
    ).bind(
      clean(body.name ?? atual.name, 200) || atual.name,
      clean(body.legalName ?? atual.legal_name, 200),
      clean(body.document ?? atual.document, 40),
      clean(body.segment ?? atual.segment, 80),
      clean(body.status ?? atual.status, 20) || "ativo",
      clean(body.notes ?? atual.notes, 1000),
      portalEnabled,
      JSON.stringify(crm), user.id, agora,
      clientIdDaRota, TENANT_ID, access.ownerId, revisao,
    ).run();
    if (!meta?.changes)
      return response({ error: "Este cliente mudou enquanto você editava. Recarregue e tente novamente." }, 409);
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "updated", resourceType: "client", resourceId: clientIdDaRota,
      clientId: clientIdDaRota,
      before: { name: atual.name, legalName: atual.legal_name, document: atual.document, segment: atual.segment, status: atual.status, notes: atual.notes, crm: parse(atual.fields_json, {}) },
      after: { name: clean(body.name ?? atual.name, 200), legalName: clean(body.legalName ?? atual.legal_name, 200), document: clean(body.document ?? atual.document, 40), segment: clean(body.segment ?? atual.segment, 80), status: clean(body.status ?? atual.status, 20), notes: clean(body.notes ?? atual.notes, 1000), crm },
    });
    return response({ ok: true, id: clientIdDaRota });
  }

  if (!podeCriar)
    return response({ error: "Seu papel não pode criar ou importar clientes." }, 403);

  if (request.method === "POST" && clientIdDaRota === "import") {
    const body = await request.json().catch(() => ({}));
    const clientes = Array.isArray(body.clientes) ? body.clientes : [];
    if (!clientes.length) return response({ error: "Envie ao menos um cliente para importar." }, 400);
    if (clientes.length > 100) return response({ error: "Importe no máximo 100 clientes por lote." }, 400);

    const preparados = clientes.map((item) => ({
      id: clean(item?.id, 60),
      nome: clean(item?.nome ?? item?.name, 200),
      razaoSocial: clean(item?.razaoSocial ?? item?.legalName, 200),
      documento: clean(item?.documento ?? item?.document, 40),
      segmento: clean(item?.segmento ?? item?.segment, 80),
      status: clean(item?.status, 20) || "ativo",
      observacoes: clean(item?.observacoes ?? item?.notes, 1000),
      crm: item?.crm || {},
    }));
    if (preparados.some((item) => !item.id || item.nome.length < 2))
      return response({ error: "Cada cliente precisa de identificador estável e nome válido." }, 400);

    const placeholders = preparados.map(() => "?").join(",");
    const existentes = preparados.length
      ? await env.DB.prepare(
          `SELECT id,fields_json FROM todogreen_clients
            WHERE tenant_id = ? AND workspace_owner_id = ? AND id IN (${placeholders})`,
        ).bind(TENANT_ID, access.ownerId || user.id, ...preparados.map((item) => item.id)).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }))
      : { results: [] };
    const crmExistente = new Map((existentes.results || []).map((item) => [item.id, parse(item.fields_json, {})]));
    for (const item of preparados)
      item.crm = mergeImportedCrm(crmExistente.get(item.id) || {}, item.crm, item.nome);

    for (let inicio = 0; inicio < preparados.length; inicio += 40) {
      const lote = preparados.slice(inicio, inicio + 40);
      const statements = [];
      for (const item of lote) {
        statements.push(env.DB.prepare(
          `INSERT INTO todogreen_clients
             (id, account_code, tenant_id, workspace_owner_id, name, legal_name, document, segment,
              status, portal_enabled, notes, fields_json, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             legal_name = excluded.legal_name,
             document = excluded.document,
             segment = excluded.segment,
             status = excluded.status,
             notes = excluded.notes,
             fields_json = excluded.fields_json,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at,
             archived_at = NULL,
             revision = todogreen_clients.revision + 1
           WHERE todogreen_clients.tenant_id = excluded.tenant_id
             AND todogreen_clients.workspace_owner_id = excluded.workspace_owner_id`,
        ).bind(
          item.id, accountCode(item.id), TENANT_ID, access.ownerId || user.id, item.nome, item.razaoSocial,
          item.documento, item.segmento, item.status, item.observacoes,
          JSON.stringify(item.crm), user.id, user.id, agora, agora,
        ));
        statements.push(env.DB.prepare(
          `INSERT INTO todogreen_client_assignments
             (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
           ON CONFLICT(tenant_id, client_id, seller_email) DO UPDATE SET
             status = 'active', note = excluded.note, assigned_by = excluded.assigned_by,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(), TENANT_ID, item.id, emailSessao,
          "Importado e atribuído automaticamente à carteira da sessão.", user.id, agora, agora,
        ));
      }
      await env.DB.batch(statements);
    }
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: "imported", resourceType: "client", details: `${preparados.length} cliente(s) importado(s).`,
      after: { ids: preparados.map((item) => item.id) },
    });
    return response({ ok: true, importados: preparados.length, vendedor: emailSessao }, 201);
  }

  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const nome = clean(body.nome ?? body.name, 200);
    if (nome.length < 2)
      return response({ error: "Informe o nome do cliente." }, 400);
    const id = clean(body.id, 60) || crypto.randomUUID();
    const existente = await env.DB.prepare(
      "SELECT workspace_owner_id FROM todogreen_clients WHERE id = ?",
    ).bind(id).first();
    if (existente && existente.workspace_owner_id !== access.ownerId)
      return response({ error: "Este identificador já pertence a outro espaço." }, 409);
    await env.DB.prepare(
      `INSERT INTO todogreen_clients
         (id, account_code, tenant_id, workspace_owner_id, name, legal_name, document, segment,
          status, portal_enabled, notes, fields_json, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         legal_name = excluded.legal_name,
         document = excluded.document,
         segment = excluded.segment,
         status = excluded.status,
         portal_enabled = excluded.portal_enabled,
         notes = excluded.notes,
         fields_json = excluded.fields_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at,
         revision = todogreen_clients.revision + 1
       WHERE todogreen_clients.tenant_id = excluded.tenant_id
         AND todogreen_clients.workspace_owner_id = excluded.workspace_owner_id`,
    )
      .bind(
        id,
        accountCode(id),
        TENANT_ID,
        access.ownerId || user.id,
        nome,
        clean(body.razaoSocial ?? body.legalName, 200),
        clean(body.documento ?? body.document, 40),
        clean(body.segmento ?? body.segment, 80),
        clean(body.status, 20) || "ativo",
        body.portalLiberado === true || body.portalEnabled === true ? 1 : 0,
        clean(body.observacoes ?? body.notes, 1000),
        JSON.stringify(crmFields(body.crm || {}, nome)),
        user.id,
        user.id,
        agora,
        agora,
      )
      .run();
    await registrarAuditoriaTodoGreen(env, {
      access, user, action: existente ? "updated" : "created", resourceType: "client",
      resourceId: id, clientId: id, after: { name: nome, legalName: clean(body.razaoSocial ?? body.legalName, 200), document: clean(body.documento ?? body.document, 40), segment: clean(body.segmento ?? body.segment, 80), status: clean(body.status, 20) || "ativo" },
    });
    return response({ ok: true, id, nome }, 201);
  }

  // Pessoas do cliente: quem, daquele cliente, entra na sala dele.
  if (request.method === "PUT") {
    if (!podeGerenciar)
      return response({ error: "Somente uma pessoa autorizada pode gerenciar usuários do portal." }, 403);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const clientId = clean(body.clienteId ?? body.clientId, 60);
    const email = normalizeEmail(body.email);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    if (!isValidEmail(email))
      return response({ error: "Informe um e-mail válido." }, 400);

    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const papel = clientPortalRole(body.papel ?? body.role);
    await env.DB.prepare(
      `INSERT INTO todogreen_client_users
         (id, tenant_id, client_id, email, role, status, permissions_json, note,
          invited_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, client_id, email) DO UPDATE SET
         role = excluded.role,
         status = excluded.status,
         permissions_json = excluded.permissions_json,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        TENANT_ID,
        clientId,
        email,
        papel,
        body.status === "inactive" ? "inactive" : "active",
        JSON.stringify(permissionsForRole(papel)),
        clean(body.observacao ?? body.note, 240),
        user.id,
        agora,
        agora,
      )
      .run();

    // Convite por e-mail: a pessoa entra no portal com uma conta comum do
    // produto, criada com este mesmo e-mail. Sem o convite, "liberar acesso"
    // era gravar uma linha que ninguém ficava sabendo. O envio nunca derruba a
    // liberação: sem BREVO_API_KEY, a tela mostra o aviso e o link é passado
    // por fora.
    let conviteEnviado = false;
    if (body.status !== "inactive" && emailEnabled(env) && body.enviarConvite !== false) {
      const nomeCliente = await env.DB.prepare(
        "SELECT name FROM todogreen_clients WHERE id = ? AND tenant_id = ?",
      ).bind(clientId, TENANT_ID).first();
      const linkPortal = `${url.origin}/portal-cliente`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1e1b35">
        <div style="background:#173d31;border-radius:14px;padding:20px;text-align:center">
          <span style="color:#fff;font-size:18px;font-weight:bold">To Do Green · Portal do Cliente</span>
        </div>
        <h2 style="margin:24px 0 8px">Seu acesso ao portal foi liberado</h2>
        <p style="color:#555;margin:0 0 18px">Você foi cadastrado como <strong>${escMail(papel)}</strong> no portal de <strong>${escMail(nomeCliente?.name || "sua empresa")}</strong>. Acompanhe entregas, comprovantes, indicadores e solicitações em um lugar só.</p>
        <p style="color:#555;margin:0 0 18px">Crie sua conta (ou entre) usando exatamente este e-mail: <strong>${escMail(email)}</strong>.</p>
        <div style="text-align:center;margin:22px 0">
          <a href="${linkPortal}" style="display:inline-block;background:#0b9f8f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold">Abrir o portal</a>
        </div>
        <p style="color:#888;font-size:12px;margin:20px 0 0">Se você não esperava este acesso, ignore esta mensagem.</p>
      </div>`;
      conviteEnviado = await sendEmail(env, email, "Seu acesso ao Portal To Do Green", html)
        .then(() => true)
        .catch(() => false);
    }
    return response({ ok: true, email, papel, conviteEnviado, emailConfigurado: emailEnabled(env) });
  }

  if (request.method === "DELETE") {
    const email = normalizeEmail(url.searchParams.get("email"));
    const clientId = clean(url.searchParams.get("cliente") ?? url.searchParams.get("clientId"), 60);
    if (!email) return response({ error: "Informe o e-mail." }, 400);
    if (!clientId) return response({ error: "Informe de qual empresa remover o acesso." }, 400);
    const cliente = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    await env.DB.prepare(
      "DELETE FROM todogreen_client_users WHERE tenant_id = ? AND client_id = ? AND email = ?",
    )
      .bind(TENANT_ID, clientId, email)
      .run();
    return response({ ok: true });
  }

  return response({ error: "Método não permitido." }, 405);
}

// Enviar e-mail para um contato — salvando-o automaticamente no CRM se ainda
// não existir (pedido da titular: "enviar e-mail pra contato não salvo, aí
// salva automático"). O contato mora no cliente selecionado (crm.contacts),
// que é o modelo que já existe — nada de segunda coleção de contatos. O envio
// reusa o mesmo canal transacional (Brevo) do resto do produto; sem a chave no
// cofre, a tela avisa em vez de falhar com erro de rede.
export async function handleTodoGreenSendEmail(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  if (request.method !== "POST") return response({ error: "Método não permitido." }, 405);
  let body = {};
  try { body = await request.json(); }
  catch { return response({ error: "Corpo JSON inválido." }, 400); }

  const to = normalizeEmail(body.to ?? body.para);
  const subject = clean(body.subject ?? body.assunto, 200);
  const texto = clean(body.body ?? body.mensagem ?? body.texto, 8000);
  const contactName = clean(body.contactName ?? body.contato, 160);
  const clientId = clean(body.clientId ?? body.clienteId, 60);
  if (!isValidEmail(to)) return response({ error: "Informe um e-mail de destino válido." }, 400);
  if (subject.length < 1) return response({ error: "Informe o assunto." }, 400);
  if (texto.length < 1) return response({ error: "Escreva a mensagem." }, 400);
  if (!emailEnabled(env))
    return response({ error: "O envio de e-mail ainda não está ligado neste ambiente (falta a credencial de e-mail no cofre)." }, 503);

  const podeVerTodos = podeVerTodaCarteira(access);
  const emailSessao = normalizeEmail(user?.email);

  // Auto-salvar o contato no cliente escolhido, respeitando a carteira: um
  // vendedor com carteira restrita só grava em clientes atribuídos a ele.
  let salvouContato = false;
  if (clientId) {
    const cliente = await env.DB.prepare(
      `SELECT c.id, c.name, c.fields_json
         FROM todogreen_clients c
        WHERE c.id = ? AND c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL
          AND (? = 1 OR EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = c.tenant_id AND a.client_id = c.id
               AND a.status = 'active' AND lower(a.seller_email) = ?
          ))`,
    ).bind(clientId, TENANT_ID, access.ownerId, podeVerTodos ? 1 : 0, emailSessao).first();
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);
    const crmAtual = parse(cliente.fields_json, {});
    const contatos = Array.isArray(crmAtual.contacts) ? crmAtual.contacts : [];
    const jaExiste = contatos.some((c) => normalizeEmail(c?.email) === to);
    if (!jaExiste) {
      const novo = {
        id: crypto.randomUUID(),
        name: contactName || to.split("@")[0],
        email: to,
        relationshipRole: "Contato",
        source: "E-mail enviado pelo espaço",
      };
      const crmNovo = crmFields({ ...crmAtual, contacts: [...contatos, novo] }, cliente.name);
      await env.DB.prepare(
        `UPDATE todogreen_clients
            SET fields_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(JSON.stringify(crmNovo), user.id, new Date().toISOString(), clientId, TENANT_ID, access.ownerId).run();
      salvouContato = true;
    }
  }

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1e2b27;white-space:pre-wrap">${escMail(texto)}</div>`;
  const enviado = await sendEmail(env, to, subject, html).then(() => true).catch(() => false);
  if (!enviado) return response({ error: "Não foi possível enviar o e-mail agora. Tente novamente." }, 502);

  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "email_sent", resourceType: "contact", resourceId: to,
    clientId: clientId || null, details: `E-mail "${subject}" enviado para ${to}.`,
  });
  return response({ ok: true, salvouContato });
}

export async function handleTodoGreenClientAssignments(request, env, access, user) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);
  const podeAtribuir = ["owner", "admin"].includes(access?.role) ||
    access?.permissions?.includes("*") ||
    access?.permissions?.includes("clients:assign");
  if (!podeAtribuir)
    return response({ error: "Você não pode definir carteiras comerciais." }, 403);

  const url = new URL(request.url);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT a.id, a.client_id AS clientId, c.name AS clientName,
              a.seller_email AS sellerEmail, a.note, a.status,
              a.created_at AS createdAt, a.updated_at AS updatedAt
         FROM todogreen_client_assignments a
         JOIN todogreen_clients c ON c.id = a.client_id AND c.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND c.workspace_owner_id = ? AND a.status = 'active'
        ORDER BY c.name, a.seller_email`,
    ).bind(TENANT_ID, access.ownerId).all().catch((erro) => (console.error("Portal do cliente: consulta falhou", erro?.message || erro), { results: [] }));
    return response({ atribuicoes: rows.results || [] });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => ({}));
    const clientId = clean(body.clientId ?? body.clienteId, 60);
    const sellerEmail = normalizeEmail(body.sellerEmail ?? body.vendedorEmail);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    if (!isValidEmail(sellerEmail))
      return response({ error: "Informe o e-mail do vendedor." }, 400);
    const client = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!client) return response({ error: "Cliente não encontrado." }, 404);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO todogreen_client_assignments
         (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(tenant_id, client_id, seller_email) DO UPDATE SET
         status = 'active', note = excluded.note, assigned_by = excluded.assigned_by,
         updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, clientId, sellerEmail,
      clean(body.note ?? body.observacao, 240), user.id, now, now,
    ).run();
    return response({ ok: true, clientId, sellerEmail });
  }

  if (request.method === "DELETE") {
    const clientId = clean(url.searchParams.get("clientId"), 60);
    const sellerEmail = normalizeEmail(url.searchParams.get("sellerEmail"));
    if (!clientId || !sellerEmail)
      return response({ error: "Informe o cliente e o vendedor." }, 400);
    const client = await env.DB.prepare(
      "SELECT id FROM todogreen_clients WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL",
    ).bind(TENANT_ID, access.ownerId, clientId).first();
    if (!client) return response({ error: "Cliente não encontrado." }, 404);
    await env.DB.prepare(
      `UPDATE todogreen_client_assignments SET status = 'inactive', updated_at = ?
        WHERE tenant_id = ? AND client_id = ? AND lower(seller_email) = ?`,
    ).bind(new Date().toISOString(), TENANT_ID, clientId, sellerEmail).run();
    return response({ ok: true });
  }

  return response({ error: "Método não permitido." }, 405);
}
