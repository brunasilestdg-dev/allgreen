// ===== Campos do CRM e da inteligência da conta =====
//
// Contrato: normalização PURA do `fields_json` de todogreen_clients. Entrada:
// o objeto cru que vem da tela, da importação de planilha ou da pesquisa de
// inteligência; saída: um objeto de chaves fechadas — texto cortado, número
// limitado (`finite`), URL só http(s), LinkedIn só do domínio linkedin.com,
// contatos normalizados. Nunca lança. `crmFields(valor, empresa)` é a régua
// única de gravação; `mergeImportedCrm(atual, importado, empresa)` funde uma
// reimportação sem rebaixar conta "Morno" e sem perder contato legado.
// Autorização: nenhuma aqui — quem grava é a API interna de clientes
// (carteira + revision). Estes campos são INTERNOS (scores, potencial,
// plano de conta, contatos): o portal do cliente nunca os recebe.

import { normalizeEmail } from "../../src/features/logistics/customerPortalDomain.js";
import { normalizeCrmContacts } from "../../src/features/logistics/crmContactNormalizationDomain.js";
import { clean } from "./todogreen-client-helpers.js";

const CRM_TEMPERATURES = new Set(["Quente", "Morno", "Frio"]);

const normalizeText = (value) => clean(value, 500).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const finite = (value, min = 0, max = 100) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 0;
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

export const crmFields = (value = {}, companyName = "") => {
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
