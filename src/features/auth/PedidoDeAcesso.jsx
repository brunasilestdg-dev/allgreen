import { useState } from "react";
import { solicitarAcessoToDoGreen } from "./authApi.js";
import { mensagemDeFalha } from "./authDomain.js";

// Pedido de acesso à To Do Green: quem não tem conta pede aqui e um
// administrador decide dentro do app. Fica só na entrada do ERP (os portais
// externos são liberados pela operação, não por pedido).
//
// O estado mora no `Login` (via `usePedidoDeAcesso`) para sobreviver a ir e
// voltar da tela de recuperação de senha, como sempre sobreviveu.

const PEDIDO_VAZIO = { nome: "", email: "", empresa: "", telefone: "", mensagem: "" };

const CAMPOS_DO_PEDIDO = [
  { chave: "nome", rotulo: "Nome", type: "text", required: true, maxLength: 160 },
  { chave: "email", rotulo: "E-mail corporativo", type: "email", required: true, maxLength: 160 },
  { chave: "empresa", rotulo: "Empresa / área", type: "text", maxLength: 160 },
  { chave: "telefone", rotulo: "Telefone (opcional)", type: "text", maxLength: 40 },
];

export function usePedidoDeAcesso() {
  const [pedindoAcesso, setPedindoAcesso] = useState(false);
  const [pedidoForm, setPedidoForm] = useState(PEDIDO_VAZIO);
  // "" | "enviando" | "enviado" | mensagem de erro.
  const [pedidoStatus, setPedidoStatus] = useState("");
  const enviarPedidoDeAcesso = async (evento) => {
    evento.preventDefault();
    setPedidoStatus("enviando");
    try {
      const { ok, data } = await solicitarAcessoToDoGreen(pedidoForm);
      if (!ok) throw new Error(data.error || "Não foi possível registrar o pedido.");
      setPedidoStatus("enviado");
    } catch (razao) {
      setPedidoStatus(mensagemDeFalha(razao, "Não foi possível registrar o pedido."));
    }
  };
  return {
    pedindoAcesso,
    setPedindoAcesso,
    pedidoForm,
    setPedidoForm,
    pedidoStatus,
    setPedidoStatus,
    enviarPedidoDeAcesso,
  };
}

export default function PedidoDeAcesso({ pedido }) {
  const {
    pedindoAcesso,
    setPedindoAcesso,
    pedidoForm,
    setPedidoForm,
    pedidoStatus,
    setPedidoStatus,
    enviarPedidoDeAcesso,
  } = pedido;
  if (pedidoStatus === "enviado")
    return (
      <p className="tdg-auth-request-status">
        Pedido enviado. Você receberá um convite por e-mail se for aprovado.
      </p>
    );
  if (!pedindoAcesso)
    return (
      <button
        type="button"
        className="tdg-auth-request-link"
        onClick={() => setPedindoAcesso(true)}
      >
        Ainda não tem acesso? Solicitar acesso
      </button>
    );
  return (
    <form className="tdg-auth-pedido tdg-auth-pedido-inline" onSubmit={enviarPedidoDeAcesso}>
      <strong>Solicitar acesso à To Do Green</strong>
      {CAMPOS_DO_PEDIDO.map((campo) => (
        <label key={campo.chave}>
          <span>{campo.rotulo}</span>
          <input
            type={campo.type}
            required={campo.required}
            maxLength={campo.maxLength}
            value={pedidoForm[campo.chave]}
            onChange={(e) => setPedidoForm((f) => ({ ...f, [campo.chave]: e.target.value }))}
          />
        </label>
      ))}
      <label>
        <span>Por que precisa de acesso?</span>
        <textarea
          rows={3}
          maxLength={1000}
          value={pedidoForm.mensagem}
          onChange={(e) => setPedidoForm((f) => ({ ...f, mensagem: e.target.value }))}
        />
      </label>
      {pedidoStatus && pedidoStatus !== "enviando" && (
        <p className="tdg-auth-pedido-erro">{pedidoStatus}</p>
      )}
      <div className="tdg-auth-pedido-acoes">
        <button
          type="button"
          onClick={() => {
            setPedindoAcesso(false);
            setPedidoStatus("");
          }}
        >
          Voltar
        </button>
        <button
          type="submit"
          className="tdg-auth-solicitar"
          disabled={pedidoStatus === "enviando"}
        >
          {pedidoStatus === "enviando" ? "Enviando..." : "Enviar pedido"}
        </button>
      </div>
    </form>
  );
}
