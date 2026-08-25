import { useEffect, useMemo, useState } from "react";
import { authHeaders as sessionAuthHeaders } from "../../../session/armazenamento.js";
import {
  COLUMNS,
  FORMS,
  SELECTS,
  TABS,
  UNITS,
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
  if (!res.ok) throw new Error(payload.error || "Não foi possível concluir o cadastro.");
  return payload;
}

export default function ErpRegistriesPage({ registros, criar, setToast }) {
  const [tab, setTab] = useState("items");
  const [external, setExternal] = useState({});
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentTab = TABS.find((item) => item.id === tab) || TABS[0];
  const formConfig = FORMS[tab] || FORMS.items;
  const [form, setForm] = useState(formConfig.initial);

  useEffect(() => {
    setForm(FORMS[tab]?.initial || {});
    setShowForm(false);
  }, [tab]);

  useEffect(() => {
    if (currentTab.source === "records") return undefined;
    let active = true;
    setLoading(true);
    const path = currentTab.source === "fleet"
      ? "/api/todogreen/fleet"
      : `${MASTER_API}/${currentTab.resource}?limit=500`;
    api(path)
      .then((payload) => {
        if (!active) return;
        setExternal((now) => ({
          ...now,
          [tab]: currentTab.source === "fleet" ? payload.vehicles || [] : payload.records || [],
        }));
      })
      .catch((error) => { if (active) setToast?.(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, currentTab.resource, currentTab.source, setToast]);

  const list = currentTab.source === "records" ? registros?.[tab] || [] : external[tab] || [];
  const columns = useMemo(() => COLUMNS[tab] || [], [tab]);
  const Icon = currentTab.icon;
  const change = (field, value) => setForm((now) => ({ ...now, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const body = payloadFor(tab, form);
      let created;
      if (currentTab.source === "records") {
        created = await criar(tab, body);
      } else if (currentTab.source === "fleet") {
        const payload = await api("/api/todogreen/fleet", { method: "POST", body });
        created = payload.vehicle;
      } else {
        const payload = await api(`${MASTER_API}/${currentTab.resource}`, { method: "POST", body });
        created = payload.record;
      }
      if (currentTab.source !== "records" && created) {
        setExternal((now) => ({ ...now, [tab]: [created, ...(now[tab] || [])] }));
      }
      setToast?.(`${currentTab.singular[0].toUpperCase()}${currentTab.singular.slice(1)} cadastrado.`);
      setForm(FORMS[tab]?.initial || {});
      setShowForm(false);
    } catch (error) {
      setToast?.(error.message || "Não foi possível cadastrar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CADASTROS MESTRES</span>
          <h2>A base operacional do ERP</h2>
          <p>As estruturas ficam disponíveis agora e permanecem vazias até o cadastro dos dados reais da To Do Green.</p>
        </div>
        <div className="tdg-page-actions">
          <button className="tdg-action" type="button" onClick={() => setShowForm((value) => !value)}>
            <Icon size={16} />{showForm ? "Fechar" : `Novo ${currentTab.singular}`}
          </button>
        </div>
      </header>

      <nav className="tdg-registry-tabs" aria-label="Cadastros mestres do ERP">
        {TABS.map((item) => {
          const count = item.source === "records" ? registros?.[item.id]?.length : external[item.id]?.length;
          return (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.title}{count ? ` (${count})` : ""}
            </button>
          );
        })}
      </nav>

      {showForm && (
        <form className="tdg-panel tdg-form" onSubmit={submit}>
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
            <button className="tdg-action" type="submit" disabled={saving}>{saving ? "Cadastrando..." : "Cadastrar"}</button>
            <button type="button" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <section className="tdg-panel">
        <div className="tdg-section-head">
          <div><span className="tdg-kicker">{currentTab.title.toUpperCase()}</span><h2>{currentTab.title}</h2></div>
          <Icon size={22} />
        </div>
        {loading ? (
          <p className="tdg-empty">Carregando cadastros...</p>
        ) : !list.length ? (
          <p className="tdg-empty">Nenhum {currentTab.singular} cadastrado ainda.</p>
        ) : (
          <div className="tdg-table-wrap">
            <table className="tdg-table">
              <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {list.map((record) => (
                  <tr key={record.id}>
                    {rowFor(tab, record).map((cell, index) => <td key={`${record.id}-${index}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
