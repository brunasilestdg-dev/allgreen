// ===== Código de barras CODE-128C da chave de acesso =====
//
// O DACTE (e o DAMDFE/DANFE) imprime a chave de acesso de 44 dígitos em
// CODE-128 no conjunto C, que codifica os dígitos dois a dois. O PDF saía só
// com a chave em texto — e é pelo código de barras que a portaria, o posto
// fiscal e o recebedor leem o documento.
//
// Camada pura: devolve os módulos ("1" = barra, "0" = espaço) e quem desenha é
// a tela, com o jsPDF que já existe. Sem biblioteca nova. O teste decodifica o
// resultado com o leitor do @zxing (que o app já usa para ler etiqueta), então
// um erro na tabela abaixo não passaria despercebido.

// Larguras barra/espaço de cada símbolo do CODE-128 (valores 0–106).
const PADROES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];
const INICIO_C = 105;
const PARADA = 106;

const larguraParaModulos = (padrao) =>
  [...padrao]
    .map((largura, indice) => (indice % 2 === 0 ? "1" : "0").repeat(Number(largura)))
    .join("");

/**
 * Módulos do CODE-128C para uma sequência com quantidade PAR de dígitos
 * (a chave de acesso tem 44). Devolve "" para entrada inválida: melhor não
 * imprimir código nenhum do que imprimir um que o leitor não reconhece.
 */
export function code128cModules(digitos) {
  const valor = String(digitos ?? "");
  if (!valor || valor.length % 2 !== 0 || !/^\d+$/.test(valor)) return "";
  const simbolos = [INICIO_C];
  for (let indice = 0; indice < valor.length; indice += 2)
    simbolos.push(Number(valor.slice(indice, indice + 2)));
  const soma = simbolos.reduce(
    (total, simbolo, posicao) => total + simbolo * Math.max(posicao, 1),
    0,
  );
  simbolos.push(soma % 103, PARADA);
  return simbolos.map((simbolo) => larguraParaModulos(PADROES[simbolo])).join("");
}

// "35260912345678000190570010000000011000000019" → "3526 0912 3456 ..."
export const formatarChaveDeAcesso = (chave) =>
  String(chave ?? "")
    .replace(/\D/g, "")
    .replace(/(\d{4})(?=\d)/g, "$1 ");
