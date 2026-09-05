// ===== Badge / StatusBadge — status legível em qualquer módulo (item 50) =====
//
// Uma pílula discreta, mesma cara em toda a plataforma. `tone` traz a cor
// semântica (função, não enfeite). StatusBadge mapeia um status de negócio para
// o tom certo, para "Atrasado" ser sempre vermelho e "Concluído" sempre verde.

export function Badge({ children, tone = "neutral", dot = false, className = "" }) {
  return (
    <span className={`ds-badge ds-badge--${tone} ${className}`.trim()}>
      {dot && <span className="ds-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

const TOM_POR_STATUS = {
  // sucesso / concluído
  concluido: "success", concluida: "success", ativo: "success", ativa: "success",
  aprovado: "success", pago: "success", entregue: "success", verde: "success",
  // alerta / atenção
  pendente: "warning", andamento: "warning", em_andamento: "warning", morno: "warning",
  aguardando: "warning", revisao: "warning", amarelo: "warning",
  // risco / atrasado / erro
  atrasado: "danger", atrasada: "danger", vencido: "danger", bloqueado: "danger",
  recusado: "danger", cancelado: "danger", risco: "danger", quente: "danger", vermelho: "danger",
  // info / frio / neutro
  frio: "info", rascunho: "neutral", novo: "info",
};

export function StatusBadge({ status, label, dot = true, className = "" }) {
  const chave = String(status ?? "").toLowerCase().replace(/\s+/g, "_");
  const tone = TOM_POR_STATUS[chave] || "neutral";
  return <Badge tone={tone} dot={dot} className={className}>{label ?? status}</Badge>;
}
