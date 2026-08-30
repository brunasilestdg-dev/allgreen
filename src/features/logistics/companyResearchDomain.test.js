import { describe, expect, it } from "vitest";
import { buildCompanyResearchPlans, buildPublicAccountEnrichment, classifyCompanyResearch, lookupPublicCompanyRegistry, reconcileResearchedContacts, resolveWebsiteEnrichment } from "../../../worker/services/todogreen-client-intelligence.js";

const result = (title, url, snippet = "") => ({ title, url, snippet, provider: "teste" });

describe("inteligência externa comercial", () => {
  it("separa inteligência e faz duas buscas brasileiras de contatos", () => {
    const plans = buildCompanyResearchPlans({ company: "Adidas", segment: "Varejo", year: 2026 });
    // A busca do decisor com cargo (diretor/gerente/head) roda SEMPRE — a
    // titular precisa do nome de quem assina já na pesquisa padrão da conta.
    expect(plans).toHaveLength(9);
    expect(new Set(plans.flatMap((item) => item.kinds))).toEqual(new Set(["identity", "registry", "supplier", "rfq", "esg", "news", "segment", "contacts"]));
    expect(plans.every((item) => item.query.includes("Brasil"))).toBe(true);
    expect(plans.filter((item) => /diretor OR gerente OR head/.test(item.query))).toHaveLength(1);
    expect(buildCompanyResearchPlans({ company: "Adidas", segment: "Varejo", year: 2026, focus: "contacts" })).toHaveLength(9);
    const focused = buildCompanyResearchPlans({
      company: "Adidas", segment: "Varejo", year: 2026, focus: "contacts",
      knownContacts: [{ name: "Thiago Souza" }, { name: "Fernanda Vasco" }],
    });
    expect(focused).toHaveLength(10);
    expect(focused.filter((item) => item.kinds.includes("known_contacts"))).toEqual([
      expect.objectContaining({
        knownContactNames: ["Thiago Souza", "Fernanda Vasco"],
        query: expect.stringMatching(/"Thiago Souza".*"Adidas"/),
      }),
    ]);
    expect(focused.filter((item) => item.kinds.includes("contacts")).every((item) => /linkedin\.com\/in|LinkedIn/.test(item.query))).toBe(true);
  });

  it("pesquisa todos os contatos existentes em lotes sem o limite antigo", () => {
    const knownContacts = Array.from({ length: 27 }, (_, index) => ({ name: `Contato Número ${index + 1}` }));
    const plans = buildCompanyResearchPlans({ company: "Empresa Brasil", segment: "Indústria", year: 2026, focus: "contacts", knownContacts });
    const contactPlans = plans.filter((item) => item.kinds.includes("known_contacts"));
    expect(contactPlans).toHaveLength(6);
    expect(contactPlans.flatMap((item) => item.knownContactNames)).toHaveLength(27);
  });
  it("não confunde vaga com RFQ e só confirma oportunidade aberta de transporte", () => {
    const report = classifyCompanyResearch({ company: "Empresa X", segment: "Varejo", searches: [
      { kind: "rfq", results: [
        result("Vaga Comprador de Fretes", "https://jobs.example.com/1", "contratação de analista de compras"),
        result("RFQ aberta para transportadoras", "https://empresa-x.com/rfq", "Inscrições e recebimento de propostas para transporte e frete"),
        result("Notícia de expansão", "https://news.example.com/x", "nova unidade logística"),
      ] },
      { kind: "identity", results: [] }, { kind: "supplier", results: [] }, { kind: "esg", results: [] }, { kind: "news", results: [] }, { kind: "segment", results: [] },
    ], checkedAt: "2026-08-10T00:00:00.000Z" });
    expect(report.openRfqs).toHaveLength(1);
    expect(report.openRfqs[0].url).toContain("empresa-x.com/rfq");
    expect(report.excludedVacancies).toBe(1);
  });

  it("não transforma conteúdo educativo ou modelo de RFP em oportunidade comercial", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "rfq", results: [
        result("BID, RFI, RFQ, RFP: afinal o que significa?", "https://abrafac.org.br/rfq", "Guia sobre compras estratégicas e transporte."),
        result("Adidas RFP solution template", "https://scribd.com/adidas-rfp", "Modelo de RFP em inglês."),
        result("RFI, RFP e RFQ: diferenças", "https://pipefy.com/pt-br/blog/rfq", "Como funciona cada solicitação."),
      ] },
    ] });
    expect(report.openRfqs).toHaveLength(0);
    expect(report).not.toHaveProperty("rfqWatchlist");
  });

  it("separa notícias da empresa e do segmento", () => {
    const report = classifyCompanyResearch({ company: "Amazon", segment: "E-commerce", searches: [
      { kind: "news", results: [result("Amazon amplia operação", "https://news.example.com/amazon")] },
      { kind: "segment", results: [result("E-commerce e logística sustentável", "https://news.example.com/setor")] },
      { kind: "identity", results: [] }, { kind: "supplier", results: [] }, { kind: "rfq", results: [] }, { kind: "esg", results: [] },
    ] });
    expect(report.companyNews[0].category).toBe("company_news");
    expect(report.segmentNews[0].category).toBe("segment_news");
  });

  it("sugere segmento e transforma perfil público de procurement em contato verificável", () => {
    const report = classifyCompanyResearch({ company: "Loja Exemplo", segment: "", searches: [
      { kind: "identity", results: [result("Loja Exemplo | LinkedIn", "https://www.linkedin.com/company/loja-exemplo", "Rede brasileira de varejo com sede em São Paulo, Brasil")] },
      { kind: "contacts", results: [result("Ana Souza - Gerente de Procurement - Loja Exemplo | LinkedIn", "https://br.linkedin.com/in/ana-souza", "São Paulo, Brasil. Atualmente trabalha na Loja Exemplo com procurement de logística, transportes e supply chain.")] },
      { kind: "supplier", results: [] }, { kind: "rfq", results: [] }, { kind: "esg", results: [] }, { kind: "news", results: [] }, { kind: "segment", results: [] },
    ] });
    expect(report.suggestedSegment.value).toBe("Varejo");
    expect(report.contactCandidates).toEqual([expect.objectContaining({
      name: "Ana Souza",
      linkedinUrl: "https://br.linkedin.com/in/ana-souza",
      source: "Pesquisa web",
      country: "Brasil",
      verifiedBrazil: true,
      currentEmploymentVerified: true,
      employmentStatus: "current",
      researchVersion: 12,
    })]);
    expect(report.version).toBe(12);
    expect(report.suggestedHeadquarters?.value).toBe("São Paulo, SP");
  });

  it("consulta o cadastro público por CNPJ e estrutura razão social, sede e atividade", async () => {
    const registry = await lookupPublicCompanyRegistry("00.000.000/0001-91", {
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          razao_social: "BANCO DO BRASIL S.A.", nome_fantasia: "BANCO DO BRASIL",
          municipio: "BRASILIA", uf: "DF", cnae_fiscal_descricao: "Bancos múltiplos", descricao_situacao_cadastral: "ATIVA",
        }),
      }),
    });
    expect(registry).toEqual(expect.objectContaining({
      cnpj: "00000000000191", legalName: "BANCO DO BRASIL S.A.", city: "BRASILIA", state: "DF", status: "ATIVA",
    }));
  });

  it("prioriza os dados cadastrais do CNPJ no autopreenchimento sugerido", () => {
    const report = classifyCompanyResearch({
      company: "Banco do Brasil", segment: "", searches: [],
      publicRegistry: {
        cnpj: "00000000000191", legalName: "BANCO DO BRASIL S.A.", tradeName: "BANCO DO BRASIL",
        city: "BRASILIA", state: "DF", mainActivity: "Serviços financeiros e banco", status: "ATIVA",
        sourceUrl: "https://api.opencnpj.org/00000000000191",
      },
    });
    expect(report.suggestedLegalName).toEqual(expect.objectContaining({ value: "BANCO DO BRASIL S.A.", confidence: "alta" }));
    expect(report.suggestedHeadquarters).toEqual(expect.objectContaining({ value: "BRASILIA, DF", confidence: "alta" }));
    expect(report.suggestedSegment?.value).toBe("Serviços financeiros");
  });

  it("converte a pesquisa em todos os campos estruturados exibidos em Dados da conta", () => {
    const enrichment = buildPublicAccountEnrichment({
      company: "Empresa Brasil",
      line: { legal_name: "", segment: "" },
      fields: {
        website: "https://empresabrasil.com.br/",
        linkedinUrl: "https://www.linkedin.com/company/empresa-brasil/",
        headquarters: "",
        qualification: {},
      },
      report: {
        suggestedLegalName: { value: "EMPRESA BRASIL S.A." },
        suggestedSegment: { value: "Indústria" },
        suggestedHeadquarters: { value: "São Paulo, SP" },
        publicRegistry: { status: "ATIVA", sourceUrl: "https://api.opencnpj.org/00000000000191" },
        logisticsSignals: [{ url: "https://empresabrasil.com.br/logistica" }],
        procurementPeople: [], openRfqs: [],
        esg: { signals: [{ url: "https://empresabrasil.com.br/esg" }] },
      },
    });
    expect(enrichment).toEqual(expect.objectContaining({
      filledLegalName: "EMPRESA BRASIL S.A.", filledSegment: "Indústria",
      filledHeadquarters: "São Paulo, SP", filledWebsite: "https://empresabrasil.com.br/",
      filledLinkedin: "https://www.linkedin.com/company/empresa-brasil/",
    }));
    expect(enrichment.qualification).toEqual(expect.objectContaining({
      publicProfile: expect.stringContaining("Cadastro público de CNPJ"),
      logisticsSignals: expect.stringContaining("evidência(s) pública(s)"),
      esgCommitments: expect.stringContaining("agenda ESG"),
    }));
    expect(enrichment.filledQualification).toEqual(["perfil público", "sinais logísticos", "sinais ESG"]);
  });

  it("não usa matéria da Mundo Logística como site da Amazon e corrige o preenchimento antigo", () => {
    const report = classifyCompanyResearch({ company: "Amazon", segment: "E-commerce", searches: [
      { kind: "identity", results: [
        result("Amazon amplia malha logística", "https://mundologistica.com.br/noticias/amazon-amplia-malha", "Notícia sobre a operação da Amazon no Brasil."),
        result("Amazon Brasil", "https://www.amazon.com.br/", "Site da Amazon Brasil."),
      ] },
    ] });
    expect(report.officialWebsite?.url).toBe("https://www.amazon.com.br/");

    expect(resolveWebsiteEnrichment({
      company: "Amazon",
      existingWebsite: "https://mundologistica.com.br/noticias/amazon-amplia-malha",
      previousResearchWebsite: "https://mundologistica.com.br/noticias/amazon-amplia-malha",
      officialWebsite: report.officialWebsite.url,
    })).toEqual({
      value: "https://www.amazon.com.br/",
      filled: false,
      corrected: true,
      removed: false,
    });
  });

  it("descarta os perfis globais retornados na pesquisa da Adidas", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "contacts", results: [
        result("Matt Kelly - adidas | LinkedIn", "https://www.linkedin.com/in/mattyk", "Senior Manager Non-Trade Procurement para Marketing e Retail na North America."),
        result("Ian Aranjo - adidas | LinkedIn", "https://ca.linkedin.com/in/ian-aranjo", "Scarborough, Ontario, Canada. Procurement e supply chain."),
        result("Vanessa Faria - Teya | LinkedIn", "https://www.linkedin.com/in/vanessa-faria-77524020", "Matosinhos, Porto, Portugal. Procurement."),
        result("Amaury Parrot - adidas | LinkedIn", "https://ch.linkedin.com/in/amauryparrot", "Global Procurement Logistics & Distribution em Lucerne, Switzerland."),
        result("Dana Chen - adidas | LinkedIn", "https://ch.linkedin.com/in/danakaday", "Zurich, Switzerland. Supply chain professional."),
        result("Gustavo Macias - adidas | LinkedIn", "https://www.linkedin.com/in/gustavo-macias-7b31a633", "Procurement e logística sem localização pública."),
      ] },
    ] });
    expect(report.contactCandidates).toHaveLength(0);
    expect(report.contactSearchQuality.foreignRejected).toBeGreaterThanOrEqual(3);
    expect(report.contactSearchQuality.noBrazilEvidenceRejected).toBeGreaterThanOrEqual(1);
  });

  it("combina as duas consultas de contatos sem perder resultados válidos", () => {
    const report = classifyCompanyResearch({ company: "Empresa Brasil", segment: "Indústria", searches: [
      { kind: "contacts", results: [result("Ana Souza - Procurement Logístico - Empresa Brasil | LinkedIn", "https://br.linkedin.com/in/ana", "São Paulo, Brasil. Atualmente trabalha na Empresa Brasil com compras de frete e transportes.")] },
      { kind: "contacts", results: [result("Bruno Lima - Gerente de Suprimentos - Empresa Brasil | LinkedIn", "https://br.linkedin.com/in/bruno", "Curitiba, Brasil. Atualmente trabalha na Empresa Brasil com supply chain e contratação de transportadoras.")] },
    ] });
    expect(report.contactCandidates.map((item) => item.name)).toEqual(["Ana Souza", "Bruno Lima"]);
  });

  it("só inclui lideranças de logística com evidência pública de Brasil", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "contacts", results: [
        { ...result("Nadiah Maluf - Gerente Logistica / Transportes - adidas", "https://br.linkedin.com/in/nadiah-maluf", "Atualmente trabalha na adidas como responsável pela área de transportes e pela relação com transportadoras no Brasil."), searchScope: "brazil-procurement-logistics" },
        { ...result("Mikaelly M. - Gerente de Compras na adidas", "https://www.linkedin.com/in/mikaellym", "São Paulo, Brasil. Atualmente trabalha na adidas com gestão estratégica de compras, supply chain e varejo."), searchScope: "brazil-procurement-logistics" },
      ] },
    ] });
    expect(report.contactCandidates.map((item) => item.name)).toEqual(["Nadiah Maluf", "Mikaelly M."]);
    expect(report.contactSearchQuality.accepted).toBe(2);
  });

  it("não usa o texto da consulta como prova de atuação no Brasil", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "contacts", results: [{
        ...result("Mikaelly M. - Gerente de Compras na adidas", "https://www.linkedin.com/in/mikaellym", "Gestão estratégica de compras e supply chain na adidas."),
        searchScope: "brazil-procurement-logistics",
      }] },
    ] });
    expect(report.contactCandidates).toHaveLength(0);
    expect(report.reviewCandidates).toEqual([expect.objectContaining({ rejectionReason: "no-brazil-evidence" })]);
  });

  it("rejeita ex-funcionário mesmo quando o perfil ainda menciona procurement e a empresa", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "contacts", results: [
        result(
          "Joana Silva - Procurement de Logística - adidas | LinkedIn",
          "https://br.linkedin.com/in/joana-silva",
          "São Paulo, Brasil. Ex-funcionária da adidas. Atuou em compras de frete e transportes de 2021 - 2024.",
        ),
      ] },
    ] });
    expect(report.procurementPeople).toHaveLength(0);
    expect(report.contactCandidates).toHaveLength(0);
    expect(report.formerContacts).toEqual([expect.objectContaining({ name: "Joana Silva" })]);
    expect(report.contactSearchQuality.formerEmploymentRejected).toBe(1);
    expect(report.reviewCandidates).toHaveLength(0);
  });

  it("não inclui perfil quando a fonte não comprova que o vínculo ainda é atual", () => {
    const report = classifyCompanyResearch({ company: "Empresa Brasil", segment: "Indústria", searches: [
      { kind: "contacts", results: [
        result(
          "Carlos Lima | LinkedIn",
          "https://br.linkedin.com/in/carlos-lima",
          "São Paulo, Brasil. Experiência em procurement, logística e transportes. Empresa Brasil.",
        ),
      ] },
    ] });
    expect(report.contactCandidates).toHaveLength(0);
    expect(report.contactSearchQuality.currentEmploymentUnverified).toBe(1);
  });

  it("não confunde uma experiência anterior em outra empresa com o vínculo atual na empresa-alvo", () => {
    const report = classifyCompanyResearch({ company: "Adidas", segment: "Varejo", searches: [
      { kind: "contacts", results: [result(
        "Paula Costa - Procurement de Transportes na adidas | LinkedIn",
        "https://br.linkedin.com/in/paula-costa",
        "São Paulo, Brasil. Atualmente atua na adidas em compras de frete. Ex-funcionária da Empresa Anterior.",
      )] },
    ] });
    expect(report.contactCandidates).toEqual([expect.objectContaining({ name: "Paula Costa", employmentStatus: "current" })]);
    expect(report.contactSearchQuality.formerEmploymentRejected).toBe(0);
  });

  it("limpa contatos web desatualizados e preserva ex-contato manual apenas como histórico", () => {
    const result = reconcileResearchedContacts({
      existingContacts: [
        { name: "Contato Web Antigo", source: "Pesquisa web", linkedinUrl: "https://linkedin.com/in/antigo", active: true },
        { name: "Joana Silva", source: "Cadastro manual", linkedinUrl: "https://linkedin.com/in/joana", active: true },
        { name: "Contato Atual", source: "Pesquisa web", linkedinUrl: "https://linkedin.com/in/atual", active: true },
      ],
      contactCandidates: [{ name: "Contato Atual", linkedinUrl: "https://linkedin.com/in/atual", currentEmploymentVerified: true }],
      formerContacts: [{ name: "Joana Silva", linkedinUrl: "https://linkedin.com/in/joana" }],
      checkedAt: "2026-08-13T12:00:00.000Z",
    });
    expect(result.staleWebContactsRemoved).toBe(1);
    expect(result.formerContactsMarkedInactive).toBe(1);
    expect(result.contacts).toEqual([
      expect.objectContaining({ name: "Joana Silva", active: false, employmentStatus: "former" }),
      expect.objectContaining({ name: "Contato Atual", active: true }),
    ]);
  });

  it("nunca exclui automaticamente contato com telefone ou e-mail", () => {
    const reconciled = reconcileResearchedContacts({
      existingContacts: [
        { name: "Contato Importado", source: "Pesquisa web", email: "contato@empresa.com", phone: "+55 11 99999-0000", active: true },
      ],
      contactCandidates: [],
      formerContacts: [],
      checkedAt: "2026-08-13T12:00:00.000Z",
    });
    expect(reconciled.staleWebContactsRemoved).toBe(0);
    expect(reconciled.contacts).toEqual([expect.objectContaining({
      name: "Contato Importado",
      email: "contato@empresa.com",
      phone: "+55 11 99999-0000",
      active: true,
      employmentStatus: "unknown",
    })]);
  });

  it("localiza o LinkedIn de um contato já cadastrado sem recriá-lo", () => {
    const report = classifyCompanyResearch({ company: "Amazon", segment: "E-commerce", knownContacts: [
      { name: "Fernanda Vasco", phone: "+55 11 98839-5335", email: "fevasco@amazon.com" },
    ], searches: [
      { kind: "known_contacts", results: [{
        ...result("Fernanda Vasco - Amazon | LinkedIn", "https://www.linkedin.com/in/fernanda-vasco", "Fernanda Vasco trabalha na Amazon."),
        searchScope: "brazil-known-contact",
        knownContactNames: ["Fernanda Vasco"],
      }] },
    ] });
    expect(report.knownContactProfiles).toEqual([expect.objectContaining({ title: "Fernanda Vasco", url: "https://www.linkedin.com/in/fernanda-vasco" })]);
    expect(report.contactCandidates).toEqual([expect.objectContaining({
      name: "Fernanda Vasco",
      linkedinUrl: "https://www.linkedin.com/in/fernanda-vasco",
      source: "Pesquisa web (LinkedIn do contato)",
      currentEmploymentVerified: true,
      employmentStatus: "current",
    })]);
  });

  it("completa o LinkedIn conhecido sem promover vínculo incerto a procurement atual", () => {
    const report = classifyCompanyResearch({ company: "Amazon", segment: "E-commerce", knownContacts: [
      { name: "Fernanda Vasco", phone: "+55 11 98839-5335", email: "fevasco@amazon.com" },
    ], searches: [{ kind: "known_contacts", results: [{
      ...result("Fernanda Vasco - Amazon | LinkedIn", "https://www.linkedin.com/in/fernanda-vasco", "Perfil profissional de Fernanda Vasco. Experiência em empresas de tecnologia."),
      knownContactNames: ["Fernanda Vasco"],
    }] }] });
    expect(report.contactCandidates).toEqual([expect.objectContaining({
      name: "Fernanda Vasco",
      linkedinUrl: "https://www.linkedin.com/in/fernanda-vasco",
      currentEmploymentVerified: false,
      employmentStatus: "unknown",
    })]);
    expect(report.procurementPeople).toHaveLength(0);
  });

  it("distingue a marca Três Corações do município homônimo", () => {
    const report = classifyCompanyResearch({ company: "Três Corações", segment: "", searches: [
      { kind: "identity", results: [
        result("Prefeitura de Três Corações", "https://www.trescoracoes.mg.gov.br/", "Portal do município e da cidade de Três Corações, Minas Gerais."),
        result("Grupo 3corações", "https://www.3coracoes.com.br/", "Empresa brasileira de cafés e alimentos com sede em Eusébio, CE."),
      ] },
      { kind: "news", results: [
        result("Turismo em Três Corações", "https://noticias.example.com/cidade", "A prefeitura e o município divulgaram atrações da cidade de Três Corações."),
        result("Grupo 3corações amplia indústria", "https://noticias.example.com/grupo-3coracoes", "A empresa de cafés Grupo 3corações anunciou expansão no Brasil."),
      ] },
    ] });
    expect(report.officialWebsite?.url).toBe("https://www.3coracoes.com.br/");
    expect(report.suggestedHeadquarters?.value).toBe("Eusébio, CE");
    expect(report.companyNews.map((item) => item.url)).toEqual(["https://noticias.example.com/grupo-3coracoes"]);
  });

  it("desambigua nomes empresariais homônimos de cidades na consulta", () => {
    const plans = buildCompanyResearchPlans({ company: "Três Corações", segment: "Alimentos e bebidas", year: 2026 });
    expect(plans.find((item) => item.kinds.includes("identity"))?.query).toContain("-prefeitura");
    expect(plans.filter((item) => item.kinds.includes("contacts")).every((item) => item.query.includes("-prefeitura"))).toBe(true);
  });

  it("não associa perfil sem evidência brasileira a contato salvo sem país ou telefone", () => {
    const report = classifyCompanyResearch({ company: "Amazon", segment: "E-commerce", knownContacts: [
      { name: "Fernanda Vasco", email: "fevasco@amazon.com" },
    ], searches: [{ kind: "known_contacts", results: [{
      ...result("Fernanda Vasco - Amazon | LinkedIn", "https://www.linkedin.com/in/fernanda-vasco", "Fernanda Vasco trabalha na Amazon."),
      knownContactNames: ["Fernanda Vasco"],
    }] }] });
    expect(report.contactCandidates).toHaveLength(0);
  });

  it("não repete perfil corporativo como notícia nem duplica a empresa nas tendências", () => {
    const profile = result(
      "GRUPO Caffeine Army - Mais que um grupo",
      "https://www.linkedin.com/company/caffeine-army",
      "### Company Size 51-200 employees 179 associated members Founded 2016 ### Overview",
    );
    const duplicatedNews = result(
      "Caffeine Army anuncia nova operação logística",
      "https://noticias.example.com/caffeine-army-logistica",
      "A Caffeine Army anunciou investimento em distribuição no Brasil.",
    );
    const report = classifyCompanyResearch({ company: "Caffeine Army", segment: "Alimentos e bebidas", searches: [
      { kind: "news", results: [profile, duplicatedNews] },
      { kind: "segment", results: [profile, duplicatedNews, result("Logística de alimentos avança no Brasil", "https://setor.example.com/logistica-alimentos", "Tendências de transporte e distribuição para alimentos e bebidas.")] },
    ] });
    expect(report.companyNews.map((item) => item.url)).toEqual(["https://noticias.example.com/caffeine-army-logistica"]);
    expect(report.segmentNews.map((item) => item.url)).toEqual(["https://setor.example.com/logistica-alimentos"]);
    expect(report.companyNews[0].snippet).not.toContain("###");
  });
});

describe("correções pedidas pela titular na pesquisa da conta", () => {
  it("página de portal de vaga (Gupy e afins) nunca vira notícia da empresa", () => {
    const gupy = result(
      "Grupo Três Corações — Carreiras",
      "https://trescoracoes.gupy.io/",
      "Conheça o Grupo Três Corações e nossas oportunidades.",
    );
    const noticia = result(
      "Três Corações amplia centro de distribuição",
      "https://noticias.example.com/tres-coracoes-cd",
      "O Grupo Três Corações anunciou novo CD com foco em logística.",
    );
    const report = classifyCompanyResearch({
      company: "Três Corações",
      segment: "Alimentos",
      searches: [{ kind: "news", results: [gupy, noticia] }],
    });
    expect(report.companyNews.map((item) => item.url)).toEqual(["https://noticias.example.com/tres-coracoes-cd"]);
  });

  it("URL descartada pela titular não volta na pesquisa seguinte e fica registrada", () => {
    const indesejada = result(
      "Três Corações — informação errada",
      "https://errada.example.com/pagina",
      "Conteúdo que a Três Corações não reconhece como seu, com logística citada.",
    );
    const report = classifyCompanyResearch({
      company: "Três Corações",
      segment: "Alimentos",
      searches: [{ kind: "news", results: [indesejada] }],
      discardedUrls: ["https://errada.example.com/pagina"],
    });
    expect(report.companyNews).toEqual([]);
    expect(report.descartes).toContain("https://errada.example.com/pagina");
  });

  it("contato cadastrado à mão não vira 'ex' por coincidência de nome; identidade forte vira", () => {
    const formerContacts = [
      { name: "Ana Lima", linkedinUrl: "https://linkedin.com/in/ana-lima-x" },
      { name: "Bruno Costa", linkedinUrl: "https://linkedin.com/in/bruno-costa-real" },
    ];
    const { contacts, formerContactsMarkedInactive } = reconcileResearchedContacts({
      existingContacts: [
        // Manual, só o nome coincide: fica ativa.
        { id: "c1", name: "Ana Lima", phone: "11 99999-0000" },
        // Manual com o MESMO LinkedIn do desligamento: vira histórico.
        { id: "c2", name: "Bruno Costa", linkedinUrl: "https://linkedin.com/in/bruno-costa-real" },
        // Descoberta pela web, nome coincide: a régua antiga continua valendo.
        { id: "c3", name: "Ana Lima", source: "Pesquisa web", email: "ana@empresa.com" },
      ],
      contactCandidates: [],
      formerContacts,
      checkedAt: "2026-08-30T00:00:00.000Z",
    });
    const porId = Object.fromEntries(contacts.map((item) => [item.id, item]));
    expect(porId.c1.active).not.toBe(false);
    expect(porId.c1.employmentStatus).not.toBe("former");
    expect(porId.c2.employmentStatus).toBe("former");
    expect(porId.c2.active).toBe(false);
    expect(porId.c3.employmentStatus).toBe("former");
    expect(formerContactsMarkedInactive).toBe(2);
  });
});
