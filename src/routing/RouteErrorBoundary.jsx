import React from "react";
import { ehErroDeVersaoTrocada } from "../features/app/chunkRecovery.js";

// A proteção tinha um alcance só: a raiz. Qualquer falha em qualquer tela
// derrubava o app inteiro para o aviso genérico — e recarregar virou parte da
// rotina, que é exatamente o que não pode acontecer. Aqui a falha fica contida
// na TELA que falhou: o resto do app continua de pé, a pessoa tenta de novo sem
// perder a sessão e, se não der, volta ao início por navegação normal.
//
// Não substitui a proteção da raiz (src/main.jsx): é a camada de dentro, que
// quase sempre basta. Erro de versão trocada não para aqui — sobe para a raiz,
// onde a recarga única por versão resolve.
export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    if (ehErroDeVersaoTrocada(erro)) throw erro;
    return { erro };
  }

  componentDidUpdate(propsAnteriores) {
    // Trocou de tela? A falha anterior não vale mais — sem isso a pessoa ficava
    // presa no aviso mesmo depois de navegar para outro lugar.
    if (propsAnteriores.chave !== this.props.chave && this.state.erro) this.setState({ erro: null });
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="route-error" role="alert">
        <div className="route-error-card">
          <strong>Esta tela não abriu</strong>
          <p>O resto do sistema continua funcionando. Tente abrir de novo; se insistir, volte ao início.</p>
          <div className="route-error-actions">
            <button type="button" onClick={() => this.setState({ erro: null })}>Tentar de novo</button>
            <button
              type="button"
              className="route-error-secondary"
              onClick={() => {
                window.history.pushState({}, "", "/todogreen");
                window.dispatchEvent(new PopStateEvent("popstate"));
                this.setState({ erro: null });
              }}
            >
              Voltar ao início
            </button>
          </div>
        </div>
      </div>
    );
  }
}
