import { useEffect, useMemo, useState } from "react";
import { Calculator, Save, RefreshCw, LockKeyhole, Users, DollarSign } from "lucide-react";
import { PARAMS_OPERACAO_PADRAO } from "../operationParamsSeed.js";
import {
  grossUpDaRegua,
  precoPorGrossUp,
  calcularDre,
  dimensionarHeadcount,
} from "../operationEngineDomain.js";
import "./TodoGreenPages.css";

// Menu admin do motor de HC e DRE: a régua (editável só por admin) e um
// simulador ao vivo que roda o núcleo puro (operationEngineDomain).

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/operation-params${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw Object.assign(new Error(corpo.error || "Falha ao acessar a régua."), { status: resposta.status, corpo });
  return corpo;
};

const setInEmObjeto = (obj, caminho, valor) => {
  const copia = structuredClone(obj);
  let no = copia;
  for (let i = 0; i < caminho.length - 1; i += 1) no = no[caminho[i]];
  no[caminho[caminho.length - 1]] = valor;
  return copia;
};

export default function OperationEnginePage({ authHeaders, setToast }) {
  const [regua, setRegua] = useState(PARAMS_OPERACAO_PADRAO);
  const [revision, setRevision] = useState(0);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);

  // Simulador
  const [tipo, setTipo] = useState("dedicado_jornada");
  const [entradas, setEntradas] = useState({ bases: 1, motoristas: 6, entregadoresDia: 0, custoDiretoMes: 45000 });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const corpo = await request("", authHeaders);
        if (!vivo) return;
        setRegua(corpo.config || PARAMS_OPERACAO_PADRAO);
        setRevision(corpo.revision || 0);
        setPodeEditar(Boolean(corpo.podeEditar));
      } catch (e) {
        if (vivo) setToast?.({ mensagem: e.message, tom: "erro" });
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [authHeaders, setToast]);

  const globais = regua?.globais || {};
  const impostos = globais.impostos || {};
  const margem = globais.margem || {};
  const reservaPct = regua?.headcount?.reserva_motorista_pct ?? 0;

  const editarNumero = (caminho) => (evento) => {
    const valor = Number(evento.target.value);
    setRegua((atual) => setInEmObjeto(atual, caminho, Number.isFinite(valor) ? valor : 0));
    setSujo(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const corpo = await request("", authHeaders, { method: "PUT", body: JSON.stringify({ config: regua, revision }) });
      setRevision(corpo.revision || revision + 1);
      setSujo(false);
      setToast?.({ mensagem: "Régua salva.", tom: "sucesso" });
    } catch (e) {
      if (e.status === 409) {
        setToast?.({ mensagem: "A régua mudou em outra tela. Recarregando.", tom: "erro" });
        const corpo = await request("", authHeaders).catch(() => null);
        if (corpo) { setRegua(corpo.config); setRevision(corpo.revision || 0); setSujo(false); }
      } else {
        setToast?.({ mensagem: e.message, tom: "erro" });
      }
    } finally {
      setSalvando(false);
    }
  };

  const simulacao = useMemo(() => {
    const gu = grossUpDaRegua(regua);
    const custoDireto = Number(entradas.custoDiretoMes) || 0;
    const preco = precoPorGrossUp(custoDireto, {
      overheadPct: 0.1,
      margemPct: margem.margem_alvo_pct ?? 0.3,
      grossUpFator: gu,
    });
    const impostoTotal = (impostos.pis_cofins_pct ?? 0) + (impostos.icms_pct ?? 0);
    const dre = calcularDre({
      receita: preco ?? 0,
      custoDireto,
      overheadPct: 0.1,
      comissaoPct: impostos.comissao_comercial_pct ?? 0,
      impostosPct: impostoTotal,
    });
    const hc = dimensionarHeadcount(regua?.headcount || {}, {
      basesQtd: Number(entradas.bases) || 1,
      motoristas: Number(entradas.motoristas) || 0,
      entregadoresDia: Number(entradas.entregadoresDia) || 0,
      diasUteisMes: globais?.rateio?.dias_uteis_mes ?? 22,
    });
    return { gu, preco, dre, hc };
  }, [regua, entradas, margem, impostos, globais]);

  if (carregando) return <section className="tdg-page"><div className="tdg-panel">Carregando a régua de operação…</div></section>;

  return (
    <section className="tdg-page tdg-op-engine">
      <div className="tdg-page-title">
        <div>
          <span>Produtos e Precificação</span>
          <h2>Motor de HC e DRE por tipo de operação</h2>
          <p>A régua (impostos, margem, headcount) e um simulador ao vivo de dimensionamento e resultado.</p>
        </div>
        {podeEditar ? (
          <button type="button" className="tdg-action" disabled={salvando || !sujo} onClick={salvar}>
            <Save size={16} /> {salvando ? "Salvando…" : "Salvar régua"}
          </button>
        ) : (
          <span className="tdg-op-engine-somente-leitura"><LockKeyhole size={14} /> Edição só para admin</span>
        )}
      </div>

      <div className="tdg-op-engine-grid">
        <section className="tdg-panel">
          <div className="tdg-section-head"><h3><DollarSign size={16} /> Régua global</h3></div>
          <div className="tdg-op-engine-campos">
            <label>ICMS (%)<input type="number" step="0.01" disabled={!podeEditar} value={(impostos.icms_pct ?? 0) * 100} onChange={(e) => editarNumero(["globais", "impostos", "icms_pct"])({ target: { value: Number(e.target.value) / 100 } })} /></label>
            <label>PIS/COFINS (%)<input type="number" step="0.01" disabled={!podeEditar} value={(impostos.pis_cofins_pct ?? 0) * 100} onChange={(e) => editarNumero(["globais", "impostos", "pis_cofins_pct"])({ target: { value: Number(e.target.value) / 100 } })} /></label>
            <label>Comissão comercial (%)<input type="number" step="0.01" disabled={!podeEditar} value={(impostos.comissao_comercial_pct ?? 0) * 100} onChange={(e) => editarNumero(["globais", "impostos", "comissao_comercial_pct"])({ target: { value: Number(e.target.value) / 100 } })} /></label>
            <label>Margem alvo (%)<input type="number" step="0.01" disabled={!podeEditar} value={(margem.margem_alvo_pct ?? 0) * 100} onChange={(e) => editarNumero(["globais", "margem", "margem_alvo_pct"])({ target: { value: Number(e.target.value) / 100 } })} /></label>
            <label>Reserva de motorista (%)<input type="number" step="0.01" disabled={!podeEditar} value={(reservaPct ?? 0) * 100} onChange={(e) => editarNumero(["headcount", "reserva_motorista_pct"])({ target: { value: Number(e.target.value) / 100 } })} /></label>
            <label>Dias úteis/mês<input type="number" disabled={!podeEditar} value={globais?.rateio?.dias_uteis_mes ?? 22} onChange={editarNumero(["globais", "rateio", "dias_uteis_mes"])} /></label>
          </div>
          <p className="tdg-op-engine-nota">Fator de gross-up derivado: <strong>{simulacao.gu ? NUM.format(simulacao.gu) : "—"}</strong> · da régua: {NUM.format(impostos.gross_up_fator ?? 0)}</p>
        </section>

        <section className="tdg-panel">
          <div className="tdg-section-head"><h3><Calculator size={16} /> Simulador</h3></div>
          <div className="tdg-op-engine-campos">
            <label>Tipo de operação
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="dedicado_jornada">Dedicado por jornada</option>
                <option value="dedicado_viagem">Dedicado por viagem</option>
                <option value="spot_pacote">Spot por pacote</option>
                <option value="spot_entrega">Spot por entrega</option>
              </select>
            </label>
            <label>Custo direto/mês (R$)<input type="number" value={entradas.custoDiretoMes} onChange={(e) => setEntradas((s) => ({ ...s, custoDiretoMes: e.target.value }))} /></label>
            <label>Bases<input type="number" value={entradas.bases} onChange={(e) => setEntradas((s) => ({ ...s, bases: e.target.value }))} /></label>
            <label>Motoristas (CLT)<input type="number" value={entradas.motoristas} onChange={(e) => setEntradas((s) => ({ ...s, motoristas: e.target.value }))} /></label>
            <label>Entregadores/dia (PJ)<input type="number" value={entradas.entregadoresDia} onChange={(e) => setEntradas((s) => ({ ...s, entregadoresDia: e.target.value }))} /></label>
          </div>

          <div className="tdg-op-engine-resultado">
            <div className="tdg-op-engine-bloco">
              <h4><DollarSign size={14} /> DRE do mês</h4>
              {simulacao.dre ? (
                <ul>
                  <li><span>Receita (preço)</span><strong>{BRL.format(simulacao.dre.receita)}</strong></li>
                  <li><span>Custo direto</span><strong>{BRL.format(simulacao.dre.custoDireto)}</strong></li>
                  <li><span>Overhead</span><strong>{BRL.format(simulacao.dre.overhead)}</strong></li>
                  <li><span>Comissão</span><strong>{BRL.format(simulacao.dre.comissao)}</strong></li>
                  <li><span>Impostos</span><strong>{BRL.format(simulacao.dre.impostos)}</strong></li>
                  <li className="destaque"><span>Margem líquida</span><strong>{BRL.format(simulacao.dre.margemLiquida)} · {simulacao.dre.margemPct === null ? "—" : `${NUM.format(simulacao.dre.margemPct)}%`}</strong></li>
                </ul>
              ) : <p className="tdg-op-engine-nota">Sem dados suficientes.</p>}
            </div>
            <div className="tdg-op-engine-bloco">
              <h4><Users size={14} /> Headcount dimensionado</h4>
              <ul>
                <li><span>Núcleo ({simulacao.hc.bases} base{simulacao.hc.bases > 1 ? "s" : ""})</span><strong>{BRL.format(simulacao.hc.custoNucleo)}</strong></li>
                <li><span>Motoristas c/ reserva</span><strong>{NUM.format(simulacao.hc.motoristasDimensionados)}</strong></li>
                <li><span>Custo variável</span><strong>{BRL.format(simulacao.hc.custoVariavel)}</strong></li>
                <li className="destaque"><span>Custo total de HC/mês</span><strong>{BRL.format(simulacao.hc.custoTotalMes)}</strong></li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
