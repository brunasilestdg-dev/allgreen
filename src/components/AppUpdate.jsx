import { RefreshCw } from "lucide-react";

export default function AppUpdate({ visible, latestVersion }) {
  return visible ? (
    <div className="app-update" role="status" aria-live="polite">
      <span>
        <RefreshCw size={18} />
        <strong>Uma nova versão está pronta.</strong>
        {latestVersion
          ? `Versão ${latestVersion} disponível.`
          : "Atualize para receber as melhorias sem perder seus dados."}
      </span>
      <button type="button" onClick={() => location.reload()}>
        Atualizar agora
      </button>
    </div>
  ) : null;
}
