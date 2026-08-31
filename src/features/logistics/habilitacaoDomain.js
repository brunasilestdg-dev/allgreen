// ===== Central de RFQ e RFI: o acervo de habilitação =====
//
// A titular mantinha isso numa página HTML solta no computador dela ("Central
// de RFQ e RFI v2.0", 15/08/2026), com um índice mestre em planilha onde a
// coluna de status era fórmula. Funcionava e tinha um problema estrutural: o
// semáforo era recalculado por planilha aberta à mão, e o acervo — 13 arquivos
// — vivia fora de qualquer sistema.
//
// Aqui o acervo é dado do ERP e o STATUS É DERIVADO. Isso não é detalhe de
// implementação: status gravado é status que envelhece calado. Um documento
// marcado "VÁLIDO" em agosto continua dizendo VÁLIDO em dezembro, e alguém
// manda ao comprador uma apólice vencida confiando na etiqueta. Aqui não existe
// coluna de status — existe `situacaoDoDocumento(doc, hoje)`, que responde
// sempre com a data de hoje.
//
// As cinco regras de nome de arquivo e os cinco estados do semáforo são os
// dela, transcritos, não reinventados.

const texto = (valor, max = 300) => String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const dia = 86400000;

// ---- Categorias do acervo ----
//
// O prefixo numérico é parte do nome do arquivo e existe para o acervo ordenar
// sozinho no explorador de arquivos: `01-SOC` antes de `02-LIC` sem ninguém
// arrastar nada.
export const CATEGORIAS_DE_HABILITACAO = Object.freeze([
  { id: "societario", prefixo: "01-SOC", rotulo: "Societário e cadastral" },
  { id: "licencas", prefixo: "02-LIC", rotulo: "Licenças e alvarás" },
  { id: "seguros", prefixo: "03-SEG", rotulo: "Seguros" },
  { id: "certidoes", prefixo: "04-CND", rotulo: "Certidões negativas" },
  { id: "financeiro", prefixo: "05-FIN", rotulo: "Financeiro" },
  { id: "ssma", prefixo: "06-SSMA", rotulo: "Saúde, segurança e meio ambiente" },
  { id: "operacional", prefixo: "07-OPE", rotulo: "Operacional" },
  { id: "compliance", prefixo: "08-COM", rotulo: "Comercial e compliance" },
]);

export const categoriaValida = (valor) => {
  const chave = texto(valor, 40).toLowerCase();
  return CATEGORIAS_DE_HABILITACAO.some((item) => item.id === chave) ? chave : "societario";
};

export const prefixoDaCategoria = (categoria) =>
  CATEGORIAS_DE_HABILITACAO.find((item) => item.id === categoriaValida(categoria))?.prefixo || "01-SOC";

// ---- Unidades ----
//
// Metade do acervo é por filial, e o comprador cruza CNPJ contra ANTT e Receita
// automaticamente: mandar documento da matriz onde se pede o da filial trava a
// homologação. O código da unidade acompanha o número do CNPJ, como ela definiu.
export const UNIDADE_DA_EMPRESA = "EMPRESA";

export const codigoDaUnidade = ({ cnpj = "", cidade = "", uf = "", matriz = false } = {}) => {
  const cidadeCodigo = texto(cidade, 60)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  const estado = texto(uf, 2).toUpperCase();
  if (matriz) return ["MATRIZ", estado].filter(Boolean).join("-");
  const ordem = texto(cnpj, 20).replace(/\D/g, "").slice(8, 12);
  const filial = ordem && ordem !== "0001" ? `F${ordem.slice(-2)}` : "";
  return [filial, cidadeCodigo, estado].filter(Boolean).join("-");
};

// ---- Os cinco estados do semáforo ----
//
// Transcritos da Central dela:
//   VENCIDO  — passou da validade. Não sai para cliente nenhum.
//   CRÍTICO  — vence em até 30 dias. É o que ela filtra junto com VENCIDO na
//              rotina de segunda-feira.
//   ATENÇÃO  — vence em 31 a 90 dias. Abrir a renovação agora.
//   REEMITIR — sem validade legal, mas velho demais. Comprador recusa.
//   VÁLIDO   — pronto para enviar.
//
// PERMANENTE é o sexto e existe porque contrato social consolidado não vence:
// tratá-lo como "sem validade legal" o jogaria em REEMITIR para sempre.
export const ESTADOS_DO_DOCUMENTO = Object.freeze([
  { id: "vencido", rotulo: "VENCIDO", gravidade: 4, ajuda: "Passou da validade. Não sai para cliente nenhum." },
  { id: "critico", rotulo: "CRÍTICO", gravidade: 3, ajuda: "Vence em até 30 dias. Renovar agora." },
  { id: "reemitir", rotulo: "REEMITIR", gravidade: 2, ajuda: "Sem validade legal, mas velho demais. Comprador recusa." },
  { id: "atencao", rotulo: "ATENÇÃO", gravidade: 1, ajuda: "Vence em 31 a 90 dias. Abrir a renovação." },
  { id: "valido", rotulo: "VÁLIDO", gravidade: 0, ajuda: "Pronto para enviar." },
  { id: "permanente", rotulo: "PERMANENTE", gravidade: 0, ajuda: "Não vence." },
  { id: "ausente", rotulo: "FALTANDO", gravidade: 5, ajuda: "Nunca entrou no acervo." },
]);

export const gravidadeDoEstado = (estado) =>
  ESTADOS_DO_DOCUMENTO.find((item) => item.id === estado)?.gravidade ?? 0;

// Quantos dias um documento sem validade legal ainda é aceito antes de virar
// REEMITIR. 90 é o teto dela: "emitidos há mais de 90 dias". A DHL pede CNPJ e
// SINTEGRA com consulta de até 2 meses, então o padrão é conservador de
// propósito — e cada tipo pode apertar o seu.
export const DIAS_ACEITAVEIS_SEM_VALIDADE = 90;

const dataValida = (valor) => {
  const bruto = texto(valor, 40);
  if (!/^\d{4}-\d{2}-\d{2}/.test(bruto)) return null;
  const t = Date.parse(`${bruto.slice(0, 10)}T12:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
};

export const situacaoDoDocumento = (documento = {}, hoje = Date.now()) => {
  const agora = dataValida(hoje) ?? (Number.isFinite(hoje) ? hoje : Date.now());
  const vence = dataValida(documento.venceEm);
  const emitido = dataValida(documento.emitidoEm);
  const permanente = Boolean(documento.permanente);

  // Sem arquivo E sem número não é documento: é linha de lista de compras.
  if (!documento.arquivoUrl && !documento.arquivoId && !texto(documento.numero))
    return { estado: "ausente", dias: null, motivo: "Nunca entrou no acervo." };

  if (permanente) return { estado: "permanente", dias: null, motivo: "Documento sem validade — não vence." };

  if (vence !== null) {
    const dias = Math.floor((vence - agora) / dia);
    if (dias < 0) return { estado: "vencido", dias, motivo: `Venceu há ${Math.abs(dias)} dia(s).` };
    if (dias <= 30) return { estado: "critico", dias, motivo: `Vence em ${dias} dia(s).` };
    if (dias <= 90) return { estado: "atencao", dias, motivo: `Vence em ${dias} dia(s).` };
    return { estado: "valido", dias, motivo: `Vence em ${dias} dia(s).` };
  }

  if (emitido !== null) {
    const idade = Math.floor((agora - emitido) / dia);
    const teto = Number(documento.diasAceitaveis) > 0
      ? Number(documento.diasAceitaveis)
      : DIAS_ACEITAVEIS_SEM_VALIDADE;
    if (idade > teto)
      return { estado: "reemitir", dias: idade, motivo: `Emitido há ${idade} dia(s); o aceitável é ${teto}.` };
    return { estado: "valido", dias: idade, motivo: `Emitido há ${idade} dia(s).` };
  }

  // Tem arquivo e nenhuma data. Não é "válido": é indeterminado, e indeterminado
  // que se apresenta como válido é como um comprador descobre por nós.
  return { estado: "reemitir", dias: null, motivo: "Sem data de emissão nem de validade — reemitir para ter data." };
};

// ---- As cinco regras de nome de arquivo ----
//
// CATEGORIA_TIPO-DO-DOCUMENTO_UNIDADE_DATA.pdf
//   02-LIC_CLCB-BOMBEIROS_MATRIZ-SP_V2027-02-01.pdf
//
// Sem acento, sem cedilha, sem espaço · hífen dentro do bloco e underline entre
// blocos · data sempre AAAA-MM-DD · prefixo V quando tem validade (usa o
// vencimento) e E quando não tem (usa a emissão) · tudo em maiúsculas.
//
// Gerar em vez de digitar é o ponto: "final", "novo", "v2", "atualizado",
// "DEFINITIVO" e "0526" (05/26 ou 26/05?) desaparecem porque ninguém escreve o
// nome à mão.
const bloco = (valor) => texto(valor, 80)
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

export const nomeDoArquivo = (documento = {}) => {
  const categoria = prefixoDaCategoria(documento.categoria);
  const tipo = bloco(documento.tipo || documento.titulo) || "DOCUMENTO";
  const unidade = bloco(documento.unidade) || UNIDADE_DA_EMPRESA;
  const vence = texto(documento.venceEm, 10).slice(0, 10);
  const emitido = texto(documento.emitidoEm, 10).slice(0, 10);
  const data = vence ? `V${vence}` : emitido ? `E${emitido}` : "";
  const extensao = texto(documento.extensao, 10).replace(/^\./, "").toLowerCase() || "pdf";
  return `${[categoria, tipo, unidade, data].filter(Boolean).join("_")}.${extensao}`;
};

// Nomes proibidos, verificados no que a pessoa digitar. A data já diz qual é o
// mais recente — "DEFINITIVO" só diz que alguém tinha dúvida.
const PALAVRAS_PROIBIDAS = ["final", "novo", "nova", "v2", "v3", "atualizado", "atualizada", "ok", "definitivo", "definitiva"];

export const problemasDoNome = (nome = "") => {
  const cru = String(nome ?? "").trim();
  if (!cru) return [];
  const problemas = [];
  const semExtensao = cru.replace(/\.[a-z0-9]+$/i, "");
  if (/[À-ÿ]/.test(cru)) problemas.push("Tem acento ou cedilha.");
  if (/\s/.test(cru)) problemas.push("Tem espaço.");
  if (semExtensao !== semExtensao.toUpperCase()) problemas.push("Não está todo em maiúsculas.");
  // A fronteira precisa incluir DÍGITO, não só letra: com `[^a-z]` a data
  // canônica `V2027-02-01` era acusada de usar "v2" (depois do "v2" vem "0",
  // que não é letra), e a tela passava a reclamar justamente dos nomes certos.
  const achadas = PALAVRAS_PROIBIDAS.filter((palavra) =>
    new RegExp(`(^|[^a-z0-9])${palavra}([^a-z0-9]|$)`, "i").test(semExtensao));
  if (achadas.length) problemas.push(`Usa "${achadas.join('", "')}" — a data já diz qual é o mais recente.`);
  if (/\b\d{6}\b/.test(semExtensao)) problemas.push("Tem data ambígua de 6 dígitos (05/26 ou 26/05?). Use AAAA-MM-DD.");
  return problemas;
};

// ---- O que um comprador pede ----
//
// A lista saiu da auditoria dela sobre os 16 arquivos originais somada ao rito
// real de um cliente grande (o formulário de cadastro de fornecedor da DHL).
// `essencial` marca o que derruba um RFQ quando falta.
export const CATALOGO_DE_HABILITACAO = Object.freeze([
  { tipo: "CARTAO-CNPJ", titulo: "Cartão CNPJ", categoria: "societario", orgao: "Receita Federal", diasAceitaveis: 60, essencial: true },
  { tipo: "CONTRATO-SOCIAL-CONSOLIDADO", titulo: "Contrato Social consolidado", categoria: "societario", orgao: "JUCESP", permanente: true, essencial: true },
  { tipo: "INSCRICAO-ESTADUAL-CADESP", titulo: "Inscrição Estadual (Cadesp)", categoria: "societario", orgao: "SEFAZ-SP", diasAceitaveis: 60, essencial: true },
  { tipo: "INSCRICAO-MUNICIPAL-CCM", titulo: "Inscrição Municipal (CCM)", categoria: "societario", orgao: "Prefeitura", diasAceitaveis: 90 },
  { tipo: "CLI-VRE-JUCESP", titulo: "CLI — Licenciamento Integrado", categoria: "licencas", orgao: "JUCESP / Prefeitura" },
  { tipo: "CLCB-BOMBEIROS", titulo: "CLCB — Corpo de Bombeiros", categoria: "licencas", orgao: "CBPMESP", essencial: true },
  { tipo: "APOLICE-RCTR-C", titulo: "Apólice RCTR-C", categoria: "seguros", orgao: "Seguradora", essencial: true },
  { tipo: "APOLICE-RC-DC", titulo: "Apólice RC-DC", categoria: "seguros", orgao: "Seguradora", essencial: true },
  { tipo: "APOLICE-RC-V", titulo: "Apólice RC-V", categoria: "seguros", orgao: "Seguradora" },
  { tipo: "CND-FEDERAL", titulo: "CND Federal (RFB/PGFN)", categoria: "certidoes", orgao: "Receita Federal / PGFN", essencial: true },
  { tipo: "CRF-FGTS", titulo: "CRF do FGTS", categoria: "certidoes", orgao: "Caixa Econômica", essencial: true },
  { tipo: "CNDT-TRABALHISTA", titulo: "CNDT trabalhista", categoria: "certidoes", orgao: "TST", essencial: true },
  { tipo: "CND-ESTADUAL", titulo: "CND Estadual", categoria: "certidoes", orgao: "SEFAZ" },
  { tipo: "CND-MOBILIARIA", titulo: "CND Mobiliária municipal", categoria: "certidoes", orgao: "Prefeitura" },
  { tipo: "CERTIDAO-FALENCIA", titulo: "Certidão de falência e concordata", categoria: "certidoes", orgao: "TJ" },
  { tipo: "BALANCO-PATRIMONIAL", titulo: "Balanço patrimonial do último exercício", categoria: "financeiro", orgao: "Contabilidade", essencial: true },
  { tipo: "DRE", titulo: "DRE do último exercício", categoria: "financeiro", orgao: "Contabilidade", essencial: true },
  { tipo: "INDICES-DE-LIQUIDEZ", titulo: "Índices de liquidez calculados", categoria: "financeiro", orgao: "Contabilidade" },
  { tipo: "DECLARACAO-BANCARIA", titulo: "Declaração bancária", categoria: "financeiro", orgao: "Banco", diasAceitaveis: 90, essencial: true },
  { tipo: "PGR-NR1", titulo: "PGR (NR-1)", categoria: "ssma", orgao: "SESMT / consultoria" },
  { tipo: "PCMSO-NR7", titulo: "PCMSO (NR-7)", categoria: "ssma", orgao: "Medicina do trabalho" },
  { tipo: "RNTRC-EXTRATO", titulo: "RNTRC — extrato do transportador", categoria: "operacional", orgao: "ANTT", diasAceitaveis: 90, essencial: true },
  { tipo: "RELACAO-DE-FROTA-CRLV", titulo: "Relação de frota com CRLVs", categoria: "operacional", orgao: "Interno", diasAceitaveis: 90, essencial: true },
  { tipo: "RELACAO-DE-MOTORISTAS", titulo: "Relação de motoristas", categoria: "operacional", orgao: "Interno", diasAceitaveis: 90 },
  { tipo: "PLANO-DE-GERENCIAMENTO-DE-RISCO", titulo: "Plano de gerenciamento de risco logístico", categoria: "operacional", orgao: "Interno" },
  { tipo: "ATESTADO-DE-CAPACIDADE-TECNICA", titulo: "Atestado de capacidade técnica", categoria: "compliance", orgao: "Cliente", essencial: true },
  { tipo: "APRESENTACAO-INSTITUCIONAL", titulo: "Apresentação institucional", categoria: "compliance", orgao: "Interno" },
  { tipo: "CODIGO-DE-CONDUTA", titulo: "Código de conduta", categoria: "compliance", orgao: "Interno", permanente: true },
  { tipo: "POLITICA-ANTICORRUPCAO", titulo: "Política anticorrupção (Lei 12.846)", categoria: "compliance", orgao: "Interno", permanente: true },
  { tipo: "POLITICA-LGPD", titulo: "Política de privacidade e LGPD", categoria: "compliance", orgao: "Interno", permanente: true },
  { tipo: "TERMO-DE-CONFIDENCIALIDADE", titulo: "Termo de confidencialidade", categoria: "compliance", orgao: "Cliente" },
]);

export const doCatalogo = (tipo) =>
  CATALOGO_DE_HABILITACAO.find((item) => item.tipo === texto(tipo, 80).toUpperCase()) || null;

// ---- Kits ----
//
// "Ninguém deveria montar anexo arquivo por arquivo toda vez." O kit é uma
// lista de TIPOS; a prontidão é calculada contra o acervo de hoje.
export const KITS_PADRAO = Object.freeze([
  {
    chave: "kit-a",
    nome: "Kit A — Homologação de fornecedor",
    descricao: "O que quase todo portal de compras pede para abrir cadastro.",
    tipos: [
      "CARTAO-CNPJ", "CONTRATO-SOCIAL-CONSOLIDADO", "INSCRICAO-ESTADUAL-CADESP",
      "INSCRICAO-MUNICIPAL-CCM", "CND-FEDERAL", "CRF-FGTS", "CNDT-TRABALHISTA",
      "DECLARACAO-BANCARIA", "CODIGO-DE-CONDUTA",
    ],
  },
  {
    chave: "kit-b",
    nome: "Kit B — Cotação de transporte",
    descricao: "O Kit A mais o que uma cotação de frete exige: seguro, RNTRC e frota.",
    tipos: [
      "CARTAO-CNPJ", "CONTRATO-SOCIAL-CONSOLIDADO", "INSCRICAO-ESTADUAL-CADESP",
      "CND-FEDERAL", "CRF-FGTS", "CNDT-TRABALHISTA", "DECLARACAO-BANCARIA",
      "APOLICE-RCTR-C", "APOLICE-RC-DC", "RNTRC-EXTRATO", "RELACAO-DE-FROTA-CRLV",
      "CLCB-BOMBEIROS", "CODIGO-DE-CONDUTA",
    ],
  },
  {
    chave: "dossie",
    nome: "Dossiê completo",
    descricao: "Tudo do acervo. Para RFI de conta grande e due diligence.",
    tipos: CATALOGO_DE_HABILITACAO.map((item) => item.tipo),
  },
]);

// A conferência que "ninguém pula". Devolve o que sai, o que trava e por quê —
// e `liberado` é falso sempre que um item essencial estiver vencido, faltando
// ou pedindo reemissão, porque mandar assim é pior do que não mandar.
export const prontidaoDoKit = (kit = {}, documentos = [], hoje = Date.now()) => {
  const porTipo = new Map();
  for (const documento of documentos) {
    const chave = texto(documento.tipo, 80).toUpperCase();
    const situacao = situacaoDoDocumento(documento, hoje);
    const atual = porTipo.get(chave);
    // Entre duas vias do mesmo tipo vale a MENOS grave: reemitir o cartão CNPJ
    // não deve continuar aparecendo como pendência depois de reemitido.
    if (!atual || gravidadeDoEstado(situacao.estado) < gravidadeDoEstado(atual.situacao.estado))
      porTipo.set(chave, { documento, situacao });
  }

  const itens = (kit.tipos || []).map((tipo) => {
    const chave = texto(tipo, 80).toUpperCase();
    const achado = porTipo.get(chave);
    const definicao = doCatalogo(chave);
    return {
      tipo: chave,
      titulo: definicao?.titulo || chave,
      essencial: Boolean(definicao?.essencial),
      documento: achado?.documento || null,
      situacao: achado?.situacao || { estado: "ausente", dias: null, motivo: "Nunca entrou no acervo." },
    };
  });

  const bloqueios = itens.filter((item) =>
    item.essencial && ["ausente", "vencido", "reemitir", "critico"].includes(item.situacao.estado));
  const avisos = itens.filter((item) =>
    !bloqueios.includes(item) && ["ausente", "vencido", "reemitir", "atencao", "critico"].includes(item.situacao.estado));

  return {
    chave: texto(kit.chave, 60),
    nome: texto(kit.nome, 160),
    itens,
    prontos: itens.filter((item) => ["valido", "permanente"].includes(item.situacao.estado)).length,
    total: itens.length,
    bloqueios,
    avisos,
    liberado: bloqueios.length === 0,
  };
};

// ---- O acervo em números ----
export const resumoDoAcervo = (documentos = [], hoje = Date.now()) => {
  const contagem = { vencido: 0, critico: 0, reemitir: 0, atencao: 0, valido: 0, permanente: 0, ausente: 0 };
  for (const documento of documentos) contagem[situacaoDoDocumento(documento, hoje).estado] += 1;
  const essenciais = new Set(CATALOGO_DE_HABILITACAO.filter((item) => item.essencial).map((item) => item.tipo));
  const noAcervo = new Set(documentos.map((item) => texto(item.tipo, 80).toUpperCase()));
  return {
    ...contagem,
    total: documentos.length,
    // O que trava um RFQ agora: essencial vencido, ou essencial que nunca entrou.
    travando: documentos.filter((item) =>
      essenciais.has(texto(item.tipo, 80).toUpperCase())
      && ["vencido", "ausente", "reemitir"].includes(situacaoDoDocumento(item, hoje).estado)).length
      + [...essenciais].filter((tipo) => !noAcervo.has(tipo)).length,
    faltando: CATALOGO_DE_HABILITACAO.filter((item) => !noAcervo.has(item.tipo)).length,
  };
};

// O que nunca entrou no acervo, na ordem em que resolver: essencial primeiro,
// e dentro disso o que sai online e de graça em minutos antes do que depende de
// terceiro.
export const documentosQueFaltam = (documentos = []) => {
  const noAcervo = new Set(documentos.map((item) => texto(item.tipo, 80).toUpperCase()));
  return CATALOGO_DE_HABILITACAO
    .filter((item) => !noAcervo.has(item.tipo))
    .sort((a, b) => Number(Boolean(b.essencial)) - Number(Boolean(a.essencial)));
};

// ---- O ciclo do RFQ ----
//
// "Quando o cliente voltar em três meses perguntando 'mandaram o quê mesmo?', a
// resposta está lá." Por isso `pedido` guarda o texto CRU do e-mail e `enviados`
// guarda a lista exata do que saiu, com a data.
export const ETAPAS_DO_RFQ = Object.freeze([
  { id: "recebido", rotulo: "Chegou o pedido" },
  { id: "montando", rotulo: "Montando o kit" },
  { id: "enviado", rotulo: "Enviado" },
  { id: "ganho", rotulo: "Ganho" },
  { id: "perdido", rotulo: "Perdido" },
  { id: "sem-resposta", rotulo: "Sem resposta" },
]);

export const etapaDoRfqValida = (valor) => {
  const chave = texto(valor, 40).toLowerCase();
  return ETAPAS_DO_RFQ.some((item) => item.id === chave) ? chave : "recebido";
};

export const ETAPAS_FECHADAS = Object.freeze(["ganho", "perdido", "sem-resposta"]);

export const situacaoDoRfq = (rfq = {}, hoje = Date.now()) => {
  const etapa = etapaDoRfqValida(rfq.etapa);
  const prazo = dataValida(rfq.prazo);
  const agora = dataValida(hoje) ?? (Number.isFinite(hoje) ? hoje : Date.now());
  const fechado = ETAPAS_FECHADAS.includes(etapa);
  const dias = prazo === null ? null : Math.floor((prazo - agora) / dia);
  return {
    etapa,
    fechado,
    dias,
    // Prazo estourado num RFQ ainda aberto é a única urgência real da tela.
    atrasado: !fechado && dias !== null && dias < 0,
    // Fechar o ciclo sem motivo é jogar fora a única inteligência comercial que
    // um ano de RFQ produz.
    faltaMotivo: fechado && !texto(rfq.motivo),
  };
};
