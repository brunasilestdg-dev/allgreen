// ===== Fiscal: CT-e, MDF-e e NFS-e para transportadora =====
//
// Serviço próprio porque nada aqui é CRUD puro:
//
//   1. Documento fiscal tem CICLO DE VIDA — `rascunho → validado → assinado →
//      transmitido → autorizado` — e transições inválidas são recusadas. Não dá
//      para modelar isso como PATCH livre.
//
//   2. IMPOSTOS são calculados no servidor, não digitados. O front manda valores
//      do serviço e a tela mostra o resultado; o cálculo está no domínio e vale
//      para as duas pontas.
//
//   3. REFERÊNCIAS (NF-e dentro de CT-e, CT-e dentro de MDF-e) são tabela
//      separada com vínculo obrigatório.
//
//   4. TRANSMISSÃO à SEFAZ é desligada por ausência de certificado digital.
//      `fiscalTransmissionEnabled(env)` só retorna `true` com `NFE_CERT_PFX` e
//      `NFE_CERT_PASSWORD` no cofre. Sem eles a tela gera XML e DACTE localmente.
//
//   5. TODO EVENTO fica em `todogreen_fiscal_events` — o audit trail mostra quem
//      mudou o status, quando e por quê.

import { TENANT_ID, paginacao, podeNaVertical } from "./todogreen-access.js";
import {
  calcularImpostosCte,
  calcularImpostosNfse,
  calcularRetencoes,
  cfopPadraoCte,
  construirXmlCte,
  construirXmlMdfe,
  fiscalTransmissionEnabled,
  gerarChaveDeAcesso,
  resumoFiscal,
  transicaoValida,
  validarCte,
  validarMdfe,
  validarNfse,
  CODIGO_UF,
} from "../../src/features/logistics/fiscalDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 500) => String(valor ?? "").trim().slice(0, max);
const numero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};
const parse = (valor, alternativa) => {
  try {
    return JSON.parse(valor || "");
  } catch {
    return alternativa;
  }
};
const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
const lista = (valor) => (Array.isArray(valor) ? valor : []);

// ---------------------------------------------------------------------------
// Mapeamento banco → objeto
// ---------------------------------------------------------------------------

const perfilDaLinha = (row) => ({
  id: row.id,
  razaoSocial: row.razao_social,
  nomeFantasia: row.nome_fantasia,
  cnpj: row.cnpj,
  inscricaoEstadual: row.inscricao_estadual,
  inscricaoMunicipal: row.inscricao_municipal,
  cnae: row.cnae,
  logradouro: row.logradouro,
  numero: row.numero,
  complemento: row.complemento,
  bairro: row.bairro,
  municipio: row.municipio,
  codigoMunicipio: row.codigo_municipio,
  uf: row.uf,
  cep: row.cep,
  regimeTributario: row.regime_tributario,
  simplesAnexo: row.simples_anexo,
  faturamento12m: row.faturamento_12m,
  issAliquota: row.iss_aliquota,
  icmsAliquotaInterna: row.icms_aliquota_interna,
  certificadoStatus: row.certificado_status,
  certificadoValidade: row.certificado_validade,
  serieCte: row.serie_cte,
  serieMdfe: row.serie_mdfe,
  serieNfse: row.serie_nfse,
  rntrc: row.rntrc,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const documentoDaLinha = (row) => ({
  id: row.id,
  docType: row.doc_type,
  numero: row.numero,
  serie: row.serie,
  chaveAcesso: row.chave_acesso,
  status: row.status,
  statusSefaz: row.status_sefaz,
  motivoSefaz: row.motivo_sefaz,
  protocoloAutorizacao: row.protocolo_autorizacao,
  dataEmissao: row.data_emissao,
  dataPrestacao: row.data_prestacao,
  tomadorId: row.tomador_id,
  remetenteId: row.remetente_id,
  destinatarioId: row.destinatario_id,
  valorServico: row.valor_servico,
  valorFrete: row.valor_frete,
  valorSeguro: row.valor_seguro,
  valorPedagio: row.valor_pedagio,
  valorOutros: row.valor_outros,
  valorTotal: row.valor_total,
  icmsBase: row.icms_base,
  icmsAliquota: row.icms_aliquota,
  icmsValor: row.icms_valor,
  pisAliquota: row.pis_aliquota,
  pisValor: row.pis_valor,
  cofinsAliquota: row.cofins_aliquota,
  cofinsValor: row.cofins_valor,
  issAliquota: row.iss_aliquota,
  issValor: row.iss_valor,
  cstIcms: row.cst_icms,
  cfop: row.cfop,
  modal: row.modal,
  tipoServico: row.tipo_servico,
  ufInicio: row.uf_inicio,
  municipioInicio: row.municipio_inicio,
  codigoMunicipioInicio: row.codigo_municipio_inicio,
  ufFim: row.uf_fim,
  municipioFim: row.municipio_fim,
  codigoMunicipioFim: row.codigo_municipio_fim,
  placa: row.placa,
  ufVeiculo: row.uf_veiculo,
  rntrc: row.rntrc,
  motoristaNome: row.motorista_nome,
  motoristaCpf: row.motorista_cpf,
  operationId: row.operation_id,
  clientId: row.client_id,
  invoiceId: row.invoice_id || "",
  xmlContent: row.xml_content,
  campos: parse(row.fields_json, {}),
  revision: row.revision,
  criadoPor: row.created_by,
  atualizadoPor: row.updated_by,
  criadoEm: row.created_at,
  atualizadoEm: row.updated_at,
});

const referenciaDaLinha = (row) => ({
  id: row.id,
  fiscalDocumentId: row.fiscal_document_id,
  refType: row.ref_type,
  chaveAcesso: row.chave_acesso,
  numero: row.numero,
  serie: row.serie,
  emitenteCnpj: row.emitente_cnpj,
  emitenteNome: row.emitente_nome,
  valor: row.valor,
  pesoKg: row.peso_kg,
  volumes: row.volumes,
  campos: parse(row.fields_json, {}),
  criadoEm: row.created_at,
});

const eventoDaLinha = (row) => ({
  id: row.id,
  fiscalDocumentId: row.fiscal_document_id,
  eventType: row.event_type,
  statusAnterior: row.status_anterior,
  statusNovo: row.status_novo,
  detalhes: row.detalhes,
  protocolo: row.protocolo,
  criadoPor: row.created_by,
  criadoEm: row.created_at,
});

// ---------------------------------------------------------------------------
// Perfil fiscal (uma linha por workspace)
// ---------------------------------------------------------------------------

const lerPerfil = async (env, ownerId) => {
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_tax_profiles
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(TENANT_ID, ownerId).first();
  return row ? perfilDaLinha(row) : null;
};

const salvarPerfil = async (env, access, user, corpo) => {
  const agora = new Date().toISOString();
  const existente = await lerPerfil(env, access.ownerId);

  const dados = {
    razao_social: texto(corpo.razaoSocial, 200),
    nome_fantasia: texto(corpo.nomeFantasia, 200),
    cnpj: texto(corpo.cnpj, 18).replace(/\D/g, ""),
    inscricao_estadual: texto(corpo.inscricaoEstadual, 20),
    inscricao_municipal: texto(corpo.inscricaoMunicipal, 20),
    cnae: texto(corpo.cnae, 10),
    logradouro: texto(corpo.logradouro, 200),
    numero: texto(corpo.numero, 20),
    complemento: texto(corpo.complemento, 100),
    bairro: texto(corpo.bairro, 100),
    municipio: texto(corpo.municipio, 100),
    codigo_municipio: texto(corpo.codigoMunicipio, 10),
    uf: texto(corpo.uf, 2).toUpperCase(),
    cep: texto(corpo.cep, 10).replace(/\D/g, ""),
    regime_tributario: ["simples", "lucro_presumido", "lucro_real"].includes(texto(corpo.regimeTributario, 20))
      ? texto(corpo.regimeTributario, 20) : "simples",
    simples_anexo: ["III", "V"].includes(texto(corpo.simplesAnexo, 5))
      ? texto(corpo.simplesAnexo, 5) : "III",
    faturamento_12m: numero(corpo.faturamento12m),
    iss_aliquota: numero(corpo.issAliquota),
    icms_aliquota_interna: numero(corpo.icmsAliquotaInterna),
    certificado_status: ["pendente", "ativo", "vencido"].includes(texto(corpo.certificadoStatus, 20))
      ? texto(corpo.certificadoStatus, 20) : "pendente",
    certificado_validade: texto(corpo.certificadoValidade, 20) || null,
    serie_cte: Math.max(1, Math.trunc(numero(corpo.serieCte) || 1)),
    serie_mdfe: Math.max(1, Math.trunc(numero(corpo.serieMdfe) || 1)),
    serie_nfse: Math.max(1, Math.trunc(numero(corpo.serieNfse) || 1)),
    rntrc: texto(corpo.rntrc, 20),
    fields_json: JSON.stringify(objeto(corpo.campos)),
  };

  if (existente) {
    if (numero(corpo.revision) !== existente.revision)
      return json({ error: "O perfil fiscal foi alterado por outra pessoa. Recarregue a página." }, 409);
    const sets = Object.keys(dados).map((k) => `${k} = ?`).join(", ");
    await env.DB.prepare(
      `UPDATE todogreen_tax_profiles
        SET ${sets}, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(...Object.values(dados), user.id, agora, existente.id, TENANT_ID, access.ownerId).run();
    return json(await lerPerfil(env, access.ownerId));
  }

  const id = crypto.randomUUID();
  const colunas = Object.keys(dados).join(", ");
  const placeholders = Object.keys(dados).map(() => "?").join(", ");
  await env.DB.prepare(
    `INSERT INTO todogreen_tax_profiles
      (id, tenant_id, workspace_owner_id, ${colunas}, revision, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ${placeholders}, 1, ?, ?, ?, ?)`,
  ).bind(id, TENANT_ID, access.ownerId, ...Object.values(dados), user.id, user.id, agora, agora).run();
  return json(await lerPerfil(env, access.ownerId), 201);
};

// ---------------------------------------------------------------------------
// Documentos fiscais
// ---------------------------------------------------------------------------

const listarDocumentos = async (env, access, url) => {
  const { limit, offset } = paginacao(url);
  const tipo = texto(url.searchParams.get("tipo"), 10);
  const status = texto(url.searchParams.get("status"), 20);
  const filtros = [
    tipo ? "AND doc_type = ?" : "",
    status ? "AND status = ?" : "",
  ].join(" ");
  const params = [TENANT_ID, access.ownerId, ...(tipo ? [tipo] : []), ...(status ? [status] : [])];
  const base = `FROM todogreen_fiscal_documents
    WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL ${filtros}`;
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(`SELECT * ${base} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  return json({
    registros: (results || []).map(documentoDaLinha),
    total: totalRow?.total || 0,
    limit,
    offset,
  });
};

const criarDocumento = async (env, access, user, corpo) => {
  const agora = new Date().toISOString();
  const docType = texto(corpo.docType, 10);
  if (!["cte", "mdfe", "nfse"].includes(docType))
    return json({ error: "Tipo de documento inválido. Use cte, mdfe ou nfse." }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO todogreen_fiscal_documents
      (id, tenant_id, workspace_owner_id, doc_type, numero, serie, status,
       data_emissao, data_prestacao, tomador_id, remetente_id, destinatario_id,
       valor_servico, valor_frete, valor_seguro, valor_pedagio, valor_outros, valor_total,
       icms_base, icms_aliquota, icms_valor, pis_aliquota, pis_valor,
       cofins_aliquota, cofins_valor, iss_aliquota, iss_valor,
       cst_icms, cfop, modal, tipo_servico,
       uf_inicio, municipio_inicio, codigo_municipio_inicio,
       uf_fim, municipio_fim, codigo_municipio_fim,
       placa, uf_veiculo, rntrc, motorista_nome, motorista_cpf,
       operation_id, client_id, invoice_id, fields_json,
       revision, created_by, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,  'rascunho',
      ?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,
      ?,?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,
      1,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, docType,
    corpo.numero ? Math.trunc(numero(corpo.numero)) : null,
    Math.trunc(numero(corpo.serie) || 1),
    texto(corpo.dataEmissao, 20) || agora.slice(0, 10),
    texto(corpo.dataPrestacao, 20) || null,
    texto(corpo.tomadorId, 120) || null,
    texto(corpo.remetenteId, 120) || null,
    texto(corpo.destinatarioId, 120) || null,
    numero(corpo.valorServico), numero(corpo.valorFrete),
    numero(corpo.valorSeguro), numero(corpo.valorPedagio),
    numero(corpo.valorOutros), numero(corpo.valorTotal),
    numero(corpo.icmsBase), numero(corpo.icmsAliquota), numero(corpo.icmsValor),
    numero(corpo.pisAliquota), numero(corpo.pisValor),
    numero(corpo.cofinsAliquota), numero(corpo.cofinsValor),
    numero(corpo.issAliquota), numero(corpo.issValor),
    texto(corpo.cstIcms, 5) || "00",
    texto(corpo.cfop, 5),
    ["rodoviario", "aereo", "aquaviario", "ferroviario", "dutoviario", "multimodal"].includes(texto(corpo.modal, 20))
      ? texto(corpo.modal, 20) : "rodoviario",
    ["normal", "subcontratacao", "redespacho", "redespacho_intermediario", "multimodal"].includes(texto(corpo.tipoServico, 30))
      ? texto(corpo.tipoServico, 30) : "normal",
    texto(corpo.ufInicio, 2).toUpperCase(),
    texto(corpo.municipioInicio, 100),
    texto(corpo.codigoMunicipioInicio, 10),
    texto(corpo.ufFim, 2).toUpperCase(),
    texto(corpo.municipioFim, 100),
    texto(corpo.codigoMunicipioFim, 10),
    texto(corpo.placa, 10).toUpperCase(),
    texto(corpo.ufVeiculo, 2).toUpperCase(),
    texto(corpo.rntrc, 20),
    texto(corpo.motoristaNome, 160),
    texto(corpo.motoristaCpf, 14).replace(/\D/g, ""),
    texto(corpo.operationId, 120) || null,
    texto(corpo.clientId, 120) || null,
    texto(corpo.invoiceId, 120),
    JSON.stringify(objeto(corpo.campos)),
    user.id, user.id, agora, agora,
  ).run();

  // Número digitado (documento emitido fora do ERP) também avança o contador
  // da série: sem isto a próxima assinatura reservaria o mesmo número e
  // esbarraria no índice único da 0069.
  const numeroDigitado = Math.trunc(numero(corpo.numero));
  if (numeroDigitado > 0) {
    await env.DB.prepare(
      `INSERT INTO todogreen_fiscal_series
         (id, tenant_id, workspace_owner_id, doc_type, serie, next_number, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(tenant_id, workspace_owner_id, doc_type, serie)
       DO UPDATE SET next_number = MAX(next_number, excluded.next_number), updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), TENANT_ID, access.ownerId, docType,
      Math.trunc(numero(corpo.serie) || 1), numeroDigitado + 1, agora, agora,
    ).run();
  }

  await registrarEvento(env, access.ownerId, user.id, id, "criacao", null, "rascunho", "Documento criado.");

  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(id, TENANT_ID, access.ownerId).first();
  return json(documentoDaLinha(row), 201);
};

const atualizarDocumento = async (env, access, user, docId, corpo) => {
  const agora = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(docId, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Documento não encontrado." }, 404);
  if (row.status !== "rascunho")
    return json({ error: "Só documentos em rascunho podem ser editados." }, 409);
  if (numero(corpo.revision) !== row.revision)
    return json({ error: "O documento foi alterado por outra pessoa. Recarregue." }, 409);

  await env.DB.prepare(
    `UPDATE todogreen_fiscal_documents SET
      data_emissao = ?, data_prestacao = ?,
      tomador_id = ?, remetente_id = ?, destinatario_id = ?,
      valor_servico = ?, valor_frete = ?, valor_seguro = ?, valor_pedagio = ?,
      valor_outros = ?, valor_total = ?,
      icms_base = ?, icms_aliquota = ?, icms_valor = ?,
      pis_aliquota = ?, pis_valor = ?, cofins_aliquota = ?, cofins_valor = ?,
      iss_aliquota = ?, iss_valor = ?,
      cst_icms = ?, cfop = ?, modal = ?, tipo_servico = ?,
      uf_inicio = ?, municipio_inicio = ?, codigo_municipio_inicio = ?,
      uf_fim = ?, municipio_fim = ?, codigo_municipio_fim = ?,
      placa = ?, uf_veiculo = ?, rntrc = ?,
      motorista_nome = ?, motorista_cpf = ?,
      operation_id = ?, client_id = ?, fields_json = ?,
      revision = revision + 1, updated_by = ?, updated_at = ?
    WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(
    texto(corpo.dataEmissao, 20) || row.data_emissao,
    texto(corpo.dataPrestacao, 20) || row.data_prestacao,
    texto(corpo.tomadorId, 120) || row.tomador_id,
    texto(corpo.remetenteId, 120) || row.remetente_id,
    texto(corpo.destinatarioId, 120) || row.destinatario_id,
    numero(corpo.valorServico ?? row.valor_servico),
    numero(corpo.valorFrete ?? row.valor_frete),
    numero(corpo.valorSeguro ?? row.valor_seguro),
    numero(corpo.valorPedagio ?? row.valor_pedagio),
    numero(corpo.valorOutros ?? row.valor_outros),
    numero(corpo.valorTotal ?? row.valor_total),
    numero(corpo.icmsBase ?? row.icms_base),
    numero(corpo.icmsAliquota ?? row.icms_aliquota),
    numero(corpo.icmsValor ?? row.icms_valor),
    numero(corpo.pisAliquota ?? row.pis_aliquota),
    numero(corpo.pisValor ?? row.pis_valor),
    numero(corpo.cofinsAliquota ?? row.cofins_aliquota),
    numero(corpo.cofinsValor ?? row.cofins_valor),
    numero(corpo.issAliquota ?? row.iss_aliquota),
    numero(corpo.issValor ?? row.iss_valor),
    texto(corpo.cstIcms, 5) || row.cst_icms,
    texto(corpo.cfop, 5) || row.cfop,
    texto(corpo.modal, 20) || row.modal,
    texto(corpo.tipoServico, 30) || row.tipo_servico,
    texto(corpo.ufInicio, 2).toUpperCase() || row.uf_inicio,
    texto(corpo.municipioInicio, 100) || row.municipio_inicio,
    texto(corpo.codigoMunicipioInicio, 10) || row.codigo_municipio_inicio,
    texto(corpo.ufFim, 2).toUpperCase() || row.uf_fim,
    texto(corpo.municipioFim, 100) || row.municipio_fim,
    texto(corpo.codigoMunicipioFim, 10) || row.codigo_municipio_fim,
    (texto(corpo.placa, 10) || row.placa).toUpperCase(),
    (texto(corpo.ufVeiculo, 2) || row.uf_veiculo).toUpperCase(),
    texto(corpo.rntrc, 20) || row.rntrc,
    texto(corpo.motoristaNome, 160) || row.motorista_nome,
    (texto(corpo.motoristaCpf, 14) || row.motorista_cpf).replace(/\D/g, ""),
    texto(corpo.operationId, 120) || row.operation_id,
    texto(corpo.clientId, 120) || row.client_id,
    JSON.stringify({ ...parse(row.fields_json, {}), ...objeto(corpo.campos) }),
    user.id, agora,
    docId, TENANT_ID, access.ownerId,
  ).run();

  const atualizado = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(docId, TENANT_ID, access.ownerId).first();
  return json(documentoDaLinha(atualizado));
};

// ---------------------------------------------------------------------------
// Transição de status
// ---------------------------------------------------------------------------

const transitarDocumento = async (env, access, user, docId, corpo) => {
  const agora = new Date().toISOString();
  const statusNovo = texto(corpo.statusNovo || corpo.status, 20);
  const detalhes = texto(corpo.detalhes || corpo.motivo, 2000);

  const row = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(docId, TENANT_ID, access.ownerId).first();
  if (!row) return json({ error: "Documento não encontrado." }, 404);

  if (!transicaoValida(row.status, statusNovo))
    return json({
      error: `Transição de "${row.status}" para "${statusNovo}" não é permitida.`,
    }, 409);

  // "Transmitido"/"autorizado" só existem de verdade com o certificado no
  // cofre — o mesmo padrão do push e do WhatsApp. A única exceção é o registro
  // de documento emitido FORA do ERP, que exige o protocolo de autorização e a
  // chave devolvidos pelo autorizador. Sem esta guarda, um clique fabricava um
  // "autorizado" que a SEFAZ nunca viu, e o DACTE e a cobrança confiavam nele.
  if (["transmitido", "autorizado"].includes(statusNovo) && !fiscalTransmissionEnabled(env)) {
    const protocolo = texto(corpo.protocoloAutorizacao || corpo.protocolo, 60);
    const chaveExterna = texto(corpo.chaveAcesso, 44).replace(/\D/g, "");
    const registroManual = protocolo && (chaveExterna.length === 44 || texto(row.chave_acesso, 44));
    if (!registroManual)
      return json({
        error: "A transmissão à SEFAZ aguarda o certificado digital (NFE_CERT_PFX/NFE_CERT_PASSWORD no cofre). Para registrar um documento emitido fora do ERP, informe o protocolo de autorização e a chave de acesso.",
        code: "fiscal_transmission_disabled",
      }, 409);
    await env.DB.prepare(
      `UPDATE todogreen_fiscal_documents
          SET chave_acesso = COALESCE(NULLIF(?, ''), chave_acesso),
              protocolo_autorizacao = ?,
              fields_json = json_set(fields_json, '$.registroManual', 1)
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(chaveExterna, protocolo, docId, TENANT_ID, access.ownerId).run();
  }

  // Validar antes de avançar de rascunho para validado — e RECALCULAR os
  // impostos no servidor antes de validar. O corpo do POST podia trazer ICMS
  // zero e o documento seguia adiante com o número que o cliente mandou; a
  // validação agora carimba o cálculo do motor sobre o perfil fiscal vigente.
  if (statusNovo === "validado") {
    const perfil = await lerPerfil(env, access.ownerId);
    if (!perfil) return json({ error: "Configure o perfil fiscal antes de validar." }, 400);
    const baseServico = numero(row.valor_servico) || numero(row.valor_total);
    if (["cte", "mdfe"].includes(row.doc_type)) {
      const impostos = calcularImpostosCte({
        valorServico: baseServico,
        ufOrigem: row.uf_inicio,
        ufDestino: row.uf_fim,
        regimeEmitente: perfil.regimeTributario || "simples",
        faturamento12m: perfil.faturamento12m || 0,
        aliquotaInterna: perfil.icmsAliquotaInterna || 18,
        cstIcms: row.cst_icms,
      });
      row.icms_base = impostos.icms.icmsBase;
      row.icms_aliquota = impostos.icms.icmsAliquota;
      row.icms_valor = impostos.icms.icmsValor;
      row.cst_icms = impostos.icms.cstIcms;
      row.pis_aliquota = impostos.pisCofins.pisAliquota;
      row.pis_valor = impostos.pisCofins.pisValor;
      row.cofins_aliquota = impostos.pisCofins.cofinsAliquota;
      row.cofins_valor = impostos.pisCofins.cofinsValor;
      if (!row.cfop) row.cfop = cfopPadraoCte(row.uf_inicio, row.uf_fim);
    } else {
      const impostos = calcularImpostosNfse({
        valorServico: baseServico,
        aliquotaIss: perfil.issAliquota || 2,
        regimeEmitente: perfil.regimeTributario || "simples",
        faturamento12m: perfil.faturamento12m || 0,
      });
      row.iss_aliquota = impostos.iss.issAliquota;
      row.iss_valor = impostos.iss.issValor;
      row.pis_aliquota = impostos.pisCofins.pisAliquota;
      row.pis_valor = impostos.pisCofins.pisValor;
      row.cofins_aliquota = impostos.pisCofins.cofinsAliquota;
      row.cofins_valor = impostos.pisCofins.cofinsValor;
    }
    await env.DB.prepare(
      `UPDATE todogreen_fiscal_documents SET
          icms_base = ?, icms_aliquota = ?, icms_valor = ?, cst_icms = ?,
          pis_aliquota = ?, pis_valor = ?, cofins_aliquota = ?, cofins_valor = ?,
          iss_aliquota = ?, iss_valor = ?, cfop = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(
      row.icms_base, row.icms_aliquota, row.icms_valor, row.cst_icms,
      row.pis_aliquota, row.pis_valor, row.cofins_aliquota, row.cofins_valor,
      row.iss_aliquota, row.iss_valor, row.cfop,
      docId, TENANT_ID, access.ownerId,
    ).run();

    const doc = documentoDaLinha(row);
    const erros = row.doc_type === "cte" ? validarCte(doc)
      : row.doc_type === "mdfe" ? validarMdfe(doc)
        : validarNfse(doc);
    if (erros.length)
      return json({ error: "Documento com pendências.", erros }, 400);
  }

  // Gerar XML ao assinar (se CT-e ou MDF-e)
  let xmlContent = row.xml_content;
  if (statusNovo === "assinado" && ["cte", "mdfe"].includes(row.doc_type)) {
    const perfil = await lerPerfil(env, access.ownerId);
    if (!perfil) return json({ error: "Configure o perfil fiscal antes de assinar." }, 400);

    // Número sequencial por tipo e série, reservado no servidor na assinatura —
    // nunca digitado no cliente. A reserva é ATÔMICA sobre a série de
    // documentos (UPDATE ... RETURNING), o mesmo mecanismo das OS: o antigo
    // MAX(numero)+1 era leitura-depois-escrita e duas assinaturas simultâneas
    // saíam com o mesmo número fiscal. O índice único da 0069 é o cinto.
    if (!row.numero) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO todogreen_fiscal_series
           (id, tenant_id, workspace_owner_id, doc_type, serie, next_number, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?,?)`,
      ).bind(crypto.randomUUID(), TENANT_ID, access.ownerId, row.doc_type, row.serie, agora, agora).run();
      const reservado = await env.DB.prepare(
        `UPDATE todogreen_fiscal_series SET next_number = next_number + 1, updated_at = ?
          WHERE tenant_id = ? AND workspace_owner_id = ? AND doc_type = ? AND serie = ?
          RETURNING next_number - 1 AS numero`,
      ).bind(agora, TENANT_ID, access.ownerId, row.doc_type, row.serie).first();
      row.numero = reservado?.numero || 1;
      await env.DB.prepare(
        `UPDATE todogreen_fiscal_documents SET numero = ? WHERE id = ?`,
      ).bind(row.numero, docId).run();
    }

    if (row.doc_type === "cte") {
      const refs = await listarReferenciasInterno(env, access.ownerId, docId);
      const chave = gerarChaveDeAcesso({
        cuf: CODIGO_UF[perfil.uf] || 35,
        aamm: (row.data_emissao || agora).slice(2, 4) + (row.data_emissao || agora).slice(5, 7),
        cnpj: perfil.cnpj,
        mod: "57",
        serie: row.serie,
        numero: row.numero || 1,
        codigo: String(Math.floor(Math.random() * 99999999)).padStart(8, "0"),
      });
      xmlContent = construirXmlCte({
        chaveAcesso: chave,
        emitente: perfil,
        remetente: { nome: row.motorista_nome, cnpj: "" },
        destinatario: { nome: "", cnpj: "" },
        ide: {
          numero: row.numero || 1,
          serie: row.serie,
          dataEmissao: row.data_emissao || agora.slice(0, 10),
          cfop: row.cfop,
          modal: row.modal,
          tipoServico: row.tipo_servico,
          ufInicio: row.uf_inicio,
          municipioInicio: row.municipio_inicio,
          codigoMunicipioInicio: row.codigo_municipio_inicio,
          ufFim: row.uf_fim,
          municipioFim: row.municipio_fim,
          codigoMunicipioFim: row.codigo_municipio_fim,
        },
        // O construtor lê `valores.total`, `impostos.icms`/`impostos.pisCofins`
        // e `referencia.chave` (contrato coberto por fiscalDomain.test.js).
        // Passar `valorTotal`, impostos achatados ou `chaveAcesso` zerava o XML.
        valores: { total: row.valor_total },
        impostos: {
          icms: {
            icmsBase: row.icms_base,
            icmsAliquota: row.icms_aliquota,
            icmsValor: row.icms_valor,
            cstIcms: row.cst_icms,
          },
          pisCofins: {
            pisAliquota: row.pis_aliquota,
            pisValor: row.pis_valor,
            cofinsAliquota: row.cofins_aliquota,
            cofinsValor: row.cofins_valor,
          },
        },
        referencias: refs.map((r) => ({
          chave: r.chaveAcesso,
          tipo: r.refType,
        })),
        veiculo: { placa: row.placa, uf: row.uf_veiculo, rntrc: row.rntrc },
        motorista: { nome: row.motorista_nome, cpf: row.motorista_cpf },
      });
      await env.DB.prepare(
        `UPDATE todogreen_fiscal_documents SET chave_acesso = ? WHERE id = ?`,
      ).bind(chave, docId).run();
    } else {
      const chave = gerarChaveDeAcesso({
        cuf: CODIGO_UF[perfil.uf] || 35,
        aamm: (row.data_emissao || agora).slice(2, 4) + (row.data_emissao || agora).slice(5, 7),
        cnpj: perfil.cnpj,
        mod: "58",
        serie: row.serie,
        numero: row.numero || 1,
        codigo: String(Math.floor(Math.random() * 99999999)).padStart(8, "0"),
      });
      const cteRefs = await listarReferenciasInterno(env, access.ownerId, docId);
      xmlContent = construirXmlMdfe({
        chaveAcesso: chave,
        emitente: perfil,
        ide: {
          numero: row.numero || 1,
          serie: row.serie,
          dataEmissao: row.data_emissao || agora.slice(0, 10),
          modal: row.modal,
          ufInicio: row.uf_inicio,
          ufFim: row.uf_fim,
        },
        veiculo: { placa: row.placa, uf: row.uf_veiculo, rntrc: row.rntrc },
        motorista: { nome: row.motorista_nome, cpf: row.motorista_cpf },
        ctes: cteRefs.map((r) => ({ chave: r.chaveAcesso })),
        totais: { valorCarga: row.valor_total, pesoCarga: 0 },
      });
      await env.DB.prepare(
        `UPDATE todogreen_fiscal_documents SET chave_acesso = ? WHERE id = ?`,
      ).bind(chave, docId).run();
    }
  }

  // Cancelar um documento fiscal ligado a uma fatura tem de desfazer o
  // recebível que ele gerou — senão receita e contas a receber ficam
  // superavaliadas (a fatura foi cancelada, mas o título segue cobrável). Só
  // estornamos se o título ainda não teve baixa: se já houve pagamento, o
  // caixa recebido é real e a baixa precisa ser estornada antes, à mão.
  if (statusNovo === "cancelado" && row.invoice_id) {
    const titulo = await env.DB.prepare(
      `SELECT id, status, original_amount, open_amount FROM todogreen_financial_titles
        WHERE invoice_id = ? AND tenant_id = ? AND workspace_owner_id = ? AND kind = 'receivable' AND archived_at IS NULL`,
    ).bind(row.invoice_id, TENANT_ID, access.ownerId).first();
    if (titulo && titulo.status !== "cancelled") {
      if (numero(titulo.open_amount) < numero(titulo.original_amount) - 0.0001)
        return json({
          error: "O título deste documento já teve baixa. Estorne a baixa na Tesouraria antes de cancelar a nota, para não apagar um recebimento real.",
          code: "titulo_com_baixa",
        }, 409);
      // Título sem baixa: cancela o recebível e o espelho no razão (ponte 0069).
      await env.DB.prepare(
        `UPDATE todogreen_financial_titles SET status = 'cancelled', open_amount = 0,
           revision = revision + 1, updated_by = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(user.id, agora, titulo.id, TENANT_ID, access.ownerId).run();
      await env.DB.prepare(
        `UPDATE todogreen_financial_entries SET invoice_status = 'cancelled', status = 'cancelled',
           revision = revision + 1, updated_by = ?, updated_at = ?
         WHERE id = 'entry-' || ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(user.id, agora, titulo.id, TENANT_ID, access.ownerId).run();
    }
  }

  await env.DB.prepare(
    `UPDATE todogreen_fiscal_documents
      SET status = ?, xml_content = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(statusNovo, xmlContent, user.id, agora, docId, TENANT_ID, access.ownerId).run();

  await registrarEvento(env, access.ownerId, user.id, docId, "transicao", row.status, statusNovo, detalhes);

  const atualizado = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(docId, TENANT_ID, access.ownerId).first();
  return json(documentoDaLinha(atualizado));
};

// ---------------------------------------------------------------------------
// Elo com o faturamento. O fechamento (todogreen_invoices) preparava um
// "CTE-000123" que a SEFAZ nunca viu, e o módulo fiscal exigia redigitar tudo.
// Agora a fatura preparada vira RASCUNHO fiscal pré-preenchido com o que o ERP
// já sabe (cliente, valor, OS, operação, placa, motorista) — a pessoa completa
// UFs/municípios e segue o ciclo validar → assinar.
// ---------------------------------------------------------------------------

const listarFaturasPendentes = async (env, access) => {
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.number, i.document_type, i.amount, i.issued_at,
            r.client_id, r.competence_date
       FROM todogreen_invoices i
       JOIN todogreen_billing_runs r ON r.id = i.billing_run_id
      WHERE i.tenant_id = ? AND i.workspace_owner_id = ?
        AND i.document_type IN ('cte', 'nfse')
        AND NOT EXISTS (
          SELECT 1 FROM todogreen_fiscal_documents f
           WHERE f.tenant_id = i.tenant_id AND f.workspace_owner_id = i.workspace_owner_id
             AND f.invoice_id = i.id AND f.archived_at IS NULL
        )
      ORDER BY i.created_at DESC LIMIT 100`,
  ).bind(TENANT_ID, access.ownerId).all();
  return json({
    registros: (results || []).map((row) => ({
      invoiceId: row.id, numeroFatura: row.number, docType: row.document_type,
      valor: row.amount, emitidaEm: row.issued_at, clientId: row.client_id,
      competencia: row.competence_date,
    })),
  });
};

const criarDaFatura = async (env, access, user, corpo) => {
  const invoiceId = texto(corpo.invoiceId, 120);
  if (!invoiceId) return json({ error: "Informe a fatura de origem." }, 400);
  const fatura = await env.DB.prepare(
    `SELECT i.*, r.client_id AS run_client_id, r.competence_date AS run_competence
       FROM todogreen_invoices i
       JOIN todogreen_billing_runs r ON r.id = i.billing_run_id
      WHERE i.id = ? AND i.tenant_id = ? AND i.workspace_owner_id = ?`,
  ).bind(invoiceId, TENANT_ID, access.ownerId).first();
  if (!fatura) return json({ error: "Fatura não encontrada." }, 404);
  const jaExiste = await env.DB.prepare(
    `SELECT id FROM todogreen_fiscal_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND invoice_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId, invoiceId).first();
  if (jaExiste) return json({ error: "Esta fatura já tem documento fiscal preparado.", documentoId: jaExiste.id }, 409);

  // O que o ERP já sabe sobre este frete: a OS do item faturado e, por ela, a
  // operação com placa e motorista.
  const item = await env.DB.prepare(
    `SELECT os.id AS os_id, os.operation_id
       FROM todogreen_billing_items b
       JOIN todogreen_service_orders os ON os.id = b.service_order_id
      WHERE b.tenant_id = ? AND b.workspace_owner_id = ? AND b.billing_run_id = ?
      ORDER BY b.created_at LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, fatura.billing_run_id).first();
  const operacao = item?.operation_id ? await env.DB.prepare(
    `SELECT vehicle_plate, driver_name, origin, destination FROM todogreen_client_operations
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  ).bind(item.operation_id, TENANT_ID, access.ownerId).first() : null;

  return criarDocumento(env, access, user, {
    docType: ["cte", "nfse"].includes(fatura.document_type) ? fatura.document_type : "cte",
    valorServico: fatura.amount,
    valorTotal: fatura.amount,
    dataEmissao: new Date().toISOString().slice(0, 10),
    clientId: fatura.run_client_id,
    tomadorId: fatura.run_client_id,
    operationId: item?.operation_id || "",
    placa: operacao?.vehicle_plate || "",
    motoristaNome: operacao?.driver_name || "",
    invoiceId,
    campos: {
      origemFaturamento: fatura.number,
      serviceOrderId: item?.os_id || "",
      origemOperacional: operacao?.origin || "",
      destinoOperacional: operacao?.destination || "",
      competencia: fatura.run_competence || "",
    },
  });
};

// ---------------------------------------------------------------------------
// Calcular impostos (endpoint de apoio para a tela)
// ---------------------------------------------------------------------------

const calcularImpostos = async (env, access, corpo) => {
  const perfil = await lerPerfil(env, access.ownerId);
  const tipo = texto(corpo.docType || corpo.tipo, 10);
  const valorServico = numero(corpo.valorServico);

  if (tipo === "cte" || tipo === "mdfe") {
    const impostos = calcularImpostosCte({
      valorServico,
      ufOrigem: texto(corpo.ufOrigem || corpo.ufInicio, 2).toUpperCase(),
      ufDestino: texto(corpo.ufDestino || corpo.ufFim, 2).toUpperCase(),
      regimeEmitente: perfil?.regimeTributario || "simples",
      faturamento12m: perfil?.faturamento12m || 0,
      aliquotaInterna: perfil?.icmsAliquotaInterna || 18,
      cstIcms: texto(corpo.cstIcms, 5),
    });
    const cfop = cfopPadraoCte(
      texto(corpo.ufOrigem || corpo.ufInicio, 2).toUpperCase(),
      texto(corpo.ufDestino || corpo.ufFim, 2).toUpperCase(),
    );
    const retencoes = calcularRetencoes(valorServico, objeto(corpo.retencoes));
    return json({ ...impostos, cfop, retencoes });
  }

  if (tipo === "nfse") {
    const impostos = calcularImpostosNfse({
      valorServico,
      aliquotaIss: perfil?.issAliquota || 2,
      regimeEmitente: perfil?.regimeTributario || "simples",
      faturamento12m: perfil?.faturamento12m || 0,
    });
    const retencoes = calcularRetencoes(valorServico, objeto(corpo.retencoes));
    return json({ ...impostos, retencoes });
  }

  return json({ error: "Tipo deve ser cte, mdfe ou nfse." }, 400);
};

// ---------------------------------------------------------------------------
// Referências (NF-e no CT-e, CT-e no MDF-e)
// ---------------------------------------------------------------------------

const listarReferenciasInterno = async (env, ownerId, docId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_document_refs
      WHERE fiscal_document_id = ? AND tenant_id = ? AND workspace_owner_id = ?
      ORDER BY created_at`,
  ).bind(docId, TENANT_ID, ownerId).all();
  return (results || []).map(referenciaDaLinha);
};

const listarReferencias = async (env, access, docId) => {
  return json({ registros: await listarReferenciasInterno(env, access.ownerId, docId) });
};

const adicionarReferencia = async (env, access, user, docId, corpo) => {
  const doc = await env.DB.prepare(
    `SELECT id, status FROM todogreen_fiscal_documents
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(docId, TENANT_ID, access.ownerId).first();
  if (!doc) return json({ error: "Documento fiscal não encontrado." }, 404);
  if (doc.status !== "rascunho")
    return json({ error: "Só é possível adicionar referências a documentos em rascunho." }, 409);

  const refType = texto(corpo.refType || corpo.tipo, 10);
  if (!["nfe", "cte", "outros"].includes(refType))
    return json({ error: "Tipo de referência deve ser nfe, cte ou outros." }, 400);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_fiscal_document_refs
      (id, tenant_id, workspace_owner_id, fiscal_document_id, ref_type,
       chave_acesso, numero, serie, emitente_cnpj, emitente_nome,
       valor, peso_kg, volumes, fields_json, created_at)
    VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?)`,
  ).bind(
    id, TENANT_ID, access.ownerId, docId, refType,
    texto(corpo.chaveAcesso, 50),
    texto(corpo.numero, 20),
    texto(corpo.serie, 10),
    texto(corpo.emitenteCnpj, 18).replace(/\D/g, ""),
    texto(corpo.emitenteNome, 200),
    numero(corpo.valor), numero(corpo.pesoKg), Math.trunc(numero(corpo.volumes)),
    JSON.stringify(objeto(corpo.campos)), agora,
  ).run();

  return json(referenciaDaLinha(
    await env.DB.prepare(`SELECT * FROM todogreen_fiscal_document_refs WHERE id = ?`).bind(id).first(),
  ), 201);
};

// ---------------------------------------------------------------------------
// Eventos (audit trail)
// ---------------------------------------------------------------------------

const registrarEvento = async (env, ownerId, userId, docId, tipo, statusAnterior, statusNovo, detalhes = "") => {
  await env.DB.prepare(
    `INSERT INTO todogreen_fiscal_events
      (id, tenant_id, workspace_owner_id, fiscal_document_id, event_type,
       status_anterior, status_novo, detalhes, created_by, created_at)
    VALUES (?,?,?,?,?, ?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(), TENANT_ID, ownerId, docId, tipo,
    statusAnterior, statusNovo, detalhes, userId, new Date().toISOString(),
  ).run();
};

const listarEventos = async (env, access, docId) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_events
      WHERE fiscal_document_id = ? AND tenant_id = ? AND workspace_owner_id = ?
      ORDER BY created_at DESC`,
  ).bind(docId, TENANT_ID, access.ownerId).all();
  return json({ registros: (results || []).map(eventoDaLinha) });
};

// ---------------------------------------------------------------------------
// Resumo fiscal
// ---------------------------------------------------------------------------

const obterResumo = async (env, access) => {
  const { results } = await env.DB.prepare(
    `SELECT * FROM todogreen_fiscal_documents
      WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId).all();
  // resumoFiscal lê as colunas do banco (doc_type, icms_valor, valor_total) —
  // passar o mapa camelCase zerava os três indicadores do painel para sempre.
  const transmissaoHabilitada = fiscalTransmissionEnabled(env);
  return json({ ...resumoFiscal(results || []), transmissaoHabilitada });
};

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

export async function handleTodoGreenFiscal(request, env, access, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/todogreen/fiscal", "");
  const method = request.method;

  if (!podeNaVertical(access, "fiscal:manage"))
    return json({ error: "Sem permissão para o módulo fiscal." }, 403);

  // Perfil fiscal
  if (path === "/profile" || path === "/perfil") {
    if (method === "GET") return json(await lerPerfil(env, access.ownerId));
    if (method === "POST" || method === "PUT") {
      const corpo = await request.json().catch(() => ({}));
      return salvarPerfil(env, access, user, corpo);
    }
  }

  // Calcular impostos (endpoint de apoio)
  if (path === "/calcular" && method === "POST") {
    const corpo = await request.json().catch(() => ({}));
    return calcularImpostos(env, access, corpo);
  }

  // Resumo
  if (path === "/resumo" || path === "/summary") {
    if (method === "GET") return obterResumo(env, access);
  }

  // Faturamento aguardando emissão — o elo com a espinha transacional.
  if (path === "/faturas-pendentes" && method === "GET")
    return listarFaturasPendentes(env, access);
  if (path === "/documentos/da-fatura" && method === "POST") {
    const corpo = await request.json().catch(() => ({}));
    return criarDaFatura(env, access, user, corpo);
  }

  // Documentos com sub-rotas
  const docMatch = path.match(/^\/documentos\/([^/]+)(?:\/(.+))?$/);
  if (docMatch) {
    const [, docId, subPath] = docMatch;
    if (subPath === "transicao" && method === "POST") {
      const corpo = await request.json().catch(() => ({}));
      return transitarDocumento(env, access, user, docId, corpo);
    }
    if (subPath === "referencias" || subPath === "refs") {
      if (method === "GET") return listarReferencias(env, access, docId);
      if (method === "POST") {
        const corpo = await request.json().catch(() => ({}));
        return adicionarReferencia(env, access, user, docId, corpo);
      }
    }
    if (subPath === "eventos" || subPath === "events") {
      if (method === "GET") return listarEventos(env, access, docId);
    }
    if (!subPath) {
      if (method === "PATCH") {
        const corpo = await request.json().catch(() => ({}));
        return atualizarDocumento(env, access, user, docId, corpo);
      }
    }
  }

  // Lista e criação de documentos
  if (path === "/documentos" || path === "") {
    if (method === "GET") return listarDocumentos(env, access, url);
    if (method === "POST") {
      const corpo = await request.json().catch(() => ({}));
      return criarDocumento(env, access, user, corpo);
    }
  }

  return json({ error: "Rota fiscal não encontrada." }, 404);
}
