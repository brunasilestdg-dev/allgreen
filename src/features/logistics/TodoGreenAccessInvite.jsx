import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, LoaderCircle } from "lucide-react";
import "../../styles.css";
import { startUserSession } from "../../session/armazenamento.js";

export default function TodoGreenAccessInvite({ token, onAuthenticated = () => {} }) {
  const [invite, setInvite] = useState(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/todogreen/access-invite?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Não foi possível abrir este convite.");
        setInvite(body);
        setName(body.name || "");
      })
      .catch((reason) => setError(reason.message));
  }, [token]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/todogreen/access-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir seu acesso.");
      startUserSession(body.user);
      onAuthenticated();
      window.location.assign("/todogreen");
    } catch (reason) {
      setError(reason.message);
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="eyebrow">TO DO GREEN</span>
        <h2>{invite?.hasAccount ? "Atualize sua senha e entre" : "Defina sua senha e entre"}</h2>
        {error && !invite ? (
          <div className="auth-error" role="alert"><CircleAlert />{error}</div>
        ) : !invite ? (
          <p><LoaderCircle className="spin" size={18} /> Carregando convite...</p>
        ) : (
          <form onSubmit={submit}>
            <p className="auth-invite-note">
              Você está ativando o acesso de <strong>{invite.email}</strong>. Esta será a sua sessão, não a de quem enviou o convite.
            </p>
            {!invite.hasAccount && (
              <label className="field">
                <span>Como podemos chamar você?</span>
                <input value={name} autoComplete="name" required minLength={2} onChange={(event) => setName(event.target.value)} />
              </label>
            )}
            <label className="field">
              <span>{invite.hasAccount ? "Nova senha" : "Crie uma senha"}</span>
              <input type="password" autoComplete="new-password" value={password} minLength={8} required onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="field">
              <span>Confirme a senha</span>
              <input type="password" autoComplete="new-password" value={confirmPassword} minLength={8} required onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {error && <div className="auth-error" role="alert"><CircleAlert />{error}</div>}
            <button className="button primary full" type="submit" disabled={busy || password.length < 8}>
              {busy ? "Entrando..." : <><KeyRound size={17} />Definir senha e entrar</>}
            </button>
            <p className="privacy"><CheckCircle2 size={15} /> Convite individual e válido por tempo limitado.</p>
          </form>
        )}
      </div>
    </main>
  );
}
