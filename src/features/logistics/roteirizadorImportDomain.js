// Importação de paradas no roteirizador — a lógica pura (sem rede, sem DOM).
//
// Toda entrada de endereço (colar texto, arquivo CSV/Excel, e depois bipagem/
// OCR) cai no MESMO funil: padronizar → validar → geocodificar → o que não
// resolve sozinho vai para a fila de conferência. Aqui ficam as partes que dão
// para testar sem navegador: padronização do texto, leitura das linhas (colar
// ou planilha) e a classificação do resultado da geocodificação. A rede
// (geocodificar) e a tela ficam no componente.

const TETO_PARADAS = 200;

const semAcento = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

// Padroniza o texto do endereço para dar a melhor chance ao geocodificador:
// espaços colapsados, UF de 2 letras em maiúsculo no fim, CEP no formato
// NNNNN-NNN. Não inventa dado nenhum — só normaliza o que veio.
export function padronizarEndereco(bruto) {
  let texto = String(bruto ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return "";
  // CEP: 8 dígitos (com ou sem hífen) → NNNNN-NNN
  texto = texto.replace(/(\d{5})-?(\d{3})(?!\d)/g, "$1-$2");
  // UF de 2 letras como último token, isolado por espaço/vírgula, vira maiúsculo
  texto = texto.replace(/(^|[\s,])([A-Za-zÀ-ÿ]{2})\s*$/u, (m, sep, uf) => `${sep}${uf.toUpperCase()}`);
  return texto;
}

const linhaValida = (endereco) => padronizarEndereco(endereco).length >= 3;

// Uma linha de texto colado vira { referencia, endereco }. Se houver separador
// (TAB, ; ou |), o primeiro campo é a referência (nº do pedido/nota) e o resto
// é o endereço; sem separador, a linha inteira é o endereço.
export function parsearLinhaColada(linha) {
  const partes = String(linha ?? "").split(/[\t;|]/).map((p) => p.trim());
  if (partes.length >= 2) {
    const [referencia, ...resto] = partes;
    return { referencia, endereco: resto.join(", ").replace(/\s+,/g, ",").trim() };
  }
  return { referencia: "", endereco: partes[0] || "" };
}

// Texto colado (uma parada por linha) → lista de { referencia, endereco }
// padronizada, sem linhas vazias/curtas e sem duplicatas exatas.
export function parsearParadasColadas(texto) {
  const vistos = new Set();
  const itens = [];
  for (const linha of String(texto ?? "").split(/\r?\n/)) {
    const { referencia, endereco } = parsearLinhaColada(linha);
    const enderecoPadrao = padronizarEndereco(endereco);
    if (!linhaValida(enderecoPadrao)) continue;
    const chave = `${semAcento(referencia)}|${semAcento(enderecoPadrao)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ referencia: referencia.trim(), endereco: enderecoPadrao });
    if (itens.length >= TETO_PARADAS) break;
  }
  return itens;
}

// CSV/texto delimitado → matriz (linhas × colunas), SEM assumir cabeçalho
// (quem detecta cabeçalho é parsearParadasDePlanilha). Detecta o separador (; ou
// ,) e respeita aspas com separador dentro. É o par do read-excel-file (XLSX):
// os dois entregam uma matriz para o MESMO parser de planilha.
export function csvParaMatriz(texto) {
  const fonte = String(texto ?? "").replace(/^\uFEFF/, "");
  if (!fonte.trim()) return [];
  const primeira = fonte.split(/\r?\n/, 1)[0] || "";
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let linha = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < fonte.length; i += 1) {
    const c = fonte[i];
    if (c === '"') {
      if (aspas && fonte[i + 1] === '"') { celula += '"'; i += 1; }
      else aspas = !aspas;
    } else if (c === sep && !aspas) {
      linha.push(celula.trim());
      celula = "";
    } else if ((c === "\n" || c === "\r") && !aspas) {
      if (c === "\r" && fonte[i + 1] === "\n") i += 1;
      linha.push(celula.trim());
      if (linha.some(Boolean)) linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  linha.push(celula.trim());
  if (linha.some(Boolean)) linhas.push(linha);
  return linhas;
}

const CABECALHOS_ENDERECO = ["endereco", "endereço", "logradouro", "address", "destino", "local"];
const CABECALHOS_REFERENCIA = ["referencia", "referência", "ref", "id", "pedido", "nota", "codigo", "código", "nf"];

// Uma matriz (linhas × colunas) vinda de CSV/Excel → lista de
// { referencia, endereco }. Detecta cabeçalho: se a primeira linha nomeia uma
// coluna de endereço, usa os nomes; senão, cai na heurística "1ª coluna =
// referência, resto = endereço" (ou coluna única = endereço).
export function parsearParadasDePlanilha(matriz) {
  const linhas = (Array.isArray(matriz) ? matriz : []).filter(
    (l) => Array.isArray(l) && l.some((c) => String(c ?? "").trim()),
  );
  if (!linhas.length) return [];
  const primeira = linhas[0].map((c) => semAcento(c));
  const temCabecalho = primeira.some((c) => CABECALHOS_ENDERECO.includes(c));
  let colEndereco = -1;
  let colReferencia = -1;
  let corpo = linhas;
  if (temCabecalho) {
    colEndereco = primeira.findIndex((c) => CABECALHOS_ENDERECO.includes(c));
    colReferencia = primeira.findIndex((c) => CABECALHOS_REFERENCIA.includes(c));
    corpo = linhas.slice(1);
  }
  const vistos = new Set();
  const itens = [];
  for (const linha of corpo) {
    let referencia = "";
    let endereco = "";
    if (temCabecalho && colEndereco >= 0) {
      endereco = String(linha[colEndereco] ?? "").trim();
      referencia = colReferencia >= 0 ? String(linha[colReferencia] ?? "").trim() : "";
    } else {
      const cels = linha.map((c) => String(c ?? "").trim());
      if (cels.length >= 2) {
        referencia = cels[0];
        endereco = cels.slice(1).filter(Boolean).join(", ");
      } else {
        endereco = cels[0] || "";
      }
    }
    const enderecoPadrao = padronizarEndereco(endereco);
    if (!linhaValida(enderecoPadrao)) continue;
    const chave = `${semAcento(referencia)}|${semAcento(enderecoPadrao)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ referencia, endereco: enderecoPadrao });
    if (itens.length >= TETO_PARADAS) break;
  }
  return itens;
}

// Classifica o resultado da geocodificação de UMA parada a partir dos
// candidatos que o geocodificador devolveu:
//   sem candidato → 'falha' (vai para conferência para corrigir o texto)
//   um candidato  → 'ok' (entra direto na rota)
//   vários        → 'ambiguo' (vai para conferência para a pessoa escolher)
export function classificarGeocodificacao(candidatos) {
  const n = Array.isArray(candidatos) ? candidatos.length : 0;
  if (n === 0) return "falha";
  if (n === 1) return "ok";
  return "ambiguo";
}

export function precisaConferencia(status) {
  return status === "falha" || status === "ambiguo";
}

// Resumo da leva para o cabeçalho da importação.
export function resumoImportacao(itens) {
  return (itens || []).reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok" || item.status === "resolvido") acc.prontas += 1;
      else acc.conferencia += 1;
      return acc;
    },
    { total: 0, prontas: 0, conferencia: 0 },
  );
}

export const TETO_PARADAS_IMPORT = TETO_PARADAS;
