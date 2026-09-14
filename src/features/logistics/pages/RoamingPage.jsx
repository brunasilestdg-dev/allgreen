import { useMemo, useState } from "react";
import { Handshake, Radio, Receipt } from "lucide-react";
import {
  buildLocationId,
  buildEvseUid,
  normalizeToken,
  authorizeRoamingSession,
  splitRoamingSession,
  buildRoamingStatement,
  TOKEN_TYPES,
  TOKEN_WHITELIST,
} from "../ocpiRoamingDomain.js";
import "./TodoGreenPages.css";

// Roaming OCPI (bloco 14). Identifica estação/EVSE no padrão da norma,
// autoriza o token da rede parceira e faz o rateio CPO/eMSP/cliente.
// Aqui a tela é um simulador: você digita país/party/estação e vê o
// identificador OCPI resultante; digita um token e vê se seria aceito.

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export default function RoamingPage() {
  const [id, setId] = useState({ countryCode: "BR", partyId: "TGN", localId: "SP01", evseLocal: "1" });
  const [token, setToken] = useState({ uid: "", type: "APP_USER", whitelist: "ALLOWED", valid: true });
  const [taxa, setTaxa] = useState("10");
  const [sessoes] = useState([]);

  const locationId = useMemo(() => buildLocationId(id), [id]);
  const evseUid = useMemo(() => buildEvseUid(locationId, id.evseLocal), [locationId, id.evseLocal]);
  const tokenNormalizado = useMemo(() => normalizeToken(token), [token]);
  const autorizacao = useMemo(() => authorizeRoamingSession(token, { online: true }), [token]);

  const rateio = useMemo(() => splitRoamingSession({ custoBrutoReais: 50, taxaRoamingPct: Number(taxa) || 0 }), [taxa]);
  const extrato = useMemo(() => buildRoamingStatement(sessoes, Number(taxa) || 0), [sessoes, taxa]);

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>GREEN ON · REDE</span>
          <h2>Roaming OCPI</h2>
          <p>Como as redes de eletroposto conversam entre si. O identificador segue a norma (país·party·EVSE); o token da rede parceira passa por whitelist; o custo da sessão é rateado entre a rede da estação (CPO), a nossa (eMSP) e o cliente pagador.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Radio size={20} /></span><div><strong>Identificador OCPI</strong><small>{evseUid || "aguardando dados válidos"}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>País (ISO)</span><input value={id.countryCode} maxLength={2} onChange={(e) => setId({ ...id, countryCode: e.target.value.toUpperCase() })} /></label>
          <label><span>Party (3 letras)</span><input value={id.partyId} maxLength={3} onChange={(e) => setId({ ...id, partyId: e.target.value.toUpperCase() })} /></label>
          <label><span>Estação (local id)</span><input value={id.localId} onChange={(e) => setId({ ...id, localId: e.target.value })} /></label>
          <label><span>EVSE (local)</span><input value={id.evseLocal} onChange={(e) => setId({ ...id, evseLocal: e.target.value })} /></label>
        </div>
        <p className="tdg-driver-nota">Location: <code>{locationId || "—"}</code> · EVSE: <code>{evseUid || "—"}</code>. É esse identificador que a rede parceira usa para reconhecer o ponto.</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Handshake size={20} /></span><div><strong>Autorização do token</strong><small>{autorizacao.authorized ? `aceito · ${autorizacao.reason}` : `recusado · ${autorizacao.reason}`}</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>UID do token</span><input value={token.uid} onChange={(e) => setToken({ ...token, uid: e.target.value })} placeholder="ex.: AA1234BB" /></label>
          <label><span>Tipo</span><select value={token.type} onChange={(e) => setToken({ ...token, type: e.target.value })}>{TOKEN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label><span>Whitelist</span><select value={token.whitelist} onChange={(e) => setToken({ ...token, whitelist: e.target.value })}>{TOKEN_WHITELIST.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <label><span>Válido?</span><select value={token.valid ? "1" : "0"} onChange={(e) => setToken({ ...token, valid: e.target.value === "1" })}><option value="1">sim</option><option value="0">não</option></select></label>
        </div>
        <p className="tdg-driver-nota">Normalizado: uid <code>{tokenNormalizado.uid || "—"}</code>, tipo <code>{tokenNormalizado.type}</code>, whitelist <code>{tokenNormalizado.whitelist}</code>.</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Receipt size={20} /></span><div><strong>Rateio da sessão · exemplo R$ 50</strong><small>taxa de roaming da nossa rede sobre o bruto do CPO</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Taxa de roaming (%)</span><input type="number" min="0" max="100" step="0.1" value={taxa} onChange={(e) => setTaxa(e.target.value)} /></label>
        </div>
        <div className="tdg-recarga-metrics">
          <article><small>Receita do CPO</small><strong>{moeda.format(rateio.cpoReceita)}</strong></article>
          <article><small>Taxa eMSP</small><strong>{moeda.format(rateio.emspTaxa)}</strong></article>
          <article><small>Custo cliente</small><strong>{moeda.format(rateio.custoCliente)}</strong></article>
        </div>
        <p className="tdg-driver-nota">Extrato consolidado por parceiro aparece aqui quando houver sessão real. {extrato.contagem ? `Hoje: ${extrato.contagem} sessão(ões).` : "Sem sessão registrada ainda."}</p>
      </article>
    </div>
  );
}
