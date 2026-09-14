import "./moduleBadge.css";

// ===== Símbolos dos 9 módulos da All Green Technology Platform =====
//
// Camada visual pura. O material institucional de setembro/2026 apresenta a
// plataforma como 9 blocos numerados (01-09), cada um com sua função
// dentro do "Electrification OS". As telas ficam com o símbolo do bloco a
// que pertencem no canto superior esquerdo, funcionando também como botão
// de "voltar à tela inicial" da vertical.
//
// Referência: PDFs "All Green Technology Platform - Consolidada" e
// "All Green Plataforma do Grupo".

export const ALL_GREEN_MODULES = Object.freeze([
  { number: "01", key: "planning", name: "Fleet Electrification Planning", short: "Planejamento" },
  { number: "02", key: "fleet", name: "Fleet & Vehicle Management", short: "Frota" },
  { number: "03", key: "drivers", name: "Driver Management & Driver App", short: "Motoristas" },
  { number: "04", key: "operations", name: "Operations & Routing", short: "Operação" },
  { number: "05", key: "charging", name: "Charging Management · Green On", short: "Recarga" },
  { number: "06", key: "energy", name: "Energy Management", short: "Energia" },
  { number: "07", key: "payments", name: "Payments & Financial · GreenPay", short: "Pagamentos" },
  { number: "08", key: "data", name: "Data, BI & ESG Intelligence", short: "Dados" },
  { number: "09", key: "ai", name: "AI Optimization & Predictive", short: "IA" },
]);

export const moduleByNumber = (number) =>
  ALL_GREEN_MODULES.find((m) => m.number === String(number).padStart(2, "0")) || null;

export const moduleByKey = (key) =>
  ALL_GREEN_MODULES.find((m) => m.key === key) || null;

// Um símbolo = uma âncora clicável. Quando `href` é informado, clicar leva à
// tela inicial da vertical (o produto pediu esse gesto no canto superior
// esquerdo). Sem `href` vira um selo estático.
export default function ModuleBadge({
  module,
  number,
  href,
  size = "md",
  showTitle = true,
  ariaLabel,
  className = "",
  onClick,
}) {
  const info = module || (number ? moduleByNumber(number) : null);
  if (!info) return null;

  const conteudo = (
    <>
      <span className="module-badge__disc" aria-hidden="true">
        <span className="module-badge__number">{info.number}</span>
      </span>
      {showTitle && (
        <span className="module-badge__label">
          <span className="module-badge__short">{info.short}</span>
          <span className="module-badge__name">{info.name}</span>
        </span>
      )}
    </>
  );

  const classe = `module-badge module-badge--${size} ${className}`.trim();
  const rotulo = ariaLabel || `Voltar à tela inicial · Módulo ${info.number} ${info.name}`;

  if (href) {
    return (
      <a
        className={`${classe} module-badge--clickable`}
        href={href}
        onClick={onClick}
        aria-label={rotulo}
      >
        {conteudo}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={`${classe} module-badge--clickable`}
        onClick={onClick}
        aria-label={rotulo}
      >
        {conteudo}
      </button>
    );
  }
  return <span className={classe} aria-label={rotulo}>{conteudo}</span>;
}
