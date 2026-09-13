// ===== Importação de paradas em massa =====
//
// Cadastrar operação a operação, no formulário de 17 campos, é o gargalo para
// pôr um dia inteiro de entregas no roteirizador. Aqui a pessoa cola uma lista
// — uma parada por linha — e o painel cria todas, geocodificando o endereço de
// entrega (é a coordenada que torna a operação roteirizável).
//
// Formato de cada linha: separadores aceitos são TAB, ";" ou "|". O PRIMEIRO
// campo é a referência (NF, pedido, código); o RESTO é o endereço de entrega.
// Uma linha com um só campo usa-o como endereço (a referência repete o texto).
// Linhas em branco são ignoradas. Nada de coluna obrigatória decorada: o mínimo
// que serve é "endereço" por linha; "referência; endereço" é o uso pleno.

const LIMITE_PADRAO = 100;

export function parseParadasEmMassa(texto, { limite = LIMITE_PADRAO } = {}) {
  const linhas = String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  const paradas = [];
  for (const linha of linhas) {
    const partes = linha.split(/[\t;|]/).map((parte) => parte.trim()).filter(Boolean);
    if (!partes.length) continue;
    if (partes.length === 1) {
      paradas.push({ referencia: partes[0], destino: partes[0] });
    } else {
      const [referencia, ...resto] = partes;
      paradas.push({ referencia, destino: resto.join(", ") });
    }
    if (paradas.length >= limite) break;
  }
  return paradas;
}

// Quantas linhas o texto tem além do limite — a tela avisa que o excedente fica
// de fora, em vez de cortar silenciosamente.
export function excedenteDeParadas(texto, { limite = LIMITE_PADRAO } = {}) {
  const total = String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean).length;
  return Math.max(0, total - limite);
}

// Resumo em português de um lote importado, para o toast final. Puro para a
// mensagem ser a mesma onde quer que apareça.
export function resumoDaImportacao({ criadas = 0, semCoordenada = 0, falhas = 0 } = {}) {
  const partes = [`${criadas} parada(s) criada(s)`];
  if (semCoordenada > 0) partes.push(`${semCoordenada} sem coordenada (não entra(m) no roteirizador até localizar o endereço)`);
  if (falhas > 0) partes.push(`${falhas} falha(s)`);
  return `${partes.join(" · ")}.`;
}

export const LIMITE_PARADAS_IMPORTACAO = LIMITE_PADRAO;
