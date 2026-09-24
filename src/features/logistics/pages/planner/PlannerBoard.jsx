import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { separarConcluidas } from "../../plannerDomain.js";
import PlannerCard from "./PlannerCard.jsx";
import { TINTAS_COLUNA } from "./plannerUi.jsx";

// O quadro: uma coluna por grupo (balde, progresso ou responsável). Arrastar um
// cartão para outra coluna chama `onMover(tarefaId, coluna)` — quem decide o
// que muda (balde, status ou responsável) é a página, porque só ela conhece o
// corte ativo e grava na tarefa canônica. Baldes têm "+ Adicionar tarefa" no
// topo e um menu para renomear/mover/excluir (só para quem pode editar o
// plano). Concluídas ficam dobradas no fim da coluna, como "Concluída (28)".
export default function PlannerBoard({
  colunas,
  corte,
  hojeRef,
  souDono,
  onAbrir,
  onConcluir,
  onMover,
  onAdicionarRapida,
  onAdicionarBalde,
  onRenomearBalde,
  onRemoverBalde,
  onMoverBalde,
}) {
  const [arrastando, setArrastando] = useState(null);
  const [sobre, setSobre] = useState(null);
  const [dobras, setDobras] = useState({});
  const [rascunho, setRascunho] = useState({});
  const [editando, setEditando] = useState(null);
  const [menu, setMenu] = useState(null);
  const [novoBalde, setNovoBalde] = useState(null);

  // Menu de balde fecha ao clicar fora — e ao trocar de plano (colunas mudam).
  useEffect(() => {
    if (!menu) return undefined;
    const fechar = (e) => { if (!e.target.closest?.(".plr-menu-ancora")) setMenu(null); };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [menu]);

  const porBalde = corte === "balde";
  const podeSoltar = (coluna) => !porBalde || coluna.chave !== "__sem__";
  const colunasDeBalde = colunas.filter((c) => c.chave !== "__sem__").length;
  const dobrar = corte !== "progresso";

  const enviarRapida = (chave) => {
    const titulo = (rascunho[chave] || "").trim();
    if (titulo) onAdicionarRapida(chave, titulo);
    setRascunho((r) => ({ ...r, [chave]: titulo ? "" : undefined }));
  };

  const confirmarRenome = () => {
    if (editando?.nome?.trim()) onRenomearBalde(editando.chave, editando.nome.trim());
    setEditando(null);
  };

  const confirmarNovoBalde = () => {
    const nome = (novoBalde || "").trim();
    if (nome) onAdicionarBalde(nome);
    setNovoBalde(null);
  };

  const cartao = (t) => (
    <PlannerCard
      key={t.id}
      tarefa={t}
      hojeRef={hojeRef}
      onAbrir={onAbrir}
      onConcluir={onConcluir}
      arrastando={arrastando === t.id}
      onDragStart={() => setArrastando(t.id)}
      onDragEnd={() => { setArrastando(null); setSobre(null); }}
    />
  );

  return (
    <div className="plr-board" aria-label="Quadro de tarefas">
      {colunas.map((coluna, idx) => {
        const { abertas, concluidas } = dobrar ? separarConcluidas(coluna.tarefas) : { abertas: coluna.tarefas, concluidas: [] };
        const editavel = porBalde && souDono && coluna.chave !== "__sem__";
        const dobraAberta = Boolean(dobras[coluna.chave]);
        return (
          /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
          <section
            key={coluna.chave}
            className={`plr-col${sobre === coluna.chave ? " is-sobre" : ""}`}
            style={{ "--plr-tinta": TINTAS_COLUNA[idx % TINTAS_COLUNA.length] }}
            aria-label={coluna.titulo}
            data-coluna={coluna.chave}
            onDragOver={(e) => { if (!arrastando || !podeSoltar(coluna)) return; e.preventDefault(); if (sobre !== coluna.chave) setSobre(coluna.chave); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSobre((s) => (s === coluna.chave ? null : s)); }}
            onDrop={(e) => {
              e.preventDefault();
              const id = arrastando;
              setArrastando(null);
              setSobre(null);
              if (id && podeSoltar(coluna)) onMover(id, coluna);
            }}
          >
            <header className="plr-col-cabecalho">
              {editando?.chave === coluna.chave ? (
                <form className="plr-col-renome" onSubmit={(e) => { e.preventDefault(); confirmarRenome(); }}>
                  <input
                    autoFocus
                    aria-label="Nome do balde"
                    value={editando.nome}
                    maxLength={80}
                    onChange={(e) => setEditando((ed) => ({ ...ed, nome: e.target.value }))}
                    onBlur={confirmarRenome}
                    onKeyDown={(e) => { if (e.key === "Escape") setEditando(null); }}
                  />
                </form>
              ) : (
                <h3 title={coluna.titulo}>{coluna.titulo}</h3>
              )}
              <span className="plr-col-contagem" aria-label={`${coluna.tarefas.length} tarefas`}>{coluna.tarefas.length}</span>
              {editavel && (
                <div className="plr-menu-ancora">
                  <button
                    type="button"
                    className="plr-icone"
                    aria-label={`Opções do balde ${coluna.titulo}`}
                    aria-haspopup="menu"
                    aria-expanded={menu === coluna.chave}
                    onClick={() => setMenu((m) => (m === coluna.chave ? null : coluna.chave))}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menu === coluna.chave && (
                    <div className="plr-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenu(null); setEditando({ chave: coluna.chave, nome: coluna.titulo }); }}>
                        <Pencil size={14} /> Renomear
                      </button>
                      <button type="button" role="menuitem" disabled={idx === 0} onClick={() => { setMenu(null); onMoverBalde(coluna.chave, -1); }}>
                        <ArrowLeft size={14} /> Mover para a esquerda
                      </button>
                      <button type="button" role="menuitem" disabled={idx >= colunasDeBalde - 1} onClick={() => { setMenu(null); onMoverBalde(coluna.chave, 1); }}>
                        <ArrowRight size={14} /> Mover para a direita
                      </button>
                      <button type="button" role="menuitem" className="is-perigo" disabled={colunasDeBalde <= 1} onClick={() => { setMenu(null); onRemoverBalde(coluna); }}>
                        <Trash2 size={14} /> Excluir balde
                      </button>
                    </div>
                  )}
                </div>
              )}
            </header>

            <div className="plr-col-corpo">
              {porBalde && onAdicionarRapida && coluna.chave !== "__sem__" && (
                rascunho[coluna.chave] !== undefined ? (
                  <form className="plr-rapida" onSubmit={(e) => { e.preventDefault(); enviarRapida(coluna.chave); }}>
                    <input
                      autoFocus
                      aria-label={`Nova tarefa em ${coluna.titulo}`}
                      placeholder="Digite um nome de tarefa"
                      maxLength={200}
                      value={rascunho[coluna.chave]}
                      onChange={(e) => setRascunho((r) => ({ ...r, [coluna.chave]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Escape") setRascunho((r) => ({ ...r, [coluna.chave]: undefined })); }}
                    />
                    <div className="plr-rapida-acoes">
                      <button type="submit" className="tdg-action">Adicionar tarefa</button>
                      <button type="button" className="plr-botao-suave" onClick={() => setRascunho((r) => ({ ...r, [coluna.chave]: undefined }))}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="plr-adicionar" onClick={() => setRascunho((r) => ({ ...r, [coluna.chave]: "" }))}>
                    <Plus size={15} /> Adicionar tarefa
                  </button>
                )
              )}

              {abertas.map(cartao)}

              {abertas.length === 0 && concluidas.length === 0 && (
                <p className="plr-col-vazia">{porBalde ? "Arraste tarefas para aqui ou adicione uma nova." : "Sem tarefas."}</p>
              )}

              {concluidas.length > 0 && (
                <div className="plr-dobra">
                  <button
                    type="button"
                    className="plr-dobra-botao"
                    aria-expanded={dobraAberta}
                    onClick={() => setDobras((d) => ({ ...d, [coluna.chave]: !dobraAberta }))}
                  >
                    <ChevronDown size={15} className={dobraAberta ? "is-aberta" : ""} />
                    Concluída
                    <span>{concluidas.length}</span>
                  </button>
                  {dobraAberta && concluidas.map(cartao)}
                </div>
              )}
            </div>
          </section>
        );
      })}

      {porBalde && souDono && (
        <section className="plr-col plr-col--nova" aria-label="Adicionar balde">
          {novoBalde === null ? (
            <button type="button" className="plr-novo-balde" onClick={() => setNovoBalde("")}>
              <Plus size={16} /> Adicionar balde
            </button>
          ) : (
            <form className="plr-rapida" onSubmit={(e) => { e.preventDefault(); confirmarNovoBalde(); }}>
              <input
                autoFocus
                aria-label="Nome do novo balde"
                placeholder="Nome do balde"
                maxLength={80}
                value={novoBalde}
                onChange={(e) => setNovoBalde(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setNovoBalde(null); }}
              />
              <div className="plr-rapida-acoes">
                <button type="submit" className="tdg-action">Adicionar balde</button>
                <button type="button" className="plr-botao-suave" onClick={() => setNovoBalde(null)}>Cancelar</button>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
