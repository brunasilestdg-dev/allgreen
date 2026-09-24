// ===== Extensão do navegador: o que a interface precisa saber =====
//
// Camada pura, sem React e sem navegador. Usada pelo cartão de Configurações
// do app geral, pelo "Meu perfil" da To Do Green e pelo build que empacota a
// pasta extension/ (scripts/extension-package.js).
//
// A extensão sempre existiu no repositório, mas não chegava a ninguém: a tela
// mandava carregar "a pasta extension/ do projeto", que nenhuma pessoa usuária
// tem, e o token só aparecia nas Configurações do app geral. Agora o build
// publica o pacote como arquivo estático e as duas casas mostram o mesmo passo
// a passo.

export const EXTENSION_ZIP_FILE = "extensao-todogreen.zip";
export const EXTENSION_ZIP_URL = `/${EXTENSION_ZIP_FILE}`;
// Pasta que aparece ao descompactar: é ela que se escolhe em "Carregar sem
// compactação".
export const EXTENSION_ZIP_FOLDER = "extensao-todogreen";

// Espelha SESSION_TTL_SECONDS (worker/auth/credenciais.js). O token copiado é
// o da sessão, que vence em 24 horas — dizer isso na tela poupa a pessoa de
// achar que a extensão quebrou no dia seguinte. Um teste trava os dois juntos.
export const EXTENSION_TOKEN_TTL_HOURS = 24;

export const maskToken = (token) =>
  token ? `${String(token).slice(0, 6)}${"•".repeat(12)}` : "";

export const EXTENSION_INSTALL_STEPS = Object.freeze([
  `Baixe o pacote e descompacte a pasta ${EXTENSION_ZIP_FOLDER}.`,
  "No Chrome, Edge ou Brave, abra chrome://extensions e ligue o Modo do desenvolvedor.",
  "Clique em Carregar sem compactação e escolha a pasta descompactada.",
  `Copie o token abaixo e cole em Config, na extensão. Ele vale por ${EXTENSION_TOKEN_TTL_HOURS} horas: quando entrar de novo no app, copie o novo.`,
]);
