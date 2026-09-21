// Endpoint do Painel Comercial: lê os fatos reais do workspace e devolve as três
// abas já calculadas. Toda a matemática vive no domínio puro
// (src/features/logistics/commercialPanelDomain.js); aqui só há leitura escopada
// e normalização de coluna crua -> forma limpa.
//
// Fontes:
//   Receita     -> todogreen_financial_entries (kind='revenue')  [faturamento Track3R]
//   Operacional -> todogreen_tms_documents      (encomendas/ocorrências)
//   Kanban      -> todogreen_opportunities       (pipeline nativo; Monday depois)
import { TENANT_ID, podeNaVertical, podeVerTodaCarteira, recorteDeCarteira } from "./todogreen-access.js";
import { montarPainelDoArtefato, montarPainelCanonicoMirror, montarKanbanDeOportunidades } from "../../src/features/logistics/commercialPanelDomain.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

// Ver o painel exige uma permissão de leitura comercial/financeira/auditoria —
// a mesma lógica de vínculo do resto da vertical, nunca rótulo de tela.
const PERMISSOES_PAINEL = ["crm:manage", "clients:manage", "revenue:manage", "finance:manage", "audit:read"];
const podeVerPainel = (access) => PERMISSOES_PAINEL.some((p) => podeNaVertical(access, p));

const texto = (v) => String(v ?? "").trim();

export async function handleTodoGreenCommercialPanel(request, env, access, user) {
  if (request.method !== "GET") return json({ error: "Método não permitido." }, 405);
  if (!env?.DB) return json({ error: "Banco indisponível." }, 503);
  if (!podeVerPainel(access)) {
    return json({ error: "Seu papel não tem acesso ao painel comercial." }, 403);
  }

  const ownerId = String(access?.ownerId || "");
  const email = String(access?.email || user?.email || "").toLowerCase();
  const verTudo = podeVerTodaCarteira(access);

  // Vendedor sem visão de carteira só enxerga o próprio pipeline. Receita e
  // operacional do Track3R não trazem vínculo de vendedor por encomenda, então
  // para esse papel ficam de fora (em vez de vazar a carteira inteira).
  const recorteOportunidades = verTudo ? { sql: "", params: [] } : recorteDeCarteira(access, email, "t", "client_id");

  // Drawer de interações do painel: ?opportunityId=X devolve SÓ as interações
  // daquela oportunidade, com o MESMO escopo do contador do card (tenant +
  // opportunity_id) — por isso bate com o "💬 N", ao contrário da lista geral
  // do front, que é recortada por carteira e deixava de fora as importadas sem
  // client_id. Confirma antes que a oportunidade é visível para quem pede.
  const opParaInteracoes = texto(new URL(request.url).searchParams.get("opportunityId"));
  if (opParaInteracoes) {
    const dona = await env.DB.prepare(
      `SELECT t.id FROM todogreen_opportunities t
        WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.id = ? AND t.archived_at IS NULL
          ${recorteOportunidades.sql}`,
    ).bind(TENANT_ID, ownerId, opParaInteracoes, ...recorteOportunidades.params).first();
    if (!dona) return json({ error: "Oportunidade não encontrada." }, 404);
    const { results } = await env.DB.prepare(
      `SELECT id, kind, subject, notes, participants, outcome, next_step,
              occurred_at, next_step_at, author_email
         FROM todogreen_crm_interactions
        WHERE tenant_id = ? AND opportunity_id = ? AND archived_at IS NULL
        ORDER BY occurred_at DESC, created_at DESC`,
    ).bind(TENANT_ID, opParaInteracoes).all();
    return json({
      interacoes: (results || []).map((r) => ({
        id: texto(r.id),
        tipo: texto(r.kind) || "reuniao",
        assunto: texto(r.subject),
        ata: texto(r.notes),
        participantes: texto(r.participants),
        resultado: texto(r.outcome),
        proximoPasso: texto(r.next_step),
        ocorridaEm: texto(r.occurred_at),
        proximoPassoEm: texto(r.next_step_at),
        autorEmail: texto(r.author_email),
      })),
    });
  }

  const lerFaturas = async () => {
    if (!verTudo) return [];
    const { results } = await env.DB.prepare(
      `SELECT amount, competence_date, reference_month, counterparty
         FROM todogreen_financial_entries
        WHERE tenant_id = ? AND workspace_owner_id = ? AND kind = 'revenue' AND archived_at IS NULL`,
    ).bind(TENANT_ID, ownerId).all();
    return (results || []).map((r) => ({
      valor: Number(r.amount) || 0,
      data: texto(r.competence_date) || texto(r.reference_month),
      mes: texto(r.reference_month),
      tomador: texto(r.counterparty),
    }));
  };

  const lerEncomendas = async () => {
    if (!verTudo) return [];
    const { results } = await env.DB.prepare(
      `SELECT order_ref, external_id, kind, status, occurrence, occurrence_code,
              promised_at, occurred_at, origin_unit, current_unit, shipper_name, shipper_group
         FROM todogreen_tms_documents
        WHERE tenant_id = ? AND workspace_owner_id = ? AND archived_at IS NULL`,
    ).bind(TENANT_ID, ownerId).all();
    return (results || []).map((r) => ({
      orderRef: texto(r.order_ref) || texto(r.external_id),
      externalId: texto(r.external_id),
      kind: texto(r.kind),
      status: texto(r.status),
      occurrence: texto(r.occurrence),
      occurrenceCode: texto(r.occurrence_code),
      promisedAt: texto(r.promised_at),
      occurredAt: texto(r.occurred_at),
      originUnit: texto(r.origin_unit),
      currentUnit: texto(r.current_unit),
      cliente: texto(r.shipper_name) || texto(r.shipper_group),
    }));
  };

  const lerOportunidades = async () => {
    const { results } = await env.DB.prepare(
      `SELECT t.id, t.stage, t.monthly_value, t.contract_value, t.client_name, t.title,
              t.owner_user_id, t.last_interaction_at, t.updated_at, t.fields_json,
              (SELECT COUNT(*) FROM todogreen_crm_interactions i
                WHERE i.tenant_id = t.tenant_id AND i.opportunity_id = t.id AND i.archived_at IS NULL) AS interacoes,
              (SELECT MAX(i2.occurred_at) FROM todogreen_crm_interactions i2
                WHERE i2.tenant_id = t.tenant_id AND i2.opportunity_id = t.id AND i2.archived_at IS NULL) AS ultima_interacao_em
         FROM todogreen_opportunities t
        WHERE t.tenant_id = ? AND t.workspace_owner_id = ? AND t.archived_at IS NULL
          ${recorteOportunidades.sql}`,
    ).bind(TENANT_ID, ownerId, ...recorteOportunidades.params).all();
    const parse = (v, fb) => { try { return JSON.parse(v || ""); } catch { return fb; } };
    return (results || []).map((r) => ({
      id: texto(r.id),
      estagio: texto(r.stage),
      valorMensal: Number(r.monthly_value) || 0,
      valorContrato: Number(r.contract_value) || 0,
      cliente: texto(r.client_name),
      titulo: texto(r.title),
      responsavel: texto(r.owner_user_id),
      // A "última interação" real é a ocorrência mais recente registrada; sem
      // interação, cai no carimbo de last_interaction_at.
      ultimaInteracaoEm: texto(r.ultima_interacao_em) || texto(r.last_interaction_at),
      atualizadoEm: texto(r.updated_at),
      interacoes: Number(r.interacoes) || 0,
      texto: texto(parse(r.fields_json, {}).fupTexto),
    }));
  };

  // Retrato temporário (artefato): espelha o artefato INTEIRO (receita + kanban
  // + operacional) enquanto o ledger canônico/Track3R por webhook não alimenta.
  // Some sozinho quando os fatos canônicos chegarem.
  const lerSnapshot = async () => {
    if (!verTudo) return null;
    const row = await env.DB.prepare(
      `SELECT daily_json, monthly_json, kanban_json, updates_json, ops_json,
              captured_from, captured_to, total_receita, imported_at, source
         FROM todogreen_commercial_snapshots
        WHERE tenant_id = ? AND workspace_owner_id = ?
        ORDER BY imported_at DESC LIMIT 1`,
    ).bind(TENANT_ID, ownerId).first();
    if (!row) return null;
    const parse = (v, fb) => { try { return JSON.parse(v || ""); } catch { return fb; } };
    return {
      artefato: {
        DATA: { daily: parse(row.daily_json, []), monthly: parse(row.monthly_json, []) },
        KANBAN: parse(row.kanban_json, {}),
        UPDATES: parse(row.updates_json, {}),
        OPS: parse(row.ops_json, {}),
      },
      capturedFrom: texto(row.captured_from),
      capturedTo: texto(row.captured_to),
      totalReceita: Number(row.total_receita) || 0,
      importedAt: texto(row.imported_at),
      source: texto(row.source) || "artefato",
    };
  };

  // Cada fonte falha isolada: uma tabela indisponível vira aviso, não zera o
  // painel inteiro nem finge dado.
  const [faturas, encomendas, oportunidades, snapshot] = await Promise.allSettled([
    lerFaturas(),
    lerEncomendas(),
    lerOportunidades(),
    lerSnapshot(),
  ]);

  const erros = {};
  const valor = (resultado, chave, fallback) => {
    if (resultado.status === "fulfilled") return resultado.value;
    console.error(`Painel comercial · falha ao ler ${chave}`, resultado.reason);
    erros[chave] = "indisponivel";
    return fallback;
  };

  const dados = {
    faturas: valor(faturas, "receita", []),
    encomendas: valor(encomendas, "operacional", []),
    oportunidades: valor(oportunidades, "kanban", []),
  };
  const retrato = valor(snapshot, "retrato", null);
  const hoje = new Date();

  // Cada aba escolhe a MELHOR fonte, de forma independente:
  //  - Receita/Operacional: fatos canônicos do Track3R quando houver; senão o
  //    espelho do artefato (temporário) enquanto os webhooks não entram.
  //  - Kanban: SEMPRE as oportunidades nativas do ERP (editáveis). Só cai no
  //    espelho do artefato se ainda não houver nenhuma oportunidade semeada.
  const canon = montarPainelCanonicoMirror(dados, hoje);
  const art = retrato ? montarPainelDoArtefato(retrato.artefato, hoje) : null;

  const receitaCanonica = dados.faturas.length > 0;
  const operacionalCanonico = dados.encomendas.length > 0;

  const receita = receitaCanonica ? canon.receita : (art ? art.receita : canon.receita);
  const operacional = operacionalCanonico ? canon.operacional : (art ? art.operacional : canon.operacional);

  const kanbanEditavel = montarKanbanDeOportunidades(dados.oportunidades, hoje);
  const kanban = kanbanEditavel.pipeline.disponivel ? kanbanEditavel : (art ? { ...art.kanban, editavel: false } : kanbanEditavel);

  const fonte = (canonico, temArt) => (canonico ? "track3r" : temArt ? "artefato_temporario" : "vazio");

  return json({
    modo: !receitaCanonica && art ? "artefato_temporario" : "canonico",
    receita,
    kanban,
    operacional,
    fontes: {
      receita: {
        fonte: fonte(receitaCanonica, Boolean(art)),
        visivel: verTudo,
        registros: dados.faturas.length,
        retrato: retrato
          ? { de: retrato.capturedFrom, ate: retrato.capturedTo, total: retrato.totalReceita, importadoEm: retrato.importedAt, source: retrato.source }
          : null,
      },
      operacional: { fonte: fonte(operacionalCanonico, Boolean(art)), visivel: verTudo, registros: dados.encomendas.length },
      kanban: { fonte: kanban.editavel ? "oportunidades" : "artefato_temporario", editavel: Boolean(kanban.editavel), registros: dados.oportunidades.length },
    },
    escopo: { verTudo, papel: access?.role || "" },
    erros,
  });
}
