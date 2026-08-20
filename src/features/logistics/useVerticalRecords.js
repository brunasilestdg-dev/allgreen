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

export function useVerticalRecords(authHeaders, { ativo = true } = {}) {
  const [dados, setDados] = useState(VAZIO);
  const [carregando, setCarregando] = useState(ativo);
  const [erro, setErro] = useState("");

  const recarregar = useCallback(async () => {
    if (!ativo) return;
    setCarregando(true);
    try {
      const corpo = await pedir("", authHeaders, { includeTotals: true });
      const completo = { ...VAZIO, ...corpo };
      const colecoes = Object.keys(VAZIO);
      await Promise.all(colecoes.map(async (colecao) => {
        const total = Number(corpo.totals?.[colecao] || completo[colecao]?.length || 0);
        let offset = completo[colecao]?.length || 0;
        while (offset < total) {
          const pagina = await pedir(`/${colecao}?limit=200&offset=${offset}`, authHeaders);
          const items = pagina.registros || [];
          completo[colecao] = [...(completo[colecao] || []), ...items];
          if (!items.length) break;
          offset += items.length;
        }
      }));
      setDados(Object.fromEntries(Object.keys(VAZIO).map((key) => [key, completo[key] || []])));
      setErro("");
    } catch (razao) {
      // Lista vazia com o motivo à vista, e nunca dado velho fingindo ser
      // atual: um painel que continua mostrando o número de antes durante uma
      // falha é pior do que um painel que admite não saber.
      setDados(VAZIO);
      setErro(razao.message);
    } finally {
      setCarregando(false);
    }
  }, [ativo, authHeaders]);

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

  return {
    dados, carregando, erro, recarregar, criar, atualizar, arquivar,
    registrarPagamento, registrarEventoOperacao, listarSubrecurso,
  };
}

export const REGISTROS_VAZIOS = VAZIO;
