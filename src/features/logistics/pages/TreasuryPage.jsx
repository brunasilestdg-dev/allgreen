import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, FileUp, Landmark, Link2, Lock, Plus, Unlock } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { parseOfxTransactions } from "../../../domain/importacoes.js";
import { previsaoSemanalDeCaixa } from "../contasPonteDomain.js";
import "./TodoGreenPages.css";

// ===== Tesouraria =====
//
// O backend inteiro (extrato, conciliação, saldo, cobrança, fechamento,
// resultado) existia em todogreen-treasury.js, testado — e NENHUMA tela o
// chamava. Esta página é a porta. O saldo é derivado (inicial + conciliado),
// nunca digitado; linha de extrato não se edita — é o que o banco disse.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dinheiro = (valor) => BRL.format(Number(valor) || 0);

const request = async (caminho, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen${caminho}`, {
    ...options,
    headers: { "content-type": "application/json", ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const payload = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload;
};

const ABAS = [
  { id: "conciliacao", rotulo: "Extrato e conciliação" },
  { id: "caixa", rotulo: "Previsão de caixa" },
  { id: "cobranca", rotulo: "Cobrança e aging" },
  { id: "fechamento", rotulo: "Fechamento" },
  { id: "resultado", rotulo: "Resultado" },
];

// Aging clássico: quanto do que está em aberto venceu há quanto tempo.
const FAIXAS_AGING = [
  { id: "a_vencer", rotulo: "A vencer", de: -Infinity, ate: 0 },
  { id: "d30", rotulo: "1–30 dias", de: 1, ate: 30 },
  { id: "d60", rotulo: "31–60 dias", de: 31, ate: 60 },
  { id: "d90", rotulo: "61–90 dias", de: 61, ate: 90 },
  { id: "d90mais", rotulo: "90+ dias", de: 91, ate: Infinity },
];
const diasDeAtraso = (vencimento, hoje) => {
  if (!vencimento) return 0;
  return Math.floor((new Date(`${hoje}T00:00:00Z`) - new Date(`${vencimento}T00:00:00Z`)) / 86400000);
};

const CONTA_VAZIA = { name: "", kind: "corrente", bancoCodigo: "", agencia: "", conta: "", saldoInicial: "", aberturaEm: "" };

export default function TreasuryPage({ authHeaders, setToast }) {
  const [aba, setAba] = useState("conciliacao");
  const [contas, setContas] = useState([]);
  const [contaAtiva, setContaAtiva] = useState("");
  const [linhas, setLinhas] = useState([]);
  const [sugestoes, setSugestoes] = useState(null);
  const [cobranca, setCobranca] = useState(null);
  const [periodos, setPeriodos] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [lancamentos, setLancamentos] = useState([]);
  const [formConta, setFormConta] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  // Previsão de caixa semanal: recebimentos menos pagamentos em aberto, semana
  // a semana (motor billsDomain.cashFlowForecast, via ponte). Atrasados caem na
  // primeira semana — o dinheiro ainda é esperado. Já existia no domínio e
  // nunca era mostrado.
  const previsao = useMemo(() => previsaoSemanalDeCaixa(lancamentos, { weeks: 8 }), [lancamentos]);

  const avisar = (mensagem, tom = "info") => (setToast ? setToast({ mensagem, tom }) : undefined);

  const carregarContas = useCallback(async () => {
    try {
      const dados = await request("/treasury/saldos", authHeaders);
      setContas(dados.contas || []);
      setContaAtiva((atual) => atual || dados.contas?.[0]?.id || "");
    } catch (motivo) { avisar(motivo.message, "erro"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  const carregarLinhas = useCallback(async (contaId) => {
    if (!contaId) { setLinhas([]); return; }
    try {
      const dados = await request(`/treasury/extrato?conta=${contaId}&pendentes=1&limit=100`, authHeaders);
      setLinhas(dados.registros || []);
    } catch (motivo) { avisar(motivo.message, "erro"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { carregarContas(); }, [carregarContas]);
  useEffect(() => { carregarLinhas(contaAtiva); }, [contaAtiva, carregarLinhas]);
  useEffect(() => {
    if (aba === "caixa") request("/records/financial?limit=200", authHeaders).then((d) => setLancamentos(d.registros || [])).catch((m) => avisar(m.message, "erro"));
    if (aba === "cobranca") request("/treasury/cobranca", authHeaders).then(setCobranca).catch((m) => avisar(m.message, "erro"));
    if (aba === "fechamento") request("/treasury/periodos", authHeaders).then((d) => setPeriodos(d.registros || [])).catch((m) => avisar(m.message, "erro"));
    if (aba === "resultado") request("/treasury/resultado", authHeaders).then(setResultado).catch((m) => avisar(m.message, "erro"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, authHeaders]);

  const criarConta = async (event) => {
    event.preventDefault();
    setOcupado(true);
    try {
      await request("/records/bankAccounts", authHeaders, {
        method: "POST",
        body: JSON.stringify({ ...formConta, saldoInicial: Number(formConta.saldoInicial) || 0 }),
      });
      avisar("Conta de tesouraria criada");
      setFormConta(null);
      await carregarContas();
    } catch (motivo) { avisar(motivo.message, "erro"); } finally { setOcupado(false); }
  };

  // OFX do banco → linhas normalizadas → importação com dedup por hash no
  // servidor. Reimportar o mesmo arquivo não duplica nada.
  const importarOfx = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo || !contaAtiva) return;
    setOcupado(true);
    try {
      const texto = await arquivo.text();
      const transacoes = parseOfxTransactions(texto);
      if (!transacoes.length) { avisar("Nenhuma transação encontrada no arquivo. É um OFX válido?", "erro"); return; }
      const resultadoImportacao = await request("/treasury/extrato", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          bankAccountId: contaAtiva,
          linhas: transacoes.map((t) => ({
            occurredOn: t.date,
            amount: t.type === "Receita" ? t.value : -t.value,
            description: t.description,
            document: t.fitId || "",
          })),
        }),
      });
      avisar(`${resultadoImportacao.importadas} linha(s) importada(s)` + (resultadoImportacao.repetidas ? ` · ${resultadoImportacao.repetidas} já existiam` : ""));
      await Promise.all([carregarLinhas(contaAtiva), carregarContas()]);
    } catch (motivo) { avisar(motivo.message, "erro"); } finally { setOcupado(false); }
  };

  const abrirSugestoes = async (linha) => {
    try {
      const dados = await request(`/treasury/sugestoes?linha=${linha.id}`, authHeaders);
      setSugestoes({ linha, candidatos: dados.candidatos || [] });
    } catch (motivo) { avisar(motivo.message, "erro"); }
  };

  const conciliar = async (linhaId, entryId) => {
    setOcupado(true);
    try {
      await request("/treasury/conciliacoes", authHeaders, { method: "POST", body: JSON.stringify({ linhaId, entryId }) });
      avisar("Linha conciliada");
      setSugestoes(null);
      await Promise.all([carregarLinhas(contaAtiva), carregarContas()]);
    } catch (motivo) { avisar(motivo.message, "erro"); } finally { setOcupado(false); }
  };

  const fecharMes = async (event) => {
    event.preventDefault();
    const mes = new FormData(event.target).get("mes");
    if (!mes) return;
    setOcupado(true);
    try {
      await request("/treasury/periodos", authHeaders, { method: "POST", body: JSON.stringify({ referenceMonth: mes }) });
      avisar(`Competência ${mes} fechada`);
      setPeriodos((await request("/treasury/periodos", authHeaders)).registros || []);
    } catch (motivo) { avisar(motivo.message, "erro"); } finally { setOcupado(false); }
  };

  const reabrirMes = async (mes) => {
    const motivo = window.prompt(`Reabrir ${mes} fica registrado. Qual o motivo?`);
    if (!motivo) return;
    setOcupado(true);
    try {
      await request("/treasury/periodos/reabrir", authHeaders, { method: "POST", body: JSON.stringify({ referenceMonth: mes, motivo }) });
      avisar(`Competência ${mes} reaberta`);
      setPeriodos((await request("/treasury/periodos", authHeaders)).registros || []);
    } catch (erro) { avisar(erro.message, "erro"); } finally { setOcupado(false); }
  };

  const hoje = new Date().toISOString().slice(0, 10);
  const aging = useMemo(() => {
    const faixas = FAIXAS_AGING.map((faixa) => ({ ...faixa, total: 0, quantidade: 0 }));
    for (const registro of cobranca?.registros || []) {
      const atraso = diasDeAtraso(registro.vencimentoEm, cobranca?.hoje || hoje);
      const faixa = faixas.find((f) => atraso >= f.de && atraso <= f.ate) || faixas[0];
      faixa.total += Number(registro.devido?.total ?? registro.devido ?? 0);
      faixa.quantidade += 1;
    }
    return faixas;
  }, [cobranca, hoje]);

  const contaSelecionada = contas.find((c) => c.id === contaAtiva);

  return (
    <section className="tdg-panel tdg-page">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">FINANCEIRO · TESOURARIA</span>
          <h2>Tesouraria, conciliação e fechamento</h2>
          <p>O saldo é derivado: inicial mais o que foi conciliado com o extrato. Fechar o mês trava os lançamentos da competência.</p>
        </div>
        <strong>{contas.length} conta(s)</strong>
      </div>

      <div className="tdg-result">
        {contas.map((conta) => (
          <article className={`tdg-metric ${conta.linhasPendentes ? "" : "good"}`} key={conta.id}>
            <span>{conta.name}</span>
            <strong>{dinheiro(conta.saldo)}</strong>
            <small>{conta.linhasPendentes ? `${conta.linhasPendentes} linha(s) pendente(s) — o saldo ainda muda` : "extrato todo conciliado"}</small>
          </article>
        ))}
        <article className="tdg-metric">
          <span>Nova conta</span>
          <button type="button" className="tdg-action" onClick={() => setFormConta(CONTA_VAZIA)}><Plus size={15} />Cadastrar</button>
          <small>corrente, poupança, caixa…</small>
        </article>
      </div>

      {/* Conta nova em janela própria: o formulário não empurra mais a
          barra de seções da tesouraria (rodada "nada corta a tela", 30/08). */}
      {formConta && (
        <Modal title="Nova conta bancária" onClose={() => setFormConta(null)}>
        <form className="tdg-form tdg-form-em-modal" onSubmit={criarConta}>
          <label><span>Nome da conta</span><input required value={formConta.name} onChange={(e) => setFormConta((v) => ({ ...v, name: e.target.value }))} placeholder="Ex.: Itaú principal" /></label>
          <label><span>Tipo</span><select value={formConta.kind} onChange={(e) => setFormConta((v) => ({ ...v, kind: e.target.value }))}>{["corrente", "poupanca", "caixa", "aplicacao", "cartao"].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
          <label><span>Banco (código)</span><input value={formConta.bancoCodigo} onChange={(e) => setFormConta((v) => ({ ...v, bancoCodigo: e.target.value }))} /></label>
          <label><span>Agência</span><input value={formConta.agencia} onChange={(e) => setFormConta((v) => ({ ...v, agencia: e.target.value }))} /></label>
          <label><span>Conta</span><input value={formConta.conta} onChange={(e) => setFormConta((v) => ({ ...v, conta: e.target.value }))} /></label>
          <label><span>Saldo inicial (R$)</span><input type="number" step="0.01" value={formConta.saldoInicial} onChange={(e) => setFormConta((v) => ({ ...v, saldoInicial: e.target.value }))} /></label>
          <label><span>Data do saldo</span><input type="date" value={formConta.aberturaEm} onChange={(e) => setFormConta((v) => ({ ...v, aberturaEm: e.target.value }))} /></label>
          <div className="tdg-form-actions"><button type="button" onClick={() => setFormConta(null)}>Cancelar</button><button className="tdg-action" type="submit" disabled={ocupado}><Landmark size={15} />Criar conta</button></div>
        </form>
        </Modal>
      )}

      <nav className="tdg-subtabs" aria-label="Seções da tesouraria">
        {ABAS.map((item) => (
          <button type="button" key={item.id} className={aba === item.id ? "active" : ""} onClick={() => setAba(item.id)}>{item.rotulo}</button>
        ))}
      </nav>

      {aba === "caixa" && (
        <div className="tdg-page-block">
          <div className="tdg-section-head"><div><h3>Previsão de caixa — 8 semanas</h3><p>Recebimentos menos pagamentos em aberto, semana a semana. Atrasados caem na primeira semana — o dinheiro ainda é esperado.</p></div></div>
          {!lancamentos.length && <div className="tdg-empty-access">Sem lançamentos em aberto no razão para projetar o caixa.</div>}
          {lancamentos.length > 0 && (
            <div className="tdg-caixa-semanas" aria-label="Previsão de caixa semanal">
              {previsao.map((semana) => (
                <article key={semana.start} className={semana.acumulado < 0 ? "negativo" : ""}>
                  <strong>{new Date(`${semana.start}T00:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}</strong>
                  <span className="entra">+{dinheiro(semana.entradas)}</span>
                  <span className="sai">−{dinheiro(semana.saidas)}</span>
                  <small>saldo {dinheiro(semana.resultado)}</small>
                  <b>acum. {dinheiro(semana.acumulado)}</b>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {aba === "conciliacao" && (
        <div className="tdg-page-block">
          <div className="tdg-inline-editor">
            <label>
              <span>Conta</span>
              <select value={contaAtiva} onChange={(e) => setContaAtiva(e.target.value)}>
                <option value="">Selecione</option>
                {contas.map((conta) => <option key={conta.id} value={conta.id}>{conta.name}</option>)}
              </select>
            </label>
            <label className="tdg-action" style={{ cursor: contaAtiva ? "pointer" : "not-allowed" }}>
              <FileUp size={15} /> Importar extrato OFX
              <input type="file" accept=".ofx,.qfx,text/plain" style={{ display: "none" }} disabled={!contaAtiva || ocupado} onChange={importarOfx} />
            </label>
            {contaSelecionada && <small>Saldo {dinheiro(contaSelecionada.saldo)} · {contaSelecionada.linhasPendentes} pendente(s)</small>}
          </div>

          {!linhas.length && <div className="tdg-empty-access">Nenhuma linha pendente nesta conta. Importe o OFX do banco para conciliar.</div>}
          {linhas.map((linha) => (
            <article className="tdg-txn-row" key={linha.id}>
              <span><strong>{linha.description || "Sem descrição"}</strong><small>{linha.occurredOn} · doc {linha.document || "—"}</small></span>
              <span><small>{Number(linha.amount) >= 0 ? "Entrada" : "Saída"}</small><strong>{dinheiro(Math.abs(linha.amount))}</strong></span>
              <button type="button" onClick={() => abrirSugestoes(linha)}><Link2 size={14} /> Conciliar</button>
            </article>
          ))}

          {sugestoes && (
            <div className="tdg-page-block">
              <div className="tdg-section-head"><div><h3>Com qual lançamento esta linha casa?</h3><p>{sugestoes.linha.description} · {dinheiro(Math.abs(sugestoes.linha.amount))} em {sugestoes.linha.occurredOn}</p></div><button type="button" onClick={() => setSugestoes(null)}>Fechar</button></div>
              {!sugestoes.candidatos.length && <div className="tdg-empty-access">Nenhum lançamento aberto casa com esta linha. Confira se a receita/custo foi lançada no razão.</div>}
              {sugestoes.candidatos.map((candidato) => (
                <article className="tdg-txn-row" key={candidato.entryId}>
                  <span><strong>{dinheiro(candidato.valor)} {candidato.aberto !== candidato.valor ? `· ${dinheiro(candidato.aberto)} em aberto` : ""}</strong><small>{candidato.motivos.join(" · ")}</small></span>
                  <span><small>Confiança</small><strong>{candidato.pontos} pts</strong></span>
                  <button type="button" className="tdg-action" disabled={ocupado} onClick={() => conciliar(sugestoes.linha.id, candidato.entryId)}><CheckCircle2 size={14} /> Conciliar</button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {aba === "cobranca" && (
        <div className="tdg-page-block">
          <div className="tdg-result">
            {aging.map((faixa) => (
              <article className={`tdg-metric ${faixa.id === "a_vencer" ? "" : faixa.total > 0 ? "risk" : "good"}`} key={faixa.id}>
                <span>{faixa.rotulo}</span>
                <strong>{dinheiro(faixa.total)}</strong>
                <small>{faixa.quantidade} título(s)</small>
              </article>
            ))}
          </div>
          {(cobranca?.registros || []).map((registro) => (
            <article className="tdg-txn-row" key={registro.id}>
              <span><strong>{registro.contraparte || registro.numeroDocumento || registro.id.slice(0, 8)}</strong><small>{registro.tipo === "revenue" ? "a receber" : "a pagar"} · vence {registro.vencimentoEm || "sem data"}</small></span>
              <span><small>Devido hoje (com multa/juros)</small><strong>{dinheiro(registro.devido?.total ?? registro.devido)}</strong></span>
            </article>
          ))}
          {!(cobranca?.registros || []).length && <div className="tdg-empty-access">Nada em aberto. 🎉</div>}
        </div>
      )}

      {aba === "fechamento" && (
        <div className="tdg-page-block">
          <form className="tdg-inline-editor" onSubmit={fecharMes}>
            <label><span>Competência (AAAA-MM)</span><input name="mes" type="month" required /></label>
            <button className="tdg-action" type="submit" disabled={ocupado}><Lock size={15} />Fechar competência</button>
            <small>Fechar trava criar/alterar/arquivar lançamentos do mês — e o faturamento na competência.</small>
          </form>
          {periodos.map((periodo) => (
            <article className="tdg-txn-row" key={periodo.id || periodo.referenceMonth}>
              <span><strong>{periodo.referenceMonth}</strong><small>{periodo.status === "fechado" ? `fechado em ${String(periodo.fechadoEm || "").slice(0, 10)}` : `reaberto: ${periodo.motivoReabertura || ""}`}</small></span>
              <span className={`tdg-ledger-status ${periodo.status === "fechado" ? "" : "overdue"}`}>{periodo.status}</span>
              {periodo.status === "fechado" && <button type="button" onClick={() => reabrirMes(periodo.referenceMonth)} disabled={ocupado}><Unlock size={14} /> Reabrir</button>}
            </article>
          ))}
          {!periodos.length && <div className="tdg-empty-access">Nenhuma competência fechada ainda.</div>}
        </div>
      )}

      {aba === "resultado" && (
        <div className="tdg-page-block">
          <p className="tdg-via-ressalva"><Banknote size={14} /> Receita, custo e comissão por centro de custo, calculados do razão. Linha "(sem classificação)" é lançamento sem centro de custo — vale corrigir na origem.</p>
          <div className="tdg-table-scroll">
            <table className="tdg-table">
              <thead><tr><th>Centro de custo</th><th>Receita</th><th>Custo</th><th>Comissão</th><th>Resultado</th><th>Margem</th></tr></thead>
              <tbody>
                {(resultado?.linhas || []).map((linha) => (
                  <tr key={linha.chave}>
                    <td>{linha.chave}</td>
                    <td>{dinheiro(linha.receita)}</td>
                    <td>{dinheiro(linha.custo)}</td>
                    <td>{dinheiro(linha.comissao)}</td>
                    <td>{dinheiro(linha.resultado)}</td>
                    <td>{Number.isFinite(linha.margem) ? `${linha.margem}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!(resultado?.linhas || []).length && <div className="tdg-empty-access">Sem lançamentos para apurar.</div>}
        </div>
      )}

      <p className="tdg-via-ressalva"><AlertTriangle size={14} /> Linha de extrato não se edita: ela é o que o banco informou. Errou a conciliação? Desfaça e concilie de novo — fica tudo registrado.</p>
    </section>
  );
}
