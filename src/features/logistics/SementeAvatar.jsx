// O rosto do Todô.
//
// Desenhado como SVG em vez de imagem: acompanha o tamanho sem borrar, muda
// de estado sem trocar de arquivo, e não depende de um asset que pode faltar
// no bundle de produção.
//
// A identidade é a da marca To Do Green: uma folha elétrica brotando sobre uma
// carinha amigável — a mesma marca do ícone do app (public/icone-*.png são
// gerados a partir deste desenho, para o app e o assistente terem UMA cara só).
export default function SementeAvatar({ estado = "calma", tamanho = 30 }) {
  return (
    <span
      className={`semente-avatar semente-avatar--${estado}`}
      style={{ width: tamanho, height: tamanho }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width="100%" height="100%" role="presentation" focusable="false">
        {/* A folha: um gomo cheio (lima) e a metade de trás (verde escuro) para
            dar profundidade, com a nervura subindo até a cabeça. */}
        <path d="M23.4 12.2C22.1 6.7 17.2 3.4 11.4 3.2c-.8 0-1.3.7-1.1 1.5 1.4 5.6 6.2 8.9 12 9.1.7 0 1.3-.6 1.1-1.6z" className="semente-folha semente-folha--traseira" />
        <path d="M24 12.6c1-6 6-9.7 12.2-9.9.8 0 1.4.7 1.2 1.5-1.4 6-6.5 9.6-12.7 9.8-.5 0-.9-.6-.7-1.4z" className="semente-folha" />
        <path d="M24 17.5c0-3 .1-5 .4-6.9" className="semente-caule" />

        {/* A cabeça: quadrado bem arredondado, branco. */}
        <rect x="7.5" y="16" width="33" height="25" rx="12" className="semente-cabeca" />

        {/* A "tela" onde a carinha acende. */}
        <rect x="12" y="20.5" width="24" height="16" rx="8" className="semente-viseira" />
        <circle cx="19" cy="27" r="3" className="semente-olho" />
        <circle cx="29" cy="27" r="3" className="semente-olho" />
        <path d="M19.5 31.6c1.4 1.4 3.1 2.1 4.5 2.1s3.1-.7 4.5-2.1" className="semente-sorriso" />

        {/* Orelhinhas laterais, discretas. */}
        <rect x="4.2" y="25" width="3.4" height="7.5" rx="1.7" className="semente-orelha" />
        <rect x="40.4" y="25" width="3.4" height="7.5" rx="1.7" className="semente-orelha" />
      </svg>
    </span>
  );
}
