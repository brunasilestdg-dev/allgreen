// ===== Registros da vertical: ledger de eventos operacionais =====
//
// Contrato: `aplicarEventoOperacional(env, { ownerId, operacao, userId, corpo,
// origem, medicaoConfiavel })` aplica UM fato (chegada, coleta, entrega,
// ocorrência...) à operação canônica num único `DB.batch` — evento imutável,
// carimbos da operação, projeção na rota, POD, conclusão da OS e fila de
// faturamento — e devolve dados ({ evento, tipo, titulo, descricao, atualizada }
// ou { erro }), nunca Response. `aplicarEventoNaOperacaoPorId` carrega a
// operação pelo id e devolve { aplicado, motivo | resultado }.
// Autorização: NENHUMA aqui — quem chama já validou o alcance (carteira
// interna, vínculo do motorista, chave do TMS). O escopo é o `ownerId` que o
// chamador passa. Reenvio com a mesma `idempotencyKey` devolve o que já entrou.

import { TENANT_ID } from "../todogreen-access.js";
import { notificarPortalDoCliente } from "../todogreen-notify.js";
import { efeitosDoEvento, medicaoDoEvento, normalizarTipoEvento } from "../../../src/features/logistics/operationTrackingDomain.js";
import { concluirParadasDaOperacao, statusPelaConclusao } from "../../../src/features/logistics/routePlanDomain.js";
// POD do motorista (#120b): a foto/assinatura chega como data URL reduzido e é
// guardada no cofre; a URL de download entra no comprovante da entrega.
import { armazenarImagemBase64, descartarArquivos } from "../todogreen-file-store.js";
import { refDeArquivoAceita } from "../../../src/features/logistics/documentVaultDomain.js";
import { parse, texto } from "./util.js";

// O núcleo do evento operacional, compartilhado entre a tela interna e o
// portal do motorista: são o MESMO fato (a carga chegou, a entrega aconteceu,
// houve ocorrência) — duas implementações produziriam dois delivered_at e
// dois PODs diferentes. Quem chama já validou o alcance (carteira interna ou
// vínculo do motorista); aqui só se aplica.
// Devolve, no formato que aplicarEventoOperacional retorna, o evento já gravado
// com esta chave de idempotência — ou null se não existe. É como um reenvio da
// fila offline recebe de volta o que já foi registrado, sem duplicar.
const eventoPelaChave = async (env, ownerId, operationId, idempotencyKey) => {
  const linha = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operation_events
      WHERE tenant_id = ? AND workspace_owner_id = ? AND operation_id = ? AND idempotency_key = ?`,
  ).bind(TENANT_ID, ownerId, operationId, idempotencyKey).first();
  if (!linha) return null;
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(operationId, TENANT_ID, ownerId).first();
  return {
    evento: {
      id: linha.id, tipo: linha.kind, titulo: linha.titulo, descricao: linha.descricao,
      local: linha.local, ocorridoEm: linha.ocorrido_em, registradoPor: linha.registrado_por, criadoEm: linha.created_at,
      distanciaKm: linha.distance_km, distanciaOrigem: linha.distance_source,
      energiaKwh: linha.energy_kwh, energiaOrigem: linha.energy_source,
    },
    tipo: linha.kind, titulo: linha.titulo, descricao: linha.descricao, atualizada, duplicada: true,
  };
};

// A rota é uma projeção do ledger operacional, nunca uma segunda verdade.
// Coleta/entrega avançam as paradas ligadas à operação no mesmo batch do
// evento. Ao concluir a última parada, os recursos voltam a ficar disponíveis.
const instrucoesDaProjecaoNaRota = async (env, { ownerId, operacao, tipo, userId, agora }) => {
  const routeId = texto(operacao.route_id, 120);
  if (!routeId || !["coleta", "entrega"].includes(tipo)) return [];
  const rota = await env.DB.prepare(
    `SELECT * FROM todogreen_routes
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(routeId, TENANT_ID, ownerId).first();
  if (!rota) return [];
  const paradas = parse(rota.stops_json, []);
  if (!Array.isArray(paradas)) return [];
  const atualizadas = concluirParadasDaOperacao(paradas, operacao.id, tipo);
  if (JSON.stringify(atualizadas) === JSON.stringify(paradas)) return [];
  const status = statusPelaConclusao(atualizadas);
  const instrucoes = [env.DB.prepare(
    `UPDATE todogreen_routes
        SET stops_json = ?, status = ?, revision = revision + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(JSON.stringify(atualizadas), status, userId, agora, routeId, TENANT_ID, ownerId)];
  if (status === "concluida") {
    instrucoes.push(env.DB.prepare(
      `UPDATE todogreen_drivers
          SET availability_status = 'available', revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND availability_status = 'allocated'`,
    ).bind(userId, agora, rota.driver_id, TENANT_ID, ownerId));
    instrucoes.push(env.DB.prepare(
      `UPDATE todogreen_fleet_vehicles
          SET status = 'available', revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND plate = ? AND status = 'in-operation'
          AND archived_at IS NULL`,
    ).bind(userId, agora, TENANT_ID, ownerId, rota.vehicle_plate));
  }
  return instrucoes;
};

export const aplicarEventoOperacional = async (env, { ownerId, operacao, userId, corpo, origem = "", medicaoConfiavel = true }) => {
  // Tipo e efeitos vêm do contrato único (operationTrackingDomain), não mais de
  // um Set copiado aqui. É a mesma verdade que a projeção do TMS lê.
  const tipo = normalizarTipoEvento(corpo.tipo);
  const efeitos = efeitosDoEvento(tipo);
  const titulo = texto(corpo.titulo, 200);
  const descricao = texto(corpo.descricao, 3000);
  if (!titulo && !descricao) return { erro: "Informe o título ou a descrição do evento." };
  const operationId = operacao.id;
  // Idempotência (#132): a fila offline do motorista reenvia com uma chave
  // estável por gesto. Se essa chave já entrou nesta operação, devolvemos o
  // evento que já existe — sem gravar de novo, sem POD duplicado, sem notificar
  // o cliente outra vez. O índice único (0094) fecha a corrida de dois reenvios.
  const idempotencyKey = texto(corpo.idempotencyKey, 100) || null;
  if (idempotencyKey) {
    const repetido = await eventoPelaChave(env, ownerId, operationId, idempotencyKey);
    if (repetido) return repetido;
  }
  const ocorridoEm = texto(corpo.ocorridoEm, 40) || new Date().toISOString();
  const agora = new Date().toISOString();
  const eventoId = crypto.randomUUID();
  const atualizacaoIncidente = efeitos.contaOcorrencia ? ", incident_count = incident_count + 1" : "";
  // O evento "entrega" é o fato que fecha o ciclo: carimba delivered_at,
  // guarda o comprovante que o portal do cliente baixa e registra o POD que a
  // régua de faturamento exige (trigger da 0062). Antes, o evento era só uma
  // linha na timeline — a operação nunca "entregava" e a OS nunca faturava.
  const recebedor = efeitos.concluiEntrega ? texto(corpo.recebedor, 200) : "";
  // Comprovante e assinatura da entrega: ou já vêm como URL (retrocompatível:
  // link colado, upload prévio), ou vêm como data URL de imagem capturada no
  // celular (câmera do canhoto, assinatura na tela — #120b). Nesse caso a imagem
  // é guardada no cofre AQUI e vira a URL de download. Só na entrega.
  let comprovanteUrl = efeitos.concluiEntrega ? texto(corpo.comprovanteUrl, 800) : "";
  let comprovanteHash = efeitos.concluiEntrega ? texto(corpo.comprovanteHash, 200) : "";
  let assinaturaUrl = efeitos.concluiEntrega ? texto(corpo.assinaturaUrl, 800) : "";
  let assinaturaHash = efeitos.concluiEntrega ? texto(corpo.assinaturaHash, 200) : "";
  if (efeitos.concluiEntrega) {
    const okComprovante = refDeArquivoAceita(comprovanteUrl);
    if (!okComprovante.ok) return { erro: okComprovante.motivo };
    const okAssinatura = refDeArquivoAceita(assinaturaUrl);
    if (!okAssinatura.ok) return { erro: okAssinatura.motivo };
  }
  // Entrega sem prova não encerra execução. O mesmo gate vale para a tela
  // interna, Portal do Motorista, Portal TMS, API e integrações: mudar a porta
  // de entrada não pode mudar a regra de negócio.
  if (efeitos.concluiEntrega && !recebedor && !comprovanteUrl && !corpo.comprovanteBase64
      && !assinaturaUrl && !corpo.assinaturaBase64)
    return { erro: "Informe quem recebeu ou anexe o comprovante/assinatura da entrega." };
  // Ids das imagens guardadas no cofre — para limpar se o evento não entrar.
  const arquivosGuardados = [];
  if (efeitos.concluiEntrega) {
    try {
      if (!comprovanteUrl && corpo.comprovanteBase64) {
        const g = await armazenarImagemBase64(env, {
          ownerId, clientId: operacao.client_id, contextId: operationId,
          dataUrl: corpo.comprovanteBase64, createdBy: userId, prefixoNome: "comprovante",
        });
        comprovanteUrl = g.url; comprovanteHash = g.hash; arquivosGuardados.push(g.id);
      }
      if (!assinaturaUrl && corpo.assinaturaBase64) {
        const g = await armazenarImagemBase64(env, {
          ownerId, clientId: operacao.client_id, contextId: operationId,
          dataUrl: corpo.assinaturaBase64, createdBy: userId, prefixoNome: "assinatura",
        });
        assinaturaUrl = g.url; assinaturaHash = g.hash; arquivosGuardados.push(g.id);
      }
    } catch (erroImagem) {
      // Imagem inválida ou grande demais: recusa clara (vira 400 no chamador),
      // não grava a entrega pela metade. O front sempre reduz e valida a imagem
      // antes de mandar — isto é a defesa do servidor.
      return { erro: erroImagem?.message || "Comprovante inválido." };
    }
  }
  const atualizacaoEntrega = efeitos.concluiEntrega
    ? `, status = 'concluida', delivered_at = COALESCE(delivered_at, ?)${comprovanteUrl ? ", proof_url = ?, proof_hash = ?" : ""}${assinaturaUrl ? ", signature_url = ?, signature_hash = ?" : ""}`
    : "";
  const paramsEntrega = efeitos.concluiEntrega
    ? [ocorridoEm, ...(comprovanteUrl ? [comprovanteUrl, comprovanteHash] : []), ...(assinaturaUrl ? [assinaturaUrl, assinaturaHash] : [])]
    : [];
  // Posição do motorista → rastreio ao vivo. Todo evento de rua (chegada,
  // coleta, entrega, ocorrência) já manda lat/lng; até aqui só a entrega usava
  // (no POD) e o resto era descartado. Agora QUALQUER evento com coordenada
  // carimba last_position na operação — o mesmo campo que o portal do cliente e
  // a torre de controle já desenham no mapa. De graça, do que o motorista já faz.
  const latEvento = Number(corpo.latitude);
  const lngEvento = Number(corpo.longitude);
  const temPosicao = Number.isFinite(latEvento) && Number.isFinite(lngEvento);
  // Trava anti-regressão: um evento gravado offline (chegada às 10h) que só
  // sincroniza DEPOIS de uma entrega às 11h não pode jogar a posição viva de
  // volta para as 10h. Cada coluna só avança quando o horário do evento é
  // igual ou mais novo que o carimbo atual (a mesma proteção que delivered_at
  // já tem com COALESCE). O WHEN enxerga o valor ANTERIOR de last_position_at,
  // então as três colunas usam a mesma guarda de forma consistente.
  const guardaPosicao = "last_position_at IS NULL OR last_position_at <= ?";
  const atualizacaoPosicao = temPosicao
    ? `, last_position_lat = CASE WHEN ${guardaPosicao} THEN ? ELSE last_position_lat END`
      + `, last_position_lng = CASE WHEN ${guardaPosicao} THEN ? ELSE last_position_lng END`
      + `, last_position_at = CASE WHEN ${guardaPosicao} THEN ? ELSE last_position_at END`
    : "";
  const paramsPosicao = temPosicao
    ? [ocorridoEm, latEvento, ocorridoEm, lngEvento, ocorridoEm, ocorridoEm]
    : [];
  // Medição (km/energia) como fato do evento (N.2). É gravada SEMPRE que vier
  // (colunas do evento), e REFLETIDA na operação com a mesma guarda anti-regressão
  // do last_position: só preenche quando a operação ainda não tem o dado — a
  // distância (NOT NULL DEFAULT 0) reflete quando é 0; a energia (nullable)
  // quando é NULL. Nunca soma, então o SUM(distance_km) da frota não dobra.
  // Medida vinda de porta não confiável (portal do motorista) entra como
  // "presumido", nunca "medido": o aparelho do motorista não é medidor.
  const medicao = medicaoDoEvento(corpo, medicaoConfiavel ? {} : { forcarOrigem: "presumido" });
  const refleteDistancia = medicao?.distanciaKm != null;
  const refleteEnergia = medicao?.energiaKwh != null;
  let atualizacaoMedicao = "";
  const paramsMedicao = [];
  if (refleteDistancia) {
    atualizacaoMedicao += ", distance_km = CASE WHEN (distance_km IS NULL OR distance_km = 0) THEN ? ELSE distance_km END"
      + ", distance_km_quality = CASE WHEN (distance_km IS NULL OR distance_km = 0) THEN ? ELSE distance_km_quality END";
    paramsMedicao.push(medicao.distanciaKm, medicao.distanciaOrigem);
  }
  if (refleteEnergia) {
    atualizacaoMedicao += ", energy_kwh = CASE WHEN energy_kwh IS NULL THEN ? ELSE energy_kwh END"
      + ", energy_kwh_quality = CASE WHEN energy_kwh IS NULL THEN ? ELSE energy_kwh_quality END";
    paramsMedicao.push(medicao.energiaKwh, medicao.energiaOrigem);
  }
  const instrucoesRota = await instrucoesDaProjecaoNaRota(env, {
    ownerId, operacao, tipo, userId, agora,
  });
  const instrucoes = [
    env.DB.prepare(
      `INSERT INTO todogreen_client_operation_events
         (id,tenant_id,operation_id,client_id,workspace_owner_id,kind,titulo,descricao,local,
          ocorrido_em,registrado_por,created_at,idempotency_key,distance_km,distance_source,energy_kwh,energy_source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      eventoId, TENANT_ID, operationId, operacao.client_id, ownerId, tipo, titulo,
      descricao, texto(corpo.local, 300), ocorridoEm, userId, agora, idempotencyKey,
      medicao?.distanciaKm ?? null, medicao?.distanciaOrigem ?? null,
      medicao?.energiaKwh ?? null, medicao?.energiaOrigem ?? null,
    ),
    env.DB.prepare(
      `UPDATE todogreen_client_operations
          SET updated_at=?, updated_by=?, revision=revision+1${atualizacaoIncidente}${atualizacaoEntrega}${atualizacaoPosicao}${atualizacaoMedicao}
        WHERE id=? AND tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL`,
    ).bind(agora, userId, ...paramsEntrega, ...paramsPosicao, ...paramsMedicao, operationId, TENANT_ID, ownerId),
    ...instrucoesRota,
  ];
  if (efeitos.concluiEntrega) {
    // POD para toda OS amarrada a esta operação. INSERT direto com subselect:
    // se não houver OS vinculada, nada acontece; se houver, o gate de
    // faturamento passa a enxergar o comprovante.
    const latitude = Number(corpo.latitude);
    const longitude = Number(corpo.longitude);
    instrucoes.push(env.DB.prepare(
      `INSERT INTO todogreen_proofs_of_delivery
         (id, tenant_id, workspace_owner_id, service_order_id, kind, occurred_at,
          recipient_name, document_url, document_hash, latitude, longitude,
          signature_url, signature_hash, fields_json, created_by, created_at)
       SELECT lower(hex(randomblob(16))), os.tenant_id, os.workspace_owner_id, os.id, 'delivery', ?,
              ?, ?, ?, ?, ?, ?, ?, json_object('operationId', ?, 'eventId', ?), ?, ?
         FROM todogreen_service_orders os
        WHERE os.tenant_id = ? AND os.workspace_owner_id = ? AND os.operation_id = ?
          AND os.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM todogreen_proofs_of_delivery p
             WHERE p.tenant_id = os.tenant_id AND p.workspace_owner_id = os.workspace_owner_id
               AND p.service_order_id = os.id
          )`,
    ).bind(
      ocorridoEm, recebedor, comprovanteUrl, comprovanteHash,
      Number.isFinite(latitude) ? latitude : null, Number.isFinite(longitude) ? longitude : null,
      assinaturaUrl || null, assinaturaHash || null,
      operationId, eventoId, userId, agora,
      TENANT_ID, ownerId, operationId,
    ));
    // A entrega com POD é a autoridade da execução. Ela conclui toda OS
    // vinculada e libera a fila de faturamento no MESMO batch. Assim não há
    // mais o passo manual "motorista entregou, alguém conclui a OS" nem
    // comportamentos diferentes entre Portal do Motorista e Portal TMS.
    instrucoes.push(env.DB.prepare(
      `UPDATE todogreen_service_orders
          SET status = 'completed', completed_at = COALESCE(completed_at, ?),
              revision = revision + 1, updated_by = ?, updated_at = ?
        WHERE tenant_id = ? AND workspace_owner_id = ? AND operation_id = ?
          AND archived_at IS NULL AND status NOT IN ('completed','cancelled')`,
    ).bind(ocorridoEm, userId, agora, TENANT_ID, ownerId, operationId));
    instrucoes.push(env.DB.prepare(
      `INSERT OR IGNORE INTO todogreen_billing_items
         (id,tenant_id,workspace_owner_id,service_order_id,client_id,contract_id,status,amount,
          competence_date,created_by,updated_by,created_at,updated_at)
       SELECT lower(hex(randomblob(16))), os.tenant_id, os.workspace_owner_id, os.id,
              os.client_id, os.contract_id, 'eligible', os.net_amount, ?, ?, ?, ?, ?
         FROM todogreen_service_orders os
        WHERE os.tenant_id = ? AND os.workspace_owner_id = ? AND os.operation_id = ?
          AND os.archived_at IS NULL AND os.status = 'completed'`,
    ).bind(ocorridoEm.slice(0, 10), userId, userId, agora, agora, TENANT_ID, ownerId, operationId));
  }
  try {
    await env.DB.batch(instrucoes);
  } catch (erro) {
    // O evento não entrou: as imagens guardadas antes dele ficariam órfãs no
    // cofre (sem proof_url/signature_url apontando para elas). Limpa-as. Vale
    // tanto para a corrida do idempotente quanto para qualquer falha do batch.
    if (arquivosGuardados.length) await descartarArquivos(env, ownerId, arquivosGuardados).catch(() => {});
    // Corrida: dois reenvios com a mesma chave chegaram juntos e o outro gravou
    // primeiro. O índice único (0094) barra o segundo — aqui devolvemos o que já
    // ficou, em vez de estourar um erro numa entrega que na verdade foi gravada.
    if (idempotencyKey) {
      const repetido = await eventoPelaChave(env, ownerId, operationId, idempotencyKey);
      if (repetido) return repetido;
    }
    throw erro;
  }
  const atualizada = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id=? AND tenant_id=? AND workspace_owner_id=?`,
  ).bind(operationId, TENANT_ID, ownerId).first();
  const evento = {
    id: eventoId, tipo, titulo, descricao, local: texto(corpo.local, 300), ocorridoEm, registradoPor: userId, criadoEm: agora,
    distanciaKm: medicao?.distanciaKm ?? null, distanciaOrigem: medicao?.distanciaOrigem ?? null,
    energiaKwh: medicao?.energiaKwh ?? null, energiaOrigem: medicao?.energiaOrigem ?? null,
  };
  // Entrega e ocorrência são os dois eventos que o embarcador quer saber na
  // hora — os demais ele acompanha pela linha do tempo quando quiser.
  if (efeitos.concluiEntrega || efeitos.contaOcorrencia) {
    await notificarPortalDoCliente(env, operacao.client_id, {
      assunto: efeitos.concluiEntrega
        ? `Entrega concluída — ${operacao.reference || "operação"}`
        : `Ocorrência registrada — ${operacao.reference || "operação"}`,
      titulo: efeitos.concluiEntrega ? "Sua carga foi entregue" : "Registramos uma ocorrência",
      corpo: `${operacao.reference || "A operação"}: ${titulo || descricao || tipo}. Detalhes e comprovante na linha do tempo do portal.`,
      origem,
    });
  }
  return { evento, tipo, titulo, descricao, atualizada };
};

// Ponte de ingest → ledger (N.4): carrega a operação pelo id e aplica o evento
// pelo caminho canônico. É a generalização do que o webhook do TMS já fazia à
// mão — toda porta externa (webhook, projeção, API) converge para cá, para o
// efeito de um fato nunca depender da porta. NÃO decide efeito (isso é do
// contrato único) e NÃO devolve Response: devolve dados, para o chamador
// (interno ou externo) formatar a resposta como precisar. Operação inexistente
// ou arquivada não é erro — devolve { aplicado: false, motivo }.
export const aplicarEventoNaOperacaoPorId = async (env, { ownerId, userId, operationId, corpo, origem = "" }) => {
  const id = texto(operationId, 120);
  if (!id) return { aplicado: false, motivo: "operação não informada" };
  const operacao = await env.DB.prepare(
    `SELECT * FROM todogreen_client_operations
      WHERE id = ? AND tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
  ).bind(id, TENANT_ID, ownerId).first();
  if (!operacao) return { aplicado: false, motivo: "operação inexistente neste espaço" };
  const resultado = await aplicarEventoOperacional(env, { ownerId, operacao, userId, corpo, origem });
  if (resultado?.erro) return { aplicado: false, motivo: resultado.erro };
  return { aplicado: true, operationId: id, resultado };
};
