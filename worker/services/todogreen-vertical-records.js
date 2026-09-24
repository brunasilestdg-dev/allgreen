// ===== Registros da vertical =====
//
// Simulações, propostas, oportunidades, operações, receitas, custos e comissões
// moravam no estado genérico do espaço de trabalho — um JSON por usuário,
// gravado inteiro a cada alteração. O preço disso aparecia em quatro lugares:
//
//   • duas pessoas no mesmo espaço sobrescreviam o trabalho uma da outra;
//   • o portal do cliente não enxergava nada escrito por dentro;
//   • auditoria e versionamento valiam para metade da vertical;
//   • o painel somava fontes diferentes, com identificadores que não casavam.
//
// Aqui é a outra metade indo para o mesmo lugar onde clientes, carteiras,
// solicitações, ESG e Tracker já estavam.
//
// Duas decisões que valem explicação:
//
// 1) O escopo é da LINHA, não da consulta. Todo SELECT e todo UPDATE carregam
//    `workspace_owner_id = ?` vindo do vínculo da sessão, nunca do corpo do
//    pedido. Um handler que esquecesse o filtro devolveria a tabela inteira, e
//    é exatamente esse esquecimento que o formato abaixo torna difícil.
//
// 2) Escrita concorrente é resolvida por `revision`, não por "quem chegou
//    depois vence". O UPDATE exige a revisão que o cliente leu; se ela mudou,
//    a resposta é 409 e a tela recarrega — em vez de apagar em silêncio o que
//    a outra pessoa acabou de escrever, que é o defeito do JSON único.
//
// ----- Fachada -----
//
// Aqui ficou o roteador HTTP (`handleTodoGreenVerticalRecords`) e as
// reexportações que outros serviços e testes já importavam deste caminho. O
// resto mora em `vertical-records/`, um módulo por responsabilidade:
//   colecoes/            o registro COLECOES por domínio + o contrato do descritor
//   acesso.js            quem lê cada coleção e o recorte de carteira
//   cenarios.js          simulações de preço (imutáveis)
//   crud.js              listar, criar, atualizar e arquivar pela esteira única
//   gates.js             travas de negócio (Deal Desk, competência, Jurídico)
//   efeitos-do-ganho.js  handoff, implantação, conta aquecida, última interação
//   eventos.js           linhas do tempo de operação, contrato e Jurídico
//   ledger-operacional.js  o evento operacional canônico (tela, motorista, TMS)
//   pagamentos.js        baixa e estorno do razão financeiro
//   util.js              resposta JSON e saneadores

import { paginacao, podeNaVertical } from "./todogreen-access.js";
import { podeLerCenarios, podeLerColecao } from "./vertical-records/acesso.js";
import { criarCenario, listarCenarios } from "./vertical-records/cenarios.js";
import { COLECOES } from "./vertical-records/colecoes/index.js";
import { arquivar, atualizar, criar, listar } from "./vertical-records/crud.js";
import {
  listarEventosContrato,
  listarEventosJuridicos,
  listarEventosOperacao,
  registrarEventoJuridico,
  registrarEventoOperacao,
} from "./vertical-records/eventos.js";
import {
  estornarPagamento,
  listarPagamentos,
  registrarPagamento,
} from "./vertical-records/pagamentos.js";
import { json, texto } from "./vertical-records/util.js";

// Compatibilidade: estes nomes continuam importáveis deste caminho.
export { deveCriarHandoff, idDaImplantacaoDeGanho } from "./vertical-records/efeitos-do-ganho.js";
export { criarRegistroDaColecao } from "./vertical-records/crud.js";
export { aplicarEventoNaOperacaoPorId, aplicarEventoOperacional } from "./vertical-records/ledger-operacional.js";

export async function handleTodoGreenVerticalRecords(request, env, access, user) {
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, records, [colecao], [id]
  const nome = partes[3] || "";
  const id = texto(partes[4], 120);
  const subrecurso = texto(partes[5], 80);
  const subId = texto(partes[6], 120);

  // Sem coleção na URL: a vertical inteira de uma vez, sem filtro nem
  // página — é a carga do painel, que precisa do total para somar, não de um
  // recorte dele. Filtro e paginação são de quem abre UMA coleção por vez.
  if (!nome) {
    if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
    const nomes = Object.keys(COLECOES);
    const permitidas = nomes.filter((n) => podeLerColecao(access, COLECOES[n]));
    // ISOLAMENTO POR COLEÇÃO. Antes era Promise.all: uma coleção que falha
    // (coluna/tabela ausente, SQL incompatível com o schema remoto) rejeitava o
    // agregado inteiro → a tela caía no catch e mostrava TUDO zerado. Agora é
    // allSettled: o que leu aparece; o que falhou entra em `errors` para a tela
    // mostrar "indisponível" (não zero).
    const [resultados, cenariosRes] = await Promise.all([
      Promise.allSettled(permitidas.map((n) => listar(env, COLECOES[n], access, user.email))),
      podeLerCenarios(access)
        ? listarCenarios(env, access, user.email).then(
            (value) => ({ status: "fulfilled", value }),
            (reason) => ({ status: "rejected", reason }),
          )
        : Promise.resolve({ status: "fulfilled", value: { registros: [], total: 0 } }),
    ]);
    const porNome = Object.fromEntries(
      permitidas.map((n, i) => [n, resultados[i].status === "fulfilled" ? resultados[i].value : null]),
    );
    const errors = {};
    permitidas.forEach((n, i) => {
      if (resultados[i].status === "rejected") {
        console.error(`todogreen records: coleção "${n}" indisponível`, resultados[i].reason?.message || resultados[i].reason);
        errors[n] = { code: "read_failed", message: "Não foi possível ler esta coleção agora." };
      }
    });
    if (cenariosRes.status === "rejected") {
      console.error("todogreen records: coleção \"scenarios\" indisponível", cenariosRes.reason?.message || cenariosRes.reason);
      errors.scenarios = { code: "read_failed", message: "Não foi possível ler as simulações agora." };
    }
    const cenarios = cenariosRes.status === "fulfilled" ? cenariosRes.value : { registros: [], total: 0 };
    const payload = {
      ...Object.fromEntries(nomes.map((n) => [n, porNome[n]?.registros || []])),
      scenarios: cenarios.registros,
    };
    // `errors` só aparece quando há coleção indisponível. Zero de verdade
    // (coleção lida e vazia) continua sendo array vazio SEM entrada em errors —
    // é como a tela distingue "não tem" de "não deu para ler".
    if (Object.keys(errors).length) payload.errors = errors;
    if (url.searchParams.get("includeTotals") === "1" || request.headers.get("x-todogreen-include-totals") === "1") payload.totals = {
        ...Object.fromEntries(nomes.map((n) => [n, porNome[n]?.total || 0])),
        scenarios: cenarios.total,
      };
    return json(payload);
  }

  if (nome === "scenarios") {
    if (request.method === "GET") {
      if (!podeLerCenarios(access))
        return json({ error: "Seu papel não pode consultar simulações." }, 403);
      const { limit, offset } = paginacao(url);
      const clienteId = texto(url.searchParams.get("cliente"), 120);
      const resultado = await listarCenarios(env, access, user.email, { clienteId, limit, offset });
      return json({ ...resultado, limit, offset });
    }
    if (request.method === "POST") {
      if (!podeNaVertical(access, "pricing:simulate"))
        return json({ error: "Seu papel não pode salvar simulações." }, 403);
      return criarCenario(env, access, user, await request.json().catch(() => ({})));
    }
    return json({ error: "A simulação salva não muda. Faça outra simulação." }, 405);
  }

  const colecao = COLECOES[nome];
  if (!colecao) return json({ error: "Coleção desconhecida." }, 404);

  if (request.method === "GET" && !podeLerColecao(access, colecao))
    return json({ error: "Seu papel não pode consultar estes registros." }, 403);

  if (id && subrecurso === "events" && colecao === COLECOES.operations) {
    if (request.method === "GET") return listarEventosOperacao(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar eventos operacionais." }, 403);
      return registrarEventoOperacao(env, access, user, id, await request.json().catch(() => ({})), new URL(request.url).origin);
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "payments" && colecao === COLECOES.financial) {
    if (request.method === "GET") return listarPagamentos(env, access, user, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode registrar baixas." }, 403);
      return registrarPagamento(env, access, user, id, await request.json().catch(() => ({})));
    }
    // Estorno de uma baixa específica: DELETE .../payments/:paymentId — lança o
    // compensatório, não apaga o histórico.
    if (request.method === "DELETE" && subId) {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode estornar baixas." }, 403);
      return estornarPagamento(env, access, user, id, subId);
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (id && subrecurso === "events" && colecao === COLECOES.contracts) {
    if (request.method === "GET") return listarEventosContrato(env, access, user, id);
    return json({ error: "O histórico contratual é gerado pelas alterações do contrato." }, 405);
  }

  // Jurídico como fluxo: a linha do tempo do documento (submissão → análise →
  // validar/reprovar/pedir ajuste → reenvio → conclusão). A permissão de papel
  // (submeter vs. decidir) é resolvida dentro do handler pela máquina de estados.
  if (id && subrecurso === "events" && colecao === COLECOES.legal) {
    if (request.method === "GET") return listarEventosJuridicos(env, access, id);
    if (request.method === "POST") {
      if (!podeNaVertical(access, colecao.permissao))
        return json({ error: "Seu papel não pode atuar no fluxo jurídico." }, 403);
      return registrarEventoJuridico(env, access, user, id, await request.json().catch(() => ({})));
    }
    return json({ error: "Método não permitido." }, 405);
  }

  if (request.method === "GET") {
    const { limit, offset } = paginacao(url);
    const clienteId = texto(url.searchParams.get("cliente"), 120);
    const resultado = await listar(env, colecao, access, user.email, { clienteId, limit, offset });
    return json({ ...resultado, limit, offset });
  }

  // Leitura segue o vínculo; escrita exige permissão. Papel que só consulta
  // não altera premissa comercial.
  if (!podeNaVertical(access, colecao.permissao))
    return json({ error: "Seu papel não pode alterar estes registros." }, 403);

  const corpo = request.method === "DELETE" ? {} : await request.json().catch(() => ({}));

  if (request.method === "POST" && !id) return criar(env, colecao, access, user, corpo, user.email);
  if (request.method === "PATCH" && id) return atualizar(env, colecao, access, user, id, corpo, user.email);
  if (request.method === "DELETE" && id) return arquivar(env, colecao, access, user, id);
  return json({ error: "Método não permitido." }, 405);
}
