import { useEffect, useState } from "react";
import { AlertTriangle, FileText, ReceiptText, RefreshCw, ShieldAlert } from "lucide-react";
import { STATUS_FISCAL, dadosDacte } from "../fiscalDomain.js";
import "./TodoGreenPages.css";

// Fiscal da transportadora: CT-e (modelo 57), MDF-e (modelo 58) e NFS-e. Não
// NF-e — essa é de quem vende mercadoria. As três moram na mesma tela porque
// quem cuida do fiscal quer ver o documento onde ele está, não caçá-lo em três
// abas. A transmissão à SEFAZ fica desligada por ausência de certificado
// digital; enquanto isso a tela calcula imposto, gera XML e monta o DACTE, e
// diz em voz alta o que falta para transmitir de verdade.

const request = async (path, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/fiscal${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(authHeaders?.() || {}),
      ...(options.headers || {}),
    },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.error || "Não foi possível acessar o módulo fiscal.");
    erro.detalhes = corpo.erros || [];
    throw erro;
  }
  return corpo;
};

const dinheiro = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (valor) => (valor
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(valor))
  : "—");

const NOME_TIPO = { cte: "CT-e", mdfe: "MDF-e", nfse: "NFS-e" };
const NOME_STATUS = {
  rascunho: "Rascunho",
  validado: "Validado",
  assinado: "Assinado",
  transmitido: "Transmitido",
  autorizado: "Autorizado",
  rejeitado: "Rejeitado",
  cancelado: "Cancelado",
  inutilizado: "Inutilizado",
};

// O próximo passo possível para cada status. A regra canônica está no domínio
// (`transicaoValida`); aqui é só o rótulo do botão. O servidor confere de novo.
const PROXIMO_PASSO = {
  rascunho: [{ para: "validado", rotulo: "Validar" }],
  validado: [{ para: "assinado", rotulo: "Assinar e gerar XML" }, { para: "rascunho", rotulo: "Voltar a rascunho" }],
  assinado: [{ para: "transmitido", rotulo: "Transmitir" }],
  transmitido: [{ para: "autorizado", rotulo: "Autorizado" }, { para: "rejeitado", rotulo: "Rejeitado" }],
  autorizado: [{ para: "cancelado", rotulo: "Cancelar" }],
  rejeitado: [{ para: "rascunho", rotulo: "Corrigir" }],
};

const DOCUMENTO_VAZIO = {
  docType: "cte",
  numero: "",
  serie: 1,
  dataEmissao: "",
  tomadorId: "",
  valorServico: "",
  valorFrete: "",
  valorPedagio: "",
  ufInicio: "",
  municipioInicio: "",
  ufFim: "",
  municipioFim: "",
  placa: "",
  ufVeiculo: "",
  rntrc: "",
  motoristaNome: "",
  motoristaCpf: "",
  cstIcms: "00",
};

export default function FiscalPage({ authHeaders, setToast }) {
  const [documentos, setDocumentos] = useState([]);
  const [perfil, setPerfil] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [ocupado, setOcupado] = useState("carregando");
  const [erro, setErro] = useState("");
  const [form, setForm] = useState(DOCUMENTO_VAZIO);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [previa, setPrevia] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState("");

  const avisar = (mensagem, tom = "info") =>
    (setToast ? setToast({ mensagem, tom }) : undefined);

  const alterar = (campo, valor) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
    // Mudar valor, UF ou CST invalida a prévia — o número na tela precisa
    // corresponder ao que foi digitado, não a um cálculo anterior.
    if (["valorServico", "ufInicio", "ufFim", "cstIcms", "docType"].includes(campo)) setPrevia(null);
  };

  const carregar = async () => {
    setOcupado("carregando");
    setErro("");
    try {
      const consulta = filtroTipo ? `?tipo=${filtroTipo}&limit=100` : "?limit=100";
      const [docResposta, perfilResposta, resumoResposta] = await Promise.all([
        request(`/documentos${consulta}`, authHeaders),
        request("/profile", authHeaders),
        request("/resumo", authHeaders),
      ]);
      setDocumentos(docResposta.registros || []);
      setPerfil(perfilResposta || null);
      setResumo(resumoResposta || null);
      setOcupado("");
    } catch (motivo) {
      setErro(motivo.message);
      setOcupado("");
    }
  };

  useEffect(() => { carregar(); }, [filtroTipo]);

  const calcularPrevia = async () => {
    if (!Number(form.valorServico)) {
      avisar("Informe o valor do serviço para calcular os impostos.", "erro");
      return;
    }
    try {
      const resultado = await request("/calcular", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          docType: form.docType,
          valorServico: form.valorServico,
          ufOrigem: form.ufInicio,
          ufDestino: form.ufFim,
          cstIcms: form.cstIcms,
        }),
      });
      setPrevia(resultado);
    } catch (motivo) {
      avisar(motivo.message, "erro");
    }
  };

  const criarDocumento = async (evento) => {
    evento.preventDefault();
    setOcupado("salvando");
    try {
      const valorServico = Number(form.valorServico) || 0;
      const icms = previa?.icms || {};
      const pisCofins = previa?.pisCofins || {};
      const valorTotal = valorServico
        + (Number(form.valorFrete) || 0)
        + (Number(form.valorPedagio) || 0);
      await request("/documentos", authHeaders, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          valorServico,
          valorTotal,
          cfop: previa?.cfop || "",
          icmsBase: icms.icmsBase || 0,
          icmsAliquota: icms.icmsAliquota || 0,
          icmsValor: icms.icmsValor || 0,
          cstIcms: icms.cstIcms || form.cstIcms,
          pisAliquota: pisCofins.pisAliquota || 0,
          pisValor: pisCofins.pisValor || 0,
          cofinsAliquota: pisCofins.cofinsAliquota || 0,
          cofinsValor: pisCofins.cofinsValor || 0,
        }),
      });
      avisar("Documento fiscal criado como rascunho.", "sucesso");
      setForm(DOCUMENTO_VAZIO);
      setPrevia(null);
      setMostrarForm(false);
      await carregar();
    } catch (motivo) {
      avisar(motivo.message, "erro");
      setOcupado("");
    }
  };

  const transitar = async (doc, para) => {
    try {
      await request(`/documentos/${doc.id}/transicao`, authHeaders, {
        method: "POST",
        body: JSON.stringify({ statusNovo: para }),
      });
      avisar(`Documento movido para "${NOME_STATUS[para] || para}".`, "sucesso");
      await carregar();
    } catch (motivo) {
      const detalhe = (motivo.detalhes || []).join(" · ");
      avisar(detalhe ? `${motivo.message} ${detalhe}` : motivo.message, "erro");
    }
  };

  const baixarXml = (doc) => {
    if (!doc.xmlContent) {
      avisar("O XML é gerado ao assinar o documento.", "erro");
      return;
    }
    const blob = new Blob([doc.xmlContent], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.docType}-${doc.numero || doc.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const gerarDacte = async (doc) => {
    try {
      const dados = dadosDacte(
        doc,
        perfil,
        { nome: doc.motoristaNome },
        { nome: "" },
        {
          icms: { icmsBase: doc.icmsBase, icmsAliquota: doc.icmsAliquota, icmsValor: doc.icmsValor },
          pisCofins: { pisValor: doc.pisValor, cofinsValor: doc.cofinsValor },
        },
      );
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF();
      let y = 16;
      const linha = (texto, tamanho = 10, negrito = false) => {
        pdf.setFontSize(tamanho);
        pdf.setFont("helvetica", negrito ? "bold" : "normal");
        pdf.text(String(texto), 14, y);
        y += tamanho * 0.6;
      };
      linha(`DACTE — ${NOME_TIPO[doc.docType] || doc.docType} (modelo ${dados.modelo})`, 14, true);
      linha(`Chave de acesso: ${dados.chaveAcesso || "— (gerada ao assinar)"}`, 9);
      linha(`Série ${dados.serie} · Número ${dados.numero || "—"} · Emissão ${dia(dados.dataEmissao)}`, 9);
      y += 3;
      linha("Emitente", 11, true);
      linha(dados.emitente.razaoSocial || "—");
      linha(`CNPJ ${dados.emitente.cnpj || "—"} · IE ${dados.emitente.ie || "—"}`, 9);
      linha(dados.emitente.endereco || "—", 9);
      y += 3;
      linha("Trajeto", 11, true);
      linha(`${dados.rota.municipioInicio || dados.rota.ufInicio || "—"} → ${dados.rota.municipioFim || dados.rota.ufFim || "—"}`, 9);
      linha(`CFOP ${dados.cfop || "—"} · Modal ${dados.modal} · Placa ${dados.placa || "—"}`, 9);
      y += 3;
      linha("Valores", 11, true);
      linha(`Serviço ${dinheiro(dados.valores.servico)} · Pedágio ${dinheiro(dados.valores.pedagio)}`, 9);
      linha(`Total ${dinheiro(dados.valores.total)}`, 10, true);
      y += 3;
      linha("Impostos", 11, true);
      linha(`ICMS base ${dinheiro(dados.impostos.icmsBase)} · ${dados.impostos.icmsAliquota}% = ${dinheiro(dados.impostos.icmsValor)}`, 9);
      linha(`PIS ${dinheiro(dados.impostos.pisValor)} · COFINS ${dinheiro(dados.impostos.cofinsValor)}`, 9);
      y += 6;
      linha("Documento auxiliar. Sem valor fiscal enquanto não houver autorização da SEFAZ.", 8);
      pdf.save(`dacte-${doc.numero || doc.id}.pdf`);
    } catch (motivo) {
      avisar(`Não foi possível gerar o DACTE: ${motivo.message}`, "erro");
    }
  };

  if (ocupado === "carregando") {
    return <div className="tdg-page"><section className="tdg-panel">Carregando módulo fiscal...</section></div>;
  }

  const transmissaoHabilitada = resumo?.transmissaoHabilitada;

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>FISCAL</span>
          <h2><ReceiptText size={20} /> CT-e, MDF-e e NFS-e</h2>
          <p>
            Documentos fiscais da transportadora — não NF-e, que é de quem vende mercadoria.
            Os impostos são calculados no servidor; o XML e o DACTE saem daqui.
          </p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={carregar} disabled={Boolean(ocupado)}>
            <RefreshCw size={16} />Atualizar
          </button>
          <button className="tdg-action" type="button" onClick={() => setMostrarForm((v) => !v)}>
            <FileText size={16} />{mostrarForm ? "Fechar" : "Novo documento"}
          </button>
        </div>
      </header>

      {!transmissaoHabilitada && (
        <div className="tdg-alert" role="status">
          <ShieldAlert size={18} />
          <span>
            <strong>Transmissão à SEFAZ desligada.</strong>{" "}
            Falta o certificado digital (A1/A3) no cofre — sem <code>NFE_CERT_PFX</code> e{" "}
            <code>NFE_CERT_PASSWORD</code> o sistema prepara o documento, calcula os impostos e gera o XML e o
            DACTE, mas não transmite. Cadastrado o certificado, o mesmo documento segue à SEFAZ sem retrabalho.
          </span>
        </div>
      )}

      {!perfil && (
        <div className="tdg-alert" role="status">
          <AlertTriangle size={18} />
          <span>
            Configure o <strong>perfil fiscal</strong> (regime, CNPJ, IE, séries) antes de assinar documentos.
            Sem ele o CT-e/MDF-e não recebe chave de acesso.
          </span>
        </div>
      )}

      {erro && <div className="tdg-alert" role="alert"><AlertTriangle size={18} /><span>{erro}</span></div>}

      <section className="tdg-metrics">
        <article className="tdg-metric">
          <span>Documentos</span>
          <strong>{resumo?.total || 0}</strong>
          <small>emitidos neste espaço</small>
        </article>
        <article className="tdg-metric">
          <span>Valor total</span>
          <strong>{dinheiro(resumo?.valorTotal)}</strong>
          <small>soma dos documentos</small>
        </article>
        <article className="tdg-metric">
          <span>ICMS acumulado</span>
          <strong>{dinheiro(resumo?.icmsTotal)}</strong>
          <small>destacado nos CT-e</small>
        </article>
        <article className="tdg-metric">
          <span>Por tipo</span>
          <strong>{Object.entries(resumo?.porTipo || {}).map(([t, n]) => `${NOME_TIPO[t] || t}: ${n}`).join(" · ") || "—"}</strong>
          <small>CT-e, MDF-e e NFS-e</small>
        </article>
      </section>

      {mostrarForm && (
        <form className="tdg-panel tdg-form" onSubmit={criarDocumento}>
          <label>
            <span>Tipo</span>
            <select value={form.docType} onChange={(e) => alterar("docType", e.target.value)}>
              <option value="cte">CT-e — Conhecimento de Transporte</option>
              <option value="mdfe">MDF-e — Manifesto de Documentos Fiscais</option>
              <option value="nfse">NFS-e — Nota Fiscal de Serviço</option>
            </select>
          </label>
          <label><span>Série</span><input type="number" min="1" value={form.serie} onChange={(e) => alterar("serie", e.target.value)} /></label>
          <label><span>Número</span><input type="number" value={form.numero} onChange={(e) => alterar("numero", e.target.value)} placeholder="automático" /></label>
          <label><span>Emissão</span><input type="date" value={form.dataEmissao} onChange={(e) => alterar("dataEmissao", e.target.value)} /></label>
          <label><span>Tomador (id)</span><input value={form.tomadorId} onChange={(e) => alterar("tomadorId", e.target.value)} /></label>
          <label><span>Valor do serviço</span><input type="number" step="0.01" value={form.valorServico} onChange={(e) => alterar("valorServico", e.target.value)} required /></label>
          <label><span>Frete</span><input type="number" step="0.01" value={form.valorFrete} onChange={(e) => alterar("valorFrete", e.target.value)} /></label>
          <label><span>Pedágio</span><input type="number" step="0.01" value={form.valorPedagio} onChange={(e) => alterar("valorPedagio", e.target.value)} /></label>
          <label><span>UF início</span><input maxLength={2} value={form.ufInicio} onChange={(e) => alterar("ufInicio", e.target.value.toUpperCase())} /></label>
          <label><span>Município início</span><input value={form.municipioInicio} onChange={(e) => alterar("municipioInicio", e.target.value)} /></label>
          <label><span>UF fim</span><input maxLength={2} value={form.ufFim} onChange={(e) => alterar("ufFim", e.target.value.toUpperCase())} /></label>
          <label><span>Município fim</span><input value={form.municipioFim} onChange={(e) => alterar("municipioFim", e.target.value)} /></label>
          <label><span>Placa</span><input value={form.placa} onChange={(e) => alterar("placa", e.target.value.toUpperCase())} /></label>
          <label><span>UF veículo</span><input maxLength={2} value={form.ufVeiculo} onChange={(e) => alterar("ufVeiculo", e.target.value.toUpperCase())} /></label>
          <label><span>RNTRC</span><input value={form.rntrc} onChange={(e) => alterar("rntrc", e.target.value)} /></label>
          <label><span>Motorista</span><input value={form.motoristaNome} onChange={(e) => alterar("motoristaNome", e.target.value)} /></label>
          <label><span>CPF motorista</span><input value={form.motoristaCpf} onChange={(e) => alterar("motoristaCpf", e.target.value)} /></label>
          <label>
            <span>CST ICMS</span>
            <select value={form.cstIcms} onChange={(e) => alterar("cstIcms", e.target.value)}>
              <option value="00">00 — Tributação normal</option>
              <option value="20">20 — Redução de base</option>
              <option value="40">40 — Isento</option>
              <option value="41">41 — Não tributado</option>
              <option value="51">51 — Diferimento</option>
              <option value="90">90 — Outros / Simples</option>
            </select>
          </label>

          {previa && (
            <div className="tdg-fiscal-previa full">
              <strong>Impostos calculados</strong>
              <ul>
                {previa.cfop && <li>CFOP sugerido: <b>{previa.cfop}</b></li>}
                {previa.icms && <li>ICMS: base {dinheiro(previa.icms.icmsBase)} · {previa.icms.icmsAliquota}% = <b>{dinheiro(previa.icms.icmsValor)}</b> (CST {previa.icms.cstIcms}{previa.icms.simplesNacional ? " · Simples Nacional" : ""})</li>}
                {previa.iss && <li>ISS: {previa.iss.issAliquota}% = <b>{dinheiro(previa.iss.issValor)}</b></li>}
                {previa.pisCofins && <li>PIS {dinheiro(previa.pisCofins.pisValor)} · COFINS {dinheiro(previa.pisCofins.cofinsValor)}</li>}
                {previa.simples && <li>Simples Nacional (faixa {previa.simples.faixa}): efetiva {previa.simples.aliquotaEfetiva}% = <b>{dinheiro(previa.simples.valor)}</b></li>}
              </ul>
            </div>
          )}

          <div className="tdg-form-actions full">
            <button className="tdg-action" type="button" onClick={calcularPrevia}>Calcular impostos</button>
            <button className="tdg-action" type="submit" disabled={ocupado === "salvando"}>
              {ocupado === "salvando" ? "Criando..." : "Criar rascunho"}
            </button>
            <button type="button" onClick={() => { setMostrarForm(false); setPrevia(null); }}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">DOCUMENTOS</span><h2>Emissões e ciclo de vida</h2></div>
          <div className="tdg-fiscal-filtros">
            {["", "cte", "mdfe", "nfse"].map((t) => (
              <button
                key={t || "todos"}
                type="button"
                className={`tdg-action ${filtroTipo === t ? "ativo" : ""}`}
                onClick={() => setFiltroTipo(t)}
              >
                {t ? NOME_TIPO[t] : "Todos"}
              </button>
            ))}
          </div>
        </div>
        {!documentos.length
          ? <p className="tdg-empty">Nenhum documento fiscal ainda. Crie o primeiro CT-e.</p>
          : (
            <div className="tdg-table-wrap">
              <table className="tdg-table">
                <thead>
                  <tr>
                    <th>Tipo</th><th>Nº/Série</th><th>Trajeto</th><th>Valor</th><th>ICMS</th><th>Status</th><th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {documentos.map((doc) => (
                    <tr key={doc.id}>
                      <td>{NOME_TIPO[doc.docType] || doc.docType}</td>
                      <td>{doc.numero || "—"}/{doc.serie}</td>
                      <td>{[doc.ufInicio, doc.ufFim].filter(Boolean).join(" → ") || "—"}</td>
                      <td>{dinheiro(doc.valorTotal)}</td>
                      <td>{dinheiro(doc.icmsValor)}</td>
                      <td>{NOME_STATUS[doc.status] || doc.status}</td>
                      <td className="tdg-fiscal-acoes">
                        {(PROXIMO_PASSO[doc.status] || []).map((passo) => (
                          <button type="button" key={passo.para} onClick={() => transitar(doc, passo.para)}>
                            {passo.rotulo}
                          </button>
                        ))}
                        {doc.xmlContent && (
                          <button type="button" onClick={() => baixarXml(doc)}>XML</button>
                        )}
                        {doc.docType !== "nfse" && (
                          <button type="button" onClick={() => gerarDacte(doc)}>DACTE</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <p className="tdg-fiscal-nota">
        O motor cobre as regras federais de ICMS (Resolução SF 22/1989), PIS/COFINS, ISS e Simples Nacional por
        anexo e faixa. Regras estaduais e municipais específicas exigem conferência local — este módulo prepara o
        documento, não substitui a contabilidade. Status possíveis: {Object.values(STATUS_FISCAL).map((s) => NOME_STATUS[s]).join(", ")}.
      </p>
    </div>
  );
}
