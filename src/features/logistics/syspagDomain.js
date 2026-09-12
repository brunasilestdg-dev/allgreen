// ===== SysPag — adaptador de pagamento (preparado para conexão) =====
// Camada pura. Sem banco, sem rede, sem DOM.
//
// SysPag é um meio de pagamento externo para o repasse do GreenPay: quando o
// gestor PAGA um lote aprovado do motorista, o valor pode sair de fato (PIX)
// pela SysPag, em vez de só virar "pago" no razão interno. Este módulo prepara
// a CONEXÃO — o contrato exato da API (endpoint, cabeçalho, campos) é
// confirmado com a SysPag e preenchido por variável de ambiente; o mapeamento
// de dados, que sobrevive a qualquer transporte, é escrito e testado aqui uma
// vez (mesmo princípio do adaptador TRACK3R).
//
// REGRA 1 (gratuidade): nada aqui liga sozinho nem obriga serviço pago. O
// adaptador fica DORMENTE por ausência de segredo — igual a VAPID, WhatsApp e
// a transmissão fiscal. O segredo NUNCA está no código, no banco, em log ou no
// frontend: ele é lido em tempo de execução pelo NOME da variável de ambiente
// (SYSPAG_API_TOKEN), cadastrada no cofre do Cloudflare Worker pela titular.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arred = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const texto = (v, max = 200) => String(v ?? "").trim().slice(0, max);

// NOMES das variáveis de ambiente — NÃO os valores. O valor (o segredo) mora só
// no cofre; aqui viaja apenas o nome, que é público e não vaza nada.
export const SYSPAG_TOKEN_ENV_KEY = "SYSPAG_API_TOKEN";
export const SYSPAG_BASE_URL_ENV_KEY = "SYSPAG_BASE_URL";
// O caminho e o cabeçalho de auth são configuráveis por ambiente porque só se
// confirmam com a documentação da SysPag. Defaults sensatos, sobrescrevíveis.
export const SYSPAG_PATH_ENV_KEY = "SYSPAG_PAGAMENTO_PATH";
export const SYSPAG_PATH_PADRAO = "/v1/pagamentos";
export const SYSPAG_AUTH_HEADER_PADRAO = "Authorization";

// Métodos de repasse aceitos no payload canônico (o que a operação realmente
// usa). PIX é o caminho padrão do repasse ao motorista.
export const METODOS_SYSPAG = Object.freeze(["pix"]);

// Monta o payload CANÔNICO de um repasse a partir de um lote (settlement) do
// GreenPay. É o mapeamento de dados que não depende do transporte: o worker o
// traduz para o corpo que a SysPag espera quando o contrato estiver confirmado.
// `entrada`: { settlementId, motoristaId, motoristaNome, valor, chavePix,
//   referencia }. Não inventa chave PIX: sem ela, o pagamento é inválido (a
// captura da chave é uma pendência declarada).
export const montarPagamentoSyspag = (entrada = {}) => ({
  referenciaExterna: texto(entrada.settlementId, 80),
  metodo: "pix",
  favorecido: {
    id: texto(entrada.motoristaId, 80),
    nome: texto(entrada.motoristaNome, 120),
    chavePix: texto(entrada.chavePix, 140),
  },
  valor: arred(entrada.valor),
  descricao: texto(entrada.referencia, 140) || "Repasse GreenPay ao motorista",
});

// Valida o payload antes de qualquer disparo. Nunca envia valor <= 0, nunca
// sem favorecido nem sem chave PIX (regra do repasse). Devolve os erros para a
// tela mostrar o que falta — não um throw que o gestor não entende.
export const validarPagamentoSyspag = (pagamento = {}) => {
  const erros = [];
  if (!(num(pagamento.valor) > 0)) erros.push("Valor do repasse precisa ser maior que zero.");
  if (!texto(pagamento.referenciaExterna)) erros.push("Falta a referência do lote (settlement).");
  if (!texto(pagamento?.favorecido?.chavePix)) erros.push("Falta a chave PIX do motorista.");
  return { valido: erros.length === 0, erros };
};

// Prontidão da conexão para a tela do gestor e para as pendências: o que já
// está e o que falta. Recebe apenas BOOLEANOS (o worker resolve a presença dos
// segredos), nunca os segredos em si — o domínio puro não toca no cofre.
export const prontidaoSyspag = ({ tokenPresente = false, baseUrlPresente = false } = {}) => {
  const faltando = [];
  if (!tokenPresente) faltando.push(`Cadastrar o segredo ${SYSPAG_TOKEN_ENV_KEY} no cofre do Worker`);
  if (!baseUrlPresente) faltando.push(`Definir a URL base ${SYSPAG_BASE_URL_ENV_KEY} (documentação da SysPag)`);
  const habilitado = tokenPresente && baseUrlPresente;
  return {
    habilitado,
    tokenPresente,
    baseUrlPresente,
    faltando,
    // Enquanto não habilitado, o repasse continua sendo só razão interno — o
    // pagamento externo não é acionado. Honesto: nunca finge que pagou.
    mensagem: habilitado
      ? "Conexão SysPag pronta: o repasse pode sair por PIX."
      : "Conexão SysPag ainda não configurada — o pagamento fica no razão interno até a credencial ser cadastrada.",
  };
};

// As perguntas para a titular levar à SysPag — o que falta para ligar de fato.
// Espelha o padrão TRACK3R (adaptador agnóstico + pendências registradas).
export const SYSPAG_PENDENCIAS = Object.freeze([
  "Qual a URL base da API da SysPag (produção e homologação)?",
  "Como se emite a credencial e qual o cabeçalho de autenticação (Bearer? chave própria)?",
  "Qual o endpoint e o formato do corpo para criar um pagamento/repasse PIX?",
  "Como a SysPag confirma a liquidação — há webhook de status do pagamento?",
  "A chave PIX do favorecido é do motorista: onde a operação captura e valida essa chave?",
]);
