import { useMemo } from "react";
import { Lock, Shield, Users } from "lucide-react";
import {
  ALL_ROLES,
  INTERNAL_ROLES,
  EXTERNAL_ROLES,
  ROLE_PERMISSIONS,
  INTERNAL_ONLY_PERMISSIONS,
  permissionsFor,
} from "../tenantRbacDomain.js";
import "./TodoGreenPages.css";

// Perfis e permissões da plataforma All Green — a visão que a titular pediu
// no bloco 01: quem enxerga o quê, com o próprio predicado (INTERNAL_ONLY)
// como grade contra vazamento. Read-only: a matriz é declarativa no domínio,
// mudanças passam por código + teste, não por edição na tela.

const ROLE_LABELS = {
  plataforma_admin: "Admin da plataforma",
  tenant_admin: "Admin da empresa",
  gestor_operacao: "Gestor de operação",
  gestor_frota: "Gestor de frota",
  gestor_financeiro: "Gestor financeiro",
  esg_analista: "Analista ESG",
  motorista: "Motorista",
  cliente_admin: "Cliente · admin",
  cliente_gestor: "Cliente · gestor",
  cliente_leitor: "Cliente · leitor",
  locatario_admin: "Locatário · admin",
  locatario_gestor: "Locatário · gestor",
  greenon_b2c: "Green On · pessoa",
  greenon_b2b: "Green On · empresa",
};

export default function TenantAccessPage() {
  const capsPorPapel = useMemo(
    () => Object.fromEntries(ALL_ROLES.map((r) => [r, permissionsFor(r).slice().sort()])),
    [],
  );
  const externaisComInterna = useMemo(
    () =>
      EXTERNAL_ROLES.filter((r) =>
        (ROLE_PERMISSIONS[r] || []).some((p) => INTERNAL_ONLY_PERMISSIONS.includes(p)),
      ),
    [],
  );

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CORE ALL GREEN · GOVERNANÇA</span>
          <h2>Perfis, permissões e isolamento</h2>
          <p>Base única do grupo com isolamento por empresa (tenant) e capacidade por papel. Cliente não vê custo interno, locatário não vê outro locatário, e o motorista só vê o próprio dado — a matriz abaixo é o predicado que TODA leitura atravessa.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Shield size={20} /></span><div><strong>Blindagem de vazamento</strong><small>{externaisComInterna.length === 0 ? "Nenhum papel externo tem capacidade interna" : `${externaisComInterna.length} papel(is) externo(s) com capacidade interna — REVISE`}</small></div></div>
        <p className="tdg-driver-nota">O teste automatizado percorre os 7 papéis externos e explode se algum receber uma capacidade da lista <code>INTERNAL_ONLY_PERMISSIONS</code>. É esse teste que impede um novo papel de cliente ver custo interno por engano.</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Users size={20} /></span><div><strong>Papéis internos</strong><small>{INTERNAL_ROLES.length} papéis — operam o negócio</small></div></div>
        <div className="tdg-tabela-frame">
          <table className="tdg-tabela">
            <thead><tr><th>Papel</th><th>Capacidades</th></tr></thead>
            <tbody>
              {INTERNAL_ROLES.map((r) => (
                <tr key={r}><td><strong>{ROLE_LABELS[r] || r}</strong><br /><small>{r}</small></td><td>{capsPorPapel[r].join(", ") || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Lock size={20} /></span><div><strong>Papéis externos</strong><small>{EXTERNAL_ROLES.length} papéis — só o próprio escopo</small></div></div>
        <div className="tdg-tabela-frame">
          <table className="tdg-tabela">
            <thead><tr><th>Papel</th><th>Capacidades</th></tr></thead>
            <tbody>
              {EXTERNAL_ROLES.map((r) => (
                <tr key={r}><td><strong>{ROLE_LABELS[r] || r}</strong><br /><small>{r}</small></td><td>{capsPorPapel[r].join(", ") || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tdg-driver-nota">Capacidades marcadas como internas ({INTERNAL_ONLY_PERMISSIONS.length}): {INTERNAL_ONLY_PERMISSIONS.join(", ")}.</p>
      </article>
    </div>
  );
}
