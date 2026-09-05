// ===== SearchableSelect — lógica pura (testável sem DOM) =====
//
// O coração do combobox moderno: normalizar texto (sem acento, sem caixa),
// filtrar opções por trecho e agrupar. Fica separado do componente para os
// testes travarem o comportamento de busca — a parte de DOM/teclado é fina.

// "Operação Ração" -> "operacao racao": busca por "racao" acha "Ração".
export const normalizar = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Uma opção casa quando o termo aparece no rótulo, na descrição ou nas
// palavras-chave. Termo vazio casa tudo (a lista inteira aparece).
export const opcaoCasa = (opcao, termo) => {
  const t = normalizar(termo);
  if (!t) return true;
  const alvo = normalizar(
    [opcao?.label, opcao?.description, ...(Array.isArray(opcao?.keywords) ? opcao.keywords : [])].join(" "),
  );
  return alvo.includes(t);
};

// Filtra preservando a ordem recebida (o chamador ordena antes se quiser
// "recentes"/"favoritos" no topo).
export const filtrarOpcoes = (opcoes, termo) =>
  (Array.isArray(opcoes) ? opcoes : []).filter((o) => o && !o.disabled && opcaoCasa(o, termo));

// Agrupa por `opcao.group` mantendo a ordem de primeira aparição de cada grupo.
// Opções sem grupo caem em "" (o componente renderiza sem cabeçalho).
export const agruparOpcoes = (opcoes) => {
  const ordem = [];
  const mapa = new Map();
  for (const o of Array.isArray(opcoes) ? opcoes : []) {
    const g = o?.group || "";
    if (!mapa.has(g)) { mapa.set(g, []); ordem.push(g); }
    mapa.get(g).push(o);
  }
  return ordem.map((g) => ({ group: g, options: mapa.get(g) }));
};

// Índice do próximo item navegável (setas), pulando desabilitados e dando a
// volta nas pontas. `direcao` = +1 (baixo) ou -1 (cima).
export const proximoIndice = (opcoes, atual, direcao) => {
  const lista = Array.isArray(opcoes) ? opcoes : [];
  if (!lista.length) return -1;
  let i = atual;
  for (let passo = 0; passo < lista.length; passo += 1) {
    i = (i + direcao + lista.length) % lista.length;
    if (!lista[i]?.disabled) return i;
  }
  return -1;
};
