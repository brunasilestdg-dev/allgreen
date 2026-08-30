import "./TodoGreenPages.css";
import { Download, FileText, Plus, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TIPOS_DE_DOCUMENTO, documentoValido, tamanhoLegivel } from "../documentVaultDomain.js";

// O cofre de evidências, por dentro.
//
// A tabela existia desde a migração 0034 e nenhum caminho do produto escrevia
// nela — o cofre estava vazio por construção, e a aba do portal listava um nada
// com quatro colunas.

const api = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/evidencias${caminho}`, {
    method: opcoes.method || "GET",
    headers: {
      ...(opcoes.body ? { "content-type": "application/json" } : {}),
      ...(authHeaders?.() || {}),
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.error || "Não foi possível falar com o servidor.");
  return corpo;
};

const listarCenariosDoCliente = async (clienteId, authHeaders) => {
  if (!clienteId) return [];
  const resposta = await fetch(
    `/api/todogreen/records/scenarios?cliente=${encodeURIComponent(clienteId)}&limit=50`,
    { headers: authHeaders?.() || {} },
  );
  const corpo = await resposta.json().catch(() => ({}));
  return resposta.ok ? corpo.registros || [] : [];
};

const rotuloDoCenario = (cenario) =>
  `${cenario.productId} · ${new Date(cenario.criadoEm).toLocaleDateString("pt-BR")}`;

const FORMULARIO_VAZIO = {
  clientId: "",
  titulo: "",
  tipo: "nota_fiscal",
  referencia: "",
  emitidoEm: "",
  arquivoUrl: "",
  descricao: "",
  calculoId: "",
};

export default function DocumentVaultPage({ authHeaders, clientes = [], setToast }) {
  const [documentos, setDocumentos] = useState([]);
  const [form, setForm] = useState(FORMULARIO_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [filtroCliente, setFiltroCliente] = useState("");
  const [cenariosDoCliente, setCenariosDoCliente] = useState([]);

  useEffect(() => {
    let cancelado = false;
    listarCenariosDoCliente(form.clientId, authHeaders).then((registros) => {
      if (!cancelado) setCenariosDoCliente(registros);
    });
    return () => {
      cancelado = true;
    };
  }, [form.clientId, authHeaders]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const d = await api(
        filtroCliente ? `?cliente=${encodeURIComponent(filtroCliente)}` : "",
        authHeaders,
      );
      setDocumentos(d.documentos || []);
      setErro("");
    } catch (razao) {
      setDocumentos([]);
      setErro(razao.message);
    } finally {
      setCarregando(false);
    }
  }, [authHeaders, filtroCliente]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const conferencia = documentoValido(form);

  const salvar = async (evento) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      await api("", authHeaders, { method: "POST", body: form });
      setForm(FORMULARIO_VAZIO);
      await carregar();
      setToast?.("Documento cadastrado com impressão digital do conteúdo.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setSalvando(false);
    }
  };

  const baixar = async (documento) => {
    try {
      const { url } = await api(`/${documento.id}/link`, authHeaders, { method: "POST" });
      // Abre o link temporário. Ele vale quinze minutos e cada abertura fica
      // registrada.
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (razao) {
      setToast?.(razao.message);
    }
  };

  const campo = (chave) => (evento) => setForm((atual) => ({ ...atual, [chave]: evento.target.value }));

  const trocarCliente = (evento) =>
    setForm((atual) => ({ ...atual, clientId: evento.target.value, calculoId: "" }));

  return (
    <section className="tdg-panel tdg-page tdg-doc-page">
      <header className="tdg-page-title">
        <div>
          <span>COFRE DE DOCUMENTOS</span>
          <h2>Evidências que sustentam os números</h2>
          <p>
            O arquivo continua onde já está — aqui fica o endereço. No cadastro ele é lido uma vez e
            a impressão digital sai dos bytes: se o download falhar, o documento não entra, porque
            uma prova falsa é pior do que nenhuma.
          </p>
        </div>
      </header>

      {erro && <div className="tdg-page-error">{erro}</div>}

      <form className="tdg-access-form" onSubmit={salvar}>
        <label>
          <span>Cliente</span>
          <select value={form.clientId} onChange={trocarCliente}>
            <option value="">Selecione o cliente</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nome || cliente.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Título</span>
          <input value={form.titulo} onChange={campo("titulo")} placeholder="NF 12345 · agosto" />
        </label>
        <label>
          <span>Vincular a uma simulação (opcional)</span>
          <select value={form.calculoId} onChange={campo("calculoId")} disabled={!form.clientId}>
            <option value="">Sem vínculo</option>
            {cenariosDoCliente.map((cenario) => (
              <option key={cenario.id} value={cenario.id}>
                {rotuloDoCenario(cenario)}
              </option>
            ))}
          </select>
          {form.clientId && cenariosDoCliente.length === 0 && (
            <small className="tdg-doc-aviso">Este cliente ainda não tem simulação salva.</small>
          )}
        </label>
        <label>
          <span>Tipo</span>
          <select value={form.tipo} onChange={campo("tipo")}>
            {TIPOS_DE_DOCUMENTO.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Referência</span>
          <input value={form.referencia} onChange={campo("referencia")} placeholder="Número, contrato ou período" />
        </label>
        <label>
          <span>Emitido em</span>
          <input type="date" value={form.emitidoEm} onChange={campo("emitidoEm")} />
        </label>
        <label>
          <span>Endereço do arquivo</span>
          <input value={form.arquivoUrl} onChange={campo("arquivoUrl")} placeholder="https://..." />
        </label>
        <button className="tdg-action" type="submit" disabled={!conferencia.valido || salvando}>
          <Plus size={17} />
          {salvando ? "Conferindo o arquivo..." : "Cadastrar documento"}
        </button>
        {!conferencia.valido && form.arquivoUrl && (
          <small className="tdg-doc-aviso">{conferencia.problemas.join(" ")}</small>
        )}
      </form>

      <div className="tdg-doc-filtro">
        <label>
          <span>Filtrar por cliente</span>
          <select value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clientes.map((cliente) => (
              <option key={cliente.id} value={cliente.id}>
                {cliente.nome || cliente.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {carregando && <p className="tdg-dd-vazio">Carregando os documentos...</p>}
      {!carregando && documentos.length === 0 && (
        <p className="tdg-dd-vazio">
          <FileText size={16} />
          Nenhum documento cadastrado ainda. O portal do cliente mostra exatamente o que estiver
          aqui — nem mais, nem menos.
        </p>
      )}

      <div className="tdg-access-list">
        {documentos.map((documento) => (
          <div className="tdg-access-row tdg-doc-row" key={documento.id}>
            <span>
              <strong>{documento.titulo}</strong>
              <small>
                {documento.tipo.replace(/_/g, " ")} · {documento.referencia || "sem referência"} ·{" "}
                {documento.emitidoEm || "sem data"}
                {documento.calculoId ? " · vinculado a uma simulação" : ""}
              </small>
            </span>
            <span title="Impressão digital do conteúdo (SHA-256)">
              <ShieldCheck size={15} />
              {String(documento.impressaoDigital || "").slice(0, 12)}…
            </span>
            <span>{tamanhoLegivel(documento.arquivoBytes)}</span>
            <button type="button" onClick={() => baixar(documento)} aria-label={`Baixar ${documento.titulo}`}>
              <Download size={17} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
