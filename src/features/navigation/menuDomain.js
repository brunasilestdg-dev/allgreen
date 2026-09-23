// ===== Menu principal escolhido por quem usa =====
// Camada pura. A regra que manda em tudo aqui, decidida pela titular em
// 31/07/2026: escolher o menu principal NUNCA tira acesso a nada. O que fica
// fora do menu continua alcançável pela lista completa e pela busca. Isto é
// organização de atalho, não permissão.

// Ponto de partida de quem acabou de chegar. Não é "o melhor menu": é um
// começo honesto com o básico de qualquer negócio, para a pessoa não encarar
// 59 itens no primeiro dia. Ela muda em dois cliques.
export const DEFAULT_MENU = [
  "inicio",
  // Falar com o Funcionário é a porta de entrada do app: quem chega para
  // resolver uma coisa simples pede, em vez de procurar em 68 telas.
  "conversar",
  "meu-trabalho",
  "vendas",
  // Orçamentos, Precificação, Reuniões e Notebook entram na curadoria inicial:
  // são fluxos de alto valor que ficavam escondidos em "Todas as ferramentas".
  // Continuam removíveis em dois cliques por Personalizar menu.
  "orcamentos",
  "precificacao",
  "financeiro",
  "contas",
  "agendamentos",
  "reunioes",
  "contatos",
  "operacao",
  "documentos",
  "resultados",
  "notebook",
];

// Itens que não podem sair do menu: sem eles a pessoa perde o caminho de volta.
// "conversar" está aqui porque é a porta de entrada do app — com 68 telas, pedir
// com as próprias palavras é o caminho mais curto para quase tudo, e quem tirar
// isso do menu por engano fica procurando de novo.
export const PINNED = ["inicio", "conversar"];

export const MAX_MENU = 20;
export const MIN_MENU = 1;

const uniq = (lista) => [...new Set(lista.filter(Boolean))];

// Só aceita id que existe de verdade na navegação. Id inventado, vindo de
// preferência antiga ou de versão anterior do app, é descartado em silêncio em
// vez de virar botão quebrado.
export const normalizeMenu = (ids, validIds = []) => {
  const validos = new Set(validIds);
  const escolhidos = uniq(
    (Array.isArray(ids) ? ids : []).map((x) => String(x || "")),
  ).filter((id) => validos.has(id));

  // Os fixos entram sempre, e na frente.
  const fixos = PINNED.filter((id) => validos.has(id));
  const resto = escolhidos.filter((id) => !fixos.includes(id));
  const final = [...fixos, ...resto].slice(0, MAX_MENU);

  // Menu vazio deixaria a pessoa sem navegação nenhuma.
  if (final.length < MIN_MENU) {
    return uniq([...fixos, ...DEFAULT_MENU.filter((id) => validos.has(id))]).slice(
      0,
      MAX_MENU,
    );
  }
  return final;
};

export const isPinned = (id) => PINNED.includes(id);

export const canRemove = (menu, id) =>
  !isPinned(id) && (menu || []).includes(id) && (menu || []).length > MIN_MENU;

export const toggleMenuItem = (menu, id, validIds = []) => {
  const atual = Array.isArray(menu) ? menu : [];
  if (atual.includes(id)) {
    if (!canRemove(atual, id)) return normalizeMenu(atual, validIds);
    return normalizeMenu(
      atual.filter((x) => x !== id),
      validIds,
    );
  }
  if (atual.length >= MAX_MENU) return normalizeMenu(atual, validIds);
  return normalizeMenu([...atual, id], validIds);
};

export const moveMenuItem = (menu, id, direction, validIds = []) => {
  const atual = [...(Array.isArray(menu) ? menu : [])];
  const i = atual.indexOf(id);
  if (i < 0) return normalizeMenu(atual, validIds);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= atual.length) return normalizeMenu(atual, validIds);
  [atual[i], atual[j]] = [atual[j], atual[i]];
  return normalizeMenu(atual, validIds);
};

export const resetMenu = (validIds = []) => normalizeMenu(DEFAULT_MENU, validIds);

// ---------------------------------------------------------------------------
// Montagem da navegação
// ---------------------------------------------------------------------------

// Devolve o menu principal E o resto, para a interface conseguir mostrar os
// dois. Nada some: o que não está no menu vai para "todas as ferramentas".
export const buildNavigation = (nav = [], menu = [], groups = []) => {
  const porId = new Map(nav.map((item) => [item[0], item]));
  const escolhidos = normalizeMenu(menu, [...porId.keys()]);
  const noMenu = new Set(escolhidos);

  const principal = escolhidos.map((id) => porId.get(id)).filter(Boolean);

  // O resto mantém o agrupamento por tema, que ajuda a achar o que se procura.
  const restoPorGrupo = groups
    .map((group) => ({
      label: group.label,
      items: (group.items || [])
        .filter((id) => !noMenu.has(id))
        .map((id) => porId.get(id))
        .filter(Boolean),
    }))
    .filter((g) => g.items.length);

  // Item que existe na navegação mas não está em grupo nenhum não pode sumir.
  const agrupados = new Set(groups.flatMap((g) => g.items || []));
  const soltos = nav.filter(
    (item) => !noMenu.has(item[0]) && !agrupados.has(item[0]),
  );
  if (soltos.length) restoPorGrupo.push({ label: "OUTRAS", items: soltos });

  return { main: principal, rest: restoPorGrupo };
};

// Nada pode ficar inalcançável: todo item da navegação tem de aparecer no menu
// principal OU na lista completa. Serve de rede de segurança para a interface.
export const everythingReachable = (nav = [], menu = [], groups = []) => {
  const { main, rest } = buildNavigation(nav, menu, groups);
  const alcancavel = new Set([
    ...main.map((i) => i[0]),
    ...rest.flatMap((g) => g.items.map((i) => i[0])),
  ]);
  return nav.every((item) => alcancavel.has(item[0]));
};

// ---------------------------------------------------------------------------
// Sugestão pelo uso real
// ---------------------------------------------------------------------------

// Sugere ao lado do que a pessoa abre de verdade, em vez de adivinhar. Só
// sugere, nunca muda o menu sozinho: menu que se reorganiza sozinho faz a
// pessoa perder o botão que ela já tinha decorado.
export const suggestForMenu = (visits = {}, menu = [], validIds = [], limite = 5) => {
  const validos = new Set(validIds);
  const noMenu = new Set(menu || []);
  return Object.entries(visits || {})
    .filter(([id, n]) => validos.has(id) && !noMenu.has(id) && Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limite)
    .map(([id, n]) => ({ id, visits: Number(n) }));
};

// Item que está no menu e a pessoa nunca abriu: candidato a sair, se ela quiser.
export const unusedInMenu = (visits = {}, menu = [], limite = 5) =>
  (menu || [])
    .filter((id) => !isPinned(id) && !Number(visits?.[id]))
    .slice(0, limite);

// As visitas ficam só no aparelho, não no workspace. São um apoio para sugerir
// atalho, não dado do negócio — e gravar o workspace inteiro a cada clique de
// navegação atropelava o estado de telas abertas, além de gerar escrita à toa.
export const VISITS_KEY = "seu-funcionario-menu-visits";

export const readVisits = (storage) => {
  try {
    return JSON.parse(storage?.getItem(VISITS_KEY) || "{}") || {};
  } catch {
    return {};
  }
};

export const writeVisit = (storage, id) => {
  try {
    const atual = countVisit(readVisits(storage), id);
    storage?.setItem(VISITS_KEY, JSON.stringify(atual));
    return atual;
  } catch {
    return {};
  }
};

export const countVisit = (visits = {}, id) => {
  if (!id) return visits || {};
  const atual = { ...(visits || {}) };
  atual[id] = (Number(atual[id]) || 0) + 1;
  return atual;
};
