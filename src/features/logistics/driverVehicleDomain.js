// ===== Telemetria elétrica ao vivo do veículo do motorista =====
//
// A frota guarda o snapshot ao vivo (SOC, autonomia, quando foi lido — 0107),
// mas hoje a maioria dos rastreadores só manda posição, então esses campos
// nascem NULL. A regra de ouro do produto: NUNCA mostrar "0%" quando não há
// leitura. Zero de bateria e ausência de leitura são coisas diferentes — este
// domínio distingue as duas e devolve a idade da leitura, para a tela dizer a
// verdade ("sem leitura elétrica" x "bateria 62% · lida há 8 min").

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const socValido = (v) => {
  const n = num(v);
  return n == null ? null : Math.min(100, Math.max(0, n));
};

const autonomiaValida = (v) => {
  const n = num(v);
  return n == null || n < 0 ? null : n;
};

// Quão fresca é a leitura, em minutos, comparada a `agoraISO`. null se não há
// carimbo de leitura ou se as datas não fazem sentido.
export const minutosDesde = (lidoEm, agoraISO) => {
  if (!lidoEm) return null;
  const t = new Date(lidoEm).getTime();
  const agora = new Date(agoraISO || 0).getTime();
  if (Number.isNaN(t) || Number.isNaN(agora) || agora < t) return null;
  return Math.floor((agora - t) / 60000);
};

// Classifica a leitura: recente (<=30min), do dia (<=24h), antiga, ou sem
// leitura. É isso que decide se a tela pode confiar no número ao vivo.
export const frescorDaLeitura = (minutos) => {
  if (minutos == null) return "sem-leitura";
  if (minutos <= 30) return "recente";
  if (minutos <= 24 * 60) return "do-dia";
  return "antiga";
};

// Resumo da telemetria de UM veículo, pronto para a tela. `veiculo` vem da
// linha da frota (placa/prefixo + last_soc_percent/last_range_km/
// last_telemetry_at/last_telemetry_source, já em camelCase).
export const resumoTelemetriaVeiculo = (veiculo, agoraISO) => {
  if (!veiculo || !veiculo.placa) return { temVeiculo: false };

  const socPercent = socValido(veiculo.socPercent);
  const autonomiaKm = autonomiaValida(veiculo.autonomiaKm);
  const lidoEm = veiculo.lidoEm || "";
  const minutos = minutosDesde(lidoEm, agoraISO);
  // Só é "leitura ao vivo" quando existe carimbo E ao menos um dos valores.
  const temLeitura = Boolean(lidoEm) && (socPercent != null || autonomiaKm != null);

  return {
    temVeiculo: true,
    placa: veiculo.placa,
    prefixo: veiculo.prefixo || "",
    temLeitura,
    socPercent: temLeitura ? socPercent : null,
    autonomiaKm: temLeitura ? autonomiaKm : null,
    lidoEm: temLeitura ? lidoEm : "",
    minutosAtras: temLeitura ? minutos : null,
    fonte: temLeitura ? (veiculo.fonte || "") : "",
    frescor: temLeitura ? frescorDaLeitura(minutos) : "sem-leitura",
  };
};
