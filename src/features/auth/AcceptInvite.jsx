import { useEffect, useState } from "react";
import { ArrowUpRight, CircleAlert, LogOut, RefreshCw } from "lucide-react";
import { Button, Field, Logo } from "../../components/ui.jsx";
import { cleanDb, endSession, startUserSession } from "../../session/armazenamento.js";
import { AUTH_TOKEN_KEY } from "../../session/espacoVazio.js";
import { aceitarConviteDeColaboracao, lerConviteDeColaboracao } from "./authApi.js";
import { mensagemDeFalha, ROLE_LABELS_PT } from "./authDomain.js";
import { AlertaDeErro } from "./partesDoAcesso.jsx";

// Convite de colaboração (/convite/:token). Três casos: a pessoa ainda não tem
// conta (cria a senha aqui e já entra), tem conta e está logada nela (aceita),
// ou está logada com OUTRA conta (precisa sair — aceitar com a conta errada
// daria o espaço a quem não foi convidado).

function enterSharedSpace(ownerId, ownerName) {
  try {
    localStorage.setItem("sf-space", ownerId);
    localStorage.setItem("sf-space-name", ownerName || "Espaço compartilhado");
  } catch {}
  history.replaceState({}, "", "/");
  location.reload();
}

export default function AcceptInvite({ db, update, token, onAuthenticated = () => {} }) {
  const [state, setState] = useState({ status: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(null);

  useEffect(() => {
    lerConviteDeColaboracao(token)
      .then(({ ok, data }) => {
        // Corpo que não é JSON vira `{}`: sem e-mail não há convite para
        // mostrar, e a tela cai no erro em vez de quebrar.
        if (!ok || !data.email)
          return setState({
            status: "error",
            message: data.error || "Não foi possível carregar o convite.",
          });
        setState({ status: "ready", invite: data });
      })
      .catch(() => setState({ status: "error", message: "Não foi possível carregar o convite." }));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await aceitarConviteDeColaboracao(
        state.invite.hasAccount ? { token } : { token, password },
      );
      if (!ok) throw new Error(data.error || "Não foi possível aceitar o convite.");
      if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        onAuthenticated();
        update(() => startUserSession(data.user));
      }
      setAccepted({ ownerId: data.ownerId, ownerName: data.ownerName });
    } catch (e) {
      setError(mensagemDeFalha(e, "Não foi possível aceitar o convite."));
    } finally {
      setBusy(false);
    }
  };

  if (accepted)
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <span className="eyebrow">CONVITE ACEITO</span>
          <h2>Bem-vindo(a) ao espaço de {accepted.ownerName}</h2>
          <p>Você já pode acessar as ferramentas e os dados liberados para você.</p>
          <Button
            className="full"
            icon={ArrowUpRight}
            onClick={() => enterSharedSpace(accepted.ownerId, accepted.ownerName)}
          >
            Entrar no espaço
          </Button>
        </div>
      </main>
    );

  if (state.status === "loading")
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <p>Carregando convite...</p>
        </div>
      </main>
    );

  if (state.status === "error")
    return (
      <main className="auth-shell verify-shell">
        <div className="auth-card verify-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <span className="eyebrow">CONVITE</span>
          <h2>Não foi possível abrir este convite</h2>
          <AlertaDeErro error={state.message} />
          <p className="auth-switch">
            <a href="/">Voltar para o início</a>
          </p>
        </div>
      </main>
    );

  const invite = state.invite;
  const wrongAccount =
    db.user && invite.hasAccount && db.user.email !== invite.email;
  const rightAccount =
    db.user && invite.hasAccount && db.user.email === invite.email;

  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="mobile-logo">
          <Logo />
        </span>
        <span className="eyebrow">CONVITE DE {invite.ownerName.toUpperCase()}</span>
        <h2>Você foi convidado(a) como {ROLE_LABELS_PT[invite.role] || "Colaborador"}</h2>
        <p>
          Convite enviado para <strong>{invite.email}</strong>.
        </p>
        {invite.hasAccount ? (
          wrongAccount ? (
            <>
              <div className="auth-error" role="alert">
                <CircleAlert />
                Você está logado(a) como {db.user.email}. Entre com a conta{" "}
                {invite.email} para aceitar este convite.
              </div>
              <Button
                className="full"
                variant="secondary"
                icon={LogOut}
                onClick={() => {
                  endSession();
                  update(() => cleanDb(null));
                }}
              >
                Sair e entrar com outra conta
              </Button>
            </>
          ) : rightAccount ? (
            <>
              <AlertaDeErro error={error} />
              <Button
                className="full"
                icon={busy ? RefreshCw : ArrowUpRight}
                disabled={busy}
                onClick={accept}
              >
                {busy ? "Aceitando..." : "Aceitar convite"}
              </Button>
            </>
          ) : (
            <p className="auth-switch">
              Você já possui conta. Entre com {invite.email} e volte a este
              link para aceitar.{" "}
              <a href="/">Ir para o login</a>
            </p>
          )
        ) : (
          <>
            <Field label="Crie uma senha" hint="Mínimo de 8 caracteres">
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
            <AlertaDeErro error={error} />
            <Button
              className="full"
              icon={busy ? RefreshCw : ArrowUpRight}
              disabled={busy || password.length < 8}
              onClick={accept}
            >
              {busy ? "Criando conta..." : "Criar conta e aceitar convite"}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}
