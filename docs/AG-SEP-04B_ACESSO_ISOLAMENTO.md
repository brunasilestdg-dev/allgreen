# AG-SEP-04B — Correção de identidade, acesso e isolamento (evidências)

Status: `EM ANDAMENTO — blocos 1–4 concluídos; 5–6 pendentes de execução em produção`

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

## Bloco 5 — Recuperação de acesso dos usuários existentes (PENDENTE)

Objetivo: restaurar acesso das 3 contas All Green (a começar pela titular)
no `allgreen-db`, **sem duplicar conta**, preservando `id`/vínculos, redefinindo
senha só se necessário, **sem** copiar sessões antigas.

Bloqueio atual: a cópia de contas move PII (e-mail + hash) e é barrada pelo
classificador de permissões ("PII Data Handling") — requer liberação explícita
da titular. Plano de execução (cópia filtrada das 3 contas All Green + vínculos
+ `todogreen_*`, preservando `id`) descrito em `AG-SEP-04_DATA_MIGRATION.md` §5.

## Bloco 6 — Homologação por perfil (PENDENTE)

Roteiro: uma conta de cada perfil (admin, vendedor, motorista/portal,
colaborador/portal, cliente/portal) + **uma conta exclusiva do Seu Funcionário**.
Critério: a conta sem autorização deve autenticar no produto dela e **permanecer
sem** acesso ao All Green (403). Evidências a anexar aqui após execução.

## Liberação da continuidade do AG-SEP-04

Só liberar quando: nenhum usuário legítimo bloqueado (Bloco 1 confirma que hoje
não há), nenhuma conta de um produto com acesso indevido ao outro (Blocos 3–4
garantem por código e comprovação), e integridade da cópia validada (Bloco 5).
O corte de domínio permanece **bloqueado** até 5 e 6 concluídos.
