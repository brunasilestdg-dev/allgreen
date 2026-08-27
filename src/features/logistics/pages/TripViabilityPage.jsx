import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import {
  MODALIDADES,
  PRODUTOS_OPERACIONAIS,
  RECOMENDACOES,
  REGUA_PADRAO,
  RUBRICAS_SUGERIDAS,
  UNIDADES_CUSTO,
  avaliarViagem,
} from "../tripViabilityDomain.js";
import "./TodoGreenPages.css";

// ===== Aceito esta viagem? =====
//
// O custo é digitado por quem conhece a operação; a margem e a recomendação
// saem da conta. O contrário — margem digitada — é margem desejada, e margem
// desejada não paga diesel.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const VIAGEM_INICIAL = {
  produto: "middle_mile",
  modalidade: "spot",
  modeloReceita: "por_viagem",
  kmPorViagem: "",
  kmRetornoVazio: "",
  horasPorViagem: "",
  freteOferecido: "",
  viagens: "1",
  viagensPorMes: "",
  meses: "12",
  entregas: "",
  entregasPorViagem: "",
  alocacaoVeiculo: "compartilhado",
  veiculosAlocados: "1",
  veiculosDedicados: "",
  diasOperacao: "",
  prazoPagamentoDias: "",
  veiculosDisponiveis: "",
};

const rubricasIniciais = () =>
  RUBRICAS_SUGERIDAS.map((r) => ({
    id: r.id,
    rotulo: r.rotulo,
    unidade: r.unidade,
    valor: "",
    essencial: r.essencial,
  }));

const SELO = {
  [RECOMENDACOES.aceitar]: { rotulo: "Aceitar", icone: CheckCircle2, classe: "aceitar" },
  [RECOMENDACOES.ressalva]: { rotulo: "Aceitar com ressalva", icone: AlertTriangle, classe: "ressalva" },
  [RECOMENDACOES.recusar]: { rotulo: "Não aceitar", icone: XCircle, classe: "recusar" },
  [RECOMENDACOES.semDados]: { rotulo: "Faltam dados", icone: AlertTriangle, classe: "sem-dados" },
};

export default function TripViabilityPage({ authHeaders }) {
  const [viagem, setViagem] = useState(VIAGEM_INICIAL);
  const [rubricas, setRubricas] = useState(rubricasIniciais);
  const [regua, setRegua] = useState(null);

  // A régua em vigor é a mesma que precifica. Se a avaliação de aceite usasse
  // outra, a empresa recusaria frete que ela própria cotaria.
  useEffect(() => {
    let vivo = true;
    fetch("/api/todogreen/pricing-parameters", { headers: authHeaders?.() || {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d?.atual) return;
        const parametros = d.atual.parametros || {};
        setRegua({ ...parametros, versao: d.atual.versao });
        // Os custos essenciais nascem PRÉ-DEFINIDOS pela régua cadastrada —
        // editáveis, mas nunca em branco quando o gestor já definiu os seus.
        // Só o que ainda está vazio é preenchido, para não sobrescrever o que
        // a pessoa digitou enquanto a régua carregava. Sem régua cadastrada,
        // ficam vazios mesmo: pré-preencher com número inventado é pior.
        const daRegua = {
          combustivel: { valor: parametros.energyCostPerKm, unidade: "por_km" },
          motorista: { valor: parametros.driverDailyCost, unidade: "por_veiculo_dia" },
          custo_frota:
            Number(parametros.vehicleMonthlyCost) > 0
              ? { valor: parametros.vehicleMonthlyCost, unidade: "por_veiculo_mes" }
              : { valor: parametros.vehicleDailyCost, unidade: "por_veiculo_dia" },
        };
        setRubricas((atuais) =>
          atuais.map((r) => {
            const sugestao = daRegua[r.id];
            if (!sugestao || r.valor !== "" || !(Number(sugestao.valor) > 0)) return r;
            return { ...r, valor: String(sugestao.valor), unidade: sugestao.unidade };
          }),
        );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [authHeaders]);

  const reguaEmUso = regua || REGUA_PADRAO;

  const numeros = (obj) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === "" ? 0 : Number(v)]));

  const avaliacao = useMemo(
    () =>
      avaliarViagem(
        { ...numeros(viagem), modalidade: viagem.modalidade, produto: viagem.produto, modeloReceita: viagem.modeloReceita },
        rubricas.map((r) => ({ ...r, valor: r.valor === "" ? 0 : Number(r.valor) })),
        reguaEmUso,
      ),
    [viagem, rubricas, reguaEmUso],
  );

  const campo = (chave) => (e) => setViagem((a) => ({ ...a, [chave]: e.target.value }));

  const mudarRubrica = (indice, chave, valor) =>
    setRubricas((atual) =>
      atual.map((r, i) => (i === indice ? { ...r, [chave]: valor } : r)),
    );

  const adicionarRubrica = () =>
    setRubricas((atual) => [
      ...atual,
      { id: `extra-${atual.length}`, rotulo: "", unidade: "por_viagem", valor: "" },
    ]);

  const removerRubrica = (indice) =>
    setRubricas((atual) => atual.filter((_, i) => i !== indice));

  const selo = SELO[avaliacao.recomendacao];
  const Icone = selo.icone;
  const recorrente = viagem.modalidade === "recorrente";
  const produto = PRODUTOS_OPERACIONAIS[viagem.produto] || PRODUTOS_OPERACIONAIS.spot;

  return (
    <section className="tdg-panel tdg-page tdg-via-page">
      <header className="tdg-page-title">
        <div>
          <span>PLANEJAMENTO E PRODUTOS</span>
          <h2>Aceito esta viagem?</h2>
          <p>
            Avalia viagem avulsa, first mile, middle mile, last mile e frota dedicada com custo real,
            veículo alocado, entregas e régua comercial em vigor. Sem custo essencial, o ERP suspende
            a recomendação.
          </p>
        </div>
      </header>

      <div className="tdg-via-layout">
        <div className="tdg-via-entrada">
          <fieldset className="tdg-via-bloco">
            <legend>Produto e modelo comercial</legend>
            <div className="tdg-via-modalidade produto" role="group" aria-label="Produto logístico">
              {Object.values(PRODUTOS_OPERACIONAIS).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={viagem.produto === p.id ? "ativo" : ""}
                  onClick={() => setViagem((a) => ({ ...a, produto: p.id, modeloReceita: p.modeloReceita }))}
                >
                  <strong>{p.rotulo}</strong>
                  <small>{p.descricao}</small>
                </button>
              ))}
            </div>
            <div className="tdg-via-modalidade" role="group" aria-label="Modalidade">
              {Object.values(MODALIDADES).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={viagem.modalidade === m.id ? "ativo" : ""}
                  onClick={() => setViagem((a) => ({ ...a, modalidade: m.id }))}
                >
                  <strong>{m.rotulo}</strong>
                  <small>{m.descricao}</small>
                </button>
              ))}
            </div>

            <div className="tdg-via-campos">
              <label>
                <span>Valor oferecido (R$)</span>
                <input type="number" value={viagem.freteOferecido} onChange={campo("freteOferecido")} />
              </label>
              <label>
                <span>Modelo de cobrança</span>
                <select value={viagem.modeloReceita} onChange={campo("modeloReceita")}>
                  <option value="por_viagem">Por viagem</option>
                  <option value="por_entrega">Por entrega</option>
                  <option value="por_veiculo_dia">Por veículo/dia</option>
                  <option value="por_veiculo_mes">Por veículo/mês</option>
                  <option value="global">Valor global</option>
                </select>
              </label>
              <label>
                <span>Km com carga (ida)</span>
                <input type="number" value={viagem.kmPorViagem} onChange={campo("kmPorViagem")} />
              </label>
              <label>
                <span>Km de retorno vazio</span>
                <input type="number" value={viagem.kmRetornoVazio} onChange={campo("kmRetornoVazio")} />
              </label>
              <label>
                <span>Horas por viagem</span>
                <input type="number" value={viagem.horasPorViagem} onChange={campo("horasPorViagem")} />
              </label>
              <label>
                <span>Alocação do veículo</span>
                <select value={viagem.alocacaoVeiculo} onChange={campo("alocacaoVeiculo")}>
                  <option value="compartilhado">Compartilhado em várias entregas</option>
                  <option value="dedicado">Dedicado ao cliente/operação</option>
                </select>
              </label>
              <label>
                <span>Veículos na operação</span>
                <input type="number" min="0" value={viagem.veiculosAlocados} onChange={campo("veiculosAlocados")} />
              </label>
              {recorrente ? (
                <>
                  <label>
                    <span>Viagens por mês</span>
                    <input type="number" value={viagem.viagensPorMes} onChange={campo("viagensPorMes")} />
                  </label>
                  <label>
                    <span>Meses de contrato</span>
                    <input type="number" value={viagem.meses} onChange={campo("meses")} />
                  </label>
                  <label>
                    <span>Veículos alocados</span>
                    <input
                      type="number"
                      value={viagem.veiculosDisponiveis}
                      onChange={campo("veiculosDisponiveis")}
                    />
                  </label>
                </>
              ) : (
                <label>
                  <span>Quantas viagens</span>
                  <input type="number" value={viagem.viagens} onChange={campo("viagens")} />
                </label>
              )}
              {(viagem.produto === "last_mile" || viagem.modeloReceita === "por_entrega") && (
                <>
                  <label>
                    <span>Entregas totais</span>
                    <input type="number" value={viagem.entregas} onChange={campo("entregas")} />
                  </label>
                  <label>
                    <span>Entregas por viagem</span>
                    <input type="number" value={viagem.entregasPorViagem} onChange={campo("entregasPorViagem")} />
                  </label>
                </>
              )}
              {(viagem.produto === "dedicada" || viagem.modeloReceita.includes("veiculo") || viagem.alocacaoVeiculo === "dedicado") && (
                <>
                  <label>
                    <span>Veículos dedicados</span>
                    <input type="number" value={viagem.veiculosDedicados} onChange={campo("veiculosDedicados")} />
                  </label>
                  <label>
                    <span>Dias de operação</span>
                    <input type="number" value={viagem.diasOperacao} onChange={campo("diasOperacao")} />
                  </label>
                </>
              )}
              <label>
                <span>Prazo de pagamento (dias)</span>
                <input
                  type="number"
                  value={viagem.prazoPagamentoDias}
                  onChange={campo("prazoPagamentoDias")}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="tdg-via-bloco">
            <legend>Os seus custos</legend>
            <p className="tdg-via-ressalva">
              Lance combustível, motorista e custo do veículo. A unidade define a conta:
              km rodado inclui retorno vazio; veículo/mês é rateado pela alocação informada.
            </p>
            <ul className="tdg-via-rubricas">
              {rubricas.map((rubrica, indice) => (
                <li key={rubrica.id}>
                  <input
                    aria-label={`Nome do custo ${indice + 1}`}
                    value={rubrica.rotulo}
                    placeholder="Nome do custo"
                    onChange={(e) => mudarRubrica(indice, "rotulo", e.target.value)}
                  />
                  <input
                    type="number"
                    aria-label={`Valor de ${rubrica.rotulo || `custo ${indice + 1}`}`}
                    value={rubrica.valor}
                    placeholder="0,00"
                    onChange={(e) => mudarRubrica(indice, "valor", e.target.value)}
                  />
                  <select
                    aria-label={`Unidade de ${rubrica.rotulo || `custo ${indice + 1}`}`}
                    value={rubrica.unidade}
                    onChange={(e) => mudarRubrica(indice, "unidade", e.target.value)}
                  >
                    {Object.values(UNIDADES_CUSTO).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.rotulo}
                      </option>
                    ))}
                  </select>
                  {rubrica.essencial ? (
                    <span className="tdg-via-essencial" title="Sem este custo não há recomendação">
                      essencial
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remover ${rubrica.rotulo || `custo ${indice + 1}`}`}
                      onClick={() => removerRubrica(indice)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="tdg-action" onClick={adicionarRubrica}>
              <Plus size={15} />
              Acrescentar custo
            </button>
          </fieldset>
        </div>

        <div className="tdg-via-saida">
          <div className={`tdg-via-veredito ${selo.classe}`}>
            <Icone size={22} />
            <div>
              <strong>{selo.rotulo}</strong>
              <p>{avaliacao.motivo}</p>
              <small>{avaliacao.acao}</small>
            </div>
          </div>

          {avaliacao.custosFaltando.length > 0 && (
            <ul className="tdg-via-faltando">
              {avaliacao.custosFaltando.map((c) => (
                <li key={c.id}>Falta lançar: {c.rotulo}</li>
              ))}
            </ul>
          )}

          <div className="tdg-via-numeros">
            <article>
              <small>Margem</small>
              <strong>{NUM.format(avaliacao.economia.margemPercent)}%</strong>
              <span>
                piso {reguaEmUso.minimumMarginPercent}% · alvo {reguaEmUso.targetMarginPercent}%
              </span>
            </article>
            <article>
              <small>Resultado</small>
              <strong>{BRL.format(avaliacao.economia.resultado)}</strong>
              <span>depois de custo e comissão</span>
            </article>
            <article>
              <small>Frete no piso</small>
              <strong>{BRL.format(avaliacao.economia.precoMinimo)}</strong>
              <span>
                {avaliacao.volume.viagens > 1
                  ? `${BRL.format(avaliacao.economia.precoMinimoPorViagem)} por viagem`
                  : "para não ir abaixo da margem mínima"}
              </span>
            </article>
            <article>
              <small>Frete no alvo</small>
              <strong>{BRL.format(avaliacao.economia.precoAlvo)}</strong>
              <span>
                {avaliacao.volume.viagens > 1
                  ? `${BRL.format(avaliacao.economia.precoAlvoPorViagem)} por viagem`
                  : "para atingir a margem alvo"}
              </span>
            </article>
            {avaliacao.volume.veiculoMes > 0 && (
              <article>
                <small>Alvo por veículo/mês</small>
                <strong>{BRL.format(avaliacao.economia.precoAlvoPorVeiculoMes)}</strong>
                <span>para frota dedicada</span>
              </article>
            )}
            {avaliacao.volume.entregas > 0 && (
              <article>
                <small>Receita por entrega</small>
                <strong>{BRL.format(avaliacao.economia.receitaPorEntrega)}</strong>
                <span>{produto.rotulo}</span>
              </article>
            )}
          </div>

          <div className="tdg-via-bloco">
            <h3>Como a margem foi calculada</h3>
            <dl className="tdg-via-conta">
              <div>
                <dt>Frete</dt>
                <dd>{BRL.format(avaliacao.economia.receitaBruta)}</dd>
              </div>
              <div>
                <dt>Custo direto</dt>
                <dd>− {BRL.format(avaliacao.economia.custoDireto)}</dd>
              </div>
              <div>
                <dt>OPEX, administrativo, imposto e risco</dt>
                <dd>− {BRL.format(avaliacao.economia.encargos.total)}</dd>
              </div>
              <div>
                <dt>Comissão</dt>
                <dd>− {BRL.format(avaliacao.economia.comissao)}</dd>
              </div>
              <div className="tdg-via-total">
                <dt>Sobra</dt>
                <dd>{BRL.format(avaliacao.economia.resultado)}</dd>
              </div>
            </dl>
            <p className="tdg-via-ressalva">
              Régua {avaliacao.economia.versaoRegua || "padrão"} · custo de{" "}
              {BRL.format(avaliacao.economia.custoPorKm)} por km rodado ·{" "}
              {NUM.format(avaliacao.volume.kmTotal)} km no total ·{" "}
              {NUM.format(avaliacao.volume.veiculos)} veículo(s) em alocação {avaliacao.volume.alocacaoVeiculo}
              {avaliacao.volume.percentVazio > 0
                ? `, sendo ${NUM.format(avaliacao.volume.percentVazio)}% vazio`
                : ""}
              .
            </p>
          </div>

          {avaliacao.custo.itens.length > 0 && (
            <div className="tdg-via-bloco">
              <h3>Onde o dinheiro vai</h3>
              <ul className="tdg-via-itens">
                {avaliacao.custo.itens.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.rotulo}</strong>
                      <small>{item.memoria}</small>
                    </span>
                    <b>{BRL.format(item.subtotal)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {avaliacao.ressalvas.length > 0 && (
            <ul className="tdg-via-ressalvas">
              {avaliacao.ressalvas.map((r) => (
                <li key={r.texto} className={`g-${r.gravidade}`}>
                  {r.texto}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
