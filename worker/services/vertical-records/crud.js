// ===== Registros da vertical: a esteira única de CRUD =====
//
// Contrato: `listar` devolve { registros, total }; `criar`, `atualizar` e
// `arquivar` devolvem a Response da API (201/200, ou 400/404/409). Toda coleção
// passa pela MESMA esteira: `exigido` → travas de negócio → `guardaDeEscrita`
// → INSERT/UPDATE com `revision` → efeitos → auditoria.
// Autorização: o roteador já conferiu a permissão da coleção; aqui valem os
// cortes de tenant, espaço (o do vínculo, nunca o do corpo) e carteira
// (`noAlcanceDaCarteira` antes de atualizar ou arquivar) — fora do alcance é
// 404. `criarRegistroDaColecao` abre a mesma esteira para outros serviços.

import { TENANT_ID } from "../todogreen-access.js";
import { registrarAuditoriaTodoGreen } from "../todogreen-governance.js";
import { STATUS_DE_LIBERACAO, viabilidadeDaProposta } from "../todogreen-viability.js";
import { noAlcanceDaCarteira, recorteDaColecao } from "./acesso.js";
import { COLECOES, nomeDaColecao } from "./colecoes/index.js";
import {
  aquecerContaPorOportunidade,
  carimbarUltimaInteracao,
  criarHandoffOperacional,
  criarImplantacaoDeGanho,
  deveCriarHandoff,
} from "./efeitos-do-ganho.js";
import { registrarEventoContrato } from "./eventos.js";
import {
  bloqueioDeCompetencia,
  carimboDeViabilidade,
  documentoDeAssinaturaVinculado,
  juridicoConcluido,
  proposalLiberada,
  validarFinanceiro,
} from "./gates.js";
import { json, objeto, texto } from "./util.js";

// A leitura carrega o recorte de carteira além do escopo de espaço. São dois
// cortes diferentes: o espaço separa empresas, a carteira separa vendedores
// dentro da mesma empresa. Sem o segundo, um vendedor lista as oportunidades
// dos colegas.
export const listar = async (env, colecao, access, email, { clienteId = "", limit = 500, offset = 0 } = {}) => {
  const recorte = recorteDaColecao(colecao, access, email);
  const porCliente = clienteId && colecao.escopoDeCarteira !== false;
  const filtroCliente = porCliente ? "AND t.client_id = ?" : "";
  const paramsFiltro = porCliente ? [clienteId] : [];
  const base = `FROM ${colecao.tabela} t
      WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL ${filtroCliente} ${recorte.sql}`;
  const params = [TENANT_ID, access.ownerId, ...paramsFiltro, ...recorte.params];
  const [{ results }, totalRow] = await Promise.all([
    env.DB.prepare(
      `SELECT t.* ${base}
        ORDER BY ${colecao.ordem.replace(/\b(updated_at|reference_month)\b/g, "t.$1")}
        LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${base}`).bind(...params).first(),
  ]);
  const registros = (results || []).map(colecao.daLinha);
  // Corte que o SQL não sabe fazer. Só as pastas usam isto, e por um motivo
  // específico: a visibilidade de uma pasta depende de TODA a linhagem dela, o
  // que é uma consulta recursiva sobre um conjunto pequeno. Filtrar depois da
  // leitura é aceitável AQUI porque os três cortes de escopo (tenant, espaço,
  // arquivado) continuam no SQL — este é um quarto corte, dentro do próprio
  // espaço, sobre dados que a pessoa já podia ler o suficiente para saber que
  // existem.
  //
  // Não generalizar: para qualquer outra coleção, filtro fora do SQL é dado
  // sensível passando por variável de aplicação.
  if (typeof colecao.filtrarLeitura === "function") {
    const permitidos = colecao.filtrarLeitura(registros, { access, email });
    // O total precisa acompanhar o filtro, senão a paginação do gancho pede
    // páginas que nunca chegam e a tela fica carregando para sempre.
    return { registros: permitidos, total: permitidos.length };
  }
  return { registros, total: totalRow?.total || 0 };
};

// Exportado para outros serviços criarem registros pela MESMA esteira da API
// (validação, gates, auditoria, aquecimento de conta) — ex.: oportunidade a
// partir de um sinal de mercado. Devolve a Response da API; quem chama lê o JSON.
export const criarRegistroDaColecao = (env, { nome, access, user, corpo, email = "" }) => {
  const colecao = COLECOES[nome];
  if (!colecao) return json({ error: `Coleção desconhecida: ${nome}.` }, 400);
  return criar(env, colecao, access, user, corpo, email);
};

// O par proposta + cliente do contrato: a proposta existe no espaço, foi
// aceita, é do mesmo cliente e não tem outro contrato ativo. Conferido na
// criação e em todo PATCH que troca um dos dois — sem isso a edição desfazia o
// gate da criação (um contrato nascido de proposta aceita passava a apontar
// para um rascunho, ou para outro cliente).
const conferirParDoContrato = async (env, access, { propostaId, clientId, contratoId = "" }) => {
  const proposta = await env.DB.prepare(
    `SELECT id,client_id,client_name,opportunity_id,scenario_id,status
       FROM todogreen_proposals
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(propostaId, TENANT_ID, access.ownerId).first();
  if (!proposta) return { resposta: json({ error: "Proposta não encontrada neste espaço." }, 404) };
  if (!new Set(["accepted", "approved", "aceita", "aprovada"]).has(texto(proposta.status).toLowerCase()))
    return { resposta: json({ error: "Aceite a proposta antes de gerar o contrato." }, 409) };
  if (texto(clientId) !== texto(proposta.client_id))
    return { resposta: json({ error: "O cliente do contrato não corresponde ao da proposta." }, 409) };
  const existente = await env.DB.prepare(
    `SELECT id FROM todogreen_contracts
      WHERE tenant_id=? AND workspace_owner_id=? AND proposal_id=? AND id<>? AND archived_at IS NULL`,
  ).bind(TENANT_ID, access.ownerId, propostaId, contratoId).first();
  if (existente) return { resposta: json({ error: "Esta proposta já possui contrato ativo." }, 409) };
  return { proposta };
};

const conferirCenarioDaProposta = async (env, access, corpo) => {
  const cenario = await env.DB.prepare(
    `SELECT id,client_id,opportunity_id FROM pricing_scenarios
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(texto(corpo.cenarioId, 120), TENANT_ID, access.ownerId).first();
  if (!cenario) return json({ error: "Simulação não encontrada neste espaço." }, 404);
  if (texto(corpo.clientId, 120) && texto(cenario.client_id, 120) !== texto(corpo.clientId, 120))
    return json({ error: "A simulação pertence a outro cliente ou não está vinculada a este cliente." }, 409);
  if (texto(corpo.oportunidadeId, 120) && texto(cenario.opportunity_id, 120) !== texto(corpo.oportunidadeId, 120))
    return json({ error: "A simulação não corresponde à oportunidade da proposta." }, 409);
  return null;
};

export const criar = async (env, colecao, access, user, corpo, email = "") => {
  const erro = colecao.exigido(corpo);
  if (erro) return json({ error: erro }, 400);

  // A situação jurídica só avança pela linha do tempo, que valida a ação e
  // registra o autor. O CRUD cria apenas rascunhos.
  if (colecao === COLECOES.legal &&
      texto(corpo.situacao || corpo.status, 40) !== "" &&
      texto(corpo.situacao || corpo.status, 40) !== "rascunho")
    return json({ error: "Crie o documento como rascunho e use as ações do Jurídico para mudar a situação." }, 409);

  // O autor do comentário é a sessão, nunca o corpo — assinatura não se
  // escolhe pelo navegador.
  if (colecao === COLECOES.comments || colecao === COLECOES.interactions)
    corpo = { ...corpo, autorEmail: texto(user.email, 200) };
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    const travado = await bloqueioDeCompetencia(env, access, corpo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.proposals) {
    const cenarioInvalido = await conferirCenarioDaProposta(env, access, corpo);
    if (cenarioInvalido) return cenarioInvalido;
    const situacaoInicial = (texto(corpo.situacao, 40) || "draft").toLowerCase();
    const liberacao = await proposalLiberada(env, access, texto(corpo.cenarioId, 120),
      { liberando: STATUS_DE_LIBERACAO.has(situacaoInicial) });
    if (!liberacao.liberada) return json({ error: liberacao.motivo }, 409);
    // Viabilidade operacional (seções 47–50): proposta ligada a uma
    // oportunidade só NASCE liberada (sent/approved/accepted) com snapshot sem
    // faltas. Rascunho segue livre — o gate é na liberação, e é no servidor.
    const oportunidadeDaProposta = texto(corpo.oportunidadeId, 120);
    if (STATUS_DE_LIBERACAO.has(situacaoInicial) && oportunidadeDaProposta) {
      const viab = await viabilidadeDaProposta(env, access, { opportunityId: oportunidadeDaProposta, scenarioId: texto(corpo.cenarioId, 120) });
      if (!viab.liberada) return json({ error: viab.motivo, code: "viability_required", blockers: viab.blockers || [] }, 409);
      corpo = { ...corpo, campos: { ...objeto(corpo.campos), viabilidade: carimboDeViabilidade(viab.snapshot) } };
    }
  }

  if (colecao === COLECOES.contracts) {
    const propostaId = texto(corpo.propostaId, 120);
    const par = await conferirParDoContrato(env, access, { propostaId, clientId: corpo.clientId });
    if (par.resposta) return par.resposta;
    const { proposta } = par;
    // Nasce aprovado/assinado? Só com o Jurídico concluído. Na criação, o
    // contrato ainda não tem id, então amarramos pela proposta.
    if (texto(corpo.aprovacao, 40) === "approved" || texto(corpo.assinatura, 40) === "signed") {
      if (!(await juridicoConcluido(env, access, { proposalId: propostaId })))
        return json({ error: "Este contrato precisa da validação do Jurídico concluída antes de ser aprovado ou assinado." }, 409);
    }
    if (texto(corpo.assinatura, 40) === "signed") {
      if (!(await documentoDeAssinaturaVinculado(env, access, { proposalId: propostaId })))
        return json({ error: "Anexe o contrato assinado ao fluxo jurídico antes de marcar a assinatura como concluída." }, 409);
    }
    corpo = {
      ...corpo,
      cliente: corpo.cliente || proposta.client_name,
      oportunidadeId: corpo.oportunidadeId || proposta.opportunity_id,
      cenarioId: corpo.cenarioId || proposta.scenario_id,
      aprovadoPor: texto(corpo.aprovacao, 40) === "approved" ? user.id : "",
      aprovadoEm: texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "",
    };
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(corpo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  // Oportunidade pode nascer só com nome (lead ainda sem conta). Mas SE apontar
  // um cliente, ele tem de existir neste espaço — senão a oportunidade fica órfã
  // (fora da Conta 360) ou carimba uma conta que não é desta carteira.
  if (colecao === COLECOES.opportunities && texto(corpo.clientId)) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId, texto(corpo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  // Guarda que precisa do BANCO para decidir (linhagem de pastas, dono de
  // pasta privada). Fica no servidor porque um ciclo travaria a leitura
  // recursiva do próprio servidor, e porque dono é regra de acesso.
  if (typeof colecao.guardaDeEscrita === "function") {
    const impedimento = await colecao.guardaDeEscrita(env, { access, email, user, corpo, id: "" });
    if (impedimento) return json({ error: impedimento }, impedimento.status || 409);
  }

  const valores = colecao.colunas(corpo, { email, access, user, novo: true });
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO ${colecao.tabela}
       (id, tenant_id, workspace_owner_id, ${campos.join(", ")},
        revision, created_by, updated_by, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ${campos.map(() => "?").join(", ")}, 1, ?, ?, ?, ?, NULL)`,
  )
    .bind(id, TENANT_ID, access.ownerId, ...campos.map((c) => valores[c]), user.id, user.id, agora, agora)
    .run();

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const registro = colecao.daLinha(row);
  const tipo = nomeDaColecao(colecao);
  if (colecao === COLECOES.opportunities && texto(registro.clientId))
    await aquecerContaPorOportunidade(env, access, user, registro.clientId);
  if (colecao === COLECOES.interactions)
    await carimbarUltimaInteracao(env, access, user, registro);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "created", {}, registro, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "created", resourceType: tipo, resourceId: id,
    clientId: registro.clientId, after: registro,
  });
  return json({ registro }, 201);
};

export const atualizar = async (env, colecao, access, user, id, corpo, email = "") => {
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  // 404 e não 403: dizer "existe, mas não é seu" já entrega que existe. Vale
  // tanto para registro de outro espaço quanto para cliente fora da carteira.
  if (!atual) return json({ error: "Registro não encontrado." }, 404);
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);

  // A revisão vem de quem edita, não do banco. Se viesse do banco, o UPDATE
  // sempre casaria e a trava de concorrência não travaria nada — que é o
  // mesmo comportamento do JSON único que esta tabela veio substituir.
  const revisaoEsperada = Number(corpo.revision);
  if (!Number.isFinite(revisaoEsperada) || revisaoEsperada <= 0)
    return json({ error: "Informe a revisão do registro que você leu." }, 400);

  const proximo = { ...colecao.daLinha(atual), ...corpo };
  if (colecao === COLECOES.legal &&
      ((Object.hasOwn(corpo, "situacao") && texto(corpo.situacao, 40) !== texto(atual.status, 40)) ||
       (Object.hasOwn(corpo, "status") && texto(corpo.status, 40) !== texto(atual.status, 40))))
    return json({ error: "Use as ações do Jurídico para mudar a situação do documento." }, 409);
  // Editar um comentário não troca a assinatura: o autor original permanece.
  if (colecao === COLECOES.comments || colecao === COLECOES.interactions)
    proximo.autorEmail = atual.author_email || "";
  if (colecao === COLECOES.contracts && texto(corpo.aprovacao, 40)) {
    proximo.aprovadoPor = texto(corpo.aprovacao, 40) === "approved" ? user.id : "";
    proximo.aprovadoEm = texto(corpo.aprovacao, 40) === "approved" ? new Date().toISOString() : "";
  }
  if (colecao === COLECOES.contracts) {
    const propostaNova = texto(proximo.propostaId, 120);
    const trocaOPar = propostaNova !== texto(atual.proposal_id, 120)
      || texto(proximo.clientId, 120) !== texto(atual.client_id, 120);
    if (trocaOPar) {
      const par = await conferirParDoContrato(env, access, { propostaId: propostaNova, clientId: proximo.clientId, contratoId: id });
      if (par.resposta) return par.resposta;
      if (propostaNova !== texto(atual.proposal_id, 120)) {
        proximo.oportunidadeId = corpo.oportunidadeId || par.proposta.opportunity_id;
        proximo.cenarioId = corpo.cenarioId || par.proposta.scenario_id;
      }
    }
    // Gate do Jurídico só na TRANSIÇÃO para approved/signed (não a cada PATCH
    // posterior de um contrato que já está nesse estado).
    const vaiAprovar = texto(proximo.aprovacao, 40) === "approved" && texto(atual.approval_status, 40) !== "approved";
    const vaiAssinar = texto(proximo.assinatura, 40) === "signed" && texto(atual.signature_status, 40) !== "signed";
    if (vaiAprovar || vaiAssinar) {
      const ok = await juridicoConcluido(env, access, {
        contractId: id,
        proposalId: texto(atual.proposal_id, 120),
      });
      if (!ok)
        return json({ error: "Este contrato precisa da validação do Jurídico concluída antes de ser aprovado ou assinado." }, 409);
    }
    if (vaiAssinar) {
      const temDoc = await documentoDeAssinaturaVinculado(env, access, {
        contractId: id,
        proposalId: texto(atual.proposal_id, 120),
      });
      if (!temDoc)
        return json({ error: "Anexe o contrato assinado ao fluxo jurídico antes de marcar a assinatura como concluída." }, 409);
    }
  }
  if (colecao === COLECOES.proposals) {
    const cenarioInvalido = await conferirCenarioDaProposta(env, access, proximo);
    if (cenarioInvalido) return cenarioInvalido;
    // Os gates só valem na TRANSIÇÃO para liberada (não a cada PATCH de uma
    // proposta que já está liberada) — a mesma disciplina do gate jurídico.
    const situacaoNova = texto(proximo.situacao, 40).toLowerCase();
    const situacaoAtual = texto(atual.status, 40).toLowerCase();
    const entrandoEmLiberacao = STATUS_DE_LIBERACAO.has(situacaoNova) && !STATUS_DE_LIBERACAO.has(situacaoAtual);
    // Gate do Deal Desk: a proposta de um cenário com pedido de alçada
    // pendente/recusado não pode SAIR. No criar isto já era conferido; sem esta
    // checagem, um PATCH rascunho→enviada contornava a alçada no servidor.
    if (entrandoEmLiberacao) {
      const liberacao = await proposalLiberada(env, access, texto(proximo.cenarioId, 120));
      if (!liberacao.liberada) return json({ error: liberacao.motivo }, 409);
    }
    // Gate de viabilidade (seções 47–50): exige snapshot sem faltas quando a
    // proposta está ligada a uma oportunidade.
    const oportunidadeDaProposta = texto(proximo.oportunidadeId, 120);
    if (entrandoEmLiberacao && oportunidadeDaProposta) {
      const viab = await viabilidadeDaProposta(env, access, { opportunityId: oportunidadeDaProposta, scenarioId: texto(proximo.cenarioId, 120) });
      if (!viab.liberada) return json({ error: viab.motivo, code: "viability_required", blockers: viab.blockers || [] }, 409);
      proximo.campos = { ...objeto(proximo.campos), viabilidade: carimboDeViabilidade(viab.snapshot) };
    }
  }
  const erro = colecao.exigido(proximo);
  if (erro) return json({ error: erro }, 400);
  if (colecao === COLECOES.financial) {
    const erroFinanceiro = validarFinanceiro(corpo, atual);
    if (erroFinanceiro) return json({ error: erroFinanceiro }, 400);
    // As duas competências: de onde sai e para onde vai.
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual), proximo);
    if (travado) return json({ error: travado }, 409);
  }

  if (colecao === COLECOES.operations) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ?
          AND archived_at IS NULL AND status = 'ativo'`,
    ).bind(TENANT_ID, access.ownerId, texto(proximo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  // Mesma regra do criar: se a oportunidade apontar um cliente, ele tem de
  // existir neste espaço (não deixa a edição amarrar a conta a um id órfão).
  if (colecao === COLECOES.opportunities && texto(proximo.clientId)) {
    const cliente = await env.DB.prepare(
      `SELECT id FROM todogreen_clients
        WHERE tenant_id = ? AND workspace_owner_id = ? AND id = ? AND archived_at IS NULL`,
    ).bind(TENANT_ID, access.ownerId, texto(proximo.clientId, 120)).first();
    if (!cliente) return json({ error: "Cliente não encontrado neste espaço." }, 404);
  }

  if (typeof colecao.guardaDeEscrita === "function") {
    const impedimento = await colecao.guardaDeEscrita(env, { access, email, user, corpo: proximo, id });
    if (impedimento) return json({ error: impedimento }, 409);
  }

  const valores = colecao.colunas(proximo, { email, access, user, novo: false });
  const campos = Object.keys(valores);
  const agora = new Date().toISOString();

  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET ${campos.map((c) => `${c} = ?`).join(", ")},
            revision = revision + 1${colecao === COLECOES.contracts ? ", version = version + 1" : ""},
            updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND revision = ?`,
  )
    .bind(...campos.map((c) => valores[c]), user.id, agora, id, TENANT_ID, access.ownerId, revisaoEsperada)
    .run();

  // Alguém salvou entre a leitura e a escrita. Sobrescrever aqui seria repetir
  // o defeito do JSON único, que é justamente o motivo desta tabela existir.
  if (!meta?.changes)
    return json(
      { error: "Este registro mudou enquanto você editava. Recarregue para ver a versão atual." },
      409,
    );

  const row = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela} WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ?`,
  )
    .bind(id, TENANT_ID, access.ownerId)
    .first();
  const antes = colecao.daLinha(atual);
  const depois = colecao.daLinha(row);
  if (colecao === COLECOES.opportunities && deveCriarHandoff(atual.stage, row.stage)) {
    await criarHandoffOperacional(env, access, user, depois);
    // Além do card no Planner, abre a implantação que a tela Implantação lê —
    // é o elo que faltava para o fluxo comercial → operação fechar de verdade.
    await criarImplantacaoDeGanho(env, access, user, depois);
  }
  if (colecao === COLECOES.opportunities && !texto(antes.clientId) && texto(depois.clientId))
    await aquecerContaPorOportunidade(env, access, user, depois.clientId);
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "updated", antes, depois, texto(corpo.nota, 1000));
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "updated", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: depois.clientId, before: antes, after: depois,
  });
  return json({ registro: depois });
};

export const arquivar = async (env, colecao, access, user, id) => {
  if (!(await noAlcanceDaCarteira(env, colecao, access, user.email, id)))
    return json({ error: "Registro não encontrado." }, 404);
  const atual = await env.DB.prepare(
    `SELECT * FROM ${colecao.tabela}
      WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, access.ownerId).first();

  // Arquivar um lançamento de mês fechado mudaria um resultado já publicado.
  if (colecao === COLECOES.financial && atual) {
    const travado = await bloqueioDeCompetencia(env, access, colecao.daLinha(atual));
    if (travado) return json({ error: travado }, 409);
  }

  const agora = new Date().toISOString();
  // Arquiva em vez de apagar: o histórico é a única defesa quando alguém
  // pergunta, meses depois, de onde veio um número.
  const { meta } = await env.DB.prepare(
    `UPDATE ${colecao.tabela}
        SET archived_at = ?, updated_by = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  )
    .bind(agora, user.id, agora, id, TENANT_ID, access.ownerId)
    .run();
  if (!meta?.changes) return json({ error: "Registro não encontrado." }, 404);
  const antes = atual ? colecao.daLinha(atual) : {};
  if (colecao === COLECOES.contracts)
    await registrarEventoContrato(env, access, user, id, "archived", antes, {}, "Contrato arquivado.");
  await registrarAuditoriaTodoGreen(env, {
    access, user, action: "archived", resourceType: nomeDaColecao(colecao), resourceId: id,
    clientId: antes.clientId, before: antes,
  });
  return json({ ok: true });
};
