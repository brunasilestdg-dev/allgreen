import { useEffect, useMemo, useState } from "react";
import { Download, Mail, Send } from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { sendGmailReal, createGmailDraftReal, base64FromBytes } from "../../integrations/google.js";
import {
  APRESENTACAO_PDF_URL,
  APRESENTACAO_PDF_NOME,
  montarEmailApresentacao,
  linkComposeGmail,
} from "./apresentacaoComercialDomain.js";

// Envia a apresentação comercial (PDF) por e-mail ao contato da conta, com a
// abordagem certa pelo perfil (temperatura), e em seguida registra no CRM
// "apresentação enviada" e move a oportunidade para o estágio Apresentação.
//
// Caminho principal: envio direto pela conta Google do usuário, com o PDF
// ANEXADO (sendGmailReal + multipart). Sem Google conectado, cai no compose do
// Gmail (o PDF vai por download para a pessoa anexar).
export default function EnviarApresentacao({ conta, houveContato = false, contexto = null, onRegistrar, onMoverEstagio, setToast, onClose }) {
  const contatos = useMemo(() => conta?.crm?.contacts || conta?.contacts || [], [conta]);
  // Default recipient: an ACTIVE contact with e-mail. Nunca sugerir um contato
  // desligado/inativo como destinatário — a pessoa ainda pode digitar outro no
  // campo, mas o padrão não pode ser alguém que já saiu da empresa.
  const ativos = useMemo(
    () => contatos.filter((c) => c?.active !== false && c?.employmentStatus !== "former"),
    [contatos],
  );
  const contatoComEmail = useMemo(
    () => ativos.find((c) => c?.email) || ativos[0] || null,
    [ativos],
  );
  const inicial = useMemo(
    () => montarEmailApresentacao({
      contatoNome: contatoComEmail?.name,
      contaNome: conta?.name,
      temperatura: conta?.crm?.temperature,
      houveContato,
      contexto,
    }),
    [contatoComEmail, conta, houveContato, contexto],
  );

  const [para, setPara] = useState(contatoComEmail?.email || "");
  const [assunto, setAssunto] = useState(inicial.assunto);
  const [corpo, setCorpo] = useState(inicial.corpo);
  const [googleId, setGoogleId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    fetch("/api/config").then((r) => r.json()).then((d) => { if (ativo) setGoogleId(d.googleClientId || ""); }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  // Depois de enviar: registra a interação e move o estágio. Melhor-esforço —
  // o e-mail já saiu, não vale travar por causa do CRM. Devolve o que de fato
  // aconteceu para o toast não mentir (registro pode falhar; o estágio só
  // avança quando estava atrás de Apresentação).
  const registrarEMover = async () => {
    let registrado = false;
    let movido = false;
    try {
      await onRegistrar?.({
        tipo: "email",
        assunto: "Apresentação comercial enviada",
        ata: `Apresentação comercial da To Do Green enviada por e-mail para ${para}.`,
        ocorridaEm: new Date().toISOString().slice(0, 10),
      });
      registrado = true;
    } catch { /* registro é secundário */ }
    try { movido = (await onMoverEstagio?.()) === true; } catch { /* idem */ }
    return { registrado, movido };
  };

  // Monta um aviso que só afirma o que realmente ocorreu.
  const avisoDe = (inicio, { registrado, movido }) =>
    [inicio, registrado ? "Registrada no CRM." : "", movido ? "Estágio movido para Apresentação." : ""]
      .filter(Boolean)
      .join(" ");

  // Lê o PDF da apresentação e devolve o anexo pronto. Reusado pelo envio
  // direto e pela criação do rascunho.
  const carregarAnexo = async () => {
    const resposta = await fetch(APRESENTACAO_PDF_URL);
    if (!resposta.ok) throw new Error("Não encontrei o arquivo da apresentação.");
    const base64 = base64FromBytes(new Uint8Array(await resposta.arrayBuffer()));
    return [{ filename: APRESENTACAO_PDF_NOME, mimeType: "application/pdf", base64 }];
  };

  // Cria um RASCUNHO no Gmail com o PDF já anexado — a pessoa revisa e envia.
  // É o que corrige "o rascunho não anexa o material": a compose por URL não
  // carrega anexo; a API de drafts carrega.
  const criarRascunhoComAnexo = async () => {
    if (!para.trim() || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const attachments = await carregarAnexo();
      await createGmailDraftReal(googleId, { to: para.trim(), subject: assunto, body: corpo, attachments });
      const feito = await registrarEMover();
      setToast?.(avisoDe("Rascunho criado no Gmail com o anexo — revise e envie.", feito));
      onClose();
    } catch (motivo) {
      setErro(motivo?.message || "Não foi possível criar o rascunho agora.");
    } finally {
      setEnviando(false);
    }
  };

  const enviarComAnexo = async () => {
    if (!para.trim() || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const attachments = await carregarAnexo();
      await sendGmailReal(googleId, { to: para.trim(), subject: assunto, body: corpo, attachments });
      const feito = await registrarEMover();
      setToast?.(avisoDe("Apresentação enviada com anexo.", feito));
      onClose();
    } catch (motivo) {
      setErro(motivo?.message || "Não foi possível enviar agora.");
    } finally {
      setEnviando(false);
    }
  };

  const abrirCompose = async () => {
    if (enviando) return;
    if (!para.trim()) { setErro("Informe o e-mail do contato."); return; }
    // Se o pop-up for bloqueado, o rascunho não abre — não podemos registrar
    // "apresentação enviada" nem mexer no estágio com base num envio que não
    // vai acontecer.
    const janela = window.open(linkComposeGmail({ para: para.trim(), assunto, corpo }), "_blank", "noopener");
    if (!janela) {
      setErro("O navegador bloqueou a janela do Gmail. Libere o pop-up e tente de novo.");
      return;
    }
    setEnviando(true);
    setErro("");
    try {
      const feito = await registrarEMover();
      setToast?.(avisoDe('Rascunho aberto no Gmail — anexe o PDF ("Baixar apresentação") e envie.', feito));
      onClose();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal title="Enviar apresentação comercial" onClose={onClose}>
      <div className="tdg-form-em-modal" style={{ display: "grid", gap: 10 }}>
        <label><span>Para</span><input type="email" value={para} onChange={(e) => setPara(e.target.value)} placeholder="email@empresa.com.br" /></label>
        {!contatoComEmail?.email && <small style={{ color: "#a5342a" }}>Esta conta não tem contato com e-mail — digite o destinatário.</small>}
        <label><span>Assunto</span><input value={assunto} onChange={(e) => setAssunto(e.target.value)} /></label>
        <label><span>Mensagem {conta?.crm?.temperatura ? "" : ""}(abordagem por perfil{conta?.crm?.temperature ? ` · conta ${conta.crm.temperature.toLowerCase()}` : ""})</span>
          <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={9} />
        </label>
        <small>Anexo: <strong>{APRESENTACAO_PDF_NOME}</strong> · <a href={APRESENTACAO_PDF_URL} target="_blank" rel="noopener noreferrer"><Download size={12} /> Baixar apresentação</a></small>
        {erro && <p className="tdg-erro" style={{ color: "#a5342a" }}>{erro}</p>}
        <div className="tdg-form-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {googleId
            ? <>
                <button type="button" className="principal" onClick={criarRascunhoComAnexo} disabled={enviando}><Mail size={15} /> {enviando ? "Criando..." : "Criar rascunho com anexo"}</button>
                <button type="button" onClick={enviarComAnexo} disabled={enviando}><Send size={15} /> {enviando ? "Enviando..." : "Enviar com anexo"}</button>
              </>
            : null}
          <button type="button" onClick={abrirCompose} disabled={enviando}><Mail size={15} /> {googleId ? "Compose sem anexo" : "Abrir no Gmail"}</button>
          <button type="button" onClick={onClose} disabled={enviando}>Cancelar</button>
        </div>
        {!googleId && <small>Para enviar com o anexo automático, conecte sua conta Google em Integrações. Sem isso, use &quot;Abrir no Gmail&quot; e anexe o PDF baixado.</small>}
      </div>
    </Modal>
  );
}
