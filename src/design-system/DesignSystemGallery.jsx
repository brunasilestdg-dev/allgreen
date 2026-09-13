import { useState } from "react";
import { Copy, Inbox, Pencil, Save, Trash2, TrendingUp, User } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  IconButton,
  Input,
  MetricCard,
  PageHeader,
  Radio,
  RadioCards,
  SearchableSelect,
  SegmentedControl,
  Skeleton,
  Spinner,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  Toolbar,
  Tooltip,
} from "./index.js";

// ===== Galeria do Design System (Onda 1) =====
//
// Uma tela viva com todos os componentes novos, para ver o sistema de uma vez —
// e para o build/teste validarem que tudo compila. É a referência de "assim
// fica" antes de adotar nas telas de verdade.

const CLIENTES = [
  { value: "natura", label: "Natura", description: "Cosméticos · SP", group: "Ativos", keywords: ["beleza"] },
  { value: "raia", label: "Raia Drogasil", description: "Farma · SP", group: "Ativos" },
  { value: "ambev", label: "Ambev", description: "Bebidas · MG", group: "Ativos" },
  { value: "vale", label: "Vale", description: "Mineração · PA", group: "Prospecção" },
  { value: "klabin", label: "Klabin", description: "Papel · PR", group: "Prospecção", disabled: true },
];

export default function DesignSystemGallery() {
  const [cliente, setCliente] = useState(null);
  const [equipe, setEquipe] = useState([]);
  const [visibilidade, setVisibilidade] = useState("espaco");
  const [temperatura, setTemperatura] = useState("Morno");
  const [aba, setAba] = useState("resumo");
  const [drawerAberto, setDrawerAberto] = useState(false);
  const [aviso, setAviso] = useState("SP · turno da manhã sem motorista alocado.");

  return (
    <main className="tdg" style={{ display: "grid", gap: 28, maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <header>
        <span className="eyebrow">TO DO GREEN · DESIGN SYSTEM</span>
        <h1 style={{ margin: "4px 0" }}>Componentes da Onda 1</h1>
        <p style={{ color: "var(--ds-ink-muted)" }}>A base que todas as telas passam a reusar. Verde com função, hierarquia por peso, foco sempre visível.</p>
      </header>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Botões</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Button icon={Save}>Salvar</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="tertiary">Terciário</Button>
          <Button variant="danger" icon={Trash2}>Excluir</Button>
          <Button variant="ghost">Ghost</Button>
          <Button loading>Enviando</Button>
          <Button disabled>Desabilitado</Button>
          <IconButton icon={Pencil} label="Editar linha" />
          <IconButton icon={Copy} label="Duplicar linha" />
          <IconButton icon={Trash2} label="Remover linha" variant="danger" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <Button size="sm">Pequeno</Button>
          <Button size="md">Médio</Button>
          <Button size="lg">Grande</Button>
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Selects com busca (fim do &lt;select&gt; antigo)</h2>
        <SearchableSelect
          label="Cliente" options={CLIENTES} value={cliente} onChange={setCliente}
          placeholder="Escolher cliente" hint="Digite para filtrar — sem acento, sem caixa."
          onCreate={(t) => setCliente(t)}
        />
        <SearchableSelect
          label="Equipe responsável" multiple options={CLIENTES} value={equipe} onChange={setEquipe}
          placeholder="Adicionar pessoas"
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Campos</h2>
        <Input label="Nome do negócio" placeholder="Ex.: Natura — fulfillment PR" />
        <Input label="E-mail" type="email" error="Informe um e-mail válido." defaultValue="foo@" />
        <Textarea label="Observações" placeholder="Contexto, próximos passos…" />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Decisão em blocos clicáveis</h2>
        <Field label="Quem pode ver">
          <RadioCards
            value={visibilidade} onChange={setVisibilidade} name="vis"
            options={[
              { value: "privado", label: "Privado", description: "Só você visualiza.", icon: User },
              { value: "pessoas", label: "Pessoas específicas", description: "Escolha quem pode ver ou editar." },
              { value: "espaco", label: "Todo o espaço", description: "Todos os usuários permitidos terão acesso." },
            ]}
          />
        </Field>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Alternância e abas</h2>
        <Field label="Temperatura da conta">
          <SegmentedControl
            ariaLabel="Temperatura" value={temperatura} onChange={setTemperatura}
            options={[{ value: "Frio", label: "Frio" }, { value: "Morno", label: "Morno" }, { value: "Quente", label: "Quente" }]}
          />
        </Field>
        <Tabs
          ariaLabel="Seções da conta" value={aba} onChange={setAba}
          tabs={[
            { value: "resumo", label: "Resumo" },
            { value: "pessoas", label: "Pessoas", badge: 4 },
            { value: "oportunidades", label: "Oportunidades", badge: 2 },
            { value: "conversas", label: "Conversas" },
          ]}
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Status</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <StatusBadge status="Concluído" />
          <StatusBadge status="Em andamento" />
          <StatusBadge status="Atrasado" />
          <StatusBadge status="Frio" />
          <Badge tone="info">Novo</Badge>
          <Badge tone="neutral" dot={false}>Rascunho</Badge>
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Topo de página e barra de ações</h2>
        <PageHeader
          kicker="Comercial"
          title="Oportunidades"
          subtitle="Funil da semana, por estágio."
          breadcrumb={[{ label: "Visão geral" }, { label: "Comercial" }, { label: "Oportunidades" }]}
          actions={<Button icon={Save} size="sm">Nova oportunidade</Button>}
        />
        <Toolbar>
          <Input placeholder="Buscar cliente…" />
          <Button variant="secondary" size="sm">Filtros</Button>
        </Toolbar>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Cartões e indicadores</h2>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <MetricCard label="Receita 30d" value="R$ 128 mil" trend="up" trendTone="success" hint="+12% vs. anterior" icon={TrendingUp} />
          <MetricCard label="Custo por rota" value="R$ 42,10" trend="up" trendTone="danger" hint="+4% — atenção" />
          <MetricCard label="Ocupação" value="87%" trend="flat" hint="estável" />
        </div>
        <Card title="Contrato de energia renovável" kicker="ESG" actions={<IconButton icon={Pencil} label="Editar contrato" />}>
          <p style={{ margin: 0, color: "var(--ds-ink-muted)", fontSize: ".9rem" }}>
            Superfície padrão de conteúdo — mesma borda, raio e sombra em toda a plataforma.
          </p>
        </Card>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Avisos</h2>
        {aviso && <Alert tone="warning" title="Capacidade" onClose={() => setAviso("")}>{aviso}</Alert>}
        <Alert tone="success" title="Publicado">Deploy no Cloudflare concluído.</Alert>
        <Alert tone="danger" title="Falha">Não foi possível ler os dados agora.</Alert>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Tabela</h2>
        <Table
          columns={[
            { key: "cliente", header: "Cliente" },
            { key: "rota", header: "Rota" },
            { key: "status", header: "Situação", render: (r) => <StatusBadge status={r.status} /> },
            { key: "valor", header: "Valor", align: "right" },
          ]}
          rows={[
            { id: 1, cliente: "Natura", rota: "SP → RJ", status: "Aprovado", valor: "R$ 3.200" },
            { id: 2, cliente: "Vale", rota: "PA → MA", status: "Pendente", valor: "R$ 9.800" },
            { id: 3, cliente: "Ambev", rota: "MG → SP", status: "Cancelado", valor: "R$ 5.400" },
          ]}
        />
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Escolhas simples, dica e painel lateral</h2>
        <Checkbox label="Registrar receita no caixa ao criar o pedido" defaultChecked />
        <Radio name="periodo" label="Turno da manhã" defaultChecked />
        <Radio name="periodo" label="Turno da tarde" />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Tooltip label="Abre o painel lateral">
            <Button variant="secondary" size="sm" onClick={() => setDrawerAberto(true)}>Abrir Drawer</Button>
          </Tooltip>
          <Spinner inline label="Carregando" />
        </div>
        <Drawer
          open={drawerAberto}
          onClose={() => setDrawerAberto(false)}
          title="Detalhe da rota"
          footer={<Button size="sm" onClick={() => setDrawerAberto(false)}>Fechar</Button>}
        >
          <p style={{ margin: 0 }}>Conteúdo lateral sem sair da tela.</p>
        </Drawer>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ fontSize: "1rem" }}>Carregando e vazio</h2>
        <Skeleton lines={3} />
        <EmptyState
          icon={Inbox}
          title="Nenhuma oportunidade ainda"
          description="Cadastre a primeira para o funil começar a mostrar resultado."
          action={<Button size="sm" icon={Save}>Nova oportunidade</Button>}
        />
      </section>
    </main>
  );
}
