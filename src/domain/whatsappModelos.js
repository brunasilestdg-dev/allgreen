// ===== Modelos de mensagem do WhatsApp =====
//
// O público faz vendas inteiras pelo WhatsApp; digitar a mesma mensagem toda
// vez é atrito. Modelos com variáveis ({{nome}}, {{valor}}) preenchidas a
// partir do próprio registro fecham esse ciclo — sem API paga do Meta e sem
// credencial externa.

// ── Modelos de mensagem do WhatsApp ─────────────────────────────────────
// O público faz vendas inteiras pelo WhatsApp; digitar a mesma mensagem toda
// vez é atrito. Modelos reutilizáveis com variáveis ({{nome}}, {{valor}}...)
// preenchidas a partir do próprio registro (lead, pedido, agendamento) fecham
// esse ciclo — 100% grátis, sem API paga do Meta e sem credenciais externas.
export const DEFAULT_WA_TEMPLATES = [
  {
    id: "wa-boasvindas",
    name: "Boas-vindas",
    category: "Contato",
    body: "Olá {{nome}}, tudo bem? Aqui é da {{negocio}}. Obrigado pelo contato! Como posso ajudar na sua operação de transporte?",
  },
  {
    id: "wa-cotacao",
    name: "Cotação de frete",
    category: "Cotação",
    body: "Olá {{nome}}! Segue a cotação da {{negocio}} para {{origem}} → {{destino}} ({{operacao}}): {{valor}}. Preço com frota 100% elétrica e redução de CO₂ comprovada. Qualquer dúvida, é só chamar.",
  },
  {
    id: "wa-coleta",
    name: "Coleta agendada",
    category: "Coleta",
    body: "Olá {{nome}}, confirmando a coleta da {{negocio}} em {{origem}} no dia {{data}}, na janela {{hora}}. Nosso motorista chega nesse horário. Até lá!",
  },
  {
    id: "wa-entrega",
    name: "Saiu para entrega / rastreio",
    category: "Entrega",
    body: "Olá {{nome}}! Sua carga saiu para entrega e a previsão de chegada é {{eta}}. Acompanhe o rastreamento aqui: {{link}}.",
  },
  {
    id: "wa-pod",
    name: "Comprovante de entrega (POD)",
    category: "Entrega",
    body: "{{nome}}, entrega concluída em {{data}}, recebida por {{recebedor}}. O comprovante (POD) está disponível: {{link}}. Obrigado pela confiança!",
  },
  {
    id: "wa-ocorrencia",
    name: "Aviso de ocorrência",
    category: "Ocorrência",
    body: "Olá {{nome}}, tivemos uma ocorrência na entrega de {{destino}}: {{descricao}}. Já estamos tratando e retornamos com a solução. Qualquer coisa, estou à disposição.",
  },
  {
    id: "wa-cobranca",
    name: "Cobrança amigável",
    category: "Cobrança",
    body: "Oi {{nome}}, tudo bem? Passando para lembrar do pagamento de {{valor}} referente a {{descricao}}. Qualquer coisa, estou à disposição!",
  },
];

export const WA_TEMPLATE_CATEGORIES = [
  "Contato",
  "Cotação",
  "Coleta",
  "Entrega",
  "Ocorrência",
  "Cobrança",
  "Outros",
];

// Substitui {{chave}} pelo valor correspondente; variáveis sem valor viram
// [chave] para o usuário perceber e completar antes de enviar.
export const fillWhatsappTemplate = (body, vars = {}) =>
  String(body || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = vars[key];
    return value == null || value === "" ? `[${key}]` : String(value);
  });
