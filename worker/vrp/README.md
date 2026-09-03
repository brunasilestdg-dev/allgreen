# Motor de roteirização (VRP) — reinterpretcat/vrp compilado para WASM

`vrp_cli.js` + `vrp_cli_bg.wasm` vêm de [reinterpretcat/vrp](https://github.com/reinterpretcat/vrp)
v1.25.0 (`vrp-cli` com o feature `vrp-core`), licença Apache-2.0 (ver
`LICENSE-vrp-project`). Compilado localmente para `wasm32-unknown-unknown`
com `wasm-pack build --target web --release`.

Roda inteiro dentro do Worker — sem servidor externo, sem API paga. Quando
nenhuma matriz de rota é passada (`matrices: []`), o solver calcula distância
aproximada por Haversine automaticamente a partir das coordenadas dos jobs
(`vrp-pragmatic::utils::approx_transportation`).

## Por que `--target web` e não `--target bundler`

Testado dos dois jeitos direto num `wrangler dev` real: com `--target bundler`
(que trata o `.wasm` como módulo ES com import automático — `import * as wasm
from "./x.wasm"`), o `workerd` não expõe corretamente o export
`__wbindgen_start` — falha em runtime com `wasm.__wbindgen_start is not a
function`, mesmo o export existindo de verdade no binário (confirmado via
`WebAssembly.Module.exports()`). Com `--target web` (`import wasmModule from
"./vrp_cli_bg.wasm"` dá o `WebAssembly.Module` puro, e quem instancia é o
próprio `init()` gerado), funciona sem problema — é o padrão que a
documentação da Cloudflare recomenda para Rust+wasm-bindgen em Workers.

Por isso o `todogreen-dispatch.js` chama `init({ module_or_path: wasmModule
})` antes do primeiro uso, em vez de importar as funções já prontas.

Sem `wasm-opt`: o binário já sai em ~0,81 MB comprimido (gzip) direto do
`cargo build --release` com `lto = "fat"` — de sobra dentro do limite do
Workers, então evitamos mais uma etapa de build que poderia mexer nos
exports.

## Para atualizar a versão

1. `git clone --depth 1 https://github.com/reinterpretcat/vrp`
2. `wasm-pack build vrp-cli --target web --release --no-opt --out-dir pkg`
   (o `--no-opt` evita o wasm-pack tentar baixar o binaryen sozinho — nem
   precisamos dele, ver acima)
3. Copiar `vrp_cli.js`, `vrp_cli_bg.wasm`, `vrp_cli.d.ts` pra cá
4. Validar com `wrangler dev` local antes de confiar — `cargo check` e teste
   em Node.js não bastam: só o `workerd` real expôs o bug do `bundler` target

## API exposta

`init({ module_or_path: wasmModule })` — inicializa o módulo (chamar uma vez,
antes do primeiro uso; chamadas seguintes são no-op via cache no chamador).

`solve_pragmatic(problem, matrices, config)` — recebe o problema no formato
"pragmatic" (jobs + fleet), uma lista de matrizes de rota (vazia = usa
Haversine) e uma config (mínimo: `{ termination: { maxTime: <segundos> } }`).
Devolve a solução serializada em JSON (`tours`, `unassigned`, `statistic`).
