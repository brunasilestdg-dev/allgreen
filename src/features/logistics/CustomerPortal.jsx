import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Download,
  FileText,
  Gauge,
  Home,
  Leaf,
  Loader2,
  MessageSquare,
  PackageCheck,
  Route,
  Sparkles,
} from "lucide-react";
import "./CustomerPortal.css";
import { tamanhoLegivel } from "./documentVaultDomain.js";
import Operacoes from "./CustomerPortalOperations.jsx";
import {
  AssistenteCliente,
  GreenScoreDetalhado,
  ImpactoAmbiental,
} from "./CustomerPortalInsights.jsx";
import { comRotulo } from "./rotulosDomain.js";

const ICONES = {
  inicio: Home,
  operacoes: Route,
  "green-score": Gauge,
  esg: Leaf,
  relatorios: FileText,
  financeiro: Banknote,
  documentos: FileText,
  solicitacoes: PackageCheck,
  assistente: MessageSquare,
};

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const authHeaders = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token") || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

// A empresa escolhida viaja em toda chamada. Quem valida é o servidor, contra a
// lista de vínculos da sessão — o valor guardado aqui é preferência de tela, não
// credencial.
const CHAVE_EMPRESA = "tdg-portal-empresa";

export const empresaEscolhida = () => {
  try {
    return localStorage.getItem(CHAVE_EMPRESA) || "";
  } catch {
    return "";
  }
};

export const escolherEmpresa = (id) => {
  try {
    if (id) localStorage.setItem(CHAVE_EMPRESA, id);
    else localStorage.removeItem(CHAVE_EMPRESA);
  } catch {
    /* navegador sem armazenamento: segue com a empresa padrão */
  }
};

const comEmpresa = (caminho) => {
  // Tolera caminho já prefixado: passar "/api/todogreen/portal/financeiro" aqui
  // duplicava o prefixo e o endpoint respondia 404 (a aba Faturas não carregava).
  // Normaliza para relativo para que a duplicação não volte por outro caminho.
  const limpo = String(caminho).replace(/^\/?(api\/todogreen\/portal\/)+/, "");
  const empresa = empresaEscolhida();
  if (!empresa) return `/api/todogreen/portal/${limpo}`;
  const separador = limpo.includes("?") ? "&" : "?";
  return `/api/todogreen/portal/${limpo}${separador}empresa=${encodeURIComponent(empresa)}`;
};

const pedir = async (caminho) => {
  const resposta = await fetch(comEmpresa(caminho), { headers: authHeaders() });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível carregar.");
  return dados;
};

const enviar = async (caminho, corpo, metodo = "POST") => {
  const resposta = await fetch(comEmpresa(caminho), {
    method: metodo,
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível concluir a ação.");
  return dados;
};

function Indicador({ rotulo, valor, detalhe, tom = "neutro" }) {
  return (
    <div className={`cp-indicador ${tom}`}>
      <span>{rotulo}</span>
      <strong>{valor}</strong>
      {detalhe ? <small>{detalhe}</small> : null}
    </div>
  );
}

function SemDados({ titulo, texto }) {
  return (
    <div className="cp-vazio">
      <Sparkles size={22} />
      <strong>{titulo}</strong>
      <p>{texto}</p>
    </div>
  );
}

// Uma seção da home, por persona: quem cuida de logística, de ESG e de
// financeiro encontra o seu recorte sem caçar entre indicadores misturados.
// Cada seção leva à aba completa daquele assunto.
function PersonaSecao({ icone: Icone, titulo, descricao, irRotulo, aoIr, children }) {
  return (
    <section className="cp-persona">
      <header className="cp-persona-cabecalho">
        <div className="cp-persona-titulo"><Icone size={18} /><div><h2>{titulo}</h2><p>{descricao}</p></div></div>
        {aoIr && <button type="button" className="cp-persona-link" onClick={aoIr}>{irRotulo} →</button>}
      </header>
      <div className="cp-indicadores">{children}</div>
    </section>
  );
}

function Inicio({ resumo, financeiro, onIr }) {
  if (!resumo) return null;
  if (resumo.semDados)
    return (
      <SemDados
        titulo="Ainda não há operação registrada"
        texto="Assim que a To Do Green registrar as primeiras operações do seu contrato, os indicadores aparecem aqui com a memória de cálculo por trás de cada número."
      />
    );

  const { operacoes, ambiental, greenScore } = resumo;
  const temFinanceiro = financeiro && financeiro.totais;
  return (
    <div className="cp-personas">
      <PersonaSecao
        icone={Route}
        titulo="Logística"
        descricao="Suas operações e entregas no período."
        irRotulo="Ver operações"
        aoIr={onIr ? () => onIr("operacoes") : undefined}
      >
        <Indicador
          rotulo="Operações"
          valor={inteiro.format(operacoes?.total || 0)}
          detalhe={`${inteiro.format(operacoes?.entregas || 0)} entregas`}
        />
        <Indicador
          rotulo="Distância"
          valor={`${inteiro.format(operacoes?.distanciaKm || 0)} km`}
          detalhe={`ocupação média ${numero.format(operacoes?.ocupacaoMedia || 0)}%`}
        />
      </PersonaSecao>

      <PersonaSecao
        icone={Leaf}
        titulo="ESG e impacto ambiental"
        descricao="O que sua operação elétrica evitou emitir."
        irRotulo="Ver impacto"
        aoIr={onIr ? () => onIr("esg") : undefined}
      >
        <Indicador
          rotulo="Green Score"
          valor={greenScore ? numero.format(greenScore.valor ?? greenScore.score) : "—"}
          detalhe={greenScore ? `pesos ${greenScore.versaoPesos || greenScore.weightsVersion || "—"} · indicador proprietário` : "ainda não calculado"}
          tom={greenScore ? "bom" : "neutro"}
        />
        <Indicador
          rotulo="CO₂ evitado"
          valor={`${numero.format((ambiental?.co2EvitadoKg || 0) / 1000)} t`}
          detalhe={`${numero.format(ambiental?.reducaoPercent || 0)}% de redução`}
          tom="bom"
        />
        <Indicador
          rotulo="Diesel não consumido"
          valor={`${inteiro.format(ambiental?.dieselEvitadoL || 0)} L`}
          detalhe={`${ambiental?.calculos || 0} cálculo(s) auditável(is)`}
        />
      </PersonaSecao>
      {ambiental?.qualidadeDados > 0 && ambiental.qualidadeDados < 70 ? (
        <div className="cp-alerta">
          <AlertTriangle size={18} />
          <span>A qualidade dos dados está em {numero.format(ambiental.qualidadeDados)}%. Os números servem para acompanhar tendência, mas exigem cautela para uso regulatório.</span>
        </div>
      ) : null}

      {temFinanceiro ? (
        <PersonaSecao
          icone={Banknote}
          titulo="Financeiro"
          descricao="O que está em aberto e o que já foi quitado."
          irRotulo="Ver faturas"
          aoIr={onIr ? () => onIr("financeiro") : undefined}
        >
          <Indicador
            rotulo="Em aberto"
            valor={BRL_PORTAL.format(financeiro.totais.emAberto || 0)}
            detalhe="soma dos títulos não quitados"
            tom={financeiro.totais.emAberto ? "alerta" : "positivo"}
          />
          <Indicador
            rotulo="Quitado"
            valor={BRL_PORTAL.format(financeiro.totais.quitado || 0)}
            detalhe="histórico liquidado"
            tom="positivo"
          />
        </PersonaSecao>
      ) : null}
    </div>
  );
}


const periodoPadrao = () => {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const iso = (data) => data.toISOString().slice(0, 10);
  return { inicio: iso(inicio), fim: iso(hoje) };
};

function Relatorios({ setAviso }) {
  const [periodo, setPeriodo] = useState(periodoPadrao);
  const [gerando, setGerando] = useState("");

  const gerar = async (formato) => {
    setGerando(formato.id);
    setAviso("");
    try {
      const dados = await pedir(`relatorio?inicio=${encodeURIComponent(periodo.inicio)}&fim=${encodeURIComponent(periodo.fim)}`);
      const [{ montarRelatorio }, { FORMATOS }] = await Promise.all([
        import("./esgReportDomain.js"),
        import("./esgReportFormats.js"),
      ]);
      const relatorio = montarRelatorio({
        cliente: dados.cliente,
        periodo: { tipo: "mensal", inicio: dados.periodo.inicio, fim: dados.periodo.fim },
        escopo: "cliente",
        calculos: dados.calculos,
        greenScore: dados.greenScore,
        operacoes: dados.operacoes,
      });
      const exportador = FORMATOS.find((item) => item.id === formato.id);
      if (!exportador) throw new Error("Formato indisponível.");
      await exportador.baixar(relatorio);
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setGerando("");
    }
  };

  return (
    <section className="cp-relatorios">
      <p>O relatório inclui metodologia, premissas, fontes, qualidade dos dados e memória de cálculo.</p>
      <div className="cp-periodo">
        <label><span>Início</span><input type="date" value={periodo.inicio} onChange={(e) => setPeriodo((atual) => ({ ...atual, inicio: e.target.value }))} /></label>
        <label><span>Fim</span><input type="date" value={periodo.fim} onChange={(e) => setPeriodo((atual) => ({ ...atual, fim: e.target.value }))} /></label>
      </div>
      <div className="cp-formatos">
        {[{ id: "pdf", rotulo: "PDF" }, { id: "xlsx", rotulo: "Planilha" }, { id: "csv", rotulo: "CSV" }, { id: "pptx", rotulo: "Apresentação" }, { id: "html", rotulo: "HTML" }].map((formato) => (
          <button key={formato.id} type="button" onClick={() => gerar(formato)} disabled={!!gerando}>{gerando === formato.id ? "Gerando..." : formato.rotulo}</button>
        ))}
      </div>
    </section>
  );
}

const BRL_PORTAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Faturas do próprio cliente: vencimento, saldo e 2ª via do documento fiscal.
function Faturas({ setAviso }) {
  const [dados, setDados] = useState(null);
  useEffect(() => {
    // `pedir` já prefixa /api/todogreen/portal/ — passar o caminho absoluto
    // duplicava o prefixo e o endpoint respondia 404 (a aba nunca carregava).
    pedir("financeiro")
      .then(setDados)
      .catch((motivo) => setAviso?.(motivo.message));
  }, [setAviso]);
  const baixarXml = async (titulo) => {
    try {
      const resposta = await fetch(comEmpresa(`financeiro/${titulo.id}/xml`), { headers: authHeaders() });
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({})))?.error || "Documento indisponível.");
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titulo.documento?.tipo || "documento"}-${titulo.documento?.numero || titulo.numero}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (motivo) { setAviso?.(motivo.message); }
  };
  const titulos = dados?.titulos || [];
  // O back-end não vira o status para "vencida" sozinho por data — então aqui,
  // se o título ainda está em aberto e a data de vencimento já passou, o cliente
  // vê "vencida" (e há quantos dias), em vez de um "em aberto" que esconde o atraso.
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const situacaoDoTitulo = (titulo) => {
    if (titulo.status === "settled") return { rotulo: "quitada", atrasada: false };
    if (titulo.status === "partial") return { rotulo: "parcialmente paga", atrasada: false };
    const venc = titulo.venceEm ? new Date(`${String(titulo.venceEm).slice(0, 10)}T00:00:00`) : null;
    if (titulo.status === "overdue" || (venc && !Number.isNaN(venc.getTime()) && venc < hoje)) {
      const dias = venc && !Number.isNaN(venc.getTime()) ? Math.floor((hoje - venc) / 86400000) : 0;
      return { rotulo: dias > 0 ? `vencida há ${dias} dia${dias > 1 ? "s" : ""}` : "vencida", atrasada: true };
    }
    return { rotulo: "em aberto", atrasada: false };
  };
  return (
    <div className="cp-bloco">
      <header><h2>Faturas</h2><p>O que está em aberto, o que vence quando e a 2ª via do documento fiscal.</p></header>
      <div className="cp-indicadores">
        <Indicador rotulo="Em aberto" valor={BRL_PORTAL.format(dados?.totais?.emAberto || 0)} detalhe="soma dos títulos não quitados" tom={dados?.totais?.emAberto ? "alerta" : "positivo"} />
        <Indicador rotulo="Quitado" valor={BRL_PORTAL.format(dados?.totais?.quitado || 0)} detalhe="histórico liquidado" tom="positivo" />
      </div>
      {!titulos.length && <p className="cp-vazio">Nenhuma fatura por aqui ainda.</p>}
      <ul className="cp-lista">
        {titulos.map((titulo) => {
          const sit = situacaoDoTitulo(titulo);
          return (
          <li key={titulo.id} className={sit.atrasada ? "cp-titulo-vencido" : undefined}>
            <div>
              <strong>{titulo.numero}</strong>
              <small>emitida em {titulo.emitidoEm || "—"} · vence em {titulo.venceEm || "—"} · {sit.rotulo}</small>
            </div>
            <div>
              <strong>{BRL_PORTAL.format(titulo.emAberto)}</strong>
              <small>de {BRL_PORTAL.format(titulo.valor)}</small>
            </div>
            {titulo.documento?.xmlDisponivel && (
              <button type="button" onClick={() => baixarXml(titulo)}><Download size={15} /> XML {titulo.documento.tipo?.toUpperCase()}</button>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

function Evidencias({ evidencias, carregando, aoAvisar }) {
  const [baixando, setBaixando] = useState("");

  // O download passa por um link temporário: o endereço de origem do arquivo
  // nunca chega até aqui. Antes esta lista era só metadado, e a permissão que a
  // habilitava chamava-se `portal:document:download`.
  const baixar = async (evidencia) => {
    setBaixando(evidencia.id);
    try {
      const { url } = await enviar(`evidencias/${encodeURIComponent(evidencia.id)}/link`, {});
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (erro) {
      aoAvisar?.(erro.message);
    } finally {
      setBaixando("");
    }
  };

  if (carregando) return <div className="cp-carregando"><Loader2 className="girando" size={20} /> Carregando documentos...</div>;
  if (!evidencias.length) return <SemDados titulo="Nenhum documento no cofre" texto="Notas fiscais, telemetria, contratos e comprovantes que sustentam os números do seu contrato aparecem aqui." />;
  return (
    <ul className="cp-evidencias">
      {evidencias.map((evidencia) => (
        <li key={evidencia.id}>
          <FileText size={18} />
          <div>
            <strong>{evidencia.titulo}</strong>
            <small>
              {evidencia.tipo} · emitido em {evidencia.emitidoEm || "—"}
              {evidencia.arquivoBytes ? ` · ${tamanhoLegivel(evidencia.arquivoBytes)}` : ""}
              {evidencia.impressaoDigital ? ` · impressão digital ${evidencia.impressaoDigital.slice(0, 12)}` : ""}
            </small>
          </div>
          <button
            type="button"
            className="cp-baixar"
            disabled={baixando === evidencia.id}
            onClick={() => baixar(evidencia)}
            aria-label={`Baixar ${evidencia.titulo}`}
          >
            <Download size={17} />
            {baixando === evidencia.id ? "Gerando link..." : "Baixar"}
          </button>
        </li>
      ))}
    </ul>
  );
}

const ROTULO_STATUS = { aberta: "Aberta", em_analise: "Em análise", aguardando_cliente: "Aguardando você", respondida: "Respondida", concluida: "Concluída", recusada: "Não atendida", cancelada: "Cancelada" };
const ROTULO_TIPO = { nova_rota: "Nova rota", aumento_volume: "Aumento de volume", coleta_extra: "Coleta extra", ocorrencia: "Ocorrência na entrega", documento: "Documento ou comprovante", relatorio_esg: "Relatório ambiental", outro: "Outro assunto" };
const ENCERRADOS = ["concluida", "recusada", "cancelada"];

function Solicitacoes({ podeAbrir, setAviso }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [abertaId, setAbertaId] = useState("");
  const [mensagens, setMensagens] = useState([]);
  const [resposta, setResposta] = useState("");
  const [criando, setCriando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState({ tipo: "nova_rota", assunto: "", descricao: "", urgencia: "normal", campos: {} });

  const carregar = useCallback(async (id = "") => {
    setCarregando(true);
    try {
      const resultado = await pedir(`solicitacoes${id ? `?id=${encodeURIComponent(id)}` : ""}`);
      setDados(resultado);
      if (id) setMensagens(resultado.mensagens || []);
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setCarregando(false);
    }
  }, [setAviso]);

  useEffect(() => { carregar(); }, [carregar]);

  const tipos = dados?.tipos || [];
  const tipoAtual = tipos.find((item) => item.id === form.tipo);

  const abrir = async (id) => {
    if (abertaId === id) { setAbertaId(""); setMensagens([]); return; }
    setAbertaId(id); setMensagens([]); await carregar(id);
  };

  const criar = async (evento) => {
    evento.preventDefault(); setEnviando(true);
    try {
      await enviar("solicitacoes", form);
      setForm({ tipo: "nova_rota", assunto: "", descricao: "", urgencia: "normal", campos: {} });
      setCriando(false); await carregar();
    } catch (erro) { setAviso(erro.message); } finally { setEnviando(false); }
  };

  const responder = async (evento) => {
    evento.preventDefault(); setEnviando(true);
    try { await enviar("solicitacoes", { solicitacaoId: abertaId, mensagem: resposta }); setResposta(""); await carregar(abertaId); }
    catch (erro) { setAviso(erro.message); } finally { setEnviando(false); }
  };

  const mover = async (id, status) => {
    setEnviando(true);
    try { await enviar("solicitacoes", { id, status }, "PATCH"); await carregar(abertaId === id ? id : ""); }
    catch (erro) { setAviso(erro.message); } finally { setEnviando(false); }
  };

  if (carregando && !dados) return <p className="cp-carregando"><Loader2 className="girando" size={20} /> Carregando suas solicitações...</p>;
  const lista = dados?.solicitacoes || [];

  return (
    <div className="cp-solicitacoes">
      <div className="cp-sol-topo"><div><h2>Solicitações</h2><p>{dados?.resumo?.texto}</p></div>{podeAbrir && <button type="button" className="cp-botao" onClick={() => setCriando((valor) => !valor)}>{criando ? "Cancelar" : "Nova solicitação"}</button>}</div>
      {criando && podeAbrir && (
        <form className="cp-sol-form" onSubmit={criar}>
          <label><span>Tipo de pedido</span><select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value, campos: {} })}>{tipos.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.rotulo}</option>)}</select>{tipoAtual && <small>{tipoAtual.descricao} Resposta em até {tipoAtual.prazoHoras}h.</small>}</label>
          <label><span>Assunto</span><input required value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })} /></label>
          {(tipoAtual?.obrigatorios || []).map((chave) => <label key={chave}><span>{tipoAtual.camposRotulo[chave] || chave}</span><input required value={form.campos[chave] || ""} onChange={(e) => setForm({ ...form, campos: { ...form.campos, [chave]: e.target.value } })} /></label>)}
          <label><span>Urgência</span><select value={form.urgencia} onChange={(e) => setForm({ ...form, urgencia: e.target.value })}><option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option></select></label>
          <label className="cp-sol-larga"><span>Descreva o pedido</span><textarea required rows={4} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
          <button type="submit" className="cp-botao" disabled={enviando}>{enviando ? "Enviando..." : "Enviar solicitação"}</button>
        </form>
      )}
      {!lista.length && <SemDados titulo="Nenhuma solicitação ainda" texto={podeAbrir ? "Abra uma solicitação para nova rota, comprovante, relatório ambiental ou ocorrência." : "Seu acesso é de leitura."} />}
      <ul className="cp-sol-lista">
        {lista.map((solicitacao) => (
          <li key={solicitacao.id} className={abertaId === solicitacao.id ? "aberta" : ""}>
            <button type="button" className="cp-sol-head" onClick={() => abrir(solicitacao.id)}><span className="cp-sol-nome"><strong>{solicitacao.assunto}</strong><small>{comRotulo(ROTULO_TIPO, solicitacao.tipo)} · aberta em {new Date(solicitacao.criadaEm).toLocaleDateString("pt-BR")}</small></span><span className={`cp-sol-status s-${solicitacao.status}`}>{comRotulo(ROTULO_STATUS, solicitacao.status)}</span></button>
            {abertaId === solicitacao.id && (
              <div className="cp-sol-corpo">
                {Object.keys(solicitacao.campos || {}).length > 0 && <dl className="cp-sol-campos">{Object.entries(solicitacao.campos).map(([chave, valor]) => <div key={chave}><dt>{chave}</dt><dd>{valor}</dd></div>)}</dl>}
                <ol className="cp-sol-conversa">{mensagens.map((mensagem) => <li key={mensagem.id} className={mensagem.lado === "cliente" ? "meu" : "deles"}><strong>{mensagem.lado === "cliente" ? mensagem.autor : "To Do Green"}</strong><p>{mensagem.texto}</p><small>{new Date(mensagem.criadaEm).toLocaleString("pt-BR")}</small></li>)}</ol>
                {!ENCERRADOS.includes(solicitacao.status) && podeAbrir && <><form className="cp-sol-resposta" onSubmit={responder}><textarea required rows={2} placeholder="Escreva uma mensagem para a equipe" value={resposta} onChange={(e) => setResposta(e.target.value)} /><button type="submit" className="cp-botao" disabled={enviando}>Enviar</button></form><div className="cp-sol-acoes">{solicitacao.status === "respondida" && <button type="button" className="cp-botao" disabled={enviando} onClick={() => mover(solicitacao.id, "concluida")}>Resolvido, pode encerrar</button>}<button type="button" className="cp-botao cp-botao-secundario" disabled={enviando} onClick={() => mover(solicitacao.id, "cancelada")}>Cancelar solicitação</button></div></>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CustomerPortal() {
  const [sessao, setSessao] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [financeiro, setFinanceiro] = useState(null);
  const [evidencias, setEvidencias] = useState([]);
  const [carregandoEvidencias, setCarregandoEvidencias] = useState(false);
  const [aba, setAba] = useState("inicio");
  const [erroFatal, setErroFatal] = useState("");
  const [aviso, setAviso] = useState("");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let ativo = true;
    const carregar = () => Promise.all([pedir("sessao"), pedir("resumo")]);
    const aplicar = ([dadosSessao, dadosResumo]) => {
      if (ativo) { setSessao(dadosSessao); setResumo(dadosResumo.resumo); }
    };
    carregar()
      .then(aplicar)
      .catch(async (erro) => {
        // Uma empresa antiga guardada no navegador (compartilhou o computador,
        // ou o time interno tirou o vínculo com AQUELA empresa) fazia o servidor
        // negar e o portal inteiro travava numa tela fatal — mesmo quando a
        // pessoa ainda tem OUTRAS empresas. Limpa a escolha presa e tenta de
        // novo com a empresa padrão da sessão antes de desistir.
        if (ativo && empresaEscolhida()) {
          escolherEmpresa("");
          try {
            aplicar(await carregar());
            return;
          } catch (erroPadrao) {
            if (ativo) setErroFatal(erroPadrao.message);
            return;
          }
        }
        if (ativo) setErroFatal(erro.message);
      })
      .finally(() => { if (ativo) setPronto(true); });
    return () => { ativo = false; };
  }, []);

  // Financeiro é secundário e depende de permissão (portal:document:download):
  // busca à parte, sem travar o portal. Sem acesso, o bloco Financeiro da home
  // simplesmente não aparece.
  useEffect(() => {
    let ativo = true;
    pedir("financeiro").then((dados) => { if (ativo) setFinanceiro(dados); }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  const carregarEvidencias = useCallback(() => {
    setCarregandoEvidencias(true);
    pedir("evidencias").then((dados) => setEvidencias(dados.evidencias || [])).catch((erro) => setAviso(erro.message)).finally(() => setCarregandoEvidencias(false));
  }, []);

  useEffect(() => {
    // A aba de operações carrega sozinha: ela tem filtros e paginação próprios,
    // e buscar aqui obrigaria esta tela a conhecer o estado deles.
    if (aba === "documentos" && !evidencias.length) carregarEvidencias();
  }, [aba, evidencias.length, carregarEvidencias]);

  const menu = useMemo(() => sessao?.menu || [], [sessao]);

  if (!pronto) return <main className="cp cp-centro"><Loader2 className="girando" size={28} /><p>Abrindo seu portal...</p></main>;
  if (erroFatal) return <main className="cp cp-centro"><div className="cp-bloqueio"><AlertTriangle size={26} /><h1>Portal indisponível</h1><p>{erroFatal}</p><p className="cp-bloqueio-dica">Se você é cliente da To Do Green e deveria ter acesso, peça ao seu contato para liberar o seu e-mail no portal.</p></div></main>;

  return (
    <main className="cp" aria-labelledby="cp-titulo">
      <header className="cp-topo">
        <div>
          <span className="cp-marca">To Do Green</span>
          <h1 id="cp-titulo">{sessao.cliente.nome}</h1>
          <p>Portal do cliente · {sessao.usuario.nome}</p>
        </div>
        {/* O seletor só aparece para quem tem mais de uma empresa. Grupo
            empresarial, consultoria, auditor e gestor de subsidiárias têm um
            e-mail e várias empresas; até aqui a restrição do banco os deixava
            de fora. */}
        {(sessao.empresas || []).length > 1 && (
          <label className="cp-empresa">
            <span>Empresa</span>
            <select
              value={sessao.cliente.id}
              onChange={(evento) => {
                escolherEmpresa(evento.target.value);
                // Recarrega em vez de remendar o estado: todo dado da tela é do
                // cliente anterior, e manter qualquer pedaço seria misturar as
                // duas empresas na mesma página.
                window.location.reload();
              }}
            >
              {sessao.empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <nav className="cp-menu" aria-label="Navegação do portal">{menu.map((item) => { const Icone = ICONES[item.id] || Home; return <button key={item.id} type="button" className={aba === item.id ? "ativo" : ""} onClick={() => setAba(item.id)} aria-current={aba === item.id ? "page" : undefined}><Icone size={17} /><span>{item.label}</span></button>; })}</nav>
      {aviso && <div className="cp-alerta cp-alerta-acao" role="alert"><AlertTriangle size={18} /><span>{aviso}</span><button type="button" onClick={() => setAviso("")} aria-label="Fechar aviso">×</button></div>}
      <section className="cp-conteudo">
        {aba === "inicio" && <Inicio resumo={resumo} financeiro={financeiro} onIr={setAba} />}
        {aba === "operacoes" && <Operacoes pedir={pedir} enviar={enviar} setAviso={setAviso} />}
        {aba === "green-score" && <GreenScoreDetalhado resumo={resumo} />}
        {aba === "esg" && <ImpactoAmbiental resumo={resumo} />}
        {aba === "relatorios" && <Relatorios setAviso={setAviso} />}
        {aba === "financeiro" && <Faturas setAviso={setAviso} />}
        {aba === "documentos" && <Evidencias evidencias={evidencias} carregando={carregandoEvidencias} aoAvisar={setAviso} />}
        {aba === "solicitacoes" && <Solicitacoes podeAbrir={(sessao?.permissoes || []).includes("portal:request:create")} setAviso={setAviso} />}
        {aba === "assistente" && <AssistenteCliente enviar={enviar} setAviso={setAviso} />}
      </section>
      <footer className="cp-rodape">Green Score e indicadores ambientais são estimativas próprias da To Do Green, com metodologia e memória de cálculo nos relatórios. Não constituem certificação.</footer>
    </main>
  );
}
