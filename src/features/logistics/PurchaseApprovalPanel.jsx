import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

// Editor da régua de alçadas de compras (versionada por espaço; API em
// /api/todogreen/purchasing-params). Editar é escolher, POR FAIXA DE VALOR, quem
// aprova — entre papéis conhecidos, não permissão livre. O servidor é a
// autoridade: re-valida tudo antes de gravar; aqui a validação é só cortesia.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Casa com PURCHASE_APPROVAL_STEP_PERMISSIONS do servidor.
const CATALOGO = [
  { id: "gestor", label: "Gestor / Suprimentos", permission: "purchase:manage" },
  { id: "financeiro", label: "Financeiro", permission: "finance:manage" },
  { id: "head", label: "Head / Liderança", permission: "deal:approve" },
  { id: "diretoria", label: "Diretoria", ownerOnly: true },
];
const FABRICA = [
  { max: 5000, roles: ["gestor"] },
  { max: 25000, roles: ["gestor", "financeiro"] },
  { max: 100000, roles: ["gestor", "financeiro", "head"] },
  { max: null, roles: ["gestor", "financeiro", "head", "diretoria"] },
];

const papelDaEtapa = (step) =>
  CATALOGO.find((r) => (r.ownerOnly && step?.ownerOnly) || (r.permission && step?.permission === r.permission))?.id || null;

const paraEditor = (bands) => (Array.isArray(bands) ? bands : []).map((b) => ({
  max: b.max === null || b.max === undefined ? "" : String(b.max),
  roles: (Array.isArray(b.steps) ? b.steps : []).map(papelDaEtapa).filter(Boolean),
}));

const paraConfig = (linhas) => ({
  bands: linhas.map((linha) => ({
    max: linha.max === "" ? null : Number(linha.max),
    steps: CATALOGO
      .filter((r) => linha.roles.includes(r.id))
      .map((r) => (r.ownerOnly ? { id: r.id, label: r.label, ownerOnly: true } : { id: r.id, label: r.label, permission: r.permission })),
  })),
});

const pedir = async (opcoes, authHeaders) => {
  const resposta = await fetch("/api/todogreen/purchasing-params", {
    ...opcoes,
    headers: { ...(opcoes?.body ? { "content-type": "application/json" } : {}), ...(authHeaders?.() || {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível carregar as alçadas.");
  return dados;
};

export default function PurchaseApprovalPanel({ authHeaders, setToast }) {
  const [linhas, setLinhas] = useState([]);
  const [revision, setRevision] = useState(0);
  const [padrao, setPadrao] = useState(true);
  const [podeEditar, setPodeEditar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = async () => {
    setAviso("");
    try {
      const d = await pedir({}, authHeaders);
      setLinhas(paraEditor(d.bands));
      setRevision(Number(d.revision) || 0);
      setPadrao(Boolean(d.padrao));
      setPodeEditar(Boolean(d.podeEditar));
    } catch (causa) {
      setAviso(causa.message);
    } finally {
      setCarregando(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const alterarMax = (i, valor) => setLinhas((atual) => atual.map((l, idx) => (idx === i ? { ...l, max: valor } : l)));
  const alternarPapel = (i, id) => setLinhas((atual) => atual.map((l, idx) => (
    idx === i ? { ...l, roles: l.roles.includes(id) ? l.roles.filter((r) => r !== id) : [...l.roles, id] } : l
  )));
  const removerFaixa = (i) => setLinhas((atual) => atual.filter((_, idx) => idx !== i));
  const adicionarFaixa = () => setLinhas((atual) => [...atual, { max: "", roles: ["gestor"] }]);
  const restaurarFabrica = () => setLinhas(FABRICA.map((b) => ({ max: b.max === null ? "" : String(b.max), roles: [...b.roles] })));

  const salvar = async () => {
    setSalvando(true);
    setAviso("");
    try {
      const resposta = await pedir({ method: "PUT", body: JSON.stringify({ config: paraConfig(linhas), revision }) }, authHeaders);
      setLinhas(paraEditor(resposta.bands));
      setRevision(Number(resposta.revision) || 0);
      setPadrao(false);
      setToast?.("Alçadas de compras atualizadas.");
    } catch (causa) {
      setAviso(causa.message);
    } finally {
      setSalvando(false);
    }
  };

  // Cortesia (o servidor decide): toda faixa precisa de ao menos um aprovador.
  const invalido = !linhas.length || linhas.some((l) => !l.roles.length);

  return (
    <details className="tdg-panel tdg-approval-bands">
      <summary className="tdg-section-head" style={{ cursor: "pointer" }}>
        <div>
          <span className="tdg-kicker">ALÇADAS DE COMPRAS</span>
          <h2>Quem aprova até quanto {padrao ? "· padrão de fábrica" : `· versão ${revision}`}</h2>
          <p>A régua fica no servidor e é versionada. Quem pede a compra não escolhe o próprio teto.</p>
        </div>
        <ShieldCheck size={22} />
      </summary>

      {carregando ? (
        <div className="tdg-esg-carregando"><Loader2 className="girando" size={20} /> Carregando alçadas...</div>
      ) : (
        <>
          {aviso ? <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{aviso}</span></div> : null}

          <div className="tdg-approval-bands-list">
            {linhas.map((linha, i) => (
              <fieldset key={i} className="tdg-parameter-group">
                <legend>
                  {linha.max === "" ? "Acima da última faixa (sem teto)" : `Até ${brl.format(Number(linha.max) || 0)}`}
                </legend>
                <label>
                  <span>Teto (R$) — deixe vazio para a faixa sem teto</span>
                  <input
                    type="number" min="0" step="any" value={linha.max}
                    disabled={!podeEditar}
                    placeholder="sem teto"
                    onChange={(e) => alterarMax(i, e.target.value)}
                  />
                </label>
                <div className="tdg-approval-roles">
                  {CATALOGO.map((papel) => (
                    <label key={papel.id} className="tdg-check-field">
                      <input
                        type="checkbox"
                        checked={linha.roles.includes(papel.id)}
                        disabled={!podeEditar}
                        onChange={() => alternarPapel(i, papel.id)}
                      />
                      <span>{papel.label}</span>
                    </label>
                  ))}
                </div>
                {!linha.roles.length ? <small className="tdg-alert-inline">Escolha ao menos um aprovador.</small> : null}
                {podeEditar && linhas.length > 1 ? (
                  <button type="button" className="tdg-btn-ghost" onClick={() => removerFaixa(i)}>
                    <Trash2 size={15} /> Remover faixa
                  </button>
                ) : null}
              </fieldset>
            ))}
          </div>

          {podeEditar ? (
            <div className="tdg-page-actions">
              <button type="button" className="tdg-btn-ghost" onClick={adicionarFaixa}><Plus size={15} /> Adicionar faixa</button>
              <button type="button" className="tdg-btn-ghost" onClick={restaurarFabrica}>Restaurar padrão de fábrica</button>
              <button type="button" className="tdg-action" disabled={salvando || invalido} onClick={salvar}>
                {salvando ? "Salvando..." : "Ativar nova versão"}
              </button>
            </div>
          ) : (
            <p className="tdg-esg-nota">Seu papel consulta as alçadas, mas não as altera.</p>
          )}
        </>
      )}
    </details>
  );
}
