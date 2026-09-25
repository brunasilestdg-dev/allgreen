import { useEffect, useState } from "react";
import TurnstileWidget, { useTurnstile } from "../../components/TurnstileWidget.jsx";
import { startUserSession } from "../../session/armazenamento.js";
import { AUTH_TOKEN_KEY } from "../../session/espacoVazio.js";
import {
  confirmarCodigoDeEmail,
  entrarComGoogle,
  entrarOuCriarConta,
  pedirCodigoDeRecuperacao,
  redefinirSenha,
  reenviarCodigoDeEmail,
} from "./authApi.js";
import {
  SEM_TOKEN_ANTI_ROBO,
  destinoAposLogin,
  ehEntradaToDoGreen,
  mensagemDeFalha,
  normalizarEmail,
  portalDeEntrada,
  validarCredenciais,
  validarPedidoDeRecuperacao,
  validarRedefinicao,
} from "./authDomain.js";
import EntradaGeral from "./EntradaGeral.jsx";
import EntradaToDoGreen from "./EntradaToDoGreen.jsx";
import { RedefinicaoDeSenha, VerificacaoDeEmail } from "./EtapasDoCodigo.jsx";
import { usePedidoDeAcesso } from "./PedidoDeAcesso.jsx";

// ===== Login =====
//
// Uma tela, quatro momentos: entrar (ou criar conta, no acesso geral),
// confirmar o e-mail com o código, recuperar a senha com o código, e — na
// entrada da To Do Green — pedir acesso. O estado de todos mora aqui para
// sobreviver às idas e voltas entre eles; cada momento é desenhado por um
// componente próprio. As regras (portas de entrada, destinos, validações)
// estão em `authDomain.js`; as chamadas, em `authApi.js`.
//
// `onAuthenticated` avisa o App de que o Worker aceitou a credencial (o status
// da sessão vira "authenticated" sem esperar a revalidação).
export default function Login({ update, onAuthenticated = () => {}, vertical = false, entryPortal = "" }) {
  const entradaToDoGreen = ehEntradaToDoGreen({
    vertical,
    entryPortal,
    pathname: typeof window !== "undefined" ? window.location.pathname : "",
  });
  const portal = portalDeEntrada(entryPortal);
  const destino = destinoAposLogin({ entradaToDoGreen, entryPortal });
  const [mode, setMode] = useState("login");
  useEffect(() => {
    if (entradaToDoGreen) document.title = portal.aba;
  }, [entradaToDoGreen, portal.aba]);

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Anti-robô (Turnstile): um widget por tela; login, cadastro, "esqueci a
  // senha", reenvio do código e pedido de acesso gastam o mesmo token.
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const turnstile = useTurnstile(turnstileSiteKey);
  const { obterToken, renovar: renovarAntiRobo } = turnstile;
  // Devolve o token (ou "" com o Turnstile desligado); null quando ele está
  // ligado mas o widget não entregou token — a tela avisa e não envia.
  const tokenAntiRobo = async () => {
    if (!turnstileSiteKey) return "";
    const token = await obterToken();
    return token || null;
  };
  const pedido = usePedidoDeAcesso({ tokenAntiRobo, renovarAntiRobo });
  // A chave pública do anti-robô vale para toda porta de entrada. O botão do
  // Google só existe no acesso geral: a entrada da To Do Green ignora o
  // client id e nunca carrega o script do Google.
  const [googleId, setGoogleId] = useState("");
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (!entradaToDoGreen) setGoogleId(d.googleClientId || "");
        setTurnstileSiteKey(d.turnstileSiteKey || "");
      })
      .catch(() => {});
  }, [entradaToDoGreen]);
  const [pending, setPending] = useState(null);
  const [code, setCode] = useState("");
  const [recover, setRecover] = useState(null);

  const changeMode = (next) => {
    setMode(next);
    setError("");
    setForm((current) => ({ ...current, password: "" }));
  };
  const enter = (data, newAccount = false) => {
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    // A identidade da porta de entrada define o destino. Não voltamos ao
    // produto genérico depois de autenticar uma pessoa da To Do Green.
    if (destino) history.replaceState({}, "", destino);
    onAuthenticated();
    update(() => {
      const session = startUserSession(data.user);
      return {
        ...session,
        preferences: {
          ...session.preferences,
          needsBusinessOnboardingCandidate: destino ? false : newAccount,
        },
      };
    });
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const email = normalizarEmail(form.email);
    const invalido = validarCredenciais({ ...form, email, mode });
    if (invalido) return setError(invalido);
    setBusy(true);
    try {
      const turnstileToken = await tokenAntiRobo();
      if (turnstileToken === null) throw new Error(SEM_TOKEN_ANTI_ROBO);
      const { ok, data } = await entrarOuCriarConta(mode, {
        name: form.name.trim(),
        email,
        password: form.password,
        turnstileToken,
      });
      if (!ok) throw new Error(data.error || "Não foi possível acessar sua conta.");
      if (data.pending) {
        setPending(data.email);
        setCode("");
        return;
      }
      enter(data, mode === "register");
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      setBusy(false);
      renovarAntiRobo();
    }
  };
  const onGoogleCredential = async (resp) => {
    try {
      const { ok, data } = await entrarComGoogle(resp.credential);
      if (!ok) throw new Error(data.error || "Falha no login com Google.");
      enter(data, data.created === true || data.isNew === true);
    } catch (reason) {
      setError(mensagemDeFalha(reason, "Falha no login com Google."));
    }
  };
  const verify = async () => {
    if (code.length < 6) return;
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await confirmarCodigoDeEmail(pending, code);
      if (!ok) throw new Error(data.error || "Não foi possível confirmar o código.");
      enter(data, mode === "register");
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setError("");
    try {
      const turnstileToken = await tokenAntiRobo();
      if (turnstileToken === null) throw new Error(SEM_TOKEN_ANTI_ROBO);
      const { ok, data } = await reenviarCodigoDeEmail(pending, turnstileToken);
      if (!ok) throw new Error(data.error || "Não foi possível reenviar.");
      setError("Novo código enviado. Confira seu e-mail.");
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      renovarAntiRobo();
    }
  };
  const forgot = async () => {
    const email = normalizarEmail(form.email);
    const invalido = validarPedidoDeRecuperacao(email);
    if (invalido) return setError(invalido);
    setBusy(true);
    setError("");
    try {
      const turnstileToken = await tokenAntiRobo();
      if (turnstileToken === null) throw new Error(SEM_TOKEN_ANTI_ROBO);
      const { ok, data } = await pedirCodigoDeRecuperacao(email, turnstileToken);
      if (!ok) throw new Error(data.error || "Não foi possível enviar o código.");
      setRecover({ email });
      setCode("");
      setForm((c) => ({ ...c, password: "" }));
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      setBusy(false);
      renovarAntiRobo();
    }
  };
  const doReset = async () => {
    const invalido = validarRedefinicao({ code, password: form.password });
    if (invalido) return setError(invalido);
    setBusy(true);
    setError("");
    try {
      const { ok, data } = await redefinirSenha({
        email: recover.email,
        code,
        password: form.password,
      });
      if (!ok) throw new Error(data.error || "Não foi possível redefinir a senha.");
      enter(data);
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      setBusy(false);
    }
  };

  // Widget anti-robô (só aparece com o Turnstile ligado e, mesmo assim, quase
  // sempre invisível: pede interação apenas quando desconfia). A redefinição
  // não o desenha: o código de 6 dígitos já veio do pedido que gastou o token.
  const antiRobo = (
    <>
      <TurnstileWidget turnstile={turnstile} />
      {turnstile.erro && (
        <p className="auth-turnstile-erro" role="status">
          {turnstile.erro}
        </p>
      )}
    </>
  );

  if (recover)
    return (
      <RedefinicaoDeSenha
        entradaToDoGreen={entradaToDoGreen}
        email={recover.email}
        code={code}
        setCode={setCode}
        password={form.password}
        setPassword={(password) => setForm({ ...form, password })}
        error={error}
        busy={busy}
        onRedefinir={doReset}
        onVoltar={() => {
          setRecover(null);
          setCode("");
          setError("");
        }}
      />
    );
  if (pending)
    return (
      <VerificacaoDeEmail
        entradaToDoGreen={entradaToDoGreen}
        email={pending}
        code={code}
        setCode={setCode}
        error={error}
        busy={busy}
        onConfirmar={verify}
        onReenviar={resend}
        antiRobo={antiRobo}
        onVoltar={() => {
          setPending(null);
          setCode("");
          setError("");
        }}
      />
    );
  if (entradaToDoGreen)
    return (
      <EntradaToDoGreen
        entryPortal={entryPortal}
        portal={portal}
        form={form}
        setForm={setForm}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        error={error}
        busy={busy}
        onSubmit={submit}
        onForgot={forgot}
        pedido={pedido}
        antiRobo={antiRobo}
      />
    );
  return (
    <EntradaGeral
      entryPortal={entryPortal}
      mode={mode}
      changeMode={changeMode}
      form={form}
      setForm={setForm}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      error={error}
      busy={busy}
      googleId={googleId}
      onGoogleCredential={onGoogleCredential}
      onSubmit={submit}
      onForgot={forgot}
      antiRobo={antiRobo}
    />
  );
}
