// ===== Portal do Motorista =====
//
// O que existia com esse nome era a tela interna de gestão de frota mostrando
// TODAS as operações do espaço para quem entrasse. Este handler é o portal de
// verdade: resolve QUEM dirige pelo e-mail da sessão (todogreen_drivers.
// user_email, 0070), entrega só AS VIAGENS DELE (driver_id na operação) e
// registra da rua o que fecha o ciclo — chegada, entrega com recebedor/foto/
// GPS (vira o POD do faturamento) e ocorrência.
//
// O papel `motorista` deliberadamente NÃO tem "read": este é o único canto da
// vertical que ele alcança.

import { TENANT_ID, podeNaVertical } from "./todogreen-access.js";
import { aplicarEventoOperacional } from "./todogreen-vertical-records.js";
import { marcarParadaConcluida, statusPelaConclusao } from "../../src/features/logistics/routePlanDomain.js";
import { avaliarChecklist, ITENS_CHECKLIST } from "../../src/features/logistics/driverChecklistDomain.js";
import { avaliarConformidadeJornada, duracaoMinutos, resumoDaJornada } from "../../src/features/logistics/driverJourneyDomain.js";
import { calcularScoreMotorista, compararScoreMotorista } from "../../src/features/logistics/driverScoreDomain.js";
import { validarChavePix } from "../../src/features/logistics/pixDomain.js";
import { carteiraDoMotorista, gerarGanhosDaEntrega } from "./todogreen-greenpay.js";
import { resumoTelemetriaVeiculo } from "../../src/features/logistics/driverVehicleDomain.js";

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

const diasAte = (dataYmd) => {
  if (!dataYmd) return null;
  const alvo = new Date(`${String(dataYmd).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(alvo.getTime())) return null;
  return Math.floor((alvo - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
};

// O motorista da sessão. owner/admin também passam (para testar o portal),
// mas sem vínculo de motorista não há viagem para mostrar.
const motoristaDaSessao = async (env, access, user) => {
  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return null;
  return env.DB.prepare(
    `SELECT * FROM todogreen_drivers
      WHERE tenant_id = ? AND workspace_owner_id = ? AND lower(user_email) = ?
        AND archived_at IS NULL
      LIMIT 1`,
  ).bind(TENANT_ID, access.ownerId, email).first();
};

const viagemDaLinha = (row) => ({
  id: row.id,
  referencia: row.reference,
  situacao: row.status,
  dataServico: row.service_date || "",
  origem: row.origin || "",
  destino: row.destination || "",
  prometidoEm: row.promised_at || "",
  entregueEm: row.delivered_at || "",
  placa: row.vehicle_plate || "",
  distanciaKm: Number(row.distance_km || 0),
  rotaId: row.route_id || "",
  ordemNaRota: row.route_stop_order,
  comprovanteRegistrado: Boolean(row.proof_url),
  ocorrencias: Number(row.incident_count || 0),
});

const parseJson = (valor, padrao) => {
  try { return JSON.parse(valor || ""); } catch { return padrao; }
};

const turnoDaLinha = (row) => ({
  id: row.id,
  dataServico: row.service_date || "",
  iniciadoEm: row.started_at || "",
  encerradoEm: row.ended_at || "",
  duracaoMin: Number(row.duration_min || 0),
  status: row.status || "aberto",
  posicaoInicio: row.start_position || "",
  posicaoFim: row.end_position || "",
});

const checklistDaLinha = (row) => ({
  id: row.id,
  placa: row.vehicle_plate || "",
  rotaId: row.route_id || "",
  dataServico: row.service_date || "",
  status: row.status || "aprovado",
  criticosReprovados: Number(row.critical_failed || 0),
  observacao: row.observation || "",
  respostas: parseJson(row.answers_json, {}),
  criadoEm: row.created_at || "",
});

const rotaDaLinha = (row) => {
  let paradas = [];
  try {
    const bruto = JSON.parse(row.stops_json || "[]");
    if (Array.isArray(bruto)) paradas = bruto;
  } catch { /* rota sem paradas legíveis vira lista vazia, não quebra o app */ }
  return {
    id: row.id,
    nome: row.name || "",
    status: row.status || "planejada",
    dataServico: row.service_date || "",
    placa: row.vehicle_plate || "",
    origem: row.origin || "",
    destino: row.destination || "",
    distanciaKm: Number(row.distance_km || 0),
    duracaoMin: Number(row.duration_min || 0),
    paradas,
    revision: Number(row.revision || 1),
  };
};

export async function handleTodoGreenDriverPortal(request, env, access, user) {
  if (!env.DB) return json({ error: "Banco indisponível." }, 503);
  // owner/admin passam pela regra geral; qualquer outro papel precisa de
  // driver:self — que só o papel `motorista` carrega.
  if (!podeNaVertical(access, "driver:self"))
    return json({ error: "Este portal é do motorista. Peça ao gestor o papel 'motorista'." }, 403);

  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, driver-portal, [recurso], [id], [acao]
  const recurso = texto(partes[3], 40);
  const id = texto(partes[4], 120);
  const acao = texto(partes[5], 40);

  const motorista = await motoristaDaSessao(env, access, user);

  if (request.method === "GET" && (recurso === "" || recurso === "sessao")) {
    if (!motorista)
      return json({
        vinculado: false,
        aviso: "Seu e-mail ainda não está ligado a um cadastro de motorista. Peça ao gestor para preencher o e-mail de acesso no cadastro (Cadastros → Motoristas).",
      });
    const diasCnh = diasAte(motorista.cnh_expires_at);
    return json({
      vinculado: true,
      motorista: {
        id: motorista.id,
        nome: motorista.full_name,
        cnhCategoria: motorista.cnh_category || "",
        cnhValidade: motorista.cnh_expires_at || "",
        // O aviso vai na sessão porque é o motorista quem precisa agir — e a
        // CNH vencida é o motivo nº 1 de veículo parado em fiscalização.
        cnhAlerta: diasCnh === null ? "" : diasCnh < 0
          ? "Sua CNH está VENCIDA. Regularize antes de dirigir."
          : diasCnh <= 30
            ? `Sua CNH vence em ${diasCnh} dia(s). Agende a renovação.`
            : "",
        // Imagem da CNH que o motorista subiu (fica disponível à operação).
        cnhImagemUrl: motorista.cnh_image_url || "",
        disponibilidade: motorista.availability_status || "",
        // Chave PIX do repasse: o motorista informa e vê a própria aqui; a
        // operação vê/corrige no cadastro do ERP.
        pixChave: motorista.pix_key || "",
        pixTipo: motorista.pix_key_type || "",
        pixAtualizadaEm: motorista.pix_self_updated_at || "",
      },
    });
  }

  // O motorista informa a PRÓPRIA chave PIX (destino do repasse GreenPay). Só a
  // dele — o recorte é o vínculo. A chave é validada pelo tipo antes de gravar;
  // chave malformada não entra (dinheiro não vai para destino inválido).
  if (request.method === "POST" && recurso === "pix") {
    if (!motorista) return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const tipo = texto(corpo.tipo, 20);
    const validacao = validarChavePix(tipo, corpo.chave);
    if (!validacao.valido) return json({ error: validacao.erro }, 400);
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_drivers
        SET pix_key = ?, pix_key_type = ?, pix_self_updated_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(validacao.chave, tipo, agora, agora, motorista.id, TENANT_ID, access.ownerId).run();
    return json({ ok: true, pixChave: validacao.chave, pixTipo: tipo, pixAtualizadaEm: agora });
  }

  // O motorista sobe a foto da CNH e confirma a validade pelo próprio app; a
  // operação passa a ver a imagem e a data (mesmo campo cnh_expires_at do
  // cadastro). Só a própria CNH — o recorte é o vínculo do motorista.
  if (request.method === "POST" && recurso === "cnh") {
    if (!motorista) return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);
    const corpo = await request.json().catch(() => ({}));
    const dataUrl = texto(corpo.imagemBase64, 12_000_000);
    const validade = texto(corpo.validade, 10);
    if (!dataUrl && !validade)
      return json({ error: "Envie a foto da CNH ou informe a validade." }, 400);
    let url = motorista.cnh_image_url || "";
    if (dataUrl) {
      try {
        const { armazenarImagemBase64 } = await import("./todogreen-file-store.js");
        const guardado = await armazenarImagemBase64(env, {
          ownerId: access.ownerId,
          contextType: "driver_cnh",
          contextId: motorista.id,
          dataUrl,
          createdBy: user.id,
          prefixoNome: "cnh",
        });
        url = guardado.url;
      } catch (erro) {
        return json({ error: String(erro?.message || "Não consegui guardar a foto da CNH.") }, 400);
      }
    }
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_drivers
        SET cnh_image_url = ?, cnh_expires_at = COALESCE(NULLIF(?, ''), cnh_expires_at),
            cnh_self_updated_at = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(url, validade, agora, agora, motorista.id, TENANT_ID, access.ownerId).run();
    return json({ ok: true, cnhImagemUrl: url });
  }

  if (!motorista)
    return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);

  // ===== Checklist de pré-viagem (bloco 03) =====
  // As vistorias recentes deste motorista + o catálogo de itens (a tela monta o
  // formulário a partir dele, sem duplicar a lista).
  if (request.method === "GET" && recurso === "checklist") {
    const { results } = await env.DB.prepare(
      `SELECT id, vehicle_plate, route_id, service_date, answers_json, status, critical_failed, observation, created_at
         FROM todogreen_driver_checklists
        WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
        ORDER BY service_date DESC, created_at DESC LIMIT 30`,
    ).bind(TENANT_ID, access.ownerId, motorista.id).all();
    return json({ checklists: (results || []).map(checklistDaLinha), itens: ITENS_CHECKLIST });
  }

  // Registrar a vistoria. O servidor RE-AVALIA (nunca confia no status do
  // cliente): recomputa aprovado/ressalva/reprovado das respostas e exige a
  // vistoria completa. Fica o registro imutável do que valia ao sair.
  if (request.method === "POST" && recurso === "checklist") {
    const corpo = await request.json().catch(() => ({}));
    const respostas = corpo.respostas && typeof corpo.respostas === "object" ? corpo.respostas : {};
    const veredito = avaliarChecklist(respostas);
    if (!veredito.completo)
      return json({ error: "Responda todos os itens da vistoria antes de registrar.", veredito }, 400);
    // Guarda só as respostas de itens conhecidos (limpa qualquer lixo do corpo).
    const limpo = {};
    for (const item of ITENS_CHECKLIST) if (respostas[item.id]) limpo[item.id] = String(respostas[item.id]);

    const idNovo = crypto.randomUUID();
    const agora = new Date().toISOString();
    const dataServico = texto(corpo.dataServico, 10) || agora.slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO todogreen_driver_checklists
         (id, tenant_id, workspace_owner_id, driver_id, vehicle_id, vehicle_plate, route_id, service_date,
          answers_json, status, critical_failed, observation, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      idNovo, TENANT_ID, access.ownerId, motorista.id, texto(corpo.veiculoId, 120), texto(corpo.veiculoPlaca, 20).toUpperCase(),
      texto(corpo.rotaId, 120), dataServico, JSON.stringify(limpo), veredito.status, veredito.criticosReprovados.length,
      texto(corpo.observacao, 1000), user.id, agora, agora,
    ).run();
    const row = await env.DB.prepare(
      `SELECT id, vehicle_plate, route_id, service_date, answers_json, status, critical_failed, observation, created_at
         FROM todogreen_driver_checklists WHERE id = ?`,
    ).bind(idNovo).first();
    return json({ checklist: checklistDaLinha(row), veredito }, 201);
  }

  // ===== Jornada de trabalho (bloco 03) =====
  // Os turnos deste motorista + o retrato (em turno, horas de hoje). O `agora`
  // vai ao domínio para a duração do turno aberto ser determinística.
  if (recurso === "jornada") {
    const carregarTurnos = async () => {
      const { results } = await env.DB.prepare(
        `SELECT id, service_date, started_at, ended_at, duration_min, status, start_position, end_position
           FROM todogreen_driver_shifts
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
          ORDER BY started_at DESC LIMIT 30`,
      ).bind(TENANT_ID, access.ownerId, motorista.id).all();
      return (results || []).map(turnoDaLinha);
    };

    if (request.method === "GET") {
      const turnos = await carregarTurnos();
      return json({ turnos, resumo: resumoDaJornada(turnos, new Date().toISOString()) });
    }

    // Iniciar turno. Recusa (409) se já houver um aberto — a base também trava,
    // mas a mensagem clara é melhor que um erro de índice único.
    if (request.method === "POST" && id === "inicio") {
      const corpo = await request.json().catch(() => ({}));
      const aberto = await env.DB.prepare(
        `SELECT id FROM todogreen_driver_shifts
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND ended_at IS NULL AND archived_at IS NULL`,
      ).bind(TENANT_ID, access.ownerId, motorista.id).first();
      if (aberto) return json({ error: "Você já tem um turno aberto. Encerre antes de iniciar outro." }, 409);

      // A jornada operacional só começa depois de uma vistoria aprovada no
      // dia. Registrar checklist reprovado sem consequência seria apenas
      // guardar um formulário, não proteger motorista, veículo e carga.
      const hoje = new Date().toISOString().slice(0, 10);
      const vistoria = await env.DB.prepare(
        `SELECT id FROM todogreen_driver_checklists
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
            AND service_date = ? AND status = 'aprovado' AND archived_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
      ).bind(TENANT_ID, access.ownerId, motorista.id, hoje).first();
      if (!vistoria)
        return json({ error: "Faça e aprove a vistoria de pré-viagem de hoje antes de iniciar a jornada." }, 409);

      const idNovo = crypto.randomUUID();
      const agora = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO todogreen_driver_shifts
           (id, tenant_id, workspace_owner_id, driver_id, service_date, started_at, status, start_position, start_odometer_km, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'aberto', ?, ?, ?, ?, ?)`,
      ).bind(idNovo, TENANT_ID, access.ownerId, motorista.id, agora.slice(0, 10), agora, texto(corpo.local, 120),
        Number.isFinite(Number(corpo.odometroKm)) ? Number(corpo.odometroKm) : null, user.id, agora, agora).run();
      const turnos = await carregarTurnos();
      return json({ turnos, resumo: resumoDaJornada(turnos, agora) }, 201);
    }

    // Encerrar turno. Sem um aberto, 400 — não se encerra o que não começou.
    if (request.method === "POST" && id === "fim") {
      const corpo = await request.json().catch(() => ({}));
      const aberto = await env.DB.prepare(
        `SELECT * FROM todogreen_driver_shifts
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND ended_at IS NULL AND archived_at IS NULL`,
      ).bind(TENANT_ID, access.ownerId, motorista.id).first();
      if (!aberto) return json({ error: "Você não tem turno aberto para encerrar." }, 400);

      const agora = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE todogreen_driver_shifts
            SET ended_at = ?, duration_min = ?, status = 'fechado', end_position = ?, end_odometer_km = ?,
                revision = revision + 1, updated_at = ?
          WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
      ).bind(agora, duracaoMinutos(aberto.started_at, agora), texto(corpo.local, 120),
        Number.isFinite(Number(corpo.odometroKm)) ? Number(corpo.odometroKm) : null, agora, aberto.id, TENANT_ID, access.ownerId).run();
      const turnos = await carregarTurnos();
      return json({ turnos, resumo: resumoDaJornada(turnos, agora) });
    }

    return json({ error: "Ação de jornada não encontrada." }, 404);
  }

  if (request.method === "GET" && recurso === "viagens") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
        ORDER BY (delivered_at IS NULL) DESC, service_date DESC, updated_at DESC
        LIMIT 50`,
    ).bind(TENANT_ID, access.ownerId, motorista.id).all();
    return json({ viagens: (results || []).map(viagemDaLinha) });
  }

  // Minha nota × a régua do time. Computa a nota de CADA motorista do espaço com
  // o MESMO domínio (não há duas contas de "quem está melhor") e devolve a minha
  // mais a comparação — anônima: só o percentil e a mediana, nunca o nome ou a
  // nota de outro motorista.
  if (request.method === "GET" && recurso === "score") {
    if (!motorista) return json({ error: "Seu e-mail não está ligado a um cadastro de motorista." }, 403);
    const agora = new Date().toISOString();

    // Três leituras do espaço, agrupadas por motorista em memória — sem uma
    // consulta por motorista.
    const [ops, turnos, vistorias] = await Promise.all([
      env.DB.prepare(
        `SELECT id, driver_id, reference, status, service_date, promised_at, delivered_at,
                vehicle_plate, distance_km, route_id, proof_url, incident_count
           FROM todogreen_client_operations
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id IS NOT NULL
            AND driver_id != '' AND archived_at IS NULL
          ORDER BY service_date DESC, updated_at DESC, id
          LIMIT 5000`,
      ).bind(TENANT_ID, access.ownerId).all(),
      env.DB.prepare(
        `SELECT id, driver_id, service_date, started_at, ended_at, duration_min, status
           FROM todogreen_driver_shifts
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id IS NOT NULL
            AND driver_id != '' AND archived_at IS NULL
          ORDER BY service_date DESC, started_at DESC, id
          LIMIT 5000`,
      ).bind(TENANT_ID, access.ownerId).all(),
      env.DB.prepare(
        `SELECT driver_id, answers_json, created_at
           FROM todogreen_driver_checklists
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id IS NOT NULL
            AND driver_id != '' AND archived_at IS NULL
          ORDER BY created_at DESC
          LIMIT 5000`,
      ).bind(TENANT_ID, access.ownerId).all(),
    ]);

    const porMotorista = new Map();
    const balde = (did) => {
      if (!porMotorista.has(did)) porMotorista.set(did, { viagens: [], turnos: [], vistoria: null });
      return porMotorista.get(did);
    };
    for (const r of ops.results || []) balde(r.driver_id).viagens.push(viagemDaLinha(r));
    for (const r of turnos.results || []) balde(r.driver_id).turnos.push(turnoDaLinha(r));
    // A vistoria mais recente por motorista (a lista já vem por created_at DESC).
    for (const r of vistorias.results || []) {
      const b = balde(r.driver_id);
      if (b.vistoria == null) b.vistoria = avaliarChecklist(parseJson(r.answers_json, {}));
    }

    const scoreDe = (dados) =>
      calcularScoreMotorista(dados.viagens, {
        temJornada: dados.turnos.length > 0,
        conformidade: avaliarConformidadeJornada(dados.turnos, agora),
        vistoria: dados.vistoria,
      });

    const meuScore = scoreDe(porMotorista.get(motorista.id) || { viagens: [], turnos: [], vistoria: null });

    // As notas dos DEMAIS motoristas com score disponível — sem id, sem nome.
    const outrasNotas = [];
    for (const [did, dados] of porMotorista) {
      if (did === motorista.id) continue;
      const s = scoreDe(dados);
      if (s.disponivel) outrasNotas.push(s.nota);
    }

    return json({
      score: meuScore,
      comparacao: meuScore.disponivel
        ? compararScoreMotorista(meuScore.nota, outrasNotas)
        : { posicao: null, total: outrasNotas.length, mediana: null, melhores: null, texto: "Feche sua primeira entrega para entrar na régua do time." },
    });
  }

  // Carteira GreenPay do próprio motorista: ganhos do dia/semana/mês, saldos
  // (pendente/aprovado/pago) e extrato com a memória de cada valor. Derivado
  // das viagens entregues — o motorista não digita nada. Sem régua, a tela diz
  // "não configurada" em vez de mostrar zero.
  if (request.method === "GET" && recurso === "ganhos") {
    return json(await carteiraDoMotorista(env, access.ownerId, motorista.id));
  }

  // Telemetria elétrica ao vivo do veículo do motorista hoje. A placa vem da
  // vistoria do dia ou da viagem mais recente; a leitura, da frota (0107). Se
  // não há leitura, devolve honesto (temLeitura=false) — a tela mostra "sem
  // leitura", nunca 0%.
  if (request.method === "GET" && recurso === "veiculo") {
    const hoje = new Date().toISOString().slice(0, 10);
    const placaRow = await env.DB.prepare(
      `SELECT placa, ts FROM (
         SELECT vehicle_plate AS placa, created_at AS ts
           FROM todogreen_driver_checklists
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND service_date = ?
            AND vehicle_plate != '' AND archived_at IS NULL
         UNION ALL
         SELECT vehicle_plate AS placa, updated_at AS ts
           FROM todogreen_client_operations
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND service_date = ?
            AND vehicle_plate != '' AND archived_at IS NULL
       ) ORDER BY ts DESC LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, motorista.id, hoje, TENANT_ID, access.ownerId, motorista.id, hoje).first();

    if (!placaRow?.placa) return json({ temVeiculo: false });

    const v = await env.DB.prepare(
      `SELECT plate, prefix, last_soc_percent, last_range_km, last_telemetry_at, last_telemetry_source
         FROM todogreen_fleet_vehicles
        WHERE tenant_id = ? AND workspace_owner_id = ? AND plate = ? AND archived_at IS NULL
        LIMIT 1`,
    ).bind(TENANT_ID, access.ownerId, placaRow.placa).first();

    if (!v) return json({ temVeiculo: true, placa: placaRow.placa, temLeitura: false, frescor: "sem-leitura" });

    return json(resumoTelemetriaVeiculo({
      placa: v.plate,
      prefixo: v.prefix || "",
      socPercent: v.last_soc_percent,
      autonomiaKm: v.last_range_km,
      lidoEm: v.last_telemetry_at || "",
      fonte: v.last_telemetry_source || "",
    }, new Date().toISOString()));
  }

  if (request.method === "POST" && recurso === "viagens" && id && acao === "evento") {
    const corpo = await request.json().catch(() => ({}));
    // O recorte é o vínculo: a operação precisa ser DESTE motorista. Operação
    // de outro responde 404, não 403 — não se conta o que existe.
    const operacao = await env.DB.prepare(
      `SELECT * FROM todogreen_client_operations
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
          AND archived_at IS NULL`,
    ).bind(id, TENANT_ID, access.ownerId, motorista.id).first();
    if (!operacao) return json({ error: "Viagem não encontrada." }, 404);

    // Em operação roteirizada, coleta/chegada/entrega só existem dentro de
    // uma jornada aberta e após vistoria aprovada para a rota ou veículo. A
    // rota é a fronteira em que o TMS assume a execução; operações legadas sem
    // rota continuam acessíveis durante a consolidação.
    if (operacao.route_id) {
      const turno = await env.DB.prepare(
        `SELECT id FROM todogreen_driver_shifts
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
            AND ended_at IS NULL AND archived_at IS NULL LIMIT 1`,
      ).bind(TENANT_ID, access.ownerId, motorista.id).first();
      if (!turno)
        return json({ error: "Inicie sua jornada antes de executar a rota." }, 409);
      const vistoria = await env.DB.prepare(
        `SELECT id FROM todogreen_driver_checklists
          WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ?
            AND status = 'aprovado' AND archived_at IS NULL
            AND (route_id = ? OR (route_id = '' AND vehicle_plate = ? AND service_date = ?))
          ORDER BY created_at DESC LIMIT 1`,
      ).bind(
        TENANT_ID, access.ownerId, motorista.id, operacao.route_id,
        texto(operacao.vehicle_plate, 20), texto(operacao.service_date, 10),
      ).first();
      if (!vistoria)
        return json({ error: "Esta rota exige uma vistoria aprovada do veículo antes da execução." }, 409);
    }

    const tiposDaRua = new Set(["coleta", "transito", "chegada", "entrega", "ocorrencia"]);
    if (!tiposDaRua.has(texto(corpo.tipo, 40)))
      return json({ error: "Da rua se registra coleta, trânsito, chegada, entrega ou ocorrência." }, 400);

    const resultado = await aplicarEventoOperacional(env, {
      ownerId: access.ownerId,
      operacao,
      userId: user.id,
      corpo: {
        ...corpo,
        titulo: texto(corpo.titulo, 200) || {
          coleta: "Coleta realizada",
          transito: "Carga em trânsito",
          chegada: "Chegada ao destino",
          entrega: "Entrega concluída",
          ocorrencia: "Ocorrência na rota",
        }[texto(corpo.tipo, 40)],
        local: texto(corpo.local, 300),
      },
      origem: url.origin,
    });
    if (resultado.erro) return json({ error: resultado.erro }, 400);
    // Entrega concluída gera o ganho do motorista (GreenPay), derivado da
    // viagem pela régua vigente. Idempotente por (operação, tipo): a fila
    // offline reenviando não dobra o ganho. Sem régua configurada, não gera
    // nada — não inventa número. Nunca deixa o registro da entrega falhar por
    // causa do GreenPay.
    if (texto(corpo.tipo, 40) === "entrega") {
      try {
        await gerarGanhosDaEntrega(env, access.ownerId, resultado.atualizada, user.id);
      } catch (erro) {
        console.error("To Do Green GreenPay earning generation error", erro);
      }
    }
    // Reenvio da fila offline com a mesma chave: devolve o que já ficou (200),
    // não um segundo "criado" (201). Ou seja: a entrega não se perde e não dobra.
    return json(
      { evento: resultado.evento, viagem: viagemDaLinha(resultado.atualizada), duplicada: resultado.duplicada || false },
      resultado.duplicada ? 200 : 201,
    );
  }

  // As rotas do dia atribuídas a este motorista (#139). Mesmo recorte das
  // viagens: só as do próprio driver_id. Planejadas e em rota primeiro; as
  // concluídas descem.
  if (request.method === "GET" && recurso === "rotas") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_routes
        WHERE tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL
        ORDER BY (status = 'concluida') ASC, service_date DESC, updated_at DESC
        LIMIT 50`,
    ).bind(TENANT_ID, access.ownerId, motorista.id).all();
    return json({ rotas: (results || []).map(rotaDaLinha) });
  }

  // O motorista marca/desmarca UMA parada como concluída pelo índice. O status
  // da rota é recalculado do que foi feito (planejada → em rota → concluída),
  // nunca por um botão solto. Rota de outro motorista responde 404, não 403.
  if (request.method === "POST" && recurso === "rotas" && id && acao === "parada") {
    const corpo = await request.json().catch(() => ({}));
    const indice = Number(corpo.indice);
    if (!Number.isInteger(indice) || indice < 0)
      return json({ error: "Informe qual parada foi concluída." }, 400);
    const rota = await env.DB.prepare(
      `SELECT * FROM todogreen_routes
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND driver_id = ? AND archived_at IS NULL`,
    ).bind(id, TENANT_ID, access.ownerId, motorista.id).first();
    if (!rota) return json({ error: "Rota não encontrada." }, 404);
    let paradas = [];
    try {
      const bruto = JSON.parse(rota.stops_json || "[]");
      if (Array.isArray(bruto)) paradas = bruto;
    } catch { /* segue com lista vazia */ }
    if (indice >= paradas.length) return json({ error: "Parada não existe nesta rota." }, 400);
    // Parada do despacho inteligente é projeção da operação. Marcá-la por este
    // endpoint criaria uma segunda verdade e poderia concluir entrega sem POD.
    // A tela abre o gesto correspondente na viagem; esta guarda protege também
    // clientes antigos ou chamadas diretas à API.
    if (texto(paradas[indice]?.operationId, 120))
      return json({ error: "Registre a coleta ou a entrega pela viagem. A rota avança automaticamente." }, 409);
    const atualizadas = marcarParadaConcluida(paradas, indice, corpo.concluida !== false);
    const status = statusPelaConclusao(atualizadas);
    const agora = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE todogreen_routes
        SET stops_json = ?, status = ?, revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(JSON.stringify(atualizadas), status, user.id, agora, id, TENANT_ID, access.ownerId).run();
    const nova = await env.DB.prepare(
      `SELECT * FROM todogreen_routes WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
    ).bind(id, TENANT_ID, access.ownerId).first();
    return json({ rota: rotaDaLinha(nova) });
  }

  return json({ error: "Rota do portal do motorista não encontrada." }, 404);
}
