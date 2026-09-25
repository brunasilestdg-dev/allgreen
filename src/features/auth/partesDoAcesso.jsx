import { useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import Modal from "../../components/Modal.jsx";
import { Logo } from "../../components/ui.jsx";
import { LegalContent } from "../legal/LegalPage.jsx";

// Peças repetidas em todas as telas de acesso. Ficam num lugar só para as
// telas não divergirem (a mesma mensagem de erro aparecia com marcações
// diferentes em cinco cópias).

// Dentro do universo To Do Green a marca é a da To Do Green; no acesso geral,
// o logo do Seu Funcionário.
export function MarcaDoAcesso({ entradaToDoGreen }) {
  return entradaToDoGreen ? <strong className="tdg-auth-marca">To Do Green</strong> : <Logo />;
}

export function AlertaDeErro({ error }) {
  if (!error) return null;
  return (
    <div className="auth-error" role="alert">
      <CircleAlert />
      {error}
    </div>
  );
}

// Sem o olho, quem erra a senha não tem como conferir o que digitou — a causa
// mais comum de "não consigo entrar".
export function CampoDeSenha({ value, onChange, visivel, alternarVisivel, autoComplete, placeholder }) {
  return (
    <span className="auth-password">
      <input
        required
        minLength="8"
        autoComplete={autoComplete}
        type={visivel ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={alternarVisivel}
        aria-label={visivel ? "Ocultar senha" : "Mostrar senha"}
      >
        {visivel ? <EyeOff /> : <Eye />}
      </button>
    </span>
  );
}

// O botão dos termos fica no cartão; o diálogo, no fim da página (fora do
// cartão), como sempre esteve. `useTermosDeUso` devolve as duas metades.
export function useTermosDeUso() {
  const [aberto, setAberto] = useState(false);
  const botao = (className) => (
    <p className={className}>
      <button type="button" onClick={() => setAberto(true)}>
        Termos de Uso e Política de Privacidade
      </button>
    </p>
  );
  const dialogo = aberto ? (
    <Modal title="Termos de Uso e Política de Privacidade" onClose={() => setAberto(false)}>
      <LegalContent />
    </Modal>
  ) : null;
  return { botao, dialogo };
}
