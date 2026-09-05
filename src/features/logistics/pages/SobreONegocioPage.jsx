import { useMemo, useState } from "react";
import { BookOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import AvaliacaoTodoPanel from "../AvaliacaoTodoPanel.jsx";
import {
  CATEGORIAS_DO_NEGOCIO,
  SIGILOS,
  blocoDeContexto,
  fatosQueFaltam,
  normalizarFato,
} from "../businessContextDomain.js";
import "./TodoGreenPages.css";

// ===== Sobre o negócio: o que a IA sabe da To Do Green =====
//
// Pedido da titular (31/08): "faz a IA entender sobre o negócio, e que ela
// aprenda também". O que o Plantû sabia da empresa estava escrito à mão no
// prompt do servidor — certo, e impossível de corrigir sem publicar o produto.
//
// Esta tela é o dossiê: cada fato com fonte, data de posição e sigilo, todos
// editáveis aqui. O que estiver escrito nesta tela é o que o assistente vai
// afirmar na próxima pergunta — inclusive dentro de uma proposta ou de uma
// resposta de RFQ. Por isso a fonte é campo de primeira classe e não um
// detalhe: número sem procedência é o começo de número inventado.
//
// "Restaurar o dossiê" só ACRESCENTA o que falta. Ele nunca sobrescreve o que
// a empresa escreveu — a semente é ponto de partida, não correção diária.

const RESUMO_DO_SIGILO = Object.fromEntries(SIGILOS.map((item) => [item.id, item.rotulo]));

const FORM_VAZIO = {
  titulo: "",
  categoria: "identidade",
  conteudo: "",
  fonte: "",
  vigenteEm: "",
  sigilo: "interno",
  fixado: false,
};

export default function SobreONegocioPage({
  businessContext = [],
  onCreate,
  onUpdate,
  onArchive,
  podeEditar = false,
  setToast,
}) {
  const [aberta, setAberta] = useState(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [categoria, setCategoria] = useState("todas");

  const fatos = useMemo(() => businessContext.map(normalizarFato), [businessContext]);
  const faltando = useMemo(() => fatosQueFaltam(fatos), [fatos]);
  const visiveis = useMemo(
    () => (categoria === "todas" ? fatos : fatos.filter((fato) => fato.categoria === categoria)),
    [fatos, categoria],
  );
  // O mesmo cálculo que o servidor faz antes de mandar para o modelo: a pessoa
  // vê o tamanho real do que o assistente lê, não uma estimativa da tela.
  const tamanhoNoPrompt = useMemo(() => blocoDeContexto(fatos).length, [fatos]);

  const campo = (chave) => (evento) =>
    setForm((atual) => ({
      ...atual,
      [chave]: evento.target.type === "checkbox" ? evento.target.checked : evento.target.value,
    }));

  const abrirNovo = () => { setForm(FORM_VAZIO); setAberta("novo"); };
  const abrirEdicao = (fato) => { setForm({ ...FORM_VAZIO, ...fato }); setAberta(fato.id); };

  const salvar = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      if (aberta === "novo") {
        await onCreate?.({ ...form, id: `ctx-${Date.now()}`, origem: "cadastrado" });
        setToast?.("A IA já sabe disso.");
      } else {
        const atual = fatos.find((item) => item.id === aberta);
        await onUpdate?.(aberta, { ...form, revision: atual?.revision });
        setToast?.("Corrigido. O assistente usa a nova versão na próxima pergunta.");
      }
      setAberta(null);
      setForm(FORM_VAZIO);
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível gravar.");
    } finally {
      setSalvando(false);
    }
  };

  const restaurar = async () => {
    if (!faltando.length) return;
    setSalvando(true);
    let entraram = 0;
    try {
      for (const fato of faltando) {
        await onCreate?.({ ...fato, id: `ctx-${fato.chave}-${Date.now()}` });
        entraram += 1;
      }
      setToast?.(`${entraram} ponto(s) do dossiê foram acrescentados.`);
    } catch (razao) {
      setToast?.(razao?.message || `Parou depois de ${entraram} ponto(s).`);
    } finally {
      setSalvando(false);
    }
  };

  const arquivar = async (fato) => {
    try {
      await onArchive?.(fato.id);
      setToast?.(`"${fato.titulo}" saiu do que a IA sabe.`);
    } catch (razao) {
      setToast?.(razao?.message || "Não foi possível remover.");
    }
  };

  return (
    <section className="tdg-page tdg-sobre-negocio">
      <header className="tdg-page-head">
        <div>
          <h2><BookOpen size={20} /> Sobre o negócio</h2>
          <p>
            Isto é o que o Todô sabe da To Do Green antes de responder qualquer pergunta. O que
            estiver escrito aqui ele afirma; o que não estiver, ele não inventa.
          </p>
        </div>
        {podeEditar && (
          <div className="tdg-page-actions">
            {faltando.length > 0 && (
              <button type="button" onClick={restaurar} disabled={salvando}>
                <RefreshCw size={16} /> Acrescentar {faltando.length} ponto(s) do dossiê
              </button>
            )}
            <button type="button" className="tdg-action" onClick={abrirNovo}>
              <Plus size={16} /> Ensinar algo novo
            </button>
          </div>
        )}
      </header>

      <div className="tdg-sobre-resumo">
        <article><small>Pontos cadastrados</small><strong>{fatos.length}</strong></article>
        <article>
          <small>Aprendidos na conversa</small>
          <strong>{fatos.filter((fato) => fato.origem === "aprendido").length}</strong>
        </article>
        <article>
          <small>Fixados (nunca cortados)</small>
          <strong>{fatos.filter((fato) => fato.fixado).length}</strong>
        </article>
        <article>
          <small>Tamanho lido pela IA</small>
          <strong>{tamanhoNoPrompt.toLocaleString("pt-BR")}</strong>
          <span>caracteres por pergunta</span>
        </article>
      </div>

      {/* #128: painel de qualidade do Todô (👍/👎, corrigidas, correções
          recentes). Ele mesmo se esconde para quem não é gestão. */}
      <AvaliacaoTodoPanel />

      <div className="tdg-sobre-filtros" role="group" aria-label="Filtrar por categoria">
        <button type="button" className={categoria === "todas" ? "ativo" : ""} onClick={() => setCategoria("todas")}>
          Todas
        </button>
        {CATEGORIAS_DO_NEGOCIO.map((item) => (
          <button
            type="button"
            key={item.id}
            className={categoria === item.id ? "ativo" : ""}
            onClick={() => setCategoria(item.id)}
          >
            {item.rotulo} · {fatos.filter((fato) => fato.categoria === item.id).length}
          </button>
        ))}
      </div>

      {!fatos.length && (
        <p className="tdg-page-empty">
          O dossiê ainda não foi carregado neste espaço. Ele é gravado sozinho na primeira pergunta
          feita ao Todô{podeEditar ? ", ou agora, no botão acima." : "."}
        </p>
      )}

      <div className="tdg-sobre-lista">
        {visiveis.map((fato) => (
          <article className="tdg-sobre-fato" key={fato.id || fato.chave}>
            <header>
              <strong>{fato.titulo}</strong>
              <span className="tdg-sobre-tags">
                <em>{CATEGORIAS_DO_NEGOCIO.find((item) => item.id === fato.categoria)?.rotulo}</em>
                <em className={`tdg-sigilo-${fato.sigilo}`}>{RESUMO_DO_SIGILO[fato.sigilo]}</em>
                {fato.fixado && <em>Fixado</em>}
                {fato.origem === "aprendido" && <em>Aprendido</em>}
              </span>
            </header>
            <p>{fato.conteudo}</p>
            <footer>
              <small>
                {[fato.fonte && `Fonte: ${fato.fonte}`, fato.vigenteEm && `Posição em ${fato.vigenteEm}`]
                  .filter(Boolean)
                  .join(" · ") || "Sem fonte registrada"}
              </small>
              {podeEditar && (
                <span>
                  <button type="button" onClick={() => abrirEdicao(fato)}>Corrigir</button>
                  <button type="button" className="tdg-sobre-remover" onClick={() => arquivar(fato)}>
                    <Trash2 size={14} /> Remover
                  </button>
                </span>
              )}
            </footer>
          </article>
        ))}
      </div>

      {aberta && (
        <Modal title={aberta === "novo" ? "Ensinar algo novo à IA" : "Corrigir o que a IA sabe"} onClose={() => setAberta(null)} wide>
          <form className="tdg-client-admin-form tdg-form-em-modal" onSubmit={salvar}>
            <div className="tdg-form-row">
              <label>
                <span>Título</span>
                <input required value={form.titulo} onChange={campo("titulo")} placeholder="Ex.: Seguros de carga" />
              </label>
              <label>
                <span>Categoria</span>
                <select value={form.categoria} onChange={campo("categoria")}>
                  {CATEGORIAS_DO_NEGOCIO.map((item) => (
                    <option value={item.id} key={item.id}>{item.rotulo}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>O que a IA precisa saber</span>
              <textarea required rows={8} value={form.conteudo} onChange={campo("conteudo")} />
            </label>
            <div className="tdg-form-row">
              <label>
                <span>Fonte</span>
                <input value={form.fonte} onChange={campo("fonte")} placeholder="Documento, apresentação, quem informou" />
              </label>
              <label>
                <span>Posição em</span>
                <input type="date" value={form.vigenteEm} onChange={campo("vigenteEm")} />
              </label>
            </div>
            <div className="tdg-form-row">
              <label>
                <span>Sigilo</span>
                <select value={form.sigilo} onChange={campo("sigilo")}>
                  {SIGILOS.map((item) => (
                    <option value={item.id} key={item.id}>{item.rotulo}</option>
                  ))}
                </select>
                <small>{SIGILOS.find((item) => item.id === form.sigilo)?.ajuda}</small>
              </label>
              <label className="tdg-form-check">
                <input type="checkbox" checked={Boolean(form.fixado)} onChange={campo("fixado")} />
                <span>Fixar — nunca cortar este ponto quando o dossiê ficar grande</span>
              </label>
            </div>
            <div className="tdg-form-actions">
              <button type="button" onClick={() => setAberta(null)} disabled={salvando}>Cancelar</button>
              <button type="submit" className="tdg-action" disabled={salvando}>
                <Save size={16} /> {salvando ? "Gravando..." : "Gravar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
