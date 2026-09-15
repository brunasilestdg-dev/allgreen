// ===== Campos de compartilhamento =====
//
// Quem enxerga um registro: só eu, minha equipe, um projeto, ou todo mundo do
// espaço. Aparece em tarefa, documento, contato e financeiro — por isso é
// componente, e não um pedaço copiado em cada tela.

import { useEffect, useState } from "react";
import { activeSpaceId, authHeaders } from "../session/armazenamento.js";
import { Field } from "./ui.jsx";

export default function SharingFields({
  value,
  onChange,
  teams,
  disabled,
  disabledHint,
  projectOptions,
  hideProjectField,
}) {
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const space = activeSpaceId();
    // Duas fontes reunidas por id:
    //   1) `/api/collab`: dono + membros invitados via Seu Funcionário
    //   2) `/api/todogreen/planner/pessoas`: dono + memberships + tenant_users
    //      (quem entrou pela vertical To Do Green — Jeberson e afins).
    // Reclamação da titular: "aparece o Breno (Seu Funcionário) mas não o
    // Jeberson (vertical)". Se uma rota estiver fora do escopo do usuário
    // (ex.: fora da vertical), devolve vazio; a outra segue valendo.
    // Loga a razão de falha no console — sem isso, o picker "só vinha vazio"
    // e a titular ficava sem entender de onde a lista viria.
    const doCollab = fetch(`/api/collab${space ? `?owner=${encodeURIComponent(space)}` : ""}`, {
      headers: authHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.warn(`[SharingFields] /api/collab respondeu ${r.status}`);
          return null;
        }
        return r.json();
      })
      .then((d) => (d ? [d.owner, ...(d.members || [])] : []))
      .catch((err) => {
        console.warn("[SharingFields] /api/collab falhou", err);
        return [];
      });
    const daVertical = fetch("/api/todogreen/planner/pessoas", {
      headers: authHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.warn(`[SharingFields] /api/todogreen/planner/pessoas respondeu ${r.status}`);
          return null;
        }
        return r.json();
      })
      .then((d) => d?.registros || [])
      .catch((err) => {
        console.warn("[SharingFields] /api/todogreen/planner/pessoas falhou", err);
        return [];
      });
    Promise.all([doCollab, daVertical]).then(([collab, vertical]) => {
      if (cancelled) return;
      const vistos = new Set();
      const juntos = [];
      for (const pessoa of [...collab, ...vertical]) {
        const id = pessoa?.id;
        if (!id || vistos.has(id) || !pessoa?.name) continue;
        vistos.add(id);
        juntos.push({ id, name: pessoa.name, email: pessoa.email || "" });
      }
      setMembers(juntos);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const visibility = value.visibility || "privado";
  const togglePerson = (id) => {
    const current = value.sharedWith || [];
    onChange({
      ...value,
      sharedWith: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };
  const toggleTeam = (id) => {
    const current = value.sharedTeams || [];
    onChange({
      ...value,
      sharedTeams: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  };
  if (disabled) {
    return (
      <div className="field">
        <span>Visibilidade</span>
        <small>{disabledHint || "Definida automaticamente."}</small>
      </div>
    );
  }
  return (
    <>
      <Field label="Visibilidade">
        <select
          value={visibility}
          onChange={(e) => onChange({ ...value, visibility: e.target.value })}
        >
          <option value="privado">Privado (só eu)</option>
          <option value="pessoas">
            Compartilhado com pessoas selecionadas
          </option>
          <option value="equipe">Compartilhado com uma equipe</option>
          <option value="projeto">
            Compartilhado com participantes do projeto
          </option>
          <option value="espaco_todo">Visível para todo o espaço</option>
        </select>
      </Field>
      {visibility !== "privado" && (
        <Field
          label="Permissão de quem recebe acesso"
          hint="Visualizar não permite alterar, excluir, publicar ou compartilhar novamente."
        >
          <select
            value={value.sharingPermission || "visualizar"}
            onChange={(e) =>
              onChange({ ...value, sharingPermission: e.target.value })
            }
          >
            <option value="visualizar">Somente visualizar</option>
            <option value="editar">Pode visualizar e editar</option>
          </select>
        </Field>
      )}
      {visibility === "pessoas" && (
        <div className="field">
          <span>Compartilhar com</span>
          {members.length === 0 ? (
            <small>Convide colaboradores em Meu Time para compartilhar.</small>
          ) : (
            <div className="checkbox-list">
              {members.map((m) => (
                <label key={m.id} className="cost-check">
                  <input
                    type="checkbox"
                    checked={(value.sharedWith || []).includes(m.id)}
                    onChange={() => togglePerson(m.id)}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {visibility === "equipe" && (
        <div className="field">
          <span>Equipe</span>
          {(teams || []).length === 0 ? (
            <small>Nenhuma equipe criada ainda. Crie uma em Meu Time.</small>
          ) : (
            <div className="checkbox-list">
              {teams.map((t) => (
                <label key={t.id} className="cost-check">
                  <input
                    type="checkbox"
                    checked={(value.sharedTeams || []).includes(t.id)}
                    onChange={() => toggleTeam(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {visibility === "projeto" && !hideProjectField && (
        <Field
          label="Projeto"
          hint="Quem participa de tarefas com o mesmo nome de projeto também verá este item."
        >
          <input
            list={
              projectOptions?.length ? "sharing-project-options" : undefined
            }
            value={value.project || ""}
            onChange={(e) => onChange({ ...value, project: e.target.value })}
            placeholder="Nome do projeto"
          />
        </Field>
      )}
      {visibility === "projeto" && hideProjectField && (
        <div className="field">
          <small>
            Use o campo Projeto acima — quem participa de outras tarefas com o
            mesmo nome também verá este item.
          </small>
        </div>
      )}
      {!hideProjectField && projectOptions?.length > 0 && (
        <datalist id="sharing-project-options">
          {projectOptions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </>
  );
}
