// ===== JSON guardado no banco, lido sem derrubar a rota =====
//
// Contrato
// - Recebe: o texto de uma coluna `*_json` (ou nada).
// - Devolve: o valor lido quando é objeto (array incluso); `{}` quando o
//   texto falta, é inválido ou é de outro tipo. Nunca lança.
// - Quem chama: caixa de entrada, formulários públicos e portal do cliente.
// - Autorização: nenhuma; é só a leitura defensiva de um dado já autorizado
//   por quem chama.

export const safeParseJson = (value) => {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
