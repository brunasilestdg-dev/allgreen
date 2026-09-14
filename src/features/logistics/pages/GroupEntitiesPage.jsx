import { useMemo, useState } from "react";
import { Layers, Repeat2, TriangleAlert } from "lucide-react";
import {
  BUSINESS_UNITS,
  ENTITY_TYPES,
  createSharedEntity,
  exposeToBusiness,
  isExposedTo,
  groupMetrics,
  findDuplicates,
  consolidatedUsage,
} from "../groupSharedEntitiesDomain.js";
import "./TodoGreenPages.css";

// Core All Green — a página que finalmente mostra que veículo, motorista,
// energia e carregador são do GRUPO, não da To Do Green só. O usuário
// vê aqui o mesmo veículo circulando por TDG (opera), Greenmob (loca) e
// Green On (recarrega) — sem duplicar linha.

const TYPE_LABELS = {
  vehicle: "Veículo",
  driver: "Motorista",
  charger: "Carregador",
  energyPoint: "Ponto de energia",
  paymentAccount: "Conta de pagamento",
};
const BU_LABELS = { todogreen: "To Do Green", greenon: "Green On", greenmob: "Greenmob" };
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const semente = (() => {
  let v = createSharedEntity({ type: "vehicle", ownerBu: "todogreen", data: { placa: "TDG5A22", modelo: "eDelivery 3.5t", autonomia: 240 } });
  v = exposeToBusiness(v, { bu: "greenmob", scope: "rent", startYmd: "2026-01-01" });
  v = exposeToBusiness(v, { bu: "greenon", scope: "consume", startYmd: "2026-01-01" });
  let d = createSharedEntity({ type: "driver", ownerBu: "todogreen", data: { nome: "Ana Paula", cpf: "12345678901" } });
  d = exposeToBusiness(d, { bu: "greenmob", scope: "operate", startYmd: "2026-01-01", restrictions: ["cpf"] });
  let c = createSharedEntity({ type: "charger", ownerBu: "greenon", data: { serial: "GO-2201", potenciaKw: 60 } });
  c = exposeToBusiness(c, { bu: "todogreen", scope: "consume", startYmd: "2026-01-01" });
  return [v, d, c];
})();

const movimentos = [
  { entityId: semente[0].id, bu: "todogreen", km: 4200, receitaReais: 12000, custoReais: 6000 },
  { entityId: semente[0].id, bu: "greenmob", dias: 15, receitaReais: 8000, custoReais: 500 },
  { entityId: semente[0].id, bu: "greenon", sessoes: 12, kwh: 320, receitaReais: 1000, custoReais: 200 },
];

export default function GroupEntitiesPage() {
  const [entities] = useState(semente);
  const [buFiltro, setBuFiltro] = useState("");
  const hoje = new Date().toISOString().slice(0, 10);

  const metrics = useMemo(() => groupMetrics(entities, hoje), [entities, hoje]);
  const dupes = useMemo(() => findDuplicates(entities), [entities]);
  const uso = useMemo(() => consolidatedUsage(semente[0], movimentos), []);

  const lista = useMemo(() => {
    if (!buFiltro) return entities;
    return entities.filter((e) => isExposedTo(e, buFiltro, null, hoje));
  }, [entities, buFiltro, hoje]);

  return (
    <div className="tdg-page">
      <header className="tdg-page-title">
        <div>
          <span>CORE ALL GREEN · P0</span>
          <h2>Entidades compartilhadas do Grupo</h2>
          <p>Veículo, motorista, carregador e conta são do GRUPO. Cada negócio (To Do Green, Green On, Greenmob) enxerga a mesma linha por exposição declarada — sem duplicar cadastro. É a arquitetura que a titular pediu para tirar do &ldquo;girar em torno da TDG&rdquo;.</p>
        </div>
      </header>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Layers size={20} /></span><div><strong>Registros ativos</strong><small>{metrics.total} no grupo · {metrics.tipos.reduce((s, t) => s + t.compartilhados, 0)} compartilhado(s)</small></div></div>
        <div className="tdg-recarga-metrics">
          {metrics.tipos.map((t) => (
            <article key={t.type}><small>{TYPE_LABELS[t.type] || t.type}</small><strong>{t.total} · {t.compartilhados} compart.</strong></article>
          ))}
        </div>
        {metrics.expostosVencidos > 0 && (
          <p className="tdg-driver-nota">{metrics.expostosVencidos} exposição(ões) vencida(s). Encerre no cadastro para não deixar acesso residual.</p>
        )}
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Repeat2 size={20} /></span><div><strong>Visão consolidada · Veículo compartilhado</strong><small>{semente[0].data.placa} · {semente[0].data.modelo}</small></div></div>
        <div className="tdg-tabela-frame">
          <table className="tdg-tabela">
            <thead><tr><th>Negócio</th><th>Km</th><th>Dias locado</th><th>Sessões</th><th>Receita</th><th>Custo</th><th>Margem</th></tr></thead>
            <tbody>
              {uso.map((u) => (
                <tr key={u.bu}>
                  <td>{BU_LABELS[u.bu] || u.bu}</td>
                  <td>{u.km ? u.km.toLocaleString("pt-BR") : "—"}</td>
                  <td>{u.dias || "—"}</td>
                  <td>{u.sessoes || "—"}</td>
                  <td>{moeda.format(u.receitaReais)}</td>
                  <td>{moeda.format(u.custoReais)}</td>
                  <td><strong>{moeda.format(u.receitaReais - u.custoReais)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tdg-driver-nota">Este mesmo veículo circulou pelas três casas do Grupo. É UMA linha no banco; as visões vêm de exposição por período e escopo — nunca de cadastro duplicado.</p>
      </article>

      <article className="tdg-panel">
        <div className="tdg-work-area-heading"><span><Layers size={20} /></span><div><strong>Registros do Grupo</strong><small>{lista.length} listado(s){buFiltro ? ` para ${BU_LABELS[buFiltro]}` : ""}</small></div></div>
        <div className="tdg-recarga-filtros">
          <label>Ver como
            <select value={buFiltro} onChange={(e) => setBuFiltro(e.target.value)}>
              <option value="">Grupo (dono)</option>
              {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{BU_LABELS[b] || b}</option>)}
            </select>
          </label>
        </div>
        <div className="tdg-tabela-frame">
          <table className="tdg-tabela">
            <thead><tr><th>Tipo</th><th>Dono do cadastro</th><th>Identidade</th><th>Exposto a</th></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td>{TYPE_LABELS[e.type]}</td>
                  <td>{BU_LABELS[e.ownerBu] || e.ownerBu}</td>
                  <td>{e.data?.placa || e.data?.nome || e.data?.serial || e.id}</td>
                  <td>{(e.exposures || []).map((x) => `${BU_LABELS[x.bu]} · ${x.scope}`).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {dupes.length > 0 && (
        <article className="tdg-panel">
          <div className="tdg-work-area-heading"><span><TriangleAlert size={20} /></span><div><strong>Cadastros duplicados detectados</strong><small>{dupes.length}</small></div></div>
          <p className="tdg-driver-nota">Duplicidade por chave natural (placa, CPF, serial). O Core deveria manter UMA linha; investigue antes de consolidar.</p>
        </article>
      )}

      {ENTITY_TYPES.length > 0 && <span data-total-types={ENTITY_TYPES.length} hidden />}
    </div>
  );
}
