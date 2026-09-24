// ===== Coleções da operação =====
//
// Operações (a fonte canônica que o Portal do Cliente também lê), rotas do dia
// e modelos de rota recorrente (formato em ./descritor.js). Escrita:
// `operations:manage`. A rota tem guarda de escrita: o gate de pré-flight do
// par motorista + veículo + paradas. Os EVENTOS da operação não passam por
// aqui — são do ledger (`../ledger-operacional.js`).

import { gateDePreflightDaRota } from "../../todogreen-preflight.js";
import { numero, objeto, parse, texto } from "../util.js";

export const COLECOES_DA_OPERACAO = {
  operations: {
    // Fonte canônica compartilhada com o Portal do Cliente. Antes o painel
    // escrevia em todogreen_operations e o cliente lia outra tabela.
    tabela: "todogreen_client_operations",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "evidence:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      clientId: row.client_id,
      produtoId: row.product_id,
      mesReferencia: row.service_date ? row.service_date.slice(0, 7) : "",
      referencia: row.reference,
      contratoId: row.contract_id || "",
      dataServico: row.service_date || "",
      origem: row.origin || "",
      destino: row.destination || "",
      prometidoEm: row.promised_at || "",
      entregueEm: row.delivered_at || "",
      etaEm: row.eta_at || "",
      placa: row.vehicle_plate || "",
      motorista: row.driver_name || "",
      motoristaId: row.driver_id || "",
      rotaId: row.route_id || "",
      ordemNaRota: row.route_stop_order,
      sla: row.sla_status || "",
      comprovanteUrl: row.proof_url || "",
      comprovanteHash: row.proof_hash || "",
      ultimaPosicaoEm: row.last_position_at || "",
      latitude: row.last_position_lat,
      longitude: row.last_position_lng,
      // Coordenadas de coleta e ENTREGA (fixas, o destino) — o que o despacho
      // precisa para roteirizar. Diferente de last_position (posição atual do
      // veículo, telemetria).
      coletaLat: row.pickup_lat,
      coletaLng: row.pickup_lng,
      entregaLat: row.delivery_lat,
      entregaLng: row.delivery_lng,
      entregas: numero(parse(row.fields_json, {}).deliveries),
      pacotes: numero(parse(row.fields_json, {}).packages),
      viagens: numero(parse(row.fields_json, {}).trips),
      distanciaKm: numero(row.distance_km || parse(row.fields_json, {}).distanceKm),
      ocupacaoPercent: numero(parse(row.fields_json, {}).occupancyPercent),
      ocorrencias: numero(row.incident_count),
      situacao: row.status,
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      client_id: texto(corpo.clientId, 120),
      product_id: texto(corpo.produtoId, 120),
      contract_id: texto(corpo.contratoId, 120),
      reference: texto(corpo.referencia || corpo.rota, 200),
      service_date: /^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dataServico, 10))
        ? texto(corpo.dataServico, 10)
        : /^\d{4}-\d{2}$/.test(texto(corpo.mesReferencia, 10))
          ? `${texto(corpo.mesReferencia, 10)}-01`
          : null,
      origin: texto(corpo.origem, 200),
      destination: texto(corpo.destino, 200),
      promised_at: texto(corpo.prometidoEm, 40) || null,
      delivered_at: texto(corpo.entregueEm, 40) || null,
      eta_at: texto(corpo.etaEm, 40) || null,
      vehicle_plate: texto(corpo.placa, 20).toUpperCase(),
      driver_name: texto(corpo.motorista, 160),
      // O motorista como dado: o id liga a operação ao cadastro (0070) e é o
      // recorte do portal do motorista. O nome continua como rótulo.
      driver_id: texto(corpo.motoristaId, 120),
      route_id: texto(corpo.rotaId, 120),
      route_stop_order: corpo.ordemNaRota === "" || corpo.ordemNaRota == null ? null : numero(corpo.ordemNaRota),
      distance_km: numero(corpo.distanciaKm),
      incident_count: numero(corpo.ocorrencias),
      sla_status: texto(corpo.sla, 40),
      proof_url: texto(corpo.comprovanteUrl, 2000),
      proof_hash: texto(corpo.comprovanteHash, 160),
      last_position_at: texto(corpo.ultimaPosicaoEm, 40) || null,
      last_position_lat: corpo.latitude === "" || corpo.latitude == null ? null : numero(corpo.latitude),
      last_position_lng: corpo.longitude === "" || corpo.longitude == null ? null : numero(corpo.longitude),
      // Coordenadas fixas de coleta/entrega — o que torna a operação
      // roteirizável no despacho. Vêm da geocodificação do endereço no salvar.
      // Em PATCH, o merge com daLinha(atual) preserva o que não for reenviado.
      pickup_lat: corpo.coletaLat === "" || corpo.coletaLat == null ? null : numero(corpo.coletaLat),
      pickup_lng: corpo.coletaLng === "" || corpo.coletaLng == null ? null : numero(corpo.coletaLng),
      delivery_lat: corpo.entregaLat === "" || corpo.entregaLat == null ? null : numero(corpo.entregaLat),
      delivery_lng: corpo.entregaLng === "" || corpo.entregaLng == null ? null : numero(corpo.entregaLng),
      status: texto(corpo.situacao, 40) || "active",
      fields_json: JSON.stringify({
        ...objeto(corpo.campos),
        deliveries: numero(corpo.entregas),
        packages: numero(corpo.pacotes),
        trips: numero(corpo.viagens),
        distanceKm: numero(corpo.distanciaKm),
        occupancyPercent: numero(corpo.ocupacaoPercent),
      }),
    }),
    exigido: (corpo) => (texto(corpo.clientId) ? "" : "Informe o cliente da operação."),
  },

  // #139: rota do dia planejada no roteirizador e atribuída a um motorista. O
  // cabeçalho vive em colunas próprias (motorista, veículo, data, resumo, status)
  // e as paradas ORDENADAS em stops_json — lidas/gravadas sempre com a rota. O
  // app do motorista lê pelo driver_id (mesmo recorte das viagens).
  rotas: {
    tabela: "todogreen_routes",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "fleet:manage", "audit:read"],
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      nome: row.name || "",
      motoristaId: row.driver_id || "",
      motorista: row.driver_name || "",
      placa: row.vehicle_plate || "",
      dataServico: row.service_date || "",
      status: row.status || "planejada",
      origem: row.origin || "",
      destino: row.destination || "",
      distanciaKm: numero(row.distance_km),
      duracaoMin: numero(row.duration_min),
      pedagioTotal: numero(row.toll_total),
      paradas: parse(row.stops_json, []),
      notas: row.notes || "",
      // Pré-flight que liberou a rota (0132): id + status (PASS ou WARNING
      // autorizado). Vazio = rota anterior ao gate ou criada pelo despacho.
      preflightId: row.preflight_id || "",
      preflightStatus: row.preflight_status || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.nome, 200),
      driver_id: texto(corpo.motoristaId, 120),
      driver_name: texto(corpo.motorista, 160),
      vehicle_plate: texto(corpo.placa, 20).toUpperCase(),
      service_date: /^\d{4}-\d{2}-\d{2}$/.test(texto(corpo.dataServico, 10)) ? texto(corpo.dataServico, 10) : null,
      status: texto(corpo.status, 40) || "planejada",
      origin: texto(corpo.origem, 300),
      destination: texto(corpo.destino, 300),
      distance_km: numero(corpo.distanciaKm),
      duration_min: numero(corpo.duracaoMin),
      toll_total: numero(corpo.pedagioTotal),
      stops_json: JSON.stringify(Array.isArray(corpo.paradas) ? corpo.paradas.slice(0, 200) : []),
      notes: texto(corpo.notas, 1000),
      // Só o que a guarda carimbou (verificado no banco) — nunca o que o
      // cliente mandou em `preflightStatus`.
      preflight_id: texto(corpo.preflightId, 120),
      preflight_status: texto(corpo.preflightStatusVerificado, 20),
    }),
    exigido: (corpo) => {
      if (!texto(corpo.motoristaId)) return "Escolha o motorista que vai receber a rota.";
      if (!Array.isArray(corpo.paradas) || corpo.paradas.length < 2)
        return "A rota precisa de pelo menos duas paradas (origem e destino).";
      return "";
    },
    // Gate de publicação (P2): atribuir/mudar o par motorista+veículo+paradas
    // exige pré-flight não-BLOCK do MESMO par, dentro do prazo; WARNING só com
    // justificativa (auditada). Editar nome/notas/status não reabre o gate.
    guardaDeEscrita: (env, { access, user, corpo, id }) => gateDePreflightDaRota(env, { access, user, corpo, id }),
  },

  // Modelo de rota recorrente: guarda o TEXTO das paradas (mesmo formato da
  // importação em massa), não rotas prontas. Reaplicar geocodifica e cria
  // operações novas para a data escolhida — que seguem o fluxo do despacho.
  importTemplates: {
    tabela: "todogreen_operation_import_templates",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "fleet:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => ({
      id: row.id,
      nome: row.name || "",
      clientId: row.client_id || "",
      paradasTexto: row.stops_text || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => ({
      name: texto(corpo.nome, 160),
      client_id: texto(corpo.clientId, 120),
      stops_text: texto(corpo.paradasTexto, 20000),
      fields_json: JSON.stringify(objeto(corpo.campos)),
    }),
    exigido: (corpo) => (texto(corpo.nome) ? "" : "Dê um nome ao modelo de rota."),
  },
};
