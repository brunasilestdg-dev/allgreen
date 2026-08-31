import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker-entry.js";

// O cofre de documentos com pastas.
//
// O que este arquivo existe para impedir de voltar:
//   • arquivo escondido na LISTA mas baixável por quem souber o id — esconder
//     na lista e liberar no download é pior do que não ter pasta, porque dá a
//     impressão de privacidade que não existe;
//   • arquivo de uma subpasta "do espaço" dentro de uma pasta privada aparecendo
//     para quem não vê o pai;
//   • o acervo antigo (arquivo sem pasta) desaparecendo por causa da migração.

let n = 0;
const nextIp = () => `198.19.7.${(++n % 240) + 1}`;

async function sha256(valor) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function criarUsuario(id, email) {
  const token = `tok-${id}`;
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, created_at)
     VALUES (?, ?, ?, 'h', 's', ?)`,
  ).bind(id, `Pessoa ${id}`, email, agora).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)`,
  ).bind(`ses-${id}`, id, await sha256(token), agora).run();
  return { id, email, token };
}

async function autorizar(usuario, papel, permissoes, workspaceOwnerId) {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO todogreen_access_emails
       (id, tenant_id, workspace_owner_id, email, role, status, permissions_json, note, created_by, created_at, updated_at)
     VALUES (?, 'todogreen', ?, ?, ?, 'active', ?, '', ?, ?, ?)
     ON CONFLICT(tenant_id, workspace_owner_id, email) DO UPDATE SET role = excluded.role,
       permissions_json = excluded.permissions_json, status = 'active'`,
  )
    .bind(crypto.randomUUID(), workspaceOwnerId, usuario.email, papel, JSON.stringify(permissoes), usuario.id, agora, agora)
    .run();
}

const pedir = (caminho, { metodo = "GET", token, corpo, form } = {}) => {
  const headers = { "cf-connecting-ip": nextIp() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://app.test${caminho}`, {
      method: metodo,
      headers,
      body: form || (corpo === undefined ? undefined : JSON.stringify(corpo)),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );
};

let dona;
let dela;   // criou a pasta privada
let outra;  // mesmo espaço, sem acesso à pasta privada
let privadaId;
let subShared;

beforeAll(async () => {
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tenants (id, slug, name, segment, status, theme_json, created_at, updated_at)
     VALUES ('todogreen', 'todogreen', 'To Do Green', 'logistica', 'active', '{}', ?, ?)`,
  ).bind(agora, agora).run();

  dona = await criarUsuario(`fv-dona-${crypto.randomUUID().slice(0, 8)}`, `fvdona-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`);
  dela = await criarUsuario(`fv-dela-${crypto.randomUUID().slice(0, 8)}`, `fvdela-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`);
  outra = await criarUsuario(`fv-outra-${crypto.randomUUID().slice(0, 8)}`, `fvoutra-${crypto.randomUUID().slice(0, 8)}@todogreen.com.br`);
  await autorizar(dona, "owner", ["*"], dona.id);
  // As duas escrevem no cofre: a trava tem que ser de VISIBILIDADE, não de
  // permissão de escrita.
  await autorizar(dela, "operacoes", ["read", "evidence:manage", "operations:manage"], dona.id);
  await autorizar(outra, "operacoes", ["read", "evidence:manage", "operations:manage"], dona.id);

  const criada = await pedir("/api/todogreen/records/documentFolders", {
    metodo: "POST", token: dela.token,
    corpo: { nome: `Privada ${crypto.randomUUID().slice(0, 6)}`, visibilidade: "private" },
  });
  privadaId = (await criada.json()).registro.id;

  const sub = await pedir("/api/todogreen/records/documentFolders", {
    metodo: "POST", token: dela.token,
    corpo: { nome: `Sub ${crypto.randomUUID().slice(0, 6)}`, visibilidade: "shared", paiId: privadaId },
  });
  subShared = (await sub.json()).registro.id;
});

const enviar = async (token, nome, folderId) => {
  const form = new FormData();
  form.append("file", new File([new TextEncoder().encode("conteudo do documento")], nome, { type: "text/plain" }));
  if (folderId) form.append("folderId", folderId);
  const resposta = await pedir("/api/todogreen/file-vault", { metodo: "POST", token, form });
  return { status: resposta.status, corpo: await resposta.json() };
};

describe("cofre com pastas", () => {
  let naPrivada;
  let naSub;
  let semPasta;

  it("o arquivo entra na pasta escolhida", async () => {
    const enviado = await enviar(dela.token, "segredo.txt", privadaId);
    expect(enviado.status).toBe(201);
    expect(enviado.corpo.file.folderId).toBe(privadaId);
    naPrivada = enviado.corpo.file.id;

    const naoSubpasta = await enviar(dela.token, "dentro-da-sub.txt", subShared);
    expect(naoSubpasta.status).toBe(201);
    naSub = naoSubpasta.corpo.file.id;

    const solto = await enviar(dela.token, "acervo-antigo.txt", "");
    expect(solto.status).toBe(201);
    expect(solto.corpo.file.folderId).toBe("");
    semPasta = solto.corpo.file.id;
  });

  it("quem não vê a pasta não vê o arquivo na lista — nem o da subpasta 'do espaço'", async () => {
    const lista = await (await pedir("/api/todogreen/file-vault", { token: outra.token })).json();
    const ids = lista.files.map((item) => item.id);
    expect(ids).not.toContain(naPrivada);
    // A regra que mais importa: a subpasta é 'shared', mas o pai é privado.
    expect(ids).not.toContain(naSub);
    // E o acervo que já existia continua visível: esconder tudo numa migração
    // seria o mesmo que apagar.
    expect(ids).toContain(semPasta);
  });

  it("O TESTE QUE IMPORTA: o download de arquivo em pasta invisível responde 404", async () => {
    // Esconder na lista e liberar no download dá a impressão de privacidade que
    // não existe, e o id de um arquivo circula por link, histórico e print.
    const baixar = await pedir(`/api/todogreen/file-vault/${naPrivada}/download`, { token: outra.token });
    expect(baixar.status).toBe(404);
    // 404 e não 403: 403 confirmaria que o documento existe naquela pasta.
    expect((await baixar.json()).error).toMatch(/não encontrado/i);

    const baixarSub = await pedir(`/api/todogreen/file-vault/${naSub}/download`, { token: outra.token });
    expect(baixarSub.status).toBe(404);
  });

  it("quem criou a pasta baixa o próprio arquivo", async () => {
    const baixar = await pedir(`/api/todogreen/file-vault/${naPrivada}/download`, { token: dela.token });
    expect(baixar.status).toBe(200);
    expect(await baixar.text()).toContain("conteudo do documento");
  });

  it("a dona do espaço baixa — quem responde pelo espaço não fica trancada fora dele", async () => {
    const baixar = await pedir(`/api/todogreen/file-vault/${naPrivada}/download`, { token: dona.token });
    expect(baixar.status).toBe(200);
  });

  it("arquivar arquivo de pasta invisível responde 404, não apaga às cegas", async () => {
    const apagar = await pedir(`/api/todogreen/file-vault/${naPrivada}`, { metodo: "DELETE", token: outra.token });
    expect(apagar.status).toBe(404);
    // E o arquivo continua lá para quem é de direito.
    const baixar = await pedir(`/api/todogreen/file-vault/${naPrivada}/download`, { token: dela.token });
    expect(baixar.status).toBe(200);
  });

  it("guardar arquivo numa pasta que a pessoa não vê é recusado — perderia o próprio arquivo", async () => {
    const enviado = await enviar(outra.token, "perdido.txt", privadaId);
    expect(enviado.status).toBe(404);
    expect(enviado.corpo.error).toMatch(/pasta/i);
  });

  it("a lista devolve as pastas visíveis junto, cada pessoa com a sua fatia", async () => {
    const daDela = await (await pedir("/api/todogreen/file-vault", { token: dela.token })).json();
    expect(daDela.folders.map((p) => p.id)).toContain(privadaId);
    const daOutra = await (await pedir("/api/todogreen/file-vault", { token: outra.token })).json();
    expect(daOutra.folders.map((p) => p.id)).not.toContain(privadaId);
    expect(daOutra.folders.map((p) => p.id)).not.toContain(subShared);
  });
});
