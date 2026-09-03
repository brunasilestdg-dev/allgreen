# Auditoria CAT-01: Divergência entre Catálogos de Módulos

**Severidade:** 🟡 Média  
**Data:** 02/09/2026  
**Achado:** Quatro catálogos paralelos descrevendo os mesmos 85 módulos já têm 23 divergências documentadas.

## Os 4 Catálogos

| Catálogo | Localização | Entries | Propósito |
|----------|-----------|---------|----------|
| `TODO_GREEN_MODULE_CATALOG` | `logisticsVerticalDomain.js` | 83 | Fonte da verdade: dados, descrição, permissão |
| `IMPLEMENTED_MODULE_IDS` | `LogisticsVertical.jsx:216` | 80 | Set: quais módulos estão "prontos" para UI |
| `MODULE_IMPLEMENTATION` | `LogisticsVertical.jsx:299` | 49 | Objeto: detalhes de rota, ícone, NavLabel |
| `ERP_SHORTCUTS` | Dashboard/Home | ? | Atalhos rápidos para usuário |

## Divergências Encontradas

### 13 módulos em TODO_GREEN_MODULE_CATALOG, MAS NÃO em IMPLEMENTED_MODULE_IDS

Esses módulos aparecem no catálogo, **então devem aparecer no menu**, mas por não estar em `IMPLEMENTED_MODULE_IDS` ficam com **status "Em implantação"** (cinza, não clicável).

```
remuneracao, benchmark, central-rfq, sobre-o-negocio, orcamento, centros-custo,
pacotes, tarefas, avancos, documentos, aprovacoes, notificacoes, inbox
```

**Diagnóstico:** Ou:
- (a) Estão realmente não prontos → remover de TODO_GREEN_MODULE_CATALOG
- (b) Estão prontos → adicionar a IMPLEMENTED_MODULE_IDS

**Exemplo concreto:** `central-rfq` está em TODO_GREEN_MODULE_CATALOG com descrição "Acervo de habilitação com semáforo de validade". Está implementado (existe tela CentralRfqPage.jsx)? Se sim, adicione a IMPLEMENTED_MODULE_IDS.

---

### 10 módulos em IMPLEMENTED_MODULE_IDS, MAS NÃO em TODO_GREEN_MODULE_CATALOG

Esses módulos aparecem como "implementados" mas não têm descrição no catálogo.

```
motorista-frota, dashboards, comunicacao-interna, administracao, rasci, fluxos,
manual, comissoes, visualizacoes, agentes-funcoes
```

**Exemplo:** `motorista-frota` está em IMPLEMENTED mas não em TODO_GREEN_MODULE_CATALOG. O `motorista-frota` é alias de `veiculos` + `motoristas` ou um módulo próprio?

**Ação:** Adicionar a TODO_GREEN_MODULE_CATALOG com descrição, ou remover de IMPLEMENTED se for alias.

---

### 42 chaves em MODULE_IMPLEMENTATION, MAS não em catálogo

Incluem: `acessos`, `operacoes-fluxo`, `recurso-rastreador`, `templates`, `integracoes`, etc.

**Diagnóstico:** MODULE_IMPLEMENTATION tem uma granularidade diferente — mistura telas, recursos, screens, features. Enquanto TODO_GREEN_MODULE_CATALOG é "o que o usuário vê no menu".

**Ação:** Desambiguar: usar MODULE_IMPLEMENTATION como registro técnico interno, não de fonte de UI.

---

## Impacto Prático

Quem quer saber "quantas funcionalidades tem o ERP?" recebe respostas diferentes:
- **"85"** (TODO_GREEN_MODULE_CATALOG)
- **"80"** (IMPLEMENTED_MODULE_IDS)
- **"49"** (MODULE_IMPLEMENTATION)

Usuários com papel `motorista` navegam para "Central de Trabalho" → não sai em `/api/todogreen/` porque não passa por `internalReadAccess` (SEG-01), assim como acessam `pricing-parameters` sem permissão (SEG-02).

---

## Recomendação

1. **Semanal:** Sincronizar TODO_GREEN_MODULE_CATALOG ↔ IMPLEMENTED_MODULE_IDS. Use um teste que aponta divergências.
2. **Refatorar:** Consolidar os 4 catálogos em 2: _catálogo de negócio_ (tudo que existe) + _status de UI_ (o que está ativo no menu para cada papel).
3. **Audit automático:** npm script que valida: `TODO_GREEN_MODULE_CATALOG ⊆ IMPLEMENTED_MODULE_IDS` (todos os módulos descritos devem ter status).

---

## Rastreamento

- [ ] Verificar se `central-rfq`, `tarefas`, `avancos` estão de fato implementados
- [ ] Remover de catálogo ou implementar os 13 faltantes
- [ ] Adicionar os 10 que faltam ao catálogo
- [ ] Desambiguar MODULE_IMPLEMENTATION como "técnico" vs "UI"
- [ ] Criar teste de divergência
