// Lógica pura da bipagem de volumes no TMS.
//
// Um leitor físico de código de barras (coletor USB/Bluetooth) é, para o
// navegador, só um teclado que digita muito rápido e aperta Enter. O operador
// de esteira trabalha quase sem olhar a tela e, na correria, bipa o mesmo
// volume duas vezes sem perceber. Este módulo concentra as decisões que dão
// para testar sem DOM nem áudio: normalizar o código, reconhecer o bip
// repetido dentro de uma janela curta e resumir a leva. O componente cuida do
// que é efeito colateral (rede, beep, foco).

export const JANELA_DUPLICADA_MS = 4000;

export function normalizarTrackId(bruto) {
  return String(bruto ?? "").trim();
}

// `recentes` é um array de { trackId, quando } (quando = epoch em ms). Uma
// leitura é duplicada se o mesmo Track ID aparece dentro da janela — bip
// acidental duplo no mesmo volume, que não deve virar um segundo evento.
export function ehDuplicada(trackId, recentes, agora, janelaMs = JANELA_DUPLICADA_MS) {
  const alvo = normalizarTrackId(trackId);
  if (!alvo) return false;
  return (recentes || []).some(
    (r) => normalizarTrackId(r.trackId) === alvo && agora - r.quando < janelaMs,
  );
}

// Mantém só as leituras ainda dentro da janela e acrescenta a nova, para a
// lista de controle não crescer sem limite ao longo do turno.
export function registrarRecente(recentes, trackId, agora, janelaMs = JANELA_DUPLICADA_MS) {
  const alvo = normalizarTrackId(trackId);
  const vivas = (recentes || []).filter((r) => agora - r.quando < janelaMs);
  return [...vivas, { trackId: alvo, quando: agora }];
}

// Resumo da leva para o cabeçalho: quantas leituras deram certo, quantas
// falharam e quantas foram ignoradas por serem repetição.
export function resumoDaLeva(historico) {
  return (historico || []).reduce(
    (acc, item) => {
      if (item.ok) acc.ok += 1;
      else if (item.duplicada) acc.duplicadas += 1;
      else acc.erros += 1;
      return acc;
    },
    { ok: 0, erros: 0, duplicadas: 0 },
  );
}
