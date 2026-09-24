import { CheckCircle2, KeyRound, RefreshCw } from "lucide-react";
import { Button, Field } from "../../components/ui.jsx";
import { normalizarCodigo } from "./authDomain.js";
import { AlertaDeErro, MarcaDoAcesso } from "./partesDoAcesso.jsx";

// As duas etapas em que a pessoa digita o código de 6 dígitos que chegou por
// e-mail: confirmar a conta recém-criada e redefinir a senha. O estado mora no
// `Login` (o código e o erro sobrevivem a ir e voltar); aqui é só a tela.

function CampoDoCodigo({ code, setCode }) {
  return (
    <Field label="Código de 6 dígitos">
      <input
        className="code-input"
        inputMode="numeric"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(e) => setCode(normalizarCodigo(e.target.value))}
        placeholder="000000"
      />
    </Field>
  );
}

export function RedefinicaoDeSenha({
  entradaToDoGreen,
  email,
  code,
  setCode,
  password,
  setPassword,
  error,
  busy,
  onRedefinir,
  onVoltar,
}) {
  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="mobile-logo">
          <MarcaDoAcesso entradaToDoGreen={entradaToDoGreen} />
        </span>
        <span className="eyebrow">RECUPERAR ACESSO</span>
        <h2>Redefinir senha</h2>
        <p>
          Enviamos um código de 6 dígitos para{" "}
          <strong>{email}</strong>. Digite o código e escolha a nova
          senha.
        </p>
        <CampoDoCodigo code={code} setCode={setCode} />
        <Field label="Nova senha" hint="Mínimo de 8 caracteres">
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        <AlertaDeErro error={error} />
        <Button
          className="full"
          icon={busy ? RefreshCw : KeyRound}
          disabled={busy}
          onClick={onRedefinir}
        >
          {busy ? "Redefinindo..." : "Redefinir e entrar"}
        </Button>
        <p className="auth-switch">
          <button type="button" onClick={onVoltar}>
            Voltar para o login
          </button>
        </p>
      </div>
    </main>
  );
}

export function VerificacaoDeEmail({
  entradaToDoGreen,
  email,
  code,
  setCode,
  error,
  busy,
  onConfirmar,
  onReenviar,
  onVoltar,
}) {
  return (
    <main className="auth-shell verify-shell">
      <div className="auth-card verify-card">
        <span className="mobile-logo">
          <MarcaDoAcesso entradaToDoGreen={entradaToDoGreen} />
        </span>
        <span className="eyebrow">VERIFICAÇÃO DE E-MAIL</span>
        <h2>Confirme seu e-mail</h2>
        <p>
          Enviamos um código de 6 dígitos para <strong>{email}</strong>.
          Digite abaixo para ativar sua conta.
        </p>
        <CampoDoCodigo code={code} setCode={setCode} />
        <AlertaDeErro error={error} />
        <Button
          className="full"
          icon={busy ? RefreshCw : CheckCircle2}
          disabled={busy || code.length < 6}
          onClick={onConfirmar}
        >
          {busy ? "Verificando..." : "Confirmar e entrar"}
        </Button>
        <p className="auth-switch">
          Não recebeu?{" "}
          <button type="button" onClick={onReenviar}>
            Reenviar código
          </button>{" "}
          ·{" "}
          <button type="button" onClick={onVoltar}>
            Voltar
          </button>
        </p>
      </div>
    </main>
  );
}
