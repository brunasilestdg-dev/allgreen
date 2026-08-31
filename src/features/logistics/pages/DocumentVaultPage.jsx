import "./TodoGreenPages.css";
import { Download, ExternalLink, FileText, FolderPlus, Folder, Lock, Plus, ShieldCheck, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Modal from "../../../components/Modal.jsx";
import { TIPOS_DE_DOCUMENTO, documentoValido, tamanhoLegivel } from "../documentVaultDomain.js";
import {
  PERMISSOES_DE_AREA,
  VISIBILIDADES,
  arvoreDePastas,
  caminhoDaPasta,
  contarPorPasta,
  problemaDaPasta,
} from "../pastasDomain.js";

const api = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/evidencias${caminho}`, {
    method: opcoes.method || "GET",
    headers: { ...(opcoes.body ? { "content-type": "application/json" } : {}), ...(authHeaders?.() || {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível falar com o servidor.");
  return corpo;
};
const fileApi = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/file-vault${caminho}`, {
    ...opcoes,
    headers: { ...(authHeaders?.() || {}), ...(opcoes.headers || {}) },
  });
  if (opcoes.raw) {
    if (!resposta.ok) { const erro = await resposta.json().catch(() => ({})); throw new Error(erro.error || "Não foi possível baixar o arquivo."); }
    return resposta;
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível acessar os arquivos internos.");
  return corpo;
};
const listarCenariosDoCliente = async (clienteId, authHeaders) => {
  if (!clienteId) return [];
  const resposta = await fetch(`/api/todogreen/records/scenarios?cliente=${encodeURIComponent(clienteId)}&limit=50`, { headers: authHeaders?.() || {} });
  const corpo = await resposta.json().catch(() => ({}));
  return resposta.ok ? corpo.registros || [] : [];
};
const rotuloDoCenario = (cenario) => `${cenario.productId} · ${new Date(cenario.criadoEm).toLocaleDateString("pt-BR")}`;
const FORMULARIO_VAZIO = { clientId: "", titulo: "", tipo: "nota_fiscal", referencia: "", emitidoEm: "", arquivoUrl: "", descricao: "", calculoId: "" };

const pastaApi = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/records/documentFolders${caminho}`, {
    method: opcoes.method || "GET",
    headers: { ...(opcoes.body ? { "content-type": "application/json" } : {}), ...(authHeaders?.() || {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível falar com o servidor.");
  return corpo;
};

const PASTA_VAZIA = { nome: "", descricao: "", visibilidade: "private", membros: "", permissaoDaArea: "", paiId: "" };

const ICONE_DA_VISIBILIDADE = { private: Lock, area: Users, shared: Folder };

// A árvore desenhada como lista com recuo. Recuo em vez de componente recursivo
// porque a navegação é por teclado numa lista só: um <nav> plano é o que um
// leitor de tela consegue percorrer sem se perder em níveis aninhados.
function LinhaDePasta({ pasta, atual, onEscolher, contagem }) {
  const Icone = ICONE_DA_VISIBILIDADE[pasta.visibilidade] || Folder;
  const rotulo = VISIBILIDADES.find((item) => item.id === pasta.visibilidade)?.rotulo || "";
  return (
    <>
      <button
        type="button"
        className={`tdg-pasta-linha${atual === pasta.id ? " ativa" : ""}`}
        style={{ "--recuo": pasta.profundidade }}
        onClick={() => onEscolher(pasta.id)}
      >
        <Icone size={14} />
        <span>{pasta.nome}</span>
        <em>{rotulo}</em>
        <b>{contagem.get(pasta.id) || 0}</b>
      </button>
      {pasta.filhas.map((filha) => (
        <LinhaDePasta key={filha.id} pasta={filha} atual={atual} onEscolher={onEscolher} contagem={contagem} />
      ))}
    </>
  );
}

export default function DocumentVaultPage({ authHeaders, clientes = [], setToast }) {
  const [documentos, setDocumentos] = useState([]);
  const [arquivos, setArquivos] = useState([]);
  const [form, setForm] = useState(FORMULARIO_VAZIO);
  const [arquivo, setArquivo] = useState(null);
  const [arquivoCliente, setArquivoCliente] = useState("");
  const [arquivoTitulo, setArquivoTitulo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [cenariosDoCliente, setCenariosDoCliente] = useState([]);
  const [evidenciaAberta, setEvidenciaAberta] = useState(false);
  const [pastas, setPastas] = useState([]);
  // "" = raiz do cofre (tudo). `null` nunca: a raiz é um lugar de verdade.
  const [pastaAtual, setPastaAtual] = useState("");
  const [pastaAberta, setPastaAberta] = useState(null);
  const [formPasta, setFormPasta] = useState(PASTA_VAZIA);

  useEffect(() => {
    let cancelado = false;
    listarCenariosDoCliente(form.clientId, authHeaders).then((registros) => { if (!cancelado) setCenariosDoCliente(registros); });
    return () => { cancelado = true; };
  }, [form.clientId, authHeaders]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const filtro = filtroCliente ? `?cliente=${encodeURIComponent(filtroCliente)}` : "";
      const [externos, internos] = await Promise.all([
        api(filtro, authHeaders),
        fileApi(filtroCliente ? `?client=${encodeURIComponent(filtroCliente)}` : "", authHeaders),
      ]);
      setDocumentos(externos.documentos || []);
      setArquivos(internos.files || []);
      // As pastas vêm na MESMA resposta do cofre, já filtradas pelo servidor
      // (linhagem inteira). A tela não recalcula visibilidade: se chegou, é
      // porque pode ser vista.
      setPastas(internos.folders || []);
      setErro("");
    } catch (razao) { setDocumentos([]); setArquivos([]); setErro(razao.message); }
    finally { setCarregando(false); }
  }, [authHeaders, filtroCliente]);
  useEffect(() => { carregar(); }, [carregar]);

  const conferencia = documentoValido(form);
  const salvarReferenciaEvidencia = async (evento) => {
    evento.preventDefault(); setSalvando(true);
    try { await api("", authHeaders, { method: "POST", body: form }); setForm(FORMULARIO_VAZIO); setEvidenciaAberta(false); await carregar(); setToast?.("Referência cadastrada com impressão digital do conteúdo."); }
    catch (razao) { setToast?.(razao.message); }
    finally { setSalvando(false); }
  };

  const enviarArquivo = async (evento) => {
    evento.preventDefault();
    if (!arquivo) { setToast?.("Selecione o arquivo."); return; }
    setSalvando(true);
    try {
      const dados = new FormData(); dados.append("file", arquivo); dados.append("clientId", arquivoCliente);
      // O arquivo nasce na pasta aberta: é o que a pessoa espera de qualquer
      // gerenciador de arquivos, e evita o upload que cai na raiz sem aviso.
      if (pastaAtual) dados.append("folderId", pastaAtual);
      await fileApi("", authHeaders, { method: "POST", body: dados });
      setArquivo(null); setArquivoTitulo(""); const input = document.getElementById("tdg-file-upload"); if (input) input.value = "";
      await carregar(); setToast?.("Arquivo guardado no ERP com versão e SHA-256.");
    } catch (razao) { setToast?.(razao.message); }
    finally { setSalvando(false); }
  };

  const cadastrarReferenciaCliente = async () => {
    if (!form.arquivoUrl) { setToast?.("Informe o endereço do documento do cliente."); return; }
    try {
      await fileApi("", authHeaders, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ externalUrl: form.arquivoUrl, fileName: form.titulo || "Documento do cliente", clientId: form.clientId }) });
      setEvidenciaAberta(false); await carregar(); setToast?.("Referência do documento do cliente registrada.");
    } catch (razao) { setToast?.(razao.message); }
  };

  const baixarEvidencia = async (documento) => {
    try { const { url } = await api(`/${documento.id}/link`, authHeaders, { method: "POST" }); window.open(url, "_blank", "noopener,noreferrer"); }
    catch (razao) { setToast?.(razao.message); }
  };
  const baixarInterno = async (item) => {
    try {
      if (item.source === "client_reference" && item.externalUrl) { window.open(item.externalUrl, "_blank", "noopener,noreferrer"); return; }
      const resposta = await fileApi(`/${item.id}/download`, authHeaders, { raw: true });
      const blob = await resposta.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = item.fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (razao) { setToast?.(razao.message); }
  };
  const arvore = arvoreDePastas(pastas);
  const contagem = contarPorPasta(arquivos);
  const trilha = caminhoDaPasta(pastas, pastaAtual);
  // Na raiz aparece TUDO o que a pessoa pode ver; dentro de uma pasta, só o
  // que é dela. Sem isso a pasta seria só um rótulo, não um lugar.
  const arquivosDaVez = pastaAtual
    ? arquivos.filter((item) => (item.folderId || "") === pastaAtual)
    : arquivos;

  const salvarPasta = async (evento) => {
    evento.preventDefault();
    const corpo = {
      ...formPasta,
      membros: String(formPasta.membros || "").split(/[,;\s]+/).filter(Boolean),
    };
    const impedimento = problemaDaPasta(pastas, { ...corpo, id: pastaAberta === "nova" ? "" : pastaAberta });
    if (impedimento) { setToast?.(impedimento); return; }
    setSalvando(true);
    try {
      if (pastaAberta === "nova") {
        await pastaApi("", authHeaders, { method: "POST", body: corpo });
        setToast?.("Pasta criada.");
      } else {
        const atual = pastas.find((item) => item.id === pastaAberta);
        await pastaApi(`/${encodeURIComponent(pastaAberta)}`, authHeaders, {
          method: "PATCH",
          body: { ...corpo, revision: atual?.revision },
        });
        setToast?.("Pasta atualizada.");
      }
      setPastaAberta(null); setFormPasta(PASTA_VAZIA); await carregar();
    } catch (razao) { setToast?.(razao.message); }
    finally { setSalvando(false); }
  };

  const campo = (chave) => (evento) => setForm((atual) => ({ ...atual, [chave]: evento.target.value }));
  const trocarCliente = (evento) => setForm((atual) => ({ ...atual, clientId: evento.target.value, calculoId: "" }));

  return <section className="tdg-panel tdg-page tdg-doc-page">
    <header className="tdg-page-title"><div><span>COFRE DE DOCUMENTOS</span><h2>Arquivo interno ou documento do cliente</h2><p>Documento próprio pode ser enviado e guardado no ERP. Documento do cliente pode ficar apenas como referência externa. Em ambos os casos a origem fica explícita.</p></div></header>
    {erro && <div className="tdg-page-error">{erro}</div>}

    <section className="tdg-panel">
      <div className="tdg-section-head"><div><span className="tdg-kicker">ARQUIVO DA TO DO GREEN</span><h3>Upload e versionamento interno</h3><p>Até 10 MB por arquivo. Nova versão com o mesmo nome e cliente recebe número sequencial.{pastaAtual ? ` O arquivo vai para a pasta ${trilha.map((pasta) => pasta.nome).join(" › ")}.` : " O arquivo vai para a raiz do cofre."}</p></div><Upload size={21} /></div>
      <form className="tdg-access-form" onSubmit={enviarArquivo}>
        <label><span>Cliente, se aplicável</span><select value={arquivoCliente} onChange={(e) => setArquivoCliente(e.target.value)}><option value="">Documento interno geral</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome || cliente.name}</option>)}</select></label>
        <label><span>Arquivo</span><input id="tdg-file-upload" type="file" onChange={(e) => { const escolhido = e.target.files?.[0] || null; setArquivo(escolhido); setArquivoTitulo(escolhido?.name || ""); }} /></label>
        {arquivoTitulo && <small>{arquivoTitulo} · {tamanhoLegivel(arquivo?.size || 0)}</small>}
        <button className="tdg-action" disabled={!arquivo || salvando}><Upload size={16} />{salvando ? "Enviando..." : "Guardar no ERP"}</button>
      </form>
    </section>

    {evidenciaAberta && <Modal title="Registrar evidência" onClose={() => setEvidenciaAberta(false)} wide>
      <form className="tdg-access-form tdg-form-em-modal" onSubmit={salvarReferenciaEvidencia}>
        <label><span>Cliente</span><select value={form.clientId} onChange={trocarCliente}><option value="">Selecione o cliente</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome || cliente.name}</option>)}</select></label>
        <label><span>Título</span><input value={form.titulo} onChange={campo("titulo")} placeholder="Contrato do cliente · versão 3" /></label>
        <label><span>Vincular a uma simulação</span><select value={form.calculoId} onChange={campo("calculoId")} disabled={!form.clientId}><option value="">Sem vínculo</option>{cenariosDoCliente.map((cenario) => <option key={cenario.id} value={cenario.id}>{rotuloDoCenario(cenario)}</option>)}</select></label>
        <label><span>Tipo</span><select value={form.tipo} onChange={campo("tipo")}>{TIPOS_DE_DOCUMENTO.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.nome}</option>)}</select></label>
        <label><span>Referência</span><input value={form.referencia} onChange={campo("referencia")} /></label>
        <label><span>Emitido em</span><input type="date" value={form.emitidoEm} onChange={campo("emitidoEm")} /></label>
        <label><span>Endereço do arquivo do cliente</span><input value={form.arquivoUrl} onChange={campo("arquivoUrl")} placeholder="https://..." /></label>
        <div className="tdg-form-actions">
          <button type="button" onClick={() => setEvidenciaAberta(false)}>Cancelar</button>
          <button type="button" onClick={cadastrarReferenciaCliente} disabled={!form.arquivoUrl}>Guardar somente a referência</button>
          <button className="tdg-action" type="submit" disabled={!conferencia.valido || salvando}><Plus size={17} />Cadastrar como evidência</button>
        </div>
      </form>
    </Modal>}

    <section className="tdg-panel tdg-pastas">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">PASTAS</span>
          <h3>Privadas, da área e do espaço</h3>
          <p>
            Pasta privada é sua e de quem você listar. Pasta da área é de quem tem a permissão
            escolhida. Uma subpasta dentro de uma pasta privada continua privada, mesmo marcada
            como do espaço.
          </p>
        </div>
        <button
          type="button"
          className="tdg-action"
          onClick={() => { setFormPasta({ ...PASTA_VAZIA, paiId: pastaAtual }); setPastaAberta("nova"); }}
        >
          <FolderPlus size={16} />Nova pasta
        </button>
      </div>

      <nav className="tdg-pasta-arvore" aria-label="Pastas do cofre">
        <button
          type="button"
          className={`tdg-pasta-linha${pastaAtual === "" ? " ativa" : ""}`}
          style={{ "--recuo": 0 }}
          onClick={() => setPastaAtual("")}
        >
          <Folder size={14} />
          <span>Todos os documentos</span>
          <em>raiz</em>
          <b>{arquivos.length}</b>
        </button>
        {arvore.map((pasta) => (
          <LinhaDePasta key={pasta.id} pasta={pasta} atual={pastaAtual} onEscolher={setPastaAtual} contagem={contagem} />
        ))}
      </nav>

      {!pastas.length && (
        <p className="tdg-dd-vazio">
          <Folder size={16} />
          Nenhuma pasta ainda. Tudo o que já estava no cofre continua visível na raiz — criar pasta
          não esconde o que existe, só organiza o que vier.
        </p>
      )}

      {pastaAtual && (
        <div className="tdg-pasta-trilha">
          <span>{trilha.map((pasta) => pasta.nome).join(" › ")}</span>
          <button
            type="button"
            onClick={() => {
              const atual = pastas.find((item) => item.id === pastaAtual);
              setFormPasta({
                ...PASTA_VAZIA,
                ...atual,
                membros: (atual?.membros || []).join(", "),
              });
              setPastaAberta(pastaAtual);
            }}
          >
            Editar esta pasta
          </button>
        </div>
      )}
    </section>

    {pastaAberta && <Modal title={pastaAberta === "nova" ? "Nova pasta" : "Editar pasta"} onClose={() => setPastaAberta(null)} wide>
      <form className="tdg-access-form tdg-form-em-modal" onSubmit={salvarPasta}>
        <label><span>Nome</span><input required value={formPasta.nome} onChange={(e) => setFormPasta((a) => ({ ...a, nome: e.target.value }))} /></label>
        <label>
          <span>Dentro de</span>
          <select value={formPasta.paiId} onChange={(e) => setFormPasta((a) => ({ ...a, paiId: e.target.value }))}>
            <option value="">Raiz do cofre</option>
            {pastas.filter((item) => item.id !== pastaAberta).map((item) => (
              <option value={item.id} key={item.id}>{item.nome}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Quem vê</span>
          <select value={formPasta.visibilidade} onChange={(e) => setFormPasta((a) => ({ ...a, visibilidade: e.target.value }))}>
            {VISIBILIDADES.map((item) => <option value={item.id} key={item.id}>{item.rotulo}</option>)}
          </select>
        </label>
        <p className="tdg-pasta-ajuda">{VISIBILIDADES.find((item) => item.id === formPasta.visibilidade)?.ajuda}</p>
        {formPasta.visibilidade === "private" && (
          <label>
            <span>Compartilhar com (e-mails)</span>
            <textarea
              rows={2}
              value={formPasta.membros}
              onChange={(e) => setFormPasta((a) => ({ ...a, membros: e.target.value }))}
              placeholder="pessoa@todogreen.com.br, outra@todogreen.com.br"
            />
          </label>
        )}
        {formPasta.visibilidade === "area" && (
          <label>
            <span>De qual área</span>
            <select required value={formPasta.permissaoDaArea} onChange={(e) => setFormPasta((a) => ({ ...a, permissaoDaArea: e.target.value }))}>
              <option value="">Selecione a área</option>
              {PERMISSOES_DE_AREA.map((item) => <option value={item.id} key={item.id}>{item.rotulo}</option>)}
            </select>
          </label>
        )}
        <label><span>Descrição</span><input value={formPasta.descricao} onChange={(e) => setFormPasta((a) => ({ ...a, descricao: e.target.value }))} /></label>
        <div className="tdg-form-actions">
          <button type="button" onClick={() => setPastaAberta(null)} disabled={salvando}>Cancelar</button>
          <button className="tdg-action" type="submit" disabled={salvando}><FolderPlus size={16} />{salvando ? "Gravando..." : "Gravar pasta"}</button>
        </div>
      </form>
    </Modal>}

    <div className="tdg-doc-filtro"><label><span>Filtrar por cliente</span><select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}><option value="">Todos</option>{clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome || cliente.name}</option>)}</select></label></div>

    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">ARQUIVOS INTERNOS</span><h3>{pastaAtual ? trilha.map((pasta) => pasta.nome).join(" › ") : "Guardados no ERP"}</h3></div><strong>{arquivosDaVez.length}</strong></div>{carregando && <p>Carregando...</p>}{!carregando && arquivosDaVez.length === 0 && <p className="tdg-dd-vazio"><FileText size={16} />{pastaAtual ? "Nenhum arquivo nesta pasta." : "Nenhum arquivo interno ainda."}</p>}<div className="tdg-access-list">{arquivosDaVez.map((item) => <div className="tdg-access-row tdg-doc-row" key={item.id}><span><strong>{item.fileName}</strong><small>{item.source === "internal_upload" ? `Versão ${item.version} · ${tamanhoLegivel(item.byteSize)}` : "Referência externa do cliente"}</small></span><span title="SHA-256"><ShieldCheck size={15} />{item.sha256 ? `${item.sha256.slice(0,12)}…` : "referência"}</span><button type="button" onClick={() => baixarInterno(item)}>{item.source === "client_reference" ? <ExternalLink size={17} /> : <Download size={17} />}</button></div>)}</div></section>

    <section className="tdg-panel"><div className="tdg-section-head"><div><span className="tdg-kicker">EVIDÊNCIAS AUDITÁVEIS</span><h3>Documentos vinculados a cálculo, operação ou cliente</h3></div><div className="tdg-page-actions"><strong>{documentos.length}</strong><button type="button" className="tdg-action" onClick={() => setEvidenciaAberta(true)}><Plus size={16} />Registrar evidência</button></div></div>{!carregando && documentos.length === 0 && <p className="tdg-dd-vazio"><FileText size={16} />Nenhuma evidência cadastrada.</p>}<div className="tdg-access-list">{documentos.map((documento) => <div className="tdg-access-row tdg-doc-row" key={documento.id}><span><strong>{documento.titulo}</strong><small>{documento.tipo.replace(/_/g," ")} · {documento.referencia || "sem referência"} · {documento.emitidoEm || "sem data"}</small></span><span title="SHA-256"><ShieldCheck size={15} />{String(documento.impressaoDigital || "").slice(0,12)}…</span><span>{tamanhoLegivel(documento.arquivoBytes)}</span><button type="button" onClick={() => baixarEvidencia(documento)}><Download size={17} /></button></div>)}</div></section>
  </section>;
}
