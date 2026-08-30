// ===== O vaivém do contrato entre Comercial e Jurídico =====
//
// O fluxo real da titular (30/08): o cliente envia o contrato, o Comercial
// registra e encaminha, o Jurídico devolve OS PONTOS EM QUE NÃO CONCORDA, o
// Comercial alinha com o cliente e o Jurídico valida a versão final. Este
// módulo guarda só o que é regra desse vaivém — os pontos de discordância e
// com quem está a bola. A máquina do processo (aprovação, prazo, histórico)
// continua no motor de workflows corporativos; aqui é o conteúdo da
// negociação, não a máquina.

const texto = (valor, max) => String(valor ?? "").trim().slice(0, max);

// Um ponto por linha, como quem cola o e-mail do jurídico. Linha vazia não
// vira ponto; teto de 40 pontos e 500 caracteres para o JSON não crescer sem
// limite dentro do workflow.
export const pontosDeTexto = (bruto) =>
  String(bruto ?? "")
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((linha) => ({ id: crypto.randomUUID(), texto: linha.slice(0, 500), status: "aberto" }));

// O JSON vem do banco e, antes dele, do navegador: forma nunca é garantida.
export const normalizarPontos = (lista) =>
  (Array.isArray(lista) ? lista : [])
    .map((ponto) => ({
      id: texto(ponto?.id, 60) || crypto.randomUUID(),
      texto: texto(ponto?.texto, 500),
      status: ponto?.status === "acordado" ? "acordado" : "aberto",
    }))
    .filter((ponto) => ponto.texto);

export const alternarPonto = (lista, id) =>
  normalizarPontos(lista).map((ponto) =>
    ponto.id === id
      ? { ...ponto, status: ponto.status === "acordado" ? "aberto" : "acordado" }
      : ponto,
  );

export const resumoDosPontos = (lista) => {
  const pontos = normalizarPontos(lista);
  const acordados = pontos.filter((ponto) => ponto.status === "acordado").length;
  return {
    total: pontos.length,
    acordados,
    abertos: pontos.length - acordados,
    texto: pontos.length === 0 ? "" : `${acordados} de ${pontos.length} ponto(s) acordado(s)`,
    resolvido: pontos.length > 0 && acordados === pontos.length,
  };
};

// "Com quem está a bola": só existem os dois lados do vaivém.
export const outroLado = (lado) => (lado === "juridico" ? "comercial" : "juridico");
export const rotuloDoLado = (lado) => (lado === "juridico" ? "Jurídico" : "Comercial");
