import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Loader2, SlidersHorizontal, Truck } from "lucide-react";
import { LOGISTICS_PRODUCTS } from "./logisticsVerticalDomain.js";
import {
  CATEGORIAS_PARAMETROS,
  ESCOPO_PARAMETROS,
  PARAMETROS,
  VEHICLE_COST_REFERENCE,
  simularEfeito,
  validarParametros,
} from "./pricingParametersDomain.js";
import {
  PREMISSAS_ATIVO_FIELDS,
  PREMISSAS_ATIVO_PESADO,
  VEICULOS_ATIVO_PESADO,
  ehVeiculoAtivoPesado,
  referenciaEngineAtivoPesado,
} from "./heavyAssetCostDomain.js";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const VEHICLE_KEYS = Object.keys(VEHICLE_COST_REFERENCE);
const incluiCarretaDe = (chave) => VEICULOS_ATIVO_PESADO[chave]?.incluiCarreta ?? true;
// Agrupa os campos de premissa do ativo pesado na ordem em que foram declarados.
const GRUPOS_PREMISSAS = PREMISSAS_ATIVO_FIELDS.reduce((acc, campo) => {
  (acc[campo.grupo] = acc[campo.grupo] || []).push(campo);
  return acc;
}, {});
const paraExibicao = (campo, valor) =>
  campo.escala === "fracao" ? Math.round((Number(valor) || 0) * 1e6) / 1e4 : valor;
const doInput = (campo, texto) => {
  const n = Number(texto);
  if (!Number.isFinite(n)) return texto;
  return campo.escala === "fracao" ? n / 100 : n;
};
const pedir = async (opcoes = {}, authHeaders) => {
  const resposta = await fetch("/api/todogreen/pricing-parameters", {
    ...opcoes,
    headers: { ...(opcoes.body ? { "content-type": "application/json" } : {}), ...(authHeaders?.() || {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível carregar.");
  return dados;
};

const chavePadrao = (tipo) => tipo === "global" ? "global" : "";

export default function PricingParametersPanel({ authHeaders, setToast }) {
  const [dados, setDados] = useState(null);
  const [scopeType, setScopeType] = useState("global");
  const [scopeKey, setScopeKey] = useState("global");
  const [valores, setValores] = useState({});
  const [premissas, setPremissas] = useState(null);
  const [versao, setVersao] = useState("");
  const [nome, setNome] = useState("Base global");
  const [fonte, setFonte] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = async () => {
    setAviso("");
    try {
      const d = await pedir({}, authHeaders);
      setDados(d);
      const global = d.perfis?.find((item) => item.scopeType === "global" && item.scopeKey === "global");
      setValores({ ...(global?.parametros || d.atual.parametros) });
      return d;
    } catch (causa) {
      setAviso(causa.message);
    } finally {
      setCarregando(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selecionarEscopo = (tipo, chave = chavePadrao(tipo)) => {
    setScopeType(tipo);
    setScopeKey(chave);
    const ativo = dados?.perfis?.find((item) => item.scopeType === tipo && item.scopeKey === chave);
    const baseValores = tipo === "global"
      ? { ...(ativo?.parametros || dados?.atual?.parametros || {}) }
      : { ...(ativo?.parametros || {}) };
    // Veículo de ativo pesado (cavalo/carreta elétricos): abre o editor de
    // premissas — valor do ativo, seguro, capital — e deriva veículo/energia/
    // manutenção delas, em vez de um R$/dia chapado.
    if (tipo === "vehicle" && ehVeiculoAtivoPesado(chave)) {
      const premi = { ...PREMISSAS_ATIVO_PESADO, ...(ativo?.parametros?.premissasAtivo || {}) };
      const ref = referenciaEngineAtivoPesado(premi, { incluiCarreta: incluiCarretaDe(chave) });
      setPremissas(premi);
      setValores({ ...baseValores, ...ref, premissasAtivo: premi });
    } else {
      setPremissas(null);
      setValores(baseValores);
    }
    setNome(ativo?.nome || (tipo === "global" ? "Base global" : ""));
    setFonte(ativo?.fonte || "");
  };

  // Uma premissa mudou: recalcula veículo/energia/manutenção e mantém o bloco de
  // premissas junto, para o motor recompor tudo (a fonte da verdade é a premissa).
  const editarPremissa = (campo, texto) => {
    setPremissas((atual) => {
      const proximas = { ...(atual || PREMISSAS_ATIVO_PESADO), [campo.chave]: doInput(campo, texto) };
      const ref = referenciaEngineAtivoPesado(proximas, { incluiCarreta: incluiCarretaDe(scopeKey) });
      setValores((v) => ({ ...v, ...ref, premissasAtivo: proximas }));
      return proximas;
    });
  };

  const restaurarPremissas = () => {
    const premi = { ...PREMISSAS_ATIVO_PESADO };
    const ref = referenciaEngineAtivoPesado(premi, { incluiCarreta: incluiCarretaDe(scopeKey) });
    setPremissas(premi);
    setValores((v) => ({ ...v, ...ref, premissasAtivo: premi }));
  };

  const base = useMemo(() => dados?.atual?.parametros || {}, [dados]);
  const efetivos = useMemo(() => ({ ...base, ...valores }), [base, valores]);
  const validacao = useMemo(() => validarParametros(valores, {
    parcial: scopeType !== "global",
    base,
  }), [base, scopeType, valores]);
  const efeito = useMemo(() => validacao?.valido ? simularEfeito(efetivos, 10000) : null, [efetivos, validacao]);

  const aplicarModelo = (modelo) => {
    setScopeType(modelo.scopeType);
    setScopeKey(modelo.scopeKey);
    setValores({ ...modelo.parametros });
    setNome(modelo.nome);
    setFonte(modelo.source);
    setAviso("");
  };

  const salvar = async () => {
    setSalvando(true);
    setAviso("");
    try {
      const resposta = await pedir({
        method: "POST",
        body: JSON.stringify({ versao, nome, scopeType, scopeKey, parametros: valores, fonte, justificativa }),
      }, authHeaders);
      setToast?.(`Parâmetros ${resposta.versao} em vigor em ${resposta.scopeType}: ${resposta.scopeKey}.`);
      setVersao("");
      setJustificativa("");
      const atualizados = await carregar();
      const ativo = atualizados?.perfis?.find((item) => item.scopeType === scopeType && item.scopeKey === scopeKey);
      if (ativo) {
        setValores({ ...ativo.parametros });
        if (scopeType === "vehicle" && ehVeiculoAtivoPesado(scopeKey)) {
          setPremissas({ ...PREMISSAS_ATIVO_PESADO, ...(ativo.parametros?.premissasAtivo || {}) });
        }
      }
    } catch (causa) {
      setAviso(causa.message);
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) return <section className="tdg-panel"><div className="tdg-esg-carregando"><Loader2 className="girando" size={20} /> Carregando parâmetros...</div></section>;
  if (!dados) return <section className="tdg-panel"><div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{aviso || "Não foi possível carregar os parâmetros."}</span></div></section>;

  const somenteLeitura = !dados.podeEditar;
  const escopo = ESCOPO_PARAMETROS.find((item) => item.id === scopeType);

  return <>
    {aviso ? <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{aviso}</span></div> : null}

    <section className="tdg-panel tdg-parameters">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">PARÂMETROS DO SIMULADOR</span>
          <h2>Custos, margem e regras sem valor escondido</h2>
          <p>A base global é herdada. Produto, modalidade, veículo, região, cliente e contrato substituem apenas o que for específico.</p>
        </div>
        <SlidersHorizontal size={22} />
      </div>

      <div className="tdg-parameter-scope">
        <label>
          <span>Escopo</span>
          <select value={scopeType} disabled={somenteLeitura} onChange={(e) => selecionarEscopo(e.target.value)}>
            {ESCOPO_PARAMETROS.map((item) => <option key={item.id} value={item.id}>{item.rotulo}</option>)}
          </select>
        </label>
        <label>
          <span>{scopeType === "global" ? "Aplicação" : escopo?.rotulo}</span>
          {scopeType === "product" ? (
            <select value={scopeKey} disabled={somenteLeitura} onChange={(e) => selecionarEscopo(scopeType, e.target.value)}>
              <option value="">Selecione o produto</option>
              {LOGISTICS_PRODUCTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          ) : scopeType === "vehicle" ? (
            <select value={scopeKey} disabled={somenteLeitura} onChange={(e) => selecionarEscopo(scopeType, e.target.value)}>
              <option value="">Selecione o veículo</option>
              {VEHICLE_KEYS.map((chave) => <option key={chave} value={chave}>{chave}</option>)}
            </select>
          ) : <input value={scopeKey} disabled={somenteLeitura || scopeType === "global"} placeholder={escopo?.dica} onChange={(e) => selecionarEscopo(scopeType, e.target.value)} />}
        </label>
        <div className="tdg-parameter-inheritance">
          <small>Regra ativa</small>
          <strong>{dados.perfis?.find((item) => item.scopeType === scopeType && item.scopeKey === scopeKey)?.versao || "herdando a base"}</strong>
        </div>
      </div>

      <div className="tdg-parameter-templates">
        <div><BookOpen size={18} /><strong>Modelos de referência</strong><small>Copiam valores para edição. Não ativam nada sozinhos.</small></div>
        {dados.modelos?.map((modelo) => <button type="button" key={modelo.id} disabled={somenteLeitura} onClick={() => aplicarModelo(modelo)}>{modelo.nome}</button>)}
      </div>

      {premissas && scopeType === "vehicle" ? (
        <fieldset className="tdg-parameter-group tdg-parameter-asset">
          <legend><Truck size={16} /> Premissas do ativo pesado — {VEICULOS_ATIVO_PESADO[scopeKey]?.rotulo || scopeKey}</legend>
          <p className="tdg-esg-nota">
            O custo deste veículo é dominado pelo ativo: depreciação, custo de capital e seguro sobre o valor.
            Edite as premissas e o custo de veículo, energia e manutenção recompõem sozinhos. É o
            &ldquo;compramos um cavalo mais caro&rdquo; num lugar só, versionado.
          </p>
          <div className="tdg-esg-pesos">
            <div><small>veículo por dia</small><strong>{brl.format(valores.vehicleDailyCost || 0)}</strong></div>
            <div><small>motorista por dia</small><strong>{brl.format(valores.driverDailyCost || 0)}</strong></div>
            <div><small>energia por km</small><strong>R$ {Number(valores.energyCostPerKm || 0).toFixed(4)}</strong></div>
            <div><small>manutenção por km</small><strong>R$ {Number(valores.maintenancePerKm || 0).toFixed(4)}</strong></div>
          </div>
          {Object.entries(GRUPOS_PREMISSAS).map(([grupo, campos]) => (
            <div key={grupo} className="tdg-parameter-subgroup">
              <h4>{grupo}</h4>
              <div className="tdg-form">
                {campos.map((campo) => (
                  <label key={campo.chave}>
                    <span>{campo.rotulo} ({campo.sufixo})</span>
                    <input
                      type="number"
                      min={campo.escala === "fracao" ? campo.min * 100 : campo.min}
                      max={campo.escala === "fracao" ? campo.max * 100 : campo.max}
                      step="any"
                      value={paraExibicao(campo, premissas[campo.chave])}
                      disabled={somenteLeitura}
                      onChange={(e) => editarPremissa(campo, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!somenteLeitura ? (
            <button type="button" className="tdg-btn-ghost" onClick={restaurarPremissas}>
              Restaurar premissas de fábrica (XCMG)
            </button>
          ) : null}
        </fieldset>
      ) : null}

      {CATEGORIAS_PARAMETROS.map((categoria) => {
        const campos = Object.entries(PARAMETROS).filter(([, def]) => def.categoria === categoria.id);
        return <fieldset className="tdg-parameter-group" key={categoria.id}>
          <legend>{categoria.rotulo}</legend>
          <div className="tdg-form">
            {campos.map(([chave, def]) => <label key={chave}>
              <span>{def.rotulo} {def.sufixo ? `(${def.sufixo})` : ""}</span>
              <input
                type="number"
                min={def.min}
                max={def.max}
                step="any"
                value={valores[chave] ?? ""}
                placeholder={scopeType === "global" ? "0" : `Herdado: ${base[chave] ?? 0}`}
                disabled={somenteLeitura}
                onChange={(e) => setValores((atual) => {
                  const proximo = { ...atual };
                  if (e.target.value === "" && scopeType !== "global") delete proximo[chave];
                  else proximo[chave] = e.target.value;
                  return proximo;
                })}
              />
              <small className="tdg-esg-nota">{def.descricao}</small>
            </label>)}
          </div>
        </fieldset>;
      })}

      {validacao && !validacao.valido ? <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{validacao.erros.join(" ")}</span></div> : null}

      {efeito ? <div className="tdg-esg-pesos">
        <div><small>custo de referência</small><strong>{brl.format(efeito.custoDireto)}</strong></div>
        <div><small>custo carregado</small><strong>{brl.format(efeito.custoCarregado)}</strong></div>
        <div><small>preço mínimo</small><strong>{brl.format(efeito.precoMinimo)}</strong></div>
        <div><small>preço recomendado</small><strong>{brl.format(efeito.precoRecomendado)}</strong></div>
      </div> : null}

      {somenteLeitura ? <p className="tdg-esg-nota">Seu papel consulta os parâmetros, mas não altera custos nem fórmulas oficiais.</p> : <div className="tdg-parameter-publish">
        <label><span>Nome</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Middle Mile Spot SP" /></label>
        <label><span>Versão nova</span><input value={versao} onChange={(e) => setVersao(e.target.value)} placeholder="Ex.: 2026.08.1" /></label>
        <label><span>Fonte</span><input value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="Cotação, contrato, planilha ou estudo" /></label>
        <label className="tdg-parameter-why"><span>Justificativa</span><textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="O que mudou e por quê" /></label>
        <button className="tdg-action" type="button" disabled={salvando || !validacao?.valido || !versao || !scopeKey || justificativa.length < 5} onClick={salvar}>{salvando ? "Salvando..." : "Ativar nova versão"}</button>
      </div>}
    </section>

    {dados.historico?.length ? <section className="tdg-panel">
      <div className="tdg-section-head"><div><span className="tdg-kicker">HISTÓRICO</span><h2>Versões e justificativas</h2></div></div>
      <ul className="tdg-esg-historico">{dados.historico.map((item) => <li key={item.id || `${item.scopeType}-${item.scopeKey}-${item.versao}`}>
        <div className="tdg-esg-ponto"><strong>{item.nome || item.versao}</strong><small>{item.versao} · {item.scopeType || "global"}: {item.scopeKey || "global"} · {item.status === "active" ? "em vigor" : "encerrada"}</small></div>
        <p>{item.mudanca}</p><p><em>{item.justificativa}</em></p>
      </li>)}</ul>
    </section> : null}
  </>;
}
