// ===== Régua ESG: fatores de CO₂ + pesos do Green Score, editáveis =====
//
// O número ESG do simulador (CO₂ evitado, Green Score) nasce de fatores de
// emissão e de pesos. Antes eram constante no código; agora viram régua
// versionada e editável. Este domínio é a parte pura: pega o que foi gravado e
// mescla POR CIMA dos defaults, saneando — só chaves conhecidas entram, e só
// com valor válido. É a trava que impede uma régua torta de envenenar o motor:
// campo faltando ou inválido cai no default de fábrica, nunca em lixo.

const numeroPositivo = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const numeroNaoNegativo = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// Fatores: só as chaves que existem no default. Números têm de ser positivos
// (um fator zero ou negativo não faz sentido físico e zeraria/invertia o CO₂).
// `methodologyVersion` é texto — mantém o rótulo se vier preenchido.
export function sanitizarFatores(entrada, defaults) {
  const base = { ...defaults };
  const dados = entrada && typeof entrada === "object" ? entrada : {};
  for (const chave of Object.keys(defaults)) {
    if (chave === "methodologyVersion") {
      const texto = String(dados[chave] ?? "").trim();
      if (texto) base[chave] = texto;
      continue;
    }
    const valor = numeroPositivo(dados[chave]);
    if (valor != null) base[chave] = valor;
  }
  return base;
}

// Pesos do Green Score: só chaves conhecidas; peso pode ser 0 (desliga o
// componente), então aceita não-negativo. Se todos zerarem, quem soma trata o
// divisor — aqui só saneamos entrada.
export function sanitizarPesos(entrada, defaults) {
  const base = { ...defaults };
  const dados = entrada && typeof entrada === "object" ? entrada : {};
  for (const chave of Object.keys(defaults)) {
    const valor = numeroNaoNegativo(dados[chave]);
    if (valor != null) base[chave] = valor;
  }
  return base;
}

/**
 * Régua ESG resolvida a partir do que foi gravado e dos defaults de fábrica.
 * `gravado` = { factors, weights } (o que veio do banco, já como objeto).
 * Devolve { fatores, pesos } prontos para o motor.
 */
export function resolverReguaEsg(gravado, { fatoresPadrao, pesosPadrao }) {
  const g = gravado && typeof gravado === "object" ? gravado : {};
  return {
    fatores: sanitizarFatores(g.factors, fatoresPadrao),
    pesos: sanitizarPesos(g.weights, pesosPadrao),
  };
}
