import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search, X } from "lucide-react";
import { Field } from "./fields.jsx";
import { agruparOpcoes, filtrarOpcoes, proximoIndice } from "./selectFilter.js";

// ===== SearchableSelect — o combobox moderno (item 9) =====
//
// Fim do <select> nativo. Ao abrir, o cursor já está no campo de busca: digitar
// filtra na hora (sem acento, sem caixa). Teclado completo (setas/enter/esc).
// Um só componente cobre: escolher cliente, motorista, colaborador, centro de
// custo, material, responsável — single ou múltiplo (chips). Quando há muitas
// opções, a busca é o padrão, não um extra.
//
// options: [{ value, label, description?, keywords?, group?, disabled? }]
export function SearchableSelect({
  options = [],
  value,
  onChange,
  multiple = false,
  placeholder = "Selecionar…",
  searchPlaceholder = "Buscar…",
  emptyText = "Nada encontrado.",
  onCreate,
  createLabel = (t) => `Criar "${t}"`,
  clearable = true,
  disabled = false,
  size = "md",
  label,
  hint,
  error,
  required,
  className = "",
  id,
}) {
  const autoId = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selecionados = multiple ? (Array.isArray(value) ? value : []) : value;
  const filtradas = useMemo(() => filtrarOpcoes(options, query), [options, query]);
  const grupos = useMemo(() => agruparOpcoes(filtradas), [filtradas]);
  const podeCriar = Boolean(onCreate) && query.trim() && !options.some((o) => o.label?.toLowerCase() === query.trim().toLowerCase());

  const rotuloDe = useCallback(
    (val) => options.find((o) => o.value === val)?.label ?? "",
    [options],
  );

  // Fecha ao clicar fora ou ao rolar a página por baixo.
  useEffect(() => {
    if (!open) return undefined;
    const fora = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) fechar(); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [open]);

  useEffect(() => { if (open) { setActive(0); inputRef.current?.focus(); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);

  const abrir = () => { if (!disabled) setOpen(true); };
  const fechar = () => { setOpen(false); setQuery(""); };

  const escolher = (opcao) => {
    if (!opcao || opcao.disabled) return;
    if (multiple) {
      const jaTem = selecionados.includes(opcao.value);
      onChange?.(jaTem ? selecionados.filter((v) => v !== opcao.value) : [...selecionados, opcao.value]);
      setQuery("");
      inputRef.current?.focus();
    } else {
      onChange?.(opcao.value);
      fechar();
    }
  };

  const limpar = (e) => {
    e?.stopPropagation();
    onChange?.(multiple ? [] : null);
  };

  const aoTeclar = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => proximoIndice(filtradas, i, 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => proximoIndice(filtradas, i, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (filtradas[active]) escolher(filtradas[active]);
      else if (podeCriar) { onCreate?.(query.trim()); setQuery(""); }
    } else if (e.key === "Escape") { e.preventDefault(); fechar(); }
    else if (e.key === "Backspace" && !query && multiple && selecionados.length) {
      onChange?.(selecionados.slice(0, -1));
    }
  };

  const temValor = multiple ? selecionados.length > 0 : value != null && value !== "";
  const listId = `${id || autoId}-list`;

  const trigger = (
    <div
      ref={rootRef}
      className={`ds-select ds-select--${size}${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${error ? " is-error" : ""} ${label ? "" : className}`.trim()}
    >
      <button
        type="button"
        className="ds-select__control"
        onClick={() => (open ? fechar() : abrir())}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ds-select__value">
          {multiple && selecionados.length > 0 ? (
            <span className="ds-select__chips">
              {selecionados.map((v) => (
                <span key={v} className="ds-select__chip">
                  {rotuloDe(v)}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remover ${rotuloDe(v)}`}
                    onClick={(e) => { e.stopPropagation(); onChange?.(selecionados.filter((x) => x !== v)); }}
                  ><X size={12} /></span>
                </span>
              ))}
            </span>
          ) : temValor ? (
            <span className="ds-select__single">{rotuloDe(value)}</span>
          ) : (
            <span className="ds-select__placeholder">{placeholder}</span>
          )}
        </span>
        {clearable && temValor && !disabled && (
          <span role="button" tabIndex={-1} className="ds-select__clear" aria-label="Limpar seleção" onClick={limpar}><X size={15} /></span>
        )}
        <ChevronsUpDown size={16} className="ds-select__caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="ds-select__pop" role="dialog">
          <div className="ds-select__search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-controls={listId}
              aria-expanded="true"
              aria-autocomplete="list"
            />
          </div>
          <ul className="ds-select__list" id={listId} role="listbox" aria-multiselectable={multiple || undefined}>
            {filtradas.length === 0 && !podeCriar && <li className="ds-select__empty">{emptyText}</li>}
            {grupos.map((g) => (
              <li key={g.group || "_"} className="ds-select__group">
                {g.group && <span className="ds-select__grouphead">{g.group}</span>}
                <ul>
                  {g.options.map((o) => {
                    const idx = filtradas.indexOf(o);
                    const marcado = multiple ? selecionados.includes(o.value) : value === o.value;
                    return (
                      <li
                        key={o.value}
                        role="option"
                        aria-selected={marcado}
                        className={`ds-select__opt${idx === active ? " is-active" : ""}${marcado ? " is-selected" : ""}${o.disabled ? " is-disabled" : ""}`}
                        onMouseEnter={() => setActive(idx)}
                        onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
                      >
                        <span className="ds-select__optmain">
                          <span className="ds-select__optlabel">{o.label}</span>
                          {o.description && <span className="ds-select__optdesc">{o.description}</span>}
                        </span>
                        {marcado && <Check size={16} aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {podeCriar && (
              <li
                role="option"
                aria-selected={false}
                className="ds-select__opt ds-select__create"
                onMouseDown={(e) => { e.preventDefault(); onCreate?.(query.trim()); setQuery(""); }}
              >
                <Plus size={15} aria-hidden="true" /> <span>{createLabel(query.trim())}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );

  if (!label && !hint && !error) return trigger;
  return <Field label={label} hint={hint} error={error} required={required} className={className}>{trigger}</Field>;
}
