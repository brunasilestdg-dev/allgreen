// ===== Chave PIX — validação e normalização =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// A chave PIX do motorista é o destino do repasse (SysPag). O motorista informa
// no portal dele; a operação vê e corrige no ERP. Antes de gravar ou de pagar,
// a chave é validada pelo TIPO — CPF, e-mail, telefone ou aleatória — para não
// mandar dinheiro para um destino malformado. Regra de honestidade: chave que
// não bate com o tipo é recusada com o motivo, nunca "corrigida" às escondidas.

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const texto = (v) => String(v ?? "").trim();

export const TIPOS_CHAVE_PIX = Object.freeze([
  { id: "cpf", rotulo: "CPF" },
  { id: "email", rotulo: "E-mail" },
  { id: "telefone", rotulo: "Telefone" },
  { id: "aleatoria", rotulo: "Chave aleatória" },
]);

export const tipoPixValido = (tipo) =>
  TIPOS_CHAVE_PIX.some((t) => t.id === texto(tipo));

// Normaliza a chave conforme o tipo: CPF e telefone viram só dígitos (telefone
// com DDI 55); e-mail em minúsculas; aleatória preserva o formato (UUID).
export const normalizarChavePix = (tipo, valor) => {
  const t = texto(tipo);
  const v = texto(valor);
  if (t === "cpf") return digitos(v).slice(0, 11);
  if (t === "telefone") {
    const d = digitos(v);
    // 10 ou 11 dígitos (DDD + número) → prefixa 55; já com 55, mantém.
    if (d.length === 10 || d.length === 11) return `55${d}`;
    return d.slice(0, 13);
  }
  if (t === "email") return v.toLowerCase();
  return v; // aleatória
};

// CPF por dígito verificador — não aceita 000... nem sequência inválida.
const cpfValido = (cpf) => {
  const d = digitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (fatorInicial) => {
    let soma = 0;
    for (let i = 0; i < fatorInicial - 1; i += 1) soma += Number(d[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(10) === Number(d[9]) && dv(11) === Number(d[10]);
};

const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto(v));
// UUID v4-ish, o formato da chave aleatória do PIX.
const aleatoriaValida = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(texto(v));

// Valida a chave já NORMALIZADA. Devolve { valido, erro } — o erro é a mensagem
// para a tela, não um throw.
export const validarChavePix = (tipo, valor) => {
  const t = texto(tipo);
  if (!tipoPixValido(t)) return { valido: false, erro: "Escolha um tipo de chave PIX válido." };
  const v = normalizarChavePix(t, valor);
  if (!v) return { valido: false, erro: "Informe a chave PIX." };
  if (t === "cpf" && !cpfValido(v)) return { valido: false, erro: "CPF da chave PIX inválido." };
  if (t === "email" && !emailValido(v)) return { valido: false, erro: "E-mail da chave PIX inválido." };
  if (t === "telefone" && !(v.length === 12 || v.length === 13)) return { valido: false, erro: "Telefone da chave PIX inválido (use DDD + número)." };
  if (t === "aleatoria" && !aleatoriaValida(v)) return { valido: false, erro: "Chave aleatória inválida (formato UUID)." };
  return { valido: true, chave: v };
};

export const rotuloTipoPix = (tipo) =>
  TIPOS_CHAVE_PIX.find((t) => t.id === texto(tipo))?.rotulo || "";
