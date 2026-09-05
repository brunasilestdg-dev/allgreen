import { useCallback, useEffect, useRef } from "react";

// ===== Pad de assinatura (#120b) =====
//
// Quem recebe assina com o dedo na tela do celular do motorista. O traço é
// desenhado num <canvas>; ao terminar um traço, devolve a imagem PNG por
// onChange (data URL). "Limpar" zera e devolve "" — assim o formulário sabe que
// não há assinatura. Ponteiro unificado (dedo e mouse) via Pointer Events.
//
// O canvas nasce com a resolução real do aparelho (devicePixelRatio) para a
// assinatura não sair serrilhada, mas o traço é medido em coordenadas de tela.
export default function PadAssinatura({ onChange, altura = 170 }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const desenhandoRef = useRef(false);
  const assinouRef = useRef(false);
  const larguraRef = useRef(0);
  // onChange é uma função inline do pai: muda de identidade a cada render do
  // formulário (inclusive a cada tecla digitada em "Quem recebeu"). Guardá-la
  // num ref tira ela das dependências do efeito — senão o efeito re-rodaria a
  // cada render e `preparar()` (que redefine canvas.width) APAGARIA a assinatura
  // já feita. Este era o bug: assinatura de mais de um traço perdia tudo menos
  // o último.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const preparar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const largura = canvas.clientWidth || 300;
    larguraRef.current = largura;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#14321f";
    ctxRef.current = ctx;
  }, [altura]);

  useEffect(() => {
    preparar();
    // Só re-preparar quando a LARGURA muda de fato. No celular, abrir o teclado
    // (ao tocar em "Quem recebeu") dispara `resize` só de ALTURA — re-preparar
    // aí apagaria a assinatura pronta. Largura igual: não mexe.
    const aoRedimensionar = () => {
      const largura = canvasRef.current?.clientWidth || 0;
      if (largura === larguraRef.current) return;
      preparar();
      assinouRef.current = false;
      onChangeRef.current("");
    };
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [preparar]);

  const ponto = (event) => {
    const canvas = canvasRef.current;
    const r = canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  const inicio = (event) => {
    event.preventDefault();
    const ctx = ctxRef.current;
    if (!ctx) return;
    desenhandoRef.current = true;
    const { x, y } = ponto(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    try { event.target.setPointerCapture?.(event.pointerId); } catch { /* nem todo alvo captura */ }
  };

  const mover = (event) => {
    if (!desenhandoRef.current) return;
    event.preventDefault();
    const ctx = ctxRef.current;
    const { x, y } = ponto(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    assinouRef.current = true;
  };

  const fim = () => {
    if (!desenhandoRef.current) return;
    desenhandoRef.current = false;
    if (assinouRef.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const limpar = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    assinouRef.current = false;
    onChange("");
  };

  return (
    <div className="tdg-driver-assinatura">
      <canvas
        ref={canvasRef}
        style={{ height: `${altura}px` }}
        onPointerDown={inicio}
        onPointerMove={mover}
        onPointerUp={fim}
        onPointerLeave={fim}
        aria-label="Área para a assinatura de quem recebeu"
      />
      <button type="button" onClick={limpar}>Limpar assinatura</button>
    </div>
  );
}
