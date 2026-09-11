import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck, Download, FileText, Gauge, Lock } from "lucide-react";
import { ESCOPOS_RELATORIO, PERIODOS } from "../esgReportDomain.js";
import "./TodoGreenPages.css";

// ===== Relatórios, lado interno =====
//
// Esta tela era um `<textarea>` somente-leitura com seis frases, enquanto o
// cliente no portal já baixava PDF, planilha, CSV, apresentação e HTML com
// metodologia e memória de cálculo. A equipe tinha menos que o cliente.
//
// O documento é montado com `montarRelatorio` — o mesmo código do portal. Se
// fossem dois montadores, o número que a To Do Green apresenta em comitê e o
// que o cliente recebe divergiriam sem ninguém perceber.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const NUM2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const api = async (caminho, authHeaders) => {
  const resultado = await fetch(`/api/todogreen/${caminho}`, {
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
  });
  const payload = await resultado.json().catch(() => ({}));
  if (!resultado.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
};

const apiPost = async (caminho, corpo, authHeaders) => {
  const resultado = await fetch(`/api/todogreen/${caminho}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
    body: JSON.stringify(corpo),
  });
  const payload = await resultado.json().catch(() => ({}));
  if (!resultado.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
};

// Do primeiro dia do mês até hoje: o intervalo que quase sempre se quer, sem
// obrigar ninguém a preencher data antes de ver qualquer coisa.
const periodoPadrao = () => {
  const hoje = new Date();
  const iso = (data) => data.toISOString().slice(0, 10);
  return {
    inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)),
    fim: iso(hoje),
    tipo: "mensal",
  };
};

// O mês corrente é o que quase sempre se quer fechar; abre já preenchido.
const mesPadrao = () => new Date().toISOString().slice(0, 7);

const FORMATOS_OFERECIDOS = [
  { id: "pdf", rotulo: "PDF" },
  { id: "xlsx", rotulo: "Planilha" },
  { id: "csv", rotulo: "CSV" },
  { id: "pptx", rotulo: "Apresentação" },
  { id: "html", rotulo: "HTML" },
];

export default function ReportsPage({ dashboard, data, authHeaders, setToast }) {
  const [clientes, setClientes] = useState([]);
  const [carteiraCompleta, setCarteiraCompleta] = useState(true);
  const [clienteId, setClienteId] = useState("");
  const [periodo, setPeriodo] = useState(periodoPadrao);
  const [escopo, setEscopo] = useState("cliente");
  const [gerando, setGerando] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [mesFechamento, setMesFechamento] = useState(mesPadrao);
  const [fechando, setFechando] = useState(false);
  const [fechamentos, setFechamentos] = useState([]);
  const [carregandoFechamentos, setCarregandoFechamentos] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api("esg/clientes-relatorio", authHeaders);
      setClientes(d.clientes || []);
      setCarteiraCompleta(d.carteiraCompleta !== false);
      if ((d.clientes || []).length === 1) setClienteId(d.clientes[0].id);
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setCarregando(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // A série de meses fechados é sempre de UM cliente — número sem dono não se
  // fecha. Recarrega quando muda o cliente selecionado.
  const carregarFechamentos = useCallback(async () => {
    if (!clienteId) {
      setFechamentos([]);
      return;
    }
    setCarregandoFechamentos(true);
    try {
      const d = await api(
        `esg/fechamentos?cliente=${encodeURIComponent(clienteId)}`,
        authHeaders,
      );
      setFechamentos(d.fechamentos || []);
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setCarregandoFechamentos(false);
    }
  }, [clienteId, authHeaders]);

  useEffect(() => {
    carregarFechamentos();
  }, [carregarFechamentos]);

  const fecharMes = async () => {
    setErro("");
    setFechando(true);
    try {
      const d = await apiPost(
        "esg/fechamento",
        { clienteId, mes: mesFechamento },
        authHeaders,
      );
      setToast?.(d.refechado ? "Mês refechado." : "Mês fechado (GLEC).");
      await carregarFechamentos();
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setFechando(false);
    }
  };

  const mesFechamentoValido = /^\d{4}-\d{2}$/.test(mesFechamento);
  const podeFechar = Boolean(clienteId) && mesFechamentoValido && !fechando;

  const periodoInvalido = periodo.inicio > periodo.fim;

  const gerar = async (formatoId) => {
    setErro("");
    setGerando(formatoId);
    try {
      const bruto = await api(
        `esg/relatorio?cliente=${encodeURIComponent(clienteId)}&inicio=${encodeURIComponent(periodo.inicio)}&fim=${encodeURIComponent(periodo.fim)}`,
        authHeaders,
      );
      // Mesmo montador e mesmos exportadores do portal do cliente.
      const [{ montarRelatorio }, { FORMATOS }] = await Promise.all([
        import("../esgReportDomain.js"),
        import("../esgReportFormats.js"),
      ]);
      const relatorio = montarRelatorio({
        cliente: bruto.cliente,
        periodo: { tipo: periodo.tipo, inicio: bruto.periodo.inicio, fim: bruto.periodo.fim },
        escopo,
        calculos: bruto.calculos,
        greenScore: bruto.greenScore,
        operacoes: bruto.operacoes,
        geradoPor: bruto.geradoPor,
      });
      const exportador = FORMATOS.find((f) => f.id === formatoId);
      if (!exportador) throw new Error("Formato indisponível.");
      await exportador.baixar(relatorio);
      setToast?.("Relatório gerado.");
    } catch (razao) {
      setErro(razao.message);
    } finally {
      setGerando("");
    }
  };

  const podeGerar = Boolean(clienteId) && !periodoInvalido && !gerando;

  const consolidado = useMemo(
    () => [
      { rotulo: "Clientes cadastrados", valor: String(data.clients.length) },
      { rotulo: "Oportunidades abertas", valor: String(data.opportunities.length) },
      { rotulo: "Receita prevista", valor: BRL.format(dashboard.receitaPrevista) },
      {
        rotulo: "Margem operacional",
        valor: `${NUM.format(dashboard.margemOperacionalPercent)}%`,
      },
      { rotulo: "CO2 evitado", valor: `${NUM.format(dashboard.co2Evitado / 1000)} t` },
      { rotulo: "Aprovações pendentes", valor: String(dashboard.aprovacoesPendentes) },
    ],
    [dashboard, data],
  );

  return (
    <section className="tdg-panel tdg-page tdg-rel-page">
      <header className="tdg-page-title">
        <div>
          <span>RELATÓRIOS</span>
          <h2>Relatório por cliente e período</h2>
          <p>
            O documento sai com metodologia, premissas, fontes dos fatores, qualidade dos
            dados e memória de cálculo — o mesmo conteúdo que o cliente recebe pelo portal,
            montado pelo mesmo código.
            {carteiraCompleta ? "" : " Você gera relatórios dos clientes da sua carteira."}
          </p>
        </div>
      </header>

      {erro && <div className="tdg-page-error">{erro}</div>}

      <div className="tdg-rel-form">
        <label>
          <span>Cliente</span>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Selecione o cliente</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Início</span>
          <input
            type="date"
            value={periodo.inicio}
            onChange={(e) => setPeriodo((atual) => ({ ...atual, inicio: e.target.value }))}
          />
        </label>
        <label>
          <span>Fim</span>
          <input
            type="date"
            value={periodo.fim}
            onChange={(e) => setPeriodo((atual) => ({ ...atual, fim: e.target.value }))}
          />
        </label>
        <label>
          <span>Periodicidade</span>
          <select
            value={periodo.tipo}
            onChange={(e) => setPeriodo((atual) => ({ ...atual, tipo: e.target.value }))}
          >
            {PERIODOS.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Escopo</span>
          <select value={escopo} onChange={(e) => setEscopo(e.target.value)}>
            {ESCOPOS_RELATORIO.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {periodoInvalido && (
        <p className="tdg-rel-aviso">
          <AlertTriangle size={16} />O início do período está depois do fim.
        </p>
      )}

      {!carregando && clientes.length === 0 && (
        <p className="tdg-rel-aviso">
          <AlertTriangle size={16} />
          Nenhum cliente disponível para relatório. Cadastre um cliente antes de gerar o
          documento.
        </p>
      )}

      <div className="tdg-rel-formatos">
        {FORMATOS_OFERECIDOS.map((formato) => (
          <button
            key={formato.id}
            type="button"
            className="tdg-action"
            disabled={!podeGerar}
            onClick={() => gerar(formato.id)}
          >
            <Download size={15} />
            {gerando === formato.id ? "Gerando..." : formato.rotulo}
          </button>
        ))}
      </div>
      {!clienteId && !carregando && clientes.length > 0 && (
        <p className="tdg-rel-ressalva">
          Escolha o cliente para liberar a geração. O relatório é sempre de um cliente e um
          período — número sem dono não se defende em auditoria.
        </p>
      )}

      <div className="tdg-rel-consolidado">
        <h3>
          <CalendarCheck size={16} />
          Fechamento mensal (GLEC / ISO 14083)
        </h3>
        <p className="tdg-rel-ressalva">
          Congela o mês num retrato só — como o fechamento da folha — na moldura que o
          mercado reconhece: emissão de transporte por atividade (tonelada-quilômetro),
          com a versão da metodologia carimbada para o número não andar depois. Refechar o
          mesmo mês atualiza o retrato, não duplica.
        </p>
        <div className="tdg-rel-fechar">
          <label>
            <span>Mês</span>
            <input
              type="month"
              value={mesFechamento}
              onChange={(e) => setMesFechamento(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="tdg-action"
            disabled={!podeFechar}
            onClick={fecharMes}
          >
            <Lock size={15} />
            {fechando ? "Fechando..." : "Fechar mês (GLEC)"}
          </button>
        </div>
        {!clienteId && (
          <p className="tdg-rel-ressalva">
            Selecione o cliente acima para fechar o mês. O fechamento é sempre de um cliente.
          </p>
        )}

        {clienteId && carregandoFechamentos && (
          <p className="tdg-rel-ressalva">Carregando meses fechados…</p>
        )}
        {clienteId && !carregandoFechamentos && fechamentos.length === 0 && (
          <p className="tdg-rel-ressalva">
            Nenhum mês fechado ainda para este cliente. Feche o primeiro acima.
          </p>
        )}
        {fechamentos.length > 0 && (
          <div className="tdg-rel-fechados">
            {fechamentos.map((f) => {
              const r = f.resumo || {};
              const intensidadeOk = r.intensidadeGCo2ePorTkm != null;
              return (
                <article key={f.mes} className="tdg-rel-fechado">
                  <header>
                    <strong>{f.mes}</strong>
                    <span className="tdg-rel-selo">
                      {f.status === "reaberto" ? "reaberto" : "fechado"}
                      {f.revisao > 1 ? ` · rev. ${f.revisao}` : ""}
                    </span>
                  </header>
                  <div className="tdg-rel-fechado-numeros">
                    <div>
                      <small>CO₂ emitido</small>
                      <strong>{NUM.format(r.co2EmitidoKg || 0)} kg</strong>
                    </div>
                    <div>
                      <small>CO₂ evitado</small>
                      <strong>{NUM.format(r.co2EvitadoKg || 0)} kg</strong>
                    </div>
                    <div>
                      <small>Atividade</small>
                      <strong>{NUM.format(r.toneladasKm || 0)} t·km</strong>
                    </div>
                    <div>
                      <small>
                        <Gauge size={12} /> Intensidade
                      </small>
                      <strong>
                        {intensidadeOk
                          ? `${NUM2.format(r.intensidadeGCo2ePorTkm)} g/t·km`
                          : "indisponível"}
                      </strong>
                    </div>
                  </div>
                  {!intensidadeOk && f.atividade?.aviso && (
                    <p className="tdg-rel-fechado-aviso">
                      <AlertTriangle size={13} />
                      {f.atividade.aviso}
                    </p>
                  )}
                  <small className="tdg-rel-ressalva">
                    Metodologia {f.versaoFatores || "—"} · qualidade dos dados {f.qualidade || 0}%
                  </small>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="tdg-rel-consolidado">
        <h3>
          <FileText size={16} />
          Posição consolidada da operação
        </h3>
        <p className="tdg-rel-ressalva">
          Visão da carteira inteira, para leitura rápida. Não substitui o relatório por
          cliente, que é o documento com memória de cálculo.
        </p>
        {data.simulacoesSemProcedencia > 0 && (
          <p className="tdg-rel-aviso">
            <AlertTriangle size={16} />
            {data.simulacoesSemProcedencia === 1
              ? "1 simulação ficou fora destes números"
              : `${data.simulacoesSemProcedencia} simulações ficaram fora destes números`}{" "}
            porque foram salvas antes de a confirmação de premissas existir. Refaça e
            confirme para que voltem a contar.
          </p>
        )}
        <div className="tdg-rel-numeros">
          {consolidado.map((item) => (
            <article key={item.rotulo}>
              <small>{item.rotulo}</small>
              <strong>{item.valor}</strong>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
