// ===== Cofre de evidências: cadastro interno e download com link temporário =====
//
// A aba de documentos do portal listava título, tipo, data e impressão digital,
// e não tinha botão nem endpoint. A permissão chamava-se
// `portal:document:download` e o que era entregue era metadado. Pior: nenhum
// caminho do produto escrevia na tabela, então o cofre estava vazio por
// construção.
//
// Três decisões que valem explicação:
//
// 1) O ARQUIVO NÃO MORA NO D1. Uma base relacional não é lugar para PDF de nota
//    fiscal. O que fica aqui é o endereço; o binário continua onde já está.
//
// 2) A IMPRESSÃO DIGITAL É DO CONTEÚDO. No cadastro o arquivo é baixado uma vez
//    e o SHA-256 sai dos bytes. Se o download falhar, o documento NÃO é
//    cadastrado — guardar um hash do título ou da URL seria uma impressão
//    digital que não prova nada, e uma prova falsa é pior do que nenhuma.
//
// 3) O DOWNLOAD PASSA POR AQUI. O endereço de origem nunca chega ao navegador
//    do cliente: quem pede recebe um link temporário deste worker, e é o worker
//    que busca e devolve o arquivo. Assim o link expira de verdade e cada
//    abertura fica registrada.

import { TENANT_ID, podeNaVertical, recorteDeCarteira } from "./todogreen-access.js";
import {
  documentoValido,
  enderecoAceito,
  idDeArquivoInterno,
  linkExpirado,
  PREFIXO_ARQUIVO_INTERNO,
  validadeDoLink,
} from "../../src/features/logistics/documentVaultDomain.js";
import { servirArquivoInterno } from "./todogreen-file-store.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const texto = (valor, max = 400) => String(valor ?? "").trim().slice(0, max);

const sha256Hex = async (dados) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof dados === "string" ? new TextEncoder().encode(dados) : dados,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// 25 MB. Acima disso o worker viraria intermediário de transferência pesada,
// que não é o papel dele — e a memória do isolate é finita.
const LIMITE_BYTES = 25 * 1024 * 1024;

const doBanco = (row) => ({
  id: row.id,
  clientId: row.client_id,
  titulo: row.titulo,
  tipo: row.tipo,
  referencia: row.referencia,
  descricao: row.descricao,
  emitidoEm: row.emitido_em || "",
  arquivoNome: row.arquivo_nome,
  arquivoBytes: row.arquivo_bytes,
  impressaoDigital: row.hash_conteudo,
  calculoId: row.calculo_id,
  situacao: row.status,
  criadoEm: row.created_at,
});

// Busca o arquivo uma vez, confere o tamanho e devolve os bytes com a
// impressão digital. É aqui que o cofre deixa de ser promessa.
async function baixarEConferir(url) {
  let resposta;
  try {
    resposta = await fetch(url, { redirect: "follow" });
  } catch {
    return { ok: false, motivo: "Não foi possível acessar o arquivo neste endereço." };
  }
  if (!resposta.ok)
    return { ok: false, motivo: `O endereço respondeu ${resposta.status}. Confira o link e a permissão de acesso.` };

  const declarado = Number(resposta.headers.get("content-length") || 0);
  if (declarado > LIMITE_BYTES)
    return { ok: false, motivo: "O arquivo passa de 25 MB. Guarde-o fora e cadastre o link de acesso direto." };

  const bytes = await resposta.arrayBuffer();
  if (bytes.byteLength === 0)
    return { ok: false, motivo: "O endereço devolveu um arquivo vazio." };
  if (bytes.byteLength > LIMITE_BYTES)
    return { ok: false, motivo: "O arquivo passa de 25 MB." };

  return {
    ok: true,
    bytes: bytes.byteLength,
    hash: await sha256Hex(bytes),
    tipoConteudo: resposta.headers.get("content-type") || "application/octet-stream",
  };
}

async function cadastrar(env, access, user, corpo) {
  const { valido, problemas, url } = documentoValido(corpo);
  if (!valido) return json({ error: problemas.join(" ") }, 400);

  // O cliente precisa ser do próprio espaço. Sem isto, um documento poderia ser
  // pendurado na carteira de outra pessoa.
  const cliente = await env.DB
    .prepare("SELECT id FROM todogreen_clients WHERE id = ? AND workspace_owner_id = ?")
    .bind(texto(corpo.clientId, 120), access.ownerId)
    .first()
    .catch(() => null);
  if (!cliente) return json({ error: "Cliente não encontrado nesta carteira." }, 404);

  // Vínculo com simulação é opcional, mas se foi informado precisa apontar
  // para uma simulação real do mesmo cliente — do contrário o gatilho de
  // "evidência insuficiente" no Deal Desk contaria um vínculo que não existe.
  const calculoId = texto(corpo.calculoId, 120);
  if (calculoId) {
    const cenario = await env.DB
      .prepare(
        "SELECT id FROM pricing_scenarios WHERE id = ? AND workspace_owner_id = ? AND client_id = ?",
      )
      .bind(calculoId, access.ownerId, texto(corpo.clientId, 120))
      .first()
      .catch(() => null);
    if (!cenario)
      return json({ error: "Simulação não encontrada para este cliente." }, 404);
  }

  const conferencia = await baixarEConferir(url);
  // Sem conseguir ler o arquivo, não cadastra. Um documento sem impressão
  // digital de verdade seria uma prova que não prova nada.
  if (!conferencia.ok) return json({ error: conferencia.motivo }, 422);

  const id = crypto.randomUUID();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_evidences
       (id, tenant_id, client_id, workspace_owner_id, tipo, titulo, referencia, descricao,
        emitido_em, arquivo_url, arquivo_nome, arquivo_bytes, hash_conteudo, calculo_id,
        status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativo', ?, ?, ?)`,
  )
    .bind(
      id,
      TENANT_ID,
      texto(corpo.clientId, 120),
      access.ownerId,
      texto(corpo.tipo, 40),
      texto(corpo.titulo, 240),
      texto(corpo.referencia, 160),
      texto(corpo.descricao, 2000),
      texto(corpo.emitidoEm, 40) || agora.slice(0, 10),
      url,
      texto(corpo.arquivoNome, 240) || url.split("/").pop() || "documento",
      conferencia.bytes,
      conferencia.hash,
      calculoId,
      user.id,
      agora,
      agora,
    )
    .run();

  const row = await env.DB
    .prepare("SELECT * FROM todogreen_evidences WHERE id = ? AND workspace_owner_id = ?")
    .bind(id, access.ownerId)
    .first();
  return json({ documento: doBanco(row) }, 201);
}

// Emite a concessão temporária. Devolve o token só aqui — o banco guarda o
// hash, e a partir deste ponto nem o servidor consegue reconstruir o link.
export async function emitirConcessao(env, { evidenceId = null, arquivoUrl = "", arquivoNome = "", clientId, ownerId, para }) {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const agora = new Date().toISOString();
  const expira = validadeDoLink(agora);
  await env.DB.prepare(
    `INSERT INTO todogreen_document_grants
       (id, token_hash, tenant_id, evidence_id, arquivo_url, arquivo_nome, client_id,
        workspace_owner_id, issued_to, expires_at, revoked_at, downloads, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      await sha256Hex(token),
      TENANT_ID,
      evidenceId || null,
      texto(arquivoUrl, 2000),
      texto(arquivoNome, 240),
      clientId,
      ownerId,
      texto(para, 120),
      expira,
      agora,
    )
    .run();
  return { token, expiraEm: expira };
}

// O comprovante de entrega não é linha do cofre — é arquivo da própria
// operação. Mesma concessão, mesma validade, mesma contagem de aberturas: um
// segundo caminho de download seria uma segunda regra de expiração para alguém
// esquecer de manter.
export const emitirConcessaoDeArquivo = (env, { url, clientId, ownerId, para, nome }) => {
  // Comprovante guardado no cofre INTERNO (POD/assinatura do motorista): guarda
  // um sentinela com o id do arquivo em vez do endereço, e a entrega serve os
  // bytes direto do cofre. `enderecoAceito` recusa esse caminho interno de
  // propósito (relativo, rede interna) — era por isso que o cliente recebia erro
  // ao pedir o comprovante de uma entrega real.
  const fileId = idDeArquivoInterno(url);
  if (fileId) {
    return emitirConcessao(env, {
      arquivoUrl: `${PREFIXO_ARQUIVO_INTERNO}${fileId}`,
      arquivoNome: texto(nome, 240) || "comprovante",
      clientId,
      ownerId,
      para,
    });
  }
  // Endereço externo (ex.: PDF de nota fiscal): valida e guarda a URL; a entrega
  // faz proxy por fetch, escondendo a origem do cliente.
  const endereco = enderecoAceito(url);
  if (!endereco.ok) throw new Error(endereco.motivo);
  return emitirConcessao(env, {
    arquivoUrl: endereco.url,
    arquivoNome: texto(nome, 240) || endereco.url.split("/").pop() || "comprovante",
    clientId,
    ownerId,
    para,
  });
};

// Entrega o arquivo. O escopo verificado é o gravado na concessão, não o que a
// requisição afirma — o link foi emitido para um cliente e um espaço, e é para
// eles que continua valendo.
export async function entregarArquivo(env, token) {
  // LEFT JOIN porque a concessão vale para documento do cofre OU para arquivo
  // direto. O COALESCE resolve qual endereço usar sem duplicar a consulta.
  const linha = await env.DB
    .prepare(
      `SELECT g.id AS grant_id, g.expires_at, g.revoked_at, g.evidence_id, g.client_id,
              g.workspace_owner_id,
              COALESCE(NULLIF(e.arquivo_url, ''), g.arquivo_url) AS arquivo_url,
              COALESCE(NULLIF(e.arquivo_nome, ''), g.arquivo_nome) AS arquivo_nome,
              COALESCE(e.hash_conteudo, '') AS hash_conteudo
         FROM todogreen_document_grants g
         LEFT JOIN todogreen_evidences e
           ON e.id = g.evidence_id
          AND e.client_id = g.client_id
          AND e.workspace_owner_id = g.workspace_owner_id
        WHERE g.token_hash = ? LIMIT 1`,
    )
    .bind(await sha256Hex(texto(token, 200)))
    .first()
    .catch(() => null);

  // Token desconhecido e token vencido respondem igual: distinguir os dois
  // contaria a quem está tentando adivinhar que ele acertou o formato.
  if (
    !linha ||
    !linha.arquivo_url ||
    linkExpirado({ expiraEm: linha.expires_at, revogadoEm: linha.revoked_at })
  )
    return json({ error: "Este link de download expirou. Peça um novo na tela de documentos." }, 410);

  // Comprovante do cofre interno (POD/assinatura): serve os bytes direto do
  // cofre, sem `fetch` de um endpoint que exige sessão da equipe. O token da
  // concessão já é a autorização — temporário, escopado ao cliente/operação, e
  // cada abertura fica registrada abaixo.
  const fileIdInterno = idDeArquivoInterno(linha.arquivo_url);
  if (fileIdInterno) {
    const resposta = await servirArquivoInterno(env, linha.workspace_owner_id, fileIdInterno);
    if (!resposta) return json({ error: "O arquivo não está acessível no momento." }, 410);
    await env.DB.prepare(
      "UPDATE todogreen_document_grants SET downloads = downloads + 1, last_used_at = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), linha.grant_id)
      .run()
      .catch(() => {});
    return resposta;
  }

  let origem;
  try {
    origem = await fetch(linha.arquivo_url, { redirect: "follow" });
  } catch {
    return json({ error: "O arquivo não está acessível no momento." }, 502);
  }
  if (!origem.ok) return json({ error: "O arquivo não está acessível no momento." }, 502);

  const agora = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE todogreen_document_grants SET downloads = downloads + 1, last_used_at = ? WHERE id = ?",
  )
    .bind(agora, linha.grant_id)
    .run()
    .catch(() => {});

  const nome = texto(linha.arquivo_nome, 200) || "documento";
  return new Response(origem.body, {
    status: 200,
    headers: {
      "content-type": origem.headers.get("content-type") || "application/octet-stream",
      // `attachment` para o navegador salvar em vez de renderizar: documento de
      // cliente não deve abrir dentro da página.
      "content-disposition": `attachment; filename="${nome.replace(/["\\]/g, "")}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // A impressão digital viaja junto: quem recebe pode conferir sem
      // depender da nossa palavra.
      "x-documento-sha256": linha.hash_conteudo || "",
    },
  });
}

export async function handleTodoGreenEvidences(request, env, access, user) {
  const url = new URL(request.url);
  const partes = url.pathname.split("/").filter(Boolean); // api, todogreen, evidencias, [id], [acao]
  const id = texto(partes[3], 120);
  const acao = texto(partes[4], 40);

  if (request.method === "GET" && !id) {
    const cliente = texto(url.searchParams.get("cliente"), 120);
    // Sem este recorte, um vendedor que omitisse `?cliente=` (ou apontasse
    // para o cliente de um colega) receberia o cofre inteiro do espaço —
    // documento de cliente é exatamente o tipo de coisa que carteira nenhuma
    // deveria enxergar fora da própria.
    const recorte = recorteDeCarteira(access, user.email, "todogreen_evidences");
    const { results } = await env.DB.prepare(
      `SELECT * FROM todogreen_evidences
        WHERE workspace_owner_id = ? AND status = 'ativo'
          AND (? = '' OR client_id = ?) ${recorte.sql}
        ORDER BY emitido_em DESC, created_at DESC LIMIT 300`,
    )
      .bind(access.ownerId, cliente, cliente, ...recorte.params)
      .all();
    return json({ documentos: (results || []).map(doBanco) });
  }

  if (request.method === "POST" && !id) {
    if (!podeNaVertical(access, "evidence:manage"))
      return json({ error: "Seu papel não pode cadastrar documentos." }, 403);
    return cadastrar(env, access, user, await request.json().catch(() => ({})));
  }

  // Link temporário pedido por dentro (a equipe também baixa). O id vem direto
  // na URL, então a listagem escopada não é suficiente sozinha — sem este
  // recorte aqui, quem descobrisse (ou adivinhasse) o id de um documento fora
  // da própria carteira ainda conseguiria emitir link para ele.
  if (request.method === "POST" && id && acao === "link") {
    const recorte = recorteDeCarteira(access, user.email, "todogreen_evidences");
    const doc = await env.DB
      .prepare(
        `SELECT id, client_id FROM todogreen_evidences
          WHERE id = ? AND workspace_owner_id = ? ${recorte.sql}`,
      )
      .bind(id, access.ownerId, ...recorte.params)
      .first();
    if (!doc) return json({ error: "Documento não encontrado." }, 404);
    const { token, expiraEm } = await emitirConcessao(env, {
      evidenceId: doc.id,
      clientId: doc.client_id,
      ownerId: access.ownerId,
      para: user.id,
    });
    return json({ url: `/api/todogreen/arquivo?t=${token}`, expiraEm }, 201);
  }

  return json({ error: "Método não permitido." }, 405);
}

export { enderecoAceito };
