import { useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Layers,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button, PageTitle } from "../../components/ui.jsx";
import {
  AREA_PERMISSION_CATALOG,
  PERMISSION_AREAS,
  PERMISSION_PRESETS,
  applyPreset,
  clearMember,
  getMemberPermissions,
  hasPermission,
  listPermissions,
  permissionCoverage,
  setPermission,
  summarizeByArea,
} from "./permissionsDomain.js";
import "./permissionsPanel.css";

// Membros do espaço são carregados por `/api/collab` no App; aqui recebemos
// já a lista para não duplicar a chamada. Caso o carregamento demore, a UI
// mostra o próprio dono da conta como fallback (sem convidados).
function useSpaceMembers(authHeaders, db) {
  const [members, setMembers] = useState(() => {
    if (db?.user?.id) {
      return [
        {
          id: db.user.id,
          name: db.user.name || db.user.email || "Você",
          email: db.user.email || "",
          role: "admin",
          self: true,
        },
      ];
    }
    return [];
  });
  useEffect(() => {
    let alive = true;
    fetch("/api/collab", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!alive || !body) return;
        const list = (body.members || []).map((m) => ({
          id: m.userId || m.id,
          name: m.name || m.email || "Colaborador",
          email: m.email || "",
          role: m.role || "colaborador",
          self: (m.userId || m.id) === db?.user?.id,
        }));
        if (list.length > 0) setMembers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authHeaders, db?.user?.id]);
  return members;
}

// Bloco expansível de uma área — checkbox por permissão + descrição.
function AreaBlock({ area, memberId, permissions, mutate }) {
  const [open, setOpen] = useState(true);
  const catalog = AREA_PERMISSION_CATALOG.find((a) => a.area === area.id);
  if (!catalog) return null;
  const active = catalog.permissions.filter((p) =>
    hasPermission(permissions, memberId, p.key),
  ).length;
  return (
    <section className="pp-area">
      <header>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <strong>{area.label}</strong>
          <span className="pp-chip">{active}/{catalog.permissions.length}</span>
        </button>
      </header>
      {open && (
        <div className="pp-permission-list">
          {catalog.permissions.map((perm) => {
            const checked = hasPermission(permissions, memberId, perm.key);
            return (
              <label key={perm.key} className={checked ? "checked" : ""}>
                <input
                  type="checkbox"
                  aria-label={perm.label}
                  checked={checked}
                  onChange={(e) =>
                    mutate((prev) => setPermission(prev, memberId, perm.key, e.target.checked))
                  }
                />
                <div>
                  <strong>{perm.label}</strong>
                  <small>{perm.description}</small>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Painel por membro: um card com resumo, presets rápidos e todas as áreas.
function MemberCard({ member, permissions, mutate }) {
  const [presetKey, setPresetKey] = useState("");
  const slot = getMemberPermissions(permissions, member.id);
  const byArea = summarizeByArea(permissions, member.id);
  const totalKeys = listPermissions(permissions, member.id).length;
  const applied = slot.presets || [];
  return (
    <article className="pp-member">
      <header>
        <div>
          <span className="pp-avatar">
            <UserPlus size={16} />
          </span>
          <div>
            <strong>{member.name}</strong>
            <small>
              {member.email || "sem e-mail"} · {member.role}
              {member.self ? " · você" : ""}
            </small>
          </div>
        </div>
        <div className="pp-summary">
          <span className="pp-chip strong">
            {totalKeys} permiss{totalKeys === 1 ? "ão" : "ões"}
          </span>
          {PERMISSION_AREAS.filter((a) => byArea[a.id]).map((a) => (
            <span key={a.id} className="pp-chip">
              {byArea[a.id]} em {a.label.toLowerCase()}
            </span>
          ))}
        </div>
      </header>

      <div className="pp-preset-row">
        <label>
          <span>Aplicar preset</span>
          <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
            <option value="">Escolha um preset</option>
            {PERMISSION_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={!presetKey}
          onClick={() => {
            mutate((prev) => applyPreset(prev, member.id, presetKey));
            setPresetKey("");
          }}
        >
          <CheckCheck size={14} /> Aplicar
        </button>
        <button
          type="button"
          className="danger"
          disabled={totalKeys === 0}
          onClick={() => {
            if (!confirm(`Zerar todas as permissões de ${member.name}?`)) return;
            mutate((prev) => clearMember(prev, member.id));
          }}
        >
          <Trash2 size={14} /> Zerar
        </button>
      </div>
      {applied.length > 0 && (
        <p className="pp-notice">
          <ShieldCheck size={13} /> Presets já aplicados:{" "}
          {applied
            .map((k) => PERMISSION_PRESETS.find((p) => p.key === k)?.label || k)
            .join(", ")}
          . Você pode desmarcar chaves individualmente abaixo — o preset é atalho, não papel oculto.
        </p>
      )}

      <div className="pp-areas">
        {PERMISSION_AREAS.map((area) => (
          <AreaBlock
            key={area.id}
            area={area}
            memberId={member.id}
            permissions={permissions}
            mutate={mutate}
          />
        ))}
      </div>
    </article>
  );
}

export default function PermissionsPanel({ db, update, setToast, authHeaders, go }) {
  const permissions = useMemo(() => db?.memberPermissions || {}, [db?.memberPermissions]);
  const members = useSpaceMembers(authHeaders, db);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        String(m.name || "").toLowerCase().includes(q) ||
        String(m.email || "").toLowerCase().includes(q),
    );
  }, [members, query]);
  const coverage = useMemo(() => permissionCoverage(permissions), [permissions]);
  const uncovered = useMemo(() => {
    const missing = [];
    for (const area of AREA_PERMISSION_CATALOG) {
      for (const perm of area.permissions) {
        if (!coverage[perm.key]) missing.push(perm);
      }
    }
    return missing;
  }, [coverage]);

  const mutate = (fn) => {
    update((prev) => ({
      ...prev,
      memberPermissions: fn(prev?.memberPermissions || {}),
    }));
    setToast?.("Permissões atualizadas.");
  };

  return (
    <div className="pp">
      <PageTitle
        eyebrow="CONFIGURAÇÕES"
        title="Permissões por funcionário e área"
        text="Monte, do zero, o que cada pessoa do time pode fazer em cada área — Jurídico, Financeiro, RH, Comercial, Operação, TI e Diretoria. Presets aceleram os casos comuns, mas você continua controlando cada permissão."
        action={
          go && (
            <Button variant="secondary" onClick={() => go("time")}>
              Meu Time
            </Button>
          )
        }
      >
        <div className="pp-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
          />
        </div>
        {uncovered.length > 0 && (
          <section className="pp-panel warn">
            <Layers size={14} />
            <div>
              <strong>Cobertura em aberto:</strong>{" "}
              {uncovered.length} permiss{uncovered.length === 1 ? "ão sem" : "ões sem"} ninguém
              atribuído. Comece pelas mais críticas: aprovação jurídica, aprovação de pagamento e
              dados sensíveis de RH.
            </div>
          </section>
        )}
        <div className="pp-list">
          {filtered.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              permissions={permissions}
              mutate={mutate}
            />
          ))}
          {filtered.length === 0 && (
            <div className="pp-empty">
              Nenhum colaborador encontrado. Convide colegas em Meu Time para começar a distribuir
              permissões.
            </div>
          )}
        </div>
      </PageTitle>
    </div>
  );
}
