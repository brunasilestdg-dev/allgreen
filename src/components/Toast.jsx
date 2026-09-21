import { CheckCircle2, CircleAlert } from "lucide-react";
import { textoDoToast, tomDoToast } from "../toastTone.js";

export default function Toast({ toast }) {
  if (!toast) return null;
  const tom = tomDoToast(toast);
  const texto = textoDoToast(toast);
  const Icone = tom === "erro" ? CircleAlert : CheckCircle2;
  return (
    <div className={`toast ${tom === "erro" ? "erro" : ""}`} role="status" aria-live="polite">
      <Icone size={18} />
      {texto}
    </div>
  );
}
