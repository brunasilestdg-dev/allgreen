import { describe, expect, it } from "vitest";
import {
  CAMPOS_LIBERADOS_AO_CLIENTE,
  MAX_LIMIT,
  camposParaCliente,
  operacaoDoBanco,
} from "../../../worker/services/customer-portal/visao-do-cliente.js";
import { linhaParaSolicitacao } from "../../../worker/services/customer-portal/solicitacoes.js";
import { CAMPOS_PROIBIDOS } from "./customerAssistantDomain.js";

// O contrato do que o Portal do Cliente entrega ao embarcador
// (worker/services/customer-portal/visao-do-cliente.js). O AGENTS.md é direto:
// o portal não recebe scores, pipeline, forecast, responsáveis nem observações
// internas. Aqui a regra vira forma: a projeção sai com uma lista FECHADA de
// chaves, e os campos livres só passam pela whitelist. O teste de ponta a ponta
// (test/todogreen-portal-contrato.worker.test.js) confere o mesmo pelas rotas.

// A projeção da operação, chave por chave. Acrescentar uma chave aqui é decidir
// que ela passa a sair para o cliente — não é detalhe de implementação.
const CHAVES_DA_OPERACAO = [
  "id", "referencia", "situacao", "dataServico", "origem", "destino",
  "prometidoEm", "entregueEm", "previsaoEm", "placa", "distanciaKm",
  "temComprovante", "temAssinatura", "ocorrencias", "ultimaPosicao", "campos",
];

// Os campos livres (fields_json) que podem sair, e só eles.
const WHITELIST = [
  "deliveries", "entregas", "packages", "pacotes", "trips", "viagens",
  "distanceKm", "occupancyPercent", "dataQuality", "energyKwh",
  "weightKg", "tons", "pallets", "successRate", "receiverName", "receiverKind",
];

// Os nomes que o dado interno tem no CRM e nas tabelas: scores, pipeline e
// forecast, responsáveis, observações internas, o dado pessoal do motorista e o
// endereço de origem dos arquivos — além da lista do assistente.
const NOMES_INTERNOS = [
  ...CAMPOS_PROIBIDOS,
  "strategicPotential", "relationshipStrength", "operationalFit", "esgFit", "churnRisk", "score", "tier",
  "stage", "estagio", "pipeline", "forecast", "probabilidade", "potentialAnnual", "productPotential",
  "valorMensal", "valorContrato", "monthlyValue", "contractValue",
  "responsavel", "responsavelId", "ownerUserId", "sellerEmail", "assignedTo", "vendedor",
  "notes", "notas", "observacoes", "observacaoInterna", "nota", "notaInterna", "internal",
  "motorista", "driverName", "driverId", "cpf", "cpfMotorista", "proofUrl", "signatureUrl",
];

// Uma linha de todogreen_client_operations com TODAS as colunas preenchidas; o
// que é interno carrega um sentinela que não pode aparecer na projeção.
const LINHA_DA_OPERACAO = {
  id: "op-1", tenant_id: "todogreen", workspace_owner_id: "INTERNO-dono", client_id: "cli-1",
  contract_id: "INTERNO-contrato", product_id: "INTERNO-produto", reference: "OP-2026-001",
  status: "em-transito", service_date: "2026-09-21", origin: "CD Guarulhos", destination: "Hub Barueri",
  promised_at: "2026-09-21T18:00:00.000Z", delivered_at: "", eta_at: "2026-09-21T17:30:00.000Z",
  vehicle_plate: "ABC1D23", driver_name: "INTERNO-nome-do-motorista", driver_id: "INTERNO-motorista-id",
  route_id: "INTERNO-rota", route_stop_order: 7, sla_status: "INTERNO-sla",
  distance_km: 120, distance_km_quality: "INTERNO-qualidade-km", energy_kwh: 33, energy_kwh_quality: "INTERNO-qualidade-kwh",
  proof_url: "https://INTERNO-origem.example/pod.jpg", proof_hash: "INTERNO-hash-pod",
  signature_url: "https://INTERNO-origem.example/assinatura.png", signature_hash: "INTERNO-hash-assinatura",
  last_position_at: "2026-09-21T17:00:00.000Z", last_position_lat: -23.5, last_position_lng: -46.6,
  pickup_lat: -23.44, pickup_lng: -46.53, delivery_lat: -23.51, delivery_lng: -46.87,
  incident_count: 1, revision: 4, created_by: "INTERNO-autor", updated_by: "INTERNO-editor",
  created_at: "2026-09-20T10:00:00.000Z", updated_at: "2026-09-21T17:00:00.000Z", archived_at: null,
  fields_json: JSON.stringify({
    deliveries: 12, distanceKm: 80, receiverName: "Recebedor na doca", energyKwh: 33,
    margem: 41.5, custoPorKm: 2.37, comissao: 3, score: "INTERNO-score", pipeline: "INTERNO-pipeline",
    forecast: "INTERNO-forecast", responsavel: "INTERNO-responsavel", observacaoInterna: "INTERNO-observacao",
    cpfMotorista: "111.444.777-35",
    // Chave liberada com valor aninhado: não há whitelist para o que vem dentro.
    pallets: { detalhe: "INTERNO-aninhado" },
  }),
};

describe("a operação que sai para o cliente", () => {
  it("tem exatamente as chaves do contrato", () => {
    expect(Object.keys(operacaoDoBanco(LINHA_DA_OPERACAO))).toEqual(CHAVES_DA_OPERACAO);
  });

  it("não leva nenhuma coluna interna: motorista, contrato, rota, autor, URL de origem", () => {
    const texto = JSON.stringify(operacaoDoBanco(LINHA_DA_OPERACAO));
    expect(texto).not.toContain("INTERNO");
    expect(texto).not.toMatch(/111\.444\.777-35|41\.5|2\.37/);
  });

  it("comprovante e assinatura saem só como sinal de que existem", () => {
    const vista = operacaoDoBanco(LINHA_DA_OPERACAO);
    expect(vista.temComprovante).toBe(true);
    expect(vista.temAssinatura).toBe(true);
    const semArquivos = operacaoDoBanco({ ...LINHA_DA_OPERACAO, proof_url: "", signature_url: null });
    expect([semArquivos.temComprovante, semArquivos.temAssinatura]).toEqual([false, false]);
  });

  it("os campos livres saem só da whitelist e só com valor escalar", () => {
    expect(operacaoDoBanco(LINHA_DA_OPERACAO).campos).toEqual({
      deliveries: 12, distanceKm: 80, receiverName: "Recebedor na doca", energyKwh: 33,
    });
  });
});

describe("a whitelist dos campos livres", () => {
  it("é esta, e mudar é decisão explícita", () => {
    expect([...CAMPOS_LIBERADOS_AO_CLIENTE].sort()).toEqual([...WHITELIST].sort());
  });

  it("não libera nenhum nome de dado interno", () => {
    const internos = new Set(NOMES_INTERNOS.map((nome) => nome.toLowerCase()));
    for (const chave of CAMPOS_LIBERADOS_AO_CLIENTE) expect(internos.has(chave.toLowerCase()), chave).toBe(false);
  });

  it("camposParaCliente aguenta entrada torta sem vazar nada", () => {
    for (const bruto of [null, undefined, "margem", 42, [1, 2], { 0: "x" }]) expect(camposParaCliente(bruto)).toEqual({});
    expect(camposParaCliente({ deliveries: [1, 2], trips: null, tons: 3 })).toEqual({ tons: 3 });
  });

  it("as listas do portal têm teto", () => {
    expect(MAX_LIMIT).toBe(100);
  });
});

describe("a solicitação que sai para o cliente", () => {
  it("tem exatamente estas chaves — o responsável interno (assigned_to) não sai", () => {
    const vista = linhaParaSolicitacao({
      id: "req-1", type: "ocorrencia", subject: "Avaria", description: "Caixa amassada", urgency: "alta",
      status: "aberta", fields_json: "{}", due_at: "2026-09-22T10:00:00.000Z", opened_by: "cliente@alfa.com.br",
      closed_at: null, created_at: "2026-09-21T10:00:00.000Z", updated_at: "2026-09-21T10:00:00.000Z",
      assigned_to: "INTERNO-responsavel@todogreen.com.br", closed_by: "INTERNO-quem-fechou",
      workspace_owner_id: "INTERNO-dono",
    });
    expect(Object.keys(vista)).toEqual([
      "id", "tipo", "assunto", "descricao", "urgencia", "status", "campos",
      "prazoEm", "abertaPor", "encerradaEm", "criadaEm", "atualizadaEm",
    ]);
    expect(JSON.stringify(vista)).not.toContain("INTERNO");
  });
});
