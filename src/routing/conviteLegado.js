// Link antigo de convite, no formato `?convite=CÓDIGO`. Ele chamava
// /api/collab/join, rota que não existe mais (o Worker respondia 404). O
// convite hoje vive em /convite/:token (AcceptInvite), que valida o token e
// serve quem tem ou não tem conta — então o link antigo só é redirecionado.
// Devolve o destino, ou "" quando não há convite legível na URL.
export const destinoDoConviteLegado = (search) => {
  const m = String(search || "").match(/[?&]convite=([^&]+)/);
  if (!m) return "";
  let codigo = "";
  try {
    codigo = decodeURIComponent(m[1]).trim();
  } catch {
    return "";
  }
  return codigo ? `/convite/${encodeURIComponent(codigo)}` : "";
};
