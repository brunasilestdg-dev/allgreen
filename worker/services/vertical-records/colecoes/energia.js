// ===== Coleções de energia e recarga =====
//
// Pontos de recarga, sessões, reservas de carregador e preço por kWh (formato
// em ./descritor.js). Cadastros da empresa (`escopoDeCarteira: false`). A
// validação vem dos domínios de recarga — a mesma régua da tela — e a reserva
// tem guarda de escrita contra conflito de horário no mesmo ponto.

import { TENANT_ID } from "../../todogreen-access.js";
import {
  normalizarPontoRecarga,
  servePesado as pontoServePesado,
  validarPontoRecarga,
} from "../../../../src/features/logistics/chargingPointsDomain.js";
import {
  energiaMedida,
  normalizarSessao,
  statusSessaoValido,
  fonteSessaoValida,
  validarSessao,
} from "../../../../src/features/logistics/chargingSessionDomain.js";
import {
  conflitoDeReserva,
  MENSAGEM_CONFLITO,
  normalizarReserva,
  statusReservaValido,
  validarReserva,
} from "../../../../src/features/logistics/chargerReservationDomain.js";
import {
  escopoValido as escopoPrecoValido,
  normalizarRegraPreco,
  segmentoValido as segmentoPrecoValido,
  validarRegraPreco,
} from "../../../../src/features/logistics/chargingBillingDomain.js";
import { numero, objeto, parse } from "../util.js";

export const COLECOES_DE_ENERGIA = {
  // Pontos de recarga próprios (Ground/GreenOn/pátio próprio). Cadastro da
  // EMPRESA — escopoDeCarteira:false — usado pelo roteirizador para desenhar a
  // infra real junto aos carregadores públicos. A validação e o "serve pesado"
  // vêm de chargingPointsDomain, a mesma régua da tela.
  pontosRecarga: {
    tabela: "todogreen_charging_points",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "tms:manage", "fleet:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "name ASC",
    daLinha: (row) => {
      const tipoCorrente = row.current_type || "AC";
      const potenciaKw = numero(row.power_kw);
      return {
        id: row.id,
        nome: row.name || "",
        operador: row.operator || "",
        tipoCorrente,
        conector: row.connector || "",
        potenciaKw,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        endereco: row.address || "",
        status: row.status || "ativo",
        // Derivado, nunca gravado: potência muda, verdade acompanha.
        servePesado: pontoServePesado({ tipoCorrente, potenciaKw }),
        campos: parse(row.fields_json, {}),
        revision: row.revision,
        criadoEm: row.created_at,
        atualizadoEm: row.updated_at,
      };
    },
    colunas: (corpo) => {
      const p = normalizarPontoRecarga(corpo);
      return {
        name: p.nome,
        operator: p.operador,
        current_type: p.tipoCorrente,
        connector: p.conector,
        power_kw: p.potenciaKw,
        latitude: p.latitude,
        longitude: p.longitude,
        address: p.endereco,
        status: p.status,
        fields_json: JSON.stringify(objeto(corpo.campos)),
      };
    },
    exigido: (corpo) => validarPontoRecarga(corpo),
  },

  // Sessão de recarga: a recarga que de fato aconteceu (energia MEDIDA, não
  // estimada). Cadastro da empresa (escopoDeCarteira:false). O custo é derivado
  // na leitura (chargingSessionDomain), nunca coluna. Escrita por operações; a
  // Gestão de Energia e a Cobrança leem daqui.
  chargingSessions: {
    tabela: "todogreen_charging_sessions",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "fleet:manage", "finance:manage", "revenue:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "started_at DESC",
    daLinha: (row) => ({
      id: row.id,
      pontoId: row.charging_point_id || "",
      pontoNome: row.charging_point_name || "",
      veiculoId: row.vehicle_id || "",
      veiculoRotulo: row.vehicle_label || "",
      motoristaId: row.driver_id || "",
      motoristaNome: row.driver_name || "",
      clienteId: row.client_id || "",
      clienteNome: row.client_name || "",
      segmento: parse(row.fields_json, {}).segmento || "",
      inicioEm: row.started_at || "",
      fimEm: row.ended_at || "",
      // Derivado, nunca gravado: a leitura recalcula o kWh medido a partir do
      // medidor quando o campo direto não veio.
      energiaKwh: energiaMedida({ energiaKwh: row.energy_kwh, medidorInicial: row.meter_start, medidorFinal: row.meter_end }),
      medidorInicial: numero(row.meter_start),
      medidorFinal: numero(row.meter_end),
      status: statusSessaoValido(row.status),
      fonte: fonteSessaoValida(row.source),
      observacao: row.note || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const s = normalizarSessao(corpo);
      return {
        charging_point_id: s.pontoId,
        charging_point_name: s.pontoNome,
        vehicle_id: s.veiculoId,
        vehicle_label: s.veiculoRotulo,
        driver_id: s.motoristaId,
        driver_name: s.motoristaNome,
        client_id: s.clienteId,
        client_name: s.clienteNome,
        started_at: s.inicioEm,
        ended_at: s.fimEm,
        energy_kwh: s.energiaKwh,
        meter_start: s.medidorInicial,
        meter_end: s.medidorFinal,
        status: s.status,
        source: s.fonte,
        note: s.observacao,
        fields_json: JSON.stringify({ ...objeto(corpo.campos), segmento: s.segmento }),
      };
    },
    exigido: (corpo) => validarSessao(corpo),
  },

  // Reserva de carregador: janela [início, fim) de um ponto. A guarda de escrita
  // barra no servidor duas reservas ativas cruzando o mesmo ponto — a mesma
  // regra da tela (chargerReservationDomain), aqui é a autoridade.
  chargerReservations: {
    tabela: "todogreen_charger_reservations",
    permissao: "operations:manage",
    permissoesLeitura: ["operations:manage", "planning:manage", "fleet:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "start_at DESC",
    daLinha: (row) => ({
      id: row.id,
      pontoId: row.charging_point_id || "",
      pontoNome: row.charging_point_name || "",
      veiculoId: row.vehicle_id || "",
      veiculoRotulo: row.vehicle_label || "",
      motoristaId: row.driver_id || "",
      motoristaNome: row.driver_name || "",
      inicioEm: row.start_at || "",
      fimEm: row.end_at || "",
      status: statusReservaValido(row.status),
      observacao: row.note || "",
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const r = normalizarReserva(corpo);
      return {
        charging_point_id: r.pontoId,
        charging_point_name: r.pontoNome,
        vehicle_id: r.veiculoId,
        vehicle_label: r.veiculoRotulo,
        driver_id: r.motoristaId,
        driver_name: r.motoristaNome,
        start_at: r.inicioEm,
        end_at: r.fimEm,
        status: r.status,
        note: r.observacao,
        fields_json: JSON.stringify(objeto(corpo.campos)),
      };
    },
    exigido: (corpo) => validarReserva(corpo),
    // Conflito de horário no mesmo ponto: barrado no servidor, não só na tela.
    // Só reserva ATIVA bloqueia — cancelada/concluída liberou a tomada.
    guardaDeEscrita: async (env, { access, corpo, id }) => {
      const nova = normalizarReserva(corpo);
      // Reserva já cancelada/concluída que está sendo salva não precisa checar:
      // ela não vai ocupar o ponto.
      if (!["reservada", "em_uso"].includes(nova.status)) return "";
      if (!nova.pontoId) return "";
      const { results } = await env.DB.prepare(
        `SELECT id, charging_point_id, charging_point_name, start_at, end_at, status
           FROM todogreen_charger_reservations
          WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL
            AND charging_point_id = ? AND status IN ('reservada','em_uso')`,
      ).bind(TENANT_ID, access.ownerId, nova.pontoId).all();
      const existentes = (results || []).map((row) => ({
        id: row.id,
        pontoId: row.charging_point_id || "",
        pontoNome: row.charging_point_name || "",
        inicioEm: row.start_at || "",
        fimEm: row.end_at || "",
        status: row.status || "reservada",
      }));
      return conflitoDeReserva(existentes, { ...nova, id }) ? MENSAGEM_CONFLITO : "";
    },
  },

  // Preço por kWh da recarga (tabela B2B/B2C). Cadastro da empresa; a validação
  // e o escopo (base/segmento/cliente) vêm de chargingBillingDomain.
  chargingPrices: {
    tabela: "todogreen_charging_price_rules",
    permissao: "finance:manage",
    permissoesLeitura: ["finance:manage", "revenue:manage", "operations:manage", "audit:read"],
    escopoDeCarteira: false,
    ordem: "scope ASC, updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      escopo: escopoPrecoValido(row.scope),
      segmento: segmentoPrecoValido(row.segment),
      clienteId: row.client_id || "",
      clienteNome: row.client_name || "",
      precoPorKwh: numero(row.price_per_kwh),
      observacao: row.note || "",
      // Sem `campos` aqui, um PATCH que não os reenviasse gravava
      // `fields_json` vazio por cima do que havia (o PATCH regrava a partir
      // do que esta função devolve).
      campos: parse(row.fields_json, {}),
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo) => {
      const r = normalizarRegraPreco(corpo);
      return {
        scope: r.escopo,
        segment: r.segmento,
        client_id: r.clienteId,
        client_name: r.clienteNome,
        price_per_kwh: r.precoPorKwh,
        note: r.observacao,
        fields_json: JSON.stringify(objeto(corpo.campos)),
      };
    },
    exigido: (corpo) => validarRegraPreco(corpo),
  },
};
