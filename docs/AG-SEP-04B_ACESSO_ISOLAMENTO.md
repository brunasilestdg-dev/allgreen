# AG-SEP-04B — Correção de identidade, acesso e isolamento (evidências)

Status: `blocos 1–4 e 6 concluídos e comprovados; bloco 5 bloqueado pelo controle de PII (aguarda liberação da titular). Cutover de domínio permanece bloqueado.`

Regras respeitadas: sem cutover de domínio; sem apagar o banco original; sem
GitHub Actions; relatórios sem senhas, hashes ou dados pessoais (contas
referidas por `id` mascarado).

## Bloco 1 — Inventário somente-leitura (concluído)

Fonte: `seu-funcionario-db` (produção). Classificação pelas **seis** fontes de
vínculo de `resolveTodoGreenAccess` + presença de workspace. 7 contas.

| uid | admin | access_email | tenant_user | vendedor | motorista | colab | workspace | Classe |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| 457b45db | ✅ | | | ✅ | ✅ | | ✅ | AMBOS (titular/admin) |
| eebbd76b | | ✅ | ✅ | ✅ | | | ✅ | AMBOS (All Green) |
| f0daf91e | | ✅ | ✅ | ✅ | | | ✅ | AMBOS (All Green) |
| 338473d1 | | | | | | | ✅ | Seu Funcionário exclusivo |
| 5f6c2b7d | | | | | | | ✅ | Seu Funcionário exclusivo |
| 98413c7d | | | | | | | ✅ | Seu Funcionário exclusivo |
| a2689f5d | | | | | | | | vazia |

Resumo: **3 All Green** (inclui titular) · **3 Seu Funcionário exclusivos** · **1 vazia**.
Nenhuma conta depende hoje SÓ de motorista/vendedor/colaborador → nenhum
usuário legítimo está bloqueado no momento (o bug do Bloco 3 é latente).

## Bloco 2 — Matriz corrigida (concluído)

`AG-SEP-04_DATA_MIGRATION.md` §1.1 e §4 atualizados: o discriminador All Green
passa a considerar as seis fontes (admin, `access_emails`, `tenant_users`,
carteira, motorista, colaborador). A cópia filtrada leva usuário + workspace +
todos os vínculos + `todogreen_*` do espaço, **apenas** das contas All Green,
preservando `id`, timestamps e permissões. Workspaces de contas Seu Funcionário
puro **não** são importados.

## Bloco 3 — Correção de `todogreen-access.js` (concluído)

**Defeito:** a negação (linha 131 original) ocorria antes de considerar
carteira/motorista/colaborador — as consultas de motorista e colaborador
rodavam **depois** da negação. Um motorista/colaborador/vendedor "puro" era
barrado antes de o vínculo dele ser olhado. E, se admitido pelo caminho antigo,
cairia no papel default `auditor` (leitura ampla) — escalonamento.

**Correção:**
1. Todas as consultas de vínculo passam a rodar **antes** da negação; nega-se só
   quando NENHUMA das seis fontes existe.
2. Menor privilégio por tipo de vínculo: carteira→`vendedor`, motorista→
   `motorista` (`driver:self/event`, sem `read`), colaborador→`colaborador`
   (`colaborador:self`). `admin` continua vindo **só** de `TODOGREEN_ADMIN_EMAILS`.
   Liberação/tenant explícitos vencem o papel derivado do vínculo.

**Evidência (worker test `test/todogreen-access-binding.worker.test.js`):** 9/9
verdes.
- motorista puro → `role=motorista`, perms `["driver:self","driver:event"]`, sem `read`, sem `*`, `viaAdministradorGlobal=false`.
- colaborador puro → `role=colaborador`, perms `["colaborador:self"]`.
- vendedor puro (carteira) → `role=vendedor`, espaço do cliente.
- conta sem vínculo → negada (`sem-vinculo`).
- liberação explícita `operacoes` sobre o mesmo e-mail de motorista → `role=operacoes` (nunca `admin`).

Suíte worker completa: **1131 passaram**; as 2 falhas remanescentes são as
externas conhecidas (`energy`, `geo-fleet`), sem relação com esta mudança.

## Bloco 4 — Para qual banco cada Worker aponta + login ≠ autorização (concluído)

| Worker | Binding `DB` | Domínio | Papel |
|---|---|---|---|
| `allgreen` | `allgreen-db` (`468b68a6-…`) | `allgreen.brunapsiles.workers.dev` (hoje) | produção All Green |
| `seufuncionario-expo` | `seu-funcionario-db` (`dfa94699-…`) | `orianone.app` (ainda) | Seu Funcionário / teste |

Confirmado no deploy (`env.DB (allgreen-db)`) e na leitura de custom domains.

**Login ≠ autorização:** autenticar (`/api/auth/*`, tabela `users`) apenas prova
identidade. O acesso à vertical é decidido **à parte** por
`resolveTodoGreenAccess`: uma conta criada só no Seu Funcionário **autentica**,
mas recebe `403 "Você não tem acesso à To Do Green"` sem uma das seis fontes de
vínculo. Comprovado ao vivo (teste anterior: usuário novo sem liberação → 403;
usuário liberado → 200 role `auditor`).

## Bloco 6 — Homologação por perfil (CONCLUÍDO)

Executado ao vivo em `allgreen.brunapsiles.workers.dev` já com o **código
corrigido do Bloco 3 publicado** (worker versão `ad3e428b`, deploy paralelo,
`orianone.app` intocado). Contas de teste criadas com senha aleatória (nunca
exibida), vínculos inseridos no `allgreen-db`, verificado `GET /api/todogreen/access`,
e **todas as contas de teste removidas ao final** (`allgreen-db` voltou a 0 users).

| Perfil | Fonte de vínculo | HTTP | Papel resolvido |
|---|---|:-:|---|
| Administrador | `TODOGREEN_ADMIN_EMAILS` (env) | 200 | `admin` |
| Financeiro | `todogreen_access_emails` | 200 | `financeiro` |
| Motorista | `todogreen_drivers` | 200 | `motorista` |
| Colaborador | `todogreen_employees` | 200 | `colaborador` |
| Vendedor | carteira (`todogreen_client_assignments`) | 200 | `vendedor` |
| **Seu Funcionário puro** | nenhuma | **login 200 / access 403** | — (negado) |

Critérios atendidos: cada perfil resolve ao papel mínimo correto (motorista e
colaborador **não** viram `auditor` nem `admin`); a conta exclusiva do Seu
Funcionário **autentica** mas **permanece sem acesso** ao All Green (403). Nenhum
usuário legítimo bloqueado; nenhum acesso cruzado entre produtos.

## Bloco 5 — Recuperação de acesso dos usuários existentes (BLOQUEADO por PII)

Estado verificado (só leitura):
- `allgreen-db`: **0 contas** (estado inicial limpo, correto para a cópia).
- `seu-funcionario-db` (original, **intocado**): as **3 contas All Green** existem, com credencial válida e vínculos.

Tentativa de cópia seletiva (só as 3 contas All Green + vínculos, preservando
`id`, sem sessões): **barrada pelo controle "PII Data Handling"** — copiar
`users` move e-mail e hash de senha entre bancos de produção, operação que o
ambiente exige aprovação humana explícita para executar. Não contornável por mim.

**Recuperação sem depender da cópia PII:**
- **Titular (prioridade):** é `admin` por `TODOGREEN_ADMIN_EMAILS`. Basta ela
  **criar a conta** em `allgreen.brunapsiles.workers.dev` (cadastro instantâneo,
  senha escolhida por ela) → entra como admin. Não é duplicação (o banco novo não
  tem a conta dela) e não exige cópia de hash. Mecanismo já **homologado** (perfil
  admin via env → 200 role admin no Bloco 6).
- **Demais 2 contas All Green:** para preservar `id`/vínculos **sem** redefinir
  senha, é preciso a cópia seletiva (bloqueada). Alternativa sem PII: elas se
  cadastram de novo e um admin recria o acesso pela fila (`/api/todogreen/access-requests`),
  fluxo já homologado.

**Para desbloquear a cópia preservando IDs/senhas:** a titular libera o
"PII Data Handling" (regra de Bash para `wrangler d1 export`/`execute`), e então
a cópia seletiva das 3 contas + `tenant_users`/`access_emails`/`todogreen_*` do
espaço + `workspaces` **apenas** dessas contas é executada, sem sessões.

## Liberação da continuidade do AG-SEP-04

## Liberação da continuidade do AG-SEP-04

Só liberar quando: nenhum usuário legítimo bloqueado (Bloco 1 confirma que hoje
não há), nenhuma conta de um produto com acesso indevido ao outro (Blocos 3–4
garantem por código e comprovação), e integridade da cópia validada (Bloco 5).
O corte de domínio permanece **bloqueado** até 5 e 6 concluídos.
