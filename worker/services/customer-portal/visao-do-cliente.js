// ===== Portal do Cliente: o que sai para o cliente =====
//
// Contrato: a projeção de uma operação para o portal. `operacaoDoBanco(linha)`
// traduz a linha de todogreen_client_operations nas chaves que o domínio
// entende e só nelas: o nome do motorista fica de fora (dado pessoal de quem
// dirige), comprovante e assinatura viram só o SINAL de que existem
// (`temComprovante`/`temAssinatura` — a URL de origem nunca sai), e `campos`
// passa por `camposParaCliente`, que só deixa chaves de
// `CAMPOS_LIBERADOS_AO_CLIENTE` com valor escalar. `MAX_LIMIT` é o teto de
// linhas das listas do portal. Autorização: nenhuma aqui — quem chama já
// leu a linha com o escopo da sessão (`scopedWhere`). Travado por
// src/features/logistics/customerPortalViewContract.test.js e
// test/todogreen-portal-contrato.worker.test.js.

import { parse } from "../todogreen-client-helpers.js";

export const MAX_LIMIT = 100;

// Campos livres que PODEM sair para o cliente. O fields_json é escrito pela
// equipe interna sem validação de chave: se um operador digitar "margem",
// "custoPorKm" ou um CPF num campo livre, isso NÃO pode vazar no portal. O
// assistente já filtra por lista (CAMPOS_PROIBIDOS); o payload cru não
// filtrava nada — este allowlist fecha o buraco. Só entra o que é operacional
// e do interesse legítimo do embarcador.
export const CAMPOS_LIBERADOS_AO_CLIENTE = new Set([
  "deliveries", "entregas", "packages", "pacotes", "trips", "viagens",
  "distanceKm", "occupancyPercent", "dataQuality", "energyKwh",
  "weightKg", "tons", "pallets", "successRate",
  // Prova de entrega: quem recebeu e em que condição. Nome e tipo do recebedor
  // são o que o embarcador legitimamente acompanha; o documento pessoal do
  // recebedor nunca entra em `fields_json`, então não há o que vazar aqui.
  "receiverName", "receiverKind",
]);
export const camposParaCliente = (bruto) =>
  Object.fromEntries(
    Object.entries(bruto && typeof bruto === "object" ? bruto : {})
      .filter(([chave, valor]) => CAMPOS_LIBERADOS_AO_CLIENTE.has(chave) && typeof valor !== "object"),
  );

// Uma linha da tabela vira uma operação com os nomes que o domínio entende.
// A tradução fica num lugar só: espalhá-la faria a lista e o detalhe divergirem
// justamente nos campos de prazo, que é onde a divergência custa caro.
export const operacaoDoBanco = (linha) => ({
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
  // O NOME DO MOTORISTA não sai para o embarcador: é dado pessoal de quem
  // dirige, sem interesse legítimo do cliente na prova de entrega. Fica gravado
  // na operação (uso interno) e é omitido aqui, na fronteira com o portal.
  distanciaKm: linha.distance_km || 0,
  // A prova de entrega e a assinatura saem por link temporário (endpoints
  // dedicados); aqui vai só o SINAL de que existem, para a lista/tela decidir o
  // que oferecer sem expor a URL de origem.
  temComprovante: Boolean(linha.proof_url),
  temAssinatura: Boolean(linha.signature_url),
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
