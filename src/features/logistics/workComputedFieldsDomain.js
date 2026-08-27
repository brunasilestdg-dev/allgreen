// Campos calculados dos itens de trabalho: fórmula, espelhamento (mirror),
// lookup e rollup. NÃO é um motor novo — reusa o que a feature `databases` já
// tinha testado (evaluateFormula para expressões, aggregateValues para
// agregações). Aqui só ligamos esses motores ao modelo do work_item: os valores
// vivem em fields_json, as definições no board, e o cálculo acontece na hora de
// mostrar — nada de gravar um número derivado que depois mente.

import { evaluateFormula } from "../databases/formulas.js";
import { aggregateValues } from "../databases/relational.js";

const lista = (v) => (Array.isArray(v) ? v : []);
const texto = (v) => String(v ?? "").trim();

// Os ids que este item referencia. `relations` liga itens de propósito
// (espelhamento/lookup); `dependencies` liga por precedência. O rollup pode
// somar sobre qualquer um dos dois, conforme a definição pedir.
export function idsRelacionados(item, origem = "relations") {
  const bruto = origem === "dependencies" ? item?.dependencies : item?.relations;
  return [...new Set(lista(bruto).map((r) => texto(r?.id ?? r)).filter(Boolean))];
}

export function itensRelacionados(item, todos = [], origem = "relations") {
  const ids = new Set(idsRelacionados(item, origem));
  return lista(todos).filter((i) => ids.has(texto(i?.id)));
}

const valorDoCampo = (item, campoId) => {
  if (!item) return undefined;
  if (campoId === "status") return item.status;
  if (campoId === "priority" || campoId === "prioridade") return item.priority;
  if (campoId === "title" || campoId === "titulo") return item.title;
  const fields = item.fields && typeof item.fields === "object" ? item.fields : {};
  return fields[campoId];
};

// Calcula um único campo derivado.
//   definicao: { id, name, type, formula?, aggregate?, sourceField?, sourceRelation? }
//   type ∈ formula | mirror | lookup | rollup
export function calcularCampoDerivado(definicao, item, { relacionados = [], subitens = [] } = {}) {
  const tipo = texto(definicao?.type).toLowerCase();

  if (tipo === "formula") {
    const { value, error } = evaluateFormula(definicao.formula, item?.fields || {});
    return { valor: value, erro: error || null };
  }

  const fonte = texto(definicao?.sourceField);
  const relacao = texto(definicao?.sourceRelation) === "subitens"
    ? lista(subitens)
    : lista(relacionados);

  if (tipo === "mirror" || tipo === "lookup") {
    // Espelha o campo dos itens ligados. Um único ligado devolve o valor; vários
    // viram uma lista legível — nunca inventamos um só.
    const valores = relacao.map((r) => valorDoCampo(r, fonte)).filter((v) => v !== undefined && v !== "");
    if (!valores.length) return { valor: "", erro: null };
    return { valor: valores.length === 1 ? valores[0] : valores.join(", "), erro: null };
  }

  if (tipo === "rollup") {
    const op = texto(definicao?.aggregate) || "count";
    const valores = relacao.map((r) => valorDoCampo(r, fonte));
    return { valor: aggregateValues(valores, op), erro: null };
  }

  return { valor: valorDoCampo(item, definicao?.id), erro: null };
}

// Calcula todos os campos derivados de um item de uma vez. `definicoes` é a
// lista de campos do board cujo tipo é calculado.
export function calcularCamposDerivados(item, { definicoes = [], todos = [], subitens = [] } = {}) {
  const derivaveis = lista(definicoes).filter((d) =>
    ["formula", "mirror", "lookup", "rollup"].includes(texto(d?.type).toLowerCase()));
  if (!derivaveis.length) return {};

  const porRelacao = itensRelacionados(item, todos, "relations");
  const porDependencia = itensRelacionados(item, todos, "dependencies");

  const resultado = {};
  for (const def of derivaveis) {
    const relacionados = texto(def?.sourceRelation) === "dependencies" ? porDependencia : porRelacao;
    resultado[def.id] = calcularCampoDerivado(def, item, { relacionados, subitens });
  }
  return resultado;
}
