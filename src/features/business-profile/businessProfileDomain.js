export const BUSINESS_PACKS = [
  {
    id: "direcao",
    label: "Estratégia e direção",
    description: "Objetivos, indicadores, decisões, preços e análise do negócio.",
    pages: ["estrategia", "metas", "resultados", "analise-dados", "precificacao"],
  },
  {
    id: "clientes",
    label: "Clientes e vendas",
    description: "CRM, funil, contatos, propostas, atendimento e portal do cliente.",
    pages: [
      "vendas",
      "funil",
      "contatos",
      "caixa",
      "orcamentos",
      "portal-cliente",
      "formularios-publicos",
    ],
  },
  {
    id: "agenda",
    label: "Agenda e prestação de serviços",
    description: "Agendamentos, reuniões, horas trabalhadas e faturamento por tempo.",
    pages: ["agendamentos", "reunioes", "horas"],
  },
  {
    id: "comercio",
    label: "Produtos, pedidos e compras",
    description: "Catálogo, estoque, pedidos, fornecedores e cotações de compra.",
    pages: ["produtos", "compras"],
  },
  {
    id: "financeiro",
    label: "Financeiro e cobrança",
    description: "Caixa, contas, resultado mensal, recorrências e cobrança Pix.",
    pages: ["financeiro", "contas", "resultado-mes", "cobranca"],
  },
  {
    id: "operacao",
    label: "Operação e projetos",
    description: "Tarefas, processos, projetos, jurídico, capacidade, quadros e planejamento diário.",
    pages: [
      "operacao",
      "estrutura",
      "planejar",
      "portfolio",
      "processos",
      "juridico",
      "capacidade",
      "quadro",
      "diagramas",
      "quadro-rapido",
    ],
  },
  {
    id: "equipe",
    label: "Equipe e colaboração",
    description: "Trabalho pessoal, chat, desenvolvimento, certificados, histórico e gestão da equipe.",
    pages: [
      "meu-trabalho",
      "chat-corporativo",
      "desenvolvimento",
      "certificacoes",
      "historico",
    ],
  },
  {
    id: "conteudo",
    label: "Conteúdo, marca e criatividade",
    description: "Marketing, calendário editorial, imagens, vídeos, apresentações e criação.",
    pages: [
      "marketing",
      "conteudo",
      "criacao-local",
      "laboratorio-gratuito",
      "estudio",
      "midia",
      "editor-codigo",
      "apresentacoes",
      "assinatura",
    ],
  },
  {
    id: "presenca-digital",
    label: "Presença digital e captação",
    description: "Sites, formulários públicos, materiais e portais para clientes.",
    pages: ["sites", "formularios-publicos", "portal-cliente"],
  },
  {
    id: "conhecimento",
    label: "Documentos, dados e conhecimento",
    description: "Documentos, wiki, bases, planilhas, notebook, notas, análises e memória.",
    pages: [
      "documentos",
      "wiki",
      "analise",
      "bases",
      "planilhas",
      "notebook",
      "notas-conectadas",
      "memoria-busca",
      "ideias",
    ],
  },
  {
    id: "automacao",
    label: "IA, agentes e automações",
    description: "Agentes, regras automáticas, integrações, ferramentas inteligentes e contingências.",
    pages: [
      "automacoes",
      "agentes",
      "integracoes",
      "ferramentas",
      "central-crescimento",
    ],
  },
  {
    id: "logistica",
    label: "Logística, frota e entregas",
    description: "Veículos, fretes, rotas, entregas e apoio à movimentação de produtos.",
    pages: ["frota", "produtos", "compras"],
  },
];

const COMMON = ["direcao", "clientes", "financeiro", "operacao", "automacao"];
const SERVICE = [...COMMON, "agenda", "conhecimento", "presenca-digital"];
const RETAIL = [...COMMON, "comercio", "presenca-digital", "conteudo"];

export const BUSINESS_TYPES = [
  {
    id: "autonomo",
    label: "Autônomo ou profissional liberal",
    category: "Independentes e criadores",
    description: "Quem vende o próprio trabalho, serviço ou conhecimento.",
    packs: [...SERVICE, "conteudo"],
  },
  {
    id: "criador",
    label: "Influenciador ou criador de conteúdo",
    category: "Independentes e criadores",
    description: "Conteúdo, audiência, campanhas, parcerias, produtos e comunidade.",
    packs: [
      "direcao",
      "clientes",
      "agenda",
      "financeiro",
      "conteudo",
      "presenca-digital",
      "conhecimento",
      "automacao",
      "comercio",
    ],
  },
  {
    id: "agencia",
    label: "Agência criativa ou de marketing",
    category: "Independentes e criadores",
    description: "Campanhas, clientes, produção criativa, projetos e horas.",
    packs: [...SERVICE, "conteudo", "equipe"],
  },
  {
    id: "consultoria",
    label: "Consultoria",
    category: "Serviços profissionais",
    description: "Projetos, propostas, entregas, horas, documentos e clientes.",
    packs: [...SERVICE, "equipe"],
  },
  {
    id: "advocacia",
    label: "Advocacia ou serviços jurídicos",
    category: "Serviços profissionais",
    description: "Clientes, documentos, prazos, projetos, horas e conhecimento.",
    packs: [...SERVICE, "equipe"],
  },
  {
    id: "contabilidade",
    label: "Contabilidade ou serviços financeiros",
    category: "Serviços profissionais",
    description: "Carteira de clientes, documentos, prazos, processos e recorrências.",
    packs: [...SERVICE, "equipe"],
  },
  {
    id: "rh",
    label: "RH, recrutamento ou headhunter",
    category: "Serviços profissionais",
    description: "Vagas, candidatos, entrevistas, processos, clientes e projetos.",
    packs: [...SERVICE, "equipe"],
  },
  {
    id: "educacao",
    label: "Educação, curso ou mentoria",
    category: "Serviços profissionais",
    description: "Alunos, turmas, agenda, conteúdo, cobrança e comunidade.",
    packs: [...SERVICE, "conteudo", "equipe"],
  },
  {
    id: "saude",
    label: "Saúde, clínica ou atendimento terapêutico",
    category: "Serviços profissionais",
    description: "Agenda, relacionamento, documentos, equipe e financeiro.",
    packs: [...SERVICE, "equipe"],
  },
  {
    id: "imobiliario",
    label: "Imobiliária, corretagem ou construção",
    category: "Serviços profissionais",
    description: "Leads, imóveis ou obras, propostas, projetos e documentos.",
    packs: [...SERVICE, "comercio", "equipe"],
  },
  {
    id: "beleza",
    label: "Salão, barbearia, estética ou beleza",
    category: "Serviços locais",
    description: "Agenda, profissionais, clientes, produtos, vendas e recorrência.",
    packs: [...SERVICE, "comercio", "conteudo", "equipe"],
  },
  {
    id: "pet",
    label: "Petshop, banho e tosa ou cuidados animais",
    category: "Serviços locais",
    description: "Clientes, agenda, serviços, estoque, pedidos e lembretes.",
    packs: [...SERVICE, "comercio", "conteudo"],
  },
  {
    id: "lavanderia",
    label: "Lavanderia",
    category: "Serviços locais",
    description: "Recebimento, pedidos, etapas, clientes, entregas e cobrança.",
    packs: [...SERVICE, "comercio", "logistica"],
  },
  {
    id: "manutencao",
    label: "Manutenção, assistência ou serviço em campo",
    category: "Serviços locais",
    description: "Ordens, agenda, equipe, peças, visitas, rotas e cobrança.",
    packs: [...SERVICE, "comercio", "logistica", "equipe"],
  },
  {
    id: "eventos",
    label: "Eventos, fotografia ou produção",
    category: "Serviços locais",
    description: "Agenda, propostas, fornecedores, projetos, conteúdo e entregas.",
    packs: [...SERVICE, "comercio", "conteudo", "equipe"],
  },
  {
    id: "restaurante",
    label: "Bar, restaurante, café ou alimentação",
    category: "Comércio e alimentação",
    description: "Produtos, pedidos, mesas, estoque, compras, clientes e caixa.",
    packs: [...RETAIL, "agenda", "equipe"],
  },
  {
    id: "varejo",
    label: "Loja física, bazar ou comércio",
    category: "Comércio e alimentação",
    description: "Produtos, estoque, pedidos, fornecedores, clientes e financeiro.",
    packs: [...RETAIL, "equipe"],
  },
  {
    id: "mercado",
    label: "Mercado, mercearia ou sacolão",
    category: "Comércio e alimentação",
    description: "Estoque, compras, pedidos, fornecedores, equipe e resultado.",
    packs: [...RETAIL, "logistica", "equipe"],
  },
  {
    id: "ecommerce",
    label: "Loja online ou e-commerce",
    category: "Comércio e alimentação",
    description: "Catálogo, pedidos, conteúdo, clientes, logística e análise.",
    packs: [...RETAIL, "logistica", "automacao"],
  },
  {
    id: "automotivo",
    label: "Loja de veículos ou negócio automotivo",
    category: "Comércio e alimentação",
    description: "Veículos, leads, propostas, documentos, agenda e vendas.",
    packs: [...RETAIL, "agenda", "logistica", "conhecimento"],
  },
  {
    id: "transportes",
    label: "Transportadora, entregas ou logística",
    category: "Operações e produção",
    description: "Frota, fretes, rotas, clientes, documentos, equipe e custos.",
    packs: [...COMMON, "logistica", "equipe", "conhecimento"],
  },
  {
    id: "industria",
    label: "Indústria, fábrica ou produção",
    category: "Operações e produção",
    description: "Produção, estoque, compras, projetos, qualidade, equipe e custos.",
    packs: [...COMMON, "comercio", "logistica", "equipe", "conhecimento"],
  },
  {
    id: "rural",
    label: "Agronegócio ou produção rural",
    category: "Operações e produção",
    description: "Produção, insumos, compras, vendas, logística e financeiro.",
    packs: [...COMMON, "comercio", "logistica", "conhecimento"],
  },
  {
    id: "ong",
    label: "ONG, associação, igreja ou projeto social",
    category: "Organizações",
    description: "Projetos, pessoas, eventos, documentos, comunicação e recursos.",
    packs: [
      "direcao",
      "clientes",
      "agenda",
      "financeiro",
      "operacao",
      "equipe",
      "conteudo",
      "presenca-digital",
      "conhecimento",
      "automacao",
    ],
  },
  {
    id: "outro",
    label: "Outro tipo de negócio",
    category: "Outros",
    description: "Monte uma combinação própria sem ficar preso a um segmento.",
    packs: BUSINESS_PACKS.map((pack) => pack.id),
  },
];

export const BUSINESS_TYPE_GROUPS = BUSINESS_TYPES.reduce((groups, type) => {
  const group = groups.find((item) => item.label === type.category);
  if (group) group.options.push(type);
  else groups.push({ label: type.category, options: [type] });
  return groups;
}, []);

const industry = (id, label, profileTypeId, activities) => ({
  id,
  label,
  profileTypeId,
  activities: [...activities, "Outra atividade desta categoria"],
});

// Catálogo aberto: organiza a escolha sem transformar a atividade em regra fixa.
// "Outra atividade" e a descrição livre garantem cobertura para negócios novos,
// híbridos ou muito específicos que ainda não tenham um nome conhecido.
export const BUSINESS_INDUSTRY_CATALOG = [
  industry("alimentacao", "Alimentação e bebidas", "restaurante", [
    "Restaurante",
    "Lanchonete e fast food",
    "Pizzaria",
    "Padaria e confeitaria",
    "Cafeteria",
    "Bar e pub",
    "Sorveteria e açaiteria",
    "Food truck",
    "Açougue e peixaria",
    "Hortifruti e mercearia",
    "Supermercado",
    "Adega e distribuidora de bebidas",
    "Delivery de marmitas",
    "Buffet e cozinha industrial",
    "Produção de alimentos congelados",
  ]),
  industry("beleza", "Beleza e estética", "beleza", [
    "Salão de cabeleireiro",
    "Barbearia",
    "Clínica de estética",
    "Manicure, pedicure e esmalteria",
    "Design de sobrancelhas e cílios",
    "Estúdio de tatuagem e piercing",
    "Spa e casa de massagem",
    "Maquiador(a) autônomo(a)",
    "Depilação e bronzeamento",
    "Consultoria de imagem e estilo",
  ]),
  industry("saude", "Saúde e bem-estar", "saude", [
    "Clínica médica",
    "Consultório odontológico",
    "Farmácia e drogaria",
    "Consultório de psicologia",
    "Clínica de fisioterapia",
    "Consultório de nutrição",
    "Laboratório de análises clínicas",
    "Ótica",
    "Fonoaudiologia",
    "Terapia ocupacional",
    "Clínica de vacinação",
    "Centro de diagnóstico por imagem",
    "Academia e personal trainer",
  ]),
  industry("pets", "Mercado pet", "pet", [
    "Petshop",
    "Clínica veterinária",
    "Banho e tosa",
    "Passeador de cães (dog walker)",
    "Hotel e creche para pets",
    "Adestrador",
    "Pet sitter",
    "Loja de alimentação e acessórios para animais",
  ]),
  industry("servicos-locais", "Serviços domésticos e manutenção", "manutencao", [
    "Lavanderia",
    "Assistência técnica de celulares e computadores",
    "Assistência técnica de eletrodomésticos",
    "Oficina mecânica e borracharia",
    "Chaveiro",
    "Costureira e alfaiataria",
    "Sapateiro",
    "Serviços de limpeza e diarista",
    "Limpeza pós-obra",
    "Higienização de estofados",
    "Eletricista",
    "Encanador",
    "Pedreiro e pintor",
    "Jardinagem e paisagismo",
    "Montagem de móveis",
  ]),
  industry("profissionais", "Serviços profissionais e corporativos (B2B)", "consultoria", [
    "Escritório de contabilidade",
    "Escritório de advocacia",
    "Consultoria empresarial e financeira",
    "Agência de marketing e publicidade",
    "Escritório de arquitetura e engenharia",
    "Agência de recursos humanos e recrutamento",
    "Serviços de tradução e interpretação",
    "Design gráfico e identidade visual",
    "Auditoria e compliance",
    "Pesquisa de mercado",
    "Relações públicas e assessoria de imprensa",
    "Coworking e escritório virtual",
  ]),
  industry("educacao", "Educação e treinamento", "educacao", [
    "Escola infantil, fundamental ou média",
    "Faculdade e universidade",
    "Escola de idiomas",
    "Autoescola (CFC)",
    "Aulas particulares e reforço escolar",
    "Escola de música, arte ou dança",
    "Cursos profissionalizantes",
    "Treinamento corporativo",
    "Creche e berçário",
    "Plataforma de ensino online",
    "Preparatório para concursos e vestibulares",
  ]),
  industry("tecnologia", "Digital e tecnologia", "agencia", [
    "Influenciador digital e criador de conteúdo",
    "Produtor de infoprodutos",
    "E-commerce e loja virtual",
    "Agência de desenvolvimento de software e apps",
    "Hospedagem e suporte de TI",
    "Gestor de tráfego e social media",
    "Startup de tecnologia",
    "Consultoria em cibersegurança",
    "Software como serviço (SaaS)",
    "Integração de sistemas e dados",
    "Assistência remota e help desk",
  ]),
  industry("transportes", "Transporte, turismo e logística", "transportes", [
    "Motorista de aplicativo e táxi",
    "Entregador de aplicativo e motoboy",
    "Transportadora de cargas",
    "Empresa de mudanças",
    "Aluguel de veículos e locadora",
    "Estacionamento",
    "Agência de turismo e viagens",
    "Operador logístico e centro de distribuição",
    "Courier e entregas expressas",
    "Fretamento de passageiros",
    "Armazenagem e self storage",
  ]),
  industry("varejo", "Comércio varejista e lojas", "varejo", [
    "Loja de roupas e vestuário",
    "Loja de calçados",
    "Loja de cosméticos e perfumaria",
    "Papelaria e livraria",
    "Loja de material de construção",
    "Floricultura",
    "Loja de eletrônicos e informática",
    "Joalheria e bijuterias",
    "Loja de móveis e decoração",
    "Loja de autopeças",
    "Brechó e bazar",
    "Loja de brinquedos",
    "Loja de utilidades domésticas",
    "Franquia de varejo",
  ]),
  industry("eventos", "Entretenimento, eventos e lazer", "eventos", [
    "Academia, crossfit e estúdio de pilates",
    "Cinema e teatro",
    "Casa noturna e balada",
    "Produtora de eventos",
    "Salão de festas e buffet",
    "Assessoria e cerimonial de casamentos",
    "Fotografia e videomaker",
    "Parque de diversão e recreação infantil",
    "Locação de equipamentos para festas",
    "Banda, DJ e produção musical",
  ]),
  industry("imobiliario", "Imobiliário e construção", "imobiliario", [
    "Imobiliária",
    "Construtora e incorporadora",
    "Corretor(a) de imóveis",
    "Administração de imóveis e locações",
    "Marcenaria e móveis planejados",
    "Vidraçaria",
    "Serralheria",
    "Empresa de reformas",
    "Topografia e georreferenciamento",
    "Paisagismo e urbanismo",
  ]),
  industry("rural", "Agronegócio e mundo rural", "rural", [
    "Produtor agrícola, fazenda ou sítio",
    "Pecuária e criação de animais",
    "Apicultura e produção de mel",
    "Piscicultura e criação de peixes",
    "Hidroponia e hortas urbanas",
    "Comércio de defensivos e maquinário agrícola",
    "Cooperativa agrícola",
    "Beneficiamento e armazenamento de grãos",
    "Viveiro de mudas e sementes",
    "Serviços de máquinas agrícolas",
  ]),
  industry("industria", "Indústria, manufatura e produção", "industria", [
    "Gráfica e comunicação visual",
    "Indústria têxtil e confecção",
    "Fábrica de móveis",
    "Reciclagem e gestão de resíduos",
    "Cervejaria e fabricação de bebidas",
    "Olaria e fabricação de tijolos e telhas",
    "Tornearia e usinagem",
    "Fabricação de alimentos",
    "Indústria química e cosmética",
    "Metalurgia",
    "Embalagens e plásticos",
    "Manutenção industrial",
  ]),
  industry("especializados", "Serviços especializados e de nicho", "autonomo", [
    "Despachante veicular, documental ou aduaneiro",
    "Detetive particular",
    "Personal organizer",
    "Leiloeiro",
    "Agência de matrimônio e matchmaking",
    "Tradutor juramentado",
    "Avaliador de imóveis ou obras de arte",
    "Perito e assistente técnico",
    "Consultoria genealógica",
    "Serviço de cartório e documentação",
  ]),
  industry("artesanato", "Economia criativa, artesanato e feito à mão", "autonomo", [
    "Ateliê de cerâmica",
    "Saboaria e cosmética natural",
    "Encadernação e papelaria personalizada",
    "Produção de velas artesanais",
    "Marcenaria criativa e resina",
    "Costura criativa e bordado",
    "Joias e acessórios artesanais",
    "Ilustração e arte autoral",
    "Produtos personalizados e brindes",
  ]),
  industry("cuidados", "Cuidados específicos e terceira idade", "saude", [
    "Casa de repouso e residencial para idosos",
    "Agência de cuidadores de idosos",
    "Transporte médico e ambulância particular",
    "Terapias holísticas",
    "Consultoria de amamentação e doula",
    "Podologia",
    "Home care",
    "Centro-dia para idosos",
    "Cuidados para pessoas com deficiência",
  ]),
  industry("facilities", "Segurança, limpeza e facilities", "manutencao", [
    "Segurança patrimonial e vigilância",
    "Transporte de valores",
    "Instalação de alarmes, CFTV e automação residencial",
    "Dedetizadora e controle de pragas",
    "Gestão de condomínios e síndico profissional",
    "Limpeza de fachadas e trabalho em altura",
    "Portaria, recepção e zeladoria",
    "Manutenção predial",
    "Gestão de resíduos corporativos",
  ]),
  industry("automotivo", "Veículos e transportes específicos", "automotivo", [
    "Lava-rápido e estética automotiva",
    "Guincho e reboque",
    "Transporte escolar",
    "Instalação de som, acessórios e insulfilm",
    "Concessionária de veículos novos ou seminovos",
    "Desmanche e peças usadas",
    "Funilaria e pintura",
    "Centro automotivo",
    "Vistoria veicular",
    "Aluguel de máquinas e veículos pesados",
  ]),
  industry("varejo-nicho", "Varejo de nicho", "varejo", [
    "Sex shop",
    "Tabacaria e headshop",
    "Antiquário",
    "Loja de artigos religiosos e esotéricos",
    "Loja de suplementos alimentares",
    "Numismática e colecionáveis",
    "Ótica de armações e lentes",
    "Loja de produtos naturais",
    "Loja geek e de jogos",
    "Armarinho e aviamentos",
  ]),
  industry("midia", "Mundo digital, mídia e tecnologias", "criador", [
    "Editor de vídeo ou áudio freelancer",
    "Podcaster",
    "Estúdio de desenvolvimento de jogos",
    "Streamer de jogos ou variedades",
    "Consultoria em inteligência artificial e automação",
    "Gestão de comunidades online",
    "Provedor de internet de bairro",
    "Canal de mídia e newsletter",
    "Produtora audiovisual",
    "Agência de influenciadores",
  ]),
  industry("esportes", "Esportes, lazer e aventura", "educacao", [
    "Escola de surf, mergulho ou paraquedismo",
    "Guia de ecoturismo e trilhas",
    "Aluguel de equipamentos esportivos",
    "Campo de paintball ou airsoft",
    "Hípica e centro de equitação",
    "Clube de tiro",
    "Escolinha esportiva",
    "Quadra e arena esportiva",
    "Organização de campeonatos",
  ]),
  industry("hospedagem", "Hospedagem e turismo", "consultoria", [
    "Hotel",
    "Pousada e hostel",
    "Aluguel por temporada",
    "Camping e glamping",
    "Resort",
    "Guia turístico",
    "Operadora de turismo",
    "Centro de convenções",
  ]),
  industry("financas", "Finanças, seguros e crédito", "contabilidade", [
    "Corretora de seguros",
    "Correspondente bancário",
    "Cooperativa de crédito",
    "Consultoria de investimentos",
    "Empresa de cobrança",
    "Fintech",
    "Factoring e antecipação de recebíveis",
    "Câmbio e remessas",
    "Administradora de consórcios",
  ]),
  industry("atacado", "Atacado, distribuição e comércio exterior", "varejo", [
    "Distribuidora e atacadista",
    "Importadora e exportadora",
    "Representação comercial",
    "Trading company",
    "Distribuição de alimentos",
    "Distribuição de medicamentos",
    "Comércio exterior e desembaraço",
    "Central de compras",
  ]),
  industry("energia", "Energia, água e meio ambiente", "industria", [
    "Energia solar e renovável",
    "Instalação e manutenção elétrica industrial",
    "Saneamento e tratamento de água",
    "Consultoria ambiental",
    "Coleta e tratamento de resíduos",
    "Mineração e extração",
    "Distribuição de gás",
    "Eficiência energética",
  ]),
  industry("comunicacao", "Comunicação, editorial e cultura", "agencia", [
    "Editora",
    "Jornal, revista ou portal de notícias",
    "Rádio e televisão",
    "Assessoria de imprensa",
    "Biblioteca e centro cultural",
    "Museu e galeria",
    "Produção musical e gravadora",
    "Licenciamento de marcas e conteúdo",
  ]),
  industry("organizacoes", "Organizações, associações e setor público", "ong", [
    "ONG e instituto",
    "Associação e sindicato",
    "Igreja e organização religiosa",
    "Condomínio residencial ou comercial",
    "Órgão público e autarquia",
    "Partido e organização política",
    "Fundação",
    "Cooperativa",
    "Clube e entidade recreativa",
  ]),
  industry("funerario", "Serviços funerários e memoriais", "manutencao", [
    "Funerária",
    "Cemitério e crematório",
    "Plano de assistência funeral",
    "Translado funerário",
    "Marmoraria e memoriais",
  ]),
  industry("outros", "Outros e negócios híbridos", "outro", [
    "Empresa com várias atividades",
    "Negócio ainda em definição",
    "Atividade nova ou não listada",
  ]),
];

export function industryCategoryById(categoryId) {
  return BUSINESS_INDUSTRY_CATALOG.find((item) => item.id === categoryId) || null;
}

const ACTIVITY_PROFILE_TYPES = new Map([
  ["Influenciador digital e criador de conteúdo", "criador"],
  ["Produtor de infoprodutos", "criador"],
  ["E-commerce e loja virtual", "ecommerce"],
  ["Escritório de advocacia", "advocacia"],
  ["Escritório de contabilidade", "contabilidade"],
  ["Agência de recursos humanos e recrutamento", "rh"],
  ["Agência de marketing e publicidade", "agencia"],
  ["Lavanderia", "lavanderia"],
  ["Supermercado", "mercado"],
  ["Hortifruti e mercearia", "mercado"],
  ["Brechó e bazar", "varejo"],
  ["Transportadora de cargas", "transportes"],
  ["Concessionária de veículos novos ou seminovos", "automotivo"],
  ["Podcaster", "criador"],
  ["Streamer de jogos ou variedades", "criador"],
  ["Canal de mídia e newsletter", "criador"],
]);

export function profileTypeForIndustry(categoryId, activity = "") {
  return (
    ACTIVITY_PROFILE_TYPES.get(activity) ||
    industryCategoryById(categoryId)?.profileTypeId ||
    "outro"
  );
}

export function businessTypeById(typeId) {
  return BUSINESS_TYPES.find((type) => type.id === typeId) || null;
}

export function recommendedPackIds(typeId) {
  const type = businessTypeById(typeId) || businessTypeById("outro");
  return [...new Set(type?.packs || BUSINESS_PACKS.map((pack) => pack.id))];
}

export function normalizePackIds(packIds) {
  const valid = new Set(BUSINESS_PACKS.map((pack) => pack.id));
  return [...new Set(Array.isArray(packIds) ? packIds : [])].filter((id) =>
    valid.has(id),
  );
}

export function businessPackLabels(packIds) {
  const selected = new Set(normalizePackIds(packIds));
  return BUSINESS_PACKS.filter((pack) => selected.has(pack.id)).map(
    (pack) => pack.label,
  );
}

export function businessEnabledPackIds(business) {
  if (!business) return BUSINESS_PACKS.map((pack) => pack.id);
  const selected = normalizePackIds(business.enabledPacks);
  if (selected.length) return selected;
  if (business.businessTypeId) return recommendedPackIds(business.businessTypeId);
  return BUSINESS_PACKS.map((pack) => pack.id);
}

export function businessVisiblePageIds(business) {
  // "conversar" é a porta de entrada fixada (PINNED) do app: precisa continuar
  // visível mesmo em modo "custom" com poucos packs, senão a pessoa perde o
  // caminho mais curto para quase tudo. "inicio"/"comecar"/"perfil-negocio"
  // seguem a mesma regra de sempre-visíveis.
  const always = ["inicio", "conversar", "comecar", "perfil-negocio"];
  if (!business || business.menuMode !== "custom") return null;
  const selected = new Set(businessEnabledPackIds(business));
  for (const pack of BUSINESS_PACKS) {
    if (!selected.has(pack.id)) continue;
    for (const page of pack.pages) always.push(page);
  }
  return [...new Set(always)];
}

export function filterNavigationForBusiness(items, business) {
  const visible = businessVisiblePageIds(business);
  if (!visible) return items;
  const allowed = new Set(visible);
  return items.filter(([id]) => allowed.has(id));
}

export function businessTypeLabel(business) {
  return (
    businessTypeById(business?.businessTypeId)?.label ||
    business?.segment ||
    "Tipo de negócio ainda não escolhido"
  );
}
