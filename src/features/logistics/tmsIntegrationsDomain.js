// O que a tela de Integrações do TMS mostra para cada conector: estado real,
// o que ainda falta e qual é a ação que resolve. Antes cada linha era um texto
// com um selo ("rascunho", "configurar") sem ação nenhuma — parecia que dava
// para clicar e não dava, e "SEFAZ · configurar" não configurava nada.
//
// Regra: nada aparece como configurável aqui se o lugar de configurar não
// existir de verdade. CIOT e documento fiscal são configurados no ERP (dono do
// cadastro fiscal e do certificado); esta tela mostra o estado e leva até lá.
// Lógica pura, sem React — a tela só executa a ação que vem descrita.

const texto = (valor) => String(valor ?? "").trim();

export const ACOES_TMS = Object.freeze({
  configurarRastreador: "configurar-rastreador",
  abrirNoErp: "abrir-no-erp",
  rolarAteChaves: "rolar-ate-chaves",
});

// Uma linha sem `value` nunca foi configurada; com `lastError` está quebrada;
// configurada e sem erro está em operação. O meio-termo ("começou e parou")
// precisa dizer o que falta, senão vira o "rascunho" sem explicação de antes.
export const situacaoDaIntegracao = (linha = {}) => {
  const valor = linha.value;
  if (!valor) return "Ainda não configurada.";
  if (texto(valor.lastError)) return `Último erro: ${texto(valor.lastError)}`;
  const partes = [];
  if (texto(valor.lastSyncAt)) partes.push(`Última sincronização em ${texto(valor.lastSyncAt).slice(0, 10)}`);
  else if (texto(valor.lastTestAt)) partes.push(`Último teste em ${texto(valor.lastTestAt).slice(0, 10)}`);
  if (texto(linha.pendencia)) partes.push(texto(linha.pendencia));
  if (partes.length) return partes.join(" · ");
  return valor.configured || valor.status === "ativa" ? "Em operação." : "Configuração iniciada; ainda falta concluir.";
};

// O selo NÃO repete o status cru do banco. "Rascunho" (o `draft` da tabela de
// integração do CIOT) não quer dizer nada para quem opera — e dizia justamente
// para quem precisava entender que a integração não está de pé. São quatro
// estados, e o texto embaixo explica o porquê.
export const selo = (linha = {}) => {
  const valor = linha.value;
  if (!valor) return "nao_configurada";
  if (texto(valor.lastError) || valor.status === "erro") return "erro";
  if (valor.configured || valor.status === "ativa" || valor.status === "ready") return "ativa";
  return "pendente";
};

export const linhasDeIntegracaoTms = (integrations = {}) => {
  const { track3r, ciot, fiscal, api } = integrations || {};
  const linhas = [
    {
      id: "track3r",
      name: "Rastreador e telemetria",
      detail: "Recebe posição e ocorrências dos veículos.",
      value: track3r || null,
      pendencia: "",
      acao: { tipo: ACOES_TMS.configurarRastreador, rotulo: track3r ? "Editar configuração" : "Configurar" },
    },
    {
      id: "ciot",
      name: "CIOT · ANTT",
      detail: "Emissão de CIOT com certificado ICP-Brasil e piso mínimo.",
      value: ciot || null,
      pendencia: ciot && !ciot.configured
        ? `Falta ${[
          !ciot.connectorConfigured && "o conector",
          !ciot.certificateConfigured && "o certificado",
        ].filter(Boolean).join(" e ")}`
        : "",
      acao: {
        tipo: ACOES_TMS.abrirNoErp,
        rota: "/todogreen/ciot",
        rotulo: ciot?.configured ? "Abrir CIOT" : "Configurar CIOT",
      },
    },
    {
      id: "fiscal",
      name: "SEFAZ · CT-e e MDF-e",
      detail: "Emissão de documento fiscal com o certificado do CNPJ.",
      value: fiscal || null,
      pendencia: fiscal && fiscal.certificateStatus && fiscal.certificateStatus !== "ativo"
        ? `Certificado ${fiscal.certificateStatus}`
        : "",
      acao: {
        tipo: ACOES_TMS.abrirNoErp,
        rota: "/todogreen/fiscal",
        rotulo: fiscal?.status === "ativa" ? "Abrir fiscal" : "Configurar fiscal",
      },
    },
    {
      id: "api",
      name: "API do TMS para clientes e parceiros",
      detail: "Cargas, rastreamento, comprovante de entrega e consulta fiscal sem entrar no ERP.",
      value: api || null,
      pendencia: api && !api.activeKeys ? "Nenhuma chave ativa" : "",
      acao: { tipo: ACOES_TMS.rolarAteChaves, rotulo: "Gerenciar chaves" },
    },
  ];
  return linhas.map((linha) => ({
    ...linha,
    estado: situacaoDaIntegracao(linha),
    status: selo(linha),
  }));
};
