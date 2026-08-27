import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, NotebookPen } from "lucide-react";
import {
  BLOCOS_DO_BRIEFING,
  NAO_SE_APLICA,
} from "./clientBriefingDomain.js";

// ===== O desenho da conta =====
//
// Ao lado do gate técnico ("o sistema está configurado?"), esta é a outra
// leitura da mesma conta: "esta conta foi desenhada?" — abrangência, modelo
// operacional, HC por etapa, régua de SLA ou BSC, integração, faturamento,
// ocorrência e RASCI.
//
// A tela salva UM BLOCO POR VEZ, de propósito. Um formulário com trinta e oito
// campos e um botão no fim é um formulário que ninguém termina; oito blocos
// curtos, cada um com o próprio "salvar", é conversa que dá para retomar amanhã
// de onde parou.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const valorParaCampo = (campo, valor) => {
  if (valor === NAO_SE_APLICA) return NAO_SE_APLICA;
  if (valor === undefined || valor === null) return campo.tipo === "sim-nao" ? "" : "";
  if (campo.tipo === "lista") return Array.isArray(valor) ? valor.join("\n") : String(valor);
  if (campo.tipo === "sim-nao") return valor === true ? "sim" : valor === false ? "nao" : "";
  return String(valor);
};

const campoParaEnvio = (campo, bruto) => {
  if (bruto === NAO_SE_APLICA) return NAO_SE_APLICA;
  if (bruto === "" || bruto === undefined) return undefined;
  if (campo.tipo === "sim-nao") return bruto === "sim" ? true : bruto === "nao" ? false : undefined;
  if (["numero", "moeda", "percentual"].includes(campo.tipo)) {
    // Aceita "18,50" e "18.50": quem digita valor em português usa vírgula, e
    // recusar isso seria transformar o formulário numa prova de digitação.
    const n = Number(String(bruto).replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return bruto;
};

function Campo({ campo, valor, onChange }) {
  const naoSeAplica = valor === NAO_SE_APLICA;
  const id = `bf-${campo.id}`;

  const controle = () => {
    if (naoSeAplica)
      return <input id={id} value="Não se aplica" readOnly disabled />;
    if (campo.tipo === "lista")
      return (
        <textarea id={id} rows={3} value={valor} onChange={(e) => onChange(e.target.value)}
          placeholder="Um por linha" />
      );
    if (campo.tipo === "escolha")
      return (
        <select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
          <option value="">Escolher…</option>
          {campo.opcoes.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
        </select>
      );
    if (campo.tipo === "sim-nao")
      return (
        <select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
          <option value="">Escolher…</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      );
    if (campo.tipo === "texto" && campo.id !== "preco")
      return <textarea id={id} rows={2} value={valor} onChange={(e) => onChange(e.target.value)} />;
    return (
      <input id={id} value={valor} onChange={(e) => onChange(e.target.value)}
        inputMode={["numero", "moeda", "percentual"].includes(campo.tipo) ? "decimal" : "text"} />
    );
  };

  return (
    <label className="ca-bf-campo" htmlFor={id}>
      <span className="ca-bf-rotulo">
        {campo.rotulo}
        {campo.unidade && <em> ({campo.unidade})</em>}
        {campo.tipo === "percentual" && <em> (%)</em>}
        {!campo.essencial && <small>opcional</small>}
      </span>
      {controle()}
      {campo.ajuda && !naoSeAplica && <small className="ca-bf-ajuda">{campo.ajuda}</small>}
      {campo.permiteNaoSeAplica && (
        // "Não se aplica" é resposta. Sem ela, a única forma de completar o
        // briefing numa operação sem processamento seria mentir.
        <button type="button" className="ca-bf-na"
          onClick={() => onChange(naoSeAplica ? "" : NAO_SE_APLICA)}>
          {naoSeAplica ? "Voltar a preencher" : "Não se aplica"}
        </button>
      )}
    </label>
  );
}

function Bloco({ bloco, avaliacao, valores, onSalvar, salvando }) {
  const [rascunho, setRascunho] = useState({});
  const [aberto, setAberto] = useState(!avaliacao?.completo);

  // Quando o servidor devolve valores novos (outra pessoa salvou, ou a página
  // recarregou), o rascunho local precisa acompanhar — senão a tela mostra o
  // que foi digitado antes por cima do que está gravado agora.
  useEffect(() => {
    const inicial = {};
    for (const campo of bloco.campos) inicial[campo.id] = valorParaCampo(campo, valores[campo.id]);
    setRascunho(inicial);
  }, [bloco, valores]);

  const salvar = (evento) => {
    evento.preventDefault();
    const envio = {};
    for (const campo of bloco.campos) {
      const valor = campoParaEnvio(campo, rascunho[campo.id]);
      if (valor !== undefined) envio[campo.id] = valor;
    }
    onSalvar(envio);
  };

  return (
    <section className={`ca-bf-bloco${avaliacao?.completo ? " completo" : ""}`}>
      <header>
        <button type="button" className="ca-bf-cabecalho" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}>
          <span>
            <strong>{bloco.titulo}</strong>
            <small>{bloco.descricao}</small>
          </span>
          <span className="ca-bf-medida">
            {avaliacao?.completo
              ? <CheckCircle2 size={16} />
              : <b>{avaliacao?.preenchidos ?? 0}/{avaliacao?.total ?? 0}</b>}
          </span>
        </button>
      </header>
      {aberto && (
        <form onSubmit={salvar}>
          <div className="ca-bf-grade">
            {bloco.campos.map((campo) => (
              <Campo key={campo.id} campo={campo} valor={rascunho[campo.id] ?? ""}
                onChange={(v) => setRascunho((atual) => ({ ...atual, [campo.id]: v }))} />
            ))}
          </div>
          <div className="ca-bf-acoes">
            <button type="submit" className="ca-primary" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar este bloco"}
            </button>
            {!avaliacao?.completo && avaliacao?.faltando?.length > 0 && (
              <small>Falta: {avaliacao.faltando.map((item) => item.rotulo).join(", ")}</small>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

export default function ClientBriefingPanel({ briefing, onSalvar, salvando }) {
  const avaliacaoPorBloco = useMemo(() => {
    const mapa = new Map();
    for (const bloco of briefing?.avaliacao?.blocos || []) mapa.set(bloco.id, bloco);
    return mapa;
  }, [briefing]);

  if (!briefing) return <div className="ca-loading"><LoaderCircle className="spin" />Carregando o desenho da conta…</div>;

  const { avaliacao, comercial, valores } = briefing;

  return (
    <div className="ca-bf">
      <section className="ca-summary">
        <div className="ca-progress-copy">
          <span>Desenho da conta</span>
          <strong>{avaliacao.preenchidos} de {avaliacao.total} pontos definidos</strong>
          <small>
            {avaliacao.completo
              ? "A conta está desenhada."
              : `${avaliacao.faltando.length} ponto(s) ainda em aberto.`}
          </small>
        </div>
        <div className="ca-progress" aria-label={`${avaliacao.percentual}% definido`}>
          <span style={{ width: `${avaliacao.percentual}%` }} />
        </div>
        <b>{avaliacao.percentual}%</b>
      </section>

      {/* O que a diretoria pergunta primeiro. Campo em branco fica em branco:
          estimar com uma ponta ausente seria inventar número. */}
      <section className="ca-bf-comercial">
        <div>
          <dt>Ticket médio</dt>
          <dd>{comercial.ticketMedio === null ? "—" : BRL.format(comercial.ticketMedio)}</dd>
        </div>
        <div>
          <dt>Margem</dt>
          <dd>{comercial.margemPercentual === null ? "—" : `${comercial.margemPercentual}%`}</dd>
        </div>
        <div>
          <dt>Receita mensal estimada</dt>
          <dd>{comercial.receitaMensalEstimada === null ? "—" : BRL.format(comercial.receitaMensalEstimada)}</dd>
        </div>
        <div>
          <dt>Abrangência</dt>
          <dd>{comercial.cidades} cidade(s) · {comercial.bases} base(s)</dd>
        </div>
        <div>
          <dt>Motoristas por dia</dt>
          <dd>{comercial.motoristasDia === null ? "—" : comercial.motoristasDia}</dd>
        </div>
      </section>

      {!avaliacao.completo && (
        <p className="ca-bf-aviso">
          <CircleAlert size={15} />
          O desenho da conta não bloqueia a ativação — ele mostra o que ainda não
          foi combinado. Entrar em operação com ponto em aberto é decisão de
          gente, não do sistema.
        </p>
      )}

      <h3 className="ca-bf-titulo"><NotebookPen size={16} /> Blocos</h3>
      {BLOCOS_DO_BRIEFING.map((bloco) => (
        <Bloco
          key={bloco.id}
          bloco={bloco}
          avaliacao={avaliacaoPorBloco.get(bloco.id)}
          valores={valores || {}}
          onSalvar={onSalvar}
          salvando={salvando}
        />
      ))}
    </div>
  );
}
