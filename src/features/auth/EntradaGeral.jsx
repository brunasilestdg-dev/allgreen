import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, Target, WandSparkles } from "lucide-react";
import { Button, Field, Logo } from "../../components/ui.jsx";
import { AlertaDeErro, CampoDeSenha, useTermosDeUso } from "./partesDoAcesso.jsx";

// Acesso geral do produto (qualquer rota fora do universo To Do Green): entrar
// ou criar conta, com o botão do Google quando o Worker publica o client id em
// /api/config. Os atalhos de perfil levam às portas da To Do Green.

const PERFIS_DE_ACESSO = [
  { portal: "", rotulo: "Equipe To Do Green", destino: "/" },
  { portal: "cliente", rotulo: "Portal do Cliente", destino: "/portal-cliente" },
  { portal: "motorista", rotulo: "Portal do Motorista", destino: "/portal-motorista" },
  { portal: "tms", rotulo: "Portal TMS", destino: "/portal-tms" },
];

// Botão "Continuar com o Google" (Google Identity Services). O script do Google
// só é carregado aqui, onde o botão é desenhado. A credencial recebida sobe
// por `onCredential`; a referência evita reinicializar o botão a cada render.
function BotaoGoogle({ googleId, onCredential }) {
  const googleRef = useRef(null);
  const aoReceberCredencial = useRef(onCredential);
  useEffect(() => {
    aoReceberCredencial.current = onCredential;
  }, [onCredential]);
  useEffect(() => {
    if (!googleId) return;
    const handle = (resp) => aoReceberCredencial.current(resp);
    const init = () => {
      if (!window.google?.accounts?.id || !googleRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleId,
        callback: handle,
      });
      googleRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        locale: "pt-BR",
      });
    };
    if (window.google?.accounts?.id) {
      init();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = init;
    document.body.appendChild(s);
  }, [googleId]);
  if (!googleId) return null;
  return (
    <>
      <div ref={googleRef} className="google-btn" />
      <div className="or-divider">
        <span>ou use e-mail</span>
      </div>
    </>
  );
}

export default function EntradaGeral({
  entryPortal,
  mode,
  changeMode,
  form,
  setForm,
  showPassword,
  setShowPassword,
  error,
  busy,
  googleId,
  onGoogleCredential,
  onSubmit,
  onForgot,
}) {
  const termos = useTermosDeUso();
  return (
    <main className="auth-shell">
      <div className="auth-art">
        <Logo />
        <div>
          <span className="eyebrow light">SEU NEGÓCIO EM MOVIMENTO</span>
          <h1>
            Tenha o funcionário que sua empresa precisa,{" "}
            <em>quando precisar.</em>
          </h1>
          <p>
            Mais de 40 funcionários especialistas — estratégia, jurídico,
            marketing, vendas, financeiro, TI e muito mais — coordenados por um
            Diretor de Inteligência.
          </p>
        </div>
        <div className="auth-chips">
          <span>
            <Target />
            Planeje
          </span>
          <span>
            <WandSparkles />
            Crie
          </span>
          <span>
            <CheckCircle2 />
            Execute
          </span>
        </div>
      </div>
      <div className="auth-form">
        <div className="auth-card">
          <span className="mobile-logo">
            <Logo />
          </span>
          <div className="auth-perfis" role="group" aria-label="Escolha seu acesso">
            {PERFIS_DE_ACESSO.map((perfil) => (
              <button
                key={perfil.destino}
                type="button"
                className={entryPortal === perfil.portal ? "active" : ""}
                aria-pressed={entryPortal === perfil.portal}
                onClick={() => window.location.assign(perfil.destino)}
              >
                {perfil.rotulo}
              </button>
            ))}
          </div>
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "active" : ""}
              onClick={() => changeMode("login")}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "active" : ""}
              onClick={() => changeMode("register")}
            >
              Criar conta
            </button>
          </div>
          <span className="eyebrow">
            {mode === "login" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}
          </span>
          <h2>
            {mode === "login" ? "Entre no seu espaço" : "Crie seu espaço de trabalho"}
          </h2>
          <p>
            {mode === "login"
              ? "Use o e-mail e a senha cadastrados para continuar."
              : "Crie sua conta gratuita. Nenhum cartão é necessário."}
          </p>
          <BotaoGoogle googleId={googleId} onCredential={onGoogleCredential} />
          <form onSubmit={onSubmit}>
            {mode === "register" && (
              <Field label="Seu nome">
                <input
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Como podemos chamar você?"
                />
              </Field>
            )}
            <Field label="E-mail">
              <input
                required
                autoFocus={mode === "login"}
                autoComplete="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="voce@empresa.com"
              />
            </Field>
            <Field
              label="Senha"
              hint={mode === "register" ? "Mínimo de 8 caracteres" : undefined}
            >
              <CampoDeSenha
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                visivel={showPassword}
                alternarVisivel={() => setShowPassword((v) => !v)}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
              />
            </Field>
            <AlertaDeErro error={error} />
            <Button
              className="full"
              type="submit"
              icon={ArrowRight}
              disabled={busy}
            >
              {busy
                ? "Aguarde..."
                : mode === "login"
                  ? "Entrar"
                  : "Criar minha conta"}
            </Button>
          </form>
          <div className="auth-switch">
            <span>
              {mode === "login"
                ? "Ainda não tem uma conta?"
                : "Já possui uma conta?"}{" "}
              <button
                type="button"
                onClick={() =>
                  changeMode(mode === "login" ? "register" : "login")
                }
              >
                {mode === "login" ? "Criar conta" : "Entrar"}
              </button>
            </span>
            {mode === "login" && (
              <button type="button" onClick={onForgot} disabled={busy}>
                Esqueci minha senha
              </button>
            )}
          </div>
          <p className="privacy">
            <ShieldCheck />
            Senha protegida com criptografia. Seus dados ficam na sua conta e
            acompanham você em qualquer dispositivo.
          </p>
          {termos.botao("auth-legal")}
        </div>
      </div>
      {termos.dialogo}
    </main>
  );
}
