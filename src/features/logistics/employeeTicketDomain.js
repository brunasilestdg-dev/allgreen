// ===== Chamado do colaborador — regras puras =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// O colaborador (CLT ou PJ) abre um chamado quando vê uma divergência nos
// próprios dados — ele não corrige direto (banco/PIX/salário são do RH). A
// equipe resolve. Aqui vivem os tipos, a validação e as transições do ciclo.

const texto = (v, max = 500) => String(v ?? "").trim().slice(0, max);

export const CATEGORIAS_CHAMADO = Object.freeze([
  { id: "dados_cadastrais", rotulo: "Dados cadastrais" },
  { id: "banco_pix", rotulo: "Banco / PIX" },
  { id: "pagamento", rotulo: "Pagamento" },
  { id: "documento", rotulo: "Documento" },
  { id: "ferias_ponto", rotulo: "Férias / ponto" },
  { id: "outro", rotulo: "Outro" },
]);

export const categoriaChamadoValida = (v) =>
  CATEGORIAS_CHAMADO.some((c) => c.id === texto(v));

export const rotuloCategoriaChamado = (v) =>
  CATEGORIAS_CHAMADO.find((c) => c.id === texto(v))?.rotulo || texto(v);

export const STATUS_CHAMADO = Object.freeze([
  { id: "aberto", rotulo: "Aberto" },
  { id: "em_andamento", rotulo: "Em andamento" },
  { id: "resolvido", rotulo: "Resolvido" },
  { id: "cancelado", rotulo: "Cancelado" },
]);

export const rotuloStatusChamado = (v) =>
  STATUS_CHAMADO.find((s) => s.id === texto(v))?.rotulo || texto(v);

// Valida o chamado que o colaborador abre. Devolve { valido, erro } — mensagem
// de tela, não throw.
export const validarChamado = ({ categoria, assunto, descricao } = {}) => {
  if (!categoriaChamadoValida(categoria)) return { valido: false, erro: "Escolha a categoria do chamado." };
  if (!texto(assunto)) return { valido: false, erro: "Escreva um assunto para o chamado." };
  if (texto(descricao).length < 5) return { valido: false, erro: "Descreva a divergência (o que está errado)." };
  return { valido: true };
};

// Transições do ciclo. Aberto/andamento avançam para resolvido; aberto pode
// virar andamento; o próprio colaborador pode cancelar enquanto está aberto.
export const chamadoAtivo = (status) => ["aberto", "em_andamento"].includes(texto(status));
export const podeAtender = (status) => texto(status) === "aberto";
export const podeResolver = (status) => ["aberto", "em_andamento"].includes(texto(status));
export const podeCancelar = (status) => ["aberto", "em_andamento"].includes(texto(status));
