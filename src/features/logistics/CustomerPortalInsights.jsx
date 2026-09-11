import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, BatteryCharging, Leaf, Loader2, MessageSquare, Route, Send, ShieldCheck, Truck } from "lucide-react";
import { planejarCenario, PORTES_REFERENCIA } from "./planejarDomain.js";

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const moedaExata = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const estilo = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 },
  card: { border: "1px solid rgba(45, 75, 59, .16)", borderRadius: 14, padding: 18, background: "rgba(255,255,255,.72)" },
  titulo: { margin: 0, fontSize: 18 },
  texto: { margin: "8px 0 0", color: "#526057", lineHeight: 1.55 },
  barra: { height: 9, borderRadius: 999, background: "rgba(45,75,59,.11)", overflow: "hidden", marginTop: 10 },
  progresso: (valor) => ({ height: "100%", width: `${Math.max(0, Math.min(100, Number(valor) || 0))}%`, background: "#496f5a", borderRadius: 999 }),
  cabecalho: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 },
  selo: { display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 999, background: "rgba(73,111,90,.10)", color: "#345242", fontSize: 12, fontWeight: 700 },
  lista: { display: "grid", gap: 10, padding: 0, margin: "14px 0 0", listStyle: "none" },
  linha: { display: "flex", justifyContent: "space-between", gap: 18, borderBottom: "1px solid rgba(45,75,59,.10)", paddingBottom: 9 },
};

const rotulosComponentes = {
  reducaoEmissoes: "Redução de emissões",
  reducao_emissoes: "Redução de emissões",
  kmBaixaEmissao: "Quilômetros de baixa emissão",
  km_baixa_emissao: "Quilômetros de baixa emissão",
  energiaLimpa: "Energia limpa",
  energia_limpa: "Energia limpa",
  eficienciaOperacional: "Eficiência operacional",
  eficiencia_operacional: "Eficiência operacional",
  ocupacao: "Ocupação da capacidade",
  evolucaoMeta: "Evolução contra a meta",
  evolucao_meta: "Evolução contra a meta",
  qualidadeDados: "Qualidade dos dados",
  qualidade_dados: "Qualidade dos dados",
  evidencias: "Evidências do portal",
};

const formatarComponente = (chave) =>
  rotulosComponentes[chave] || String(chave).replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

function EstadoVazio({ titulo, texto }) {
  return (
    <div className="cp-vazio">
      <Leaf size={22} />
      <strong>{titulo}</strong>
      <p>{texto}</p>
    </div>
  );
}

export function GreenScoreDetalhado({ resumo }) {
  const score = resumo?.greenScore;
  const componentes = useMemo(() => Object.entries(score?.componentes || score?.components || {}), [score]);

  if (!score)
    return (
      <EstadoVazio
        titulo="Green Score ainda não calculado"
        texto="A nota será exibida quando houver operações, fatores ambientais e qualidade mínima de dados suficientes para o cálculo."
      />
    );

  const valor = Number(score.valor ?? score.score ?? 0);
  const anterior = Number(score.anterior ?? score.previousScore ?? 0);
  const variacao = anterior ? valor - anterior : null;

  return (
    <section>
      <div style={estilo.cabecalho}>
        <div>
          <span style={estilo.selo}><ShieldCheck size={15} /> Indicador proprietário da To Do Green</span>
          <h2 style={{ ...estilo.titulo, fontSize: 26, marginTop: 12 }}>Green Score {numero.format(valor)}/100</h2>
          <p style={estilo.texto}>A nota combina impacto ambiental, eficiência operacional e confiabilidade das evidências. Não é uma certificação externa.</p>
        </div>
        {variacao !== null && <strong>{variacao >= 0 ? "+" : ""}{numero.format(variacao)} ponto(s)</strong>}
      </div>

      <div style={estilo.grid}>
        <div style={estilo.card}>
          <span>Nota atual</span>
          <strong style={{ display: "block", fontSize: 34, marginTop: 8 }}>{numero.format(valor)}</strong>
          <div style={estilo.barra}><div style={estilo.progresso(valor)} /></div>
        </div>
        <div style={estilo.card}>
          <span>Versão dos pesos</span>
          <strong style={{ display: "block", fontSize: 22, marginTop: 8 }}>{score.versaoPesos || score.weightsVersion || "—"}</strong>
          <p style={estilo.texto}>Mantém a nota rastreável quando a metodologia evolui.</p>
        </div>
        <div style={estilo.card}>
          <span>Qualidade dos dados</span>
          <strong style={{ display: "block", fontSize: 22, marginTop: 8 }}>{numero.format(score.qualidadeDados ?? resumo?.ambiental?.qualidadeDados ?? 0)}%</strong>
          <p style={estilo.texto}>Quanto maior, mais confiável é o uso do indicador em relatórios.</p>
        </div>
      </div>

      <div style={{ ...estilo.card, marginTop: 16 }}>
        <h3 style={estilo.titulo}>Composição da nota</h3>
        {componentes.length ? (
          <ul style={estilo.lista}>
            {componentes.map(([chave, bruto]) => {
              const valorComponente = typeof bruto === "object" ? bruto.valor ?? bruto.score ?? 0 : bruto;
              return (
                <li key={chave}>
                  <div style={estilo.linha}><span>{formatarComponente(chave)}</span><strong>{numero.format(valorComponente)}</strong></div>
                  <div style={estilo.barra}><div style={estilo.progresso(valorComponente)} /></div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={estilo.texto}>A memória de cálculo detalhada está disponível nos relatórios exportáveis.</p>
        )}
      </div>
    </section>
  );
}

export function ImpactoAmbiental({ resumo }) {
  const ambiental = resumo?.ambiental;
  const operacoes = resumo?.operacoes;
  if (!ambiental || resumo?.semDados)
    return (
      <EstadoVazio
        titulo="Impacto ambiental ainda não disponível"
        texto="Os indicadores serão calculados a partir das operações registradas e das evidências de consumo, distância, veículo e energia."
      />
    );

  const convencional = Number(ambiental.emissaoConvencionalKg ?? ambiental.co2ReferenciaKg ?? 0);
  const realizado = Number(ambiental.emissaoTodogreenKg ?? ambiental.co2EmitidoKg ?? Math.max(0, convencional - Number(ambiental.co2EvitadoKg || 0)));

  return (
    <section>
      <div style={estilo.cabecalho}>
        <div>
          <span style={estilo.selo}><Leaf size={15} /> Resultado ambiental do seu contrato</span>
          <h2 style={{ ...estilo.titulo, fontSize: 26, marginTop: 12 }}>Emissões e impacto ambiental</h2>
          <p style={estilo.texto}>Comparação entre o cenário logístico convencional e a operação realizada pela To Do Green, com memória de cálculo auditável.</p>
        </div>
      </div>

      <div className="cp-indicadores">
        <div className="cp-indicador bom"><span>CO₂ evitado</span><strong>{numero.format(Number(ambiental.co2EvitadoKg || 0) / 1000)} t</strong><small>{numero.format(ambiental.reducaoPercent || 0)}% de redução</small></div>
        <div className="cp-indicador"><span>Diesel não consumido</span><strong>{inteiro.format(ambiental.dieselEvitadoL || 0)} L</strong><small>comparação com cenário de referência</small></div>
        <div className="cp-indicador"><span>Distância monitorada</span><strong>{inteiro.format(operacoes?.distanciaKm || 0)} km</strong><small>{inteiro.format(operacoes?.total || 0)} operação(ões)</small></div>
        <div className="cp-indicador"><span>Qualidade dos dados</span><strong>{numero.format(ambiental.qualidadeDados || 0)}%</strong><small>{inteiro.format(ambiental.calculos || 0)} cálculo(s) auditável(is)</small></div>
      </div>

      {(convencional > 0 || realizado > 0) && (
        <div style={{ ...estilo.card, marginTop: 16 }}>
          <h3 style={estilo.titulo}>Comparação de cenários</h3>
          <ul style={estilo.lista}>
            <li style={estilo.linha}><span>Cenário convencional</span><strong>{numero.format(convencional / 1000)} t CO₂e</strong></li>
            <li style={estilo.linha}><span>Operação To Do Green</span><strong>{numero.format(realizado / 1000)} t CO₂e</strong></li>
            <li style={estilo.linha}><span>Redução alcançada</span><strong>{numero.format(ambiental.reducaoPercent || 0)}%</strong></li>
          </ul>
        </div>
      )}

      {Number(ambiental.qualidadeDados || 0) < 70 && Number(ambiental.qualidadeDados || 0) > 0 && (
        <div className="cp-alerta" style={{ marginTop: 16 }}><AlertTriangle size={18} /><span>A qualidade atual permite acompanhar tendência, mas ainda exige cautela para uso regulatório ou divulgação externa.</span></div>
      )}
    </section>
  );
}

export function PlanejarEletrificacao() {
  // Tudo aqui é cálculo puro (planejarDomain), no navegador do cliente: não há
  // rede, não há dado de outro cliente. O cliente informa a operação dele e vê
  // o cenário. Os números são estimativa a partir de referências — a tela diz.
  const [modo, setModo] = useState("km"); // "km" | "entregas"
  const [kmPorDia, setKmPorDia] = useState("");
  const [entregasPorDia, setEntregasPorDia] = useState("");
  const [kmPorEntrega, setKmPorEntrega] = useState("");
  const [porte, setPorte] = useState("medio");
  const [autonomiaKm, setAutonomiaKm] = useState("");
  const [valorEletrico, setValorEletrico] = useState("");
  const [valorDiesel, setValorDiesel] = useState("");

  const cenario = useMemo(
    () => planejarCenario({
      porte,
      kmPorDia: modo === "km" ? Number(kmPorDia) || 0 : 0,
      entregasPorDia: modo === "entregas" ? Number(entregasPorDia) || 0 : 0,
      kmPorEntrega: modo === "entregas" ? Number(kmPorEntrega) || 0 : 0,
      autonomiaKm: autonomiaKm ? Number(autonomiaKm) : null,
      valorEletrico: Number(valorEletrico) || 0,
      valorDiesel: Number(valorDiesel) || 0,
    }),
    [modo, kmPorDia, entregasPorDia, kmPorEntrega, porte, autonomiaKm, valorEletrico, valorDiesel],
  );

  const { frota, comparacao, carregadores, custoPorEntrega, demanda, veiculo, disponivel } = cenario;

  return (
    <section>
      <div style={estilo.cabecalho}>
        <div>
          <span style={estilo.selo}><Route size={15} /> Simulação da sua operação</span>
          <h2 style={{ ...estilo.titulo, fontSize: 26, marginTop: 12 }}>Planejar a eletrificação</h2>
          <p style={estilo.texto}>Informe a sua operação e veja quantos veículos e carregadores ela pede, quanto economiza por mês, quanto CO₂ evita e em quanto tempo o investimento se paga. Os valores são estimativa a partir de referências técnicas — a operação real confirma.</p>
        </div>
      </div>

      <div style={{ ...estilo.card, marginBottom: 16 }}>
        <div className="cp-plan-modo" role="tablist" aria-label="Como informar a demanda">
          <button type="button" role="tab" aria-selected={modo === "km"} className={modo === "km" ? "ativo" : ""} onClick={() => setModo("km")}>Por quilometragem</button>
          <button type="button" role="tab" aria-selected={modo === "entregas"} className={modo === "entregas" ? "ativo" : ""} onClick={() => setModo("entregas")}>Por entregas</button>
        </div>

        <div className="cp-plan-form">
          {modo === "km" ? (
            <label>Quilometragem diária<div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={kmPorDia} onChange={(e) => setKmPorDia(e.target.value)} placeholder="ex.: 1000" /><em>km/dia</em></div></label>
          ) : (
            <>
              <label>Entregas por dia<div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={entregasPorDia} onChange={(e) => setEntregasPorDia(e.target.value)} placeholder="ex.: 50" /><em>entregas</em></div></label>
              <label>Distância por entrega<div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={kmPorEntrega} onChange={(e) => setKmPorEntrega(e.target.value)} placeholder="ex.: 12" /><em>km</em></div></label>
            </>
          )}
          <label>Porte do veículo<select value={porte} onChange={(e) => setPorte(e.target.value)}>{PORTES_REFERENCIA.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}</select></label>
          <label>Autonomia real <small>(opcional)</small><div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={autonomiaKm} onChange={(e) => setAutonomiaKm(e.target.value)} placeholder={`ref.: ${veiculo.autonomiaKm}`} /><em>km</em></div></label>
          <label>Preço do elétrico <small>(opcional)</small><div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={valorEletrico} onChange={(e) => setValorEletrico(e.target.value)} placeholder="ex.: 500000" /><em>R$</em></div></label>
          <label>Preço do diesel <small>(opcional)</small><div className="cp-plan-input"><input type="number" min="0" inputMode="decimal" value={valorDiesel} onChange={(e) => setValorDiesel(e.target.value)} placeholder="ex.: 280000" /><em>R$</em></div></label>
        </div>
        {veiculo.referencia && (
          <p style={{ ...estilo.texto, marginTop: 12, fontSize: 13 }}>Usando a referência do porte {veiculo.porteRotulo}: autonomia {veiculo.autonomiaKm} km, consumo {numero.format(veiculo.kwhPorKm)} kWh/km. Informe a autonomia real para ajustar.</p>
        )}
      </div>

      {!disponivel ? (
        <EstadoVazio
          titulo="Preencha a operação para simular"
          texto="Informe a quilometragem diária — direta ou por entregas — para montar o cenário. O restante são referências que você pode ajustar."
        />
      ) : (
        <>
          <div className="cp-indicadores">
            <div className="cp-indicador"><span>Veículos elétricos</span><strong>{inteiro.format(frota.resumo.veiculosTotal)}</strong><small>{inteiro.format(frota.resumo.veiculosPorDemanda)} na operação + {inteiro.format(frota.resumo.veiculosReserva)} de reserva</small></div>
            <div className="cp-indicador"><span>Carregadores</span><strong>{inteiro.format(carregadores.carregadores)}</strong><small>{inteiro.format(carregadores.pontosNoturnos)} noturnos · {inteiro.format(carregadores.pontosDiurnos)} de oportunidade</small></div>
            <div className={comparacao.delta.economiaOperacionalMes >= 0 ? "cp-indicador bom" : "cp-indicador"}><span>Economia operacional</span><strong>{moeda.format(comparacao.delta.economiaOperacionalMes)}</strong><small>por mês · {moeda.format(comparacao.delta.economiaOperacionalAno)}/ano</small></div>
            <div className="cp-indicador bom"><span>CO₂ evitado</span><strong>{numero.format(comparacao.delta.co2EvitadoMesKg / 1000)} t</strong><small>por mês · {numero.format(comparacao.delta.co2EvitadoAnoKg / 1000)} t/ano</small></div>
          </div>

          <div style={estilo.grid}>
            <div style={estilo.card}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Truck size={15} /> Frota necessária</span>
              <ul style={estilo.lista}>
                <li style={estilo.linha}><span>Quilometragem diária</span><strong>{inteiro.format(demanda.kmPorDia)} km</strong></li>
                <li style={estilo.linha}><span>Km por veículo/dia</span><strong>{inteiro.format(frota.resumo.kmPorVeiculoDia)} km</strong></li>
                <li style={estilo.linha}><span>Recargas por dia</span><strong>{inteiro.format(frota.resumo.recargasPorVeiculoDia)}</strong></li>
                <li style={estilo.linha}><span>Gargalo</span><strong>{frota.resumo.gargalo === "autonomia" ? "Autonomia / recarga" : "Quilometragem"}</strong></li>
              </ul>
            </div>

            <div style={estilo.card}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><BatteryCharging size={15} /> Custo mensal (energia + manutenção)</span>
              <ul style={estilo.lista}>
                <li style={estilo.linha}><span>Elétrico</span><strong>{moeda.format(comparacao.eletrico.operacionalMes)}</strong></li>
                <li style={estilo.linha}><span>Diesel</span><strong>{moeda.format(comparacao.diesel.operacionalMes)}</strong></li>
                <li style={estilo.linha}><span>Diferença mensal</span><strong>{moeda.format(comparacao.delta.economiaOperacionalMes)}</strong></li>
                {custoPorEntrega && <li style={estilo.linha}><span>Custo por entrega (elétrico)</span><strong>{moedaExata.format(custoPorEntrega.eletrico)}</strong></li>}
                {custoPorEntrega && <li style={estilo.linha}><span>Economia por entrega</span><strong>{moedaExata.format(custoPorEntrega.economia)}</strong></li>}
              </ul>
            </div>

            <div style={estilo.card}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><BarChart3 size={15} /> Retorno do investimento</span>
              {comparacao.delta.paybackMeses != null ? (
                <>
                  <strong style={{ display: "block", fontSize: 30, marginTop: 10 }}>{comparacao.delta.paybackMeses === 0 ? "Imediato" : `${numero.format(comparacao.delta.paybackMeses)} meses`}</strong>
                  <p style={estilo.texto}>Tempo para a economia operacional cobrir o quanto o elétrico custa a mais na compra{comparacao.delta.capexDelta != null ? ` (${moeda.format(comparacao.delta.capexDelta)})` : ""}.</p>
                </>
              ) : (
                <p style={{ ...estilo.texto, marginTop: 10 }}>Informe o preço de compra do elétrico e do diesel para calcular o payback. Sem eles, a economia operacional acima já vale.</p>
              )}
            </div>
          </div>

          {cenario.avisos.length > 0 && (
            <div className="cp-alerta" style={{ marginTop: 16 }}><AlertTriangle size={18} /><span>{cenario.avisos.join(" ")}</span></div>
          )}

          <p style={{ ...estilo.texto, display: "flex", alignItems: "center", gap: 7, marginTop: 16 }}><ShieldCheck size={15} /> Estimativa de planejamento. Autonomia, consumo, preços e premissas são referências editáveis — a operação e o fornecedor confirmam os números finais.</p>
        </>
      )}
    </section>
  );
}

export function AssistenteCliente({ enviar, setAviso }) {
  const [pergunta, setPergunta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensagens, setMensagens] = useState([
    { lado: "assistente", texto: "Pergunte sobre operações, entregas, Green Score, emissões, relatórios ou evidências deste portal." },
  ]);

  const perguntar = async (evento) => {
    evento.preventDefault();
    const texto = pergunta.trim();
    if (!texto || enviando) return;
    setPergunta("");
    setMensagens((lista) => [...lista, { lado: "cliente", texto }]);
    setEnviando(true);
    try {
      const dados = await enviar("assistente", { pergunta: texto });
      setMensagens((lista) => [...lista, { lado: "assistente", texto: dados.resposta || "Não encontrei uma resposta na base do portal." }]);
    } catch (erro) {
      setAviso(erro.message);
      setMensagens((lista) => [...lista, { lado: "assistente", texto: "Não consegui responder agora. Tente novamente ou abra uma solicitação para a equipe." }]);
    } finally {
      setEnviando(false);
    }
  };

  const sugestoes = ["Qual foi o CO₂ evitado?", "Como está meu Green Score?", "Quantas operações foram realizadas?", "A qualidade dos dados é suficiente para relatório?"];

  return (
    <section>
      <div style={estilo.cabecalho}>
        <div>
          <span style={estilo.selo}><MessageSquare size={15} /> Assistente restrito aos seus dados</span>
          <h2 style={{ ...estilo.titulo, fontSize: 26, marginTop: 12 }}>Assistente do cliente</h2>
          <p style={estilo.texto}>Ele responde apenas com informações do seu contrato e não acessa dados internos da To Do Green nem de outros clientes.</p>
        </div>
      </div>

      <div style={{ ...estilo.card, minHeight: 280 }}>
        <ol className="cp-sol-conversa" style={{ marginTop: 0 }}>
          {mensagens.map((mensagem, indice) => (
            <li key={`${mensagem.lado}-${indice}`} className={mensagem.lado === "cliente" ? "meu" : "deles"}>
              <strong>{mensagem.lado === "cliente" ? "Você" : "Assistente To Do Green"}</strong>
              <p>{mensagem.texto}</p>
            </li>
          ))}
          {enviando && <li className="deles"><Loader2 className="girando" size={18} /> <span>Analisando seus dados...</span></li>}
        </ol>
      </div>

      <div className="cp-formatos" style={{ marginTop: 12 }}>
        {sugestoes.map((sugestao) => <button type="button" key={sugestao} onClick={() => setPergunta(sugestao)}>{sugestao}</button>)}
      </div>

      <form className="cp-sol-resposta" onSubmit={perguntar} style={{ marginTop: 14 }}>
        <textarea rows={3} required value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Escreva uma pergunta sobre a sua operação" />
        <button type="submit" className="cp-botao" disabled={enviando || !pergunta.trim()}><Send size={16} /> Enviar</button>
      </form>

      <p style={{ ...estilo.texto, display: "flex", alignItems: "center", gap: 7 }}><BarChart3 size={15} /> Respostas ambientais são estimativas baseadas na metodologia e nas evidências registradas.</p>
    </section>
  );
}
