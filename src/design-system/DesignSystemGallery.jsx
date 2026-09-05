import { useState } from "react";
import { Copy, Pencil, Save, Trash2, User } from "lucide-react";
import { Badge, Button, Field, IconButton, Input, RadioCards, SearchableSelect, StatusBadge, Textarea } from "./index.js";

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
    </main>
  );
}
