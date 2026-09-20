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
  return false;
};

const ipv6Privado = (host) => {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true; // loopback / não especificado
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 unique-local
  const mapeado = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4 mapeado
  if (mapeado) return ipv4Privado(mapeado[1]);
  return false;
};

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

// Nome de cabeçalho HTTP válido (token RFC 7230), para `authHeaderName` não
// injetar caractere de controle nem cabeçalho extra.
export const isSafeHeaderName = (name) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(String(name || ""));
