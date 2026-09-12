// ===== SysPag — adaptador de pagamento (worker) =====
//
// A ponta que toca o cofre e a rede. O DOMÍNIO puro (syspagDomain) faz o
// mapeamento e a validação; aqui lemos os segredos pelo NOME da variável de
// ambiente (nunca o valor no código) e, SÓ quando tudo está configurado,
// disparamos o repasse. Dormente por ausência de segredo — o repasse continua
// sendo apenas razão interno até a credencial existir no cofre.
//
// Padrão da vertical: igual a pushEnabled(env) e ao token_env_key do tracker —
// a presença do segredo é o interruptor. Segredo NUNCA volta no JSON de resposta.

import {
  SYSPAG_TOKEN_ENV_KEY,
  SYSPAG_BASE_URL_ENV_KEY,
  SYSPAG_PATH_ENV_KEY,
  SYSPAG_PATH_PADRAO,
  SYSPAG_AUTH_HEADER_PADRAO,
  montarPagamentoSyspag,
  validarPagamentoSyspag,
  prontidaoSyspag,
} from "../../src/features/logistics/syspagDomain.js";

const presente = (env, chave) => Boolean(String(env?.[chave] || "").trim());

// Habilitado só com token E URL base no cofre. É o interruptor da conexão.
export const syspagHabilitado = (env) =>
  presente(env, SYSPAG_TOKEN_ENV_KEY) && presente(env, SYSPAG_BASE_URL_ENV_KEY);

// Prontidão para a tela do gestor — só booleanos, nunca os segredos.
export const syspagProntidao = (env) =>
  prontidaoSyspag({
    tokenPresente: presente(env, SYSPAG_TOKEN_ENV_KEY),
    baseUrlPresente: presente(env, SYSPAG_BASE_URL_ENV_KEY),
  });

// Dispara UM repasse pela SysPag. É a costura da conexão: quando o cofre tem a
// credencial e a URL, faz a chamada real; senão, devolve honesto que não saiu.
// Nunca lança para o chamador: devolve { enviado, motivo } para o fluxo de
// pagamento seguir gravando o razão sem quebrar.
export const enviarPagamentoSyspag = async (env, entrada) => {
  if (!syspagHabilitado(env)) {
    return { enviado: false, motivo: "conexao_nao_configurada" };
  }
  const pagamento = montarPagamentoSyspag(entrada);
  const validacao = validarPagamentoSyspag(pagamento);
  if (!validacao.valido) {
    return { enviado: false, motivo: "pagamento_invalido", erros: validacao.erros };
  }

  const baseUrl = String(env[SYSPAG_BASE_URL_ENV_KEY]).trim().replace(/\/+$/, "");
  const caminho = String(env[SYSPAG_PATH_ENV_KEY] || SYSPAG_PATH_PADRAO).trim();
  const token = String(env[SYSPAG_TOKEN_ENV_KEY]).trim();
  const headerAuth = String(env.SYSPAG_AUTH_HEADER || SYSPAG_AUTH_HEADER_PADRAO).trim();
  // Bearer por padrão; a titular ajusta por env se a SysPag usar outro esquema.
  const valorAuth = String(env.SYSPAG_AUTH_SCHEME || "Bearer").trim();
  const authValue = valorAuth ? `${valorAuth} ${token}` : token;

  try {
    const resposta = await fetch(`${baseUrl}${caminho}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [headerAuth]: authValue,
      },
      body: JSON.stringify(pagamento),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      return { enviado: false, motivo: "recusado_pela_syspag", status: resposta.status };
    }
    return {
      enviado: true,
      // O id externo do pagamento, se a SysPag devolver — nomes tolerantes até
      // o contrato ser confirmado.
      idExterno: String(dados.id || dados.paymentId || dados.transactionId || ""),
    };
  } catch (erro) {
    console.error("SysPag: falha ao enviar pagamento", erro?.message || erro);
    return { enviado: false, motivo: "falha_de_rede" };
  }
};
