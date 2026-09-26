// ===== Autenticação, escopo e autorização da To Do Green =====
//
// Um lugar só. Antes a decisão de "quem é você e o que você pode operar"
// estava dentro do serviço da Central de Trabalho e era importada por outros
// seis; qualquer endurecimento precisava ser lembrado em todos.
//
// Dois furos que este arquivo fecha, e que existiam de verdade:
//
// 1) ACESSO POR DOMÍNIO. A regra era `email.endsWith("@todogreen.com.br")`.
//    Qualquer pessoa que criasse uma conta com um e-mail nesse domínio entrava
//    na vertical inteira — e a regra estava num repositório público. Acesso
//    agora vem de vínculo explícito: a variável de administradores, a lista de
//    e-mails autorizados ou a associação ao tenant. Nada mais.
//
// 2) OWNER ARBITRÁRIO NA QUERY STRING. O espaço de trabalho vinha de
//    `?owner=...` sem nenhuma verificação: `clean(requestedOwnerId) || ...`.
//    Bastava trocar o parâmetro para operar o espaço de outra pessoa. Agora o
//    pedido é confrontado com os espaços que a sessão realmente alcança, e um
//    espaço fora do vínculo é recusado em vez de aceito.
//
// A regra que orienta o arquivo: **o que a sessão pode fazer sai do banco,
// nunca da requisição.**

import { verticalPermite, TODO_GREEN_PERMISSIONS } from "../../src/features/logistics/logisticsVerticalDomain.js";
import { sessionUser } from "../auth/credenciais.js";

export const TENANT_ID = "todogreen";

// `limit`/`offset` da query string, com os mesmos limites em toda a
// vertical — records e Deal Desk liam a página cada um do seu jeito antes
// disso existir, e um limite deles fora do outro é o tipo de bug que só
// aparece quando alguém já está depurando uma paginação quebrada.
const MAX_LIMIT = 200;
export const paginacao = (url) => {
  const limitPedido = Number(url.searchParams.get("limit"));
  const offsetPedido = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(limitPedido) && limitPedido > 0
    ? Math.min(Math.trunc(limitPedido), MAX_LIMIT)
    : 100;
  const offset = Number.isFinite(offsetPedido) && offsetPedido > 0 ? Math.trunc(offsetPedido) : 0;
  return { limit, offset };
};

const clean = (value, max = 500) => String(value || "").trim().slice(0, max);

const parse = (value, fallback) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

// Usa a mesma sessão canônica do restante do Worker. Ela aceita o cookie
// __Host-sf_session (HttpOnly/Secure/SameSite=Strict) e mantém compatibilidade
// temporária com Bearer enquanto o front da vertical termina a migração.
// Assim a All Green deixa de depender exclusivamente do token legível pelo JS.
export async function authenticatedUser(request, env) {
  return sessionUser(request, env).catch(() => null);
}

export const administradoresDaEnv = (env) =>
  String(env.TODOGREEN_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// Motivos de recusa. Existem para o chamador poder responder a coisa certa —
// "você não tem acesso" e "esse espaço não é seu" são situações diferentes, e
// tratá-las igual esconde tentativa de acesso indevido no meio do ruído.
export const NEGADO = {
  semVinculo: "sem-vinculo",
  espacoNaoAutorizado: "espaco-nao-autorizado",
};

// `opcoes.registrarAcesso` (padrão true) carimba `last_access_at` na liberação
// por e-mail. Quem só PERGUNTA se uma pessoa alcança um espaço (o Planner, ao
// compartilhar um plano) passa false — senão a auditoria mostraria acesso de
// gente que nunca entrou.
export async function resolveTodoGreenAccess(env, user, requestedOwnerId, opcoes = {}) {
  const { registrarAcesso = true } = opcoes;
  if (!user?.id || !env?.DB) return { access: null, motivo: NEGADO.semVinculo };

  const email = String(user.email || "").trim().toLowerCase();
  const admins = administradoresDaEnv(env);
  const ehAdministrador = admins.includes(email);

  const autorizacoes = await env.DB
    .prepare(
      `SELECT id, role, permissions_json, workspace_owner_id
         FROM todogreen_access_emails
        WHERE tenant_id = ? AND lower(email) = ? AND status = 'active'
          AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY updated_at DESC`,
    )
    .bind(TENANT_ID, email, new Date().toISOString())
    .all()
    .then((resultado) => resultado.results || [])
    .catch(() => []);

  const vinculos = await env.DB
    .prepare(
      `SELECT role, permissions_json, workspace_owner_id
         FROM tenant_users
        WHERE tenant_id = ? AND user_id = ? AND status = 'active'
        ORDER BY updated_at DESC`,
    )
    .bind(TENANT_ID, user.id)
    .all()
    .then((resultado) => resultado.results || [])
    .catch(() => []);

  // A carteira pode ser preparada antes do primeiro acesso do vendedor e, por
  // isso, é vinculada por e-mail. Quando ainda não existe `tenant_users`, a
  // atribuição ativa também precisa levar a sessão ao espaço dono do cliente;
  // caso contrário o vendedor entra num espaço próprio vazio e não vê nem a
  // carteira que recebeu. O JOIN mantém a origem do espaço no cliente, sem
  // aceitar um owner enviado pelo navegador.
  const espacosDaCarteira = await env.DB
    .prepare(
      `SELECT c.workspace_owner_id, MAX(a.updated_at) AS ultima_atribuicao
         FROM todogreen_client_assignments a
         JOIN todogreen_clients c
           ON c.tenant_id = a.tenant_id AND c.id = a.client_id
        WHERE a.tenant_id = ? AND lower(a.seller_email) = ?
          AND a.status = 'active' AND c.archived_at IS NULL
        GROUP BY c.workspace_owner_id
        ORDER BY ultima_atribuicao DESC`,
    )
    .bind(TENANT_ID, email)
    .all()
    .then((resultado) => resultado.results || [])
    .catch(() => []);

  // Os espaços que esta sessão alcança de fato. O administrador da vertical
  // opera qualquer espaço porque é dele que a operação depende; todos os
  // demais ficam presos ao próprio espaço e ao do vínculo.
  const donosDaCarteira = espacosDaCarteira
    .map((item) => item.workspace_owner_id)
    .filter(Boolean);
  // O motorista pode nunca ter tenant_users: o vínculo dele é o cadastro de
  // motorista com e-mail de acesso (0070). Sem este caminho, ele entraria num
  // espaço próprio vazio e o portal não acharia viagem nenhuma.
  const espacosDeMotorista = await env.DB
    .prepare(
      `SELECT DISTINCT workspace_owner_id FROM todogreen_drivers
        WHERE tenant_id = ? AND lower(user_email) = ? AND archived_at IS NULL`,
    )
    .bind(TENANT_ID, email)
    .all()
    .then((resultado) => (resultado.results || []).map((item) => item.workspace_owner_id).filter(Boolean))
    .catch(() => []);
  // Mesma lógica do motorista para o colaborador (PJ/CLT): o vínculo dele com o
  // espaço é o cadastro de pessoal com e-mail (todogreen_employees, work/personal
  // email). Sem este caminho, o portal do colaborador cairia num espaço próprio
  // vazio e não acharia os próprios dados.
  const espacosDeColaborador = await env.DB
    .prepare(
      `SELECT DISTINCT workspace_owner_id FROM todogreen_employees
        WHERE tenant_id = ? AND archived_at IS NULL
          AND (lower(work_email) = ? OR lower(personal_email) = ?)`,
    )
    .bind(TENANT_ID, email, email)
    .all()
    .then((resultado) => (resultado.results || []).map((item) => item.workspace_owner_id).filter(Boolean))
    .catch(() => []);

  // Sem domínio na conta: entrar exige que ALGUÉM tenha autorizado esta pessoa.
  // A negação só pode acontecer DEPOIS de considerar todos os vínculos válidos
  // aplicáveis — administrador, liberação por e-mail, associação ao tenant,
  // carteira (vendedor), cadastro de motorista e cadastro de colaborador. Antes
  // desta correção a guarda olhava só admin/liberação/tenant e barrava um
  // motorista, colaborador ou vendedor legítimo antes de checar o vínculo dele.
  const temVinculoValido =
    ehAdministrador ||
    autorizacoes.length > 0 ||
    vinculos.length > 0 ||
    donosDaCarteira.length > 0 ||
    espacosDeMotorista.length > 0 ||
    espacosDeColaborador.length > 0;
  if (!temVinculoValido)
    return { access: null, motivo: NEGADO.semVinculo };

  // O espaço gravado na liberação por e-mail (0071). É o que resolve o caso
  // normal de quem foi autorizado ANTES de ter conta: sem ele, a pessoa criava
  // a conta, entrava, e caía no próprio espaço vazio — com todas as permissões
  // do papel apontadas para lugar nenhum.
  const pedido = clean(requestedOwnerId, 100);
  const donosDosVinculos = vinculos.map((item) => clean(item.workspace_owner_id, 100)).filter(Boolean);
  const donosDasLiberacoes = autorizacoes.map((item) => clean(item.workspace_owner_id, 100)).filter(Boolean);
  const donosExplicitos = [
    ...donosDosVinculos,
    ...donosDasLiberacoes,
    ...donosDaCarteira,
    ...espacosDeMotorista,
    ...espacosDeColaborador,
  ].filter(Boolean);
  // Registros anteriores à 0071 podem não ter espaço. Só nesse legado a conta
  // própria é usada como fallback; depois que existe um dono explícito, ela
  // não vira um workspace extra por acidente.
  const permitidos = new Set(donosExplicitos.length ? donosExplicitos : [user.id]);
  if (pedido && !ehAdministrador && !permitidos.has(pedido))
    return { access: null, motivo: NEGADO.espacoNaoAutorizado };

  const espacoPadrao = pedido
    || donosDosVinculos[0]
    || donosDasLiberacoes[0]
    || donosDaCarteira[0]
    || espacosDeMotorista[0]
    || espacosDeColaborador[0]
    || user.id;
  const autorizado = autorizacoes.find((item) => clean(item.workspace_owner_id, 100) === espacoPadrao)
    || autorizacoes.find((item) => !clean(item.workspace_owner_id, 100))
    || null;
  const vinculo = vinculos.find((item) => clean(item.workspace_owner_id, 100) === espacoPadrao)
    || vinculos.find((item) => !clean(item.workspace_owner_id, 100))
    || null;
  // Menor privilégio: sem liberação/vínculo explícito de papel, o acesso vem do
  // TIPO de vínculo — e NUNCA de "auditor" (leitura ampla) por acidente, nem de
  // "admin". Carteira concede o papel de vendedor; cadastro de motorista concede
  // "motorista" (driver:self/event, sem leitura da vertical); cadastro de
  // colaborador concede "colaborador" (só o próprio portal). Um vínculo de
  // motorista, colaborador ou cliente JAMAIS concede acesso administrativo:
  // "admin" continua vindo exclusivamente do e-mail listado em
  // TODOGREEN_ADMIN_EMAILS (ehAdministrador).
  const papelDoVinculo = donosDaCarteira.length
    ? "vendedor"
    : espacosDeMotorista.length
      ? "motorista"
      : espacosDeColaborador.length
        ? "colaborador"
        : "auditor";
  const role = ehAdministrador
    ? "admin"
    : autorizado?.role || vinculo?.role || papelDoVinculo;
  // Liberação por e-mail e associação ao tenant trazem a lista autoritativa de
  // permissões (mesmo vazia). Sem elas, as permissões derivam do papel mínimo do
  // vínculo — não podem ficar vazias, senão o portal do motorista/colaborador não
  // teria nem a própria permissão (driver:self / colaborador:self).
  // O administrador global vira "admin" com "*", mas isso não pode apagar um
  // perfil de desenvolvedor dado explicitamente a ele: a Central de Integrações
  // ignora "*" e admin de propósito (`ehPerfilDesenvolvedor`), então sem este
  // marcador quem está nas duas listas perdia a tela sem aviso.
  const explicitos = [autorizado, vinculo].filter(Boolean);
  const perfilDevExplicito = explicitos.some((item) =>
    item.role === "desenvolvedor" || parse(item.permissions_json, []).includes?.("dev:access"));
  const permissions = ehAdministrador
    ? (perfilDevExplicito ? ["*", "dev:access"] : ["*"])
    : autorizado || vinculo
      ? parse(autorizado?.permissions_json || vinculo?.permissions_json, [])
      : TODO_GREEN_PERMISSIONS[role] || [];

  if (registrarAcesso && autorizado?.id) {
    await env.DB.prepare(
      "UPDATE todogreen_access_emails SET last_access_at=? WHERE id=? AND tenant_id=?",
    ).bind(new Date().toISOString(), autorizado.id, TENANT_ID).run().catch(() => null);
  }

  return {
    access: {
      ownerId: espacoPadrao,
      role,
      permissions,
      email,
      userId: user.id,
      // Quem chegou por administrador global merece registro: é o acesso mais
      // amplo do sistema e precisa ser distinguível numa auditoria.
      viaAdministradorGlobal: ehAdministrador,
    },
    motivo: null,
  };
}

// "Esta pessoa consegue abrir a vertical NESTE espaço?" — a pergunta que o
// compartilhamento do Planner precisa responder antes de prometer que alguém
// verá um plano. Reusa `resolveTodoGreenAccess` com o espaço pedido, exatamente
// como o servidor decidirá quando a pessoa entrar: sem vínculo com o espaço
// (membro só do espaço do app, conta de outro espaço) é `false`; papel que não
// lê a vertical (motorista, colaborador de portal) também é `false`, porque a
// tela do Planner nunca abriria para ele. Não carimba último acesso.
export async function alcancaEspacoNaVertical(env, pessoa, ownerId, permissao = "read") {
  const espaco = clean(ownerId, 100);
  if (!pessoa?.id || !espaco) return false;
  const { access } = await resolveTodoGreenAccess(env, pessoa, espaco, { registrarAcesso: false });
  return Boolean(
    access
      && access.ownerId === espaco
      && access.role !== "motorista"
      && verticalPermite(access.role, access.permissions, permissao),
  );
}

// Fachada única para os handlers: autentica, resolve e devolve a resposta
// pronta quando não pode passar. Sem isto cada serviço repetia — e às vezes
// esquecia — um dos dois passos.
export async function exigirAcessoTodoGreen(request, env) {
  const json = (data, status) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });

  const user = await authenticatedUser(request, env);
  if (!user) return { response: json({ error: "Sessão inválida." }, 401) };

  const url = new URL(request.url);
  const { access, motivo } = await resolveTodoGreenAccess(
    env,
    user,
    url.searchParams.get("owner"),
  );

  if (!access)
    return {
      response: json(
        {
          error:
            motivo === NEGADO.espacoNaoAutorizado
              ? "Este espaço de trabalho não pertence à sua conta."
              : "Você não tem acesso à To Do Green.",
        },
        // Espaço de outra conta responde 404, não 403: a regra do projeto é não
        // confirmar a existência de um recorte que não é seu (o mesmo que os
        // registros já fazem). Falta de acesso à vertical em si continua 403.
        motivo === NEGADO.espacoNaoAutorizado ? 404 : 403,
      ),
    };

  return { user, access };
}

// Quem enxerga a carteira inteira: quem gere clientes. Um vendedor vê só os
// clientes atribuídos a ele. É a mesma regra em requests, ESG, records e
// evidências — tê-la num lugar só evita que uma consulta esqueça o recorte e
// devolva a carteira alheia.
export const podeVerTodaCarteira = (access) =>
  ["owner", "admin", "lideranca_comercial", "pricing", "financeiro", "operacoes", "sustentabilidade"].includes(access?.role) ||
  (Array.isArray(access?.permissions) &&
    (access.permissions.includes("*") ||
      access.permissions.includes("clients:manage") ||
      access.permissions.includes("clients:assign")));

// O recorte, como pedaço de SQL para juntar à consulta. `alias` é o nome da
// tabela na query (r, o, e...) e `colunaCliente` é a coluna que guarda o
// identificador do cliente nessa tabela — `client_id` na maioria das
// tabelas da vertical, mas `id` quando a própria consulta já é sobre
// `todogreen_clients`. Vendedor sem cliente atribuído recebe lista vazia —
// nunca a caixa inteira "porque ainda não configuraram".
export const recorteDeCarteira = (access, email, alias, colunaCliente = "client_id") => {
  if (podeVerTodaCarteira(access)) return { sql: "", params: [] };
  return {
    sql: `AND EXISTS (
            SELECT 1 FROM todogreen_client_assignments a
             WHERE a.tenant_id = ${alias}.tenant_id AND a.client_id = ${alias}.${colunaCliente}
               AND a.status = 'active' AND lower(a.seller_email) = ?
          )`,
    params: [String(email || "").trim().toLowerCase()],
  };
};

// Papéis que só alcançam o PRÓPRIO portal: nunca a vertical interna
// (carteira, financeiro, compras, estoque, cadastros). O corte é pelo PAPEL, e
// não pela permissão "read", de propósito: acessos sob medida de outros papéis,
// com lista estreitada, continuam valendo. Até 24/09 só o motorista era barrado
// — o colaborador PJ/CLT lia saldos, títulos, compras e estoque do espaço (L8
// da matriz de prontidão). Toda rota interna pergunta aqui; os portais
// (`/driver-portal`, `/employee-portal`) não passam por este corte.
const PORTAL_DO_PAPEL = Object.freeze({
  motorista: "Motoristas usam o portal do motorista (/portal-motorista).",
  colaborador: "Colaboradores usam o portal do colaborador (/portal-colaborador).",
});

// A mensagem de recusa quando o papel é só de portal; "" quando pode seguir.
export const recusaDoPortalDoPapel = (access) => PORTAL_DO_PAPEL[access?.role] || "";

// Permissão de verdade, lida do vínculo — nunca de rótulo de tela. Delega para
// a mesma regra que o front usa: uma divergência entre as duas seria um botão
// liberado na tela que o servidor recusa (ou o contrário).
export const podeNaVertical = (access, permissao) => {
  if (!access) return false;
  const concedidas = Array.isArray(access.permissions) ? access.permissions : [];
  return verticalPermite(access.role, concedidas, permissao);
};