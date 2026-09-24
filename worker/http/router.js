// ===== Roteador do app: da tabela à resposta =====
//
// Contrato
// - Recebe: o `request`, o `env` e o `ctx` do fetch do Worker.
// - Devolve: a resposta da primeira rota de worker/http/routes.js que casar
//   o caminho; se nenhuma responder, o SPA (worker/http/spa.js).
// - Quem chama: o fetch de worker.js — que o worker-entry.js chama depois
//   das rotas da vertical To Do Green.
// - Autorização: as rotas públicas são consultadas primeiro, na ordem da
//   tabela. Uma rota de ROTAS_AUTENTICADAS passa, nesta ordem, por método
//   (405), banco (503) e sessão (401 sem ela, 500 se a validação falhar) antes
//   do handler. É o único lugar que valida a sessão dessas rotas.

import { sessionUser } from "../auth/credenciais.js";
import { json } from "../lib/http.js";
import {
  ROTAS_AUTENTICADAS,
  ROTAS_PUBLICAS,
  casaPagina,
  casaRota,
} from "./routes.js";
import { servirSpa } from "./spa.js";

// O guarda único: handler que lança vira a resposta de falha da rota, com o
// rótulo dela no console.error, em vez de erro opaco do Cloudflare.
async function comGuarda(rota, contexto) {
  if (!rota.falha) return rota.executar(contexto);
  try {
    return await rota.executar(contexto);
  } catch (error) {
    console.error(rota.rotulo, error);
    return rota.falha(contexto);
  }
}

export async function rotear(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;

  for (const rota of ROTAS_PUBLICAS) {
    if (!casaRota(rota, pathname)) continue;
    const contexto = {
      request,
      env,
      ctx,
      url,
      pagina: casaPagina(rota, pathname),
    };
    if (rota.exigeBanco && !env.DB) return rota.semBanco(contexto);
    const resposta = await comGuarda(rota, contexto);
    // Rota opcional que não reconheceu o caminho: segue para as próximas.
    if (resposta || !rota.opcional) return resposta;
  }

  const rota = ROTAS_AUTENTICADAS.find((item) => casaRota(item, pathname));
  if (rota) {
    if (rota.metodo && request.method !== rota.metodo)
      return json({ error: "Método não permitido." }, 405);
    if (rota.exigeBanco && !env.DB)
      return json(
        { error: "O serviço de contas ainda não está configurado." },
        503,
      );
    let user;
    try {
      user = await sessionUser(request, env);
      if (!user)
        return json({ error: "Sua sessão expirou. Entre novamente." }, 401);
    } catch (error) {
      console.error("Session check error", error);
      return json({ error: "Não foi possível validar sua sessão." }, 500);
    }
    return comGuarda(rota, { request, env, ctx, url, user, pagina: false });
  }

  return servirSpa(request, env, url);
}
