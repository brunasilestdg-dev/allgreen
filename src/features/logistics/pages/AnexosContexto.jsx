import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { authHeaders } from "../../../session/armazenamento.js";
import "./TodoGreenPages.css";

// #99: anexar imagens e documentos a um contexto (requisição de Suprimentos,
// contrato do Jurídico). Reaproveita o cofre interno (todogreen_internal_files):
// o arquivo vai em pedaços base64 no D1, com o par context_type/context_id
// dizendo a quem pertence. Download e delete passam pela mesma rota do cofre,
// então herdam o corte de acesso e as pastas.
const MAX_BYTES = 10 * 1024 * 1024;

export default function AnexosContexto({ contextType, contextId, titulo = "Anexos", setToast }) {
  const [arquivos, setArquivos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef(null);

  const carregar = useCallback(async () => {
    if (!contextType || !contextId) return;
    setCarregando(true);
    try {
      const r = await fetch(
        `/api/todogreen/file-vault?contextType=${encodeURIComponent(contextType)}&contextId=${encodeURIComponent(contextId)}`,
        { headers: authHeaders() },
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok) setArquivos(d.files || []);
    } catch { /* silencioso: anexo não pode travar a tela */ }
    finally { setCarregando(false); }
  }, [contextType, contextId]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { setToast?.("Arquivo acima de 10 MB. Para arquivos maiores, use um link externo."); return; }
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("contextType", contextType);
      fd.append("contextId", contextId);
      const r = await fetch("/api/todogreen/file-vault", { method: "POST", headers: authHeaders(), body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Não foi possível anexar.");
      setToast?.("Documento anexado.");
      await carregar();
    } catch (e) { setToast?.(e.message); }
    finally { setEnviando(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const baixar = async (arq) => {
    try {
      const r = await fetch(`/api/todogreen/file-vault/${arq.id}/download`, { headers: authHeaders() });
      if ((r.headers.get("content-type") || "").includes("application/json")) {
        const d = await r.json();
        if (d.externalUrl) window.open(d.externalUrl, "_blank", "noopener");
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = arq.fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { setToast?.("Não foi possível baixar o anexo."); }
  };

  const remover = async (arq) => {
    if (!window.confirm(`Remover "${arq.fileName}"?`)) return;
    try {
      const r = await fetch(`/api/todogreen/file-vault/${arq.id}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || "Não foi possível remover."); }
      await carregar();
    } catch (e) { setToast?.(e.message); }
  };

  if (!contextType || !contextId) return null;
  return (
    <div className="tdg-anexos">
      <div className="tdg-anexos-head">
        <span><Paperclip size={14} /> {titulo}{arquivos.length ? ` (${arquivos.length})` : ""}</span>
        <button type="button" className="tdg-action tdg-action-ghost" disabled={enviando} onClick={() => inputRef.current?.click()}>
          <Upload size={14} />{enviando ? "Enviando…" : "Anexar"}
        </button>
        <input ref={inputRef} type="file" hidden onChange={(e) => enviar(e.target.files?.[0])} />
      </div>
      {carregando && <small className="tdg-anexos-vazio">Carregando anexos…</small>}
      {!carregando && arquivos.length === 0 && <small className="tdg-anexos-vazio">Nenhum anexo ainda.</small>}
      {arquivos.length > 0 && (
        <ul className="tdg-anexos-lista">
          {arquivos.map((a) => (
            <li key={a.id}>
              <button type="button" className="tdg-anexo-nome" onClick={() => baixar(a)} title="Baixar">
                <Download size={13} /> {a.fileName}
              </button>
              <small>{a.source === "client_reference" ? "link" : `${Math.max(1, Math.round(a.byteSize / 1024))} KB`}</small>
              <button type="button" className="tdg-anexo-remover" onClick={() => remover(a)} aria-label={`Remover ${a.fileName}`}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
