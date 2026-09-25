import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";
import { CAMPOS_LIBERADOS_AO_CLIENTE } from "../worker/services/customer-portal/visao-do-cliente.js";

// O contrato do que o Portal do Cliente entrega, de ponta a ponta. O AGENTS.md
// proíbe que o portal receba scores, pipeline, forecast, responsáveis ou
// observações internas. Aqui a conta do cliente é semeada com TUDO isso — CRM
// com notas e potencial, carteira com vendedora, oportunidade com valor e
// responsável, nota da equipe, motorista, contrato e arquivos de origem —, cada
// dado com um sentinela, e todas as rotas de leitura do portal são varridas.
// Nenhum sentinela pode voltar. A projeção chave a chave é travada em
// src/features/logistics/customerPortalViewContract.test.js.

const DONO = "ct-dono";
const CLIENTE = "ct-cli";
const OPERACAO = "ct-op";
const SOLICITACAO = "ct-req";

const SENTINELAS = {
  notasDoCliente: "SENTINELA-NOTA-DO-CLIENTE",
  tier: "SENTINELA-TIER",
  estagioDoCrm: "SENTINELA-ESTAGIO-CRM",
  proximaAcao: "SENTINELA-PROXIMA-ACAO",
  planoDeConta: "SENTINELA-PLANO-DE-CONTA",
  contato: "SENTINELA-CONTATO",
  potencial: "424242.42",
  score: "87.654",
  vendedora: "sentinela-vendedora@todogreen.com.br",
  oportunidade: "SENTINELA-OPORTUNIDADE",
  forecast: "SENTINELA-FORECAST",
  valorMensal: "313131.31",
  motorista: "SENTINELA-MOTORISTA",
  motoristaId: "sentinela-motorista-id",
  contrato: "sentinela-contrato-id",
  origemDoArquivo: "sentinela-origem.example",
  observacaoDaOperacao: "SENTINELA-OBS-DA-OPERACAO",
  responsavelDaSolicitacao: "sentinela-responsavel@todogreen.com.br",
  notaDaEquipe: "SENTINELA-NOTA-DA-EQUIPE",
};

let n = 0;
const nextIp = () => `198.51.100.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(`tok-${id}`), agora).run();
  return { id, email, token: `tok-${id}` };
}

const pedir = (caminho, token) =>
  worker.fetch(
    new Request(`https://app.test${caminho}`, {
      headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": nextIp() },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

let dona;
let pessoaDoCliente;

beforeAll(async () => {
  const agora = new Date().toISOString();
  dona = await criarUsuario(DONO, "dona@ct-transportadora.com.br");
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES ('ct-acesso-dona', 'todogreen', ?, ?, 'admin', 'active', '["*"]', '', ?, ?, ?)`,
  ).bind(DONO, dona.email, DONO, agora, agora).run();

  // A conta, com o CRM interno inteiro: notas, tier, estágio, próxima ação,
  // plano de conta, contatos, potencial e scores.
  await env.DB.prepare(
    `INSERT INTO todogreen_clients
       (id, tenant_id, workspace_owner_id, name, status, portal_enabled, notes, fields_json,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, 'Cliente do Contrato', 'ativo', 1, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    CLIENTE, DONO, SENTINELAS.notasDoCliente,
    JSON.stringify({
      tier: SENTINELAS.tier, stage: SENTINELAS.estagioDoCrm, nextAction: SENTINELAS.proximaAcao,
      accountPlan: { objective: SENTINELAS.planoDeConta },
      contacts: [{ id: "ct-contato", name: SENTINELAS.contato, email: "contato@cliente.com.br" }],
      potentialAnnual: Number(SENTINELAS.potencial), strategicPotential: Number(SENTINELAS.score),
      churnRisk: Number(SENTINELAS.score),
    }),
    DONO, DONO, agora, agora,
  ).run();

  // Quem responde pela conta: a carteira e a oportunidade com valor e forecast.
  await env.DB.prepare(
    `INSERT INTO todogreen_client_assignments
       (id, tenant_id, client_id, seller_email, status, note, assigned_by, created_at, updated_at)
     VALUES ('ct-carteira', 'todogreen', ?, ?, 'active', '', ?, ?, ?)`,
  ).bind(CLIENTE, SENTINELAS.vendedora, DONO, agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_opportunities
       (id, tenant_id, workspace_owner_id, client_id, client_name, title, stage, monthly_value,
        owner_user_id, fields_json, created_by, updated_by, created_at, updated_at)
     VALUES ('ct-opp', 'todogreen', ?, ?, 'Cliente do Contrato', ?, 'Negociação', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    DONO, CLIENTE, SENTINELAS.oportunidade, Number(SENTINELAS.valorMensal), DONO,
    JSON.stringify({ forecast: SENTINELAS.forecast }), DONO, DONO, agora, agora,
  ).run();

  // A operação com o que é interno em coluna e em campo livre.
  await env.DB.prepare(
    `INSERT INTO todogreen_client_operations
       (id, tenant_id, client_id, workspace_owner_id, contract_id, reference, status, service_date,
        origin, destination, vehicle_plate, driver_name, driver_id, proof_url, proof_hash,
        signature_url, signature_hash, fields_json, created_by, updated_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'OP-CONTRATO', 'em-transito', '2026-09-21', 'CD', 'Hub', 'CTR1A23',
             ?, ?, ?, 'hash-pod', ?, 'hash-assinatura', ?, ?, ?, ?, ?)`,
  ).bind(
    OPERACAO, CLIENTE, DONO, SENTINELAS.contrato, SENTINELAS.motorista, SENTINELAS.motoristaId,
    `https://${SENTINELAS.origemDoArquivo}/pod.jpg`, `https://${SENTINELAS.origemDoArquivo}/assinatura.png`,
    JSON.stringify({
      deliveries: 5, distanceKm: 42, receiverName: "Recebedor",
      observacaoInterna: SENTINELAS.observacaoDaOperacao, responsavel: SENTINELAS.vendedora,
      pipeline: SENTINELAS.forecast, score: Number(SENTINELAS.score),
    }),
    DONO, DONO, agora, agora,
  ).run();

  // A solicitação com responsável interno e nota da equipe.
  await env.DB.prepare(
    `INSERT INTO todogreen_client_requests
       (id, tenant_id, client_id, workspace_owner_id, type, subject, description, urgency, status,
        fields_json, due_at, opened_by, assigned_to, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, 'ocorrencia', 'Avaria', 'Caixa amassada', 'alta', 'em_analise',
             '{}', '2026-09-23T10:00:00.000Z', 'portal@ct-cliente.com.br', ?, ?, ?)`,
  ).bind(SOLICITACAO, CLIENTE, DONO, SENTINELAS.responsavelDaSolicitacao, agora, agora).run();
  await env.DB.prepare(
    `INSERT INTO todogreen_client_request_messages
       (id, tenant_id, workspace_owner_id, client_id, request_id, author_side, author_email, author_name,
        body, internal, created_at)
     VALUES ('ct-msg', 'todogreen', ?, ?, ?, 'equipe', ?, 'Equipe', ?, 1, ?)`,
  ).bind(DONO, CLIENTE, SOLICITACAO, SENTINELAS.vendedora, SENTINELAS.notaDaEquipe, agora).run();

  // Evidência com o endereço de origem do arquivo.
  await env.DB.prepare(
    `INSERT INTO todogreen_evidences
       (id, tenant_id, client_id, workspace_owner_id, tipo, titulo, arquivo_url, arquivo_nome,
        created_by, created_at, updated_at)
     VALUES ('ct-evid', 'todogreen', ?, ?, 'certificado', 'Certificado de emissões', ?, 'certificado.pdf', ?, ?, ?)`,
  ).bind(CLIENTE, DONO, `https://${SENTINELAS.origemDoArquivo}/certificado.pdf`, DONO, agora, agora).run();

  // Quem entra no portal: gestora com todas as permissões do cliente.
  pessoaDoCliente = await criarUsuario("ct-portal", "portal@ct-cliente.com.br");
  await env.DB.prepare(
    `INSERT INTO todogreen_client_users
       (id, tenant_id, client_id, email, role, status, permissions_json, invited_by, created_at, updated_at)
     VALUES ('ct-vinculo', 'todogreen', ?, ?, 'cliente_admin', 'active', '[]', ?, ?, ?)`,
  ).bind(CLIENTE, pessoaDoCliente.email, DONO, agora, agora).run();
});

const ROTAS_DE_LEITURA = [
  "/api/todogreen/portal/sessao",
  "/api/todogreen/portal/resumo",
  "/api/todogreen/portal/operacoes",
  `/api/todogreen/portal/operacoes/${OPERACAO}`,
  "/api/todogreen/portal/financeiro",
  "/api/todogreen/portal/trilha",
  "/api/todogreen/portal/relatorio?inicio=2026-01-01&fim=2026-12-31",
  "/api/todogreen/portal/evidencias",
  "/api/todogreen/portal/solicitacoes",
  `/api/todogreen/portal/solicitacoes?id=${SOLICITACAO}`,
  "/api/todogreen/portal/nps",
];

describe("o que o portal entrega ao cliente", () => {
  it("o dado interno existe de verdade: a mesma conta, lida por dentro, traz os sentinelas", async () => {
    // Sem isto o teste poderia passar só porque a semente não entrou.
    const clientes = await (await pedir("/api/todogreen/clients", dona.token)).text();
    for (const chave of ["notasDoCliente", "tier", "planoDeConta", "contato", "vendedora"])
      expect(clientes, chave).toContain(SENTINELAS[chave]);
    const oportunidades = await (await pedir("/api/todogreen/records/opportunities", dona.token)).text();
    expect(oportunidades).toContain(SENTINELAS.oportunidade);
    expect(oportunidades).toContain(SENTINELAS.forecast);
  });

  it.each(ROTAS_DE_LEITURA)("%s não devolve score, pipeline, forecast, responsável nem observação interna", async (rota) => {
    const resposta = await pedir(rota, pessoaDoCliente.token);
    expect(resposta.status).toBe(200);
    const texto = await resposta.text();
    for (const [nome, sentinela] of Object.entries(SENTINELAS))
      expect(texto.includes(sentinela), `${nome} vazou em ${rota}`).toBe(false);
  });

  it("a operação chega pela rota só com os campos livres da whitelist", async () => {
    const lista = await (await pedir("/api/todogreen/portal/operacoes", pessoaDoCliente.token)).json();
    const detalhe = await (await pedir(`/api/todogreen/portal/operacoes/${OPERACAO}`, pessoaDoCliente.token)).json();
    const relatorio = await (
      await pedir("/api/todogreen/portal/relatorio?inicio=2026-01-01&fim=2026-12-31", pessoaDoCliente.token)
    ).json();
    const daLista = lista.operacoes.find((item) => item.id === OPERACAO);
    const doRelatorio = relatorio.operacoes.find((item) => item.id === OPERACAO);
    for (const vista of [daLista, detalhe.operacao, doRelatorio]) {
      expect(vista).toBeTruthy();
      for (const chave of Object.keys(vista.campos)) expect(CAMPOS_LIBERADOS_AO_CLIENTE.has(chave), chave).toBe(true);
      expect(vista.campos).toEqual({ deliveries: 5, distanceKm: 42, receiverName: "Recebedor" });
    }
    // Comprovante e assinatura: o sinal, nunca a URL.
    expect(detalhe.comprovante).toEqual({ disponivel: true, impressaoDigital: "hash-pod" });
    expect(detalhe.assinatura).toEqual({ disponivel: true, impressaoDigital: "hash-assinatura" });
  });
});
