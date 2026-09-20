// ===== Solicitação de acesso à To Do Green (porta pública do login) =====
//
// Este é o ÚNICO endpoint da vertical que aceita um POST sem sessão: a pessoa
// que pede acesso ainda não tem conta. Por isso ele não recebe `access` nem
// `user` — só registra um pedido na fila que os administradores decidem dentro
// do app (ver o bloco `access-requests` em todogreen-core.js).
//
// Regra de segurança: o pedido NÃO concede nada e NÃO revela nada. Responde
// sempre o mesmo sucesso genérico — não confirma se o e-mail já tem acesso, se
// já pediu antes, nem se a conta existe. Quem decide o que fazer é um humano na
// fila de aprovação, com o papel escolhido na hora do aceite.

import { allowed, edgeIp } from "../lib/http.js";

const TENANT_ID = "todogreen";

const limpar = (valor, max = 500) => String(valor || "").trim().slice(0, max);
const emailValido = (valor) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

// A resposta é sempre esta, dê no que der abaixo: a fila recebeu o pedido (ou
// já tinha um igual). Nunca conta ao visitante o estado do e-mail.
//
// É uma FUNÇÃO, não uma constante: construir a Response no escopo global do
// módulo é operação proibida no runtime dos Workers ("Disallowed operation
// called within global scope") e derruba o worker inteiro na partida. Cada
// chamada devolve uma Response nova.
const recebido = () => json(
  { ok: true, mensagem: "Pedido de acesso registrado. Um administrador da To Do Green vai avaliar e você receberá um convite por e-mail se for aprovado." },
  201,
);

export async function receberSolicitacaoDeAcesso(request, env) {
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  // Porta pública sem sessão: sem teto por IP dava para inserir linhas sem fim
  // variando o e-mail (a deduplicação só vale para pendências do MESMO e-mail).
  const ip = edgeIp(request);
  if (ip && !allowed(`tdg:solicitar-acesso:${ip}`, 5))
    return json({ error: "Muitos pedidos em pouco tempo. Tente novamente mais tarde." }, 429);
  const corpo = await request.json().catch(() => ({}));
  const email = limpar(corpo.email, 160).toLowerCase();
  const nome = limpar(corpo.nome || corpo.name, 160);
  const empresa = limpar(corpo.empresa || corpo.company, 160);
  const telefone = limpar(corpo.telefone || corpo.phone, 40);
  const mensagem = limpar(corpo.mensagem || corpo.message, 1000);
  // E-mail e nome são o mínimo para um administrador saber quem está pedindo.
  // Sem e-mail válido não há como convidar depois, então este é o único caso
  // que recusa — e recusa por FORMATO, não por existência de conta.
  if (!emailValido(email)) return json({ error: "Informe um e-mail válido para receber o convite." }, 400);
  if (!nome) return json({ error: "Diga seu nome para o administrador saber quem está pedindo." }, 400);

  const agora = new Date().toISOString();
  try {
    // Um pedido pendente do mesmo e-mail é ATUALIZADO, não duplicado: a fila do
    // administrador não enche de linhas repetidas de quem clicou duas vezes.
    const pendente = await env.DB.prepare(
      "SELECT id FROM todogreen_access_requests WHERE tenant_id=? AND email=? AND status='pending'",
    ).bind(TENANT_ID, email).first().catch(() => null);
    if (pendente?.id) {
      await env.DB.prepare(
        "UPDATE todogreen_access_requests SET name=?, company=?, phone=?, message=?, updated_at=? WHERE id=?",
      ).bind(nome, empresa, telefone, mensagem, agora, pendente.id).run();
      return recebido();
    }
    await env.DB.prepare(
      `INSERT INTO todogreen_access_requests
        (id, tenant_id, email, name, company, phone, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(crypto.randomUUID(), TENANT_ID, email, nome, empresa, telefone, mensagem, agora, agora).run();
  } catch (erro) {
    // Nem o erro vaza estado: registramos no log do servidor e devolvemos o
    // mesmo recebido. Se a tabela ainda não existe (migração não aplicada), o
    // visitante não fica sabendo.
    console.error("todogreen solicitar-acesso", erro);
  }
  return recebido();
}
