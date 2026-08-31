// ===== O que a IA sabe sobre a To Do Green =====
//
// Antes, tudo o que o Plantû sabia do negócio estava escrito à mão dentro do
// prompt (`INSTRUCAO`, em worker/services/todogreen-semente.js): frota
// elétrica, produtos, vocabulário. Estava certo e estava MORTO — mudar um
// número exigia publicar o produto de novo, e nada do que a titular sabe
// entrava sem passar por mim.
//
// Aqui o conhecimento vira DADO: linhas de um espaço, editáveis na tela,
// versionadas como qualquer registro da vertical, e injetadas no prompt na
// hora da pergunta. Três consequências que importam:
//
//   1. Corrigir um fato é editar um campo, não publicar uma versão.
//   2. O que a titular ensina hoje o assistente sabe na próxima pergunta.
//   3. Cada fato carrega FONTE e DATA. Um assistente que afirma "18.000 t de
//      CO2 evitado" sem saber de onde veio o número é o mesmo assistente que
//      inventa o próximo — e a To Do Green vende justamente a diferença entre
//      medição e estimativa.
//
// SIGILO é a coluna que decide quem vê. A regra da titular já vale no resto do
// produto e vale aqui sem exceção: CPF, salário, conta bancária e documento de
// pessoa NUNCA saem para o portal do cliente. Por isso a semente que vem no
// código traz só o que é público ou interno — nada de CPF, conta corrente ou
// CNH mora neste arquivo. Esse tipo de dado se cadastra na tela, dentro do
// espaço dela, com sigilo "restrito".

const texto = (valor, max = 4000) => String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const multilinha = (valor, max = 8000) =>
  String(valor ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);

// ---- Categorias ----
//
// A ordem é a ordem em que o dossiê é lido, e por isso é a ordem em que o
// assistente recebe: identidade antes de número, número antes de detalhe.
export const CATEGORIAS_DO_NEGOCIO = Object.freeze([
  { id: "identidade", rotulo: "Identidade", ajuda: "Quem é a empresa, desde quando, quem responde por ela." },
  { id: "proposta", rotulo: "Proposta de valor", ajuda: "O que ela vende e por que ganham dela." },
  { id: "operacao", rotulo: "Operação", ajuda: "Malha, frota, bases, capacidade real." },
  { id: "numeros", rotulo: "Números que provam", ajuda: "Indicadores com fonte e data. Sem fonte não entra." },
  { id: "clientes", rotulo: "Clientes e mercado", ajuda: "Quem compra, como compra, o que exige." },
  { id: "habilitacao", rotulo: "Habilitação e documentos", ajuda: "O que um comprador pede para homologar a To Do Green." },
  { id: "fiscal", rotulo: "Fiscal e societário", ajuda: "Registro, regime, credenciamento, capital." },
  { id: "vocabulario", rotulo: "Vocabulário e jeito de falar", ajuda: "Como a casa chama as coisas." },
  { id: "aprendido", rotulo: "Aprendido na conversa", ajuda: "O que o assistente aprendeu e a pessoa confirmou." },
]);

export const CATEGORIA_VALIDA = (valor) => {
  const chave = texto(valor, 40).toLowerCase();
  return CATEGORIAS_DO_NEGOCIO.some((item) => item.id === chave) ? chave : "identidade";
};

// ---- Sigilo ----
//
// Três níveis, e o mais restritivo é o padrão de quem não declarou nada: é
// mais barato liberar um fato depois do que descobrir que ele vazou.
export const SIGILOS = Object.freeze([
  { id: "publico", rotulo: "Público", ajuda: "Pode aparecer em proposta, portal do cliente e material comercial." },
  { id: "interno", rotulo: "Interno", ajuda: "Circula dentro da To Do Green. Não vai para o portal do cliente." },
  { id: "restrito", rotulo: "Restrito", ajuda: "Só dona, administração e financeiro. Conta bancária, CPF, documento de pessoa." },
]);

export const sigiloValido = (valor) => {
  const chave = texto(valor, 20).toLowerCase();
  return SIGILOS.some((item) => item.id === chave) ? chave : "interno";
};

// Quem enxerga o quê. O portal do cliente só vê o público — sempre, sem
// depender de quem está logado do outro lado.
export const PERMISSAO_POR_SIGILO = Object.freeze({
  publico: [],
  interno: [],
  restrito: ["finance:manage", "hr:manage"],
});

export const podeVerSigilo = (sigilo, { papel = "", permissoes = [] } = {}) => {
  if (sigiloValido(sigilo) !== "restrito") return true;
  if (["owner", "admin"].includes(texto(papel, 40).toLowerCase())) return true;
  const tem = new Set(permissoes.map((item) => texto(item, 60)));
  if (tem.has("*")) return true;
  return PERMISSAO_POR_SIGILO.restrito.some((permissao) => tem.has(permissao));
};

// ---- Normalização ----
export const normalizarFato = (bruto = {}) => ({
  id: texto(bruto.id, 120),
  chave: texto(bruto.chave || bruto.key, 80).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, ""),
  categoria: CATEGORIA_VALIDA(bruto.categoria),
  titulo: texto(bruto.titulo || bruto.title, 160),
  conteudo: multilinha(bruto.conteudo || bruto.content),
  fonte: texto(bruto.fonte || bruto.source, 200),
  vigenteEm: texto(bruto.vigenteEm || bruto.effectiveAt, 40),
  sigilo: sigiloValido(bruto.sigilo),
  origem: texto(bruto.origem, 40).toLowerCase() === "aprendido" ? "aprendido" : "cadastrado",
  fixado: Boolean(bruto.fixado),
  revision: Number(bruto.revision || 0),
});

// ---- A semente: o dossiê auditado ----
//
// Cada linha saiu de um documento oficial que a titular entregou (apresentação
// comercial VF2, cartão CNPJ, Sintegra, apólices Porto Seguro, e a Central de
// RFQ/RFI v2.0 de 15/08/2026, que já cruzou os 16 arquivos originais). A FONTE
// fica no registro justamente para o assistente poder dizer de onde tirou.
//
// O que está errado no mundo real continua registrado como está: as apólices
// venceram, e esconder isso do assistente faria ele afirmar cobertura que a
// empresa não tem numa resposta de RFQ. Fato ruim documentado vale mais que
// fato bom inventado.
export const DOSSIE_TO_DO_GREEN = Object.freeze([
  {
    chave: "quem-somos",
    categoria: "identidade",
    titulo: "Nascemos elétricos, não viramos",
    conteudo: `A To Do Green é o nome fantasia de TO DO TECNOLOGIA E SERVIÇOS LTDA, a maior transportadora 100% elétrica do Brasil, especializada em logística sustentável para e-commerce e marketplaces.
Fundada em 29/03/2021 por Paula Gracielle Simões, sócia administradora. Administrador não sócio: João Lucas Skaff. Operou sem um único veículo a combustão desde o primeiro dia — não houve transição, houve construção.
Frase da casa: "Não é plano. É operação."`,
    fonte: "Apresentação Comercial VF2 + Contrato Social consolidado (JUCESP, NIRE 35.237.011.921)",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
    fixado: true,
  },
  {
    chave: "linha-do-tempo",
    categoria: "identidade",
    titulo: "A história, ano a ano",
    conteudo: `2021 — Fundação. Frota 100% elétrica desde o primeiro dia. Primeira Black Friday com a B2W.
2022 — Amazon. Parceria em Sorocaba e pivô para entregas sustentáveis com a Via Varejo.
2023 — Escala. 8 bases no interior de SP, +2 milhões de entregas, +5.000 t de CO2 evitadas.
2024 — Expansão. +30 bases e +10 milhões de entregas no ano. Signatários do The Climate Pledge.
2025 — Referência. 55 operações logísticas e +20 milhões de pacotes. A Maersk escolhe a To Do Green.
2026 — Consolidação. End-to-end elétrico do first ao last mile.`,
    fonte: "Apresentação Comercial VF2",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
  },
  {
    chave: "proposta-de-valor",
    categoria: "proposta",
    titulo: "O que a To Do Green vende de verdade",
    conteudo: `"Não vendemos frete elétrico. Vendemos uma operação que entrega prazo, controle e ESG no mesmo contrato."
O comprador de marketplace cobra quatro coisas na mesma reunião:
1. Promessa de prazo — D+0 e D+1 em regiões de alta densidade, sem quebrar a promessa da vitrine.
2. Capilaridade real — capital e interior com estrutura própria, sem malha de subcontratados.
3. Pressão ESG — meta de descarbonização que precisa virar número auditável no relatório.
4. Dado e integração — visibilidade fim a fim integrada ao sistema do parceiro, com gestão ativa de exceções.
Posicionamento contra a objeção de preço: quem constrói elétrico desde o início não paga custo de reconversão de frota. Menor consumo de energia por km, manutenção mais simples, custo energético previsível sem depender do diesel.`,
    fonte: "Apresentação Comercial VF2, seções CONTEXTO e POSICIONAMENTO",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
    fixado: true,
  },
  {
    chave: "portfolio",
    categoria: "proposta",
    titulo: "Portfólio operado",
    conteudo: `First mile / coleta — coleta no seller, no CD ou no cross-dock, com VUCs e vans elétricas.
Middle mile e line haul — transferência entre hubs e corredores interestaduais com veículos de maior capacidade.
Cross-docking em hub — separação, roteirização, carregamento e expedição dentro da rede própria.
Last mile D+0 e D+1 — entrega ao comprador final com frota elétrica, rastreio e SLA acordado.
Logística reversa — coleta de devoluções e retorno ao centro de origem no mesmo fluxo elétrico.
Operação dedicada — times, frota e hub dedicados a uma malha ou região específica do parceiro.`,
    fonte: "Apresentação Comercial VF2, seção PORTFÓLIO",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
  },
  {
    chave: "cobertura",
    categoria: "operacao",
    titulo: "Malha, bases e frota",
    conteudo: `29 unidades no CNPJ: matriz + 28 filiais — 28 em São Paulo e 1 em Minas Gerais.
+32 estações e centros de distribuição, +200 cidades atendidas com frota própria, +500 veículos elétricos em operação.
Principais bases: São Paulo, Sorocaba, Bauru, Ribeirão Preto, Campinas, Jaguariúna, Mogi Mirim, Mogi das Cruzes, S. J. do Rio Preto, Araraquara, Araçatuba, Presidente Prudente, Taubaté, Bragança Paulista e Belo Horizonte.
Novas praças abrem conforme a densidade de volume do parceiro.
ATENÇÃO — o número de veículos DIVERGE entre documentos: a apresentação comercial fala em +500 elétricos em operação, o questionário da apólice informou 100 próprios e 10 agregados, e o RNTRC lista 13 veículos automotores ativos (4 próprios, 4 em leasing, 5 arrendados). Antes de responder frota em RFI, confirmar o número real.`,
    fonte: "Apresentação Comercial VF2 + extrato RNTRC (ANTT) + questionário da apólice Porto Seguro",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
    fixado: true,
  },
  {
    chave: "tecnologia",
    categoria: "operacao",
    titulo: "Tecnologia e integração",
    conteudo: `Integração via API e EDI com o WMS, TMS ou plataforma do parceiro: troca de status, romaneio e comprovantes sem retrabalho.
Roteirização própria — algoritmo por volume, janela de entrega, densidade e autonomia de cada veículo elétrico.
Rastreamento em tempo real do seller ao comprador, com evidência de entrega.
Torre de controle: gestão ativa de exceções e relatórios operacionais e de CO2 integráveis ao sistema do parceiro.
No ERP: o TMS operacional é o TRACK3R (ocorrências chegam por webhook) e a posição do veículo vem da Sistemas Tracker. São fornecedores diferentes e não se substituem.`,
    fonte: "Apresentação Comercial VF2 + docs/todogreen-tms-track3r.md",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "indicadores",
    categoria: "numeros",
    titulo: "Os números que a To Do Green apresenta",
    conteudo: `+45 milhões de entregas realizadas desde 2021.
98,5% OTD (Estimated Arrival Date) — pacotes com tentativa de entrega dentro do prazo acordado.
97,5% de efetividade (Delivery Completion Rate) — entregas concluídas com sucesso ao cliente final.
18.000 t de CO2 evitado desde 2022, documentado e auditável, com relatório mensal por rota, base e operação.
Signatária do The Climate Pledge (zero carbono líquido até 2040, iniciativa da Amazon).
Os indicadores são medidos em operação de alta volumetria, não em amostra de piloto, e a casa se adapta aos KPIs do parceiro.`,
    fonte: "Apresentação Comercial VF2, seções PROVA, ESCALA e PERFORMANCE",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
    fixado: true,
  },
  {
    chave: "implantacao",
    categoria: "clientes",
    titulo: "Como uma operação nova começa",
    conteudo: `1. MAPEAR — rotas, hubs, volumes, janelas e restrições da malha atual.
2. SIMULAR — capacidade, SLA alcançável e CO2 evitado no cenário proposto.
3. RODAR — piloto em rota crítica ou região de alta densidade.
4. REPORTAR — resultado operacional e impacto ambiental documentado.
5. ESCALAR — novas rotas e novos produtos com base no desempenho.
Entrada sugerida ao cliente: 1 piloto + 1 plano quinzenal de acompanhamento + 1 plano de escala.`,
    fonte: "Apresentação Comercial VF2, seção IMPLANTAÇÃO",
    vigenteEm: "2026-08-15",
    sigilo: "publico",
  },
  {
    chave: "quem-compra",
    categoria: "clientes",
    titulo: "Quem compra e como compra",
    conteudo: `Marketplaces, e-commerce e grandes embarcadores com exigência operacional e ambiental alta. Nomes já operados ou parceiros citados no material: Amazon, B2W, Via Varejo, Maersk, DHL, Mercado Livre, Magalog.
A compra passa por procurement: RFI, RFQ/BID, homologação de fornecedor em portal, código de conduta assinado, due diligence e contrato. O cliente grande cruza CNPJ contra ANTT e Receita automaticamente — divergência cadastral trava homologação antes de qualquer discussão de preço.
Exemplo real do rito: a DHL exige ficha cadastral, CNPJ e SINTEGRA com consulta de até 2 meses, termo de confidencialidade, código de conduta assinado, aprovação do time de Procurement e comprovante bancário, tudo por chamado no MyService Portal.`,
    fonte: "Central de RFQ e RFI v2.0 (15/08/2026) + Brazil Vendor Creation Request Form (DHL)",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "habilitacao-em-dia",
    categoria: "habilitacao",
    titulo: "Documentos válidos hoje",
    conteudo: `CLI — Licenciamento Integrado SPM2530517061 (JUCESP / Prefeitura de SP), válido até 01/02/2027.
CLCB — Corpo de Bombeiros 1125752 (CBPMESP), válido até 01/02/2027. É CLCB, não AVCB: o CLCB substitui o AVCB nesta edificação por força da IT 42.
Contrato Social consolidado — NIRE 35.237.011.921 (JUCESP), permanente.
RNTRC 054901444, categoria ETC, ativo desde 12/04/2022.
Credenciada a emitir CT-e desde 18/03/2022, modal rodoviário.`,
    fonte: "Central de RFQ e RFI v2.0, painel de validades",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "habilitacao-pendente",
    categoria: "habilitacao",
    titulo: "O que trava um RFQ hoje",
    conteudo: `CRÍTICO — as duas apólices da Porto Seguro venceram em 13/08/2026: RCTR-C nº 654 66 04001125 e RC-DC nº 001 0655 66 0040008120000. Sem elas a empresa transporta carga remunerada sem cobertura de responsabilidade civil, e isso é desclassificação automática em qualquer cotação de transporte. Corretora: Prata Corretora, tiago@prataseguros.com.br, (15) 99679-7101.
Existe certificado posterior da Porto Seguro (emitido 14/08/2026) para RCTR-C com limite de R$ 1.000.000,00 e RC-V com limite de R$ 470.000,00, vigência 13/08/2026 a 13/02/2027 — confirmar com a corretora qual documento vale antes de enviar a cliente.
A REEMITIR (sem validade legal, mas velhos demais para comprador aceitar): Inscrição Municipal CCM, Inscrição Estadual Cadesp, declaração de conta corrente, extrato RNTRC e cartão CNPJ.
FALTAM NO ACERVO, e sem eles um RFI de conta grande não fecha: CND Federal (RFB/PGFN), CRF do FGTS, CNDT trabalhista, CND Estadual SP e mobiliária, certidão de falência (TJSP), balanço e DRE do último exercício, índices de liquidez, declaração bancária reemitida, PGR (NR-1), PCMSO (NR-7), relação de frota com CRLVs, relação de motoristas, plano de gerenciamento de risco logístico, atestados de capacidade técnica (o item que mais pontua e não há nenhum), apresentação institucional com o mapa das 29 unidades, código de conduta, política anticorrupção (Lei 12.846) e política de privacidade/LGPD.`,
    fonte: "Central de RFQ e RFI v2.0, auditoria de 15/08/2026",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
    fixado: true,
  },
  {
    chave: "divergencias-cadastrais",
    categoria: "habilitacao",
    titulo: "Divergências que o comprador vai achar",
    conteudo: `Frota: apólice declarou 100 próprios + 10 agregados, RNTRC lista 13 ativos. Divergência entre o declarado à seguradora e o registro na ANTT pode gerar negativa de indenização em sinistro e reprova em due diligence.
Endereço: o RNTRC traz Av. Paulista, 1842, e o CNPJ traz Rua Quatá, 157. O comprador cruza CNPJ × ANTT automaticamente.
Bairro: CNPJ e Cadesp dizem Vila Olímpia, o CLCB diz Itaim Bibi. Padronizar por Vila Olímpia.
Contrato Social, Cláusula V: item "29." aparece sem texto — erro de redação já registrado na JUCESP, pedir errata à contabilidade Flaumar.
Telefone no cartão CNPJ: (11) 6184-7241, formato improvável para São Paulo.
Nunca responder número de frota em RFI sem confirmar qual é o real.`,
    fonte: "Central de RFQ e RFI v2.0, auditoria de 15/08/2026",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "nomenclatura-de-documento",
    categoria: "habilitacao",
    titulo: "Padrão de nome de arquivo do acervo",
    conteudo: `CATEGORIA_TIPO-DO-DOCUMENTO_UNIDADE_DATA.pdf — exemplo: 02-LIC_CLCB-BOMBEIROS_MATRIZ-SP_V2027-02-01.pdf
Regras: sem acento, sem cedilha, sem espaço; hífen dentro do bloco e underline entre blocos; data sempre AAAA-MM-DD; prefixo V quando tem validade (usa o vencimento) e E quando não tem (usa a emissão); tudo em maiúsculas.
Proibido: final, novo, v2, atualizado, ok, DEFINITIVO. A data já diz qual é o mais recente.
Código das unidades: MATRIZ-SP para o 0001-32, e as filiais acompanham o número do CNPJ (F02-SOROCABA-SP = 0002-13, F06-RIBEIRAO-PRETO-SP = 0006-47, F23-BELO-HORIZONTE-MG = 0023-48). Documento que vale para todos os CNPJs recebe EMPRESA.`,
    fonte: "Central de RFQ e RFI v2.0, aba Nomenclatura",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "ficha-cadastral",
    categoria: "fiscal",
    titulo: "Ficha cadastral da matriz",
    conteudo: `Razão social: TO DO TECNOLOGIA E SERVIÇOS LTDA. Nome fantasia: TO DO GREEN.
CNPJ (matriz): 41.385.427/0001-32. NIRE 35.237.011.921 (JUCESP, sessão de 29/03/2021).
Inscrição Estadual: 134.594.492.111, ativa. Inscrição Municipal (CCM): 6.891.290-0.
Natureza jurídica: 206-2, Sociedade Empresária Limitada. Porte: EPP.
Início das atividades: 29/03/2021, situação cadastral ATIVA. Capital social: R$ 250.000,00, integralizado.
Sede: Rua Quatá, 157 — Vila Olímpia — São Paulo/SP — CEP 04546-041. Área 403,80 m², 2 pavimentos, cadastrada como galpão comercial.
Regime de apuração: NORMAL — regime periódico de apuração. Posto fiscal PFC-10 Butantã.
E-mail cadastral: paula@todogreen.com.br. Telefone: (11) 96320-2422.
Tipo de contribuinte para cadastro de fornecedor: TRANSPORTE, com retenção federal na fonte.`,
    fonte: "Cartão CNPJ, Sintegra/Cadesp e Central de RFQ e RFI v2.0",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
    fixado: true,
  },
  {
    chave: "cnae",
    categoria: "fiscal",
    titulo: "Atividades registradas",
    conteudo: `CNAE principal: 4930-2/01 — transporte rodoviário de carga, exceto produtos perigosos e mudanças, municipal.
Secundários de logística: 4930-2/02 (intermunicipal, interestadual e internacional), 5212-5/00 (carga e descarga), 5320-2/02 (serviços de entrega rápida).
Além deles, 12 CNAEs de tecnologia, consultoria, publicidade e treinamento — desenvolvimento de software, suporte técnico, tratamento de dados, portais, consultoria em gestão, agência de publicidade, promoção de vendas, marketing direto, intermediação de negócios, locação de meios de transporte sem condutor e treinamento profissional.
Isso importa em RFQ: a empresa pode contratar serviço de tecnologia e de logística pelo mesmo CNPJ.`,
    fonte: "Cartão CNPJ e Sintegra",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "alcada-societaria",
    categoria: "fiscal",
    titulo: "Quem assina o quê",
    conteudo: `Paula Gracielle Simões é sócia administradora e detém 100% das quotas. João Lucas Skaff é administrador não sócio.
São atos privativos da sócia: obrigações acima de R$ 1.000.000,00, ações judiciais e alienação de imóveis.
Na prática comercial: proposta que crie obrigação acima de R$ 1 milhão não se fecha sem a assinatura dela, por mais avançada que esteja a negociação.`,
    fonte: "Contrato Social consolidado (JUCESP) via Central de RFQ e RFI v2.0",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
  },
  {
    chave: "seguros",
    categoria: "habilitacao",
    titulo: "Seguros de carga",
    conteudo: `Seguradora: Porto Seguro Cia. de Seguros Gerais. Corretora: Prata Corretora de Seguros (SUSEP 212111888 / 91297J), Tiago, tiago@prataseguros.com.br, (15) 99679-7101.
RCTR-C — responsabilidade civil do transportador rodoviário de carga. Limite máximo de garantia R$ 1.000.000,00. Cobre dano à mercadoria de terceiro por colisão, capotagem, abalroamento, tombamento, incêndio ou explosão no veículo, e incêndio ou explosão em depósito por até 15 dias.
RC-V — responsabilidade civil de veículo. Limite R$ 470.000,00, com sublimites de R$ 280.000,00 para danos corporais, R$ 160.000,00 para materiais e R$ 30.000,00 para morais, mais R$ 20.000,00 de custos de defesa. Cobre inclusive veículo de transportador subcontratado ou TAC, desde que o CT-e do transporte seja da própria To Do Green e emitido antes do início do risco.
RC-DC — responsabilidade civil por desaparecimento de carga.
Perfil declarado à seguradora: 462 embarques mensais, valor médio de R$ 200.000,00 por embarque, importância segurada mensal de R$ 4.000.000,00, logística de distribuição ponto a ponto.`,
    fonte: "Apólices e certificados Porto Seguro (13/02/2026 e 14/08/2026)",
    vigenteEm: "2026-08-14",
    sigilo: "interno",
  },
  {
    chave: "vocabulario",
    categoria: "vocabulario",
    titulo: "Como a casa fala",
    conteudo: `Operação: CD, hub, cross-docking, coleta, janela de entrega, SLA, lead time, ocupação do veículo, cubagem, peso taxado, fracionado, lotação, backhaul, ocorrência, reentrega, OTD, efetividade, romaneio, POD.
Frota elétrica: autonomia por ciclo, recarga em depósito, tempo de recarga, payload menor pelo peso da bateria, TCO contra diesel, custo por km rodado, infraestrutura de recarga como restrição real de rota.
Preço: custo por km, custo por entrega, diluição por ocupação, margem de contribuição, piso mínimo, pedágio, diesel evitado.
ESG: Escopo 3 do GHG Protocol, tCO2e, fator de emissão, medição contra estimativa, Green Score, inventário, evidência auditável.
Comercial: procurement, supply chain, sourcing, RFQ, RFP, RFI, cotação, homologação, portal de fornecedor, decisor econômico, patrocinador, ciclo de compra, contrato e renovação.
Pessoas reais são COLABORADORES. "Funcionário" no produto é a persona de IA, nunca uma pessoa.`,
    fonte: "Vocabulário consolidado do produto",
    vigenteEm: "2026-08-15",
    sigilo: "interno",
    fixado: true,
  },
]);

// A semente é reconhecida pela chave. Reaplicar não duplica: atualiza o que
// mudou e deixa quieto o que a titular editou à mão — o dossiê é um ponto de
// partida, não uma correção diária do que ela escreveu.
export const sementeDoNegocio = () => DOSSIE_TO_DO_GREEN.map((fato) => normalizarFato({ ...fato, origem: "cadastrado" }));

export const fatosQueFaltam = (existentes = []) => {
  const tem = new Set(existentes.map((item) => normalizarFato(item).chave).filter(Boolean));
  return sementeDoNegocio().filter((fato) => !tem.has(fato.chave));
};

// ---- O bloco que vai para o modelo ----
//
// Ordenado por categoria e com fonte junto. O teto de caracteres existe porque
// prompt não é banco: um dossiê que cresce sem limite empurra a pergunta para
// fora da janela do modelo, e aí o assistente responde pior justamente por
// saber mais. Fato fixado nunca é cortado.
export const blocoDeContexto = (fatos = [], { teto = 12000, incluirRestrito = false } = {}) => {
  const ordem = CATEGORIAS_DO_NEGOCIO.map((item) => item.id);
  const normalizados = fatos
    .map(normalizarFato)
    .filter((fato) => fato.titulo && fato.conteudo)
    .filter((fato) => incluirRestrito || fato.sigilo !== "restrito")
    .sort((a, b) => {
      if (a.fixado !== b.fixado) return a.fixado ? -1 : 1;
      return ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria);
    });

  const linhas = [];
  let tamanho = 0;
  for (const fato of normalizados) {
    const rotulo = CATEGORIAS_DO_NEGOCIO.find((item) => item.id === fato.categoria)?.rotulo || fato.categoria;
    const carimbo = [fato.fonte && `fonte: ${fato.fonte}`, fato.vigenteEm && `posição em ${fato.vigenteEm}`]
      .filter(Boolean)
      .join(" · ");
    const pedaco = `[${rotulo}] ${fato.titulo}\n${fato.conteudo}${carimbo ? `\n(${carimbo})` : ""}`;
    if (!fato.fixado && tamanho + pedaco.length > teto) continue;
    linhas.push(pedaco);
    tamanho += pedaco.length;
  }
  if (!linhas.length) return "";
  return [
    "O QUE VOCÊ SABE SOBRE A TO DO GREEN",
    "Este dossiê é cadastrado pela própria empresa e é a sua fonte sobre o negócio. Use-o como verdade sobre a To Do Green, cite a fonte quando o número for cobrado, e se um fato estiver marcado como vencido ou divergente, diga isso em vez de afirmar o contrário. O que não estiver aqui você não sabe — não complete.",
    "",
    linhas.join("\n\n"),
  ].join("\n");
};

// ---- Aprendizado ----
//
// O assistente PROPÕE um fato novo, a pessoa CONFIRMA, o servidor grava. É a
// mesma regra das outras ações do Plantû, e pelo mesmo motivo: um modelo que
// escreve conhecimento no banco sozinho, a partir de texto livre, aprende
// também o que alguém plantar numa mensagem.
export const propostaDeAprendizado = (bruto = {}) => {
  const fato = normalizarFato({ ...bruto, origem: "aprendido", categoria: bruto.categoria || "aprendido" });
  if (!fato.titulo) return { valida: false, motivo: "O aprendizado precisa de um título.", fato: null };
  if (fato.conteudo.length < 10) return { valida: false, motivo: "O aprendizado precisa de conteúdo.", fato: null };
  return {
    valida: true,
    motivo: "",
    fato: {
      ...fato,
      chave: fato.chave || `aprendido-${fato.titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-|-$/g, "")}`,
      fonte: fato.fonte || "Aprendido na conversa com o Plantû",
      sigilo: fato.sigilo,
    },
  };
};
