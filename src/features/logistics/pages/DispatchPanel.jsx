import { useCallback, useEffect, useState } from "react";
import { Sparkles, Truck, UserCheck } from "lucide-react";

// Uma rota SEM motorista livre não pode ser aplicada: gravaria um veículo
// comprometido sem condutor, e como a operação continua sem driver_id ela
// reaparece como candidata — "atribuída" e pendente ao mesmo tempo. Estas duas
// funções puras são a regra, testável fora da tela: só entram no lote as rotas
// com motorista; as demais ficam pendentes de propósito.
export function atribuicoesDeTours(tours) {
  return (tours || [])
    .filter((tour) => tour.motoristaId)
    .flatMap((tour) =>
      (tour.operacoes || []).map((operationId) => ({
        operationId,
        driverId: tour.motoristaId,
        driverName: tour.motoristaNome,
        vehiclePlate: tour.placa,
      })));
}

export function toursSemMotorista(tours) {
  return (tours || []).filter((tour) => !tour.motoristaId).length;
}

export function toursAplicaveis(tours) {
  return (tours || []).filter((tour) => tour.motoristaId && (tour.operacoes || []).length);
}

// Despacho inteligente: liga o motor VRP (solver genético no Worker) que estava
// órfão — pronto no back, sem tela nenhuma. Carrega as operações pendentes com
// coordenada, os motoristas e veículos disponíveis, otimiza as rotas de VÁRIOS
// veículos de uma vez (capacidade + turno), mostra a prévia e, se a operação
// aprovar, cria as rotas e liga motorista + veículo + operações numa cadeia
// executável. É a roteirização "de verdade" (não o vizinho-mais-próximo de
// uma rota só).
export default function DispatchPanel({ authHeaders, setToast }) {
  const [cand, setCand] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [otimizando, setOtimizando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/todogreen/dispatch/candidatos", { headers: authHeaders?.() || {} });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Falha ao carregar candidatos ao despacho.");
      setCand(p);
    } catch (e) { setToast?.(e.message); }
    finally { setCarregando(false); }
  }, [authHeaders, setToast]);

  useEffect(() => { if (aberto && !cand) carregar(); }, [aberto, cand, carregar]);

  const otimizar = async () => {
    setOtimizando(true);
    setResultado(null);
    try {
      const headers = { ...(authHeaders?.() || {}), "content-type": "application/json" };
      const r = await fetch("/api/todogreen/dispatch/otimizar", { method: "POST", headers, body: JSON.stringify({}) });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Não foi possível otimizar as rotas.");
      setResultado(p);
      if (!(p.tours || []).length) setToast?.("O motor não encontrou atribuição possível com o que está disponível.");
    } catch (e) { setToast?.(e.message); }
    finally { setOtimizando(false); }
  };

  // Nome do cliente para rotular cada parada da sequência otimizada; cai no id
  // se a conta não estiver no lote carregado.
  const nomeDaOperacao = (opId) =>
    (cand?.operacoes || []).find((o) => o.id === opId)?.cliente || opId;

  const aplicar = async () => {
    const tours = resultado?.tours || [];
    const aplicaveis = toursAplicaveis(tours);
    const semMotorista = toursSemMotorista(tours);
    if (!aplicaveis.length) {
      setToast?.(semMotorista
        ? "Nenhuma rota tem motorista livre para aplicar — libere um motorista e otimize de novo."
        : "Nada para aplicar.");
      return;
    }
    setAplicando(true);
    try {
      const headers = { ...(authHeaders?.() || {}), "content-type": "application/json" };
      const r = await fetch("/api/todogreen/dispatch/aplicar", {
        method: "POST",
        headers,
        body: JSON.stringify({ planId: resultado.planId, tours: aplicaveis }),
      });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Não foi possível aplicar as atribuições.");
      const aviso = semMotorista
        ? ` ${semMotorista} rota(s) sem motorista livre ficou(aram) pendente(s).`
        : "";
      setToast?.(`${p.rotasCriadas || 0} rota(s) criada(s) e ${p.aplicados || 0} operação(ões) despachada(s).${aviso}`);
      setResultado(null);
      setCand(null);
      carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setAplicando(false); }
  };

  return (
    <section className="tdg-dispatch">
      <div className="tdg-dispatch-head">
        <div><span className="tdg-kicker">DESPACHO INTELIGENTE</span><h3><Sparkles size={16} /> Otimizar e atribuir rotas automaticamente</h3></div>
        <button type="button" className="tdg-action" onClick={() => setAberto((v) => !v)}>{aberto ? "Fechar" : "Abrir despacho"}</button>
      </div>
      {aberto && (
        <div className="tdg-dispatch-corpo">
          <p className="tdg-esg-nota">O motor calcula a melhor sequência entre vários veículos (capacidade e turno) e atribui motorista às operações pendentes que têm coordenada de entrega. É prévia: nada é gravado antes de você aplicar.</p>
          {carregando && <small>Carregando candidatos…</small>}
          {cand && (
            <div className="tdg-dispatch-stats">
              <article><span>Operações a despachar</span><strong>{cand.operacoes?.length || 0}</strong></article>
              <article className={cand.semCoordenadas ? "risk" : ""}><span>Sem coordenada (fora)</span><strong>{cand.semCoordenadas || 0}</strong></article>
              <article><span><UserCheck size={13} /> Motoristas livres</span><strong>{cand.motoristas?.length || 0}</strong></article>
              <article><span><Truck size={13} /> Veículos livres</span><strong>{cand.veiculos?.length || 0}</strong></article>
            </div>
          )}
          <div className="tdg-dispatch-acoes">
            <button type="button" onClick={carregar} disabled={carregando}>Recarregar</button>
            <button type="button" className="tdg-action" onClick={otimizar} disabled={otimizando || !(cand?.operacoes?.length) || !(cand?.veiculos?.length) || !(cand?.motoristas?.length)}>{otimizando ? "Otimizando…" : "Otimizar rotas"}</button>
          </div>
          {/* Sem motorista livre, otimizar só produziria rota sem condutor — que
              não pode ser aplicada. Diz o porquê em vez de um botão morto. */}
          {cand && !cand.motoristas?.length && (cand.operacoes?.length > 0) && (
            <small className="tdg-dispatch-nao">Nenhum motorista livre no momento — libere um motorista para otimizar e atribuir.</small>
          )}
          {resultado && (
            <div className="tdg-dispatch-resultado">
              {/* Honestidade do motor: o operador precisa saber COMO a rota foi
                  calculada. VROOM usa a rede viária real; o solver de
                  contingência (nativo, sem dependência de rede) estima por
                  distância em linha reta — bom para sequência, aproximado para
                  quilometragem. Nunca apresentar a contingência como se fosse
                  otimização por estrada. */}
              {(resultado.tours || []).length > 0 && (
                resultado.motor === "vroom" ? (
                  <p className="tdg-dispatch-motor ok">Otimizado pelo motor VROOM · rede viária real.</p>
                ) : (
                  <p className="tdg-dispatch-motor aprox">Motor de contingência (solver nativo) · sequência otimizada com distância em linha reta, sem rede viária. As quilometragens são estimativas — conecte o motor de rotas próprio para cálculo por estrada.</p>
                )
              )}
              {(resultado.tours || []).map((tour) => (
                <article className={`tdg-dispatch-tour${tour.motoristaId ? "" : " sem-motorista"}`} key={tour.veiculoId}>
                  <header><strong>{tour.prefixo || tour.placa || tour.veiculoId}</strong><small>{tour.motoristaNome || "sem motorista livre — não será aplicada"}{tour.placa ? ` · ${tour.placa}` : ""}</small></header>
                  <span className="tdg-dispatch-tour-tot">{tour.paradas?.length || tour.operacoes?.length || 0} parada(s), na ordem:</span>
                  {/* A sequência de paradas que o motor escolheu — não só a
                      contagem. O operador precisa ver a ordem antes de aplicar. */}
                  <ol className="tdg-dispatch-sequencia">
                    {(tour.paradas?.length ? tour.paradas : (tour.operacoes || []).map((operationId) => ({ operationId }))).map((parada, indice) => (
                      <li key={`${parada.operationId}-${parada.tipo || "entrega"}-${indice}`}>
                        {parada.tipo ? `${parada.tipo === "coleta" ? "Coleta" : "Entrega"} · ` : ""}{nomeDaOperacao(parada.operationId)}
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
              {(resultado.naoAtribuidas || []).length > 0 && <p className="tdg-dispatch-nao">{resultado.naoAtribuidas.length} operação(ões) não coube(ram) na frota/turno disponível.</p>}
              {(resultado.tours || []).length > 0 && (
                <button type="button" className="tdg-action" onClick={aplicar} disabled={aplicando}>{aplicando ? "Criando rotas…" : "Aplicar plano e criar rotas"}</button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
