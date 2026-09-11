// ===== Checklist de pré-viagem do motorista (bloco 03 · fatia 1) =====
// Camada pura.
//
// O primeiro gesto do dia de quem dirige: o veículo está apto a rodar? Uma
// vistoria rápida no celular, item a item, antes de sair. Cada item é OK,
// RESSALVA (roda mas com observação) ou PROBLEMA. Um item CRÍTICO com problema
// REPROVA a vistoria — o veículo não deveria rodar assim, e fica o registro de
// que não estava apto (segurança e prova, como o POD é prova da entrega).
//
// Só regras aqui, nada grava. O servidor re-avalia e é a autoridade.

const texto = (valor) => String(valor ?? "").trim();

export const RESPOSTAS_CHECKLIST = Object.freeze(["ok", "ressalva", "problema"]);

// Itens padrão da vistoria da frota elétrica. `critico: true` = problema aqui
// reprova a vistoria (não roda). A carga da bateria entra como crítica: sair sem
// autonomia para a rota é o equivalente elétrico de sair sem combustível.
export const ITENS_CHECKLIST = Object.freeze([
  { id: "pneus", rotulo: "Pneus (calibragem e estado)", grupo: "Veículo", critico: true },
  { id: "freios", rotulo: "Freios respondem bem", grupo: "Veículo", critico: true },
  { id: "luzes", rotulo: "Faróis, setas e luz de freio", grupo: "Veículo", critico: true },
  { id: "espelhos", rotulo: "Retrovisores e limpador", grupo: "Veículo", critico: false },
  { id: "vazamentos", rotulo: "Sem vazamentos aparentes", grupo: "Veículo", critico: false },
  { id: "carga_bateria", rotulo: "Bateria carregada para a rota", grupo: "Energia", critico: true },
  { id: "cabo_recarga", rotulo: "Cabo de recarga a bordo", grupo: "Energia", critico: false },
  { id: "cinto", rotulo: "Cinto de segurança OK", grupo: "Segurança", critico: true },
  { id: "extintor", rotulo: "Triângulo e extintor", grupo: "Segurança", critico: true },
  { id: "epi", rotulo: "EPI e colete", grupo: "Segurança", critico: false },
  { id: "cnh", rotulo: "CNH em dia comigo", grupo: "Documentos", critico: true },
  { id: "crlv", rotulo: "Documento do veículo (CRLV)", grupo: "Documentos", critico: true },
  { id: "carga_conferida", rotulo: "Carga conferida e amarrada", grupo: "Carga", critico: false },
]);

const POR_ID = new Map(ITENS_CHECKLIST.map((item) => [item.id, item]));

// Grupos na ordem de aparição, para a tela renderizar por seção sem duplicar.
export const GRUPOS_CHECKLIST = ITENS_CHECKLIST.reduce((grupos, item) => {
  if (!grupos.includes(item.grupo)) grupos.push(item.grupo);
  return grupos;
}, []);

const respostaValida = (valor) => RESPOSTAS_CHECKLIST.includes(texto(valor));

// Recebe { itemId: "ok"|"ressalva"|"problema" } e devolve o veredito. Só conta
// respostas de itens conhecidos; item sem resposta fica pendente.
export const avaliarChecklist = (respostas = {}) => {
  const mapa = respostas && typeof respostas === "object" ? respostas : {};
  const problemas = [];
  const ressalvas = [];
  let respondidos = 0;

  for (const item of ITENS_CHECKLIST) {
    const resposta = texto(mapa[item.id]);
    if (!respostaValida(resposta)) continue;
    respondidos += 1;
    if (resposta === "problema") problemas.push({ id: item.id, rotulo: item.rotulo, critico: item.critico });
    else if (resposta === "ressalva") ressalvas.push({ id: item.id, rotulo: item.rotulo, critico: item.critico });
  }

  const total = ITENS_CHECKLIST.length;
  const pendentes = total - respondidos;
  const completo = pendentes === 0;
  const criticosComProblema = problemas.filter((p) => p.critico);

  let status;
  if (!completo) status = "incompleto";
  else if (criticosComProblema.length > 0) status = "reprovado";
  else if (problemas.length > 0 || ressalvas.length > 0) status = "ressalva";
  else status = "aprovado";

  // Apto a rodar: aprovado ou com ressalva. Reprovado (crítico com problema) e
  // incompleto NÃO estão aptos.
  const apto = status === "aprovado" || status === "ressalva";

  return {
    status,
    apto,
    completo,
    respondidos,
    total,
    pendentes,
    problemas,
    ressalvas,
    criticosReprovados: criticosComProblema,
    resumo:
      status === "aprovado" ? "Veículo apto: tudo conforme."
      : status === "ressalva" ? `Apto com ressalva: ${problemas.length + ressalvas.length} ponto(s) a observar.`
      : status === "reprovado" ? `Não apto: ${criticosComProblema.length} item(ns) crítico(s) com problema.`
      : `Faltam ${pendentes} item(ns) para concluir a vistoria.`,
  };
};

// Rótulo do item por id (para a tela e o resumo do servidor não redigitarem).
export const rotuloDoItem = (id) => POR_ID.get(texto(id))?.rotulo || texto(id);
