// ===== Os crons do Worker =====
//
// Contrato
// - Exporta: CRON_HORARIO e CRON_SEMANAL, os padrões dos dois disparos
//   agendados, e ehDisparoSemanal(controller).
// - Quem usa: o `scheduled` de worker.js e o de worker-entry.js.
// - Regra: os padrões PRECISAM bater com `triggers.crons` do wrangler.jsonc
//   (["0 * * * *", "0 12 * * 1"]). O Cloudflare entrega em `controller.cron` o
//   texto do cron que disparou, e é por ele que o scheduled decide o que roda.
//
// Às segundas, 12:00 UTC, os dois crons disparam no mesmo minuto — cada um na
// sua invocação do scheduled. A semanal roda só o que é semanal. Qualquer
// outra (a horária, ou um disparo manual sem `cron`) roda os jobs horários.
// Sem essa separação os jobs horários rodavam duas vezes, em paralelo, toda
// segunda ao meio-dia.

export const CRON_HORARIO = "0 * * * *";
export const CRON_SEMANAL = "0 12 * * 1";

export const ehDisparoSemanal = (controller) =>
  controller?.cron === CRON_SEMANAL;
