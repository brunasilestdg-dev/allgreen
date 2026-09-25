// ===== Coleção das pastas do cofre =====
//
// Pastas do cofre de documentos (formato em ./descritor.js). Cadastro da
// empresa (`escopoDeCarteira: false`); escrever exige `evidence:manage`. É a
// ÚNICA coleção com `filtrarLeitura` — a visibilidade sobe a linhagem inteira
// da pasta — e a guarda de escrita barra ciclo, nome repetido no mesmo lugar e
// edição de pasta que a pessoa não enxerga.

import { TENANT_ID } from "../../todogreen-access.js";
import {
  criaCiclo,
  nomeDisponivel,
  normalizarPasta,
  pastasVisiveis,
  podeVerPasta as podeVerPastaNaLinhagem,
} from "../../../../src/features/logistics/pastasDomain.js";
import { parse, texto } from "../util.js";

export const COLECOES_DO_COFRE = {
  // ===== Pastas do cofre de documentos =====
  //
  // Privadas, da área e do espaço. Escrever é aberto a quem já escreve no cofre
  // (`evidence:manage`) — criar pasta é organizar o próprio trabalho, não um
  // ato de governança. O que protege não é a permissão de escrita e sim a
  // LEITURA: `filtrarLeitura` aplica a linhagem inteira, então uma subpasta
  // "do espaço" dentro de uma privada continua invisível.
  documentFolders: {
    tabela: "todogreen_document_folders",
    permissao: "evidence:manage",
    permissoesLeitura: [
      "evidence:manage", "crm:manage", "clients:manage", "proposal:manage",
      "operations:manage", "finance:manage", "compliance:manage", "audit:read",
    ],
    escopoDeCarteira: false,
    ordem: "updated_at DESC",
    daLinha: (row) => ({
      id: row.id,
      paiId: row.parent_id || "",
      nome: row.name || "",
      descricao: row.descricao || "",
      visibilidade: row.visibility || "private",
      membros: parse(row.members_json, []) || [],
      permissaoDaArea: row.area_permission || "",
      donoEmail: row.owner_email || "",
      revision: row.revision,
      criadoEm: row.created_at,
      atualizadoEm: row.updated_at,
    }),
    colunas: (corpo, { email, novo } = {}) => {
      const pasta = normalizarPasta(corpo);
      const daSessao = texto(email, 200).toLowerCase();
      return {
        parent_id: pasta.paiId,
        name: pasta.nome,
        descricao: pasta.descricao,
        visibility: pasta.visibilidade,
        members_json: JSON.stringify(pasta.membros),
        area_permission: pasta.permissaoDaArea,
        // Na CRIAÇÃO o dono sai da sessão e o corpo é ignorado: senão qualquer
        // pessoa cria pasta privada no nome de outra e se põe como membro.
        // Na EDIÇÃO o dono ANTERIOR permanece — carimbar a sessão aqui faria a
        // dona do espaço virar dona de toda pasta privada que ela abrisse para
        // arrumar, tirando o acesso de quem criou. Mesmo cuidado que o autor de
        // comentário já tem.
        owner_email: novo ? daSessao : (pasta.donoEmail || daSessao),
      };
    },
    exigido: (corpo) => {
      const pasta = normalizarPasta(corpo);
      if (!pasta.nome) return "Dê um nome à pasta.";
      if (pasta.visibilidade === "area" && !pasta.permissaoDaArea)
        return "Escolha de qual área é a pasta — sem isso ninguém além de você a veria.";
      return "";
    },
    guardaDeEscrita: async (env, { access, email, corpo, id }) => {
      const { results } = await env.DB.prepare(
        `SELECT id, parent_id, name, visibility, members_json, area_permission, owner_email
           FROM todogreen_document_folders
          WHERE tenant_id=? AND workspace_owner_id=? AND archived_at IS NULL LIMIT 500`,
      ).bind(TENANT_ID, access.ownerId).all();
      const pastas = (results || []).map((row) => ({
        id: row.id,
        paiId: row.parent_id || "",
        nome: row.name || "",
        visibilidade: row.visibility || "private",
        membros: parse(row.members_json, []) || [],
        permissaoDaArea: row.area_permission || "",
        donoEmail: row.owner_email || "",
      }));
      const quem = {
        email,
        papel: access?.role,
        permissoes: Array.isArray(access?.permissions) ? access.permissions : [],
      };

      // Editar pasta que a pessoa não vê é editar às cegas — e no caso de uma
      // privada de terceiro, é invadir. O 409 vale aqui porque a lista já
      // devolveu 404 para o que ela não vê: chegar a PATCH nesse id significa
      // que ela sabe o id de outra forma.
      if (id && !podeVerPastaNaLinhagem(pastas, id, quem))
        return "Esta pasta não é sua.";

      const paiId = texto(corpo.paiId || corpo.parentId, 120);
      // O pai também tem que ser visível: mover uma pasta para dentro de algo
      // que a pessoa não vê esconderia o conteúdo dela de si mesma.
      if (paiId && !podeVerPastaNaLinhagem(pastas, paiId, quem))
        return "A pasta de destino não existe aqui.";
      if (id && paiId && criaCiclo(pastas, id, paiId))
        return "Uma pasta não pode ficar dentro de si mesma nem de uma subpasta dela.";
      if (!nomeDisponivel(pastas, { id, paiId, nome: texto(corpo.nome || corpo.name, 160) }))
        return "Já existe uma pasta com esse nome no mesmo lugar.";
      return "";
    },
    filtrarLeitura: (registros, { access, email }) => pastasVisiveis(registros, {
      email,
      papel: access?.role,
      permissoes: Array.isArray(access?.permissions) ? access.permissions : [],
    }),
  },
};
