// ===== OCPI · Roaming de recarga (bloco 14) =====
// Camada pura. Sem HTTP, sem estado global.
//
// OCPI (Open Charge Point Interface) é como redes de eletroposto conversam
// entre si — a rede A reconhece o cartão/app do cliente B. Este módulo cuida
// da IDENTIFICAÇÃO padronizada (party id, evse uid, token uid) e do rateio
// básico de sessão quando o cliente carrega em rede parceira.
//
// Princípios:
// 1. Identificadores OCPI seguem a norma (country_code 2 letras ISO, party_id
//    3 letras, id da EVSE com formato ISO 15118). Não gerar variação — a rede
//    parceira recusa.
// 2. Sessão roaming NÃO paga o motorista/empresa em cascata: quem cobra é a
//    rede da estação (CPO) e quem repassa é a rede do cliente (eMSP), sempre
//    com tarifa e taxa de roaming CLARAS. O rateio abaixo separa os três lados
//    (motorista/empresa · CPO · eMSP) para que o extrato conte a verdade.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arredondarReais = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

// País e "party id" OCPI.
export const isCountryCode = (v) => /^[A-Z]{2}$/.test(String(v || ""));
export const isPartyId = (v) => /^[A-Z0-9]{3}$/.test(String(v || ""));

// EVSE UID e Connector ID — formato tolerante (a norma permite letras/dígitos
// e hífen; comprimento até 36). Vazio é inválido.
export const isEvseUid = (v) => /^[A-Z0-9*\-.]{1,36}$/.test(String(v || "").toUpperCase());
export const isConnectorId = (v) => /^[A-Z0-9*\-.]{1,4}$/.test(String(v || "").toUpperCase());

// Location "id" na notação OCPI 2.2: <country_code>*<party_id>*L<local id>
export const buildLocationId = ({ countryCode, partyId, localId }) => {
  const cc = String(countryCode || "").toUpperCase();
  const pi = String(partyId || "").toUpperCase();
  const li = String(localId || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!isCountryCode(cc) || !isPartyId(pi) || !li) return null;
  return `${cc}*${pi}*L${li}`;
};

// EVSE "uid" completo: <location_id>*E<evse local>
export const buildEvseUid = (locationId, evseLocal) => {
  if (!locationId) return null;
  const e = String(evseLocal || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!e) return null;
  return `${locationId}*E${e}`;
};

// Token uid: identifica o usuário roaming. RFID começa com FF; app com AA;
// virtual (via QR) com VV. Não é a regra do OCPI ao pé da letra — é uma
// convenção estável desta plataforma para não misturar cartão físico com token
// digital. `whitelist` diz se a rede parceira aceita SEM autorizar remotamente
// ("ALLOWED") ou pede autorização online ("ALLOWED_OFFLINE" e afins).
export const TOKEN_TYPES = Object.freeze(["RFID", "APP_USER", "AD_HOC_USER", "OTHER"]);
export const TOKEN_WHITELIST = Object.freeze(["ALWAYS", "ALLOWED", "ALLOWED_OFFLINE", "NEVER"]);

export const normalizeToken = (t = {}) => ({
  uid: String(t.uid || "").toUpperCase().replace(/\s+/g, ""),
  type: TOKEN_TYPES.includes(t.type) ? t.type : "APP_USER",
  contractId: String(t.contractId || "").toUpperCase(),
  countryCode: String(t.countryCode || "").toUpperCase(),
  partyId: String(t.partyId || "").toUpperCase(),
  whitelist: TOKEN_WHITELIST.includes(t.whitelist) ? t.whitelist : "ALLOWED",
  valid: !!t.valid,
});

// Autorização de sessão roaming: só aprova se o token for válido, tiver uid,
// e a whitelist for compatível. Devolve motivo explícito para não virar erro
// mudo na estação.
export const authorizeRoamingSession = (token, request = {}) => {
  const t = normalizeToken(token);
  if (!t.uid) return { authorized: false, reason: "token-sem-uid" };
  if (!t.valid) return { authorized: false, reason: "token-invalido" };
  if (t.whitelist === "NEVER") return { authorized: false, reason: "whitelist-never" };
  if (t.whitelist === "ALLOWED_OFFLINE" && request.online === false) {
    return { authorized: true, reason: "aceito-offline" };
  }
  return { authorized: true, reason: "aceito" };
};

// Rateio de sessão roaming. `custoBrutoReais` é o que a estação (CPO) cobra
// da sessão. A rede do cliente (eMSP) aplica uma TAXA DE ROAMING (percentual
// sobre o bruto) e repassa. `taxaRoamingPct` = 0 significa custo sem markup.
//
// Sem custo (0 ou negativo) devolve tudo zerado — não invento valor.
export const splitRoamingSession = ({ custoBrutoReais, taxaRoamingPct = 0 }) => {
  const bruto = Math.max(0, arredondarReais(custoBrutoReais));
  if (bruto <= 0) {
    return { cpoReceita: 0, emspTaxa: 0, custoCliente: 0, taxaRoamingPct: 0 };
  }
  const pct = Math.max(0, Math.min(100, num(taxaRoamingPct)));
  const emspTaxa = arredondarReais(bruto * (pct / 100));
  return {
    cpoReceita: bruto,
    emspTaxa,
    custoCliente: arredondarReais(bruto + emspTaxa),
    taxaRoamingPct: pct,
  };
};

// Consolida sessões roaming num extrato do CLIENTE (o pagador final).
// Cada sessão precisa ter `custoBrutoReais` e `parceiroCpoId`. Sessão sem
// custo ou sem parceiro é ignorada (parceiro é a chave de rateio).
export const buildRoamingStatement = (sessoes = [], taxaRoamingPct = 0) => {
  const porCpo = new Map();
  let totalCliente = 0, totalCpo = 0, totalTaxa = 0, contagem = 0;
  for (const s of sessoes) {
    if (!s?.parceiroCpoId) continue;
    const split = splitRoamingSession({ custoBrutoReais: s.custoBrutoReais, taxaRoamingPct });
    if (split.custoCliente <= 0) continue;
    contagem += 1;
    totalCliente = arredondarReais(totalCliente + split.custoCliente);
    totalCpo = arredondarReais(totalCpo + split.cpoReceita);
    totalTaxa = arredondarReais(totalTaxa + split.emspTaxa);
    const cur = porCpo.get(s.parceiroCpoId) || {
      parceiroCpoId: s.parceiroCpoId,
      sessoes: 0,
      custoCliente: 0,
      cpoReceita: 0,
      emspTaxa: 0,
    };
    cur.sessoes += 1;
    cur.custoCliente = arredondarReais(cur.custoCliente + split.custoCliente);
    cur.cpoReceita = arredondarReais(cur.cpoReceita + split.cpoReceita);
    cur.emspTaxa = arredondarReais(cur.emspTaxa + split.emspTaxa);
    porCpo.set(s.parceiroCpoId, cur);
  }
  return {
    contagem,
    totalCliente,
    totalCpo,
    totalTaxa,
    parceiros: Array.from(porCpo.values()).sort((a, b) => b.custoCliente - a.custoCliente),
  };
};
