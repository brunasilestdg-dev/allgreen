import { useMemo, useState } from "react";
import { Cable, MessageSquareCode, Zap } from "lucide-react";
import {
  parseMessage,
  encodeCall,
  encodeCallResult,
  validateBootNotification,
  validateStartTransaction,
  validateStopTransaction,
  validateStatusNotification,
  bootAcceptResponse,
  buildIdTagInfo,
  isValidStatusTransition,
  energyFromMeterValues,
  closeTransaction,
  remoteStartPayload,
  remoteStopPayload,
  unlockConnectorPayload,
  CONNECTOR_STATUS,
  ACTIONS_CSMS_INITIATED,
} from "../ocppProtocolDomain.js";
import "./TodoGreenPages.css";

// Console OCPP — a titular pediu no bloco 11 controlar o carregador de
// verdade (não só cadastrar). Esta tela é o simulador do CSMS: valida uma
// mensagem que veio do carregador, autoriza (ou não) e devolve o CALL
// resposta pronto para o worker enviar pelo WebSocket. Nada de rede aqui;
// a integração real vive fora.

const EXEMPLOS = Object.freeze({
  boot: JSON.stringify([2, "uid-boot-01", "BootNotification", { chargePointVendor: "AllGreen", chargePointModel: "AG-60kW-DC" }], null, 2),
  status: JSON.stringify([2, "uid-status-01", "StatusNotification", { connectorId: 1, status: "Preparing", errorCode: "NoError" }], null, 2),
  start: JSON.stringify([2, "uid-start-01", "StartTransaction", { connectorId: 1, idTag: "app-user-42", meterStart: 0, timestamp: "2026-01-14T09:00:00Z" }], null, 2),
  stop: JSON.stringify([2, "uid-stop-01", "StopTransaction", { transactionId: 42, meterStop: 32450, timestamp: "2026-01-14T09:45:00Z", reason: "Remote" }], null, 2),
});

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export default function OcppConsolePage() {
  const [entrada, setEntrada] = useState(EXEMPLOS.boot);
  const [comando, setComando] = useState({ acao: "RemoteStartTransaction", connectorId: 1, idTag: "app-user-42", transactionId: "" });
  const [transicao, setTransicao] = useState({ de: "Available", para: "Preparing" });

  const parsed = useMemo(() => parseMessage(entrada), [entrada]);
  const validacao = useMemo(() => {
    if (!parsed.ok || parsed.kind !== "call") return null;
    const p = parsed.payload;
    if (parsed.action === "BootNotification") return { acao: parsed.action, ...validateBootNotification(p) };
    if (parsed.action === "StatusNotification") return { acao: parsed.action, ...validateStatusNotification(p) };
    if (parsed.action === "StartTransaction") return { acao: parsed.action, ...validateStartTransaction(p) };
    if (parsed.action === "StopTransaction") return { acao: parsed.action, ...validateStopTransaction(p) };
    return { acao: parsed.action, ok: true, problemas: [] };
  }, [parsed]);

  const resposta = useMemo(() => {
    if (!parsed.ok || parsed.kind !== "call" || !validacao?.ok) return null;
    if (parsed.action === "BootNotification") return encodeCallResult(parsed.uniqueId, bootAcceptResponse({ interval: 300 }));
    if (parsed.action === "Authorize") return encodeCallResult(parsed.uniqueId, { idTagInfo: buildIdTagInfo({ status: "Accepted" }) });
    if (parsed.action === "StartTransaction") return encodeCallResult(parsed.uniqueId, { transactionId: 42, idTagInfo: buildIdTagInfo({ status: "Accepted" }) });
    if (parsed.action === "StopTransaction") return encodeCallResult(parsed.uniqueId, { idTagInfo: buildIdTagInfo({ status: "Accepted" }) });
    if (parsed.action === "StatusNotification" || parsed.action === "Heartbeat") return encodeCallResult(parsed.uniqueId, {});
    return encodeCallResult(parsed.uniqueId, {});
  }, [parsed, validacao]);

  // Se a mensagem foi um StopTransaction, mostrar o fechamento.
  const fechamento = useMemo(() => {
    if (parsed.ok && parsed.kind === "call" && parsed.action === "StopTransaction") {
      const p = parsed.payload;
      return closeTransaction({ meterStart: 0, meterStop: p.meterStop, startTs: p.timestamp, stopTs: p.timestamp, reason: p.reason });
    }
    return null;
  }, [parsed]);

  // Round-trip: energia de exemplo (2 leituras).
  const kwhExemplo = useMemo(
    () => energyFromMeterValues([
      { timestamp: "2026-01-14T09:00:00Z", sampledValue: [{ value: "0", unit: "Wh" }] },
      { timestamp: "2026-01-14T09:45:00Z", sampledValue: [{ value: "32.45", unit: "kWh" }] },
    ]),
    [],
  );

  // uniqueId "csms-<hash>" só depende do payload — mantém a render pura
  // (o compilador React reclama de Date.now() no render). Em produção, o
  // worker gera com crypto.randomUUID quando for despachar.
  const csmsCall = useMemo(() => {
    const chave = `csms-${comando.acao}-${comando.connectorId}-${comando.idTag}-${comando.transactionId}`;
    try {
      if (comando.acao === "RemoteStartTransaction") {
        return encodeCall(chave, "RemoteStartTransaction",
          remoteStartPayload({ connectorId: Number(comando.connectorId) || undefined, idTag: comando.idTag }));
      }
      if (comando.acao === "RemoteStopTransaction") {
        return encodeCall(chave, "RemoteStopTransaction",
          remoteStopPayload({ transactionId: Number(comando.transactionId) || 0 }));
      }
      if (comando.acao === "UnlockConnector") {
        return encodeCall(chave, "UnlockConnector",
          unlockConnectorPayload({ connectorId: Number(comando.connectorId) || 0 }));
      }
    } catch (e) {
      return { erro: e.message };
    }
    return null;
  }, [comando]);

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>GREEN ON · OCPP</span>
          <h2>Console de protocolo (OCPP 1.6-J)</h2>
          <p>Cole aqui a mensagem que o carregador enviou pelo WebSocket. A tela valida, aceita ou recusa segundo a norma, e mostra o CALL de resposta pronto para o worker despachar. Do outro lado, monte os comandos que a torre dispara (RemoteStart/Stop, Unlock).</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><MessageSquareCode size={20} /></span><div><strong>Mensagem do carregador</strong><small>{parsed.ok ? `${parsed.kind} · ${parsed.action || ""}` : `formato: ${parsed.reason}`}</small></div></div>
        <div className="tdg-recarga-filtros">
          <button className="tdg-action" type="button" onClick={() => setEntrada(EXEMPLOS.boot)}>Boot</button>
          <button className="tdg-action" type="button" onClick={() => setEntrada(EXEMPLOS.status)}>Status</button>
          <button className="tdg-action" type="button" onClick={() => setEntrada(EXEMPLOS.start)}>StartTx</button>
          <button className="tdg-action" type="button" onClick={() => setEntrada(EXEMPLOS.stop)}>StopTx</button>
        </div>
        <textarea rows={7} value={entrada} onChange={(e) => setEntrada(e.target.value)} style={{ width: "100%", fontFamily: "ui-monospace, monospace" }} />
        {validacao && (
          <p className="tdg-driver-nota">
            <strong>{validacao.acao}:</strong> {validacao.ok ? "validação OK — CALL aceito." : `problemas: ${(validacao.problemas || []).join(" · ")}`}
          </p>
        )}
        {resposta && (
          <>
            <div className="tdg-work-area-heading"><span><Zap size={20} /></span><div><strong>Resposta pronta</strong><small>CALLRESULT (kind=3)</small></div></div>
            <pre style={{ background: "var(--tdg-surface-soft, #f5f6f4)", padding: 12, borderRadius: 8, overflowX: "auto" }}>{JSON.stringify(resposta, null, 2)}</pre>
          </>
        )}
        {fechamento && (
          <p className="tdg-driver-nota">Sessão fechada: {numero.format(fechamento.kwh)} kWh em {fechamento.minutos ?? "—"} min · motivo &ldquo;{fechamento.reason}&rdquo;.</p>
        )}
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Cable size={20} /></span><div><strong>Comando da torre para o carregador</strong><small>CALL CSMS-initiated</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>Ação</span>
            <select value={comando.acao} onChange={(e) => setComando({ ...comando, acao: e.target.value })}>
              {ACTIONS_CSMS_INITIATED.filter((a) => a !== "ChangeAvailability").map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {(comando.acao === "RemoteStartTransaction" || comando.acao === "UnlockConnector") && (
            <label><span>Conector</span><input type="number" min="1" value={comando.connectorId} onChange={(e) => setComando({ ...comando, connectorId: e.target.value })} /></label>
          )}
          {comando.acao === "RemoteStartTransaction" && (
            <label><span>idTag</span><input value={comando.idTag} onChange={(e) => setComando({ ...comando, idTag: e.target.value })} /></label>
          )}
          {comando.acao === "RemoteStopTransaction" && (
            <label><span>transactionId</span><input type="number" min="0" value={comando.transactionId} onChange={(e) => setComando({ ...comando, transactionId: e.target.value })} /></label>
          )}
        </div>
        {csmsCall && (
          <pre style={{ background: "var(--tdg-surface-soft, #f5f6f4)", padding: 12, borderRadius: 8, overflowX: "auto" }}>
            {csmsCall.erro ? `Erro: ${csmsCall.erro}` : JSON.stringify(csmsCall, null, 2)}
          </pre>
        )}
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><MessageSquareCode size={20} /></span><div><strong>Máquina de estado do conector</strong><small>transições válidas do OCPP 1.6</small></div></div>
        <div className="tdg-recarga-form">
          <label><span>De</span>
            <select value={transicao.de} onChange={(e) => setTransicao({ ...transicao, de: e.target.value })}>
              {CONNECTOR_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label><span>Para</span>
            <select value={transicao.para} onChange={(e) => setTransicao({ ...transicao, para: e.target.value })}>
              {CONNECTOR_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <p className="tdg-driver-nota">
          {isValidStatusTransition(transicao.de, transicao.para)
            ? `Transição ${transicao.de} → ${transicao.para} é válida.`
            : `Transição ${transicao.de} → ${transicao.para} NÃO é aceita — indício de firmware fora do padrão.`}
        </p>
        {kwhExemplo != null && <p className="tdg-driver-nota">Round-trip de MeterValues: {numero.format(kwhExemplo)} kWh entre duas leituras de exemplo.</p>}
      </article>
    </div>
  );
}
