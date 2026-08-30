import { describe, expect, it, vi } from "vitest";
import {
  MOTIVOS,
  calcularDistancia,
  geocodificar,
  resumoDaDistancia,
} from "./distanciaRodoviariaDomain.js";

// A régua deste módulo: a precificação NUNCA quebra por causa dele. Toda falha
// externa vira motivo em português, e o campo continua editável à mão.

const resposta = (corpo, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => corpo,
});

// Um `fetch` que responde por URL, para o teste não tocar a rede.
const fetchFalso = ({ geo = {}, rota = null, falhar = "" } = {}) =>
  vi.fn(async (entrada) => {
    const alvo = String(entrada?.href || entrada);
    if (alvo.includes("nominatim")) {
      if (falhar === "nominatim") return resposta({}, false, 503);
      const termo = new URL(alvo).searchParams.get("q");
      const ponto = geo[termo];
      return resposta(ponto ? [ponto] : []);
    }
    if (alvo.includes("router.project-osrm")) {
      if (falhar === "osrm") return resposta({}, false, 500);
      return resposta({ routes: rota ? [rota] : [] });
    }
    throw new Error(`URL inesperada: ${alvo}`);
  });

const SANTOS = { lat: "-23.96", lon: "-46.33", display_name: "Santos, São Paulo, Brasil" };
const OSASCO = { lat: "-23.53", lon: "-46.79", display_name: "Osasco, São Paulo, Brasil" };
const ROTA_80KM = { distance: 80000, duration: 5400 }; // 80 km, 1h30

describe("geocodificar", () => {
  it("restringe ao Brasil e se identifica ao OpenStreetMap", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS } });
    await geocodificar("Santos", { fetcher });
    const [url, opcoes] = fetcher.mock.calls[0];
    // Sem countrycodes, "Santos" vira Santos de Portugal e a rota sai com
    // 9.000 km — o erro mais caro que este módulo pode cometer.
    expect(new URL(url).searchParams.get("countrycodes")).toBe("br");
    // Sem user-agent o Nominatim recusa em volume, com 403 sem explicação.
    expect(opcoes.headers["user-agent"]).toMatch(/SeuFuncionario/);
  });

  it("devolve null quando não acha, em vez de lançar", async () => {
    const fetcher = fetchFalso({ geo: {} });
    expect(await geocodificar("xyzabc inexistente", { fetcher })).toBeNull();
  });

  it("ignora endereço curto demais sem gastar chamada", async () => {
    const fetcher = fetchFalso({});
    expect(await geocodificar("SP", { fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("calcularDistancia", () => {
  const cenario = (extra = {}) => fetchFalso({
    geo: { "CD Osasco": OSASCO, "Loja Santos": SANTOS },
    rota: ROTA_80KM,
    ...extra,
  });

  it("traz a distância rodoviária real do trecho", async () => {
    const resultado = await calcularDistancia(
      { origem: "CD Osasco", destino: "Loja Santos" },
      { fetcher: cenario() },
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.distanciaKm).toBe(80);
    expect(resultado.kmTrecho).toBe(80);
    expect(resultado.minutosTrecho).toBe(90);
    expect(resultado.fonte).toMatch(/OpenStreetMap/);
  });

  it("dobra o trecho quando a viagem é ida e volta", async () => {
    // Em Middle Mile a viagem é o ciclo completo. Cobrar só a ida é o erro que
    // aparece na margem no fim do mês.
    const resultado = await calcularDistancia(
      { origem: "CD Osasco", destino: "Loja Santos", idaEVolta: true },
      { fetcher: cenario() },
    );
    expect(resultado.distanciaKm).toBe(160);
    expect(resultado.kmTrecho).toBe(80);
    expect(resultado.idaEVolta).toBe(true);
  });

  it("consulta os endereços em sequência, não em paralelo", async () => {
    // O Nominatim público aceita ~1 consulta por segundo. Disparar as duas
    // juntas é o caminho direto para o 429.
    const fetcher = cenario();
    await calcularDistancia({ origem: "CD Osasco", destino: "Loja Santos" }, { fetcher });
    const ordem = fetcher.mock.calls.map(([u]) => (String(u).includes("nominatim") ? "geo" : "rota"));
    expect(ordem).toEqual(["geo", "geo", "rota"]);
  });

  it("distingue origem de destino quando não acha o endereço", async () => {
    const semDestino = fetchFalso({ geo: { "CD Osasco": OSASCO }, rota: ROTA_80KM });
    const resultado = await calcularDistancia(
      { origem: "CD Osasco", destino: "endereço inexistente" },
      { fetcher: semDestino },
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.motivo).toBe(MOTIVOS.destinoNaoEncontrado);
  });

  it("recusa antes de gastar chamada quando falta um dos lados", async () => {
    const fetcher = cenario();
    const resultado = await calcularDistancia({ origem: "CD Osasco", destino: "" }, { fetcher });
    expect(resultado.motivo).toBe(MOTIVOS.incompleto);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serviço fora do ar NÃO quebra a precificação", async () => {
    for (const falhar of ["nominatim", "osrm"]) {
      const resultado = await calcularDistancia(
        { origem: "CD Osasco", destino: "Loja Santos" },
        { fetcher: cenario({ falhar }) },
      );
      // Devolve motivo, não exceção: o campo continua editável à mão.
      expect(resultado.ok).toBe(false);
      expect(resultado.motivo).toBe(MOTIVOS.indisponivel);
    }
  });

  it("dois pontos sem rota rodoviária dizem isso, e não zero", async () => {
    const semRota = fetchFalso({ geo: { "CD Osasco": OSASCO, "Loja Santos": SANTOS }, rota: null });
    const resultado = await calcularDistancia(
      { origem: "CD Osasco", destino: "Loja Santos" },
      { fetcher: semRota },
    );
    // Zero km entraria na conta como premissa válida e zeraria o custo de
    // combustível sem ninguém perceber.
    expect(resultado.ok).toBe(false);
    expect(resultado.distanciaKm).toBeUndefined();
    expect(resultado.motivo).toBe(MOTIVOS.semRota);
  });

  it("cancelamento é reconhecido como tal, não como erro do serviço", async () => {
    const abortado = vi.fn(async () => {
      const erro = new Error("The operation was aborted");
      erro.name = "AbortError";
      throw erro;
    });
    const resultado = await calcularDistancia(
      { origem: "CD Osasco", destino: "Loja Santos" },
      { fetcher: abortado },
    );
    expect(resultado.cancelado).toBe(true);
  });
});

describe("resumoDaDistancia", () => {
  it("explica de onde veio o número", async () => {
    const ida = await calcularDistancia(
      { origem: "CD Osasco", destino: "Loja Santos" },
      { fetcher: fetchFalso({ geo: { "CD Osasco": OSASCO, "Loja Santos": SANTOS }, rota: ROTA_80KM }) },
    );
    expect(resumoDaDistancia(ida)).toBe("80 km · 1h30 de viagem por trecho, sem trânsito");
  });

  it("ida e volta mostra o total E o trecho — são números diferentes", () => {
    const resumo = resumoDaDistancia({
      ok: true, distanciaKm: 160, kmTrecho: 80, idaEVolta: true, minutosTrecho: 90,
    });
    expect(resumo).toContain("160 km ida e volta");
    expect(resumo).toContain("80 km por trecho");
  });

  it("resultado com falha não vira texto", () => {
    expect(resumoDaDistancia({ ok: false, motivo: "x" })).toBe("");
    expect(resumoDaDistancia(null)).toBe("");
  });
});
