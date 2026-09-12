import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, LifeBuoy, User, Wallet } from "lucide-react";
import "./TodoGreenPages.css";
import { TIPOS_CHAVE_PIX, rotuloTipoPix } from "../pixDomain.js";
import { rotuloStatusNotaPj, conferirNota } from "../pjInvoiceDomain.js";
import { CATEGORIAS_CHAMADO, rotuloStatusChamado, rotuloCategoriaChamado } from "../employeeTicketDomain.js";

// ===== Portal do Colaborador (PJ e CLT) =====
//
// A pessoa abre no próprio aparelho. A sessão resolve QUEM é pelo e-mail do
// cadastro (todogreen_employees) e entrega só os dados dela. PJ informa a chave
// PIX e imputa a nota fiscal (conferida contra o valor esperado); CLT vê os
// próprios dados e, se houver divergência, abre um chamado (o RH cadastra o
// banco). Nada aqui mostra dado de outra pessoa.

const authHeaders = () => {
  try {
    const token = localStorage.getItem("seu-funcionario-auth-token") || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};

const pedir = async (caminho, options = {}) => {
  const resposta = await fetch(`/api/todogreen/employee-portal${caminho}`, {
    ...options,
    headers: { "content-type": "application/json", ...authHeaders(), ...(options.headers || {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.error || "Não foi possível concluir.");
  return dados;
};

const reais = (v) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ColaboradorPortalPage() {
  const [sessao, setSessao] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Chave PIX (PJ)
  const [pixTipo, setPixTipo] = useState("");
  const [pixChave, setPixChave] = useState("");
  const [pixTocado, setPixTocado] = useState(false);
  const [salvandoPix, setSalvandoPix] = useState(false);

  // Nota fiscal (PJ)
  const [nfNumero, setNfNumero] = useState("");
  const [nfCompetencia, setNfCompetencia] = useState("");
  const [nfValor, setNfValor] = useState("");
  const [nfAnexo, setNfAnexo] = useState("");
  const [enviandoNota, setEnviandoNota] = useState(false);

  // Chamado (CLT e PJ): reportar divergência nos próprios dados.
  const [chCategoria, setChCategoria] = useState("dados_cadastrais");
  const [chAssunto, setChAssunto] = useState("");
  const [chDescricao, setChDescricao] = useState("");
  const [abrindoChamado, setAbrindoChamado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setSessao(await pedir("/sessao"));
      setErro("");
    } catch (motivo) {
      setErro(motivo.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Herda a chave PIX já informada até a pessoa começar a editar.
  const pixSessaoTipo = sessao?.colaborador?.pix?.tipo || "";
  const pixSessaoChave = sessao?.colaborador?.pix?.chave || "";
  useEffect(() => {
    if (pixTocado) return;
    setPixTipo(pixSessaoTipo);
    setPixChave(pixSessaoChave);
  }, [pixSessaoTipo, pixSessaoChave, pixTocado]);

  const salvarPix = async () => {
    if (!pixTipo) { setAviso("Escolha o tipo da chave PIX."); return; }
    if (!pixChave.trim()) { setAviso("Informe a chave PIX."); return; }
    setSalvandoPix(true);
    try {
      const d = await pedir("/pix", { method: "POST", body: JSON.stringify({ tipo: pixTipo, chave: pixChave }) });
      await carregar();
      setPixChave(d.pix?.chave || pixChave);
      setPixTocado(false);
      setAviso("Chave PIX salva. É para lá que vai o seu repasse.");
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui salvar a chave PIX.");
    } finally {
      setSalvandoPix(false);
    }
  };

  const enviarNota = async () => {
    setEnviandoNota(true);
    try {
      const d = await pedir("/nota", {
        method: "POST",
        body: JSON.stringify({
          numero: nfNumero,
          competencia: nfCompetencia,
          valor: Number(String(nfValor).replace(",", ".")),
          documentUrl: nfAnexo,
        }),
      });
      setAviso(d.reenviada ? "Nota reenviada para análise." : "Nota enviada para análise.");
      setNfNumero(""); setNfValor(""); setNfAnexo("");
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui enviar a nota.");
    } finally {
      setEnviandoNota(false);
    }
  };

  const abrirChamado = async () => {
    setAbrindoChamado(true);
    try {
      await pedir("/chamado", {
        method: "POST",
        body: JSON.stringify({ categoria: chCategoria, assunto: chAssunto, descricao: chDescricao }),
      });
      setAviso("Chamado aberto. A equipe vai analisar e responder.");
      setChAssunto(""); setChDescricao("");
      await carregar();
    } catch (motivo) {
      setAviso(motivo.message || "Não consegui abrir o chamado.");
    } finally {
      setAbrindoChamado(false);
    }
  };

  if (erro && !sessao)
    return <div className="tdg-driver-portal"><div className="tdg-driver-cartao aviso"><AlertTriangle size={18} /><p>{erro}</p></div></div>;
  if (!sessao) return <div className="tdg-driver-portal"><p className="tdg-driver-rodape-nota">Abrindo seu portal…</p></div>;

  const c = sessao.colaborador;

  if (!sessao.vinculado)
    return (
      <div className="tdg-driver-portal">
        <div className="tdg-driver-cartao aviso"><AlertTriangle size={18} /><p>{sessao.aviso}</p></div>
      </div>
    );

  const previa = nfValor
    ? conferirNota({ valor: Number(String(nfValor).replace(",", ".")), valorEsperado: c.valorEsperado })
    : null;

  return (
    <div className="tdg-driver-portal">
      <header className="tdg-colab-cabecalho">
        <div className="tdg-driver-avatar"><User size={24} /></div>
        <div>
          <strong>{c.nome}</strong>
          <small>{c.cargo || "Colaborador"} · {c.tipo === "pj" ? "Prestador PJ" : "CLT"}</small>
        </div>
      </header>

      {aviso && <div className="tdg-driver-cartao"><small>{aviso}</small></div>}

      {c.podeInformarPix ? (
        <article className="tdg-driver-cartao tdg-driver-pix">
          <div className="tdg-driver-info-linha"><Wallet size={16} /><span>Chave PIX do repasse</span></div>
          <label className="tdg-driver-pix-campo">
            <span>Tipo da chave</span>
            <select value={pixTipo} onChange={(e) => { setPixTocado(true); setPixTipo(e.target.value); }} disabled={salvandoPix}>
              <option value="">Escolha…</option>
              {(c.tiposPix || TIPOS_CHAVE_PIX).map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </select>
          </label>
          <label className="tdg-driver-pix-campo">
            <span>Chave {pixTipo ? `(${rotuloTipoPix(pixTipo)})` : ""}</span>
            <input
              type="text"
              inputMode={pixTipo === "cpf" || pixTipo === "telefone" ? "numeric" : "text"}
              autoComplete="off"
              value={pixChave}
              onChange={(e) => { setPixTocado(true); setPixChave(e.target.value); }}
              disabled={salvandoPix}
              placeholder="Informe a sua chave PIX"
            />
          </label>
          <button type="button" className="tdg-captura-btn" onClick={salvarPix} disabled={salvandoPix}>
            <Wallet size={16} /> {salvandoPix ? "Salvando…" : "Salvar minha chave PIX"}
          </button>
          <small>{c.pix?.chave ? "Sua chave está registrada. O repasse vai para ela." : "Informe a sua chave para receber o repasse."}</small>
        </article>
      ) : (
        <article className="tdg-driver-cartao">
          <div className="tdg-driver-info-linha"><Wallet size={16} /><span>Dados bancários</span></div>
          <small>Seus dados de banco/PIX são cadastrados pelo RH. Se houver divergência, abra um chamado abaixo — a equipe corrige.</small>
        </article>
      )}

      {c.podeImputarNota && (
        <>
          <article className="tdg-driver-cartao tdg-colab-nota">
            <div className="tdg-driver-info-linha"><FileText size={16} /><span>Enviar nota fiscal</span></div>
            <small>Valor esperado do mês: <b>{reais(c.valorEsperado)}</b> (o financeiro pode ajustar se você entrou no meio do mês).</small>
            <label className="tdg-driver-pix-campo">
              <span>Competência (mês)</span>
              <input type="month" value={nfCompetencia} onChange={(e) => setNfCompetencia(e.target.value)} disabled={enviandoNota} />
            </label>
            <label className="tdg-driver-pix-campo">
              <span>Número da nota</span>
              <input type="text" value={nfNumero} onChange={(e) => setNfNumero(e.target.value)} disabled={enviandoNota} placeholder="Nº da NF" />
            </label>
            <label className="tdg-driver-pix-campo">
              <span>Valor da nota</span>
              <input type="text" inputMode="decimal" value={nfValor} onChange={(e) => setNfValor(e.target.value)} disabled={enviandoNota} placeholder="0,00" />
            </label>
            <label className="tdg-driver-pix-campo">
              <span>Link do anexo (PDF/XML) — opcional</span>
              <input type="url" value={nfAnexo} onChange={(e) => setNfAnexo(e.target.value)} disabled={enviandoNota} placeholder="https://…" />
            </label>
            {previa && (
              <small className={`tdg-colab-confere ${previa.situacao}`}>
                {previa.confere
                  ? "Valor bate com o esperado."
                  : `${previa.situacao === "acima" ? "Acima" : "Abaixo"} do esperado em ${reais(Math.abs(previa.diferenca))} — o financeiro vai conferir.`}
              </small>
            )}
            <button type="button" className="tdg-captura-btn" onClick={enviarNota} disabled={enviandoNota}>
              <FileText size={16} /> {enviandoNota ? "Enviando…" : "Enviar nota para análise"}
            </button>
          </article>

          <article className="tdg-driver-cartao">
            <div className="tdg-driver-info-linha"><CheckCircle2 size={16} /><span>Minhas notas</span></div>
            {sessao.notas.length === 0
              ? <small>Você ainda não enviou nenhuma nota.</small>
              : (
                <ul className="tdg-colab-notas">
                  {sessao.notas.map((nota) => (
                    <li key={nota.id}>
                      <div>
                        <b>{nota.competencia}</b> · NF {nota.numero || "—"}
                        <span className={`tdg-colab-status ${nota.status}`}>{rotuloStatusNotaPj(nota.status)}</span>
                      </div>
                      <div className="tdg-colab-notas-valor">
                        {reais(nota.valor)}
                        {!nota.confere && <em> (esperado {reais(nota.valorEsperado)})</em>}
                      </div>
                      {nota.status === "recusada" && nota.note && <small className="tdg-driver-cnh-alerta">{nota.note}</small>}
                    </li>
                  ))}
                </ul>
              )}
          </article>
        </>
      )}

      <article className="tdg-driver-cartao tdg-colab-nota">
        <div className="tdg-driver-info-linha"><LifeBuoy size={16} /><span>Abrir chamado</span></div>
        <small>Viu algo errado nos seus dados? Abra um chamado — a equipe corrige (você não edita direto).</small>
        <label className="tdg-driver-pix-campo">
          <span>Categoria</span>
          <select value={chCategoria} onChange={(e) => setChCategoria(e.target.value)} disabled={abrindoChamado}>
            {CATEGORIAS_CHAMADO.map((cat) => <option key={cat.id} value={cat.id}>{cat.rotulo}</option>)}
          </select>
        </label>
        <label className="tdg-driver-pix-campo">
          <span>Assunto</span>
          <input type="text" value={chAssunto} onChange={(e) => setChAssunto(e.target.value)} disabled={abrindoChamado} placeholder="Ex.: minha chave PIX está errada" />
        </label>
        <label className="tdg-driver-pix-campo">
          <span>Descrição</span>
          <textarea rows={3} value={chDescricao} onChange={(e) => setChDescricao(e.target.value)} disabled={abrindoChamado} placeholder="Diga o que está divergente e o dado correto." />
        </label>
        <button type="button" className="tdg-captura-btn" onClick={abrirChamado} disabled={abrindoChamado}>
          <LifeBuoy size={16} /> {abrindoChamado ? "Abrindo…" : "Abrir chamado"}
        </button>
        {sessao.chamados?.length > 0 && (
          <ul className="tdg-colab-notas">
            {sessao.chamados.map((ch) => (
              <li key={ch.id}>
                <div>
                  <b>{rotuloCategoriaChamado(ch.categoria)}</b> · {ch.assunto}
                  <span className={`tdg-colab-status ${ch.status}`}>{rotuloStatusChamado(ch.status)}</span>
                </div>
                {ch.resposta && <small>Resposta: {ch.resposta}</small>}
              </li>
            ))}
          </ul>
        )}
      </article>

      <p className="tdg-driver-rodape-nota">
        {c.tipo === "pj"
          ? "Envie a nota do mês e mantenha sua chave PIX em dia — o repasse é feito para a chave que você informar."
          : "Este portal mostra os seus dados. Alterações de cadastro passam pelo RH."}
      </p>
    </div>
  );
}
