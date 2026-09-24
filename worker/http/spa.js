// ===== Fallback do SPA =====
//
// Contrato
// - Recebe: `request`, `env` (com o binding ASSETS) e `url`.
// - Devolve: o asset pedido. Quando é HTML, com x-frame-options DENY e, nas
//   superfícies privadas (portais e entrada da vertical), x-robots-tag
//   noindex. O resto sai como o ASSETS entregou.
// - Quem chama: o roteador (worker/http/router.js), para o que nenhuma rota
//   da tabela respondeu.
// - Autorização: nenhuma — é o shell público do app; os dados continuam
//   atrás das rotas autenticadas.

// Fallback: serve o SPA. Envelopa o HTML com cabeçalhos de segurança —
// os portais externos (cliente/motorista/colaborador) e a entrada da
// vertical são rotas React DENTRO deste shell, então precisam de
// anti-clickjacking (sempre) e noindex nas superfícies privadas. Sites e
// formulários públicos têm handlers próprios e não passam por aqui.
export async function servirSpa(request, env, url) {
  const assetResp = await env.ASSETS.fetch(request);
  const contentType = assetResp.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return assetResp;
  const headers = new Headers(assetResp.headers);
  headers.set("x-frame-options", "DENY");
  if (/^\/(portal-cliente|portal-motorista|portal-colaborador|todogreen)(\/|$)/.test(url.pathname)) {
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  return new Response(assetResp.body, {
    status: assetResp.status,
    statusText: assetResp.statusText,
    headers,
  });
}
