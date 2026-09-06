import { useCallback, useEffect, useState } from "react";
import { Sparkles, Truck, UserCheck } from "lucide-react";

// Despacho inteligente: liga o motor VRP (solver genético no Worker) que estava
// órfão — pronto no back, sem tela nenhuma. Carrega as operações pendentes com
// coordenada, os motoristas e veículos disponíveis, otimiza as rotas de VÁRIOS
// veículos de uma vez (capacidade + turno), mostra a prévia e, se a operação
// aprovar, aplica motorista + veículo às operações. É a roteirização "de
// verdade" (não o vizinho-mais-próximo de uma rota só).
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

  const aplicar = async () => {
    const atribuicoes = (resultado?.tours || []).flatMap((tour) =>
      (tour.operacoes || []).map((operationId) => ({
        operationId, driverId: tour.motoristaId, driverName: tour.motoristaNome, vehiclePlate: tour.placa,
      })));
    if (!atribuicoes.length) { setToast?.("Nada para aplicar."); return; }
    setAplicando(true);
    try {
      const headers = { ...(authHeaders?.() || {}), "content-type": "application/json" };
      const r = await fetch("/api/todogreen/dispatch/aplicar", { method: "POST", headers, body: JSON.stringify({ atribuicoes }) });
      const p = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(p.error || "Não foi possível aplicar as atribuições.");
      setToast?.(`${p.aplicados || 0} operação(ões) atribuída(s) a motorista e veículo.`);
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
            <button type="button" className="tdg-action" onClick={otimizar} disabled={otimizando || !(cand?.operacoes?.length) || !(cand?.veiculos?.length)}>{otimizando ? "Otimizando…" : "Otimizar rotas"}</button>
          </div>
          {resultado && (
            <div className="tdg-dispatch-resultado">
              {(resultado.tours || []).map((tour) => (
                <article className="tdg-dispatch-tour" key={tour.veiculoId}>
                  <header><strong>{tour.prefixo || tour.placa || tour.veiculoId}</strong><small>{tour.motoristaNome || "sem motorista livre"}{tour.placa ? ` · ${tour.placa}` : ""}</small></header>
                  <span>{tour.operacoes?.length || 0} parada(s)</span>
                </article>
              ))}
              {(resultado.naoAtribuidas || []).length > 0 && <p className="tdg-dispatch-nao">{resultado.naoAtribuidas.length} operação(ões) não coube(ram) na frota/turno disponível.</p>}
              {(resultado.tours || []).length > 0 && (
                <button type="button" className="tdg-action" onClick={aplicar} disabled={aplicando}>{aplicando ? "Aplicando…" : "Aplicar atribuições"}</button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
