import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Leaf, Loader2, Scale } from "lucide-react";
import EnergyPanel from "./pages/EnergyPanel.jsx";

// ===== Central ESG (lado interno) =====
//
// A tela onde a To Do Green calcula, vê a régua em vigor e acompanha o
// histórico com a explicação de cada variação. Consome a mesma API que grava
// os registros auditáveis — nenhum cálculo acontece aqui no navegador, porque
// número ambiental que não fica gravado com memória não vale para relatório.

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const pedir = async (caminho, opcoes = {}, authHeaders) => {
  const resposta = await fetch(`/api/todogreen/esg/${caminho}`, {
    ...opcoes,
    headers: {
      ...(opcoes.body ? { "content-type": "application/json" } : {}),
      ...(authHeaders?.() || {}),
    },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível concluir.");
  return dados;
};

function Regua({ pesos }) {
  if (!pesos) return null;
  const total = Object.values(pesos.pesos || {}).reduce((a, b) => a + Number(b || 0), 0);
  return (
    <section className="tdg-panel">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">RÉGUA EM VIGOR</span>
          <h2>Pesos do Green Score</h2>
          <p>{pesos.metodologia}</p>
        </div>
        <strong>{pesos.versao}</strong>
      </div>
      <div className="tdg-esg-pesos">
        {Object.entries(pesos.pesos || {}).map(([chave, peso]) => (
          <div key={chave}>
            <small>{chave.replace(/([A-Z])/g, " $1").toLowerCase()}</small>
            <strong>{peso}%</strong>
          </div>
        ))}
      </div>
      <p className="tdg-esg-nota">
        Somam {total}%. Responsável: {pesos.responsavel}. Mudar um peso cria uma
        versão nova — o score já gravado continua apontando para a versão com
        que nasceu, então o histórico não muda de forma retroativa.
      </p>
    </section>
  );
}

function Fatores({ fatores }) {
  if (!fatores) return null;
  return (
    <section className="tdg-panel">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">FATORES AMBIENTAIS</span>
          <h2>Cada fator com fonte, unidade e responsável</h2>
        </div>
        <strong>{fatores.versao}</strong>
      </div>
      <div className="tdg-tabela-frame">
        <table className="tdg-tabela">
          <thead>
            <tr>
              <th>Fator</th>
              <th>Valor</th>
              <th>Unidade</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(fatores.fatores || {}).map(([chave, fator]) => (
              <tr key={chave}>
                <td>{chave.replace(/_/g, " ")}</td>
                <td>{fator.valor}</td>
                <td>{fator.unidade}</td>
                <td>{fator.fonte}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tdg-esg-nota">
        Vigência a partir de {fatores.vigenciaInicio}. Responsável:{" "}
        {fatores.responsavel}.
      </p>
    </section>
  );
}

function Historico({ historico, benchmark }) {
  if (!historico?.length)
    return (
      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div>
            <span className="tdg-kicker">HISTÓRICO</span>
            <h2>Nenhum Green Score calculado para este cliente</h2>
          </div>
        </div>
        <p className="tdg-esg-nota">
          Calcule o primeiro período acima. Cada cálculo fica gravado com as
          entradas, a versão dos fatores e a memória completa.
        </p>
      </section>
    );

  return (
    <section className="tdg-panel">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">HISTÓRICO</span>
          <h2>Green Score ao longo do tempo</h2>
        </div>
        <strong>{benchmark?.texto}</strong>
      </div>
      <ul className="tdg-esg-historico">
        {historico.map((ponto, i) => (
          <li key={`${ponto.calculadoEm}-${i}`}>
            <div className="tdg-esg-ponto">
              <strong>{numero.format(ponto.score)}</strong>
              <small>
                {new Date(ponto.calculadoEm).toLocaleDateString("pt-BR")} · pesos{" "}
                {ponto.versaoPesos} · qualidade {ponto.qualidadeDados}%
              </small>
            </div>
            <p>{ponto.explicacaoVariacao}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function EsgCenter({ authHeaders, setToast }) {
  const [fatores, setFatores] = useState(null);
  const [pesos, setPesos] = useState(null);
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [benchmark, setBenchmark] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [operacao, setOperacao] = useState({
    referencia: "",
    distanciaKm: "",
    viagens: "",
    tipoVeiculo: "",
    ocupacaoPercent: "",
    frotaLimpaPercent: "",
    ocorrencias: "",
    origemDistancia: "",
  });

  useEffect(() => {
    let vivo = true;
    Promise.all([
      pedir("fatores", {}, authHeaders),
      fetch(`/api/todogreen/clients`, { headers: authHeaders?.() || {} })
        .then((r) => (r.ok ? r.json() : { clientes: [] }))
        .catch(() => ({ clientes: [] })),
    ])
      .then(([esg, lista]) => {
        if (!vivo) return;
        setFatores(esg.fatores);
        setPesos(esg.pesos);
        setClientes(lista.clientes || []);
        if (lista.clientes?.length) setClienteId(lista.clientes[0].id);
      })
      .catch((causa) => vivo && setAviso(causa.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [authHeaders]);

  const carregarHistorico = useCallback(
    (id) => {
      if (!id) return;
      pedir(`historico?cliente=${encodeURIComponent(id)}`, {}, authHeaders)
        .then((d) => {
          setHistorico(d.historico || []);
          setBenchmark(d.benchmark);
        })
        .catch((causa) => setAviso(causa.message));
    },
    [authHeaders],
  );

  useEffect(() => {
    carregarHistorico(clienteId);
  }, [clienteId, carregarHistorico]);

  const calcular = async () => {
    if (!clienteId) {
      setAviso("Escolha um cliente antes de calcular.");
      return;
    }
    const faltantes = [
      [Number(operacao.distanciaKm) > 0, "distância"],
      [Number(operacao.viagens) > 0, "viagens"],
      [operacao.tipoVeiculo.trim(), "tipo de veículo"],
      [
        operacao.ocupacaoPercent !== "" &&
          Number(operacao.ocupacaoPercent) >= 0 &&
          Number(operacao.ocupacaoPercent) <= 100,
        "ocupação",
      ],
      [
        operacao.frotaLimpaPercent !== "" &&
          Number(operacao.frotaLimpaPercent) >= 0 &&
          Number(operacao.frotaLimpaPercent) <= 100,
        "frota de baixa emissão",
      ],
      [operacao.ocorrencias !== "" && Number(operacao.ocorrencias) >= 0, "ocorrências"],
      [operacao.origemDistancia, "origem da distância"],
    ]
      .filter(([valido]) => !valido)
      .map(([, nome]) => nome);
    if (faltantes.length) {
      setAviso(`Revise os campos pendentes: ${faltantes.join(", ")}.`);
      return;
    }
    setCalculando(true);
    setAviso("");
    try {
      const resposta = await pedir(
        "calcular",
        {
          method: "POST",
          body: JSON.stringify({
            clienteId,
            operacoes: [
              {
                referencia: operacao.referencia || "Operação",
                distanciaKm: Number(operacao.distanciaKm),
                viagens: Number(operacao.viagens),
                tipoVeiculo: operacao.tipoVeiculo,
                origens: { distancia: operacao.origemDistancia },
              },
            ],
            ocupacaoPercent: Number(operacao.ocupacaoPercent),
            frotaLimpaPercent: Number(operacao.frotaLimpaPercent),
            ocorrencias: Number(operacao.ocorrencias),
          }),
        },
        authHeaders,
      );
      setToast?.(
        `Green Score ${numero.format(resposta.greenScore.valor)} gravado com memória de cálculo`,
      );
      carregarHistorico(clienteId);
    } catch (causa) {
      setAviso(causa.message);
    } finally {
      setCalculando(false);
    }
  };

  if (carregando)
    return (
      <section className="tdg-panel">
        <div className="tdg-esg-carregando">
          <Loader2 className="girando" size={20} /> Carregando Central ESG...
        </div>
      </section>
    );

  return (
    <>
      {aviso ? (
        <div className="tdg-alert" role="alert">
          <AlertTriangle size={18} />
          <span>{aviso}</span>
        </div>
      ) : null}

      {/* Energia da frota, embutida na Central ESG — a mesma visão da página
          própria de Energia, num componente só. */}
      <EnergyPanel authHeaders={authHeaders} />

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div>
            <span className="tdg-kicker">CENTRAL ESG</span>
            <h2>Calcular impacto e apurar o Green Score</h2>
            <p>
              Cada cálculo é gravado com as entradas, a versão dos fatores e a
              memória completa — é isso que permite refazer a conta depois.
            </p>
          </div>
          <Leaf size={22} />
        </div>

        <form className="tdg-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>Cliente</span>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              {clientes.length === 0 ? <option value="">Nenhum cliente cadastrado</option> : null}
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Referência da operação</span>
            <input
              value={operacao.referencia}
              onChange={(e) => setOperacao((o) => ({ ...o, referencia: e.target.value }))}
              placeholder="Rota CD → Hub"
            />
          </label>
          {[
            ["distanciaKm", "Distância (km)"],
            ["viagens", "Viagens no período"],
            ["ocupacaoPercent", "Ocupação média (%)"],
            ["frotaLimpaPercent", "Frota de baixa emissão (%)"],
            ["ocorrencias", "Ocorrências"],
          ].map(([chave, rotulo]) => (
            <label key={chave}>
              <span>{rotulo}</span>
              <input
                required
                type="number"
                min={chave === "distanciaKm" || chave === "viagens" ? "0.01" : "0"}
                max={chave === "ocupacaoPercent" || chave === "frotaLimpaPercent" ? "100" : undefined}
                step="any"
                inputMode="decimal"
                value={operacao[chave]}
                onChange={(e) => setOperacao((o) => ({ ...o, [chave]: e.target.value }))}
              />
            </label>
          ))}
          <label>
            <span>Tipo de veículo</span>
            <input
              required
              value={operacao.tipoVeiculo}
              onChange={(e) => setOperacao((o) => ({ ...o, tipoVeiculo: e.target.value }))}
            />
          </label>
          <label>
            <span>Origem do dado de distância</span>
            <select
              value={operacao.origemDistancia}
              onChange={(e) => setOperacao((o) => ({ ...o, origemDistancia: e.target.value }))}
            >
              <option value="">Selecione a procedência</option>
              <option value="medido">Medido (telemetria)</option>
              <option value="documentado">Documentado</option>
              <option value="estimado">Estimado</option>
              <option value="presumido">Presumido</option>
            </select>
          </label>
        </form>

        <p className="tdg-esg-nota">
          A origem do dado entra no cálculo: quanto menos medição, menor a
          qualidade, e um relatório com qualidade abaixo de 70% avisa que serve
          para tendência, não para uso regulatório.
        </p>

        <button
          className="tdg-action"
          type="button"
          onClick={calcular}
          disabled={calculando || !clienteId}
        >
          {calculando ? "Calculando..." : "Calcular e gravar"}
        </button>
      </section>

      <Historico historico={historico} benchmark={benchmark} />
      <Regua pesos={pesos} />
      <Fatores fatores={fatores} />

      <section className="tdg-panel tdg-esg-ressalva">
        <div className="tdg-section-head">
          <div>
            <span className="tdg-kicker">COMO ESTES NÚMEROS DEVEM SER LIDOS</span>
            <h2>Indicador proprietário, não certificação</h2>
          </div>
          <Scale size={20} />
        </div>
        <p>
          O Green Score e os indicadores ambientais são estimativas próprias da
          To Do Green, reproduzíveis pela memória de cálculo. Não constituem
          certificação ambiental, verificação por terceira parte nem inventário
          auditado — e nenhum material comercial deve apresentá-los como tal.
        </p>
      </section>
    </>
  );
}
