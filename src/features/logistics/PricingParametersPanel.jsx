import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Loader2, SlidersHorizontal } from "lucide-react";
import { LOGISTICS_PRODUCTS } from "./logisticsVerticalDomain.js";
import {
  CATEGORIAS_PARAMETROS,
  ESCOPO_PARAMETROS,
  PARAMETROS,
  simularEfeito,
  validarParametros,
} from "./pricingParametersDomain.js";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
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
    setValores(tipo === "global" ? { ...(ativo?.parametros || dados?.atual?.parametros || {}) } : { ...(ativo?.parametros || {}) });
    setNome(ativo?.nome || (tipo === "global" ? "Base global" : ""));
    setFonte(ativo?.fonte || "");
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
      if (ativo) setValores({ ...ativo.parametros });
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
