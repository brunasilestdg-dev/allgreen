import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle } from "lucide-react";
import "../../styles.css";
import { startUserSession } from "../../session/armazenamento.js";

// Quem já está logado neste aparelho manda a própria sessão: se ela for da
// conta convidada, o convite é aceito sem pedir senha (é o caminho de quem
// entra pelo Google). O cookie HttpOnly vai sozinho; o token legado, não.
const cabecalhoDaSessao = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token");
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

export default function TodoGreenAccessInvite({ token, onAuthenticated = () => {} }) {
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/todogreen/access-invite?token=${encodeURIComponent(token)}`, {
      headers: cabecalhoDaSessao(),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Não foi possível abrir este convite.");
        setInvite(body);
        setName(body.name || "");
      })
      .catch((reason) => setError(reason.message));
  }, [token]);

  // Conta que já existe NÃO troca de senha pelo convite: confirma com a senha
  // que já usa (ou com a sessão aberta nesta conta).
  const contaExistente = Boolean(invite?.hasAccount);
  const semSenha = contaExistente && Boolean(invite?.signedIn);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!contaExistente && password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/todogreen/access-invite", {
        method: "POST",
        headers: { "content-type": "application/json", ...cabecalhoDaSessao() },
        body: JSON.stringify({ token, name, password: semSenha ? "" : password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir seu acesso.");
      if (!body.token || !body.user?.id) throw new Error("Convite concluído sem sessão válida.");
      // Compatibilidade com o gate atual do App. O cookie HttpOnly também foi
      // emitido pelo servidor e permanece ativo em paralelo.
      localStorage.setItem("seu-funcionario-auth-token", body.token);
      startUserSession(body.user);
      onAuthenticated();
      window.location.assign("/todogreen");
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  };

  const titulo = !contaExistente
    ? "Defina sua senha e entre"
    : semSenha
      ? "Aceite o convite"
      : "Entre com a sua senha para aceitar";

  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="eyebrow">TO DO GREEN</span>
        <h2>{titulo}</h2>
        {error && !invite ? (
          <div className="auth-error" role="alert"><CircleAlert />{error}</div>
        ) : !invite ? (
          <p><LoaderCircle className="spin" size={18} /> Carregando convite...</p>
        ) : (
          <form onSubmit={submit}>
            <p className="auth-invite-note">
              Você está ativando o acesso de <strong>{invite.email}</strong>. Esta será a sua sessão, não a de quem enviou o convite.
              {contaExistente && !semSenha && " Como este e-mail já tem conta, confirme com a senha que você já usa — ela não muda."}
            </p>
            {!contaExistente && (
              <label className="field">
                <span>Como podemos chamar você?</span>
                <input value={name} autoComplete="name" required minLength={2} onChange={(event) => setName(event.target.value)} />
              </label>
            )}
            {!semSenha && (
              <label className="field">
                <span>{contaExistente ? "Sua senha" : "Crie uma senha"}</span>
                <input
                  type="password"
                  autoComplete={contaExistente ? "current-password" : "new-password"}
                  value={password}
                  minLength={contaExistente ? undefined : 8}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
            {!contaExistente && (
              <label className="field">
                <span>Confirme a senha</span>
                <input type="password" autoComplete="new-password" value={confirmPassword} minLength={8} required onChange={(event) => setConfirmPassword(event.target.value)} />
              </label>
            )}
            {error && <div className="auth-error" role="alert"><CircleAlert />{error}</div>}
            <button
              className="button primary full"
              type="submit"
              disabled={busy || (!semSenha && (contaExistente ? !password : password.length < 8))}
            >
              {busy
                ? "Entrando..."
                : <><KeyRound size={17} />{contaExistente ? "Entrar e aceitar o convite" : "Definir senha e entrar"}</>}
            </button>
            {contaExistente && !semSenha && (
              <p className="privacy">
                Não lembra a senha? Use “Esqueci minha senha” na <a href="/">tela de acesso</a> e depois abra este convite de novo.
              </p>
            )}
            <p className="privacy"><CheckCircle2 size={15} /> Convite individual e válido por tempo limitado.</p>
          </form>
        )}
      </div>
    </main>
  );
}
