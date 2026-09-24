import { Copy, Download, Plug } from "lucide-react";
import { Button, Field } from "../../components/ui.jsx";
import { EXTENSION_INSTALL_STEPS, EXTENSION_ZIP_URL } from "./extensionAccess.js";
import { useExtensionToken } from "./useExtensionToken.js";

// Cartão de Configurações do app geral. A versão da To Do Green fica no
// "Meu perfil" da vertical (TodoGreenProfile.jsx) e usa as mesmas peças.
export default function ExtensionCard({ setToast }) {
  const acesso = useExtensionToken(setToast);
  return (
    <section className="settings-card" id="settings-extension">
      <div className="settings-card-head">
        <span className="settings-icon">
          <Plug />
        </span>
        <div>
          <h2>Extensão do navegador</h2>
          <p>Leve o Plantû para qualquer página da internet.</p>
        </div>
      </div>
      <p className="settings-note">
        Resume páginas, prepara respostas e sugere tarefas sem sair do site que
        você está lendo. Funciona para quem tem acesso à To Do Green, sem custo
        extra.
      </p>
      <ol className="settings-note extension-steps">
        {EXTENSION_INSTALL_STEPS.map((passo) => (
          <li key={passo}>{passo}</li>
        ))}
      </ol>
      <Field label="Seu token de acesso">
        <input
          value={acesso.value}
          readOnly
          className="readonly"
          aria-label="Token de acesso"
        />
      </Field>
      <div className="settings-actions">
        <a className="button secondary" href={EXTENSION_ZIP_URL} download>
          <Download size={17} />
          <span>Baixar a extensão</span>
        </a>
        <Button variant="secondary" onClick={acesso.toggle}>
          {acesso.shown ? "Ocultar" : "Mostrar"}
        </Button>
        <Button icon={Copy} onClick={acesso.copy} disabled={!acesso.token}>
          Copiar token
        </Button>
      </div>
    </section>
  );
}
