import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// Jornada transversal do ERP.
//
// Diferente das suítes por módulo, este arquivo usa as APIs de negócio para
// atravessar os handoffs entre áreas. Ele prova o caminho correto que a empresa
// quer operar, e registra como TODO os gates que ainda podem ser contornados.
// O objetivo é impedir que "cada tela funciona" seja confundido com "o ERP
// fecha o processo".

let ip = 0;
const nextIp = () => `198.51.100.${(++ip % 240) + 1}`;

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id,name,email,password_hash,password_salt,created_at)
     VALUES (?,?,?,'h','s',?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at)
     VALUES (?,?,?,'2099-01-01T00:00:00.000Z',?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

async function autorizar(usuario, { role = "admin", permissions = ["*"], workspaceOwnerId = "" } = {}) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id,tenant_id,workspace_owner_id,email,role,status,permissions_json,note,created_by,created_at,updated_at)
     VALUES (?,'todogreen',?,?,?,'active',?,'',?,?,?)`,
  ).bind(
    crypto.randomUUID(), workspaceOwnerId, usuario.email, role,
    JSON.stringify(permissions), usuario.id, agora, agora,
  ).run();
}

const pedir = (path, { method = "GET", token, body } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(new Request(`https://app.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env, { waitUntil() {}, passThroughOnException() {} });
};

let dona;
let aprovadora;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id,slug,name,segment,status,theme_json,created_at,updated_at)
     VALUES ('todogreen','todogreen','To Do Green','logistica','active','{}',?,?)`,
  ).bind(agora, agora).run();

  dona = await criarUsuario("journey-owner", "owner@journey.test");
  aprovadora = await criarUsuario("journey-approver", "approver@journey.test");
  await autorizar(dona);
  // O preço deliberadamente baixo exige a alçada máxima (Conselho). A pessoa
  // continua distinta da solicitante, preservando a segregação de funções.
  await autorizar(aprovadora, { role: "owner", permissions: ["*"], workspaceOwnerId: dona.id });
});

describe("jornada cliente → caixa", () => {
  it("atravessa Comercial, Jurídico, Implantação, Operação, Fiscal e Financeiro pela API", async () => {
    const nomeCliente = "Cliente Jornada Integrada";

    // 1. Conta / CRM.
    const clienteResp = await pedir("/api/todogreen/clients", {
      method: "POST", token: dona.token,
      body: {
        nome: nomeCliente,
        documento: "11222333000144",
        segmento: "varejo",
        portalEnabled: true,
        crm: { stage: "Mapeamento", temperature: "Morno", source: "teste de jornada" },
      },
    });
    expect(clienteResp.status).toBe(201);
    const cliente = await clienteResp.json();
    const clientId = cliente.id;

    const carteira = await pedir("/api/todogreen/client-assignments", {
      method: "PUT", token: dona.token,
      body: { clientId, sellerEmail: dona.email, note: "Responsável pela jornada." },
    });
    expect(carteira.status).toBe(200);

    const portal = await pedir("/api/todogreen/clients", {
      method: "PUT", token: dona.token,
      body: {
        clienteId: clientId,
        email: "gestor.cliente@journey.test",
        papel: "gestor",
        enviarConvite: false,
      },
    });
    expect(portal.status).toBe(200);

    // 2. Oportunidade.
    const oportunidadeResp = await pedir("/api/todogreen/records/opportunities", {
      method: "POST", token: dona.token,
      body: {
        clientId,
        cliente: nomeCliente,
        estagio: "Qualificação",
        valorMensal: 30000,
        valorContrato: 360000,
        distanciaKm: 100,
        viagensMes: 20,
        tipoVeiculo: "VUC elétrico",
      },
    });
    expect(oportunidadeResp.status).toBe(201);
    const oportunidade = (await oportunidadeResp.json()).registro;

    // 3. Precificação persistida. O preço informado é deliberadamente baixo
    // para obrigar Deal Desk; assim a proposta não consegue pular a alçada.
    const simulacaoResp = await pedir("/api/todogreen/simulate", {
      method: "POST", token: dona.token,
      body: {
        productId: "middle-mile",
        clientId,
        opportunityId: oportunidade.id,
        persist: true,
        justification: "Jornada integrada do ERP.",
        inputs: {
          client: nomeCliente,
          origin: "São Paulo, SP",
          destination: "Campinas, SP",
          distanceKm: 100,
          tripsPerMonth: 20,
          daysPerMonth: 20,
          vehicleType: "VUC elétrico",
          vehicleClass: "vuc",
          vehicles: 1,
          drivers: 1,
          price: 100,
        },
      },
    });
    expect(simulacaoResp.status).toBe(200);
    const scenario = (await simulacaoResp.json()).scenario;
    expect(scenario.id).toBeTruthy();
    expect(scenario.clientId).toBe(clientId);
    expect(scenario.opportunityId).toBe(oportunidade.id);

    // 4. Deal Desk, com segregação entre quem pede e quem decide.
    const dealResp = await pedir("/api/todogreen/deal-desk", {
      method: "POST", token: dona.token,
      body: {
        cenarioId: scenario.id,
        cliente: nomeCliente,
        justificativa: "Condição excepcional submetida à alçada para a jornada integrada.",
      },
    });
    expect(dealResp.status).toBe(201);
    let deal = (await dealResp.json()).pedido;
    expect(deal.situacao).toBe("pendente");

    const decisao = await pedir(`/api/todogreen/deal-desk/${deal.id}/decisao`, {
      method: "POST", token: aprovadora.token,
      body: { decisao: "aprovar", justificativa: "Condição aprovada para a jornada transversal." },
    });
    expect(decisao.status).toBe(200);
    deal = (await decisao.json()).pedido;
    expect(deal.situacao).toBe("aprovado");

    // 5. Proposta. O servidor consulta o Deal Desk antes de aceitar o POST.
    const propostaResp = await pedir("/api/todogreen/records/proposals", {
      method: "POST", token: dona.token,
      body: {
        clientId,
        cliente: nomeCliente,
        oportunidadeId: oportunidade.id,
        cenarioId: scenario.id,
        titulo: "Proposta jornada integrada",
        escopo: "Middle mile elétrico entre São Paulo e Campinas.",
        condicoes: "Condição comercial conforme cenário aprovado.",
        situacao: "sent",
      },
    });
    expect(propostaResp.status).toBe(201);
    let proposta = (await propostaResp.json()).registro;

    const aceite = await pedir(`/api/todogreen/records/proposals/${proposta.id}`, {
      method: "PATCH", token: dona.token,
      body: { revision: proposta.revision, situacao: "accepted" },
    });
    expect(aceite.status).toBe(200);
    proposta = (await aceite.json()).registro;
    expect(proposta.situacao).toBe("accepted");

    // 6. Tabela de preço real, usada pelo contrato e pelo gate de implantação.
    const tabelaResp = await pedir("/api/todogreen/master-data/price-tables", {
      method: "POST", token: dona.token,
      body: {
        name: "Tabela Jornada Middle Mile",
        code: "JRN-MM",
        clientId,
        productId: "middle-mile",
        currency: "BRL",
        status: "active",
      },
    });
    expect(tabelaResp.status).toBe(201);
    const tabela = (await tabelaResp.json()).record;

    // 7. Contrato nasce da proposta aceita, inicialmente sem aprovação e sem
    // assinatura. O jurídico acontece antes de promover esses estados.
    const contratoResp = await pedir("/api/todogreen/records/contracts", {
      method: "POST", token: dona.token,
      body: {
        clientId,
        cliente: nomeCliente,
        propostaId: proposta.id,
        oportunidadeId: oportunidade.id,
        cenarioId: scenario.id,
        titulo: "Contrato jornada integrada",
        inicioEm: "2026-08-01",
        fimEm: "2027-08-01",
        valorMensal: 30000,
        valorTotal: 360000,
        situacao: "active",
        assinatura: "pending",
        aprovacao: "pending",
        responsavelId: dona.id,
        servicoId: "middle-mile",
        tabelaPrecoId: tabela.id,
        diaFaturamento: 15,
        sla: { onTimePercent: 98, janela: "D+0" },
        regrasFaturamento: { unidade: "viagem", periodicidade: "mensal" },
      },
    });
    expect(contratoResp.status).toBe(201);
    let contrato = (await contratoResp.json()).registro;
    expect(contrato.propostaId).toBe(proposta.id);
    expect(contrato.assinatura).toBe("pending");

    // 8. Jurídico. Processo sequencial: Jurídico e depois liderança.
    const juridicoResp = await pedir("/api/todogreen/enterprise-workflows", {
      method: "POST", token: dona.token,
      body: {
        domain: "legal",
        kind: "contrato",
        title: "Revisar contrato da jornada integrada",
        description: "Revisão das condições antes de assinatura.",
        clientId,
        data: { contractId: contrato.id, proposalId: proposta.id },
      },
    });
    expect(juridicoResp.status).toBe(201);
    let juridico = (await juridicoResp.json()).workflow;
    expect(juridico.status).toBe("pending");
    expect(juridico.approval.next.id).toBe("juridico");

    const juridicoPrimeira = await pedir(`/api/todogreen/enterprise-workflows/${juridico.id}/decision`, {
      method: "POST", token: aprovadora.token,
      body: { decision: "approve", note: "Jurídico validou cláusulas e pontos negociados." },
    });
    expect(juridicoPrimeira.status).toBe(200);
    juridico = (await juridicoPrimeira.json()).workflow;
    expect(juridico.approval.next.id).toBe("dono-negocio");

    const juridicoFinal = await pedir(`/api/todogreen/enterprise-workflows/${juridico.id}/decision`, {
      method: "POST", token: dona.token,
      body: { decision: "approve", note: "Liderança aprovou a versão final negociada." },
    });
    expect(juridicoFinal.status).toBe(200);
    juridico = (await juridicoFinal.json()).workflow;
    expect(juridico.status).toBe("approved");
    expect(juridico.approval.complete).toBe(true);

    // 9. Fronteira conhecida: o ERP ainda recebe o status de assinatura no
    // payload. Este teste só o registra DEPOIS do Jurídico para seguir a
    // jornada desejada; os TODOs abaixo exigem que isso vire gate do servidor.
    const contratoFinalResp = await pedir(`/api/todogreen/records/contracts/${contrato.id}`, {
      method: "PATCH", token: dona.token,
      body: {
        revision: contrato.revision,
        aprovacao: "approved",
        assinatura: "signed",
        assinadoEm: "2026-08-30T12:00:00.000Z",
      },
    });
    expect(contratoFinalResp.status).toBe(200);
    contrato = (await contratoFinalResp.json()).registro;
    expect(contrato).toMatchObject({ aprovacao: "approved", assinatura: "signed" });

    // 10. Metodologia ESG ativa, necessária ao gate de implantação.
    const pesos = await pedir("/api/todogreen/esg/pesos", {
      method: "POST", token: dona.token,
      body: {
        versao: "journey-v1",
        vigenciaInicio: "2026-08-01",
        pesos: {
          reducaoEmissoes: 40,
          ocupacao: 20,
          eficienciaEnergetica: 15,
          qualidadeDados: 15,
          ocorrencias: 10,
        },
        metodologia: "Metodologia do teste transversal.",
        responsavel: "Sustentabilidade",
      },
    });
    expect(pesos.status).toBe(201);

    // 11. Operação real da conta. O gate de implantação não inventa uma.
    const operacaoResp = await pedir("/api/todogreen/records/operations", {
      method: "POST", token: dona.token,
      body: {
        clientId,
        produtoId: "middle-mile",
        contratoId: contrato.id,
        referencia: "JRN-SP-CPS-001",
        dataServico: "2026-08-30",
        origem: "São Paulo, SP",
        destino: "Campinas, SP",
        distanciaKm: 100,
        viagens: 1,
        ocupacaoPercent: 80,
        situacao: "active",
      },
    });
    expect(operacaoResp.status).toBe(201);
    const operacao = (await operacaoResp.json()).registro;

    // GATE (OS exige implantação ativa): antes do go-live, a OS é recusada.
    const osAntesDoGoLive = await pedir("/api/todogreen/transactions/service-orders", {
      method: "POST", token: dona.token,
      body: { clientId, contractId: contrato.id, operationId: operacao.id, quantity: 1, unitPrice: 1000, chargeUnit: "mensal" },
    });
    expect(osAntesDoGoLive.status).toBe(409);
    expect((await osAntesDoGoLive.json()).error).toMatch(/implanta/i);

    // GATE (go-live valida a tabela de preço): tabela inativa reprova o gate.
    const tabelaInativa = await pedir(`/api/todogreen/master-data/price-tables/${tabela.id}`, {
      method: "PATCH", token: dona.token, body: { revision: tabela.revision, status: "inactive" },
    });
    expect(tabelaInativa.status).toBe(200);
    const bloqueada = await pedir(`/api/todogreen/client-activation?clientId=${clientId}`, {
      method: "POST", token: dona.token, body: { action: "prepare" },
    });
    const prontidaoBloqueada = (await bloqueada.json()).snapshot.readiness;
    expect(prontidaoBloqueada.ready).toBe(false);
    expect(prontidaoBloqueada.checks.find((c) => c.id === "priceTable")?.ready).toBe(false);
    // Reativa a tabela para seguir o happy path.
    const tabelaAtiva = await pedir(`/api/todogreen/master-data/price-tables/${tabela.id}`, {
      method: "PATCH", token: dona.token, body: { revision: tabela.revision + 1, status: "active" },
    });
    expect(tabelaAtiva.status).toBe(200);

    // 12. Implantação. Prepare cria centro de custo e dashboard; configure
    // registra que integração/tracking não são requisitos deste projeto.
    const preparada = await pedir(`/api/todogreen/client-activation?clientId=${clientId}`, {
      method: "POST", token: dona.token, body: { action: "prepare" },
    });
    expect(preparada.status).toBe(200);

    const configurada = await pedir(`/api/todogreen/client-activation?clientId=${clientId}`, {
      method: "POST", token: dona.token,
      body: { action: "configure", integrationStatus: "not_required", trackingRequired: false },
    });
    expect(configurada.status).toBe(200);

    const ativada = await pedir(`/api/todogreen/client-activation?clientId=${clientId}`, {
      method: "POST", token: dona.token, body: { action: "activate" },
    });
    expect(ativada.status).toBe(200);
    const ativacao = await ativada.json();
    expect(ativacao.snapshot.readiness.ready).toBe(true);
    expect(ativacao.snapshot.client.activation.status).toBe("active");

    // 13. OS ligada ao contrato e à operação. O preço não é redigitado.
    const osResp = await pedir("/api/todogreen/transactions/service-orders", {
      method: "POST", token: dona.token,
      body: {
        clientId,
        contractId: contrato.id,
        operationId: operacao.id,
        quantity: 1,
        chargeUnit: "viagem",
      },
    });
    expect(osResp.status).toBe(201);
    let os = (await osResp.json()).record;
    expect(os.contractId).toBe(contrato.id);
    expect(os.operationId).toBe(operacao.id);
    expect(os.unitPrice).toBe(30000);

    for (const status of ["released", "in_progress"]) {
      const mov = await pedir(`/api/todogreen/transactions/service-orders/${os.id}/transition`, {
        method: "POST", token: dona.token, body: { status, revision: os.revision },
      });
      expect(mov.status).toBe(200);
      os = (await mov.json()).record;
    }

    // 14. Ocorrência fica na operação antes da entrega.
    const ocorrencia = await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      method: "POST", token: dona.token,
      body: {
        tipo: "ocorrencia",
        titulo: "Atraso no carregamento",
        descricao: "Fila no embarcador, tratada pela operação.",
      },
    });
    expect(ocorrencia.status).toBe(201);

    // 15. Entrega com comprovante gera POD para a OS vinculada.
    const entrega = await pedir(`/api/todogreen/records/operations/${operacao.id}/events`, {
      method: "POST", token: dona.token,
      body: {
        tipo: "entrega",
        titulo: "Entrega concluída",
        recebedor: "Portaria Campinas",
        comprovanteUrl: "https://exemplo.test/pod-jornada.jpg",
      },
    });
    expect(entrega.status).toBe(201);

    const pods = await pedir(`/api/todogreen/transactions/service-orders/${os.id}/pod`, { token: dona.token });
    expect((await pods.json()).records).toHaveLength(1);

    const concluida = await pedir(`/api/todogreen/transactions/service-orders/${os.id}/transition`, {
      method: "POST", token: dona.token, body: { status: "completed", revision: os.revision },
    });
    expect(concluida.status).toBe(200);
    os = (await concluida.json()).record;

    // 16. Faturamento cria fatura e contas a receber.
    const fila = await pedir("/api/todogreen/transactions/billing-items?status=eligible", { token: dona.token });
    const itens = (await fila.json()).records;
    const item = itens.find((registro) => registro.service_order_id === os.id || registro.serviceOrderId === os.id);
    expect(item).toBeTruthy();

    const conferencia = await pedir(`/api/todogreen/transactions/billing-items/${item.id}/check`, {
      method: "POST", token: dona.token,
      body: { approved: true, revision: item.revision || 1 },
    });
    expect(conferencia.status).toBe(200);

    const faturamento = await pedir("/api/todogreen/transactions/billing-runs", {
      method: "POST", token: dona.token,
      body: {
        itemIds: [item.id],
        competenceDate: "2026-08-30",
        dueDate: "2026-09-30",
      },
    });
    expect(faturamento.status).toBe(201);
    const fatura = await faturamento.json();
    expect(fatura.documentType).toBe("cte");
    expect(fatura.invoiceNumber).toMatch(/^CTE-/);

    // 17. Fiscal interno prepara CT-e. Não confundir com autorização SEFAZ.
    const perfilFiscal = await pedir("/api/todogreen/fiscal/profile", {
      method: "POST", token: dona.token,
      body: {
        razaoSocial: "To Do Green Transportes",
        cnpj: "41.385.427/0001-32",
        uf: "SP",
        regimeTributario: "simples",
        faturamento12m: 500000,
      },
    });
    expect(perfilFiscal.status).toBe(201);

    const pendentes = await pedir("/api/todogreen/fiscal/faturas-pendentes", { token: dona.token });
    const pendente = (await pendentes.json()).registros.find((registro) => registro.invoiceId === fatura.invoiceId);
    expect(pendente).toBeTruthy();

    const ctePreparado = await pedir("/api/todogreen/fiscal/documentos/da-fatura", {
      method: "POST", token: dona.token, body: { invoiceId: fatura.invoiceId },
    });
    expect(ctePreparado.status).toBe(201);
    const documentoFiscal = await ctePreparado.json();
    expect(documentoFiscal.status).toBe("rascunho");
    expect(documentoFiscal.invoiceId).toBe(fatura.invoiceId);

    // 18. Recebimento fecha o financeiro e reflete no razão.
    const titulosResp = await pedir("/api/todogreen/transactions/titles?kind=receivable", { token: dona.token });
    const titulos = (await titulosResp.json()).records;
    const titulo = titulos.find((registro) => registro.client_id === clientId || registro.clientId === clientId);
    expect(titulo).toBeTruthy();
    expect(titulo.open_amount).toBeGreaterThan(0);

    const baixa = await pedir(`/api/todogreen/transactions/titles/${titulo.id}/settle`, {
      method: "POST", token: dona.token,
      body: { amount: titulo.open_amount, method: "pix" },
    });
    expect(baixa.status).toBe(201);
    expect(await baixa.json()).toMatchObject({ openAmount: 0, status: "settled" });

    const razao = await env.DB.prepare(
      "SELECT paid_amount,invoice_status FROM todogreen_financial_entries WHERE id='entry-' || ?",
    ).bind(titulo.id).first();
    expect(razao.paid_amount).toBeGreaterThan(0);
    expect(razao.invoice_status).toBe("paid");
  });

  // Gates FECHADOS e cobertos como regressão dentro do happy path acima:
  //  - "OS não nasce sem implantação ativa": bloqueio 409 antes do go-live.
  //  - "go-live valida a tabela de preço (real e ativa)": tabela inativa reprova.
  // TODOs intencionais que ainda faltam fechar:
  it.todo("contrato não pode chegar a aprovado antes de o workflow jurídico obrigatório terminar");
  it.todo("contrato não pode receber assinatura signed sem evidência de assinatura vinculada");
  it.todo("CT-e só pode aparecer como autorizado depois do retorno oficial da SEFAZ");
});
