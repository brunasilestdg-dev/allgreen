// ===== Design System — ponto único de importação (Onda 1) =====
//
// Importe daqui em qualquer módulo: `import { Button, SearchableSelect } from
// "@/design-system"` (ou caminho relativo). Os estilos entram junto, uma vez.
// Regra do redesign: NENHUM módulo cria a própria versão desses componentes —
// consistência vem de reusar estes (item 50/53).
import "./tokens.css";
import "./design-system.css";

export { Button, IconButton } from "./Button.jsx";
export { Field, Input, Textarea } from "./fields.jsx";
export { SearchableSelect } from "./SearchableSelect.jsx";
export { RadioCards } from "./RadioCards.jsx";
export { Badge, StatusBadge } from "./Badge.jsx";
export {
  normalizar,
  opcaoCasa,
  filtrarOpcoes,
  agruparOpcoes,
  proximoIndice,
} from "./selectFilter.js";
