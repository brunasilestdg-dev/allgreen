// Defesas de rede compartilhadas contra SSRF e exfiltração de segredos.
//
// O rastreador (Sistemas Tracker) já tinha `isBlockedHost`/`safeExternalUrl`
// próprios; o TMS (TRACK3R) chamava a API externa SEM nenhuma dessas defesas —
// bastava configurar `baseUrl` para um host próprio e `tokenEnvKey` para o nome
// de QUALQUER segredo do cofre (BREVO/GEMINI/SEFAZ/SysPag/VAPID…) para recebê-lo
// no cabeçalho. Este módulo é a fonte única dessas regras, para os dois serviços
// usarem o mesmo endurecimento em vez de cada um reimplementar (e um esquecer).

const ipv4DeInteiro = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
};

// Aceita IPv4 pontuado, inteiro decimal, hex (0x...) e octal (0...), devolvendo
// sempre a forma pontuada — é assim que "http://167772160" e "http://0x7f.1"
// deixam de furar o filtro de host privado.
const paraIpv4Pontuado = (host) => {
  const partes = host.split(".");
  if (partes.length === 4 && partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return host;
  }
  if (partes.length === 1) {
    const unico = partes[0];
    if (/^0x[0-9a-f]+$/i.test(unico)) return ipv4DeInteiro(parseInt(unico, 16));
    if (/^0[0-7]+$/.test(unico)) return ipv4DeInteiro(parseInt(unico, 8));
    if (/^\d+$/.test(unico)) return ipv4DeInteiro(parseInt(unico, 10));
  }
  return null;
};

const ipv4Privado = (pontuado) => {
  const o = pontuado.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = o;
  if (a === 0 || a === 127 || a === 10) return true; // this-network, loopback, privado
  if (a === 169 && b === 254) return true; // link-local / metadata de nuvem
  if (a === 192 && b === 168) return true; // privado
  if (a === 172 && b >= 16 && b <= 31) return true; // privado
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast, reservado e broadcast
  return false;
};

// Os 8 grupos de 16 bits de um IPv6 literal, ou null se não for um. Existe
// porque `new URL()` reescreve o host ANTES de qualquer checagem:
// "[::ffff:127.0.0.1]" chega aqui como "[::ffff:7f00:1]", e uma regex que só
// procura o IPv4 pontuado nunca o encontra — era assim que loopback, rede
// privada e metadados da nuvem passavam pelo filtro.
const gruposIpv6 = (literal) => {
  let h = literal.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const cauda = /(^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (cauda) {
    const o = cauda.slice(2, 6).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hexa = `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    h = h.slice(0, cauda.index + cauda[1].length) + hexa;
  }
  const metades = h.split("::");
  if (metades.length > 2) return null;
  const lado = (s) => (s ? s.split(":") : []);
  const esquerda = lado(metades[0]);
  const direita = lado(metades[1]);
  const zeros = metades.length === 2 ? 8 - esquerda.length - direita.length : 0;
  if (metades.length === 2 && zeros < 1) return null;
  const grupos = [...esquerda, ...Array(zeros).fill("0"), ...direita];
  if (grupos.length !== 8 || !grupos.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
};

const ipv4DosGrupos = (alto, baixo) => [alto >> 8, alto & 255, baixo >> 8, baixo & 255].join(".");

const ipv6Privado = (host) => {
  const g = gruposIpv6(host);
  if (!g) return true; // não dá para entender: recusa em vez de chutar
  const zerados = (ate) => g.slice(0, ate).every((n) => n === 0);
  if (zerados(7) && g[7] <= 1) return true; // :: (não especificado) e ::1 (loopback)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (obsoleto)
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv6 que carrega um IPv4 dentro: o destino de verdade é o IPv4.
  const embutido = ipv4DosGrupos(g[6], g[7]);
  if (zerados(5) && (g[5] === 0xffff || g[5] === 0)) return ipv4Privado(embutido); // ::ffff:a.b.c.d e ::a.b.c.d
  if (zerados(4) && g[4] === 0xffff && g[5] === 0) return ipv4Privado(embutido); // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 || ipv4Privado(embutido); // NAT64
  if (g[0] === 0x2002) return ipv4Privado(ipv4DosGrupos(g[1], g[2])); // 6to4
  return false;
};

// IPv6 literal (com ou sem colchetes) que aponta para dentro da rede. Usado
// também pelo webhook de saída, para as duas barreiras terem a mesma regra.
export const isPrivateIpv6Literal = (host) => ipv6Privado(String(host || "").trim().toLowerCase());

// Bloqueia hosts que não devem ser alcançados a partir do servidor (loopback,
// redes privadas, link-local/metadata, domínios internos). Nome de domínio
// comum passa — a resolução real é do runtime; aqui barramos os literais.
export const isBlockedHost = (hostname) => {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.includes(":") || host.startsWith("[")) return ipv6Privado(host);
  const pontuado = paraIpv4Pontuado(host);
  if (pontuado) return ipv4Privado(pontuado);
  return false;
};

// Monta a URL final de uma chamada externa a partir de uma base configurada e
// de um caminho: exige HTTPS, host público, caminho relativo e mesma origem da
// base (um caminho absoluto NÃO pode redirecionar o fetch para outro host).
export const safeExternalUrl = (baseUrl, path, { requireHttps = true } = {}) => {
  let base;
  try {
    base = new URL(String(baseUrl || "").trim());
  } catch {
    throw new Error("Informe uma URL base válida.");
  }
  if ((requireHttps && base.protocol !== "https:") || isBlockedHost(base.hostname)) {
    throw new Error("A URL externa deve usar HTTPS e um endereço público.");
  }
  const relativo = String(path ?? "").trim();
  if (!relativo) throw new Error("Informe o caminho do endpoint.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relativo)) {
    throw new Error("Use um caminho relativo no endpoint da integração.");
  }
  const raiz = `${base.origin}${base.pathname.replace(/\/*$/, "/")}`;
  const url = new URL(relativo.replace(/^\/+/, ""), raiz);
  if (url.origin !== base.origin) {
    throw new Error("O endpoint precisa pertencer à URL base configurada.");
  }
  return url;
};

// Chave de segredo do cofre que o conector TRACK3R (TMS ou rastreador) pode ler:
// só as do próprio conector. Sem isto, uma config apontaria `tokenEnvKey` para
// qualquer segredo e o receberia no cabeçalho da chamada externa.
export const isTrack3rEnvKey = (name) => /^TODOGREEN_TRACK3R_[A-Z0-9_]{1,100}$/.test(String(name || ""));

// O token que VAI no cabeçalho da chamada externa. Dentro do prefixo do
// conector também moram credenciais de ENTRADA — os tokens individuais dos
// webhooks, o segredo do webhook e o da ponte local. Mandar qualquer uma delas
// para a `baseUrl` configurada entregaria a quem configurou a integração o
// poder de forjar eventos e faturas; por isso nunca servem como token de saída.
const ENTRADA_TRACK3R = /^TODOGREEN_TRACK3R_(?:TOKEN_|LOCAL_BRIDGE|WEBHOOK_SECRET)/;
export const isTrack3rOutboundTokenKey = (name) =>
  isTrack3rEnvKey(name) && !ENTRADA_TRACK3R.test(String(name));

// O mesmo para o rastreador (Sistemas Tracker). A config aceitava QUALQUER nome
// de variável — BREVO_API_KEY, WORKSPACE_AI_VAULT_KEY, NFE_CERT_PASSWORD… — e o
// valor ia no cabeçalho para o host que a pessoa escolheu. Agora só segredos do
// próprio conector, e o do webhook (entrada) nunca sai.
export const isTrackerEnvKey = (name) => /^TODOGREEN_TRACKER_[A-Z0-9_]{1,100}$/.test(String(name || ""));
export const isTrackerOutboundTokenKey = (name) =>
  isTrackerEnvKey(name) && !/^TODOGREEN_TRACKER_WEBHOOK_SECRET/.test(String(name));

// Nome de cabeçalho HTTP válido (token RFC 7230), para `authHeaderName` não
// injetar caractere de controle nem cabeçalho extra.
export const isSafeHeaderName = (name) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(String(name || ""));
