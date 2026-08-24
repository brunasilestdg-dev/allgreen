import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Columns3,
  GitBranch,
  Link2,
  Plus,
  ShieldAlert,
  Trash2,
  UsersRound,
} from "lucide-react";
import { projectMetrics } from "../projects/projectDomain.js";
import ProjectPortfolioViews from "./ProjectPortfolioViews.jsx";
import {
  RACI_ROLES,
  RISK_SCALE,
  criticalChain,
  delayCauses,
  executiveSummary,
  makeProjectLink,
  makeRaciEntry,
  makeRisk,
  openRisks,
  portfolioSchedule,
  projectHealth,
  propagateDelay,
  raciLoad,
  redundantWork,
  riskLevel,
  riskMatrix,
  topRisks,
  untreatedRisks,
  validateRaci,
} from "./portfolioDomain.js";

const newId = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const hoje = () => new Date().toISOString().slice(0, 10);
const br = (d) => (d ? d.split("-").reverse().join("/") : "—");

export default function PortfolioBoard({ db, update, business, setToast }) {
  const [aba, setAba] = useState("visao");
  const [simulacao, setSimulacao] = useState({ projectId: "", days: 7 });
  const [novoVinculo, setNovoVinculo] = useState({ fromId: "", toId: "", lagDays: 0 });
  const [novoRisco, setNovoRisco] = useState({
    title: "",
    projectId: "",
    probability: 3,
    impact: 3,
    ownerName: "",
    plan: "",
  });
  const [novaRaci, setNovaRaci] = useState({ activity: "", projectId: "" });

  const businessId = business?.id || "";
  const doNegocio = useCallback((lista) =>
    (lista || []).filter(
      (x) => !businessId || !x.businessId || x.businessId === businessId,
    ), [businessId]);

  const projetos = useMemo(() => doNegocio(db.projects), [db.projects, doNegocio]);
  const vinculos = useMemo(
    () => doNegocio(db.projectLinks),
    [db.projectLinks, doNegocio],
  );
  const riscos = useMemo(
    () => doNegocio(db.portfolioRisks),
    [db.portfolioRisks, doNegocio],
  );
  const racis = useMemo(() => doNegocio(db.raci), [db.raci, doNegocio]);
  const tarefas = useMemo(() => db.tasks || [], [db.tasks]);

  const agenda = useMemo(
    () => portfolioSchedule(projetos, vinculos),
    [projetos, vinculos],
  );
  const saudes = useMemo(
    () =>
      projetos.map((p) => ({
        project: p,
        ...projectHealth(p, projectMetrics(p, tarefas, hoje()), hoje()),
      })),
    [projetos, tarefas],
  );
  const corrente = useMemo(
    () => criticalChain(projetos, vinculos),
    [projetos, vinculos],
  );
  const resumo = useMemo(
    () =>
      executiveSummary({
        projects: projetos,
        healths: saudes,
        risks: riscos,
        links: vinculos,
        hoje: hoje(),
      }),
    [projetos, saudes, riscos, vinculos],
  );
  const causas = useMemo(
    () => delayCauses(projetos, tarefas, vinculos, hoje()),
    [projetos, tarefas, vinculos],
  );
  const repetido = useMemo(
    () => redundantWork(projetos, tarefas),
    [projetos, tarefas],
  );
  const efeito = useMemo(
    () =>
      simulacao.projectId
        ? propagateDelay(projetos, vinculos, simulacao.projectId, simulacao.days)
        : [],
    [projetos, vinculos, simulacao],
  );
  const matriz = useMemo(() => riskMatrix(riscos), [riscos]);
  const semTratar = useMemo(() => untreatedRisks(riscos), [riscos]);
  const cargaRaci = useMemo(() => raciLoad(racis), [racis]);

  const idCorrente = new Set(corrente.map((p) => p.id));

  const addVinculo = () => {
    const { fromId, toId } = novoVinculo;
    if (!fromId || !toId) return;
    if (fromId === toId) {
      setToast?.("Um projeto não pode depender de si mesmo.");
      return;
    }
    const novo = makeProjectLink(newId("pl"), {
      ...novoVinculo,
      businessId: business?.id || "",
    });
    const proximos = [...(db.projectLinks || []), novo];
    const teste = portfolioSchedule(projetos, [...vinculos, novo]);
    if (teste.cycles.length) {
      setToast?.(
        "Essa ligação cria um círculo: um projeto passaria a esperar o outro em roda. Não dá para calcular data assim.",
      );
      return;
    }
    update({ ...db, projectLinks: proximos });
    setNovoVinculo({ fromId: "", toId: "", lagDays: 0 });
  };

  const removerVinculo = (id) =>
    update({ ...db, projectLinks: (db.projectLinks || []).filter((l) => l.id !== id) });

  const addRisco = () => {
    if (!novoRisco.title.trim()) return;
    update({
      ...db,
      portfolioRisks: [
        ...(db.portfolioRisks || []),
        makeRisk(newId("rk"), { ...novoRisco, businessId: business?.id || "" }),
      ],
    });
    setNovoRisco({
      title: "",
      projectId: "",
      probability: 3,
      impact: 3,
      ownerName: "",
      plan: "",
    });
  };

  const encerrarRisco = (id) =>
    update({
      ...db,
      portfolioRisks: (db.portfolioRisks || []).map((r) =>
        r.id === id ? { ...r, status: "encerrado" } : r,
      ),
    });

  const addRaci = () => {
    if (!novaRaci.activity.trim()) return;
    update({
      ...db,
      raci: [
        ...(db.raci || []),
        makeRaciEntry(newId("ra"), { ...novaRaci, businessId: business?.id || "" }),
      ],
    });
    setNovaRaci({ activity: "", projectId: "" });
  };

  const setPapel = (entryId, pessoa, papel) => {
    const nome = pessoa.trim();
    if (!nome) return;
    update({
      ...db,
      raci: (db.raci || []).map((e) =>
        e.id === entryId
          ? {
              ...e,
              assignments: papel
                ? { ...e.assignments, [nome]: papel }
                : Object.fromEntries(
                    Object.entries(e.assignments).filter(([n]) => n !== nome),
                  ),
            }
          : e,
      ),
    });
  };

  const pessoas = useMemo(() => {
    const nomes = new Set();
    for (const m of db.teamMembers || []) if (m.name) nomes.add(m.name);
    for (const e of racis) for (const n of Object.keys(e.assignments || {})) nomes.add(n);
    for (const p of projetos) {
      if (p.manager) nomes.add(p.manager);
      if (p.sponsor) nomes.add(p.sponsor);
    }
    return [...nomes].sort();
  }, [db.teamMembers, racis, projetos]);

  const abas = [
    ["projetos", "Projetos", Columns3],
    ["visao", "Visão geral", GitBranch],
    ["dependencias", "Dependências", Link2],
    ["riscos", "Riscos", ShieldAlert],
    ["raci", "Quem responde", UsersRound],
  ];

  return (
    <section className="section pf">
      <header className="section-head">
        <div>
          <h2>Portfólio de projetos</h2>
          <p className="muted">
            Projetos de qualquer área, com visão operacional e executiva no mesmo portfólio.
          </p>
        </div>
      </header>

      <div className="pf-tabs" role="tablist">
        {abas.map(([id, rotulo, Icone]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? "active" : ""}
            onClick={() => setAba(id)}
          >
            <Icone size={15} /> {rotulo}
          </button>
        ))}
      </div>

      {aba === "projetos" && (
        <ProjectPortfolioViews db={db} update={update} business={business} />
      )}

      {!projetos.length && aba !== "projetos" && (
        <p className="muted">
          Nenhum projeto cadastrado ainda. Projetos podem pertencer a qualquer área do negócio.
        </p>
      )}

      {aba === "visao" && projetos.length > 0 && (
        <>
          <div className="pf-summary">
            {resumo.map((linha, i) => (
              <p key={i}>{linha}</p>
            ))}
          </div>

          {agenda.cycles.length > 0 && (
            <div className="pf-alert">
              <AlertTriangle size={16} />
              <span>
                Há dependência em círculo entre projetos. Enquanto isso existir, as
                datas calculadas ficam sendo as que você cadastrou, sem ajuste.
              </span>
            </div>
          )}

          <table className="pf-table">
            <thead>
              <tr>
                <th>Projeto</th>
                <th>Situação</th>
                <th>Começa</th>
                <th>Termina</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {agenda.rows.map((r) => {
                const s = saudes.find((x) => x.project.id === r.project.id);
                return (
                  <tr
                    key={r.project.id}
                    className={idCorrente.has(r.project.id) ? "critico" : ""}
                  >
                    <td>
                      {r.project.name}
                      {idCorrente.has(r.project.id) && (
                        <span className="pf-chip">define a data final</span>
                      )}
                    </td>
                    <td>
                      <span className={`pf-health ${s?.level}`}>{s?.label}</span>
                    </td>
                    <td>{br(r.start)}</td>
                    <td>{br(r.end)}</td>
                    <td className="muted">
                      {r.pushedBy
                        ? `esperou "${r.pushedBy.name}" — ${r.pushedDays} dia(s)`
                        : s?.reasons?.[0] || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {agenda.endDate && (
            <p className="muted">
              Com as dependências de hoje, a última entrega do portfólio cai em{" "}
              <strong>{br(agenda.endDate)}</strong>.
            </p>
          )}

          <section className="pf-block">
            <h3>E se um projeto atrasar?</h3>
            <div className="pf-form">
              <label>
                Projeto
                <select
                  aria-label="Projeto que vai atrasar"
                  value={simulacao.projectId}
                  onChange={(e) =>
                    setSimulacao((s) => ({ ...s, projectId: e.target.value }))
                  }
                >
                  <option value="">Escolha</option>
                  {projetos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Dias de atraso
                <input
                  aria-label="Dias de atraso"
                  type="number"
                  min="0"
                  value={simulacao.days}
                  onChange={(e) =>
                    setSimulacao((s) => ({ ...s, days: Number(e.target.value) }))
                  }
                />
              </label>
            </div>
            {simulacao.projectId && !efeito.length && (
              <p className="muted">
                Nenhum outro projeto depende desse. O atraso não espalha.
              </p>
            )}
            {efeito.length > 0 && (
              <ul className="pf-effect">
                {efeito.map((e) => (
                  <li key={e.project.id}>
                    <strong>{e.project.name}</strong> atrasa {e.days} dia(s)
                    {e.newDue && <> — novo prazo {br(e.newDue)}</>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {causas.length > 0 && (
            <section className="pf-block">
              <h3>Por que atrasou</h3>
              <ul className="pf-causes">
                {causas.map((c) => (
                  <li key={c.project.id}>
                    <strong>{c.project.name}</strong> — {c.lateDays} dia(s) além do
                    prazo:{" "}
                    {c.causes.map((x) => x.message).join("; ")}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {repetido.length > 0 && (
            <section className="pf-block">
              <h3>Talvez esteja sendo feito duas vezes</h3>
              <ul className="pf-causes">
                {repetido.map((r, i) => (
                  <li key={i}>
                    <strong>{r.title}</strong> aparece em{" "}
                    {r.projects.map((p) => p.name).join(" e ")}.
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {aba === "dependencias" && (
        <>
          <p className="muted">
            “B depende de A” quer dizer que B só começa depois que A termina. Se A
            escorregar, B escorrega junto.
          </p>
          <div className="pf-form">
            <label>
              Este projeto
              <select
                aria-label="Projeto que vem antes"
                value={novoVinculo.fromId}
                onChange={(e) =>
                  setNovoVinculo((v) => ({ ...v, fromId: e.target.value }))
                }
              >
                <option value="">Escolha</option>
                {projetos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              precisa terminar antes de
              <select
                aria-label="Projeto que vem depois"
                value={novoVinculo.toId}
                onChange={(e) =>
                  setNovoVinculo((v) => ({ ...v, toId: e.target.value }))
                }
              >
                <option value="">Escolha</option>
                {projetos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Folga (dias)
              <input
                aria-label="Folga em dias"
                type="number"
                min="0"
                value={novoVinculo.lagDays}
                onChange={(e) =>
                  setNovoVinculo((v) => ({ ...v, lagDays: Number(e.target.value) }))
                }
              />
            </label>
            <button type="button" className="btn primary" onClick={addVinculo}>
              <Plus size={15} /> Ligar
            </button>
          </div>

          {!vinculos.length && (
            <p className="muted">Nenhuma dependência entre projetos ainda.</p>
          )}
          <ul className="pf-links">
            {vinculos.map((l) => {
              const de = projetos.find((p) => p.id === l.fromId);
              const para = projetos.find((p) => p.id === l.toId);
              return (
                <li key={l.id}>
                  <span>
                    <strong>{para?.name || "—"}</strong> só começa depois de{" "}
                    <strong>{de?.name || "—"}</strong>
                    {l.lagDays > 0 && <> (+{l.lagDays} dia(s) de folga)</>}
                  </span>
                  <button
                    type="button"
                    className="btn tiny"
                    aria-label={`Remover dependência de ${para?.name}`}
                    onClick={() => removerVinculo(l.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {aba === "riscos" && (
        <>
          <div className="pf-form">
            <label>
              Risco
              <input
                aria-label="Nome do risco"
                value={novoRisco.title}
                onChange={(e) =>
                  setNovoRisco((r) => ({ ...r, title: e.target.value }))
                }
                placeholder="Fornecedor atrasar a entrega"
              />
            </label>
            <label>
              Chance
              <select
                aria-label="Chance de acontecer"
                value={novoRisco.probability}
                onChange={(e) =>
                  setNovoRisco((r) => ({ ...r, probability: Number(e.target.value) }))
                }
              >
                {RISK_SCALE.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Impacto
              <select
                aria-label="Impacto se acontecer"
                value={novoRisco.impact}
                onChange={(e) =>
                  setNovoRisco((r) => ({ ...r, impact: Number(e.target.value) }))
                }
              >
                {RISK_SCALE.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Quem cuida
              <input
                aria-label="Quem cuida do risco"
                value={novoRisco.ownerName}
                onChange={(e) =>
                  setNovoRisco((r) => ({ ...r, ownerName: e.target.value }))
                }
              />
            </label>
            <label>
              O que fazer
              <input
                aria-label="Plano para o risco"
                value={novoRisco.plan}
                onChange={(e) => setNovoRisco((r) => ({ ...r, plan: e.target.value }))}
              />
            </label>
            <button type="button" className="btn primary" onClick={addRisco}>
              <Plus size={15} /> Registrar
            </button>
          </div>

          {semTratar.length > 0 && (
            <div className="pf-alert">
              <AlertTriangle size={16} />
              <span>
                {semTratar.length} risco(s) grave(s) sem dono ou sem plano. Risco
                registrado e esquecido continua sendo risco.
              </span>
            </div>
          )}

          {openRisks(riscos).length > 0 && (
            <>
              <h3>Onde os riscos estão</h3>
              <table className="pf-matrix">
                <tbody>
                  {matriz.map((linha, i) => (
                    <tr key={i}>
                      <th scope="row">{RISK_SCALE[4 - i].label}</th>
                      {linha.map((qtd, j) => (
                        <td key={j} className={qtd ? "tem" : ""}>
                          {qtd || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td />
                    {RISK_SCALE.map((s) => (
                      <th key={s.id} scope="col">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="muted">
                De cima para baixo, a chance de acontecer. Da esquerda para a
                direita, o tamanho do estrago.
              </p>
            </>
          )}

          <h3>Mais pesados agora</h3>
          {!openRisks(riscos).length && (
            <p className="muted">Nenhum risco em aberto.</p>
          )}
          <ul className="pf-risks">
            {topRisks(riscos, 20).map((r) => {
              const n = riskLevel(r);
              return (
                <li key={r.id}>
                  <span className={`pf-risk-level ${n.id}`}>{n.label}</span>
                  <div>
                    <strong>{r.title}</strong>
                    <p className="muted">
                      {r.ownerName ? `cuida: ${r.ownerName}` : "sem dono"} ·{" "}
                      {r.plan || "sem plano definido"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => encerrarRisco(r.id)}
                  >
                    Encerrar
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {aba === "raci" && (
        <>
          <p className="muted">
            Para cada atividade: quem <strong>faz</strong>, quem{" "}
            <strong>responde</strong> (uma pessoa só), quem é consultado e quem é
            informado.
          </p>
          <div className="pf-form">
            <label>
              Atividade
              <input
                aria-label="Nome da atividade"
                value={novaRaci.activity}
                onChange={(e) =>
                  setNovaRaci((r) => ({ ...r, activity: e.target.value }))
                }
                placeholder="Aprovar o orçamento final"
              />
            </label>
            <button type="button" className="btn primary" onClick={addRaci}>
              <Plus size={15} /> Adicionar
            </button>
          </div>

          {!racis.length && <p className="muted">Nenhuma atividade definida ainda.</p>}

          {racis.map((e) => {
            const v = validateRaci(e);
            return (
              <div key={e.id} className="pf-raci">
                <h4>{e.activity}</h4>
                {!v.ok && (
                  <ul className="pf-raci-problems">
                    {v.problems.map((p, i) => (
                      <li key={i}>{p.message}</li>
                    ))}
                  </ul>
                )}
                <div className="pf-raci-people">
                  {pessoas.map((pessoa) => (
                    <label key={pessoa}>
                      <span>{pessoa}</span>
                      <select
                        aria-label={`Papel de ${pessoa} em ${e.activity}`}
                        value={e.assignments?.[pessoa] || ""}
                        onChange={(ev) => setPapel(e.id, pessoa, ev.target.value)}
                      >
                        <option value="">—</option>
                        {RACI_ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {!pessoas.length && (
                    <p className="muted">
                      Cadastre pessoas em “Meu Time” ou defina responsável nos
                      projetos para poder distribuir os papéis.
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {cargaRaci.length > 0 && (
            <section className="pf-block">
              <h3>Quem está respondendo por mais coisa</h3>
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Responde</th>
                    <th>Faz</th>
                    <th>É consultado</th>
                  </tr>
                </thead>
                <tbody>
                  {cargaRaci.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{c.A}</td>
                      <td>{c.R}</td>
                      <td>{c.C}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </section>
  );
}
