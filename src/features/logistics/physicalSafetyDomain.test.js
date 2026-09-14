import { describe, it, expect } from "vitest";
import {
  CONTEXTOS_PROIBIDOS,
  MOTIVOS_BLOQUEIO,
  LIMITE_PARADO_KMH,
  podeBloquearRemoto,
  registrarTentativaBloqueio,
  detectarCoacao,
  abridoraForaDoPonto,
  desvioDeRota,
  escalonamentoInexecucaoContato,
} from "./physicalSafetyDomain.js";

const autoriz = (autorId, papel) => ({ autorId, papel });

describe("physicalSafetyDomain · segurança física", () => {
  it("declara os contextos proibidos e o limite de 'praticamente parado'", () => {
    expect(CONTEXTOS_PROIBIDOS).toContain("rodovia");
    expect(CONTEXTOS_PROIBIDOS).toContain("tunel");
    expect(CONTEXTOS_PROIBIDOS).toContain("cruzamento");
    expect(LIMITE_PARADO_KMH).toBe(5);
    expect(Object.isFrozen(MOTIVOS_BLOQUEIO)).toBe(true);
  });

  it("podeBloquearRemoto recusa motivo fora da lista", () => {
    const r = podeBloquearRemoto({ contexto: "estacionamento", velocidadeKmh: 0, motivo: "vontade-do-dono", autorizacoes: [autoriz("a", "operacao-lider"), autoriz("b", "seguranca-24x7")] });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe("motivo-nao-autorizado");
  });

  it("podeBloquearRemoto recusa contexto proibido (rodovia/túnel/cruzamento)", () => {
    for (const c of CONTEXTOS_PROIBIDOS) {
      const r = podeBloquearRemoto({
        contexto: c,
        velocidadeKmh: 0,
        motivo: "roubo-confirmado",
        autorizacoes: [autoriz("a", "operacao-lider"), autoriz("b", "seguranca-24x7")],
      });
      expect(r.permitido, `contexto ${c} deveria recusar`).toBe(false);
      expect(r.motivo).toBe(`contexto-proibido:${c}`);
    }
  });

  it("podeBloquearRemoto recusa quando o veículo está em movimento", () => {
    const r = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 12,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "operacao-lider"), autoriz("b", "seguranca-24x7")],
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe("veiculo-em-movimento");
  });

  it("podeBloquearRemoto recusa quando a leitura de velocidade não é confiável", () => {
    const r = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 0,
      velocidadeConfiavel: false,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "operacao-lider"), autoriz("b", "seguranca-24x7")],
    });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toBe("velocidade-nao-confiavel");
  });

  it("podeBloquearRemoto exige DUAS pessoas diferentes de papéis autorizados", () => {
    const soUm = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 0,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "operacao-lider")],
    });
    expect(soUm.permitido).toBe(false);
    const mesmaPessoa = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 0,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "operacao-lider"), autoriz("a", "seguranca-24x7")],
    });
    expect(mesmaPessoa.permitido).toBe(false);
    const papelInvalido = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 0,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "motorista"), autoriz("b", "operacao-lider")],
    });
    expect(papelInvalido.permitido).toBe(false);
  });

  it("podeBloquearRemoto autoriza quando todas as barreiras passam", () => {
    const r = podeBloquearRemoto({
      contexto: "estacionamento",
      velocidadeKmh: 0,
      motivo: "roubo-confirmado",
      autorizacoes: [autoriz("a", "operacao-lider"), autoriz("b", "seguranca-24x7")],
    });
    expect(r.permitido).toBe(true);
    expect(r.motivo).toBeNull();
  });

  it("registrarTentativaBloqueio grava permitidas e negadas com evidência", () => {
    const decisao = podeBloquearRemoto({
      contexto: "rodovia",
      velocidadeKmh: 80,
      motivo: "roubo-confirmado",
      autorizacoes: [],
    });
    const log = registrarTentativaBloqueio([], decisao, { veiculoId: "v1", evidencia: { camera: "CAM-01" } });
    expect(log).toHaveLength(1);
    expect(log[0].permitido).toBe(false);
    expect(log[0].evidencia).toEqual({ camera: "CAM-01" });
  });

  it("detectarCoacao distingue senha normal e senha de coação", () => {
    const normal = "hash-normal";
    const coacao = "hash-coacao";
    expect(detectarCoacao({ digitada: normal, senhaNormalHash: normal, senhaCoacaoHash: coacao })).toEqual({ coacao: false, autenticou: true });
    expect(detectarCoacao({ digitada: coacao, senhaNormalHash: normal, senhaCoacaoHash: coacao })).toEqual({ coacao: true, autenticou: true });
    expect(detectarCoacao({ digitada: "outra", senhaNormalHash: normal, senhaCoacaoHash: coacao })).toEqual({ coacao: false, autenticou: false });
  });

  it("abridoraForaDoPonto usa raio em metros do ponto autorizado", () => {
    const pontos = [
      { id: "cliente-A", lat: -23.55, lon: -46.63, raioMetros: 100 },
    ];
    // dentro do raio: ≈ 50 m
    const dentro = abridoraForaDoPonto({ pontosAutorizados: pontos, posicao: { lat: -23.5502, lon: -46.6299 } });
    expect(dentro.foraDoPonto).toBe(false);
    // fora: ≈ 200 m
    const fora = abridoraForaDoPonto({ pontosAutorizados: pontos, posicao: { lat: -23.552, lon: -46.632 } });
    expect(fora.foraDoPonto).toBe(true);
    // sem posição: fora
    expect(abridoraForaDoPonto({ pontosAutorizados: pontos, posicao: null }).foraDoPonto).toBe(true);
  });

  it("desvioDeRota mede distância mínima até a polyline", () => {
    const polyline = [
      { lat: -23.55, lon: -46.63 },
      { lat: -23.56, lon: -46.64 },
    ];
    const emCimaDaRota = desvioDeRota({ polyline, posicao: { lat: -23.555, lon: -46.635 }, limiteMetros: 400 });
    expect(emCimaDaRota.desviado).toBe(false);
    const longe = desvioDeRota({ polyline, posicao: { lat: -23.60, lon: -46.70 }, limiteMetros: 400 });
    expect(longe.desviado).toBe(true);
  });

  it("escalonamentoInexecucaoContato sobe do 'ok' ao 'supervisor' e à 'segurança central' com o tempo", () => {
    const base = 100 * 60000;
    expect(escalonamentoInexecucaoContato({ ultimaRespostaMs: base, agoraMs: base + 60000 }).nivel).toBe("ok");
    expect(escalonamentoInexecucaoContato({ ultimaRespostaMs: base, agoraMs: base + 6 * 60000 }).nivel).toBe("supervisor");
    expect(escalonamentoInexecucaoContato({ ultimaRespostaMs: base, agoraMs: base + 16 * 60000 }).nivel).toBe("seguranca-central");
  });
});
