import { useCallback, useEffect, useState } from "react";

// ===== A vertical lendo de um lugar só =====
//
// A tela montava os próprios dados a partir do `db` — o JSON do espaço de
// trabalho — enquanto clientes, ESG, Tracker e portal já vinham da API. Duas
// fontes para a mesma vertical significavam painel somando coisas diferentes e
// portal do cliente cego para o que foi escrito por dentro.
//
// Este gancho é a fonte única. Ele carrega tudo numa chamada e devolve as
// operações de escrita já com o estado local atualizado: criar, atualizar e
// arquivar aplicam o registro que o servidor devolveu direto na coleção em
// memória, em vez de recarregar a vertical inteira a cada gravação — cinco
// coleções e as simulações de novo, para uma escrita que mudou uma linha.

const VAZIO = Object.freeze({
  opportunities: [],
  proposals: [],
  contracts: [],
  operations: [],
  financial: [],
  scenarios: [],
  // Comentários do comercial (conta e oportunidade) — a regra de alcance
  // mora nos campos clientId/opportunityId de cada registro.
  comments: [],
  // Interações registradas (reunião com ata, ligação, e-mail, visita,
  // tentativa de contato) — mesma regra de alcance dos comentários.
  interactions: [],
  // Cadastros de base do ERP (migração 0053). São listas pequenas e estáveis,
  // consultadas por quase toda tela do ERP — material, depósito, parte, conta e
  // centro de custo —, então vêm na mesma carga inicial em vez de uma chamada
  // por tela que precisa preencher um seletor.
  items: [],
  warehouses: [],
  parties: [],
  accounts: [],
  costCenters: [],
  bankAccounts: [],
  // O que a IA sabe sobre a própria To Do Green (migração 0082). Vem na carga
  // inicial porque é uma lista curta e porque a tela que a edita precisa dela
  // inteira — não há paginação a fazer sobre um dossiê de duas dezenas de
  // fatos.
  businessContext: [],
  // Central de RFQ e RFI (migração 0083): o acervo de habilitação, os kits e o
  // ciclo do pedido. Vêm na carga inicial porque a tela calcula o semáforo e a
  // prontidão dos kits cruzando as três — pedir uma por vez faria a tela
  // mostrar kit liberado antes de o acervo chegar.
  habilitacao: [],
  habilitacaoKits: [],
  rfq: [],
  // Não conformidades de Qualidade — coleção da vertical como as demais.
  quality: [],
  // Documentos jurídicos (minutas, contratos, aditivos) — idem.
  legal: [],
  // Pastas de documentos e rotas do dia: o servidor serve as duas (COLECOES),
  // então precisam existir aqui — senão o gancho descarta calado o que veio no
  // pacote inicial. As telas donas (DocumentVaultPage, RoteirizacaoPage) seguem
  // buscando sob demanda; declará-las só fecha a inconsistência.
  documentFolders: [],
  rotas: [],
  // Pontos de recarga próprios (migração 0114). Cadastro da empresa; a tela dona
  // (ChargingPointsPage) e o roteirizador buscam sob demanda, mas declarar aqui
  // evita que o gancho descarte calado o que vier na carga inicial.
  pontosRecarga: [],
  // Operação real de recarga: sessões medidas, reservas e preço por kWh.
  // Ficam no mesmo store canônico de registros da vertical.
  chargingSessions: [],
  chargerReservations: [],
  chargingPrices: [],
});

const pedir = async (caminho, authHeaders, opcoes = {}) => {
  const resposta = await fetch(`/api/todogreen/records${caminho}`, {
    method: opcoes.method || "GET",
    headers: {
      ...(opcoes.body ? { "content-type": "application/json" } : {}),
      ...(opcoes.includeTotals ? { "x-todogreen-include-totals": "1" } : {}),
      ...(authHeaders?.() || {}),
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.error || "Não foi possível falar com o servidor.");
    erro.status = resposta.status;
    throw erro;
  }
  return corpo;
};

const COLECOES_CRITICAS = [
  'opportunities', 'proposals', 'contracts', 'operations', 'financial',
];

export function useVerticalRecords(authHeaders, { ativo = true, colecoes = null } = {}) {
  const [dados, setDados] = useState(VAZIO);
  const [carregando, setCarregando] = useState(ativo);
  const [erro, setErro] = useState("");
  // Falha PARCIAL por coleção (a leitura de UMA coleção falhou; as outras vieram).
  // A tela usa isto para mostrar "indisponível" só na área afetada — nunca zero.
  const [erros, setErros] = useState({});
  // Os dados exibidos são de uma carga anterior porque a última atualização
  // falhou (mantidos em vez de zerar). A tela pode marcar "desatualizado".
  const [desatualizado, setDesatualizado] = useState(false);

  const carregarColecoes = useCallback(async (colecaoEspecifica = null) => {
    const alvo = colecaoEspecifica
      ? [colecaoEspecifica]
      : (colecoes || COLECOES_CRITICAS);

    try {
      const corpo = await pedir("", authHeaders, { includeTotals: true });
      // `errors`/`totals` vêm no corpo mas NÃO são coleções — separar antes de
      // montar `dados`, senão virariam "coleções" fantasma.
      const errosDaColecao = { ...(corpo.errors || {}) };
      const totals = corpo.totals || {};
      const corpoLimpo = { ...corpo };
      delete corpoLimpo.errors;
      delete corpoLimpo.totals;
      const completo = { ...VAZIO, ...corpoLimpo };

      // Paginação RESILIENTE: uma coleção que falha ao paginar não derruba as
      // outras (allSettled) e entra em `erros` — em vez de estourar tudo.
      await Promise.allSettled(alvo.map(async (colecao) => {
        if (!VAZIO[colecao]) return;
        if (errosDaColecao[colecao]) return; // já veio indisponível no agregado
        try {
          const total = Number(totals[colecao] || completo[colecao]?.length || 0);
          let offset = completo[colecao]?.length || 0;
          while (offset < total) {
            const pagina = await pedir(`/${colecao}?limit=200&offset=${offset}`, authHeaders);
            const items = pagina.registros || [];
            completo[colecao] = [...(completo[colecao] || []), ...items];
            if (!items.length) break;
            offset += items.length;
          }
        } catch (e) {
          errosDaColecao[colecao] = { code: e.status ? String(e.status) : "read_failed", message: e.message };
        }
      }));
      setDados(completo);
      setErros(errosDaColecao);
      setDesatualizado(false);
      // Sucesso (ainda que parcial). Falha parcial é sinalizada por `erros`, não
      // por `erro` — que fica só para a falha TOTAL do agregado (catch abaixo).
      setErro("");
    } catch (razao) {
      // Falha TOTAL do agregado (500 geral, rede). NÃO zera `dados`: mantém a
      // última carga boa e marca desatualizado. Na primeira carga, `dados` ainda
      // é VAZIO — aí a tela mostra "indisponível" por causa de `erro`, não zero.
      setErro(razao.message);
      setDesatualizado(true);
    }
  }, [authHeaders, colecoes]);

  const recarregar = useCallback(async () => {
    if (!ativo) return;
    setCarregando(true);
    try {
      await carregarColecoes();
    } finally {
      setCarregando(false);
    }
  }, [ativo, carregarColecoes]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const criar = useCallback(
    async (colecao, corpo) => {
      const resposta = await pedir(`/${colecao}`, authHeaders, { method: "POST", body: corpo });
      const registro = resposta.registro;
      if (registro) {
        setDados((atual) => ({ ...atual, [colecao]: [registro, ...(atual[colecao] || [])] }));
        setErro("");
      }
      return registro;
    },
    [authHeaders],
  );

  const atualizar = useCallback(
    async (colecao, id, corpo) => {
      const resposta = await pedir(`/${colecao}/${encodeURIComponent(id)}`, authHeaders, {
        method: "PATCH",
        body: corpo,
      });
      const registro = resposta.registro;
      if (registro) {
        setDados((atual) => ({
          ...atual,
          [colecao]: (atual[colecao] || []).map((item) => (item.id === id ? registro : item)),
        }));
        setErro("");
      }
      return registro;
    },
    [authHeaders],
  );

  const arquivar = useCallback(
    async (colecao, id) => {
      await pedir(`/${colecao}/${encodeURIComponent(id)}`, authHeaders, { method: "DELETE" });
      setDados((atual) => ({
        ...atual,
        [colecao]: (atual[colecao] || []).filter((item) => item.id !== id),
      }));
      setErro("");
    },
    [authHeaders],
  );

  const registrarPagamento = useCallback(
    async (id, corpo) => {
      const resposta = await pedir(`/financial/${encodeURIComponent(id)}/payments`, authHeaders, {
        method: "POST",
        body: corpo,
      });
      if (resposta.registro) {
        setDados((atual) => ({
          ...atual,
          financial: atual.financial.map((item) => (item.id === id ? resposta.registro : item)),
        }));
        setErro("");
      }
      return resposta;
    },
    [authHeaders],
  );

  const estornarPagamento = useCallback(
    async (id, pagamentoId) => {
      const resposta = await pedir(
        `/financial/${encodeURIComponent(id)}/payments/${encodeURIComponent(pagamentoId)}`,
        authHeaders,
        { method: "DELETE" },
      );
      if (resposta.registro) {
        setDados((atual) => ({
          ...atual,
          financial: atual.financial.map((item) => (item.id === id ? resposta.registro : item)),
        }));
        setErro("");
      }
      return resposta;
    },
    [authHeaders],
  );

  const registrarEventoOperacao = useCallback(
    async (id, corpo) => {
      const resposta = await pedir(`/operations/${encodeURIComponent(id)}/events`, authHeaders, {
        method: "POST",
        body: corpo,
      });
      if (resposta.registro) {
        setDados((atual) => ({
          ...atual,
          operations: atual.operations.map((item) => (item.id === id ? resposta.registro : item)),
        }));
        setErro("");
      }
      return resposta;
    },
    [authHeaders],
  );

  const listarSubrecurso = useCallback(
    async (colecao, id, subrecurso) =>
      pedir(`/${colecao}/${encodeURIComponent(id)}/${subrecurso}`, authHeaders),
    [authHeaders],
  );

  const carregarAoNecessario = useCallback(
    (colecao) => carregarColecoes(colecao),
    [carregarColecoes],
  );

  return {
    dados, carregando, erro, erros, desatualizado, recarregar, criar, atualizar, arquivar,
    registrarPagamento, estornarPagamento, registrarEventoOperacao, listarSubrecurso,
    carregarAoNecessario,
  };
}

export const REGISTROS_VAZIOS = VAZIO;

// Rótulos amigáveis para nomear a ÁREA afetada quando uma coleção fica
// indisponível. A tela nunca mostra o nome técnico da coleção nem erro de SQL/D1
// ao usuário final — só o nome da área e a opção de tentar de novo.
export const ROTULOS_COLECAO = {
  opportunities: "Oportunidades",
  proposals: "Propostas",
  contracts: "Contratos",
  operations: "Operações",
  financial: "Financeiro",
  scenarios: "Simulações",
  comments: "Comentários",
  interactions: "Interações",
  quality: "Qualidade",
  legal: "Jurídico",
  rfq: "RFQ/RFI",
  habilitacao: "Habilitação",
};

// "Financeiro" · "Financeiro e Operações" · "Oportunidades, Propostas e Financeiro".
export const descreverAreasComErro = (erros = {}) => {
  const nomes = Object.keys(erros || {}).map((chave) => ROTULOS_COLECAO[chave] || chave);
  if (!nomes.length) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
};
