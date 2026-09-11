import { describe, expect, it, vi } from "vitest";
import {
  MOTIVOS,
  aplicarOrdemDoMeio,
  calcularDistancia,
  geocodificar,
  normalizarCarregadores,
  normalizarCarregadoresOSM,
  resumoDaDistancia,
  otimizarOrdemDeParadas,
  sugerirEnderecos,
  tracarRota,
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

  it("usa o gateway interno quando há sessão autenticada", async () => {
    const fetcher = vi.fn(async () => resposta([SANTOS]));
    const ponto = await geocodificar("Santos", {
      fetcher,
      headers: { authorization: "Bearer teste" },
    });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("/api/todogreen/maps/geocode");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ q: "Santos", limit: 5 });
    expect(ponto.latitude).toBe(-23.96);
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

// GeoJSON é [lon, lat]; a rota devolvida ao mapa precisa vir [lat, lon].
const ROTA_GEO = {
  distance: 80000,
  duration: 5400,
  geometry: { coordinates: [[-46.33, -23.96], [-46.5, -23.7], [-46.79, -23.53]] },
};

describe("tracarRota (geometria para o mapa)", () => {
  it("devolve a linha em [lat, lon] com distância e pontos", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS, Osasco: OSASCO }, rota: ROTA_GEO });
    const r = await tracarRota({ origem: "Santos", destino: "Osasco" }, { fetcher });
    expect(r.ok).toBe(true);
    expect(r.distanciaKm).toBe(80);
    expect(r.pontos[0]).toEqual([-23.96, -46.33]);
    expect(r.pontos.at(-1)).toEqual([-23.53, -46.79]);
    expect(r.origem.coord).toEqual([-23.96, -46.33]);
    expect(r.destino.coord).toEqual([-23.53, -46.79]);
  });

  it("usa o OSRM pelo gateway interno quando autenticada", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(resposta([SANTOS]))
      .mockResolvedValueOnce(resposta([OSASCO]))
      .mockResolvedValueOnce(resposta({ routes: [ROTA_GEO] }));
    const r = await tracarRota(
      { origem: "Santos", destino: "Osasco" },
      { fetcher, headers: { authorization: "Bearer teste" } },
    );
    expect(r.ok).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("/api/todogreen/maps/geocode");
    expect(fetcher.mock.calls[2][0]).toBe("/api/todogreen/maps/route");
    expect(JSON.parse(fetcher.mock.calls[2][1].body).coordinates).toEqual([
      [-46.33, -23.96],
      [-46.79, -23.53],
    ]);
  });

  it("sem geometria, informa que não há rota — não trava", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS, Osasco: OSASCO }, rota: { distance: 80000, duration: 5400 } });
    const r = await tracarRota({ origem: "Santos", destino: "Osasco" }, { fetcher });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.semRota);
  });

  it("origem que não geocodifica vira motivo em português", async () => {
    const fetcher = fetchFalso({ geo: {}, rota: ROTA_GEO });
    const r = await tracarRota({ origem: "xyzabc inexistente", destino: "Osasco" }, { fetcher });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.origemNaoEncontrada);
  });
});

describe("tracarRota com várias paradas", () => {
  const CAMPINAS = { lat: "-22.90", lon: "-47.06", display_name: "Campinas, São Paulo, Brasil" };
  const ROTA_3 = {
    distance: 120000,
    duration: 7200,
    geometry: { coordinates: [[-46.33, -23.96], [-46.79, -23.53], [-47.06, -22.90]] },
  };

  it("aceita uma lista de paradas e devolve todas com coordenada", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS, Osasco: OSASCO, Campinas: CAMPINAS }, rota: ROTA_3 });
    const r = await tracarRota({ paradas: ["Santos", "Osasco", "Campinas"] }, { fetcher });
    expect(r.ok).toBe(true);
    expect(r.paradas).toHaveLength(3);
    expect(r.paradas[0].coord).toEqual([-23.96, -46.33]);
    expect(r.paradas[2].coord).toEqual([-22.90, -47.06]);
    expect(r.distanciaKm).toBe(120);
    // origem/destino continuam sendo a primeira e a última, para compatibilidade.
    expect(r.origem.coord).toEqual([-23.96, -46.33]);
    expect(r.destino.coord).toEqual([-22.90, -47.06]);
  });

  it("uma parada do meio que não geocodifica aponta qual falhou", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS, Campinas: CAMPINAS }, rota: ROTA_3 });
    const r = await tracarRota({ paradas: ["Santos", "lugar inexistente", "Campinas"] }, { fetcher });
    expect(r.ok).toBe(false);
    expect(r.paradaFalha).toBe(1);
  });

  it("menos de duas paradas é incompleto", async () => {
    const fetcher = fetchFalso({ geo: { Santos: SANTOS } });
    const r = await tracarRota({ paradas: ["Santos", ""] }, { fetcher });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe(MOTIVOS.incompleto);
  });
});

describe("otimizarOrdemDeParadas (rota dinâmica)", () => {
  const P = (endereco, lat, lon) => ({ endereco, coord: [lat, lon] });

  it("mantém origem e destino fixos e reordena o meio pelo menor trajeto", () => {
    // Origem SP; meio fora de ordem; destino Curitiba (longe, a sudoeste). A
    // rota mais curta termina por Campinas (perto de Curitiba), com o Rio antes
    // — o 2-opt acha isso; o vizinho-mais-próximo guloso não achava.
    const paradas = [
      P("Sao Paulo", -23.55, -46.63),
      P("Rio de Janeiro", -22.90, -43.20),
      P("Campinas", -22.90, -47.06),
      P("Curitiba", -25.43, -49.27),
    ];
    const ordem = otimizarOrdemDeParadas(paradas);
    expect(ordem[0]).toBe("Sao Paulo");
    expect(ordem[ordem.length - 1]).toBe("Curitiba");
    expect(ordem).toContain("Campinas");
    expect(ordem).toContain("Rio de Janeiro");
    // Terminar por Campinas (vizinha de Curitiba) é o trajeto curto.
    expect(ordem.indexOf("Campinas")).toBeGreaterThan(ordem.indexOf("Rio de Janeiro"));
  });

  it("com 3 ou menos paradas não há meio para reordenar", () => {
    const paradas = [P("A", -23, -46), P("B", -22, -47), P("C", -25, -49)];
    expect(otimizarOrdemDeParadas(paradas)).toEqual(["A", "B", "C"]);
  });

  it("ignora paradas sem coordenada em vez de quebrar", () => {
    const paradas = [P("A", -23, -46), { endereco: "sem-coord" }, P("C", -25, -49)];
    expect(otimizarOrdemDeParadas(paradas)).toEqual(["A", "C"]);
  });

  it("desfaz o cruzamento que o vizinho-mais-próximo deixa (2-opt)", () => {
    // Quatro paradas nos cantos de um quadrado + origem e destino. Em ordem
    // "cruzada" (diagonal, diagonal), a rota se auto-intercepta; a ótima é o
    // perímetro. O 2-opt tem de devolver o contorno, não a cruz.
    const paradas = [
      P("O", 0, 0),        // origem, canto inferior-esquerdo
      P("cima-dir", 1, 1),
      P("baixo-dir", 0, 1),
      P("cima-esq", 1, 0),
      P("D", 0.01, 0.01),  // destino, perto da origem
    ];
    const ordem = otimizarOrdemDeParadas(paradas);
    expect(ordem[0]).toBe("O");
    expect(ordem[ordem.length - 1]).toBe("D");
    // No contorno, os dois cantos de cima ficam adjacentes (não separados por
    // um canto de baixo no meio) — sinal de que não há mais cruzamento.
    expect(Math.abs(ordem.indexOf("cima-dir") - ordem.indexOf("cima-esq"))).toBe(1);
  });
});

describe("sugerirEnderecos (autocompletar endereço)", () => {
  it("pede até 5 candidatos ao Nominatim, restrito ao Brasil", async () => {
    const fetcher = vi.fn(async () => resposta([
      { lat: "-23.9", lon: "-46.3", display_name: "Santos, SP, Brasil" },
      { lat: "-23.5", lon: "-46.6", display_name: "São Paulo, SP, Brasil" },
    ]));
    const lista = await sugerirEnderecos("Sant", { fetcher });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get("countrycodes")).toBe("br");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(lista).toHaveLength(2);
    expect(lista[0]).toEqual({ rotulo: "Santos, SP, Brasil", latitude: -23.9, longitude: -46.3 });
  });

  it("autocomplete autenticado passa pelo gateway interno", async () => {
    const fetcher = vi.fn(async () => resposta([
      { lat: "-23.9", lon: "-46.3", display_name: "Santos, SP, Brasil" },
    ]));
    const lista = await sugerirEnderecos("Sant", {
      fetcher,
      headers: { authorization: "Bearer teste" },
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/todogreen/maps/geocode");
    expect(lista).toHaveLength(1);
  });

  it("termo curto não gasta chamada", async () => {
    const fetcher = vi.fn();
    expect(await sugerirEnderecos("SP", { fetcher })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falha do serviço vira lista vazia, nunca exceção", async () => {
    const fetcher = vi.fn(async () => resposta({}, false, 503));
    expect(await sugerirEnderecos("Campinas", { fetcher })).toEqual([]);
  });
});

describe("normalizarCarregadores (Open Charge Map → mapa)", () => {
  const poi = {
    ID: 42,
    AddressInfo: { Title: "Eletroposto BR-116", Town: "Registro", Latitude: -24.5, Longitude: -47.8 },
    Connections: [
      { ConnectionTypeID: 33, PowerKW: 150 },
      { ConnectionTypeID: 2, PowerKW: 50 },
    ],
  };

  it("extrai coordenada, potência máxima e tipos de conector", () => {
    const [c] = normalizarCarregadores([poi]);
    expect(c.coord).toEqual([-24.5, -47.8]);
    expect(c.potenciaKw).toBe(150);
    expect(c.tipos).toContain("CCS (Type 2)");
    expect(c.tipos).toContain("CHAdeMO");
  });

  it("marca como para pesados quando há DC de alta potência (>=50 kW)", () => {
    const [rapido] = normalizarCarregadores([poi]);
    expect(rapido.pesados).toBe(true);
    const [lento] = normalizarCarregadores([
      { ID: 7, AddressInfo: { Title: "AC lento", Latitude: -23, Longitude: -46 }, Connections: [{ ConnectionTypeID: 25, PowerKW: 22 }] },
    ]);
    expect(lento.pesados).toBe(false);
  });

  it("descarta POI sem coordenada e não quebra com lista vazia", () => {
    expect(normalizarCarregadores([{ AddressInfo: {} }])).toEqual([]);
    expect(normalizarCarregadores(null)).toEqual([]);
  });
});

describe("aplicarOrdemDoMeio (ordem sugerida pela IA)", () => {
  const paradas = ["Origem SP", "Cliente A", "Cliente B", "Cliente C", "Destino RJ"];

  it("reordena o meio mantendo origem e destino", () => {
    // meio são os índices 1,2,3; nova ordem 3,1,2
    expect(aplicarOrdemDoMeio(paradas, [3, 1, 2])).toEqual([
      "Origem SP", "Cliente C", "Cliente A", "Cliente B", "Destino RJ",
    ]);
  });

  it("recusa (null) se a IA não devolve permutação exata do meio", () => {
    expect(aplicarOrdemDoMeio(paradas, [1, 2])).toBeNull();       // faltou uma
    expect(aplicarOrdemDoMeio(paradas, [1, 2, 2])).toBeNull();     // repetiu
    expect(aplicarOrdemDoMeio(paradas, [0, 2, 3])).toBeNull();     // incluiu origem
    expect(aplicarOrdemDoMeio(paradas, [1, 2, 9])).toBeNull();     // índice inventado
  });

  it("não reordena quando não há meio", () => {
    expect(aplicarOrdemDoMeio(["A", "B"], [])).toBeNull();
    expect(aplicarOrdemDoMeio(["A", "B", "C"], [1])).toBeNull();
  });
});

describe("normalizarCarregadoresOSM (OpenStreetMap, sem chave)", () => {
  it("normaliza nós de charging_station no mesmo formato do Open Charge Map", () => {
    const elementos = [
      // DC rápido por soquete CCS, sem potência declarada → pesados = true.
      { id: 1, lat: -23.5, lon: -46.6, tags: { name: "Posto A", "socket:ccs": "2", "socket:type2": "2" } },
      // Potência alta declarada → pesados = true, Type 2.
      { id: 2, lat: -23.6, lon: -46.7, tags: { operator: "Rede B", "socket:type2": "1", "socket:type2:output": "150 kW", "addr:city": "Osasco" } },
      // AC lento (Type 2, 22 kW) → pesados = false.
      { id: 3, lat: -23.7, lon: -46.8, tags: { name: "Posto C", "socket:type2": "1", "charging_station:output": "22 kW" } },
      // Sem coordenada → descartado.
      { id: 4, tags: { name: "Sem coord" } },
    ];
    const pontos = normalizarCarregadoresOSM(elementos);
    expect(pontos).toHaveLength(3);
    expect(pontos[0]).toMatchObject({ id: "1", nome: "Posto A", coord: [-23.5, -46.6], pesados: true });
    expect(pontos[0].tipos).toEqual(expect.arrayContaining(["CCS", "Type 2"]));
    expect(pontos[1]).toMatchObject({ potenciaKw: 150, pesados: true, cidade: "Osasco" });
    expect(pontos[2]).toMatchObject({ potenciaKw: 22, pesados: false });
  });

  it("aceita lista vazia / inválida sem quebrar", () => {
    expect(normalizarCarregadoresOSM(null)).toEqual([]);
    expect(normalizarCarregadoresOSM([{}])).toEqual([]);
  });
});

describe("tracarRota com coordenada resolvida (endereço completo)", () => {
  const ROTA_GEO = { distance: 80000, duration: 5400, geometry: { coordinates: [[-46.6, -23.5], [-47.0, -24.0]] } };
  it("usa a coordenada da sugestão e não geocodifica o texto", async () => {
    const fetcher = vi.fn(async (entrada) => {
      const alvo = String(entrada?.href || entrada);
      if (alvo.includes("nominatim")) throw new Error("não deveria geocodificar quando já há coordenada");
      return resposta({ routes: [ROTA_GEO] });
    });
    const resultado = await tracarRota(
      { paradas: [
        { endereco: "Rua Aberaldo de Oliveira, Osasco", coord: [-23.5, -46.6] },
        { endereco: "Carapicuíba", coord: [-24.0, -47.0] },
      ] },
      { fetcher },
    );
    expect(resultado.ok).toBe(true);
    expect(fetcher.mock.calls.every(([u]) => !String(u).includes("nominatim"))).toBe(true);
    expect(resultado.paradas[0].coord).toEqual([-23.5, -46.6]);
  });
});
