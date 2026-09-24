import { Button, Field } from "../../components/ui.jsx";
import PedidoDeAcesso from "./PedidoDeAcesso.jsx";
import { AlertaDeErro, CampoDeSenha, useTermosDeUso } from "./partesDoAcesso.jsx";

// Entrada limpa do ERP (raiz e /todogreen) e dos portais externos (cliente,
// motorista, TMS, colaborador): só e-mail e senha. Sem criação de conta — o
// acesso é liberado pela administração — e sem Google (o botão nunca foi
// desenhado aqui). O texto de cada porta vem de `portalDeEntrada`.
export default function EntradaToDoGreen({
  entryPortal,
  portal,
  form,
  setForm,
  showPassword,
  setShowPassword,
  error,
  busy,
  onSubmit,
  onForgot,
  pedido,
}) {
  const termos = useTermosDeUso();
  return (
    <main className={`auth-shell tdg-auth-entry tdg-auth-entry-${entryPortal || "erp"}`}>
      <section className="tdg-auth-panel" aria-label={portal.titulo}>
        <div className="tdg-auth-brand-panel" aria-label="To Do Green">
          <img src="/logo-todo-green.png" alt="To Do Green" />
        </div>
        <div className="tdg-auth-form-panel">
          <div className="auth-card tdg-auth-card">
            <span className="eyebrow tdg-auth-kicker">{portal.kicker}</span>
            <h2>Entrar</h2>
            <p className="tdg-auth-helper">{portal.helper}</p>

            <form onSubmit={onSubmit}>
              <Field label="E-mail">
                <input
                  required
                  autoFocus
                  autoComplete="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="seu@exemplo.com"
                />
              </Field>
              <Field label="Senha">
                <CampoDeSenha
                  autoComplete="current-password"
                  visivel={showPassword}
                  alternarVisivel={() => setShowPassword((v) => !v)}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Digite sua senha"
                />
              </Field>

              <AlertaDeErro error={error} />

              <Button
                className="full tdg-auth-primary"
                type="submit"
                disabled={busy}
              >
                {busy ? "Aguarde..." : "Entrar"}
              </Button>
            </form>

            <button
              type="button"
              className="tdg-auth-secondary"
              onClick={onForgot}
              disabled={busy}
            >
              {portal.secondary}
            </button>

            {/* Os portais externos são liberados pela operação; pedido de
                acesso é só para a equipe do ERP. */}
            {!entryPortal && <PedidoDeAcesso pedido={pedido} />}

            {termos.botao("auth-legal tdg-auth-legal")}
          </div>
        </div>
      </section>
      {termos.dialogo}
    </main>
  );
}
