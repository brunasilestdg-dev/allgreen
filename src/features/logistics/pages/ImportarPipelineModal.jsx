import { useState } from "react";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import { Upload } from "lucide-react";
import Modal from "../../../components/Modal.jsx";
import { idEstavelDaConta } from "../crmSpreadsheetImportDomain.js";
import {
  chaveDaInteracao,
  chaveDaOportunidade,
  oportunidadeParaRegistro,
  planoDeImportacao,
} from "../pipelineImportDomain.js";

// ===== Importar o pipeline do quadro externo =====
//
// A titular mantém o pipeline num quadro fora do ERP e exporta a planilha. Esta
// janela lê o export, MOSTRA o que vai entrar (contas, oportunidades,
// interações e o que ficou de fora, com o motivo) e só grava quando ela manda.
//
// Reimportar é o caso normal — o quadro recebe update toda semana. Por isso a
// conta usa o mesmo id estável do resto do CRM, a oportunidade é reconhecida
// pelo nome do projeto e a interação pelo par assunto + data: rodar duas vezes
// atualiza, não duplica.

const BRL = (valor) => `R$ ${Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

const lerPlanilha = async (arquivo) => {
  const nome = String(arquivo?.name || "").toLowerCase();
  if (nome.endsWith(".xls")) throw new Error("Salve a planilha no formato .xlsx antes de importar.");
  const abas = await readSheetNames(arquivo);
  const lidas = await Promise.all(abas.map((aba) => readXlsxFile(arquivo, { sheet: aba })));
  // A aba de updates se identifica pelo próprio conteúdo; a outra é a dos
  // projetos. Assim o nome da aba pode mudar no quadro sem quebrar a leitura.
  const indiceDosUpdates = lidas.findIndex((linhas) =>
    linhas.some((linha) => String(linha?.[1] ?? "").trim().toLowerCase() === "item name"));
  const updates = indiceDosUpdates >= 0 ? lidas[indiceDosUpdates] : [];
  const projetos = lidas.filter((_, indice) => indice !== indiceDosUpdates).flat();
  return planoDeImportacao({ projetos, updates });
};

export default function ImportarPipelineModal({
  aberto,
  onClose,
  authHeaders,
  opportunities = [],
  interactions = [],
  onCriarOportunidade,
  onCriarInteracao,
  setToast,
}) {
  const [plano, setPlano] = useState(null);
  const [erro, setErro] = useState("");
  const [progresso, setProgresso] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  if (!aberto) return null;

  const escolherArquivo = async (evento) => {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;
    setErro(""); setResultado(null); setPlano(null);
    try {
      const lido = await lerPlanilha(arquivo);
      if (!lido.oportunidades.length) throw new Error("A planilha não tem linhas de projeto reconhecíveis.");
      setPlano(lido);
    } catch (reason) {
      setErro(reason?.message || "Não foi possível ler a planilha.");
    } finally {
      evento.target.value = "";
    }
  };

  const importar = async () => {
    if (!plano) return;
    setImportando(true);
    setErro("");
    const contagem = { contas: 0, oportunidades: 0, interacoes: 0, repetidas: 0, falhas: [] };
    try {
      // 1) Contas — em lote, pelo mesmo caminho da importação de CRM.
      const contas = plano.contas.map((nome) => ({
        id: idEstavelDaConta(nome),
        nome,
        crm: { source: "Quadro de Novos Negócios", stage: "Mapeamento" },
      }));
      for (let inicio = 0; inicio < contas.length; inicio += 100) {
        const lote = contas.slice(inicio, inicio + 100);
        setProgresso(`Contas: ${Math.min(inicio + lote.length, contas.length)} de ${contas.length}...`);
        const resposta = await fetch("/api/todogreen/clients/import", {
          method: "POST",
          headers: { "content-type": "application/json", ...(authHeaders?.() || {}) },
          body: JSON.stringify({ clientes: lote }),
        });
        if (!resposta.ok) {
          const corpo = await resposta.json().catch(() => ({}));
          throw new Error(corpo.error || "As contas não puderam ser importadas.");
        }
        contagem.contas += lote.length;
      }

      // 2) Oportunidades — uma a uma, pulando as que já existem pelo nome do
      // projeto. O id de cada uma alimenta as interações no passo seguinte.
      const idPorProjeto = new Map();
      for (const existente of opportunities) {
        const chave = chaveDaOportunidade(existente);
        if (chave && !idPorProjeto.has(chave)) idPorProjeto.set(chave, existente.id);
      }
      let feitas = 0;
      for (const item of plano.oportunidades) {
        feitas += 1;
        setProgresso(`Oportunidades: ${feitas} de ${plano.oportunidades.length}...`);
        const registro = oportunidadeParaRegistro(item, item.conta ? idEstavelDaConta(item.conta) : "");
        const chave = chaveDaOportunidade(registro);
        if (idPorProjeto.has(chave)) { contagem.repetidas += 1; continue; }
        try {
          const criada = await onCriarOportunidade?.(registro);
          if (criada?.id) { idPorProjeto.set(chave, criada.id); contagem.oportunidades += 1; }
        } catch (reason) {
          contagem.falhas.push(`${item.nome}: ${reason?.message || "não entrou"}`);
        }
      }

      // 3) Interações — ligadas à oportunidade do projeto, sem repetir o que já
      // está registrado (mesmo assunto na mesma data).
      const jaRegistradas = new Set(interactions.map((item) => `${item.opportunityId}|${chaveDaInteracao(item)}`));
      let lidas = 0;
      for (const interacao of plano.interacoes) {
        lidas += 1;
        setProgresso(`Interações: ${lidas} de ${plano.interacoes.length}...`);
        const oportunidadeId = idPorProjeto.get(chaveDaOportunidade({ campos: { nomeDoProjeto: interacao.projeto } }));
        if (!oportunidadeId) { contagem.falhas.push(`${interacao.projeto}: oportunidade não encontrada para a interação.`); continue; }
        const chave = `${oportunidadeId}|${chaveDaInteracao(interacao)}`;
        if (jaRegistradas.has(chave)) { contagem.repetidas += 1; continue; }
        const projeto = plano.oportunidades.find((item) => item.nome === interacao.projeto);
        try {
          await onCriarInteracao?.({
            clientId: projeto?.conta ? idEstavelDaConta(projeto.conta) : "",
            opportunityId: oportunidadeId,
            tipo: interacao.tipo,
            assunto: interacao.assunto,
            ata: interacao.ata,
            participantes: interacao.participantes,
            ocorridaEm: interacao.ocorridaEm,
          });
          jaRegistradas.add(chave);
          contagem.interacoes += 1;
        } catch (reason) {
          contagem.falhas.push(`${interacao.projeto} (${interacao.ocorridaEm}): ${reason?.message || "interação não entrou"}`);
        }
      }

      setResultado(contagem);
      setToast?.(`Pipeline importado: ${contagem.oportunidades} oportunidade(s) e ${contagem.interacoes} interação(ões).`);
    } catch (reason) {
      setErro(reason?.message || "A importação parou no meio.");
      setResultado(contagem);
    } finally {
      setImportando(false);
      setProgresso("");
    }
  };

  return (
    <Modal title="Importar pipeline do quadro" onClose={onClose} wide>
      <div className="tdg-import-pipeline tdg-form-em-modal">
        <p>
          Envie o export do quadro de Novos Negócios (.xlsx). A tela mostra o que vai entrar antes de gravar,
          e reimportar o mesmo arquivo atualiza em vez de duplicar.
        </p>
        <label className="tdg-import-arquivo">
          <span>Planilha do quadro</span>
          <input type="file" accept=".xlsx" onChange={escolherArquivo} disabled={importando} />
        </label>

        {erro && <p className="tdg-page-error">{erro}</p>}

        {plano && (
          <>
            <div className="tdg-import-resumo">
              <article><small>Contas</small><strong>{plano.resumo.contas}</strong></article>
              <article><small>Oportunidades</small><strong>{plano.resumo.oportunidades}</strong><span>{plano.resumo.abertas} em aberto</span></article>
              <article><small>Interações</small><strong>{plano.resumo.interacoes}</strong></article>
              <article><small>Receita mensal esperada</small><strong>{BRL(plano.resumo.valorMensal)}</strong><span>{BRL(plano.resumo.valorAnual)} no ano</span></article>
            </div>

            <details className="tdg-import-lista">
              <summary>Ver as {plano.oportunidades.length} oportunidades que vão entrar</summary>
              <ul>
                {plano.oportunidades.map((item) => (
                  <li key={item.nome}>
                    <strong>{item.nome}</strong>
                    <span>{item.conta || "sem conta (trabalho interno)"} · {item.estagio}</span>
                    <b>{BRL(item.valorMensal)}/mês</b>
                  </li>
                ))}
              </ul>
            </details>

            {plano.avisos.length > 0 && (
              <details className="tdg-import-avisos">
                <summary>{plano.avisos.length} ponto(s) de atenção nesta planilha</summary>
                <ul>{plano.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
              </details>
            )}
          </>
        )}

        {progresso && <p className="tdg-import-progresso">{progresso}</p>}

        {resultado && (
          <div className="tdg-import-resultado">
            <strong>Importação concluída</strong>
            <ul>
              <li>{resultado.contas} conta(s) criadas ou atualizadas</li>
              <li>{resultado.oportunidades} oportunidade(s) novas</li>
              <li>{resultado.interacoes} interação(ões) registradas</li>
              <li>{resultado.repetidas} registro(s) já existiam e foram mantidos</li>
            </ul>
            {resultado.falhas.length > 0 && (
              <details>
                <summary>{resultado.falhas.length} linha(s) não entraram</summary>
                <ul>{resultado.falhas.map((falha) => <li key={falha}>{falha}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        <div className="tdg-form-actions">
          <button type="button" onClick={onClose} disabled={importando}>{resultado ? "Fechar" : "Cancelar"}</button>
          <button
            className="tdg-action"
            type="button"
            onClick={importar}
            disabled={!plano || importando || Boolean(resultado)}
          >
            <Upload size={16} />{importando ? "Importando..." : "Importar tudo"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
