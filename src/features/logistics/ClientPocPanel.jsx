import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Download, ExternalLink, UploadCloud, ShieldCheck } from "lucide-react";

// Anexar POC (prova de conceito) a um cliente em integração (pedido da titular:
// "clientes em integração devem ter a opção de anexar POC"). Reusa o cofre de
// arquivos do ERP (todogreen_internal_files) via /api/todogreen/file-vault,
// escopado por contextType "client_poc" + o id do cliente — sem tabela nova.

const CONTEXT_TYPE = "client_poc";

const vaultApi = async (caminho, authHeaders, options = {}) => {
  const resposta = await fetch(`/api/todogreen/file-vault${caminho}`, {
    ...options,
    headers: { ...(authHeaders?.() || {}), ...(options.headers || {}) },
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível processar o POC.");
  return corpo;
};

const tamanhoLegivel = (bytes = 0) => {
  if (!bytes) return "";
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
};

export default function ClientPocPanel({ authHeaders, clientId, clientName, setToast }) {
  const [arquivos, setArquivos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef(null);

  const carregar = useCallback(async () => {
    if (!clientId) { setArquivos([]); return; }
    setCarregando(true);
    try {
      const { files } = await vaultApi(
        `?contextType=${CONTEXT_TYPE}&contextId=${encodeURIComponent(clientId)}`,
        authHeaders,
      );
      setArquivos(Array.isArray(files) ? files : []);
    } catch {
      setArquivos([]);
    } finally {
      setCarregando(false);
    }
  }, [authHeaders, clientId]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo || !clientId) return;
    setEnviando(true);
    try {
      const dados = new FormData();
      dados.append("file", arquivo);
      dados.append("clientId", clientId);
      dados.append("contextType", CONTEXT_TYPE);
      dados.append("contextId", clientId);
      await vaultApi("", authHeaders, { method: "POST", body: dados });
      if (inputRef.current) inputRef.current.value = "";
      setToast?.({ mensagem: "POC anexado ao cliente.", tom: "sucesso" });
      await carregar();
    } catch (motivo) {
      setToast?.({ mensagem: motivo.message, tom: "erro" });
    } finally {
      setEnviando(false);
    }
  };

  const baixar = async (documento) => {
    try {
      const { url } = await vaultApi(`/${documento.id}/link`, authHeaders, { method: "POST" });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (motivo) {
      setToast?.({ mensagem: motivo.message, tom: "erro" });
    }
  };

  return (
    <section className="tdg-panel tdg-poc-panel">
      <div className="tdg-section-head">
        <div>
          <span className="tdg-kicker">PROVA DE CONCEITO</span>
          <h3>POC de {clientName || "cliente"}</h3>
        </div>
        <label className="tdg-poc-upload">
          <UploadCloud size={15} />
          {enviando ? "Enviando…" : "Anexar POC"}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
            onChange={enviar}
            disabled={enviando || !clientId}
            hidden
          />
        </label>
      </div>
      {carregando && <p className="tdg-dd-vazio">Carregando…</p>}
      {!carregando && arquivos.length === 0 && (
        <p className="tdg-dd-vazio"><FileText size={16} /> Nenhum POC anexado ainda. Anexe o PDF da prova de conceito deste cliente.</p>
      )}
      {arquivos.length > 0 && (
        <div className="tdg-access-list">
          {arquivos.map((item) => (
            <div className="tdg-access-row tdg-doc-row" key={item.id}>
              <span>
                <strong>{item.fileName}</strong>
                <small>{item.source === "client_reference" ? "Referência externa" : `Versão ${item.version} · ${tamanhoLegivel(item.byteSize)}`}</small>
              </span>
              <span title="SHA-256"><ShieldCheck size={15} />{item.sha256 ? `${item.sha256.slice(0, 12)}…` : "referência"}</span>
              <button type="button" onClick={() => baixar(item)} aria-label={`Abrir ${item.fileName}`}>
                {item.source === "client_reference" ? <ExternalLink size={17} /> : <Download size={17} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
