import { AlertTriangle, ChevronLeft, ChevronRight, Download, Loader2, MapPin, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ROTULO_SLA,
  SITUACOES_SLA,
  TIPOS_DE_EVENTO,
} from "./operationTrackingDomain.js";
import { comRotulo } from "./rotulosDomain.js";

// A aba de acompanhamento.
//
// Era uma tabela de cinco colunas: referência, data, origem, destino, situação.
// Sem busca, sem filtro, sem detalhe, sem linha do tempo, sem prazo prometido
// contra realizado, sem ocorrência, sem comprovante, sem rastreamento e sem
// paginação visível — enquanto o lado ESG do mesmo portal tinha memória de
// cálculo e exportação em cinco formatos.
//
// Busca, filtro, paginação e SLA são calculados no servidor com o mesmo módulo
// de domínio que esta tela importa para os rótulos. Uma segunda implementação
// aqui produziria um "atrasado" diferente do outro.

const dataHora = (valor) => {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const soData = (valor) => {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("pt-BR");
};

const CLASSE_SLA = {
  [SITUACOES_SLA.noPrazo]: "bom",
  [SITUACOES_SLA.emCurso]: "bom",
  [SITUACOES_SLA.atrasado]: "risco",
  [SITUACOES_SLA.atrasadoEmCurso]: "risco",
  [SITUACOES_SLA.semPrazo]: "neutro",
};

const FILTROS = [
  ["todas", "Todas"],
  ["em_andamento", "Em andamento"],
  ["entregues", "Entregues"],
  ["atrasadas", "Atrasadas"],
  ["com_ocorrencia", "Com ocorrência"],
];

function Detalhe({ detalhe, aoBaixarComprovante, aoBaixarAssinatura, baixando }) {
  const { operacao, sla, previsao, linhaDoTempo, ocorrencias, comprovante, assinatura } = detalhe;
  const recebedor = operacao.campos?.receiverName || "";
  const tipoRecebedor = operacao.campos?.receiverKind || "";
  return (
    <div className="cp-op-detalhe">
      <div className="cp-op-blocos">
        <article>
          <h4>Prazo</h4>
          <p>
            <span>Combinado</span>
            <strong>{dataHora(operacao.prometidoEm)}</strong>
          </p>
          <p>
            <span>Realizado</span>
            <strong>{dataHora(operacao.entregueEm)}</strong>
          </p>
          {/* A previsão muda ao longo da viagem; o combinado não. Mostrar as
              duas juntas deixa o cliente ver o atraso chegando em vez de
              descobrir depois. */}
          {!operacao.entregueEm && operacao.previsaoEm && (
            <p>
              <span>Previsão atual</span>
              <strong>{dataHora(operacao.previsaoEm)}</strong>
            </p>
          )}
          <span className={`cp-sla ${CLASSE_SLA[sla.situacao] || "neutro"}`}>
            {comRotulo(ROTULO_SLA, sla.situacao)}
            {sla.atrasoHoras ? ` · ${String(sla.atrasoHoras).replace(".", ",")} h` : ""}
          </span>
          {previsao.comparavel && previsao.vaiAtrasar && !operacao.entregueEm && (
            <span className="cp-sla risco">
              A previsão está {String(previsao.diferencaHoras).replace(".", ",")} h além do combinado.
            </span>
          )}
        </article>

        <article>
          <h4>Veículo e rota</h4>
          <p><span>Placa</span><strong>{operacao.placa || "—"}</strong></p>
          <p><span>Distância</span><strong>{operacao.distanciaKm ? `${operacao.distanciaKm} km` : "—"}</strong></p>
          {operacao.ultimaPosicao ? (
            <p className="cp-op-posicao">
              <MapPin size={15} />
              <span>Última posição em {dataHora(operacao.ultimaPosicao.em)}</span>
              <a
                href={`https://www.openstreetmap.org/?mlat=${operacao.ultimaPosicao.latitude}&mlon=${operacao.ultimaPosicao.longitude}#map=13/${operacao.ultimaPosicao.latitude}/${operacao.ultimaPosicao.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                ver no mapa
              </a>
            </p>
          ) : (
            <p className="cp-op-vazio">Sem posição de rastreamento registrada para esta viagem.</p>
          )}
        </article>

        <article>
          <h4>Comprovante de entrega</h4>
          {recebedor && (
            <p>
              <span>Recebido por</span>
              <strong>{recebedor}{tipoRecebedor ? ` (${tipoRecebedor})` : ""}</strong>
            </p>
          )}
          {comprovante.disponivel ? (
            <>
              <p className="cp-op-hash">
                <span>Impressão digital</span>
                <strong>{String(comprovante.impressaoDigital || "").slice(0, 16)}…</strong>
              </p>
              <button type="button" className="cp-baixar" disabled={baixando} onClick={aoBaixarComprovante}>
                <Download size={16} />
                {baixando ? "Gerando link..." : "Baixar comprovante"}
              </button>
            </>
          ) : (
            <p className="cp-op-vazio">{comprovante.motivo}</p>
          )}
          {assinatura?.disponivel && (
            <button type="button" className="cp-baixar" disabled={baixando} onClick={aoBaixarAssinatura}>
              <Download size={16} />
              {baixando ? "Gerando link..." : "Baixar assinatura"}
            </button>
          )}
        </article>
      </div>

      {ocorrencias.length > 0 && (
        <div className="cp-op-ocorrencias">
          <h4>
            <AlertTriangle size={16} />
            {ocorrencias.length === 1 ? "1 ocorrência" : `${ocorrencias.length} ocorrências`}
          </h4>
          <ul>
            {ocorrencias.map((evento) => (
              <li key={evento.id}>
                <strong>{evento.titulo || "Ocorrência"}</strong>
                <small>{dataHora(evento.ocorridoEm)}{evento.local ? ` · ${evento.local}` : ""}</small>
                {evento.descricao && <p>{evento.descricao}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4 className="cp-op-titulo-linha">Linha do tempo</h4>
      {linhaDoTempo.length === 0 ? (
        <p className="cp-op-vazio">
          Nenhum evento registrado para esta operação ainda. A linha do tempo aparece conforme a
          equipe registra coleta, trânsito, chegada e entrega.
        </p>
      ) : (
        <ol className="cp-op-linha">
          {linhaDoTempo.map((evento) => (
            <li key={evento.id} className={`cp-op-evento cp-op-${evento.tipo}`}>
              <div>
                <strong>{evento.titulo || TIPOS_DE_EVENTO[evento.tipo] || evento.tipo}</strong>
                <small>
                  {dataHora(evento.ocorridoEm)}
                  {evento.local ? ` · ${evento.local}` : ""}
                </small>
              </div>
              {evento.descricao && <p>{evento.descricao}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Operacoes({ pedir, enviar, setAviso }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [situacao, setSituacao] = useState("todas");
  const [periodo, setPeriodo] = useState({ de: "", ate: "" });
  const [pagina, setPagina] = useState(1);
  const [abertaId, setAbertaId] = useState("");
  const [detalhe, setDetalhe] = useState(null);
  const [baixando, setBaixando] = useState(false);

  const consulta = useMemo(() => {
    const p = new URLSearchParams();
    if (buscaAplicada) p.set("busca", buscaAplicada);
    if (situacao && situacao !== "todas") p.set("situacao", situacao);
    if (periodo.de) p.set("de", periodo.de);
    if (periodo.ate) p.set("ate", periodo.ate);
    p.set("pagina", String(pagina));
    return p.toString();
  }, [buscaAplicada, situacao, periodo, pagina]);

  const carregar = useCallback(() => {
    setCarregando(true);
    pedir(`operacoes?${consulta}`)
      .then(setDados)
      .catch((erro) => setAviso(erro.message))
      .finally(() => setCarregando(false));
  }, [consulta, pedir, setAviso]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Trocar filtro volta para a primeira página: manter a página 3 depois de
  // filtrar mostraria uma lista vazia que parece "não tem nada".
  const mudarFiltro = (aplicar) => {
    aplicar();
    setPagina(1);
    setAbertaId("");
    setDetalhe(null);
  };

  const abrir = async (operacao) => {
    if (abertaId === operacao.id) {
      setAbertaId("");
      setDetalhe(null);
      return;
    }
    setAbertaId(operacao.id);
    setDetalhe(null);
    try {
      setDetalhe(await pedir(`operacoes/${encodeURIComponent(operacao.id)}`));
    } catch (erro) {
      setAviso(erro.message);
      setAbertaId("");
    }
  };

  const baixarComprovante = async () => {
    setBaixando(true);
    try {
      const { url } = await enviar(`operacoes/${encodeURIComponent(abertaId)}/comprovante`, {});
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setBaixando(false);
    }
  };

  const baixarAssinatura = async () => {
    setBaixando(true);
    try {
      const { url } = await enviar(`operacoes/${encodeURIComponent(abertaId)}/assinatura`, {});
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (erro) {
      setAviso(erro.message);
    } finally {
      setBaixando(false);
    }
  };

  const operacoes = dados?.operacoes || [];
  const paginacao = dados?.paginacao || { pagina: 1, paginas: 1, total: 0, primeiro: 0, ultimo: 0 };
  const resumo = dados?.resumo;

  return (
    <div className="cp-op">
      <form
        className="cp-op-filtros"
        onSubmit={(evento) => {
          evento.preventDefault();
          mudarFiltro(() => setBuscaAplicada(busca));
        }}
      >
        <label className="cp-op-busca">
          <span>Buscar</span>
          <div>
            <Search size={16} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Referência, origem, destino ou placa"
            />
          </div>
        </label>
        <label>
          <span>De</span>
          <input type="date" value={periodo.de} onChange={(e) => mudarFiltro(() => setPeriodo((a) => ({ ...a, de: e.target.value })))} />
        </label>
        <label>
          <span>Até</span>
          <input type="date" value={periodo.ate} onChange={(e) => mudarFiltro(() => setPeriodo((a) => ({ ...a, ate: e.target.value })))} />
        </label>
        <button type="submit" className="cp-baixar">Buscar</button>
      </form>

      <div className="cp-op-abas" role="group" aria-label="Filtrar operações">
        {FILTROS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            className={situacao === id ? "ativo" : ""}
            onClick={() => mudarFiltro(() => setSituacao(id))}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {resumo && (
        <div className="cp-op-resumo">
          <span><small>Operações</small><strong>{resumo.total}</strong></span>
          <span><small>Em andamento</small><strong>{resumo.emAndamento}</strong></span>
          <span><small>Atrasadas</small><strong>{resumo.atrasadas}</strong></span>
          <span><small>Com ocorrência</small><strong>{resumo.comOcorrencia}</strong></span>
          <span>
            <small>Pontualidade</small>
            {/* Sem entrega concluída não existe percentual. Zero diria que tudo
                atrasou. */}
            <strong>{resumo.pontualidadePercent === null ? "—" : `${resumo.pontualidadePercent}%`}</strong>
          </span>
        </div>
      )}

      {carregando && <div className="cp-carregando"><Loader2 className="girando" size={20} /> Carregando operações...</div>}

      {!carregando && operacoes.length === 0 && (
        <p className="cp-op-vazio">
          Nenhuma operação encontrada com estes filtros. Limpe a busca ou amplie o período — os
          registros continuam no seu histórico.
        </p>
      )}

      {!carregando && operacoes.length > 0 && (
        <div className="cp-tabela-frame">
          <table className="cp-tabela cp-op-tabela">
            <thead>
              <tr>
                <th>Referência</th>
                <th>Data</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Prazo</th>
                <th>Ocorrências</th>
                <th aria-label="Detalhe" />
              </tr>
            </thead>
            <tbody>
              {operacoes.map((operacao) => {
                const sla = operacao.sla || {};
                return (
                  <Fragment key={operacao.id}>
                    <tr>
                      <td>{operacao.referencia || "—"}</td>
                      <td>{soData(operacao.dataServico)}</td>
                      <td>{operacao.origem || "—"}</td>
                      <td>{operacao.destino || "—"}</td>
                      <td>
                        <span className={`cp-sla ${CLASSE_SLA[sla.situacao] || "neutro"}`}>
                          {ROTULO_SLA[sla.situacao] || "—"}
                        </span>
                      </td>
                      <td>{operacao.ocorrencias || 0}</td>
                      <td>
                        <button type="button" className="cp-op-abrir" onClick={() => abrir(operacao)}>
                          {abertaId === operacao.id ? "Fechar" : "Detalhe"}
                        </button>
                      </td>
                    </tr>
                    {abertaId === operacao.id && (
                      <tr className="cp-op-linha-detalhe">
                        <td colSpan={7}>
                          {detalhe ? (
                            <Detalhe
                              detalhe={detalhe}
                              baixando={baixando}
                              aoBaixarComprovante={baixarComprovante}
                              aoBaixarAssinatura={baixarAssinatura}
                            />
                          ) : (
                            <div className="cp-carregando"><Loader2 className="girando" size={18} /> Abrindo o detalhe...</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Os números à vista: uma lista que corta em vinte sem dizer quantos
          existem faz o cliente achar que o resto sumiu. */}
      {!carregando && paginacao.total > 0 && (
        <div className="cp-op-paginacao">
          <button type="button" disabled={paginacao.pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            <ChevronLeft size={16} />Anterior
          </button>
          <span>
            {paginacao.primeiro}–{paginacao.ultimo} de {paginacao.total}
            {paginacao.paginas > 1 ? ` · página ${paginacao.pagina} de ${paginacao.paginas}` : ""}
          </span>
          <button
            type="button"
            disabled={paginacao.pagina >= paginacao.paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima<ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
