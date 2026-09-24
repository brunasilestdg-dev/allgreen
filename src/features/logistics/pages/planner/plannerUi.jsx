import { AlertCircle, ArrowDown, ArrowUp } from "lucide-react";
import {
  PLANNER_PRIORITIES,
  PLANNER_PROGRESS,
  corDoRotulo,
  iniciais,
} from "../../plannerDomain.js";

// ===== Peças visuais compartilhadas do Planner =====
//
// Constantes e componentes pequenos que o quadro, a tabela, a linha do tempo,
// os gráficos e o modal usam em comum.

export const COR_PRIORIDADE = {
  urgente: "#b42318",
  alta: "#c4700b",
  media: "#2c7a5b",
  baixa: "#5b6b78",
};
export const LABEL_PRIORIDADE = Object.fromEntries(PLANNER_PRIORITIES.map((p) => [p.id, p.label]));
export const LABEL_PROGRESSO = Object.fromEntries(PLANNER_PROGRESS.map((p) => [p.id, p.label]));

// Tintas dos cabeçalhos das colunas (uma por balde, em ciclo): pastéis como
// os do Planner da Microsoft, para o olho separar as colunas sem ler o título.
export const TINTAS_COLUNA = ["#d97a4a", "#7fb069", "#2ab3b1", "#1f4e79", "#8e6bbf", "#c9a227", "#d1657f", "#6b8e9f"];

// Cores de plano que a titular escolhe ao criar/editar (o ícone quadrado do
// rail e da trilha usa a cor). A primeira é o verde da marca.
export const CORES_PLANO = ["#17624f", "#0b8073", "#1d4f91", "#5a2e91", "#8f2b4d", "#b8541a", "#3f4c58", "#b42318"];

export const hoje = () => new Date().toISOString().slice(0, 10);

export const tarefaVazia = (bucketId = "") => ({
  title: "",
  notes: "",
  bucketId,
  assigneeUserId: "",
  assigneeLabel: "",
  priority: "media",
  progress: "nao_iniciada",
  startDate: "",
  dueDate: "",
  checklist: [],
  labels: [],
  campos: { clientId: "", opportunityId: "" },
});

// Id de tarefa nova: UUID quando disponível; senão carimbo + aleatório.
export const gerarIdDeTarefa = () => (typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

// Os três jeitos de compartilhar, na tela. O banco só conhece private/shared;
// "Pessoas específicas" é privado + a lista de membros. O mapeamento acontece
// no envio.
export const MODOS_DE_PARTILHA = [
  { id: "privado", label: "Privado", ajuda: "Só você vê este plano." },
  { id: "pessoas", label: "Pessoas específicas", ajuda: "Você escolhe quem vê e trabalha nas tarefas." },
  { id: "espaco", label: "Todo o espaço", ajuda: "Todo o espaço de trabalho vê." },
];

export const modoDoPlano = (plano) => {
  if (plano?.visibility === "shared") return "espaco";
  return (plano?.members || []).length > 0 ? "pessoas" : "privado";
};

export const partilhaParaEnvio = (modo, members) => ({
  visibility: modo === "espaco" ? "shared" : "private",
  members: modo === "pessoas" ? members : [],
});

export const rotuloPartilha = (plano) => {
  const modo = modoDoPlano(plano);
  if (modo === "espaco") return "Todo o espaço";
  if (modo === "pessoas") {
    const n = (plano.members || []).length;
    return `${n} pessoa${n === 1 ? "" : "s"}`;
  }
  return "Só eu";
};

// Avatar com iniciais: a cor vem do nome (mesma regra dos rótulos), então a
// mesma pessoa tem sempre a mesma cor em qualquer cartão.
export function Avatar({ nome, tamanho = 26, title }) {
  const cor = corDoRotulo(nome);
  return (
    <span
      className="plr-avatar"
      style={{ "--plr-av-fundo": cor.fundo, "--plr-av-texto": cor.texto, width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.4) }}
      title={title || nome}
      aria-label={nome}
      role="img"
    >
      {iniciais(nome)}
    </span>
  );
}

// Etiqueta colorida (rótulo da tarefa).
export function Rotulo({ texto, onRemover, pequeno = false }) {
  const cor = corDoRotulo(texto);
  return (
    <span
      className={`plr-rotulo${pequeno ? " plr-rotulo--pequeno" : ""}`}
      style={{ "--plr-rotulo-fundo": cor.fundo, "--plr-rotulo-texto": cor.texto }}
    >
      {texto}
      {onRemover ? <button type="button" aria-label={`Remover rótulo ${texto}`} onClick={onRemover}>×</button> : null}
    </span>
  );
}

// Ícone de prioridade no rodapé do cartão: "!" vermelho para urgente, seta
// para cima âmbar na alta, seta para baixo na baixa; média não mostra nada
// (é o padrão — mostrar tudo vira ruído).
export function IconePrioridade({ prioridade, tamanho = 14 }) {
  if (prioridade === "urgente")
    return <AlertCircle size={tamanho} className="plr-prio plr-prio--urgente" aria-label="Urgente" title="Urgente" />;
  if (prioridade === "alta")
    return <ArrowUp size={tamanho} className="plr-prio plr-prio--alta" aria-label="Alta" title="Prioridade alta" />;
  if (prioridade === "baixa")
    return <ArrowDown size={tamanho} className="plr-prio plr-prio--baixa" aria-label="Baixa" title="Prioridade baixa" />;
  return null;
}

// O quadradinho colorido com iniciais que identifica o plano no rail e na trilha.
export function PlanoIcone({ plano, tamanho = 24 }) {
  return (
    <span
      className="plr-plano-icone"
      style={{ background: plano?.color || CORES_PLANO[0], width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.42) }}
      aria-hidden="true"
    >
      {iniciais(plano?.name || "Plano")}
    </span>
  );
}
