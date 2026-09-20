# AG-SEP-04B — Correção de identidade, acesso e isolamento (evidências)

Status: `blocos 1–6 concluídos e comprovados; integridade da cópia verificada. Cutover de domínio pode ser liberado sob os pré-requisitos abaixo (permanece uma ação explícita da titular).`

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

## Bloco 5 — Recuperação de acesso dos usuários existentes (CONCLUÍDO)

Com o "PII Data Handling" liberado pela titular, executei a **cópia seletiva**
das contas All Green da origem para o `allgreen-db`, preservando IDs. Método:
dump `--no-schema` da origem → filtro (exclui as 4 contas NÃO-All-Green por UUID,
exclui `sessions` e tabelas internas) → `INSERT OR IGNORE` (26.407 statements,
102.734 linhas). Os 4 `todogreen_internal_file_chunks` acima de 100 KB (limite de
statement do D1) foram inseridos por **parâmetro vinculado** na API REST.

**Verificação de integridade (origem × destino):**

| Categoria | Resultado |
|---|---|
| `todogreen_*` / tenant / acesso | **batem exatamente** (clients 6130, assignments 4929, road_risk 8625, fuel_ref 4793, file_chunks 4, tenant_users 2, access_emails 4, drivers 1, modules 104) |
| `users` | 7 → **3** (só as All Green; 4 não-AG excluídas) |
| `workspaces` | **3/3** (o da titular caíra no filtro por citar colaborador não-AG; recopiado por parâmetro) |
| `contacts` / `interactions` | 0/0 (não existem na origem) |
| `sessions` | **0** (não copiadas, conforme a regra) |
| `product_events` | 707 — os 47 restantes referenciam usuários não-AG e a **FK do D1 os rejeita** (não pertencem ao All Green) |
| `memberships` | 1 vínculo AG↔não-AG corretamente fora (contraparte ausente/FK) |

**Recuperação confirmada (sem exibir PII):** `total=3`, `emails_distintos=3`
(**sem duplicatas**), `com_credencial=3` (**hash+salt preservados → sem reset de
senha**), `admins_titular=1` (a titular entra como admin via `TODOGREEN_ADMIN_EMAILS`),
`sessoes=0`. A titular acessa `allgreen.brunapsiles.workers.dev` com o **mesmo
e-mail e senha atuais**; os outros 2 usuários idem, com papéis e vínculos preservados.

Banco original **intocado** durante toda a operação (todos os writes foram só no
`allgreen-db`).

## Liberação da continuidade do AG-SEP-04

## Liberação da continuidade do AG-SEP-04

Critérios da titular, todos atendidos:
- **Nenhum usuário legítimo bloqueado** — Blocos 1 e 5: as 3 contas All Green estão no `allgreen-db` com credencial e vínculos; recuperação por perfil homologada (Bloco 6).
- **Nenhuma conta de um produto com acesso indevido ao outro** — Blocos 3–4: código corrige a ordem da negação e o menor privilégio; conta exclusiva do Seu Funcionário autentica mas fica em 403 (comprovado).
- **Sem dúvidas sobre a integridade da cópia** — Bloco 5: `todogreen_*`/acesso batem exatamente; residuais são referências cruzadas a contas não-AG que a FK do D1 rejeita (corretamente fora); banco original intocado.

**Cutover de domínio (`orianone.app`)** — ainda NÃO executado (não faz parte deste
bloco). Pré-requisitos antes do corte, além do acima: cadastrar os secrets do
worker `allgreen` (Brevo/e-mail, Google, IA), tornar configuráveis as 3 URLs
fixas do worker antigo, e a decisão explícita da titular com janela de
manutenção. O banco original permanece como rollback.
