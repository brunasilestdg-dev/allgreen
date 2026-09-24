import { useState } from "react";
import { CheckCircle2, LogOut, RefreshCw } from "lucide-react";
import { Button, Field } from "../../components/ui.jsx";
import { cleanDb, endSession } from "../../session/armazenamento.js";
import { trocarSenha } from "./authApi.js";
import { mensagemDeFalha, validarTrocaDeSenhaProvisoria } from "./authDomain.js";
import { AlertaDeErro } from "./partesDoAcesso.jsx";

// Primeiro acesso com senha provisória (criada pelo admin na tela de Equipe,
// contingência ao convite por e-mail): nada do app abre antes de a pessoa
// definir a própria senha. O servidor desliga a marca em /api/auth/password;
// quem decide QUANDO esta tela aparece é `exigeTrocaDeSenha` (authDomain.js).
export default function FirstAccessPassword({ db, update }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const invalido = validarTrocaDeSenhaProvisoria(form);
    if (invalido) return setError(invalido);
    setBusy(true);
    try {
      const { ok, data } = await trocarSenha({
        currentPassword: form.current,
        newPassword: form.next,
      });
      if (!ok) throw new Error(data.error || "Não foi possível trocar a senha.");
      update((current) => {
        const { mustChangePassword: _flag, ...user } = current.user || {};
        return { ...current, user };
      });
    } catch (reason) {
      setError(mensagemDeFalha(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-shell verify-shell">
      <form className="auth-card verify-card" onSubmit={submit}>
        <span className="eyebrow">PRIMEIRO ACESSO</span>
        <h2>Crie sua senha</h2>
        <p>
          Olá{db.user?.name ? `, ${db.user.name}` : ""}. Você entrou com uma senha provisória.
          Defina agora uma senha só sua para continuar.
        </p>
        <Field label="Senha provisória">
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
        </Field>
        <Field label="Nova senha (mínimo 8 caracteres)">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
        </Field>
        <Field label="Confirme a nova senha">
          <input
            type="password"
            autoComplete="new-password"
            required
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </Field>
        <AlertaDeErro error={error} />
        <Button type="submit" className="full" icon={busy ? RefreshCw : CheckCircle2} disabled={busy}>
          {busy ? "Salvando..." : "Salvar senha e entrar"}
        </Button>
        <Button
          className="full"
          variant="ghost"
          icon={LogOut}
          onClick={() => {
            endSession();
            update(() => cleanDb(null));
          }}
        >
          Sair
        </Button>
      </form>
    </main>
  );
}
