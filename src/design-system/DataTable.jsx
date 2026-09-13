import { EmptyState } from "./feedback.jsx";

// ===== Table — tabela de dados padrão (item 50/47) =====
//
// Config-driven: colunas declaram cabeçalho, alinhamento e como renderizar a
// célula. Cabeçalho fixo opcional (stickyHead) para listas longas; zebra
// opcional. Vem com estado vazio embutido (usa EmptyState) — lista sem linhas
// nunca fica um retângulo mudo.
//
// columns: [{ key, header, align?: "left"|"right"|"center", width?, render?(row) }]
export function Table({
  columns = [],
  rows = [],
  keyField = "id",
  getRowKey,
  onRowClick,
  zebra = true,
  stickyHead = false,
  empty,
  caption,
  className = "",
  ...props
}) {
  const chaveDaLinha = getRowKey || ((row, i) => row?.[keyField] ?? i);

  if (!rows.length && empty) {
    return <div className={`ds-table-wrap ${className}`.trim()}>{empty}</div>;
  }

  return (
    <div className={`ds-table-wrap ${className}`.trim()}>
      <table
        className={`ds-table${zebra ? " ds-table--zebra" : ""}${stickyHead ? " ds-table--sticky" : ""}`}
        {...props}
      >
        {caption && <caption className="ds-table__caption">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{ textAlign: col.align || "left", width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={chaveDaLinha(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "ds-table__row--clickable" : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align || "left" }}>
                  {col.render ? col.render(row) : row?.[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !empty && (
        <EmptyState title="Nada por aqui ainda" description="Quando houver registros, eles aparecem nesta lista." />
      )}
    </div>
  );
}
