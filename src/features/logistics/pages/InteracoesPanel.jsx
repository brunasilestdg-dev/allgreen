import { useEffect, useState } from "react";
import { CalendarClock, NotebookPen, Plus } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import {
  RESULTADOS_DA_INTERACAO,
  TIPOS_DE_INTERACAO,
  diasSemContato,
  proximosPassos,
  rotuloDoTipo,
} from "../interacoesDomain.js";

// ===== Interações registradas =====
//
// Um painel só para conta e oportunidade — quem monta a lista é a tela, que
// sabe o próprio escopo (interacoesVisiveis do domínio). Aqui só se desenha o
// histórico e se registra o novo: reunião com ata, ligação, visita, e-mail e a
// tentativa de contato que não deu certo.
//
// O formulário abre em janela própria (regra "nada corta a tela"): registrar uma
// ata não empurra o histórico nem o resto da conta para baixo.

const hojeLocal = () => new Date().toISOString().slice(0, 10);

const dataBR = (valor) => {
  if (!valor) return "";
  const data = new Date(`${String(valor).slice(0, 10)}T12:00:00`);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toLocaleDateString("pt-BR");
};

const FORM_VAZIO = () => ({
  tipo: "reuniao",
  ocorridaEm: hojeLocal(),
  assunto: "",
  participantes: "",
  ata: "",
  resultado: "",
  proximoPasso: "",
  proximoPassoEm: "",
  responsavelId: "",
  opportunityId: "",
});

export default function InteracoesPanel({
  interacoes = [],
  escopo = "conta",
  aviso,
  podeRegistrar = true,
  onRegistrar,
  onCriarTarefa,
  pessoas = [],
  oportunidades = [],
  abrirRegistro = 0,
  setToast,
}) {
  const [aberta, setAberta] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [interacaoSalva, setInteracaoSalva] = useState(false);
  const [erroRegistro, setErroRegistro] = useState("");

  useEffect(() => {
    if (abrirRegistro > 0) setAberta(true);
  }, [abrirRegistro]);

  const campo = (chave, valor) => setForm((atual) => ({ ...atual, [chave]: valor }));
  const dias = diasSemContato(interacoes);
  const compromissos = proximosPassos(interacoes);

  // Próxima ação com prazo ou responsável = tarefa canônica obrigatória.
  // Sem essa trava a interação sabia do compromisso, mas Planner/To Do/Meu Dia
  // não. Registrar sem virar tarefa só faz sentido quando é observação livre
  // (sem prazo, sem responsável).
  const proximoPassoTexto = form.proximoPasso.trim();
  const proximaAcaoExecutavel = Boolean(proximoPassoTexto) && Boolean(form.proximoPassoEm);
  const responsavelExigido = proximaAcaoExecutavel && !form.responsavelId;
  const integracaoDisponivel = Boolean(onCriarTarefa && pessoas.length);
  const registrar = async (evento) => {
    evento.preventDefault();
    if (!onRegistrar) return;
    if (salvando) return;
    if (proximaAcaoExecutavel && !integracaoDisponivel) {
      const mensagem = "Próxima ação com prazo precisa virar tarefa, mas nenhum responsável está disponível. Remova o prazo para registrar como observação.";
      setErroRegistro(mensagem);
      setToast?.(mensagem);
      return;
    }
    if (responsavelExigido) {
      const mensagem = "Próxima ação com prazo precisa de responsável — ela vira tarefa. Escolha alguém ou remova o prazo para registrar como observação.";
      setErroRegistro(mensagem);
      setToast?.(mensagem);
      return;
    }
    setSalvando(true);
    setErroRegistro("");
    let contatoSalvo = interacaoSalva;
    try {
      if (!contatoSalvo) {
        await onRegistrar({ ...form, assunto: form.assunto.trim(), ata: form.ata.trim() });
        contatoSalvo = true;
        setInteracaoSalva(true);
      }
      if (proximoPassoTexto && form.responsavelId && onCriarTarefa) {
        await onCriarTarefa({
          opportunityId: form.opportunityId,
          title: proximoPassoTexto,
          due: form.proximoPassoEm,
          assigneeId: form.responsavelId,
          assignee: pessoas.find((pessoa) => pessoa.id === form.responsavelId)?.name || "",
        });
      }
      setInteracaoSalva(false);
      setForm(FORM_VAZIO());
      setAberta(false);
    } catch (erro) {
      // A janela fica aberta com o texto digitado: perder uma ata inteira por
      // um erro de rede seria pior do que o erro.
      const mensagem = contatoSalvo
        ? "Contato salvo. Não foi possível criar a tarefa. Tente novamente sem duplicar o contato."
        : erro?.message || "Não foi possível registrar a interação.";
      setErroRegistro(mensagem);
      setToast?.(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="tdg-interacoes">
      <header>
        <strong><NotebookPen size={15} /> Interações registradas</strong>
        <span className="tdg-interacoes-silencio">
          {dias === null
            ? "Nenhuma interação registrada ainda."
            : dias === 0
              ? "Última interação: hoje."
              : `Última interação há ${dias} dia(s).`}
        </span>
        {podeRegistrar && (
          <button type="button" className="tdg-action" onClick={() => setAberta(true)}>
            <Plus size={15} />Registrar interação
          </button>
        )}
      </header>
      {aviso && <small className="tdg-interacoes-aviso">{aviso}</small>}

      {compromissos.length > 0 && (
        <ul className="tdg-interacoes-compromissos" aria-label="Próximos passos combinados">
          {compromissos.map((item) => (
            <li key={item.id}><CalendarClock size={14} /><span>{item.passo}</span><b>{dataBR(item.quando)}</b></li>
          ))}
        </ul>
      )}

      <ol className="tdg-interacoes-lista">
        {interacoes.map((item) => (
          <li key={item.id} data-origem={item.opportunityId ? "oportunidade" : "conta"}>
            <span className="tdg-interacao-tag">{rotuloDoTipo(item.tipo)}</span>
            <div>
              <strong>{item.assunto || rotuloDoTipo(item.tipo)}</strong>
              <small>
                {dataBR(item.ocorridaEm)}
                {item.participantes ? ` · ${item.participantes}` : ""}
                {item.autorEmail ? ` · registrada por ${item.autorEmail}` : ""}
                {!item.opportunityId && " · interação da conta"}
              </small>
              {item.ata && <p>{item.ata}</p>}
              {item.proximoPasso && (
                <small className="tdg-interacao-passo">Próximo passo: {item.proximoPasso}{item.proximoPassoEm ? ` (${dataBR(item.proximoPassoEm)})` : ""}</small>
              )}
            </div>
          </li>
        ))}
        {interacoes.length === 0 && (
          <li className="tdg-interacoes-vazio">
            Nada registrado ainda. Reunião, ligação, visita e até a tentativa sem retorno entram aqui.
          </li>
        )}
      </ol>

      {aberta && (
        <Modal title={escopo === "oportunidade" ? "Registrar interação da oportunidade" : "Registrar interação da conta"} onClose={() => { if (!salvando) setAberta(false); }} wide>
          <form className="tdg-access-form tdg-enterprise-form tdg-form-em-modal" onSubmit={registrar}>
            {erroRegistro && <p role="alert" className="full">{erroRegistro}</p>}
            <label>
              <span>Tipo</span>
              <select disabled={salvando || interacaoSalva} value={form.tipo} onChange={(e) => campo("tipo", e.target.value)}>
                {TIPOS_DE_INTERACAO.map((tipo) => <option value={tipo.id} key={tipo.id}>{tipo.rotulo}</option>)}
              </select>
            </label>
            <label>
              <span>Quando aconteceu</span>
              <input disabled={salvando || interacaoSalva} type="date" required value={form.ocorridaEm} onChange={(e) => campo("ocorridaEm", e.target.value)} />
            </label>
            {escopo === "conta" && oportunidades.length > 0 && (
              <label>
                <span>Oportunidade relacionada</span>
                <select disabled={salvando || interacaoSalva} value={form.opportunityId} onChange={(e) => campo("opportunityId", e.target.value)}>
                  <option value="">Interação geral da conta</option>
                  {oportunidades.map((oportunidade) => <option key={oportunidade.id} value={oportunidade.id}>{oportunidade.titulo || oportunidade.title || oportunidade.nome || oportunidade.id}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>Assunto</span>
              <input disabled={salvando || interacaoSalva} required value={form.assunto} onChange={(e) => campo("assunto", e.target.value)} placeholder="Ex.: Agenda com o time de logística" maxLength={200} />
            </label>
            <label>
              <span>Quem participou</span>
              <input disabled={salvando || interacaoSalva} value={form.participantes} onChange={(e) => campo("participantes", e.target.value)} placeholder="Nomes de quem esteve na conversa" maxLength={500} />
            </label>
            <label className="full">
              <span>Ata / o que foi tratado</span>
              <textarea disabled={salvando || interacaoSalva} rows={5} value={form.ata} onChange={(e) => campo("ata", e.target.value)} placeholder="O que o cliente pediu, o que ficou combinado, objeções, prazos." maxLength={8000} />
            </label>
            <label>
              <span>Resultado</span>
              <select disabled={salvando || interacaoSalva} value={form.resultado} onChange={(e) => campo("resultado", e.target.value)}>
                {RESULTADOS_DA_INTERACAO.map((item) => <option value={item.id} key={item.id || "vazio"}>{item.rotulo}</option>)}
              </select>
            </label>
            <label>
              <span>Próximo passo</span>
              <input disabled={salvando || interacaoSalva} value={form.proximoPasso} onChange={(e) => campo("proximoPasso", e.target.value)} placeholder="Ex.: Enviar minuta revisada" maxLength={500} />
            </label>
            <label>
              <span>Data do próximo passo</span>
              <input disabled={salvando || interacaoSalva} type="date" value={form.proximoPassoEm} onChange={(e) => campo("proximoPassoEm", e.target.value)} />
            </label>
            <label>
              <span>Responsável pelo follow-up{proximaAcaoExecutavel ? " *" : ""}</span>
              <select aria-label="Responsável pelo follow-up" value={form.responsavelId} onChange={(e) => campo("responsavelId", e.target.value)} disabled={salvando || interacaoSalva || !form.proximoPasso.trim() || !onCriarTarefa || !pessoas.length}>
                <option value="">{proximaAcaoExecutavel ? "Escolha um responsável" : "Sem criar tarefa (observação livre)"}</option>
                {pessoas.map((pessoa) => <option value={pessoa.id} key={pessoa.id}>{pessoa.name}{pessoa.email ? ` · ${pessoa.email}` : ""}</option>)}
              </select>
              <small>{!onCriarTarefa ? "O próximo passo será registrado no histórico, sem criar tarefa." : !pessoas.length ? "Nenhum usuário disponível para atribuir uma tarefa." : proximaAcaoExecutavel ? "Próxima ação com prazo vira tarefa canônica (aparece no Planner, To Do e Meu Dia)." : "Ao escolher alguém, o próximo passo também entra na To-do; sem responsável e sem prazo, fica só no histórico."}</small>
            </label>
            <div className="tdg-form-actions">
              <button type="button" disabled={salvando} onClick={() => setAberta(false)}>{interacaoSalva ? "Fechar e tentar depois" : "Cancelar"}</button>
              <button className="tdg-action" type="submit" disabled={salvando}>
                <Plus size={16} />{salvando ? "Salvando..." : interacaoSalva ? "Tentar criar tarefa novamente" : "Salvar interação"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
