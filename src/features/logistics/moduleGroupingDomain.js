// ===== Um nome por tela =====
// Camada pura.
//
// O catálogo tinha 47 itens de menu apontando para 12 telas. "Rotas",
// "Viagens", "Veículos", "Motoristas", "Entregas", "Pacotes" e "Ocorrências"
// eram sete cartões que abriam exatamente a mesma tela de Operações — e quem
// clicava em "Motoristas" esperando um cadastro de motoristas achava que o
// sistema estava quebrado.
//
// A saída não é apagar os nomes: "motorista" é a palavra que a pessoa digita
// na busca. É juntar o que abre a mesma tela num cartão só, e mostrar os
// assuntos que aquela tela cobre. O vocabulário continua servindo para
// encontrar; deixa de fingir que são funções diferentes.

const texto = (v) => String(v ?? "").trim();

const ultimoSegmento = (rota) =>
  texto(rota).split("/").filter(Boolean).pop() || "";

// A tela a que o item leva de verdade. `workspaceRoute` é para onde o clique
// vai; `route` é só o endereço canônico do módulo no catálogo. Agrupar pelo
// segundo manteria os 47 itens separados, que é o problema.
export const telaDoModulo = (modulo) =>
  texto(modulo?.workspaceRoute) || texto(modulo?.route);

// Quem dá nome ao grupo. A ordem importa:
//
//   1. o título que a própria tela já usa na navegação — se a aba se chama
//      "Operações", o cartão não pode se chamar "Rotas";
//   2. o módulo cujo id casa com a rota;
//   3. na falta dos dois, o de menor ordem no catálogo.
const escolherPrincipal = (modulos, rota, titulosPorTela) => {
  const titulo = texto(titulosPorTela[rota]);
  const porId = modulos.find((m) => m.id === ultimoSegmento(rota));
  const porOrdem = [...modulos].sort((a, b) => (a.order || 999) - (b.order || 999))[0];
  const base = porId || porOrdem;
  return { base, nome: titulo || base?.name || "Função" };
};

export const agruparModulosPorTela = (modulos = [], titulosPorTela = {}) => {
  const porTela = new Map();

  for (const modulo of modulos) {
    const rota = telaDoModulo(modulo);
    if (!rota) continue;
    if (!porTela.has(rota)) porTela.set(rota, []);
    porTela.get(rota).push(modulo);
  }

  const grupos = [];
  for (const [rota, itens] of porTela) {
    const { base, nome } = escolherPrincipal(itens, rota, titulosPorTela);

    // Os assuntos são os outros nomes daquela tela. O nome do grupo nunca se
    // repete na lista: "Operações · Operações, Rotas, Viagens" seria ruído.
    const assuntos = [...new Set(itens.map((m) => texto(m.name)))]
      .filter((n) => n && n.toLowerCase() !== nome.toLowerCase())
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    grupos.push({
      id: base?.id || ultimoSegmento(rota),
      rota,
      nome,
      // A descrição do módulo principal descreve a tela; a de um assunto
      // descreveria só uma parte dela.
      descricao: texto(base?.description),
      icone: base?.icon || "Boxes",
      area: base?.area || "administracao",
      order: base?.order ?? 999,
      assuntos,
      // Todos os ids que caem aqui: é o que permite dizer se a tela está
      // liberada sem depender de qual nome a pessoa procurou.
      ids: itens.map((m) => m.id),
    });
  }

  return grupos.sort((a, b) => (a.order || 999) - (b.order || 999));
};

const semAcento = (valor) =>
  String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// Quanto o grupo tem a ver com o que foi digitado. O peso importa: a palavra
// "contrato" aparece na descrição do ESG ("contrato de energia renovável") e é
// o nome de um assunto de Propostas. Sem ranquear, quem procura contrato acha
// ESG primeiro.
export const relevanciaDoGrupo = (grupo, consulta) => {
  const alvo = semAcento(consulta);
  if (!alvo) return 1;
  if (semAcento(grupo.nome).includes(alvo)) return 3;
  if ((grupo.assuntos || []).some((a) => semAcento(a).includes(alvo))) return 2;
  if (semAcento(`${grupo.descricao} ${grupo.area}`).includes(alvo)) return 1;
  return 0;
};

// A busca continua encontrando pelo assunto. Sem isto, juntar os cartões
// esconderia "motorista" e "forecast" — trocaria um problema por outro.
export const grupoAtendeBusca = (grupo, consulta) =>
  relevanciaDoGrupo(grupo, consulta) > 0;

// Os que mais têm a ver primeiro; empate mantém a ordem do catálogo, para a
// lista não dançar a cada tecla digitada.
export const ordenarPorRelevancia = (grupos = [], consulta = "") =>
  [...grupos].sort((a, b) => {
    const diferenca = relevanciaDoGrupo(b, consulta) - relevanciaDoGrupo(a, consulta);
    return diferenca !== 0 ? diferenca : (a.order || 999) - (b.order || 999);
  });

// O que aparece embaixo do nome do cartão. Lista longa demais vira parede de
// texto; o resto fica no "e mais N".
export const resumirAssuntos = (assuntos = [], limite = 5) => {
  if (!assuntos.length) return "";
  if (assuntos.length <= limite) return assuntos.join(" · ");
  return `${assuntos.slice(0, limite).join(" · ")} e mais ${assuntos.length - limite}`;
};
