// ===== Central ESG: cálculo, gravação e histórico =====
//
// É aqui que o motor ambiental e o Green Score deixam de ser função pura e
// viram registro auditável no banco. Sem este arquivo, os dois motores seriam
// código morto e a sala do cliente mostraria "não calculado" para sempre.
//
// Regra do arquivo: nada é gravado sem a memória de cálculo junto. Um número
// ambiental gravado sem entradas, sem versão de fator e sem passos não é
// auditável — e um relatório construído sobre ele não se defende.

import {
  exigirAcessoTodoGreen,
  recorteDeCarteira as recorteDeCarteiraCentral,
} from "./todogreen-access.js";
import {
  FATORES_PADRAO,
  calcularImpactoAmbiental,
} from "../../src/features/logistics/esgEngineDomain.js";
import {
  PESOS_PADRAO,
  calcularGreenScore,
  compararComBase,
  explicarVariacao,
} from "../../src/features/logistics/greenScoreDomain.js";

const TENANT_ID = "todogreen";

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const clean = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const parse = (v, fallback) => {
  try {
    return JSON.parse(v || "");
  } catch {
    return fallback;
  }
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numeroInformado = (v) =>
  v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));
const percentualValido = (v) => numeroInformado(v) && Number(v) >= 0 && Number(v) <= 100;

const podeGerenciarEsg = (access) =>
  access.role === "owner" ||
  access.role === "admin" ||
  access.permissions.includes("*") ||
  access.permissions.includes("esg:manage");

// Ler é liberado para quem já tem acesso à vertical: fator de emissão,
// metodologia e histórico são informação interna da própria empresa, e o
// auditor — cujo trabalho é justamente conferir — chega aqui sem permissão
// nominal quando entra pelo domínio corporativo.
//
// Escrever é outra conversa: calcular grava registro auditável e mudar peso
// muda a régua de todo mundo.
const podeLerEsg = (access) => !!access;


// O conjunto de pesos em vigor. Se ninguém cadastrou nenhum, usa o padrão do
// código — mas devolve a versão dele, para o score gravado saber com que régua
// nasceu mesmo nesse caso.
async function pesosEmVigor(env, access) {
  const linha = await env.DB.prepare(
    `SELECT version, weights_json, methodology, responsible
       FROM todogreen_score_weights
      WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'active'
      ORDER BY effective_from DESC LIMIT 1`,
  )
    .bind(TENANT_ID, access.ownerId)
    .first()
    .catch(() => null);
  if (!linha) return PESOS_PADRAO;
  return {
    versao: linha.version,
    pesos: parse(linha.weights_json, PESOS_PADRAO.pesos),
    metodologia: linha.methodology || PESOS_PADRAO.metodologia,
    responsavel: linha.responsible || PESOS_PADRAO.responsavel,
  };
}

// Reconstrói o score anterior no formato que `explicarVariacao` espera. Sem
// isso, a explicação não teria com o que comparar e todo cálculo pareceria o
// primeiro.
const scoreGravadoParaComparacao = (linha) =>
  linha
    ? {
        score: num(linha.score),
        versaoPesos: linha.weights_version,
        componentes: parse(linha.components_json, {}),
      }
    : null;

export async function handleTodoGreenEsg(request, env) {
  if (!env.DB) return response({ error: "Banco indisponível." }, 503);

  const url = new URL(request.url);
  const recurso = url.pathname
    .replace(/^\/api\/todogreen\/esg\/?/, "")
    .split("/")[0];

  const porta = await exigirAcessoTodoGreen(request, env);
  if (porta.response) return porta.response;
  const { user, access } = porta;

  // ---- Fatores em uso ----
  if (request.method === "GET" && recurso === "fatores") {
    if (!podeLerEsg(access))
      return response({ error: "Sem permissão para ver os fatores." }, 403);
    const pesos = await pesosEmVigor(env, access);
    return response({
      fatores: FATORES_PADRAO,
      pesos: { versao: pesos.versao, pesos: pesos.pesos, metodologia: pesos.metodologia, responsavel: pesos.responsavel },
    });
  }

  // ---- Cadastrar uma versão nova de pesos ----
  //
  // Nunca sobrescreve a anterior: a antiga é encerrada e a nova passa a valer
  // a partir da data informada. Score já gravado continua apontando para a
  // versão com que nasceu.
  if (request.method === "POST" && recurso === "pesos") {
    if (!podeGerenciarEsg(access))
      return response({ error: "Sem permissão para alterar os pesos." }, 403);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const versao = clean(body.versao ?? body.version, 40);
    if (!versao) return response({ error: "Informe a versão." }, 400);
    const pesos = body.pesos || body.weights;

    // Valida antes de gravar, usando a mesma regra do motor: régua que não
    // soma 100 faz operação boa parecer ruim.
    try {
      calcularGreenScore(
        {
          reducaoPercent: 50,
          ocupacaoPercent: 50,
          frotaLimpaPercent: 50,
          qualidadeDados: 50,
          operacoes: 1,
          ocorrencias: 0,
        },
        { versao, pesos, metodologia: "", responsavel: "" },
      );
    } catch (erro) {
      return response({ error: erro.message }, 400);
    }

    const agora = new Date().toISOString();
    const vigencia = clean(body.vigenciaInicio ?? body.effectiveFrom, 10) || agora.slice(0, 10);
    await env.DB.prepare(
      `UPDATE todogreen_score_weights
          SET status = 'superseded', effective_to = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND status = 'active'`,
    )
      .bind(vigencia, TENANT_ID, access.ownerId)
      .run()
      .catch(() => {});
    await env.DB.prepare(
      `INSERT INTO todogreen_score_weights
         (version, tenant_id, workspace_owner_id, weights_json, methodology, source, responsible,
          effective_from, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(tenant_id, workspace_owner_id, version) DO UPDATE SET
         weights_json = excluded.weights_json,
         methodology = excluded.methodology,
         source = excluded.source,
         responsible = excluded.responsible,
         effective_from = excluded.effective_from,
         status = 'active'`,
    )
      .bind(
        versao,
        TENANT_ID,
        access.ownerId,
        JSON.stringify(pesos),
        clean(body.metodologia ?? body.methodology, 1000),
        clean(body.fonte ?? body.source, 500),
        clean(body.responsavel ?? body.responsible, 200),
        vigencia,
        user.id,
        agora,
      )
      .run();
    return response({ ok: true, versao }, 201);
  }

  // ---- Calcular ----
  //
  // Recebe as operações do período, calcula o impacto de cada uma, grava cada
  // cálculo com a memória inteira, apura o Green Score e grava com a
  // explicação da variação em relação ao anterior.
  if (request.method === "POST" && recurso === "calcular") {
    if (!podeGerenciarEsg(access))
      return response({ error: "Sem permissão para calcular." }, 403);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return response({ error: "Corpo JSON inválido." }, 400);
    }
    const clientId = clean(body.clienteId ?? body.clientId, 60);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);

    const cliente = await clienteNoAlcance(env, access, user, clientId);
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const operacoes = Array.isArray(body.operacoes) ? body.operacoes : [];
    if (!operacoes.length)
      return response(
        { error: "Informe ao menos uma operação para calcular." },
        400,
      );

    if (!percentualValido(body.ocupacaoPercent))
      return response({ error: "Informe a ocupação entre 0 e 100%." }, 400);
    if (!percentualValido(body.frotaLimpaPercent))
      return response({ error: "Informe a frota de baixa emissão entre 0 e 100%." }, 400);
    if (!numeroInformado(body.ocorrencias) || Number(body.ocorrencias) < 0)
      return response({ error: "Informe a quantidade de ocorrências, mesmo quando for zero." }, 400);

    const agora = new Date().toISOString();
    const calculos = [];
    for (const operacao of operacoes.slice(0, 200)) {
      let resultado;
      try {
        if (!numeroInformado(operacao.distanciaKm) || Number(operacao.distanciaKm) <= 0)
          throw new Error("Informe a distância da operação.");
        if (!numeroInformado(operacao.viagens) || Number(operacao.viagens) <= 0)
          throw new Error("Informe a quantidade de viagens da operação.");
        if (!clean(operacao.tipoVeiculo, 60))
          throw new Error("Informe o tipo de veículo da operação.");
        if (
          !["medido", "documentado", "estimado", "presumido"].includes(
            operacao.origens?.distancia,
          )
        )
          throw new Error("Informe a origem do dado de distância.");
        resultado = calcularImpactoAmbiental({
          distanciaKm: num(operacao.distanciaKm),
          viagens: num(operacao.viagens),
          tipoVeiculo: clean(operacao.tipoVeiculo, 60),
          origens: operacao.origens || {},
          calculadoEm: agora,
        });
      } catch (erro) {
        // Uma operação inválida não derruba o lote inteiro; ela é reportada e
        // as outras seguem.
        calculos.push({ referencia: clean(operacao.referencia, 120), erro: erro.message });
        continue;
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO environmental_calculations
           (id, tenant_id, workspace_owner_id, created_by, product_id, client_id,
            inputs_json, result_json, methodology_version, data_quality, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          TENANT_ID,
          access.ownerId,
          user.id,
          clean(operacao.produtoId ?? operacao.productId, 60),
          clientId,
          // A memória vai gravada junto do resultado: é o que torna o número
          // reproduzível daqui a dois anos.
          JSON.stringify({ ...resultado.memoria.entradas, origens: operacao.origens || {} }),
          JSON.stringify({ impact: resultado.impacto, memoria: resultado.memoria }),
          resultado.versaoFatores,
          resultado.qualidadeDados,
          agora,
        )
        .run();
      calculos.push({
        id,
        referencia: clean(operacao.referencia, 120),
        impacto: resultado.impacto,
        qualidadeDados: resultado.qualidadeDados,
        versaoFatores: resultado.versaoFatores,
      });
    }

    const validos = calculos.filter((c) => !c.erro);
    if (!validos.length)
      return response(
        { error: "Nenhuma operação pôde ser calculada.", calculos },
        400,
      );

    // Green Score do cliente a partir do que acabou de ser apurado.
    const pesos = await pesosEmVigor(env, access);
    const totalOperacoes = operacoes.length;
    const entradasScore = {
      reducaoPercent:
        validos.reduce((a, c) => a + num(c.impacto.reductionPercent), 0) / validos.length,
      ocupacaoPercent: num(body.ocupacaoPercent),
      frotaLimpaPercent: num(body.frotaLimpaPercent),
      qualidadeDados:
        validos.reduce((a, c) => a + num(c.qualidadeDados), 0) / validos.length,
      operacoes: totalOperacoes,
      ocorrencias: num(body.ocorrencias),
      calculadoEm: agora,
    };

    let score;
    try {
      score = calcularGreenScore(entradasScore, pesos);
    } catch (erro) {
      return response({ error: `Green Score: ${erro.message}` }, 400);
    }

    const anteriorLinha = await env.DB.prepare(
      `SELECT score, weights_version, components_json
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 1`,
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .first()
      .catch(() => null);
    const explicacao = explicarVariacao(
      score,
      scoreGravadoParaComparacao(anteriorLinha),
    );

    await env.DB.prepare(
      `INSERT INTO todogreen_green_scores
         (id, tenant_id, workspace_owner_id, client_id, scope_type, scope_id, score, components_json,
          inputs_json, weights_version, data_quality, variation_explanation,
          previous_score, calculated_by, calculated_at)
       VALUES (?, ?, ?, ?, 'cliente', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        TENANT_ID,
        access.ownerId,
        clientId,
        score.score,
        JSON.stringify(score.componentes),
        JSON.stringify(entradasScore),
        score.versaoPesos,
        Math.round(entradasScore.qualidadeDados),
        explicacao.texto,
        anteriorLinha ? num(anteriorLinha.score) : null,
        user.id,
        agora,
      )
      .run();

    return response({
      cliente: { id: cliente.id, nome: cliente.name },
      calculos,
      greenScore: {
        valor: score.score,
        versaoPesos: score.versaoPesos,
        componentes: score.componentes,
        ressalva: score.ressalva,
      },
      variacao: explicacao,
    });
  }

  // ---- Histórico e benchmark ----
  if (request.method === "GET" && recurso === "historico") {
    if (!podeLerEsg(access))
      return response({ error: "Sem permissão para ver o histórico." }, 403);
    const clientId = clean(url.searchParams.get("cliente"), 60);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    const cliente = await clienteNoAlcance(env, access, user, clientId);
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const linhas = await env.DB.prepare(
      `SELECT score, weights_version, data_quality, variation_explanation,
              previous_score, calculated_at, components_json
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 24`,
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .all()
      .catch(() => ({ results: [] }));

    // Benchmark contra o último score de cada outro cliente. A comparação
    // devolve percentil e mediana — nunca o nome de quem está na base.
    const outros = await env.DB.prepare(
      `SELECT client_id, MAX(calculated_at) AS quando, score
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND scope_type = 'cliente' AND client_id <> ?
        GROUP BY client_id`,
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .all()
      .catch(() => ({ results: [] }));

    const atual = linhas.results?.[0];
    return response({
      historico: (linhas.results || []).map((l) => ({
        score: l.score,
        versaoPesos: l.weights_version,
        qualidadeDados: l.data_quality,
        explicacaoVariacao: l.variation_explanation,
        scoreAnterior: l.previous_score,
        calculadoEm: l.calculated_at,
        componentes: parse(l.components_json, {}),
      })),
      benchmark: atual
        ? compararComBase(
            num(atual.score),
            (outros.results || []).map((o) => num(o.score)),
          )
        : { posicao: null, total: 0, mediana: null, texto: "Ainda não há score calculado." },
    });
  }

  // ---- Material bruto do relatório, lado interno ----
  //
  // Mesma consulta que o portal faz para o cliente. O documento continua sendo
  // montado no navegador com `montarRelatorio`, então o relatório que a equipe
  // gera e o que o cliente baixa saem do mesmo código — não existem duas
  // versões do mesmo número.
  //
  // A diferença é o alcance: aqui o cliente vem do parâmetro, e por isso passa
  // pelo recorte de carteira antes de virar consulta.
  if (request.method === "GET" && recurso === "relatorio") {
    if (!podeLerEsg(access))
      return response({ error: "Sem permissão para gerar relatórios." }, 403);

    const clientId = clean(url.searchParams.get("cliente"), 60);
    const inicio = clean(url.searchParams.get("inicio"), 10);
    const fim = clean(url.searchParams.get("fim"), 10);
    if (!clientId) return response({ error: "Informe o cliente." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim))
      return response({ error: "Informe início e fim no formato AAAA-MM-DD." }, 400);
    if (inicio > fim)
      return response({ error: "O início do período não pode ser depois do fim." }, 400);

    const cliente = await clienteNoAlcance(env, access, user, clientId);
    // 404 e não 403: dizer "existe mas não é sua carteira" já entrega que o
    // cliente existe.
    if (!cliente) return response({ error: "Cliente não encontrado." }, 404);

    const operacoes = await env.DB.prepare(
      `SELECT id, reference, service_date, fields_json
         FROM todogreen_client_operations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND archived_at IS NULL
          AND service_date BETWEEN ? AND ?
        ORDER BY service_date`,
    )
      .bind(TENANT_ID, access.ownerId, clientId, inicio, fim)
      .all()
      .catch(() => ({ results: [] }));

    const calculos = await env.DB.prepare(
      `SELECT id, result_json, methodology_version, data_quality, created_at
         FROM environmental_calculations
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ?
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at`,
    )
      .bind(TENANT_ID, access.ownerId, clientId, inicio, fim)
      .all()
      .catch(() => ({ results: [] }));

    const score = await env.DB.prepare(
      `SELECT score, weights_version, components_json, calculated_at
         FROM todogreen_green_scores
        WHERE tenant_id = ? AND workspace_owner_id = ? AND client_id = ? AND scope_type = 'cliente'
        ORDER BY calculated_at DESC LIMIT 1`,
    )
      .bind(TENANT_ID, access.ownerId, clientId)
      .first()
      .catch(() => null);

    return response({
      cliente: { nome: cliente.name, documento: cliente.document || "" },
      periodo: { inicio, fim },
      operacoes: (operacoes.results || []).map((l) => ({
        id: l.id,
        referencia: l.reference,
        data: l.service_date,
        campos: parse(l.fields_json, {}),
      })),
      calculos: (calculos.results || []).map((l, i) => ({
        ...parse(l.result_json, {}),
        referencia: `Cálculo ${i + 1}`,
        qualidadeDados: l.data_quality,
        versaoFatores: l.methodology_version,
      })),
      greenScore: score
        ? {
            score: score.score,
            versaoPesos: score.weights_version,
            componentes: parse(score.components_json, {}),
          }
        : null,
      geradoPor: user?.email || "",
    });
  }

  // ---- Clientes que esta pessoa pode relatar ----
  if (request.method === "GET" && recurso === "clientes-relatorio") {
    if (!podeLerEsg(access))
      return response({ error: "Sem permissão para gerar relatórios." }, 403);
    const recorte = recorteDaCarteira(access, user);
    const linhas = await env.DB.prepare(
      `SELECT c.id, c.name, c.document
         FROM todogreen_clients c
        WHERE c.tenant_id = ? AND c.workspace_owner_id = ? AND c.archived_at IS NULL AND c.status = 'ativo'
          ${recorte.sql}
        ORDER BY c.name`,
    )
      .bind(TENANT_ID, access.ownerId, ...recorte.params)
      .all()
      .catch(() => ({ results: [] }));
    return response({
      clientes: (linhas.results || []).map((l) => ({
        id: l.id,
        nome: l.name,
        documento: l.document || "",
      })),
      carteiraCompleta: recorte.sql === "",
    });
  }

  return response({ error: "Rota do ESG não encontrada." }, 404);
}

// Quem gere a operação relata qualquer cliente; o vendedor relata só a própria
// carteira. O corte acontece no SQL, não na tela. A regra em si mora em
// `todogreen-access.js` — aqui só se ajusta o alias (`c`, a própria tabela de
// clientes) e a coluna (`id`, não `client_id`, porque a consulta já É sobre
// `todogreen_clients`).
const recorteDaCarteira = (access, user) =>
  recorteDeCarteiraCentral(access, user?.email, "c", "id");

async function clienteNoAlcance(env, access, user, clientId) {
  const recorte = recorteDaCarteira(access, user);
  return env.DB.prepare(
    `SELECT c.id, c.name, c.document
       FROM todogreen_clients c
      WHERE c.tenant_id = ? AND c.workspace_owner_id = ? AND c.id = ?
        AND c.archived_at IS NULL ${recorte.sql}`,
  )
    .bind(TENANT_ID, access.ownerId, clientId, ...recorte.params)
    .first()
    .catch(() => null);
}
