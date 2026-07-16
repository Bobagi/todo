# CLAUDE.md — `todo` (todo.bobagi.space)

> **PWA de lista de tarefas** com abas, arrastar‑e‑soltar, contas (usuário+senha / Google
> preparado) e uma **monetização via Stripe** (comprar aba extra / pacote de tarefas, com
> validade de 30 dias). Roda neste VPS como container Docker atrás do nginx+Cloudflare.
> Dono: Gustavo Perin / Bobagi. Repo público: **github.com/Bobagi/todo**.
>
> **REGRA PERMANENTE — mantenha este arquivo atualizado.** Ao mudar postura de segurança,
> portas, modelo de billing, rotas ou pendências, atualize a seção correspondente **na mesma
> sessão**. Espelha a convenção de `/opt/CLAUDE.md` e `/root/CLAUDE.md`.

## Termo correto: é uma **PWA** (Progressive Web App)
Não existe "FWA". É PWA: `public/manifest.json` + `public/service-worker.js` (instalável,
funciona offline para o shell). O service worker faz *network‑first* para HTML/JS e
*stale‑while‑revalidate* para o resto, e **nunca** intercepta `/api/` (correto). Bump o
`VERSION` em `service-worker.js` para forçar atualização de cache nos clientes.

## Stack & arquitetura
- **Backend:** Node 18 + Express (`server.js`). Consultas ao banco são **SQL cru via `pg`**
  (pool em `server/pool.js`) — **não** usa o Prisma Client em runtime.
- **Prisma:** presente **só** para (a) `schema.prisma` de referência e (b) rodar o
  **Prisma Studio** (serviço `studio`). As migrations são **SQL cru** em
  `prisma/migrations/*/migration.sql`, aplicadas pelo `docker-entrypoint.sh` a cada boot
  (glob ordenado + `psql -f`, sem ledger `_prisma_migrations`; os SQL usam `IF NOT EXISTS`).
  ⚠️ `schema.prisma` e o SQL cru podem divergir — a fonte de verdade real é o SQL.
- **Frontend:** **React 18 via UMD do unpkg** (sem build/bundler). Código em ES modules
  puros sob `public/js/app/*` usando `React.createElement` (aliased `e`). Sem JSX, sem passo
  de build. Ícones Phosphor + Google Identity via `<script>` de CDN.
- **Banco:** PostgreSQL 14 (container `db`, volume `db-data`).
- **Pagamentos:** Stripe Checkout (`server/routes/billing.js`) + webhook
  (`server/billing/webhook.js`, montado **antes** do `express.json` para preservar raw body).
- **Auth:** JWT (`server/auth.js`, `jsonwebtoken`, expiração 7d) no header `Authorization:
  Bearer`. Token guardado em `localStorage` no cliente. **Google login (GIS) ATIVO desde
  2026‑07‑16** — ver "Login com Google" abaixo.

### Mapa de arquivos
```
server.js                     # bootstrap Express: webhook raw → json → static → rotas → SPA fallback
server/pool.js                # pg Pool
server/auth.js                # generateToken() + middleware auth (JWT)
server/migrations.js          # runMigrations() (no-op se não houver /migrations)
server/routes/auth.js         # /register /login /google-login (+ access_logs, regras de senha)
server/routes/tabs.js         # CRUD de abas + /tabs/capacity + reorder (checa limite de billing)
server/routes/tasks.js        # CRUD de tarefas + reorder (checa limite de billing)
server/routes/billing.js      # /billing/config /checkout /my-entitlements + /fake-grant (DEV)
server/billing/config.js      # billing_config (defaults: 1 aba, 6 tarefas/aba, R$2, 30 dias)
server/billing/limits.js      # getAllowedTabSlots / getAllowedTasksForTab (base + entitlements ativos)
server/billing/webhook.js     # checkout.session.completed → grava payment + entitlement
public/index.html             # shell da PWA + <script> CDN (React/Phosphor/Google/Umami)
public/js/app/main.js         # App React inteiro (auth, abas, tarefas, loja)
public/js/app/{api,store,about,dragTabs,dragTasks,utils}.js
public/{manifest.json,service-worker.js,style.css,neon-checkbox.css}
public/legal/{terms,privacy}.html   # Termos + Privacidade versionados (v1), aceite server-side
prisma/migrations/*/migration.sql   # schema real (users, tabs, tasks, entitlements, payments, billing_config, access_logs)
get_codes.py                  # util DEV: concatena .js/.css num único .txt (o commit "codes reader" é enganoso)
deploy.sh                     # build + up -d + health check (one-command deploy)
```

## Deploy / dev
- **Deploy (VPS):** `bash /opt/todo/deploy.sh` (builda, sobe, checa saúde). Ou
  `docker compose build && docker compose up -d`.
- **Env:** `.env` (chmod 600, **git‑ignored** — nunca commitar). Ver `.env-sample`. Chaves:
  `POSTGRES_*`, `WEB_PORT=3051`, `PRISMA_STUDIO_PORT=5555`, `DATABASE_URL`, `JWT_SECRET`,
  `GOOGLE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ALLOW_FAKE_PAYMENTS`.
- **Migrations:** rodam sozinhas no boot do container (entrypoint). Novo SQL → nova pasta
  `prisma/migrations/<ordem>_nome/migration.sql`.
- **Stripe local:** `stripe listen --forward-to http://localhost:3051/api/billing/webhook`.
- **`npm test`**: era um footgun (`docker compose down -v` **apagava o volume do banco** + `npm build`
  inválido). Neutralizado 2026-07-15 para um placeholder não-destrutivo. **Ainda não há testes** —
  usar `test-forge` (priorizar auth/limites) quando quiser travar comportamento.

## Portas & rede (pós‑hardening deste box)
- **web** → publicado em **`127.0.0.1:${WEB_PORT}` (3051)**; nginx `todo.bobagi.space`
  faz `proxy_pass http://127.0.0.1:3051`. (O bind `127.0.0.1` foi adicionado no
  `docker-compose.yml` — ver "Pendências de git" abaixo.)
- **studio** (Prisma Studio) → **`127.0.0.1:5555`**; vhost `studio.todo.bobagi.space`.
  ⚠️ Sob Cloudflare, `studio.todo.bobagi.space` (dois níveis) **quebra o SSL universal**
  (526) — deve ficar **DNS‑only (cinza)** ou ser acessado por túnel SSH.
- **db** → interno ao compose, sem publicação.
- **Edge:** Cloudflare (proxy) → nginx (TLS) → app. O edge já adiciona **HSTS,
  X‑Frame‑Options: SAMEORIGIN, X‑Content‑Type‑Options: nosniff, Referrer‑Policy**.
  **Não há Content‑Security‑Policy** em lugar nenhum.

## Modelo de auth & billing (como funciona hoje)
- **Limites base:** `billing_config` = 1 aba/conta, 6 tarefas/aba. Comprar `TAB_SLOT`
  (+1 aba, global) ou `TASK_PACK` (+N tarefas numa aba) cria uma linha em `entitlements`
  com `expires_at = now()+30d`. `limits.js` soma os entitlements **ativos** ao base.
- **Fluxo pago:** `/billing/checkout` cria uma Stripe Checkout Session; o **webhook**
  (`checkout.session.completed`) grava `payments` (idempotente por `payment_intent`) e o
  `entitlement`. Sucesso volta para `/?paid=1`.
- **access_logs:** `register`/`login` são registrados com IP + user‑agent.

## Login com Google (GIS) — ATIVO desde 2026‑07‑16
Fluxo **Google Identity Services** (botão + ID token), NÃO o code‑flow com secret/redirect do
CoinHub — todo já tinha esse fluxo 90% pronto; só faltava um client id real e a injeção.
- **Client id (público):** reusa o **web OAuth client do operador** (mesmo GCP do CoinHub,
  `956230576576‑…apps.googleusercontent.com`). Fica em `GOOGLE_CLIENT_ID` no `.env` (git‑ignored).
  Client id é público por design (aparece no browser) — não é segredo.
- **Injeção:** `server.js` `sendIndex` injeta `%GOOGLE_CLIENT_ID%` no `index.html` (dentro de
  `window.__GOOGLE_CLIENT_ID__`), **validando o formato** antes (defense‑in‑depth). `static` roda
  com `index:false` p/ não furar a injeção. O front (`public/js/app/main.js`) faz
  `google.accounts.id.initialize/renderButton` quando o client id existe; **sem env → botão some**
  (nada de erro no console) e o `/api/google-login` rejeita todo token.
- **Verificação:** `server/routes/auth.js /google-login` faz `verifyIdToken` (audience = client id),
  exige `email_verified`, e casa **só por `google_id`** (subject) — nunca auto‑link por e‑mail
  (anti‑takeover). Auditado pela `security-sweep` (relatório em
  `.claude/security-sweep/20260716-google-login/`): forja/injeção testadas ao vivo, 0 achado aberto.
- **⚠️ PASSO MANUAL DO OPERADOR (obrigatório p/ o botão funcionar em prod):** adicionar
  **`https://todo.bobagi.space`** em *Authorized JavaScript origins* do OAuth client no Google Cloud
  Console (projeto `956230576576`). Até lá o **botão APARECE mas o clique falha** com "origin not
  allowed" no console (login e‑mail/senha funciona normal). Consideração: a tela de consentimento mostrará o
  nome do projeto CoinHub — se quiser separação, criar um client dedicado e trocar o `GOOGLE_CLIENT_ID`
  (é 1 env var).

## ⚠️ Segurança & bugs conhecidos (validação 2026‑07‑15) — LEIA antes de "ir pra produção"
Ordenado por severidade. **Nada disto foi corrigido ainda** — foi só levantado.

1. **CRÍTICO — bypass total da monetização.** `.env` tem **`ALLOW_FAKE_PAYMENTS=true`** em
   produção, e a rota **`POST /api/billing/fake-grant`** concede entitlements pagos (abas /
   pacotes) **de graça** para qualquer usuário autenticado — sem Stripe. Pior: o frontend
   **mostra o botão** "DEV: conceder sem Stripe" (ícone de frasco) no modal da loja
   (`store.js`). Qualquer conta destrava tudo de graça. **Antes de aceitar dinheiro real:
   `ALLOW_FAKE_PAYMENTS=false` (ou remover a rota) + remover o botão do `store.js`.**
2. **ALTO — Stripe em modo de TESTE** (`STRIPE_SECRET_KEY=sk_test_…`). Nenhum pagamento real
   acontece; cartão `4242…` "funciona". Ou seja, hoje **não há como faturar** de qualquer jeito.
3. **MÉDIO — CORS liberado geral** (`app.use(cors())` → `Access-Control-Allow-Origin: *`).
   Restringir à origem `https://todo.bobagi.space`.
4. **MÉDIO — sem CSP.** App carrega scripts de terceiros **sem versão fixa e sem SRI** do
   unpkg (`@phosphor-icons/web` resolve para *latest*; React 18 idem). Comprometer o CDN =
   XSS/account‑takeover em todo load. Fixar versão + SRI, ou self‑host, e adicionar CSP.
5. **MÉDIO — sem rate‑limit / lockout em `/login`.** Brute‑force aberto (só bcrypt cost 10).
   `/register` revela "user exists" (enumeração); o caminho "usuário inexistente" no login
   não é constant‑time (enumeração por timing). Adicionar rate‑limit + resposta uniforme.
6. **MÉDIO — IDOR de escrita em `PUT /api/tasks/:id`.** O `tab_id` novo não é validado como
   pertencente ao usuário (`SET tab_id=COALESCE($3,tab_id) WHERE id=$4 AND user_id=$5`) —
   dá pra mover tarefa para `tab_id` arbitrário e **furar o limite por aba**. Validar posse
   do `tabId` de destino.
7. **BAIXO — TOCTOU no caminho pago.** Checagem de limite (`SELECT count` → `INSERT`) sem
   transação/lock em `tasks.js`/`tabs.js`: requests concorrentes furam o limite. Mesmo padrão
   da race financeira que já mordeu outro serviço deste box.
8. **BAIXO — `JWT_SECRET` com fallback `"secret"`** em `auth.js` (`|| "secret"`). Prod tem
   segredo real, mas se o env falhar, tokens ficam forjáveis. Deve **hard‑fail** sem env.
9. **BAIXO — JWT em `localStorage`** (exfiltrável por XSS; sem revogação/refresh).
10. **LACUNA de produto/LGPD — sem ciclo de conta.** Cadastro é só usuário+senha (**e‑mail
    fica NULL**), então **não há como fazer reset de senha** (sem e‑mail no cadastro), nem
    verificação de e‑mail, nem **exclusão de conta (hard‑delete exigido por LGPD)**, nem
    logout server‑side. `app-essentials` cobre exatamente isso.

## Pendências de git (working tree diverge do GitHub)
- Local está **1 commit à frente** de `origin/main` (o commit `deploy.sh` não foi pushado).
- `docker-compose.yml` tem **mudança não commitada**: o bind `127.0.0.1:${WEB_PORT}:3000`
  (hardening de porta). **Commitar + pushar** para o GitHub não ficar sem o hardening.

## DECISÃO 2026‑07‑15: pivô para **peça de portfólio**
O operador decidiu **desviar o app para portfólio** (não perseguir monetização por agora). Logo:
o modelo de billing (R$2/30 dias por aba/tarefa) fica **congelado/fora de escopo** — não investir
em hardening do funil de pagamento; o bypass `ALLOW_FAKE_PAYMENTS` (🔴 acima) deixa de ser urgente
como perda financeira, mas ainda vale desligar por higiene quando mexer nessa área. Foco agora:
**capricho de UI/UX + qualidade de código** (é o que um portfólio expõe).

### Review 2026‑07‑15 (frontend-review + code-standards)
- **frontend-review** rodado na app viva (conta descartável, 4 viewports). Relatório completo +
  screenshots em **`.claude/frontend-review/20260715-portfolio/report.md`** (git‑ignored). Achados
  P1: erros de console em toda página (**Google sign‑in quebrado** — `GOOGLE_CLIENT_ID` placeholder;
  remover o bloco/GSI ou configurar) e **título "To do" quebra em 2 linhas no mobile** (header flex
  sem wrap). P2: overflow horizontal de 3px no mobile, **sem hierarquia de botões** (regra global
  `button{}` pinta tudo de amarelo primário), **sem anel de foco de teclado**, idioma **misturado
  EN/PT** sem i18n, links legais off‑palette/pequenos. P3: dois amarelos de marca (#f1c40f×32 vs
  #ffd700×6), sem tokens de design, `alert/confirm/prompt` nativos, sem empty‑state.
- **Fixes SEGUROS já aplicados (2026‑07‑15, só no source — precisam de `deploy.sh` p/ ir ao ar):**
  `style.css` ganhou `*{box-sizing:border-box}` (corrige o overflow; neon‑checkbox resetado p/
  content‑box), `:focus-visible` (anel de foco que faltava), e guarda `prefers-reduced-motion`;
  `package.json` `test` neutralizado (era destrutivo). **Nada de UI/comportamento visível mudou.**
- **Higiene de deps (reportado, NÃO aplicado — decidir junto com o destino do Stripe):** `stripe`
  (v20.4.0) é `require()`d em `server.js` mas **não está no `package.json`** (só instalado via hack no
  Dockerfile) → `npm install` fora do Docker gera app quebrado. `@prisma/client`/`prisma` idem.
  `react`/`react-dom` estão declarados mas **não são usados** pelo Node (vêm do CDN unpkg) — enganoso.
- **`server/migrations.js` (`runMigrations`) é morto/confuso:** cria `schema_migrations` + dir vazio
  `/migrations` mas não aplica nada (as migrations reais são o SQL cru aplicado pelo entrypoint).
  Dois sistemas de migration — considerar remover a chamada em `server.js:9`.

### Redesign de UI — FEITO 2026‑07‑16 (frontend-design → frontend-review)
Direção **"arcade cabinet, after hours"**: um **único** accent dourado (`--gold`, fim da briga de
2 amarelos), **coral reservado só p/ destrutivo** (cor com significado), tipografia **Space Grotesk
self-hosted** (`public/fonts/space-grotesk.woff2`, 22KB), sistema de **tokens em `:root`**
(`public/style.css` reescrito). Resolvidos todos os P1/P2 do review: header mobile não quebra mais o
título, **hierarquia de botão** (`.btn--primary/ghost/danger` + `.iconbtn` — deletar deixou de gritar),
idioma **EN**, **empty-state** desenhado, `alert/prompt/confirm` nativos → **toasts + modal temáticos**
(`main.js` agora é class-based; corrida save-on-blur blindada com `onMouseDown preventDefault`), foco de
teclado, reduced-motion. Neon checkbox preservado 1:1 (gold re-tokenizado). Relatório+screenshots em
`.claude/frontend-review/20260716-redesign/`. **SEAM conhecido:** a loja/upgrades (`store.js`) continua
em **PT + estilo antigo** (superfície de billing congelada) — restilizar/traduzir ou esconder quando
decidir o destino do Stripe. Tudo fora desse modal foi repaginado.

### Backlog de portfólio (o operador decide o que atacar)
1. **`test-forge`**: 1 smoke test (auth + tabs/tasks) para o app "parecer sério".
2. **`app-essentials`** se quiser subir o nível: reset de senha/verificação de e‑mail/exclusão de conta.
3. **Loja/Stripe** congelado (não ativar) — quando decidir: restilizar `store.js` p/ o novo design (EN)
   ou remover a loja p/ uma demo limpa. **Google login:** FEITO (só falta o passo do operador no console).
- **security-sweep** (não‑pagamento): CORS `*`, sem CSP, sem rate‑limit no login, IDOR no move de
  task — rodar quando a direção da UI estabilizar.
