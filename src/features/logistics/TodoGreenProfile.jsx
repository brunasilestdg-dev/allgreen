import { useState } from "react";
import { Download, Plug, UserRound } from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { EXTENSION_INSTALL_STEPS, EXTENSION_ZIP_URL } from "../extension/extensionAccess.js";
import { useExtensionToken } from "../extension/useExtensionToken.js";

// Perfil do usuário DENTRO da vertical To Do Green. A edição de foto e status
// existia só na tela de Configurações do app genérico (/ → Configurações); quem
// trabalha dentro de /todogreen não tinha como chegar nela nem via o avatar no
// cabeçalho. Aqui o mesmo endpoint (/api/auth/profile) é reusado, então foto e
// status ficam visíveis e editáveis na casca onde a titular realmente trabalha.

// Reduz a imagem para um quadrado de 256px (mesma lógica da tela de
// Configurações) — mantém o payload leve e o recorte centralizado.
const reduzirFoto = (arquivo) =>
  new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    leitor.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida."));
      img.onload = () => {
        const lado = 256;
        const canvas = document.createElement("canvas");
        canvas.width = lado;
        canvas.height = lado;
        const ctx = canvas.getContext("2d");
        const escala = Math.max(lado / img.width, lado / img.height);
        const w = img.width * escala;
        const h = img.height * escala;
        ctx.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });

export default function TodoGreenProfile({ db, update, authHeaders, setToast }) {
  const user = db?.user || {};
  const [aberto, setAberto] = useState(false);
  const [statusEmoji, setStatusEmoji] = useState(user.statusEmoji || "");
  const [statusText, setStatusText] = useState(user.statusText || "");
  const [assinatura, setAssinatura] = useState(db?.preferences?.assinaturaEmail || "");
  const [fotoBusy, setFotoBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [erro, setErro] = useState("");
  // A extensão do navegador fala com o Plantû da vertical, mas o token e o
  // pacote só apareciam nas Configurações do app geral. Aqui é o lugar de quem
  // trabalha em /todogreen — a Central de Integrações é só do perfil técnico.
  const extensao = useExtensionToken(setToast);

  const inicial = String(user.name || user.email || "U").trim().charAt(0).toUpperCase();

  const salvar = async (corpo) => {
    const r = await fetch("/api/auth/profile", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
      body: JSON.stringify(corpo),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.error || "Não foi possível salvar.");
    return dados;
  };

  const enviarFoto = async (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setFotoBusy(true);
    setErro("");
    try {
      const avatarUrl = await reduzirFoto(arquivo);
      const dados = await salvar({ avatarUrl });
      update?.((d) => ({ ...d, user: { ...d.user, avatarUrl: dados.user.avatarUrl } }));
      setToast?.("Foto de perfil atualizada");
    } catch (e) {
      setErro(e.message);
    } finally {
      setFotoBusy(false);
      if (evento.target) evento.target.value = "";
    }
  };

  const removerFoto = async () => {
    setFotoBusy(true);
    setErro("");
    try {
      await salvar({ avatarUrl: "" });
      update?.((d) => ({ ...d, user: { ...d.user, avatarUrl: "" } }));
    } catch (e) {
      setErro(e.message);
    } finally {
      setFotoBusy(false);
    }
  };

  const salvarStatus = async () => {
    setStatusBusy(true);
    setErro("");
    try {
      const dados = await salvar({ statusEmoji, statusText });
      update?.((d) => ({ ...d, user: { ...d.user, statusEmoji: dados.user.statusEmoji, statusText: dados.user.statusText } }));
      setToast?.("Status atualizado");
      setAberto(false);
    } catch (e) {
      setErro(e.message);
    } finally {
      setStatusBusy(false);
    }
  };

  // Assinatura de e-mail: preferência do espaço (db.preferences), não do /auth.
  // É "a minha assinatura" usada no fecho da apresentação comercial.
  const salvarAssinatura = () => {
    update?.((d) => ({ ...d, preferences: { ...(d.preferences || {}), assinaturaEmail: assinatura.trim() } }));
    setToast?.("Assinatura de e-mail salva");
  };
  const assinaturaSalva = (db?.preferences?.assinaturaEmail || "");
  const statusMudou = statusEmoji !== (user.statusEmoji || "") || statusText !== (user.statusText || "");
  const assinaturaMudou = assinatura.trim() !== assinaturaSalva.trim();

  return (
    <>
      <button
        type="button"
        className="tdg-perfil-chip"
        onClick={() => { setStatusEmoji(user.statusEmoji || ""); setStatusText(user.statusText || ""); setAssinatura(assinaturaSalva); setErro(""); setAberto(true); }}
        title={`Perfil de ${user.name || user.email || ""} — foto e status`}
        aria-label="Abrir meu perfil (foto e status)"
      >
        <span className="tdg-perfil-avatar" aria-hidden="true">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt="" />
            : <span className="tdg-perfil-inicial">{inicial}</span>}
        </span>
        <span className="tdg-perfil-quem">
          <strong>{user.name || user.email || "Meu perfil"}</strong>
          {(user.statusEmoji || user.statusText) && (
            <small>{user.statusEmoji ? `${user.statusEmoji} ` : ""}{user.statusText || ""}</small>
          )}
        </span>
      </button>

      {aberto && (
        <Modal title="Meu perfil" onClose={() => setAberto(false)}>
          <div className="tdg-perfil-editor">
            <div className="tdg-perfil-foto-linha">
              <span className="tdg-perfil-avatar grande" aria-hidden="true">
                {user.avatarUrl
                  ? <img src={user.avatarUrl} alt="" />
                  : <span className="tdg-perfil-inicial">{inicial}</span>}
              </span>
              <div className="tdg-perfil-foto-acoes">
                <label className="tdg-perfil-foto-btn">
                  {fotoBusy ? "Enviando…" : (user.avatarUrl ? "Trocar foto" : "Adicionar foto")}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={enviarFoto} disabled={fotoBusy} hidden />
                </label>
                {user.avatarUrl && (
                  <button type="button" className="tdg-btn-ghost" onClick={removerFoto} disabled={fotoBusy}>
                    Remover
                  </button>
                )}
                <p className="tdg-esg-nota">
                  <UserRound size={13} /> {user.email || ""}
                </p>
              </div>
            </div>

            <div className="tdg-form">
              <label>
                <span>Status (emoji)</span>
                <input value={statusEmoji} onChange={(e) => setStatusEmoji(e.target.value)} maxLength={16} placeholder="🟢" />
              </label>
              <label>
                <span>Status (frase)</span>
                <input value={statusText} onChange={(e) => setStatusText(e.target.value)} maxLength={140} placeholder="Ex.: Focada em fechamento" />
              </label>
            </div>

            <label className="tdg-perfil-assinatura">
              <span>Minha assinatura de e-mail</span>
              <textarea
                value={assinatura}
                onChange={(e) => setAssinatura(e.target.value)}
                rows={4}
                maxLength={600}
                placeholder={"Ex.:\nRenata Paula · Comercial · To Do Green\n(11) 90000-0000 · renata@todogreen.com.br"}
              />
              <small className="tdg-esg-nota">Usada no fecho do e-mail de apresentação. Em branco, assina com seu primeiro nome.</small>
              <button type="button" className="tdg-btn-ghost" disabled={!assinaturaMudou} onClick={salvarAssinatura}>
                Salvar assinatura
              </button>
            </label>

            <section className="tdg-perfil-extensao" aria-labelledby="tdg-perfil-extensao-titulo">
              <h3 id="tdg-perfil-extensao-titulo"><Plug size={15} aria-hidden="true" /> Extensão do navegador</h3>
              <p className="tdg-esg-nota">
                Leve o Plantû para qualquer página: resumir, preparar respostas e sugerir tarefas sem sair do site que você está lendo.
              </p>
              <ol>
                {EXTENSION_INSTALL_STEPS.map((passo) => <li key={passo}>{passo}</li>)}
              </ol>
              <label>
                <span>Seu token de acesso</span>
                <input value={extensao.value} readOnly aria-label="Token de acesso" />
              </label>
              <div className="tdg-perfil-extensao-acoes">
                <a className="tdg-btn-ghost" href={EXTENSION_ZIP_URL} download>
                  <Download size={14} aria-hidden="true" /> Baixar a extensão
                </a>
                <button type="button" className="tdg-btn-ghost" onClick={extensao.toggle}>
                  {extensao.shown ? "Ocultar" : "Mostrar"}
                </button>
                <button type="button" className="tdg-btn-ghost" onClick={extensao.copy} disabled={!extensao.token}>
                  Copiar token
                </button>
              </div>
            </section>

            {erro ? <p className="tdg-alert" role="alert">{erro}</p> : null}

            <div className="tdg-perfil-editor-acoes">
              <button type="button" className="tdg-btn-ghost" onClick={() => setAberto(false)}>Fechar</button>
              <button type="button" className="tdg-action" disabled={statusBusy || !statusMudou} onClick={salvarStatus}>
                {statusBusy ? "Salvando…" : "Salvar status"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
