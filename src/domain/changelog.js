// ===== Novidades do produto =====
//
// Dado puro, sem nenhuma dependência: é a lista que a tela de novidades lê.
// Ficava no meio de App.jsx, entre uma função de calendário e outra de dias
// úteis — 160 linhas de texto atravessando um arquivo de lógica.

export const CHANGELOG_ENTRIES = [
  {
    id: "2026-09-24-ocr-documentos",
    date: "2026-09-24",
    title: "Fotos e PDFs escaneados agora viram texto",
    description:
      "Documentos, Análise de textos, anexos do chat e propostas de fornecedor em Compras leem imagens (PNG, JPG, WEBP) e PDFs digitalizados. A leitura acontece no seu aparelho, sem custo, e o texto chega marcado para você conferir nomes, datas e valores antes de usar.",
  },
  {
    id: "2026-09-24-extensao-navegador",
    date: "2026-09-24",
    title: "A extensão do navegador agora se instala pelo próprio app",
    description:
      "Baixe o pacote em Configurações — ou em Meu perfil, na To Do Green —, descompacte e carregue no Chrome, Edge ou Brave. O Plantû resume a página aberta, prepara respostas e sugere tarefas sem você sair do site. O token de acesso vale por 24 horas.",
  },
  {
    id: "2026-09-24-atalhos-ambientes",
    date: "2026-09-24",
    title: "Atalhos entre o app e a To Do Green",
    description:
      "Quem tem acesso à To Do Green encontra no menu lateral o caminho para o ERP, a Green On e a Greenmob; na To Do Green, o mesmo grupo leva de volta às ferramentas gerais. Motoristas e colaboradores veem o atalho do próprio portal.",
  },
  {
    id: "2026-09-24-resumo-desde-agosto",
    date: "2026-09-24",
    title: "O que mais chegou desde a última novidade",
    description:
      "Mídia, para editar imagem, gravar, ditar e ouvir áudio no aparelho; Editor de código com prévia isolada; Notebook de dados com consultas em português; Integrações com importação e exportação em CSV/JSON, agenda .ics e envio automático para outros sistemas; o menu que você escolhe em Personalizar menu; e o Início que leva o seu pedido direto para a conversa.",
  },
  {
    id: "2026-09-23-convites-senha-provisoria",
    date: "2026-09-23",
    title: "Convites que dizem por que o e-mail não saiu",
    description:
      "Em Meu Time, o convite agora mostra o motivo quando o e-mail não é enviado. Como alternativa, crie o acesso com uma senha provisória, exibida uma única vez para você repassar; no primeiro login a pessoa troca a senha antes de abrir qualquer tela.",
  },
  {
    id: "2026-09-23-menu-inicial",
    date: "2026-09-23",
    title: "Um menu inicial com mais do que o básico",
    description:
      "Quem chega agora já encontra Orçamentos, Precificação, Reuniões e Notebook de dados no menu, e a Central do negócio aparece no topo para todos. Tudo continua ajustável em Personalizar menu.",
  },
  {
    id: "2026-07-31-tarefas-inteligentes",
    date: "2026-07-31",
    title: "A IA agora transforma pedidos em tarefas executáveis",
    description:
      "Estruture rascunhos em etapas e critérios verificáveis, veja a fila de foco calculada sem gastar IA, envie todo o contexto ao colaborador digital e anexe a entrega da conversa de volta à tarefa. Se os provedores estiverem indisponíveis, uma contingência local mantém a organização funcionando.",
  },
  {
    id: "2026-07-31-central-negocio-universal",
    date: "2026-07-31",
    title: "O app agora se adapta a qualquer tipo de negócio",
    description:
      "Escolha entre mais de 300 atividades — incluindo influenciadores, comércios, serviços, indústrias e operações de nicho — e organize o menu com os pacotes de funções mais úteis. Negócios híbridos podem usar descrição livre, ativar qualquer pacote ou mostrar tudo, sem perder acesso a nenhuma ferramenta.",
  },
  {
    id: "2026-07-29-editor-universal-blocos",
    date: "2026-07-29",
    title: "Documentos agora são montados com blocos universais",
    description:
      "Combine texto, títulos, listas, checklists, tabelas, colunas, mídia, código, destaques, gráficos, bases, tarefas e formulários no mesmo documento. Componentes sincronizados podem ser reutilizados e atualizados em todas as páginas, sem perder versões, assinaturas, importação ou exportação.",
  },
  {
    id: "2026-07-29-portal-cliente",
    date: "2026-07-29",
    title: "Portal individual e restrito para cada cliente",
    description:
      "Escolha exatamente quais projetos, tarefas, documentos, relatórios, orçamentos, pedidos e entregas cada cliente poderá acessar. O portal recebe aprovações de entregas, chamados e documentos com protocolo, link revogável, validade opcional e trilha autenticada para a equipe.",
  },
  {
    id: "2026-07-29-formularios-publicos",
    date: "2026-07-29",
    title: "Formulários públicos que já entram na operação",
    description:
      "Publique por link ou incorpore no site, use campos condicionais, anexos, assinatura e Pix ou link de pagamento. Cada envio recebe protocolo e pode virar tarefa, lead, chamado ou caso de um processo, sem copiar respostas para o espaço de sincronização.",
  },
  {
    id: "2026-07-29-chat-corporativo",
    date: "2026-07-29",
    title: "Chat corporativo conectado ao trabalho",
    description:
      "Crie canais para toda a empresa, grupos privados e mensagens diretas. Responda em threads, mencione pessoas, reaja, anexe arquivos, fixe decisões, encontre mensagens, transforme qualquer mensagem em tarefa e gere um resumo da conversa com IA.",
  },
  {
    id: "2026-07-29-dashboards-configuraveis",
    date: "2026-07-29",
    title: "Dashboards que cada pessoa pode montar",
    description:
      "Crie e duplique painéis, escolha os indicadores, altere o tamanho e a ordem dos cards e filtre por período ou projeto. Receita, margem, metas, atrasos, risco, capacidade, SLA, emissões e logística usam os dados reais já registrados na empresa.",
  },
  {
    id: "2026-07-29-caixa-pessoal",
    date: "2026-07-29",
    title: "Uma caixa pessoal para tudo que pede sua atenção",
    description:
      "Menções, tarefas atribuídas, comentários, aprovações e alterações importantes agora aparecem agrupadas na Caixa de entrada. Você pode marcar itens ou grupos como lidos e adiar o que ficará para amanhã ou para a próxima semana.",
  },
  {
    id: "2026-07-29-processos-formularios",
    date: "2026-07-29",
    title: "Processos, formulários, aprovações e SLAs",
    description:
      "Crie processos com etapas configuráveis, receba solicitações por formulário, acompanhe protocolos em quadro e controle aprovações e prazos. Cada processo funciona sozinho e pode, opcionalmente, gravar a resposta em uma base e criar uma tarefa.",
  },
  {
    id: "2026-07-28-automacoes-servidor",
    date: "2026-07-28",
    title: "Automações continuam trabalhando com o app fechado",
    description:
      "As regras semanais e mensais agora são verificadas de hora em hora no servidor. Cada execução cria a tarefa ou o lembrete uma única vez, mantém histórico e preserva uma versão anterior dos dados.",
  },
  {
    id: "2026-07-28-compras-backups",
    date: "2026-07-28",
    title: "Compras, cotações e recuperação de versões",
    description:
      "Compare propostas de fornecedores por item, registre a melhor oferta e exporte o mapa de cotação. Em Configurações, também é possível consultar e restaurar versões anteriores do espaço.",
  },
  {
    id: "2026-07-20-resumo-semanal",
    date: "2026-07-20",
    title: "Resumo da semana no início e por notificação",
    description:
      "O painel Início agora mostra o resumo da sua semana — vendas, entradas em caixa, tarefas concluídas e novos contatos. Com as notificações do navegador ativadas, você recebe esse resumo toda segunda-feira, mesmo com o app fechado.",
  },
  {
    id: "2026-07-20-whatsapp",
    date: "2026-07-20",
    title: "Modelos de mensagem do WhatsApp",
    description:
      "Crie mensagens prontas com variáveis (nome, valor, pedido...) em Ferramentas. Ao enviar um WhatsApp por um lead, contato, pedido ou agendamento, o app preenche tudo automaticamente — você só revisa e manda.",
  },
  {
    id: "2026-07-20-das",
    date: "2026-07-20",
    title: "Controle do DAS do MEI com lembrete automático",
    description:
      "Ative 'Sou MEI' no Financeiro para acompanhar o pagamento da guia mês a mês e receber um aviso automático antes do vencimento (todo dia 20) — inclusive no navegador, com as notificações ativadas.",
  },
  {
    id: "2026-07-19-busca",
    date: "2026-07-19",
    title: "Busca agora encontra tarefas, leads, documentos e contatos",
    description:
      "O Buscar em tudo (Ctrl+K) deixou de procurar só nomes de seção do menu — agora encontra o que está dentro delas também, e leva direto para o registro.",
  },
  {
    id: "2026-07-19-toque-kanban",
    date: "2026-07-19",
    title: "Arrastar tarefas no Kanban funciona no celular",
    description:
      "Pressione e segure um cartão para arrastá-lo entre colunas também em telas de toque, não só no computador.",
  },
  {
    id: "2026-07-19-anexo-ampliado",
    date: "2026-07-19",
    title: "Anexos com visualização ampliada",
    description:
      "Clique na miniatura de uma imagem anexada a uma tarefa ou entrega para vê-la em tamanho grande.",
  },
  {
    id: "2026-07-19-recorrencia",
    date: "2026-07-19",
    title: "Tarefas recorrentes",
    description:
      "Configure uma tarefa para repetir todo dia, toda semana ou todo mês — a próxima ocorrência é criada sozinha quando você conclui a atual.",
  },
  {
    id: "2026-07-19-calendario",
    date: "2026-07-19",
    title: "Visão de calendário para tarefas",
    description:
      "Além de quadro e lista, veja suas tarefas com prazo num calendário mensal navegável.",
  },
  {
    id: "2026-07-19-lote",
    date: "2026-07-19",
    title: "Ações em lote em tarefas",
    description:
      "Selecione várias tarefas de uma vez na visão em Lista para arquivar ou reatribuir juntas.",
  },
  {
    id: "2026-07-18-compartilhamento",
    date: "2026-07-18",
    title: "Compartilhamento opcional em Agendamentos, Produtos e Frota",
    description:
      "Essas áreas continuam visíveis para todo o espaço por padrão, mas agora dá para restringir uma tarefa, produto ou veículo específico se precisar.",
  },
  {
    id: "2026-07-17-equipes",
    date: "2026-07-17",
    title: "Equipes, projetos e conquistas",
    description:
      "Organize colaboradores em equipes, agrupe tarefas por projeto e acompanhe pontos, níveis e conquistas de cada pessoa.",
  },
];

// Gamificação, "meu trabalho" e painel de resultados foram movidos para
// src/domain.js (camada de lógica pura). Importados e reexportados no topo.
