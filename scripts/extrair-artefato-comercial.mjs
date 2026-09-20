// Extrai os dados embutidos do artefato do Painel Comercial (ponte temporária
// até os webhooks do Track3R). Módulo puro: recebe o HTML cru do artefato como
// string e devolve o objeto com os quatro conjuntos — DATA (receita), KANBAN,
// UPDATES e OPS — ou null se o artefato não tiver o bloco de dados.
//
// Sem efeitos colaterais (nada de fs/console/process), para o mesmo código
// servir ao worker, aos testes e à rotina de reimportação.

const parseBalanced = (str, start) => {
  const open = str[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < str.length; k++) {
    const c = str[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return str.slice(start, k + 1); }
  }
  return null;
};

const pegar = (js, nome) => {
  const i = js.indexOf(`const ${nome} =`);
  if (i < 0) return null;
  let j = i;
  while (j < js.length && js[j] !== "{" && js[j] !== "[") j++;
  const raw = parseBalanced(js, j);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

export function extrairArtefatoComercial(html) {
  const texto = String(html || "");
  const s = texto.indexOf("<script>");
  const e = texto.indexOf("</script>", s);
  if (s < 0 || e < 0) return null;
  const js = texto.slice(s + 8, e);
  const DATA = pegar(js, "DATA");
  if (!DATA || !Array.isArray(DATA.daily)) return null;
  return {
    DATA,
    KANBAN: pegar(js, "KANBAN") || { stages: [] },
    UPDATES: pegar(js, "UPDATES") || { weekly_updates: [], fup_list: [] },
    OPS: pegar(js, "OPS") || {},
  };
}
