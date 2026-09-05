// ===== POD do motorista: peças puras da captura (#120b) =====
//
// A parte que dá para testar sem DOM nem canvas: a matemática do redimensionamento
// e a leitura/validação de um data URL de imagem. O desenho no canvas (câmera,
// assinatura) vive na tela; aqui fica só o que é função pura — e é aqui que os
// testes travam os limites (nunca ampliar, só imagem, teto de tamanho).
//
// Compartilhado entre o front (que reduz a imagem antes de enviar) e o worker
// (que valida o que chegou antes de guardar no cofre) — mesmo módulo, mesma régua.

// Teto do lado maior da imagem enviada. 1280px cobre um canhoto legível e mantém
// o JPEG em dezenas de KB, que é o que faz a foto caber na fila offline do
// celular (localStorage ~5 MB) sem estourar.
export const LADO_MAXIMO_PADRAO = 1280;

// Teto do tamanho decodificado que o servidor aceita. O front já reduz; isto é
// defesa contra payload abusivo, não o caminho normal. 2 MB é folga generosa
// para uma imagem de 1280px.
export const BYTES_MAXIMOS_IMAGEM = 2 * 1024 * 1024;

// Reduz (largura, altura) para caber num quadrado de `maxLado`, preservando a
// proporção. NUNCA amplia: uma foto já pequena sai igual (ampliar só inventa
// pixel e engorda o arquivo). Devolve inteiros.
export const dimensoesReduzidas = (largura, altura, maxLado = LADO_MAXIMO_PADRAO) => {
  const l = Number(largura);
  const a = Number(altura);
  const teto = Number(maxLado);
  if (!Number.isFinite(l) || !Number.isFinite(a) || l <= 0 || a <= 0) return { largura: 0, altura: 0 };
  if (!Number.isFinite(teto) || teto <= 0) return { largura: Math.round(l), altura: Math.round(a) };
  const maior = Math.max(l, a);
  if (maior <= teto) return { largura: Math.round(l), altura: Math.round(a) };
  const fator = teto / maior;
  // Pelo menos 1px em cada lado: uma imagem 4000x1 não pode virar 1280x0.
  return { largura: Math.max(1, Math.round(l * fator)), altura: Math.max(1, Math.round(a * fator)) };
};

// Lê um data URL `data:<mime>;base64,<dados>` e devolve { mime, base64 } — ou
// null se não for esse formato. Tolera espaços/quebras que alguns navegadores
// metem no meio do base64.
export const interpretarDataUrl = (dataUrl) => {
  const texto = String(dataUrl ?? "").trim();
  const casa = /^data:([a-z0-9.+/-]+);base64,([\s\S]+)$/i.exec(texto);
  if (!casa) return null;
  const mime = casa[1].toLowerCase();
  const base64 = casa[2].replace(/\s+/g, "");
  if (!base64) return null;
  return { mime, base64 };
};

// Só imagem entra como comprovante/assinatura. PDF, vídeo e afins ficam de fora
// deste caminho — o cofre de documentos é outra porta.
export const ehImagem = (mime) => /^image\//i.test(String(mime ?? ""));

// Tamanho decodificado (bytes) de um base64, sem decodificar de verdade: cada 4
// caracteres viram 3 bytes, menos o padding `=`. Serve para barrar o grande
// demais antes de alocar a imagem inteira na memória.
export const bytesDoBase64 = (base64) => {
  const limpo = String(base64 ?? "").replace(/\s+/g, "");
  if (!limpo) return 0;
  const padding = limpo.endsWith("==") ? 2 : limpo.endsWith("=") ? 1 : 0;
  return Math.floor((limpo.length * 3) / 4) - padding;
};

// Um data URL de imagem é "válido para guardar" quando: tem o formato, o mime é
// de imagem e o tamanho decodificado não passa do teto. Devolve
// { mime, base64, bytes } ou uma string com o motivo da recusa (para virar 400).
export const validarImagemDataUrl = (dataUrl, bytesMaximos = BYTES_MAXIMOS_IMAGEM) => {
  const lido = interpretarDataUrl(dataUrl);
  if (!lido) return "Formato de imagem não reconhecido.";
  if (!ehImagem(lido.mime)) return "O comprovante precisa ser uma imagem.";
  const bytes = bytesDoBase64(lido.base64);
  if (bytes <= 0) return "A imagem está vazia.";
  if (bytes > bytesMaximos) return "A imagem é grande demais.";
  return { mime: lido.mime, base64: lido.base64, bytes };
};
