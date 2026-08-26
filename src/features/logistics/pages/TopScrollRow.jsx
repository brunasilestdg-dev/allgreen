import { useCallback, useEffect, useRef, useState } from "react";

// Barra de rolagem TAMBÉM no topo de um container que rola na horizontal.
// Em telas largas (kanban, forecast, tabelas), a barra só embaixo obriga a
// descer até o fim para rolar de lado. Aqui um "trilho fantasma" no topo
// espelha a largura real do conteúdo e sincroniza o scrollLeft nos dois
// sentidos. Sem libs — só refs e listeners.
export default function TopScrollRow({ children, className = "", ariaLabel }) {
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const [larguraConteudo, setLarguraConteudo] = useState(0);
  const sincronizando = useRef(false);

  const medir = useCallback(() => {
    const body = bodyRef.current;
    if (body) setLarguraConteudo(body.scrollWidth);
  }, []);

  useEffect(() => {
    medir();
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(medir);
    ro.observe(body);
    for (const filho of body.children) ro.observe(filho);
    return () => ro.disconnect();
  }, [medir, children]);

  const aoRolar = (origem) => () => {
    if (sincronizando.current) { sincronizando.current = false; return; }
    const top = topRef.current;
    const body = bodyRef.current;
    if (!top || !body) return;
    sincronizando.current = true;
    if (origem === "top") body.scrollLeft = top.scrollLeft;
    else top.scrollLeft = body.scrollLeft;
  };

  // Só mostra a barra de topo quando há de fato overflow horizontal.
  const temOverflow = larguraConteudo > (bodyRef.current?.clientWidth || 0) + 1;

  return (
    <div className={`tdg-topscroll ${className}`}>
      <div
        ref={topRef}
        className="tdg-topscroll-bar"
        aria-hidden="true"
        style={{ visibility: temOverflow ? "visible" : "hidden" }}
        onScroll={aoRolar("top")}
      >
        <div style={{ width: larguraConteudo }} />
      </div>
      <div
        ref={bodyRef}
        className="tdg-topscroll-body"
        role={ariaLabel ? "region" : undefined}
        aria-label={ariaLabel}
        onScroll={aoRolar("body")}
      >
        {children}
      </div>
    </div>
  );
}
