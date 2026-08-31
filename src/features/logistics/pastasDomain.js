// ===== Pastas do cofre de documentos: privadas, compartilhadas e por área =====
//
// O cofre organizava por CLIENTE e por TIPO, e mais nada. Quem tinha acesso à
// vertical via todos os documentos do espaço — não havia como guardar a
// proposta que ainda não é para todo mundo, nem separar o que é de Financeiro
// do que é de Operações.
//
// Quatro visibilidades, e a mais restritiva é o padrão de quem não escolheu.
// O vocabulário é o mesmo que o Planner já usa (`private`/`shared` +
// `members_json`, migração 0077): inventar um segundo vocabulário para a mesma
// ideia obrigaria quem lê o código a saber os dois.
//
// A REGRA QUE MAIS IMPORTA está em `pastasVisiveis`: só se vê uma pasta quando
// se vê TODA a linhagem dela. Uma subpasta compartilhada dentro de uma pasta
// privada continua invisível — do contrário bastaria criar uma subpasta
// "shared" para vazar o que o pai protege, e ninguém que arrasta um documento
// para dentro de uma pasta pensa nisso.

const texto = (valor, max = 200) => String(valor ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const VISIBILIDADES = Object.freeze([
  {
    id: "private",
    rotulo: "Privada",
    ajuda: "Só você e as pessoas que você listar.",
  },
  {
    id: "area",
    rotulo: "Da área",
    ajuda: "Quem tem a permissão escolhida. Ex.: só Financeiro, só Operações.",
  },
  {
    id: "shared",
    rotulo: "Do espaço",
    ajuda: "Todo mundo com acesso à vertical.",
  },
]);

export const visibilidadeValida = (valor) => {
  const chave = texto(valor, 20).toLowerCase();
  return VISIBILIDADES.some((item) => item.id === chave) ? chave : "private";
};

// As permissões que podem reger uma pasta "da área". A lista é fechada de
// propósito: pasta apontando para uma permissão que não existe no mapa seria
// pasta que ninguém vê, e a pessoa levaria semanas para descobrir por quê.
export const PERMISSOES_DE_AREA = Object.freeze([
  { id: "finance:manage", rotulo: "Financeiro" },
  { id: "operations:manage", rotulo: "Operações" },
  { id: "crm:manage", rotulo: "Comercial" },
  { id: "proposal:manage", rotulo: "Propostas" },
  { id: "compliance:manage", rotulo: "Habilitação e RFQ" },
  { id: "hr:manage", rotulo: "Pessoas" },
  { id: "fleet:manage", rotulo: "Frota" },
  { id: "esg:manage", rotulo: "ESG" },
  { id: "audit:read", rotulo: "Auditoria" },
]);

export const permissaoDeAreaValida = (valor) => {
  const chave = texto(valor, 60);
  return PERMISSOES_DE_AREA.some((item) => item.id === chave) ? chave : "";
};

const listaDeTexto = (valor, max = 200) =>
  (Array.isArray(valor) ? valor : [])
    .map((item) => texto(item, 200).toLowerCase())
    .filter(Boolean)
    .slice(0, max);

export const normalizarPasta = (bruto = {}) => ({
  id: texto(bruto.id, 120),
  paiId: texto(bruto.paiId || bruto.parentId, 120),
  nome: texto(bruto.nome || bruto.name, 160),
  visibilidade: visibilidadeValida(bruto.visibilidade),
  // Membros por E-MAIL, não por id de usuário: é o e-mail que a titular digita
  // ao convidar, é o que o vínculo da vertical guarda, e é o que continua
  // funcionando quando a pessoa ainda não abriu o produto pela primeira vez.
  membros: listaDeTexto(bruto.membros),
  permissaoDaArea: permissaoDeAreaValida(bruto.permissaoDaArea),
  donoEmail: texto(bruto.donoEmail, 200).toLowerCase(),
  descricao: texto(bruto.descricao, 500),
  revision: Number(bruto.revision || 0),
});

// ---- Quem vê uma pasta, olhando só para ela ----
export const podeVerPastaSozinha = (pasta = {}, quem = {}) => {
  const item = normalizarPasta(pasta);
  const email = texto(quem.email, 200).toLowerCase();
  const papel = texto(quem.papel, 40).toLowerCase();
  const permissoes = new Set((quem.permissoes || []).map((valor) => texto(valor, 60)));
  const tudo = ["owner", "admin"].includes(papel) || permissoes.has("*");

  // Dona e administração veem tudo — inclusive o privado de terceiros. Não é
  // descuido: é quem responde pelo espaço, e fingir o contrário criaria um
  // canto do produto onde a titular não consegue achar um documento da própria
  // empresa. Ela sabe disso; a tela diz de quem é a pasta.
  if (tudo) return true;

  if (item.visibilidade === "shared") return true;
  if (item.visibilidade === "private")
    return Boolean(email) && (item.donoEmail === email || item.membros.includes(email));
  // "area": a permissão manda. Pasta de área sem permissão escolhida não é
  // aberta a todos — é fechada, porque abrir por engano é o erro caro.
  if (!item.permissaoDaArea) return Boolean(email) && item.donoEmail === email;
  return permissoes.has(item.permissaoDaArea);
};

// ---- Quem vê uma pasta de verdade: a linhagem inteira ----
//
// Sem isto, uma subpasta "do espaço" criada dentro de uma pasta privada
// vazaria o conteúdo que o pai protege — e é justamente o que acontece quando
// alguém organiza sem pensar em permissão.
export const podeVerPasta = (pastas = [], id = "", quem = {}) => {
  const porId = new Map(pastas.map((pasta) => [normalizarPasta(pasta).id, normalizarPasta(pasta)]));
  let atual = porId.get(texto(id, 120));
  if (!atual) return false;
  const visitados = new Set();
  while (atual) {
    // Ciclo no cadastro não pode virar laço infinito no servidor.
    if (visitados.has(atual.id)) return false;
    visitados.add(atual.id);
    if (!podeVerPastaSozinha(atual, quem)) return false;
    if (!atual.paiId) return true;
    const pai = porId.get(atual.paiId);
    // Pai que não existe (foi arquivado): a pasta fica órfã. Tratar como
    // visível seria promover conteúdo escondido a conteúdo público.
    if (!pai) return false;
    atual = pai;
  }
  return true;
};

export const pastasVisiveis = (pastas = [], quem = {}) =>
  pastas.filter((pasta) => podeVerPasta(pastas, normalizarPasta(pasta).id, quem));

// ---- Caminho e árvore ----
export const caminhoDaPasta = (pastas = [], id = "") => {
  const porId = new Map(pastas.map((pasta) => [normalizarPasta(pasta).id, normalizarPasta(pasta)]));
  const trilha = [];
  const visitados = new Set();
  let atual = porId.get(texto(id, 120));
  while (atual && !visitados.has(atual.id)) {
    visitados.add(atual.id);
    trilha.unshift(atual);
    atual = atual.paiId ? porId.get(atual.paiId) : null;
  }
  return trilha;
};

export const arvoreDePastas = (pastas = []) => {
  const normalizadas = pastas.map(normalizarPasta);
  const porPai = new Map();
  for (const pasta of normalizadas) {
    const chave = pasta.paiId || "";
    if (!porPai.has(chave)) porPai.set(chave, []);
    porPai.get(chave).push(pasta);
  }
  const montar = (paiId, profundidade, visitados) => (porPai.get(paiId) || [])
    .filter((pasta) => !visitados.has(pasta.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((pasta) => ({
      ...pasta,
      profundidade,
      filhas: montar(pasta.id, profundidade + 1, new Set([...visitados, pasta.id])),
    }));
  // Só entra na raiz quem não tem pai OU cujo pai não existe na lista — órfã
  // some da árvore se não for tratada, e some sem avisar.
  const ids = new Set(normalizadas.map((pasta) => pasta.id));
  const orfas = normalizadas.filter((pasta) => pasta.paiId && !ids.has(pasta.paiId));
  return [
    ...montar("", 0, new Set()),
    ...orfas.map((pasta) => ({ ...pasta, profundidade: 0, orfa: true, filhas: [] })),
  ];
};

// ---- As duas travas do cadastro ----
//
// Mover uma pasta para dentro da própria descendência transforma a árvore em
// anel: a tela entra em laço e o conteúdo desaparece das duas pontas.
export const criaCiclo = (pastas = [], id = "", novoPaiId = "") => {
  const alvo = texto(id, 120);
  const destino = texto(novoPaiId, 120);
  if (!alvo || !destino) return false;
  if (alvo === destino) return true;
  const porId = new Map(pastas.map((pasta) => [normalizarPasta(pasta).id, normalizarPasta(pasta)]));
  const visitados = new Set();
  let atual = porId.get(destino);
  while (atual) {
    if (visitados.has(atual.id)) return true;
    visitados.add(atual.id);
    if (atual.id === alvo) return true;
    atual = atual.paiId ? porId.get(atual.paiId) : null;
  }
  return false;
};

// Duas irmãs com o mesmo nome viram duas pastas indistinguíveis na tela, e o
// documento cai em uma delas sem ninguém saber qual.
export const nomeDisponivel = (pastas = [], { id = "", paiId = "", nome = "" } = {}) => {
  const alvo = texto(nome, 160).toLocaleLowerCase("pt-BR");
  if (!alvo) return false;
  return !pastas
    .map(normalizarPasta)
    .some((pasta) => pasta.id !== texto(id, 120)
      && (pasta.paiId || "") === texto(paiId, 120)
      && pasta.nome.toLocaleLowerCase("pt-BR") === alvo);
};

export const problemaDaPasta = (pastas = [], pasta = {}) => {
  const item = normalizarPasta(pasta);
  if (!item.nome) return "Dê um nome à pasta.";
  if (item.paiId && criaCiclo(pastas, item.id, item.paiId))
    return "Uma pasta não pode ficar dentro de si mesma nem de uma subpasta dela.";
  if (!nomeDisponivel(pastas, item)) return "Já existe uma pasta com esse nome no mesmo lugar.";
  if (item.visibilidade === "area" && !item.permissaoDaArea)
    return "Escolha de qual área é a pasta — sem isso ninguém além de você a veria.";
  // O dono NÃO é checado aqui: ele é carimbado pelo servidor a partir da
  // sessão, então nunca chega vazio de verdade. Exigi-lo nesta função só
  // impediria a tela de criar a primeira pasta privada, que é o caso mais
  // comum.
  return "";
};

// ---- Os arquivos ----
//
// Arquivo em pasta que a pessoa não vê não aparece. Arquivo SEM pasta continua
// visível a quem tem acesso ao cofre: é onde está tudo o que já existia, e
// esconder o acervo antigo numa migração seria o mesmo que apagá-lo.
export const arquivosVisiveis = (arquivos = [], pastas = [], quem = {}) => {
  const permitidas = new Set(pastasVisiveis(pastas, quem).map((pasta) => normalizarPasta(pasta).id));
  return arquivos.filter((arquivo) => {
    const pasta = texto(arquivo.folderId || arquivo.pastaId, 120);
    return !pasta || permitidas.has(pasta);
  });
};

export const contarPorPasta = (arquivos = []) => {
  const contagem = new Map();
  for (const arquivo of arquivos) {
    const chave = texto(arquivo.folderId || arquivo.pastaId, 120);
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  }
  return contagem;
};
