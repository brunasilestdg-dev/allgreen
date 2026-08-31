import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, FolderCheck, Package, Plus, Save, Send } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import {
  CATALOGO_DE_HABILITACAO,
  CATEGORIAS_DE_HABILITACAO,
  ESTADOS_DO_DOCUMENTO,
  ETAPAS_DO_RFQ,
  KITS_PADRAO,
  doCatalogo,
  documentosQueFaltam,
  gravidadeDoEstado,
  nomeDoArquivo,
  problemasDoNome,
  prontidaoDoKit,
  resumoDoAcervo,
  situacaoDoDocumento,
  situacaoDoRfq,
} from "../habilitacaoDomain.js";
import "./TodoGreenPages.css";

// ===== Central de RFQ e RFI =====
//
// A titular mantinha isso numa página HTML no computador dela e num índice
// mestre em planilha, onde a coluna de status era fórmula. Aqui é tela do ERP,
// e o status continua sendo FÓRMULA — nunca campo. Cada linha recalcula o
// semáforo contra a data de hoje, então nenhum documento vence calado.
//
// Quatro abas, na ordem do trabalho real dela:
//   Acervo   — o que existe, com o semáforo à vista.
//   Kits     — o anexo pronto, conferido ANTES de sair. "Este é o passo que
//              ninguém pula."
//   Pedidos  — o ciclo do RFQ, do e-mail ao resultado com motivo.
//   O que falta — os documentos que nunca entraram, essencial primeiro.

const ROTULO_DO_ESTADO = Object.fromEntries(ESTADOS_DO_DOCUMENTO.map((item) => [item.id, item.rotulo]));
const AJUDA_DO_ESTADO = Object.fromEntries(ESTADOS_DO_DOCUMENTO.map((item) => [item.id, item.ajuda]));

const DOC_VAZIO = {
  tipo: "", categoria: "societario", titulo: "", numero: "", orgao: "",
  unidade: "MATRIZ-SP", cnpj: "", emitidoEm: "", venceEm: "", permanente: false,
  arquivoUrl: "", observacao: "",
};

const RFQ_VAZIO = {
  titulo: "", clientId: "", cliente: "", etapa: "recebido", canal: "", solicitante: "",
  pedido: "", kit: "", prazo: "", motivo: "",
};

const hojeIso = () => new Date().toISOString().slice(0, 10);

function Semaforo({ estado }) {
  return (
    <span className={`tdg-rfq-estado tdg-rfq-estado--${estado}`} title={AJUDA_DO_ESTADO[estado]}>
      {ROTULO_DO_ESTADO[estado]}
    </span>
  );
}

export default function CentralRfqPage({
  habilitacao = [],
  habilitacaoKits = [],
  rfq = [],
  clientes = [],
  onCriarDocumento,
  onAtualizarDocumento,
  onArquivarDocumento,
  onCriarKit,
  onCriarRfq,
  onAtualizarRfq,
  podeEditar = false,
  setToast,
}) {
  const [aba, setAba] = useState("acervo");
  const [docAberto, setDocAberto] = useState(null);
  const [formDoc, setFormDoc] = useState(DOC_VAZIO);
  const [rfqAberto, setRfqAberto] = useState(null);
  const [formRfq, setFormRfq] = useState(RFQ_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("todos");

  const hoje = hojeIso();
  const resumo = useMemo(() => resumoDoAcervo(habilitacao, hoje), [habilitacao, hoje]);
  const comSituacao = useMemo(
    () => habilitacao
      .map((documento) => ({ ...documento, situacao: situacaoDoDocumento(documento, hoje) }))
      // O mais grave primeiro: é a ordem em que se resolve, e é a rotina de
      // segunda-feira dela ("filtre por VENCIDO e CRÍTICO").
      .sort((a, b) => gravidadeDoEstado(b.situacao.estado) - gravidadeDoEstado(a.situacao.estado)),
    [habilitacao, hoje],
  );
  const visiveis = useMemo(
    () => (filtro === "todos"
      ? comSituacao
      : filtro === "problemas"
        ? comSituacao.filter((item) => gravidadeDoEstado(item.situacao.estado) > 0)
        : comSituacao.filter((item) => item.categoria === filtro)),
    [comSituacao, filtro],
  );

  // Os kits cadastrados no espaço, e os padrão para os que ela ainda não criou.
  const kits = useMemo(() => {
    const cadastrados = habilitacaoKits.map((kit) => ({ ...kit, doEspaco: true }));
    const chaves = new Set(cadastrados.map((kit) => kit.chave));
    const faltantes = KITS_PADRAO.filter((kit) => !chaves.has(kit.chave));
    return [...cadastrados, ...faltantes].map((kit) => ({
      ...kit,
      pronto: prontidaoDoKit(kit, habilitacao, hoje),
    }));
  }, [habilitacaoKits, habilitacao, hoje]);

  const faltando = useMemo(() => documentosQueFaltam(habilitacao), [habilitacao]);
  const pedidos = useMemo(
    () => rfq
      .map((item) => ({ ...item, situacao: situacaoDoRfq(item, hoje) }))
      .sort((a, b) => Number(b.situacao.atrasado) - Number(a.situacao.atrasado)),
    [rfq, hoje],
  );

  const campoDoc = (chave) => (evento) =>
    setFormDoc((atual) => {
      const valor = evento.target.type === "checkbox" ? evento.target.checked : evento.target.value;
      const proximo = { ...atual, [chave]: valor };
      // Escolher o tipo preenche categoria, título e órgão do catálogo: o que a
      // casa já sabe não se digita de novo.
      if (chave === "tipo") {
        const definicao = doCatalogo(valor);
        if (definicao) {
          proximo.categoria = definicao.categoria;
          proximo.titulo = definicao.titulo;
          proximo.orgao = definicao.orgao;
          proximo.permanente = Boolean(definicao.permanente);
        }
      }
      return proximo;
    });

  const campoRfq = (chave) => (evento) =>
    setFormRfq((atual) => ({ ...atual, [chave]: evento.target.value }));

  const nomeSugerido = useMemo(() => (formDoc.tipo ? nomeDoArquivo(formDoc) : ""), [formDoc]);

  const salvarDocumento = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      if (docAberto === "novo") {
        await onCriarDocumento?.({ ...formDoc, arquivoNome: nomeSugerido });
        setToast?.(`Documento no acervo como ${nomeSugerido}.`);
      } else {
        const atual = habilitacao.find((item) => item.id === docAberto);
        await onAtualizarDocumento?.(docAberto, { ...formDoc, arquivoNome: nomeSugerido, revision: atual?.revision });
        setToast?.("Documento atualizado.");
      }
      setDocAberto(null);
      setFormDoc(DOC_VAZIO);
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível gravar o documento.");
    } finally {
      setSalvando(false);
    }
  };

  const salvarRfq = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      if (rfqAberto === "novo") {
        await onCriarRfq?.({ ...formRfq });
        setToast?.("Pedido registrado.");
      } else {
        const atual = rfq.find((item) => item.id === rfqAberto);
        await onAtualizarRfq?.(rfqAberto, { ...formRfq, revision: atual?.revision });
        setToast?.("Pedido atualizado.");
      }
      setRfqAberto(null);
      setFormRfq(RFQ_VAZIO);
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível gravar o pedido.");
    } finally {
      setSalvando(false);
    }
  };

  const criarKitPadrao = async (kit) => {
    try {
      // O id vem do servidor: `crypto.randomUUID()` lá é único de verdade,
      // enquanto um `Date.now()` aqui repete em dois cliques na mesma
      // milissegundo — e é chamada impura dentro do componente.
      await onCriarKit?.({ chave: kit.chave, nome: kit.nome, descricao: kit.descricao, tipos: kit.tipos });
      setToast?.(`${kit.nome} salvo no espaço — agora dá para editar a lista.`);
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível salvar o kit.");
    }
  };

  // Marcar o envio guarda a lista EXATA do que saiu e a data. É o que responde
  // "mandaram o quê mesmo?" três meses depois.
  const registrarEnvio = async (pedido, pronto) => {
    try {
      await onAtualizarRfq?.(pedido.id, {
        ...pedido,
        etapa: "enviado",
        enviadoEm: new Date().toISOString(),
        enviados: pronto.itens
          .filter((item) => ["valido", "permanente"].includes(item.situacao.estado))
          .map((item) => `${item.titulo}${item.documento?.arquivoNome ? ` (${item.documento.arquivoNome})` : ""}`),
        revision: pedido.revision,
      });
      setToast?.("Envio registrado com a lista exata do que saiu.");
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível registrar o envio.");
    }
  };

  const abrirNovoDocumento = (tipo = "") => {
    const definicao = tipo ? doCatalogo(tipo) : null;
    setFormDoc({
      ...DOC_VAZIO,
      tipo,
      categoria: definicao?.categoria || DOC_VAZIO.categoria,
      titulo: definicao?.titulo || "",
      orgao: definicao?.orgao || "",
      permanente: Boolean(definicao?.permanente),
    });
    setDocAberto("novo");
  };

  return (
    <section className="tdg-page tdg-central-rfq">
      <header className="tdg-page-head">
        <div>
          <h2><ClipboardList size={20} /> Central de RFQ e RFI</h2>
          <p>
            Achar, conferir e enviar documento de licitação e homologação. O status de cada
            documento é calculado com a data de hoje — nada aqui vence calado.
          </p>
        </div>
        {podeEditar && (
          <div className="tdg-page-actions">
            <button type="button" className="tdg-action" onClick={() => abrirNovoDocumento()}>
              <Plus size={16} /> Novo documento
            </button>
          </div>
        )}
      </header>

      <div className="tdg-rfq-resumo">
        <article className={resumo.travando ? "alerta" : ""}>
          <small>Travando RFQ agora</small>
          <strong>{resumo.travando}</strong>
          <span>essencial vencido ou ausente</span>
        </article>
        <article><small>Vencidos</small><strong>{resumo.vencido}</strong></article>
        <article><small>Críticos (≤30 dias)</small><strong>{resumo.critico}</strong></article>
        <article><small>A reemitir</small><strong>{resumo.reemitir}</strong></article>
        <article><small>Em dia</small><strong>{resumo.valido + resumo.permanente}</strong></article>
        <article><small>Nunca entraram</small><strong>{resumo.faltando}</strong></article>
      </div>

      <nav className="tdg-rfq-abas" aria-label="Seções da Central de RFQ">
        {[
          ["acervo", `Acervo · ${habilitacao.length}`],
          ["kits", `Kits · ${kits.length}`],
          ["pedidos", `Pedidos · ${pedidos.length}`],
          ["falta", `O que falta · ${faltando.length}`],
        ].map(([id, rotulo]) => (
          <button type="button" key={id} className={aba === id ? "ativo" : ""} onClick={() => setAba(id)}>
            {rotulo}
          </button>
        ))}
      </nav>

      {aba === "acervo" && (
        <>
          <div className="tdg-rfq-filtros" role="group" aria-label="Filtrar o acervo">
            <button type="button" className={filtro === "todos" ? "ativo" : ""} onClick={() => setFiltro("todos")}>Todos</button>
            <button type="button" className={filtro === "problemas" ? "ativo" : ""} onClick={() => setFiltro("problemas")}>
              Só o que precisa de ação
            </button>
            {CATEGORIAS_DE_HABILITACAO.map((categoria) => (
              <button
                type="button"
                key={categoria.id}
                className={filtro === categoria.id ? "ativo" : ""}
                onClick={() => setFiltro(categoria.id)}
              >
                {categoria.rotulo}
              </button>
            ))}
          </div>

          {!habilitacao.length && (
            <p className="tdg-page-empty">
              O acervo está vazio. Comece pela aba <strong>O que falta</strong> — ela lista o que um
              comprador pede, com o essencial primeiro.
            </p>
          )}

          <div className="tdg-rfq-tabela-wrap">
            <table className="tdg-rfq-tabela">
              <thead>
                <tr>
                  <th>Documento</th><th>Nº / identificação</th><th>Órgão</th>
                  <th>Unidade</th><th>Validade</th><th>Situação</th>
                  {podeEditar && <th aria-label="Ações" />}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((documento) => (
                  <tr key={documento.id}>
                    <td>
                      <strong>{documento.titulo}</strong>
                      {documento.arquivoNome && <small>{documento.arquivoNome}</small>}
                    </td>
                    <td>{documento.numero || "—"}</td>
                    <td>{documento.orgao || "—"}</td>
                    <td>{documento.unidade}</td>
                    <td>
                      {documento.permanente
                        ? "permanente"
                        : documento.venceEm
                          ? documento.venceEm
                          : documento.emitidoEm ? `emitido ${documento.emitidoEm}` : "—"}
                    </td>
                    <td>
                      <Semaforo estado={documento.situacao.estado} />
                      <small>{documento.situacao.motivo}</small>
                    </td>
                    {podeEditar && (
                      <td className="tdg-rfq-acoes">
                        <button
                          type="button"
                          onClick={() => { setFormDoc({ ...DOC_VAZIO, ...documento }); setDocAberto(documento.id); }}
                        >
                          Editar
                        </button>
                        <button type="button" onClick={() => onArquivarDocumento?.(documento.id)}>Remover</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === "kits" && (
        <div className="tdg-rfq-kits">
          <p className="tdg-rfq-nota">
            Ninguém deveria montar anexo arquivo por arquivo toda vez. O kit é conferido contra o
            acervo de hoje, e um item essencial vencido ou faltando <strong>trava o envio</strong> —
            mandar assim é pior do que não mandar.
          </p>
          {kits.map((kit) => (
            <article className={`tdg-rfq-kit${kit.pronto.liberado ? " liberado" : " travado"}`} key={kit.chave || kit.id}>
              <header>
                <div>
                  <strong>{kit.nome}</strong>
                  <small>{kit.descricao}</small>
                </div>
                <span className="tdg-rfq-kit-contagem">
                  {kit.pronto.prontos} de {kit.pronto.total} prontos
                </span>
              </header>
              {kit.pronto.bloqueios.length > 0 && (
                <p className="tdg-rfq-kit-bloqueio">
                  <AlertTriangle size={14} /> Travado por {kit.pronto.bloqueios.length} item(ns) essencial(is):{" "}
                  {kit.pronto.bloqueios.map((item) => item.titulo).join(", ")}
                </p>
              )}
              <details>
                <summary>Ver os {kit.pronto.total} documentos do kit</summary>
                <ul>
                  {kit.pronto.itens.map((item) => (
                    <li key={item.tipo}>
                      <span>{item.titulo}{item.essencial ? " *" : ""}</span>
                      <Semaforo estado={item.situacao.estado} />
                      <small>{item.situacao.motivo}</small>
                    </li>
                  ))}
                </ul>
                <p><small>* essencial — sem ele o kit não sai.</small></p>
              </details>
              {podeEditar && !kit.doEspaco && (
                <button type="button" onClick={() => criarKitPadrao(kit)}>
                  <FolderCheck size={15} /> Salvar este kit no espaço para poder editar
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {aba === "pedidos" && (
        <div className="tdg-rfq-pedidos">
          {podeEditar && (
            <button type="button" className="tdg-action" onClick={() => { setFormRfq(RFQ_VAZIO); setRfqAberto("novo"); }}>
              <Plus size={16} /> Registrar pedido que chegou
            </button>
          )}
          {!pedidos.length && (
            <p className="tdg-page-empty">
              Nenhum pedido registrado. Registre na hora que chegar: cliente, prazo e a lista exata
              do que foi pedido, copiada do e-mail sem resumir.
            </p>
          )}
          {pedidos.map((pedido) => {
            const kit = kits.find((item) => item.chave === pedido.kit);
            return (
              <article className={`tdg-rfq-pedido${pedido.situacao.atrasado ? " atrasado" : ""}`} key={pedido.id}>
                <header>
                  <div>
                    <strong>{pedido.titulo}</strong>
                    <small>{pedido.cliente || "sem conta"} · {ETAPAS_DO_RFQ.find((item) => item.id === pedido.situacao.etapa)?.rotulo}</small>
                  </div>
                  <span>
                    {pedido.prazo
                      ? pedido.situacao.atrasado
                        ? `prazo estourado há ${Math.abs(pedido.situacao.dias)} dia(s)`
                        : `${pedido.situacao.dias} dia(s) de prazo`
                      : "sem prazo"}
                  </span>
                </header>
                {pedido.pedido && (
                  <details>
                    <summary>O que o cliente pediu, como pediu</summary>
                    <pre>{pedido.pedido}</pre>
                  </details>
                )}
                {pedido.enviados.length > 0 && (
                  <details>
                    <summary>{pedido.enviados.length} documento(s) enviados{pedido.enviadoEm ? ` em ${pedido.enviadoEm.slice(0, 10)}` : ""}</summary>
                    <ul>{pedido.enviados.map((item) => <li key={item}>{item}</li>)}</ul>
                  </details>
                )}
                {pedido.situacao.faltaMotivo && (
                  <p className="tdg-rfq-kit-bloqueio">
                    <AlertTriangle size={14} /> Fechado sem motivo registrado — é o motivo que vira
                    inteligência comercial.
                  </p>
                )}
                {podeEditar && (
                  <footer>
                    <button type="button" onClick={() => { setFormRfq({ ...RFQ_VAZIO, ...pedido }); setRfqAberto(pedido.id); }}>
                      Atualizar
                    </button>
                    {kit && !pedido.enviados.length && (
                      <button
                        type="button"
                        disabled={!kit.pronto.liberado}
                        title={kit.pronto.liberado ? "" : "O kit está travado por item essencial pendente."}
                        onClick={() => registrarEnvio(pedido, kit.pronto)}
                      >
                        <Send size={15} /> Marcar como enviado com o {kit.nome}
                      </button>
                    )}
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}

      {aba === "falta" && (
        <div className="tdg-rfq-falta">
          <p className="tdg-rfq-nota">
            Sem estes, um RFI de conta grande não fecha. A maior parte sai online, de graça, em
            minutos. O essencial vem primeiro.
          </p>
          <ul>
            {faltando.map((item) => (
              <li key={item.tipo}>
                <span>
                  <strong>{item.titulo}</strong>
                  <small>{item.orgao} · {CATEGORIAS_DE_HABILITACAO.find((c) => c.id === item.categoria)?.rotulo}</small>
                </span>
                {item.essencial && <em className="tdg-rfq-essencial">essencial</em>}
                {podeEditar && (
                  <button type="button" onClick={() => abrirNovoDocumento(item.tipo)}>
                    <Package size={14} /> Cadastrar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!faltando.length && <p className="tdg-page-empty">O acervo cobre todo o catálogo. Nada faltando.</p>}
        </div>
      )}

      {docAberto && (
        <Modal title={docAberto === "novo" ? "Novo documento no acervo" : "Editar documento"} onClose={() => setDocAberto(null)} wide>
          <form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={salvarDocumento}>
            <div className="tdg-form-row">
              <label>
                <span>Tipo</span>
                <select required value={formDoc.tipo} onChange={campoDoc("tipo")}>
                  <option value="">Selecione o documento</option>
                  {CATALOGO_DE_HABILITACAO.map((item) => (
                    <option value={item.tipo} key={item.tipo}>{item.titulo}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Título</span>
                <input required value={formDoc.titulo} onChange={campoDoc("titulo")} />
              </label>
            </div>
            <div className="tdg-form-row">
              <label><span>Nº / identificação</span><input value={formDoc.numero} onChange={campoDoc("numero")} /></label>
              <label><span>Órgão emissor</span><input value={formDoc.orgao} onChange={campoDoc("orgao")} /></label>
            </div>
            <div className="tdg-form-row">
              <label>
                <span>Unidade</span>
                {/* A dica vai por `aria-describedby`, não dentro do label: texto
                    de ajuda aninhado no label entra no NOME acessível do campo,
                    e o leitor de tela anuncia a explicação como se fosse o
                    nome dele. */}
                <input
                  value={formDoc.unidade}
                  onChange={campoDoc("unidade")}
                  placeholder="MATRIZ-SP, F02-SOROCABA-SP, EMPRESA"
                  aria-describedby="tdg-rfq-ajuda-unidade"
                />
              </label>
              <label><span>CNPJ da unidade</span><input value={formDoc.cnpj} onChange={campoDoc("cnpj")} /></label>
            </div>
            <p className="tdg-rfq-ajuda" id="tdg-rfq-ajuda-unidade">
              EMPRESA quando o documento vale para todos os CNPJs de uma vez — apólice guarda-chuva,
              RNTRC, balanço, certidão federal.
            </p>
            <div className="tdg-form-row">
              <label><span>Emitido em</span><input type="date" value={formDoc.emitidoEm} onChange={campoDoc("emitidoEm")} /></label>
              <label>
                <span>Vence em</span>
                <input type="date" value={formDoc.venceEm} onChange={campoDoc("venceEm")} disabled={formDoc.permanente} />
              </label>
              <label className="tdg-form-check">
                <input type="checkbox" checked={Boolean(formDoc.permanente)} onChange={campoDoc("permanente")} />
                <span>Não vence</span>
              </label>
            </div>
            <label><span>Link do arquivo</span><input value={formDoc.arquivoUrl} onChange={campoDoc("arquivoUrl")} /></label>
            <label><span>Observação</span><textarea rows={3} value={formDoc.observacao} onChange={campoDoc("observacao")} /></label>
            {nomeSugerido && (
              <p className="tdg-rfq-nome-sugerido">
                Nome padronizado: <code>{nomeSugerido}</code>
                {problemasDoNome(nomeSugerido).length > 0 && (
                  <em> — {problemasDoNome(nomeSugerido).join(" ")}</em>
                )}
              </p>
            )}
            <div className="tdg-form-actions">
              <button type="button" onClick={() => setDocAberto(null)} disabled={salvando}>Cancelar</button>
              <button type="submit" className="tdg-action" disabled={salvando}>
                <Save size={16} /> {salvando ? "Gravando..." : "Gravar documento"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {rfqAberto && (
        <Modal title={rfqAberto === "novo" ? "Pedido que chegou" : "Atualizar pedido"} onClose={() => setRfqAberto(null)} wide>
          <form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={salvarRfq}>
            <div className="tdg-form-row">
              <label><span>Do que é</span><input required value={formRfq.titulo} onChange={campoRfq("titulo")} placeholder="RFQ last mile Grande SP" /></label>
              <label>
                <span>Conta</span>
                <select
                  value={formRfq.clientId}
                  onChange={(evento) => {
                    const conta = clientes.find((item) => item.id === evento.target.value);
                    setFormRfq((atual) => ({ ...atual, clientId: evento.target.value, cliente: conta?.name || "" }));
                  }}
                >
                  <option value="">Selecione a conta</option>
                  {clientes.map((conta) => <option value={conta.id} key={conta.id}>{conta.name}</option>)}
                </select>
              </label>
            </div>
            <div className="tdg-form-row">
              <label>
                <span>Etapa</span>
                <select value={formRfq.etapa} onChange={campoRfq("etapa")}>
                  {ETAPAS_DO_RFQ.map((item) => <option value={item.id} key={item.id}>{item.rotulo}</option>)}
                </select>
              </label>
              <label><span>Prazo</span><input type="date" value={formRfq.prazo} onChange={campoRfq("prazo")} /></label>
              <label>
                <span>Kit</span>
                <select value={formRfq.kit} onChange={campoRfq("kit")}>
                  <option value="">Sem kit definido</option>
                  {kits.map((kit) => <option value={kit.chave} key={kit.chave}>{kit.nome}</option>)}
                </select>
              </label>
            </div>
            <div className="tdg-form-row">
              <label><span>Quem pediu</span><input value={formRfq.solicitante} onChange={campoRfq("solicitante")} /></label>
              <label><span>Canal</span><input value={formRfq.canal} onChange={campoRfq("canal")} placeholder="E-mail, portal, telefone" /></label>
            </div>
            <label>
              <span>O que foi pedido</span>
              <textarea
                rows={6}
                value={formRfq.pedido}
                onChange={campoRfq("pedido")}
                placeholder="Cole o texto do e-mail sem resumir — é o que responde 'mandaram o quê mesmo?' em três meses."
              />
            </label>
            {["ganho", "perdido", "sem-resposta"].includes(formRfq.etapa) && (
              <label>
                <span>Motivo do resultado</span>
                <textarea required rows={3} value={formRfq.motivo} onChange={campoRfq("motivo")} />
                <small>Em um ano isso vira o melhor material de inteligência comercial que a casa vai ter.</small>
              </label>
            )}
            <div className="tdg-form-actions">
              <button type="button" onClick={() => setRfqAberto(null)} disabled={salvando}>Cancelar</button>
              <button type="submit" className="tdg-action" disabled={salvando}>
                <Save size={16} /> {salvando ? "Gravando..." : "Gravar pedido"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
