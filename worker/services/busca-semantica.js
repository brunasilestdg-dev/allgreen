// ===== Busca por significado: vetores dos textos =====
//
// POST /api/busca/vetores (com sessão). O app manda os textos que ainda não
// têm vetor (hash + texto) e, se quiser, a consulta; recebe os vetores em
// int8/base64. A comparação roda no aparelho.
//
// Por que não o Vectorize: não tem simulação local (o E2E roda com
// `wrangler dev --local`), o deploy recusa binding para índice que não
// existe, o token do Workers Builds não tem permissão para criar índice e o
// plano Free limita a CONTA inteira a 5 milhões de dimensões armazenadas —
// uns 4.900 textos de 1.024 dimensões para todos os clientes do SaaS juntos.
// O D1 já existe e cabe muito mais (1 KB por texto).
//
// Custo: o bge-m3 gasta 1.075 neurons por milhão de tokens, dentro dos 10 mil
// neurons/dia grátis que a cascata de IA também usa — por isso o teto diário
// de textos novos por pessoa.

import { json } from "../lib/http.js";
import { rodarWorkersAi } from "./ai-gateway.js";
import {
  CONSULTA_MAXIMA,
  DIMENSOES,
  HASH_VALIDO,
  MODELO_EMBEDDING,
  TEXTO_MAXIMO,
  paraBase64,
  quantizar,
} from "../../src/features/knowledge/semanticDomain.js";

const ITENS_POR_PEDIDO = 64;
const NOVOS_POR_DIA = 2000;
const VETORES_POR_PESSOA = 20000;

const lerVetorGuardado = (valor) =>
  valor instanceof ArrayBuffer
    ? new Int8Array(valor)
    : ArrayBuffer.isView(valor)
      ? new Int8Array(valor.buffer, valor.byteOffset, valor.byteLength)
      : Int8Array.from(Array.isArray(valor) ? valor : []);

// O texto pode trazer CPF, conta, contrato: vai como pedido sensível (sem
// log e sem cache no AI Gateway). A Cloudflare não treina com o conteúdo do
// Workers AI.
async function calcularVetores(env, textos) {
  const resposta = await rodarWorkersAi(
    env,
    MODELO_EMBEDDING,
    { text: textos, truncate_inputs: true },
    { sensivel: true },
  );
  const vetores = Array.isArray(resposta?.data) ? resposta.data : [];
  if (vetores.length !== textos.length || vetores.some((v) => v?.length !== DIMENSOES))
    throw new Error("bge-m3 devolveu vetores fora do formato esperado");
  return vetores.map(quantizar);
}

export async function handleBuscaVetores(request, env, user) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  if (!env.AI)
    return json({ error: "A busca por significado não está disponível agora.", indisponivel: true }, 503);
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ error: "Solicitação inválida." }, 400);
  }
  const vistos = new Set();
  const itens = [];
  for (const item of Array.isArray(corpo?.itens) ? corpo.itens : []) {
    const hash = String(item?.h || "").toLowerCase();
    const texto = typeof item?.t === "string" ? item.t.trim().slice(0, TEXTO_MAXIMO) : "";
    if (!HASH_VALIDO.test(hash) || !texto || vistos.has(hash)) continue;
    vistos.add(hash);
    itens.push({ hash, texto });
  }
  if (itens.length > ITENS_POR_PEDIDO)
    return json({ error: `Envie no máximo ${ITENS_POR_PEDIDO} textos por vez.` }, 413);
  const consulta = typeof corpo?.consulta === "string" ? corpo.consulta.trim().slice(0, CONSULTA_MAXIMA) : "";
  if (!itens.length && !consulta) return json({ error: "Nada para calcular." }, 400);

  const vetores = {};
  if (itens.length) {
    const marcadores = itens.map(() => "?").join(",");
    const guardados = await env.DB.prepare(
      `SELECT hash, vetor FROM busca_vetores WHERE user_id = ? AND modelo = ? AND hash IN (${marcadores})`,
    )
      .bind(user.id, MODELO_EMBEDDING, ...itens.map((item) => item.hash))
      .all();
    for (const linha of guardados.results || [])
      vetores[linha.hash] = paraBase64(lerVetorGuardado(linha.vetor));
  }

  let faltando = itens.filter((item) => !vetores[item.hash]);
  let limiteDiario = false;
  if (faltando.length) {
    const hoje = new Date().toISOString().slice(0, 10);
    const feitosHoje = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM busca_vetores WHERE user_id = ? AND criado_em >= ?",
    )
      .bind(user.id, hoje)
      .first();
    const restante = Math.max(0, NOVOS_POR_DIA - Number(feitosHoje?.total || 0));
    if (faltando.length > restante) {
      faltando = faltando.slice(0, restante);
      limiteDiario = true;
    }
  }

  const textos = [...faltando.map((item) => item.texto), ...(consulta ? [consulta] : [])];
  let vetorDaConsulta = "";
  if (textos.length) {
    let calculados;
    try {
      calculados = await calcularVetores(env, textos);
    } catch (erro) {
      console.error("busca por significado: bge-m3 falhou", erro?.message || erro);
      // O que já estava guardado continua valendo; sem a consulta, a tela
      // fica só com a busca por palavra.
      return json(
        { error: "A busca por significado não respondeu agora.", indisponivel: true, vetores },
        503,
      );
    }
    const agora = new Date().toISOString();
    if (faltando.length) {
      await env.DB.batch(
        faltando.map((item, i) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO busca_vetores (user_id, modelo, hash, vetor, criado_em) VALUES (?, ?, ?, ?, ?)",
          ).bind(user.id, MODELO_EMBEDDING, item.hash, new Uint8Array(calculados[i].buffer), agora),
        ),
      );
      faltando.forEach((item, i) => {
        vetores[item.hash] = paraBase64(calculados[i]);
      });
      // Teto por pessoa: de vez em quando, apaga os vetores mais antigos que
      // passaram do limite (texto que sumiu do espaço deixa vetor órfão).
      if (Math.random() < 0.05)
        await env.DB.prepare(
          `DELETE FROM busca_vetores WHERE rowid IN (
             SELECT rowid FROM busca_vetores WHERE user_id = ?
             ORDER BY criado_em ASC
             LIMIT max(0, (SELECT COUNT(*) FROM busca_vetores WHERE user_id = ?) - ?)
           )`,
        )
          .bind(user.id, user.id, VETORES_POR_PESSOA)
          .run()
          .catch((erro) => console.error("busca por significado: limpeza", erro?.message || erro));
    }
    if (consulta) vetorDaConsulta = paraBase64(calculados[calculados.length - 1]);
  }

  return json({
    modelo: "bge-m3",
    dimensoes: DIMENSOES,
    vetores,
    ...(consulta ? { consulta: vetorDaConsulta } : {}),
    ...(limiteDiario ? { limiteDiario: true } : {}),
  });
}
