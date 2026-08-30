// ===== Leitura do que a busca devolve =====
//
// O texto que os provedores entregam vem sujo: prefixos "Title:", markdown
// (##, **, links), restos de pipeline de imagem (":format(webp))") e créditos
// de foto. Nada disso é linguagem de gente — e a titular pediu a plataforma
// sem "linguagem de código". Este módulo limpa o texto, extrai a data da
// notícia quando a fonte a menciona e classifica o tema para as abas do hub
// (ESG, Transportes, Clientes). Puro e testado; worker e telas usam o mesmo.

const MESES = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const dobra = (valor) => String(valor || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function limparResumoDeBusca(texto) {
  let valor = String(texto || "");
  // Prefixos de raspagem e títulos repetidos dentro do corpo.
  valor = valor.replace(/(^|\s)(Title|Description|Summary|URL|Source)\s*:\s*/gi, " ");
  // Imagens e links markdown: a imagem some, o link vira só o rótulo.
  valor = valor.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  valor = valor.replace(/\[([^\]]+)\]\(([^)]*)\)/g, "$1");
  // Cabeçalhos e ênfases markdown.
  valor = valor.replace(/(^|\s)#{1,6}\s+/g, "$1");
  valor = valor.replace(/\*\*([^*]+)\*\*/g, "$1");
  valor = valor.replace(/__([^_]+)__/g, "$1");
  // Restos de pipeline de imagem e créditos de foto entre parênteses.
  valor = valor.replace(/:format\([a-z0-9]+\)\)*/gi, " ");
  valor = valor.replace(/\((?:foto|imagem|cr[eé]dito|divulga[cç][aã]o|reprodu[cç][aã]o)[^)]*\)/gi, " ");
  // Sobra de markdown solto e espaços.
  valor = valor.replace(/[*_]{2,}/g, " ");
  return valor.replace(/\s+/g, " ").trim();
}

const dataValida = (ano, mes, dia) => {
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
};

// Devolve "AAAA-MM-DD" quando o texto menciona uma data, senão "". Convenção do
// repositório: sem dado é vazio, nunca um chute.
export function extrairDataDaNoticia(texto) {
  const valor = String(texto || "");
  const numerica = valor.match(/\b([0-3]?\d)[/.]([01]?\d)[/.](20\d{2})\b/);
  if (numerica) {
    const achada = dataValida(Number(numerica[3]), Number(numerica[2]), Number(numerica[1]));
    if (achada) return achada;
  }
  const iso = valor.match(/\b(20\d{2})-([01]\d)-([0-3]\d)\b/);
  if (iso) {
    const achada = dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (achada) return achada;
  }
  const extensa = dobra(valor).match(/\b([0-3]?\d)\s+de\s+([a-z]+)(?:\s+de)?\s+(20\d{2})\b/);
  if (extensa && MESES[extensa[2]]) {
    const achada = dataValida(Number(extensa[3]), MESES[extensa[2]], Number(extensa[1]));
    if (achada) return achada;
  }
  return "";
}

const TERMOS_ESG = [
  "esg", "carbono", "descarboniza", "sustentab", "emissao", "emissoes",
  "energia limpa", "energia renovavel", "energia solar", "biometano", "eletrifica",
  "frota eletrica", "veiculo eletrico", "veiculos eletricos", "zero emissao", "escopo 3",
  "neutralidade", "credito de carbono", "economia circular",
];

// Tema da notícia para as abas do hub. Cliente vence ESG, e ESG vence
// Transportes: notícia sobre um cliente interessa à carteira mesmo quando o
// assunto é descarbonização.
export function temaDaNoticia(item = {}, nomesDeClientes = []) {
  const texto = dobra(`${item.company || ""} ${item.title || ""} ${item.snippet || ""}`);
  const nomes = (nomesDeClientes || [])
    .map((nome) => dobra(nome).trim())
    .filter((nome) => nome.length >= 4);
  if (dobra(item.company || "").trim() || nomes.some((nome) => texto.includes(nome))) return "clientes";
  if (TERMOS_ESG.some((termo) => texto.includes(termo))) return "esg";
  return "transportes";
}

export const TEMAS_DE_NOTICIA = Object.freeze([
  ["todas", "Todas"],
  ["esg", "ESG"],
  ["transportes", "Transportes"],
  ["clientes", "Clientes"],
]);
