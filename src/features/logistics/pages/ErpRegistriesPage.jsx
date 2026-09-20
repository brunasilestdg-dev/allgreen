import { useEffect, useRef, useState } from "react";
import { authHeaders as sessionAuthHeaders } from "../../../session/armazenamento.js";
import Modal from "../../../components/Modal.jsx";
import {
  COLUMNS,
  FORMS,
  GROUPS,
  SELECTS,
  TABS,
  UNITS,
  groupOfTab,
  initialFromRecord,
  payloadFor,
  rowFor,
} from "./masterRegistryConfig.js";
import "./TodoGreenPages.css";

const MASTER_API = "/api/todogreen/master-data";

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: {
      ...sessionAuthHeaders(),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Preserva status/código para a tela distinguir 409 (conflito de revisão)
    // de erro genérico — o texto do toast muda conforme o caso.
    const erro = new Error(payload.error || "Não foi possível concluir o cadastro.");
    erro.status = res.status;
    erro.code = payload.code;
    throw erro;
  }
  return payload;
}

const secaoConhecida = (secao) => TABS.some((item) => item.id === secao);

export default function ErpRegistriesPage({ registros, criar, atualizar, arquivar, setToast, secao = "", areaLabel = "" }) {
  // Regra da titular (30/08): cadastro correlato mora na MESMA tela (veículo
  // com motorista); sem correlação, fica sozinho (tabela de preço). E cada
  // cadastro no galho da sua área: quando o menu manda uma seção, esta tela
  // abre SÓ os cadastros daquela área — sem as abas das outras seis na cara.
  // A seção vem por propriedade (não do window.location lido uma vez): trocar
  // de cadastro pelo menu antes não trocava de grupo, porque o estado inicial
  // já tinha sido calculado na primeira montagem.
  const recortadaPorArea = Boolean(areaLabel) && secaoConhecida(secao);
  const [grupoId, setGrupoId] = useState(() => groupOfTab(secaoConhecida(secao) ? secao : "items").id);
  useEffect(() => {
    if (secaoConhecida(secao)) setGrupoId(groupOfTab(secao).id);
  }, [secao]);
  const [external, setExternal] = useState({});
  const [erros, setErros] = useState({});
  const [carregando, setCarregando] = useState({});
  const [formTab, setFormTab] = useState("");
  const [form, setForm] = useState({});
  // { id, revision } quando o modal está em modo edição; null ao criar.
  const [editando, setEditando] = useState(null);
  const [saving, setSaving] = useState(false);
  // Uma seção externa é pedida uma vez por sessão da tela; sem este registro,
  // o efeito re-pediria a lista a cada resposta que chega.
  const pedidas = useRef(new Set());

  const grupo = GROUPS.find((item) => item.id === grupoId) || GROUPS[0];

  useEffect(() => { setFormTab(""); }, [grupoId]);

  useEffect(() => {
    let active = true;
    for (const tabId of grupo.tabs) {
      const cfg = TABS.find((item) => item.id === tabId);
      if (!cfg || cfg.source === "records" || pedidas.current.has(tabId)) continue;
      pedidas.current.add(tabId);
      setCarregando((now) => ({ ...now, [tabId]: true }));
      const path = cfg.source === "fleet"
        ? "/api/todogreen/fleet"
        : `${MASTER_API}/${cfg.resource}?limit=500`;
      api(path)
        .then((payload) => {
          if (!active) return;
          setExternal((now) => ({
            ...now,
            [tabId]: cfg.source === "fleet" ? payload.vehicles || [] : payload.records || [],
          }));
          setErros((now) => ({ ...now, [tabId]: "" }));
        })
        .catch((error) => {
          if (!active) return;
          // O erro fica NA seção (ex.: colaboradores exigem papel de RH) — as
          // vizinhas do grupo continuam funcionando normalmente.
          setErros((now) => ({ ...now, [tabId]: error.message }));
        })
        .finally(() => { if (active) setCarregando((now) => ({ ...now, [tabId]: false })); });
    }
    return () => { active = false; };
  }, [grupo]);

  const abrirFormulario = (tabId) => {
    setForm(FORMS[tabId]?.initial || {});
    setEditando(null);
    setFormTab(tabId);
  };
  // Editar reaproveita o MESMO modal, pré-preenchido pelo inverso de payloadFor,
  // e guarda id + revision para o UPDATE com controle de concorrência.
  const abrirEdicao = (cfg, record) => {
    setForm(initialFromRecord(cfg.id, record));
    setEditando({ id: record.id, revision: record.revision });
    setFormTab(cfg.id);
  };
  const fecharFormulario = () => { setFormTab(""); setEditando(null); };
  const change = (field, value) => setForm((now) => ({ ...now, [field]: value }));
  const [enviandoArquivo, setEnviandoArquivo] = useState("");
  const [cepStatus, setCepStatus] = useState({});

  // Autofill de endereço por CEP: consulta o backend (OpenCEP → ViaCEP →
  // BrasilAPI, normalizado) e preenche o campo de endereço deste form, deixando
  // só o número para a pessoa completar. `alvo` é o campo de endereço do form.
  const buscarCep = async (field, alvo, valor) => {
    const cep = String(valor || "").replace(/\D/g, "");
    if (cep.length !== 8) {
      setCepStatus((now) => ({ ...now, [field]: cep.length ? "CEP incompleto." : "" }));
      return;
    }
    setCepStatus((now) => ({ ...now, [field]: "buscando" }));
    try {
      const dados = await api(`/api/todogreen/cep?cep=${cep}`);
      const linha = [dados.logradouro, dados.bairro].filter(Boolean).join(", ");
      const local = [dados.cidade, dados.uf].filter(Boolean).join("/");
      const endereco = [linha, local].filter(Boolean).join(" — ");
      setForm((now) => ({ ...now, [field]: cep, ...(alvo ? { [alvo]: endereco } : {}) }));
      setCepStatus((now) => ({ ...now, [field]: "ok" }));
    } catch (erro) {
      setCepStatus((now) => ({ ...now, [field]: erro.message || "CEP não encontrado." }));
    }
  };

  // Upload de verdade: manda o arquivo (a planilha da tabela de preço, por ex.)
  // ao cofre interno e grava o caminho de download no campo. Antes só dava para
  // colar um link.
  const subirArquivo = async (field, evento) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;
    setEnviandoArquivo(field);
    try {
      const dados = new FormData();
      dados.append("file", arquivo);
      const resposta = await fetch("/api/todogreen/file-vault", { method: "POST", headers: { ...sessionAuthHeaders() }, body: dados });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || "Não foi possível enviar o arquivo.");
      const id = corpo.file?.id || corpo.id;
      change(field, `/api/todogreen/file-vault/${id}/download`);
      setForm((now) => ({ ...now, __arquivoNome: arquivo.name }));
      setToast?.("Arquivo enviado ao cofre com versão e SHA-256.");
    } catch (razao) {
      setToast?.(razao.message);
    } finally {
      setEnviandoArquivo("");
    }
  };

  const rotuloSingular = (cfg) => `${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)}`;

  const submit = async (event) => {
    event.preventDefault();
    const cfg = TABS.find((item) => item.id === formTab);
    if (!cfg) return;
    setSaving(true);
    try {
      const body = payloadFor(formTab, form);
      if (editando) {
        // UPDATE por fonte, sempre com a revision lida (controle otimista).
        const corpo = { ...body, revision: editando.revision };
        let atualizado;
        if (cfg.source === "records") {
          atualizado = await atualizar?.(formTab, editando.id, corpo);
        } else if (cfg.source === "fleet") {
          const payload = await api(`/api/todogreen/fleet/${encodeURIComponent(editando.id)}`, { method: "PATCH", body: corpo });
          atualizado = payload.vehicle;
        } else {
          const payload = await api(`${MASTER_API}/${cfg.resource}/${encodeURIComponent(editando.id)}`, { method: "PATCH", body: corpo });
          atualizado = payload.record;
        }
        // records já atualiza o estado no gancho; fleet/master trocam a linha aqui.
        if (cfg.source !== "records" && atualizado) {
          setExternal((now) => ({
            ...now,
            [formTab]: (now[formTab] || []).map((item) => (item.id === editando.id ? atualizado : item)),
          }));
        }
        setToast?.(`${rotuloSingular(cfg)} atualizado.`);
      } else {
        let created;
        if (cfg.source === "records") {
          created = await criar(formTab, body);
        } else if (cfg.source === "fleet") {
          const payload = await api("/api/todogreen/fleet", { method: "POST", body });
          created = payload.vehicle;
        } else {
          const payload = await api(`${MASTER_API}/${cfg.resource}`, { method: "POST", body });
          created = payload.record;
        }
        if (cfg.source !== "records" && created) {
          setExternal((now) => ({ ...now, [formTab]: [created, ...(now[formTab] || [])] }));
        }
        setToast?.(`${rotuloSingular(cfg)} cadastrado.`);
      }
      setForm(FORMS[formTab]?.initial || {});
      setEditando(null);
      setFormTab("");
    } catch (error) {
      if (error?.status === 409) {
        setToast?.("Este cadastro foi alterado por outra pessoa. Recarregue a página antes de salvar.");
      } else {
        setToast?.(error.message || (editando ? "Não foi possível atualizar." : "Não foi possível cadastrar."));
      }
    } finally {
      setSaving(false);
    }
  };

  // Arquivar por linha: confirma, apaga logicamente na fonte certa e some da tela.
  const arquivarRegistro = async (cfg, record) => {
    if (typeof window !== "undefined" && !window.confirm(
      `Arquivar este cadastro de ${cfg.singular}? Ele deixa de aparecer na lista, mas o histórico é preservado.`,
    )) return;
    try {
      if (cfg.source === "records") {
        await arquivar?.(cfg.id, record.id);
      } else if (cfg.source === "fleet") {
        await api(`/api/todogreen/fleet/${encodeURIComponent(record.id)}`, { method: "DELETE" });
        setExternal((now) => ({ ...now, [cfg.id]: (now[cfg.id] || []).filter((item) => item.id !== record.id) }));
      } else {
        await api(`${MASTER_API}/${cfg.resource}/${encodeURIComponent(record.id)}`, { method: "DELETE" });
        setExternal((now) => ({ ...now, [cfg.id]: (now[cfg.id] || []).filter((item) => item.id !== record.id) }));
      }
      setToast?.(`${rotuloSingular(cfg)} arquivado.`);
    } catch (error) {
      setToast?.(error.message || "Não foi possível arquivar.");
    }
  };

  const listaDe = (tabId) => {
    const cfg = TABS.find((item) => item.id === tabId);
    return cfg?.source === "records" ? registros?.[tabId] || [] : external[tabId] || [];
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>{recortadaPorArea ? `CADASTROS · ${areaLabel.toUpperCase()}` : "CADASTROS MESTRES"}</span>
          <h2>{recortadaPorArea ? `Cadastros de ${areaLabel}` : "A base operacional do ERP"}</h2>
          <p>
            {recortadaPorArea
              ? "Cada cadastro fica na área dona do dado. Aqui estão só os desta área — os das outras moram no menu delas."
              : "Cadastros que se correlacionam vivem na mesma tela — veículo com motorista, material com depósito e fornecedor. Os demais ficam sozinhos."}
          </p>
        </div>
      </header>

      {!recortadaPorArea && <nav className="tdg-registry-tabs" aria-label="Grupos de cadastros do ERP">
        {GROUPS.map((item) => {
          const total = item.tabs.reduce((sum, tabId) => sum + listaDe(tabId).length, 0);
          return (
            <button
              type="button"
              key={item.id}
              className={grupoId === item.id ? "active" : ""}
              onClick={() => setGrupoId(item.id)}
            >
              {item.title}{total ? ` (${total})` : ""}
            </button>
          );
        })}
      </nav>}

      {grupo.tabs.map((tabId) => {
        const cfg = TABS.find((item) => item.id === tabId);
        if (!cfg) return null;
        const lista = listaDe(tabId);
        const columns = COLUMNS[tabId] || [];
        const formConfig = FORMS[tabId] || { fields: [] };
        const Icon = cfg.icon;
        return (
          <section className="tdg-panel" key={tabId}>
            <div className="tdg-section-head">
              <div>
                <span className="tdg-kicker">{cfg.title.toUpperCase()}</span>
                <h3>{cfg.title}{lista.length ? ` (${lista.length})` : ""}</h3>
              </div>
              <button
                className="tdg-action"
                type="button"
                onClick={() => abrirFormulario(tabId)}
              >
                <Icon size={16} />{`Novo ${cfg.singular}`}
              </button>
            </div>

            {/* Cadastro em janela própria: abrir um formulário não empurra
                mais a tabela desta seção nem as seções irmãs do grupo. */}
            {formTab === tabId && (
              <Modal title={`${editando ? "Editar" : "Novo"} ${cfg.singular}`} onClose={fecharFormulario} wide>
              <form className="tdg-form tdg-registry-form tdg-form-em-modal" onSubmit={submit}>
                {(formConfig.fields || []).map(([field, label, type = "text", required = false, selectKey]) => (
                  <label key={field}>
                    <span>{label}</span>
                    {type === "select" ? (
                      <select value={form[field] ?? ""} onChange={(event) => change(field, event.target.value)} required={required}>
                        {(SELECTS[selectKey] || []).map(([optionValue, optionLabel]) => (
                          <option value={optionValue} key={optionValue || "empty"}>{optionLabel}</option>
                        ))}
                      </select>
                    ) : type === "unit" ? (
                      <select value={form[field] || "UN"} onChange={(event) => change(field, event.target.value)}>
                        {UNITS.map((unit) => <option value={unit.code} key={unit.code}>{unit.code} — {unit.name}</option>)}
                      </select>
                    ) : type === "file" ? (
                      // Planilha da tabela de preço (ou outro anexo): sobe ao cofre
                      // interno com versão + SHA-256 e grava o caminho de download.
                      // O link continua colável para quem já tem a URL.
                      <div className="tdg-campo-arquivo">
                        <input
                          type="text"
                          value={form[field] ?? ""}
                          onChange={(event) => change(field, event.target.value)}
                          placeholder="Cole um link ou envie o arquivo"
                          maxLength={500}
                        />
                        <label className="tdg-campo-arquivo-botao">
                          {enviandoArquivo === field ? "Enviando..." : "Enviar arquivo"}
                          <input
                            type="file"
                            hidden
                            disabled={enviandoArquivo === field}
                            onChange={(event) => subirArquivo(field, event)}
                          />
                        </label>
                        {form.__arquivoNome && <span className="tdg-campo-arquivo-nome">{form.__arquivoNome}</span>}
                      </div>
                    ) : type === "cep" ? (
                      // selectKey carrega o campo de endereço deste form que o
                      // CEP preenche. Busca no blur e no Enter; não bloqueia nada.
                      <div className="tdg-campo-cep">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={form[field] ?? ""}
                          onChange={(event) => change(field, event.target.value)}
                          onBlur={(event) => buscarCep(field, selectKey, event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); buscarCep(field, selectKey, event.target.value); } }}
                          placeholder="00000-000"
                          maxLength={9}
                        />
                        {cepStatus[field] === "buscando" && <small className="tdg-campo-cep-nota">Buscando endereço...</small>}
                        {cepStatus[field] === "ok" && <small className="tdg-campo-cep-nota ok">Endereço preenchido — falta o número.</small>}
                        {cepStatus[field] && !["buscando", "ok"].includes(cepStatus[field]) && <small className="tdg-campo-cep-nota erro">{cepStatus[field]}</small>}
                      </div>
                    ) : (
                      <input
                        type={type}
                        value={form[field] ?? ""}
                        onChange={(event) => change(field, event.target.value)}
                        required={required}
                        min={type === "number" ? "0" : undefined}
                        step={type === "number" ? "any" : undefined}
                        maxLength={type === "number" ? undefined : 500}
                      />
                    )}
                  </label>
                ))}
                <div className="tdg-form-actions full">
                  <button type="button" onClick={fecharFormulario}>Cancelar</button>
                  <button className="tdg-action" type="submit" disabled={saving}>
                    {saving ? (editando ? "Salvando..." : "Cadastrando...") : (editando ? "Salvar" : "Cadastrar")}
                  </button>
                </div>
              </form>
              </Modal>
            )}

            {erros[tabId] ? (
              <p className="tdg-empty">{erros[tabId]}</p>
            ) : carregando[tabId] ? (
              <p className="tdg-empty">Carregando cadastros...</p>
            ) : !lista.length ? (
              <p className="tdg-empty">Nenhum {cfg.singular} cadastrado ainda.</p>
            ) : (
              <div className="tdg-table-wrap">
                <table className="tdg-table">
                  <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}<th className="tdg-row-actions-head">Ações</th></tr></thead>
                  <tbody>
                    {lista.map((record) => (
                      <tr key={record.id}>
                        {rowFor(tabId, record).map((cell, index) => <td key={`${record.id}-${index}`}>{cell}</td>)}
                        <td className="tdg-row-actions">
                          <button type="button" className="tdg-row-action" onClick={() => abrirEdicao(cfg, record)}>Editar</button>
                          <button type="button" className="tdg-row-action tdg-row-action-danger" onClick={() => arquivarRegistro(cfg, record)}>Arquivar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
