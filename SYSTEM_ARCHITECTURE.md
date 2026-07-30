# WiFi Manager JOCUM AT — Arquitetura Completa do Sistema

## Visão Geral

Sistema de captive portal e gerenciamento WiFi para a Base JOCUM Almirante Tamandaré.
Dispositivos guest conectam ao WiFi, são interceptados por um captive portal personalizado,
e após autenticação recebem acesso à internet com QoS diferenciado (gratuito vs premium).

**Stack:**
- **Frontend:** Next.js (React) hospedado na Vercel (`wifi-manager-react.vercel.app`)
- **Backend:** API Routes do Next.js (Vercel serverless)
- **Banco de dados:** Supabase (PostgreSQL + Auth)
- **Hardware:** UniFi Dream Machine SE (UDM)
- **Agent principal:** Python 3.9 rodando na UDM (`/data/scripts/udm_agent.py`) — captive portal, MAC auth, QoS, redirect server, re-autorização
- **Agent de vouchers:** Python 3.9 rodando na UDM (`/data/scripts/create_voucher_auto.py`) — foco exclusivo em processar vouchers `pendente` do Supabase para o MongoDB da UDM
- **MongoDB:** Interno da UDM (porta 27117, database `ace`) — controla autorizações WiFi

> ⚠️ **Dois agentes paralelos:** `udm-agent.service` (`udm_agent.py`) e `create_voucher_auto.service` (`create_voucher_auto.py`) rodam simultaneamente. Ambos fazem polling de vouchers `pendente` no Supabase. O primeiro a pegar o registro "vence". Qualquer fix no processamento de vouchers deve ser aplicado em **ambos** os scripts.

---

## Infraestrutura de Rede

| Parâmetro | Valor |
|-----------|-------|
| Interface guest | `br0` |
| Gateway/IP da UDM | `10.70.0.1` |
| Subnet | `10.70.0.0/21` |
| SSID (guest/portal) | `.UofN JOCUM AT` (`is_guest: true`, bridge `br0`) |
| Outros SSIDs | `.UofN Free WiFi`, `CM`, `Portao Jocum` (`is_guest: false`, bridge `br2`) |
| Portal externo | `https://wifi-manager-react.vercel.app` |
| Porta do redirect server | `8881` |
| MongoDB UDM | `localhost:27117` (database: `ace`) |

---

## Fluxo Completo do Captive Portal

### Fase 1 — Dispositivo conecta ao WiFi

1. Dispositivo conecta à rede `.UofN JOCUM AT`
2. O SO faz **captive portal detection** via HTTP:
   - Android: `http://connectivitycheck.gstatic.com/generate_204`
   - iOS/macOS: `http://captive.apple.com/hotspot-detect.html`
   - Windows: `http://www.msftconnecttest.com/connecttest.txt`
3. A UDM redireciona via HTTP (configuração `redirect_https: false` no MongoDB)

### Fase 2 — Interceptação iptables

4. Regra iptables NAT PREROUTING intercepta TODO tráfego porta 80 em `br0`:
   - Exceção: IPs do walled garden (ipset `walled_garden`) → RETURN (passa direto)
   - Todo resto → REDIRECT para porta `8881`
5. As regras ficam **antes** de `UBIOS_PREROUTING_JUMP` (regras nativas da UDM)

### Fase 3 — Servidor Redirect (porta 8881)

6. O servidor HTTP multi-threaded no agent Python recebe o request
7. Extrai o MAC do dispositivo via ARP (`ip neigh show <IP>`) ou query param `?id=`
8. **Verifica no MongoDB** se o MAC está autorizado (`db.guest.find({mac, end: {$gt: now}})`)
   - Cache de 30 segundos por MAC para performance
9. Se **autorizado**: retorna resposta específica por SO para fechar o captive portal:
   - Path `/generate_204` → HTTP 204 (Android)
   - Path `/connecttest.txt` → HTTP 200 `"Microsoft Connect Test"` text/plain (Windows 10+)
   - Path `/ncsi.txt` → HTTP 200 `"Microsoft NCSI"` text/plain (Windows 7/8)
   - Outros paths → HTTP 200 com body `"Success"` HTML (iOS/macOS)
10. Se **não autorizado**: HTTP 302 para `https://wifi-manager-react.vercel.app/hotspot?id=<MAC>&url=<URL_ORIGINAL>`

### Fase 4 — Portal Web (Vercel)

11. O SO abre o popup do captive portal com a URL do Vercel
12. A página `/hotspot` verifica sessão Supabase:
    - **Sem sessão** → mostra opções: Plano Premium ou Acesso Gratuito
    - **Com sessão** → verifica voucher ativo e autoriza automaticamente

### Fase 5 — Autorização

13. Após autenticação, uma entrada é criada na tabela `autorizacoes` do Supabase com `status: "pendente"`
14. O agent Python (loop a cada 5s) lê as autorizações pendentes
15. Agent autoriza o MAC via API UniFi ou MongoDB (fallback)
16. Status atualizado para `"autorizado"` no Supabase
17. Frontend faz polling a cada 3s até ver `"autorizado"`
18. Mostra "Você está conectado!" → redireciona para `/hotspot/connected`

### Fase 6 — Fechamento do Captive Portal

19. `/hotspot/connected` aguarda 3s e redireciona para a URL de detecção do SO:
    - Android → `connectivitycheck.gstatic.com/generate_204`
    - iOS/macOS → `captive.apple.com/hotspot-detect.html`
    - Windows → `www.msftconnecttest.com/connecttest.txt`
20. O servidor redirect verifica MongoDB → MAC autorizado → retorna resposta específica do SO
21. O SO fecha o popup do captive portal — internet liberada

---

## Configuração da UDM (MongoDB `db.setting`)

```javascript
// Configuração crítica no MongoDB da UDM:
db.setting.update({key: "guest_access"}, {$set: {redirect_https: false}})
// redirect_https DEVE ser false — caso contrário a UDM redireciona via HTTPS
// e o iptables (que só pega porta 80/HTTP) não intercepta
```

---

## Regras iptables

### NAT PREROUTING (ordem importa — nossas regras ANTES de UBIOS)

| # | Regra | Propósito |
|---|-------|-----------|
| 1 | `-i br0 -p tcp --dport 80 -m set --match-set walled_garden dst -j RETURN` | IPs do walled garden passam direto |
| 2 | `-i br0 -p tcp --dport 80 -j REDIRECT --to-port 8881` | Todo HTTP restante → redirect server |
| 3 | `UBIOS_PREROUTING_JUMP` | Regras nativas da UDM |

### INPUT

| # | Regra | Propósito |
|---|-------|-----------|
| 1 | `-i br0 -p tcp --dport 8881 -j ACCEPT` | Guests alcançam o redirect server |

### FORWARD (walled garden)

| # | Regra | Propósito |
|---|-------|-----------|
| 1 | `-m set --match-set walled_garden dst -p tcp -m multiport --dports 80,443 -j ACCEPT` | Guests acessam domínios do walled garden |

---

## Walled Garden — Domínios Liberados Antes da Autenticação

Necessários para que a página do portal e autenticação funcionem:

**Portal & Infra:**
`wifi-manager-react.vercel.app`, `vercel.app`, `vercel.com`, `assets.vercel.com`, `api.vercel.com`, `vercel-insights.com`

**Supabase:**
`xptkrsbjyyslbgurfvbg.supabase.co`, `supabase.co`, `api.supabase.com`, `auth.supabase.com`

**Google/OAuth/gstatic:**
`ssl.gstatic.com`, `gstatic.com`, `www.gstatic.com`, `fonts.gstatic.com`, `www.google.com`, `googleusercontent.com`, `lh3.googleusercontent.com`, `fonts.googleapis.com`, `googleapis.com`, `www.googleapis.com`, `apis.google.com`, `accounts.google.com`, `clients6.google.com`, `oauth2.googleapis.com`, `content.googleapis.com`, `storage.googleapis.com`, `firestore.googleapis.com`, `firebase.googleapis.com`, `firebaseinstallations.googleapis.com`, `firebasestorage.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, `cloudfunctions.net`, `recaptcha.net`, `www.recaptcha.net`

**Apple:** `appleid.apple.com`

**Facebook:** `facebook.com`, `graph.facebook.com`

**Firebase/FlutterFlow:** `firebaseapp.com`, `jocum-at.flutterflow.app`, `jocum-at.web.app`, `flutterflow.app`, `web.app`, `app.flutterflow.io`, `api.flutterflow.io`

**Outros:** `page.link`, `app.goo.gl`

**⚠️ NÃO incluir domínios de captive portal detection:**
`connectivitycheck.gstatic.com`, `connectivitycheck.android.com`, `clients3.google.com`, `captive.apple.com`, `www.apple.com`, `detectportal.firefox.com`, `msftconnecttest.com`, `www.msftconnecttest.com`, `www.msftncsi.com`
— Estes precisam ser INTERCEPTADOS pelo redirect para que o popup apareça.
— O redirect server retorna respostas específicas por SO (NCSI) para fechar o captive portal corretamente.

**⚠️ NÃO incluir `gstatic.com` (domínio bare) no walled garden:**
Os IPs resolvidos para `gstatic.com` são anycast e cobrem o mesmo range de `connectivitycheck.gstatic.com`.
Se `gstatic.com` entrar no ipset `walled_garden`, a probe de captive detection do Android e LG webOS passará
direto (HTTPS bem-sucedido), o dispositivo achará que tem internet, e o popup/CNA nunca abrirá.
Manter apenas: `ssl.gstatic.com`, `www.gstatic.com`, `fonts.gstatic.com`.

---

## API Endpoints

### `POST /api/hotspot/free-access`
- **Auth:** Nenhuma
- **Body:** `{ mac, telefone }`
- **Fluxo:** Salva telefone em `visitantes_free`, cria voucher gratuito (se não existir), cria autorização de 1440 min (24h)
- **Velocidade:** 123 Kbps (só mensagens de texto)
- **Expiração:** antes de reusar uma autorização `status="autorizado"` existente, checa `created_at + minutos` — se já passou de 24h, marca como `"expirado"` e cria uma nova de verdade (ver RESOLVIDO 2026-07-30 abaixo)

### `POST /api/hotspot/login`
- **Auth:** Nenhuma
- **Body:** `{ email, password }`
- **Retorna:** `{ access_token, refresh_token }`
- **Nota:** Auto-confirma email se não confirmado

### `POST /api/hotspot/register`
- **Auth:** Nenhuma
- **Body:** `{ nome, email, password, whatsApp, plano }`
- **Fluxo:** Cria usuário Supabase + registro em `clientes`, cria voucher para plano free
- **Migração:** Se WhatsApp bate com `visitantes_free`, revoga acesso guest antigo

### `GET /api/hotspot/session`
- **Auth:** Bearer token
- **Query:** `?mac=` (opcional)
- **Retorna:** `{ state, userName, planoTipo, auth_id }`
- **States:** `guest`, `has-voucher`, `pending-voucher`, `no-voucher`
- **Nota:** Se MAC fornecido e voucher ativo, cria autorização server-side

### `POST /api/hotspot/authorize`
- **Auth:** Bearer token
- **Body:** `{ mac }`
- **Fluxo:** Busca voucher ativo, calcula minutos restantes, cria autorização, polling 45s
- **Durações:** `ilimitado` = 14400 min (10 dias), com prazo = minutos restantes

### `GET /api/hotspot/authorize/[id]`
- **Auth:** Nenhuma
- **Retorna:** `{ status }` — polling do frontend

### `POST /api/hotspot/revoke-my-access`
- **Auth:** Bearer token
- **Body:** `{ mac? }` (opcional)
- **Fluxo:** Revoga autorizações do usuário autenticado. Se `mac` for enviado, filtra por `mac_address` (revoga só aquele dispositivo); sem `mac`, revoga todas as autorizações da conta (comportamento legado, mantido como fallback)

### `POST /api/hotspot/revoke-free-access`
- **Auth:** Bearer token
- **Body:** `{ mac }` (obrigatório na prática)
- **Fluxo:** Revoga autorização do GUEST_USER_ID **filtrada por `mac_address`**
- **⚠️ Sem `mac`, não faz nada** (`{ ok: true, skipped: true }`) — antes revogava o acesso gratuito de **todos** os visitantes anônimos da base a cada clique, já que não existia filtro nenhum. Corrigido em 2026-07-07.

**Limitação estrutural do MAC no frontend:** o navegador não consegue ler o MAC do próprio dispositivo (bloqueado por privacidade). O frontend só aprende o MAC de um dispositivo quando ele chega via redirect do captive portal (`?id=<MAC>` → cookie `captive_mac`, ver `app/home/page.tsx`). Se o dispositivo já tem "internet" (não passou pelo redirect nessa sessão), o botão "desconectar" não tem como mirar nele especificamente — só consegue revogar autorizações já ligadas à conta logada. Para revogar um MAC desconhecido, é preciso localizá-lo manualmente (admin ou MongoDB direto, ver seção de diagnóstico Windows abaixo).

---

## Pagamentos (Asaas) — PIX e Cartão

### Fluxo geral
1. Usuário preenche cadastro/plano em `/` (ou `/renovacao`) → payload guardado em `sessionStorage.wf_signup` → navega para `/pagamento`.
2. `/pagamento` chama `POST /api/asaas/pix` (ou `/api/asaas/card`), que **antes de gerar a cobrança**:
   - Cria a conta Supabase (`resolveClienteId`, `utils/asaas/registration.ts`) — cliente já existe mesmo que o pagamento nunca confirme.
   - Embute `clienteId` + `tempo` + `categoria` no `externalReference` da cobrança Asaas (`encodeExternalReference`), pra permitir finalizar o voucher sem depender do navegador.
3. Cobrança confirmada → `confirmPaidVoucher` (`utils/asaas/registration.ts`) cria `vouchers` (status `pendente`) + `financas` + ativa `clientes.ativo`. Idempotente (checa `financas.comprovante_pgto` antes de inserir).
4. `processar_vouchers()` no agent Python (UDM) pega o voucher `pendente` e preenche `codigo`/`data_expiracao` no MongoDB — igual ao fluxo de voucher gratuito.

### Três caminhos que podem disparar `confirmPaidVoucher` (redundantes, idempotentes)
| Caminho | Onde | Depende do navegador do usuário continuar aberto? |
|---|---|---|
| Webhook do Asaas | `POST /api/asaas/webhook` | Não — 100% servidor |
| Polling do frontend | `GET /api/asaas/pix/[id]` (chamado a cada 5s por `/pagamento`) | Sim |
| Cron de reconciliação | `GET /api/asaas/reconcile` (Vercel Cron, `*/5 * * * *`, ver `vercel.json`) | Não — varre pagamentos confirmados das últimas 2h no Asaas |

### API Endpoints — Asaas
- **`POST /api/asaas/pix`** — gera cobrança PIX + QR code. Cria cliente Supabase antes se `tempo` for enviado.
- **`GET /api/asaas/pix/[id]`** — consulta status no Asaas; se confirmado, roda `confirmPaidVoucher` como fallback (não bloqueia a resposta se falhar).
- **`POST /api/asaas/card`** — cobrança no cartão; confirmação síncrona (chama `confirmPaidVoucher` na hora, sem esperar webhook).
- **`POST /api/asaas/webhook`** — recebe eventos `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`/`PAYMENT_RECEIVED_IN_CASH`. Valida header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN`. Sempre responde 200 (exceto token inválido) pra evitar reenvio infinito do Asaas.
- **`GET /api/asaas/reconcile`** — cron de reconciliação (ver acima). Protegido por `Authorization: Bearer $CRON_SECRET`.

### ⚠️ iOS mata o portal cativo (CNA) ao abrir o app do banco durante o pagamento PIX (RESOLVIDO 2026-07-07)
**Sintoma:** usuário gera o PIX dentro do portal cativo, abre o app do banco pra pagar, o dinheiro é debitado, a conta Supabase existe — mas nenhum voucher é criado e o usuário fica sem acesso à rede.
**Causa raiz:** o WebView do Captive Network Assistant do iOS é **destruído** (não só pausado) quando o usuário troca de app. Isso mata o polling do `GET /api/asaas/pix/[id]`, que era **o único caminho ativo** de criação de voucher em produção — o webhook do Asaas nunca chegou a ser configurado no painel (faltava `ASAAS_WEBHOOK_TOKEN`).
**Fix aplicado:**
- `utils/captive/navigate.ts` (`captiveNavigate`) — detecta iOS + contexto de portal cativo (cookie `captive_mac`) e força abertura via `x-safari-https://` em vez de navegação normal. Isso faz o iOS abrir o Safari de verdade (que sobrevive à troca de app) em vez do WebView do CNA, a partir do primeiro clique em "Ver planos premium"/"Fazer upgrade"/"Renovar" no `/hotspot` — toda a jornada seguinte (form, PIX, polling) já roda dentro do Safari real.
- `GET /api/asaas/reconcile` + `vercel.json` (cron a cada 5min) — rede de segurança final, cobre qualquer cenário em que webhook e polling falhem juntos.
- Botão "Já paguei, verificar novamente" na tela `no-voucher` do `/hotspot` — recheck manual sem depender do iOS reabrir o portal sozinho.
- **Pendente (operacional, fora do código):** configurar o webhook no painel do Asaas (`https://<domínio>/api/asaas/webhook`, eventos de pagamento confirmado) + variáveis `ASAAS_WEBHOOK_TOKEN` e `CRON_SECRET` na Vercel. Sem isso, o sistema ainda funciona (via escape pro Safari + cron), mas o caminho mais rápido/confiável (webhook) continua desligado.

---

## Agent Python — Funções Principais

### Loop Principal (a cada 5 segundos)
| Função | Frequência | Descrição |
|--------|------------|-----------|
| `processar_autorizacoes()` | 5s | Lê pendentes do Supabase, autoriza via API/MongoDB |
| `processar_revogacoes()` | 5s | Lê revogados do Supabase, kick via API/MongoDB |
| `processar_vouchers()` | 60s | Cria vouchers no MongoDB da UDM; ao final, chama `_reautorizar_macs_cliente()` para vouchers pagos |
| `aplicar_walled_garden()` | 60s | Re-resolve DNS dos domínios, atualiza ipset |
| `garantir_redirect_porta_80()` | 60s | Garante regras iptables no lugar |
| `_limpar_bypass_expirados()` | 60s | Remove bypass MAC expirados (iptables) **e** remove do MongoDB registros expirados (`end < now, authorized_by="api"`) para forçar re-detecção do captive portal |
| `_reautorizar_macs_cliente()` | Sob demanda | Re-autoriza no MongoDB os **5 MACs mais recentes** de um cliente quando novo voucher pago é processado |

### Servidor Redirect (thread daemon, porta 8881)
- Multi-threaded (`ThreadingMixIn`) — não trava com muitos requests
- Verifica MongoDB antes de redirecionar (`_is_mac_authorized`, cache `_mac_auth_cache` de 30s por MAC)
- **Cache invalidado imediatamente** em `autorizar_mac_unifi()` e `kick_mac_unifi()` (fix 2026-07-07) — antes, um MAC podia continuar recebendo resposta "não autorizado" por até 30s depois de já ter sido autorizado de verdade no MongoDB (ou continuar "autorizado" por até 30s depois de revogado)
- Para MACs autorizados:
  - Probes de conectividade conhecidas → resposta exata esperada pelo SO (tabela `_PROBE_DISPATCH`)
  - Qualquer outra requisição HTTP → **proxy transparente** para o host original (header `Host:`)
- Para MACs não autorizados: 302 para Vercel (phones/computers) ou página PIN (Smart TVs)
- `do_HEAD` suportado — Roku e alguns Android TV usam HEAD para connectivity checks

### Autorização (`autorizar_mac_unifi`)
1. Normaliza MAC
2. Cria guest record no MongoDB se não existir (`_garantir_guest_record`)
3. Tenta API UniFi (`AUTHORIZE_GUEST_ACCESS`) — best-effort, falha anotada como `[api]` no log
4. Se API falhar (MAC privado, permissão insuficiente): fallback MongoDB direto (`_autorizar_via_mongo`)
5. Aplica QoS se free (123 Kbps)

**Nota:** A API key configurada (`UNIFI_API_KEY`) tem permissão para `POST .../actions` mas não para
listar clientes por MAC (`GET .../clients?filter=...`). Isso é normal — o MongoDB sempre funciona como
fallback confiável para todos os casos.

**⚠️ API key atual (`HgTTzA_MRl6eAlOBEpUbhkUzKCC0EpEx`) retorna 401 (expirada).** O MongoDB direto
garante que todas as autorizações e revogações funcionem. Renovar a key no UniFi Console quando possível.

### Revogação (`kick_mac_unifi`)
1. Remove bypass iptables do MAC
2. Remove guest do MongoDB (`db.guest.remove`)

**Nota:** A chamada `UNAUTHORIZE_GUEST_ACCESS` via API foi removida (endpoint de listagem de clientes
por MAC retorna 401 — permissão insuficiente). iptables + MongoDB já garantem o kick real.

---

## Velocidades e QoS

| Tipo | Download | Upload | Uso |
|------|----------|--------|-----|
| Gratuito | 123 Kbps | 123 Kbps | Mensagens de texto, email, banco |
| Premium | 50.000 Kbps (50 Mbps) | 50.000 Kbps | Streaming, vídeo, tudo |

---

## Durações de Autorização

| Tipo | Duração | Origem |
|------|---------|--------|
| Acesso gratuito | 1.440 min (24h) | `free-access/route.ts` |
| Voucher ilimitado (premium) | 14.400 min (10 dias) | `authorize/route.ts` |
| Voucher com prazo | Minutos restantes até expiração | Calculado em tempo real |

---

## Regras de Preço — Cadastro e Renovação

Lógica duplicada (sem módulo compartilhado) em `app/page.tsx` (cadastro), `app/renovacao/page.tsx`
(renovação) e `app/admin/page.tsx` (criação manual pelo admin) — função `planPrice()` em cada arquivo.

### Ministério — pessoas extras
- Categoria "Ministério" inclui **3 pessoas** no valor base (R$50/mês, R$40/15 dias).
- Cada pessoa além de 3 soma **+R$15** — só nos planos **Mensal** e **Anual**
  (`extras = max(0, qtd_pessoas - 3)`; no Anual multiplica também por 12 meses).
- Planos **Diário** e **Quinzenal (15 dias)** têm preço fechado por categoria e **não usam** a
  quantidade de pessoas no cálculo, mesmo que o campo apareça no formulário.
- Desconto por volume (20%/25% off no mensal, 25% no anual) incide **só sobre a base**, nunca sobre
  os extras — os +R$15/pessoa não recebem desconto.

### UI (2026-07-10)
- Ao selecionar "Ministério", a quantidade de pessoas já inicia em 3 (mínimo) — trocado o campo livre
  por um stepper (`-`/`+`, classe `.people-stepper`) que não desce de 3, com hint fixo explicando a
  regra dos +R$15/pessoa nos planos mensal/anual.
- Resumo do plano (`PlanSummary` em `app/page.tsx`; bloco inline equivalente em `renovacao/page.tsx`
  e `pagamento/page.tsx`) ganhou uma linha extra (`.extras-hint`) quando há gente além das 3 inclusas:
  "+N obreiros além dos 3 inclusos · +R$X".
- `app/admin/page.tsx` não tem esse input — sempre calcula com `people = "3"` fixo mesmo para
  Ministério (divergência conhecida, fora do escopo desta mudança).

### Risco conhecido
`valor` final é calculado no client e enviado como está para `/api/asaas/pix` e `/api/asaas/card` —
sem recálculo/validação server-side da fórmula antes de gerar a cobrança no Asaas.

---

## Credenciais e Variáveis de Ambiente

| Variável | Descrição | Onde |
|----------|-----------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço Supabase | UDM (`/data/scripts/start_agent.sh`) |
| `UNIFI_API_KEY` | API Key da UDM | Hardcoded no agent (fallback) |
| `GUEST_USER_ID` | UUID do pseudo-usuário para acesso gratuito | Agent + Vercel env |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase | Vercel env |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública Supabase | Vercel env |
| `ASAAS_API_KEY` | Chave da API do Asaas (produção) | Vercel env |
| `ASAAS_API_URL` | Base da API Asaas (default `https://api.asaas.com/v3`; sandbox: `https://api-sandbox.asaas.com/v3`) | Vercel env |
| `ASAAS_WEBHOOK_TOKEN` | Token validado contra o header `asaas-access-token` em `/api/asaas/webhook` | Vercel env — **⚠️ pendente de configuração em produção** (ver seção Pagamentos) |
| `CRON_SECRET` | Protege `GET /api/asaas/reconcile` (Vercel injeta `Authorization: Bearer $CRON_SECRET` nas chamadas de cron) | Vercel env — **⚠️ pendente de configuração** |

**GUEST_USER_ID:** `5b0e3ee1-a588-460e-8572-2c658f52fde2`
**Site ID UDM:** `6834b054b243651f00c8dcc5`

---

## Área Administrativa — Voucher Gratuito

Admins (`papel: "admin"` ou `"gestor"`) podem criar vouchers gratuitos para **qualquer cliente**,
com duração e quota customizadas, sem necessidade de pagamento.

### Como funciona
- Em `/admin/<id>` → seção "Vouchers" → botão "+ Criar"
- Na tela de criação: selecionar plano (Diário/Mensal/Anual), duração e quota de dispositivos
- Opção de pagamento **"Gratuito"** disponível para todos os clientes (sem restrição de tipo de conta)
- Confirmar → voucher criado com `status: "pendente"` → agent processa → `status: "criado"` com código real

### Proteção
- **Frontend:** página `/admin/[id]` redireciona para `/home` se `papel === "user"`
- **Backend:** `POST /api/admin/clients/[id]/voucher` exige `requireAdmin` (valida token + papel no banco)
- Registro financeiro gerado com `valor_pago: 0` e `comprovante_pgto: "admin:Gratuito | atendimento pessoal"`

### Excluir voucher individual
- Botão 🗑 em cada voucher card na seção de Vouchers do admin
- Abre modal de confirmação antes de deletar
- **Backend:** `DELETE /api/admin/vouchers/[id]` — remove o registro da tabela `vouchers` no Supabase
- **Efeito imediato:** remove o voucher da listagem sem reload da página (atualiza estado local)
- ⚠️ Não remove a autorização do MongoDB da UDM — se o device já estava autorizado, continua com acesso até expirar. Para revogar o acesso junto, usar o botão "Desconectar" no admin.

---

## Tabelas Supabase

### `clientes`
Usuários registrados. Campos: `user_id`, `nome`, `email`, `whatsapp`, `categoria`, `papel`, `ativo`, `aceite_de_termo`

### `vouchers`
Vouchers de acesso. Campos: `id`, `cliente_id`, `status` (`pendente`/`criado`/`Quase venc.`), `tempo_desc`, `codigo`, `id_voucher`, `data_expiracao`, `quota`

### `autorizacoes`
Autorizações de MAC. Campos: `id`, `cliente_id`, `mac_address`, `minutos`, `status` (`pendente`/`autorizado`/`erro`/`revogado`/`kick_ok`/`kick_erro`)

### `visitantes_free`
Visitantes anônimos (acesso gratuito). Campos: `id`, `mac_address`, `telefone`, `criado_em`, `migrou_pago`

---

## Inicialização e Persistência na UDM

### Script de inicialização (`/data/scripts/start_agent.sh`)
```bash
#!/bin/sh
export SUPABASE_SERVICE_ROLE_KEY="<chave>"
cd /data/scripts && python3 -u udm_agent.py
```

O flag `-u` é obrigatório para log imediato (sem buffering). Sem ele, logs podem atrasar vários minutos.

### Serviços systemd

#### `udm-agent.service` — Agent principal
```ini
[Unit]
Description=UDM Agent - Vouchers e Portal

[Service]
Type=simple
ExecStart=/bin/sh /data/scripts/start_agent.sh
Restart=always
RestartSec=10
StandardOutput=append:/data/scripts/agent.log
StandardError=append:/data/scripts/agent.log
WorkingDirectory=/data/scripts
```

**Log:** `/data/scripts/agent.log` (stdout do processo, sem timestamp) + `/data/scripts/voucher.log` (via `log()` interno, com timestamp). O `voucher.log` acumula saída de TODOS os processos que já rodaram.

**⚠️ Importante:** O systemd deve executar `start_agent.sh` (não `python3 udm_agent.py` diretamente).
`start_agent.sh` exporta `SUPABASE_SERVICE_ROLE_KEY` — sem esse passo o agent inicia com a variável
vazia e todas as chamadas ao Supabase retornam `401 No API key found`.

#### `create_voucher_auto.service` — Agent de vouchers
```ini
[Unit]
Description=Criação automática de vouchers Supabase/UDM

[Service]
ExecStart=/usr/bin/python3 /data/scripts/create_voucher_auto.py
Restart=always
```

Script mais antigo, focado só em processar vouchers `pendente`. Roda em paralelo com `udm_agent.py`.
Não tem redirect server nem funções de auth/QoS.

```bash
# Reiniciar ambos os serviços
systemctl restart udm-agent
systemctl restart create_voucher_auto
```

### ⚠️ Deploy dos agents NÃO é automático

`git push` só atualiza o Vercel (frontend + API routes). Os scripts `udm_agent.py` e `create_voucher_auto.py`
no repositório são **cópias de referência** — os arquivos que rodam de verdade ficam em `/data/scripts/` na
UDM e precisam ser copiados manualmente toda vez que houver mudança nos dois:

```bash
# Copiar ambos os scripts para a UDM
scp scripts/udm_agent.py root@10.70.0.1:/data/scripts/udm_agent.py
scp scripts/create_voucher_auto.py root@10.70.0.1:/data/scripts/create_voucher_auto.py

# Reiniciar ambos os serviços
ssh root@10.70.0.1 "systemctl restart udm-agent && systemctl restart create_voucher_auto"

# Confirmar
ssh root@10.70.0.1 "systemctl status udm-agent --no-pager | head -5; systemctl status create_voucher_auto --no-pager | head -5"
```

**⚠️ Bug recorrente:** sempre que um fix de processamento de vouchers for feito em `udm_agent.py`,
aplicar o mesmo fix em `create_voucher_auto.py` — ambos processam vouchers e o primeiro a pegar o
registro "vence". Fix em apenas um script deixa o outro criando vouchers com dados errados.

Esquecer o deploy é a causa mais comum de "corrigi o bug mas continua acontecendo".

### Verificação rápida
```bash
# Status do serviço
systemctl status udm-agent

# Agent rodando?
ps aux | grep udm_agent | grep -v grep

# Servidor redirect respondendo?
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8881/

# Regras iptables corretas?
iptables -t nat -L PREROUTING -n --line-numbers | head -6

# Log em tempo real
tail -f /data/scripts/agent.log
```

---

## Problemas Conhecidos e Soluções

### Tela de login da UDM aparece antes do portal
A UDM mostra brevemente sua tela de login (UniFi OS) via HTTPS antes do nosso portal carregar. É cosmético — o usuário pode fechar. Causado pelo portal nativo da UDM que não pode ser completamente desativado sem perder o guest isolation.

### Portal admin da UDM aparece após login bem-sucedido (RESOLVIDO)
**Sintoma:** Depois de autenticar no portal Vercel e ver "Você está conectado!", o browser abre o portal de admin do UniFi OS (`https://10.70.0.1`).
**Causa:** Dois comportamentos novos introduzidos para suporte a Smart TVs criaram um caminho até o admin da UDM em phones/computadores:
1. `do_POST` redirecionava MACs não autorizados para `http://10.70.0.1/` (gateway). O browser seguia esse redirect como GET.
2. `_proxy_to_host()` para MACs autorizados conectava em `10.70.0.1:80` **de dentro do processo da UDM**, bypassando o iptables. O servidor HTTP da UDM respondia com `301 → https://10.70.0.1/` → browser abria o admin.
**Fix aplicado:**
- `do_POST` não autorizado redireciona para o portal Vercel (igual ao `do_GET`), nunca para o gateway.
- `_proxy_to_host()` rejeita requisições com `Host: 10.70.0.1` (retorna False) antes de tentar conectar.

### `redirect_https` deve ser `false`
Se `redirect_https: true` no MongoDB da UDM, a UDM redireciona via HTTPS e o iptables (porta 80) não intercepta. Corrigir com:
```bash
mongo --port 27117 ace --quiet --eval 'db.setting.update({key: "guest_access"}, {$set: {redirect_https: false}})'
```

### MACs privados (randomizados)
iOS/Android usam MACs aleatórios. A API UniFi não enxerga esses MACs. O agent usa fallback MongoDB direto para autorizá-los.

### Agent travado sem processar autorizações (RESOLVIDO)
**Sintoma:** Autorizações ficam em `status: "pendente"` por mais de 1 minuto; frontend mostra "Liberando acesso..." indefinidamente.
**Causa A — Processo iniciado sem `start_agent.sh`:** Se o agente for iniciado diretamente com `python3 udm_agent.py` sem passar pelo `start_agent.sh`, a `SUPABASE_SERVICE_ROLE_KEY` fica vazia. Todas as chamadas ao Supabase retornam `401 No API key found`. O loop continua rodando mas nunca processa nada.
**Causa B — Conexão HTTPS sem timeout:** Chamadas ao Supabase sem `timeout=` param bloqueiam indefinidamente em caso de instabilidade de rede, travando o loop principal (thread única). O processo aparece "vivo" mas não responde.
**Causa C — Python sem `-u`:** Sem o flag de unbuffered output, logs podem demorar minutos para aparecer, dificultando o diagnóstico.
**Fix aplicado:** Todas as `http.client.HTTPSConnection(SUPABASE_URL, ...)` agora têm `timeout=10`. Systemd configurado para usar `start_agent.sh` com `python3 -u`.
**Diagnóstico rápido:**
```bash
# Autorizações presas?
curl -s ".../rest/v1/autorizacoes?status=eq.pendente" -H "apikey: ..." | python3 -m json.tool

# Agent rodando?
systemctl status udm-agent
ps aux | grep udm_agent | grep -v grep

# Log mostra 401?
tail -20 /data/scripts/agent.log | grep "401\|Erro"

# Solução: reiniciar via systemd
systemctl restart udm-agent
tail -f /data/scripts/agent.log
```

### Windows NCSI — "Sem internet" após autenticação (RESOLVIDO)
Cada SO usa uma URL e resposta específica para detectar conectividade (NCSI). Se o redirect server
retornar a resposta errada, o SO marca a rede como "sem internet" mesmo com tráfego fluindo.
O Windows espera `"Microsoft Connect Test"` em `/connecttest.txt` (text/plain), **não** o HTML `"Success"` do iOS.
Sem a resposta correta, o ícone de rede mostra "sem internet" e apps como Spotify se recusam a conectar
(o browser funciona porque ignora o flag NCSI). Corrigido no redirect server com detecção por path.

**Escopo das regras:** Todas as regras iptables usam `-i br0`. As outras redes (`br2`) não são afetadas.
Para verificar: `iptables -t nat -S PREROUTING | grep -v br0` — deve retornar apenas regras UBIOS nativas.

### Bloqueio HTTPS para guests — NÃO FAZER sem VLAN separada

**Tentativa e resultado (2026-07-01):** Foi adicionada uma função `aplicar_bloqueio_https()` que
mantinha um ipset `hotspot_authorized` e adicionava regra FORWARD REJECT para porta 443 de MACs
não autorizados. O objetivo era forçar o webOS da LG a detectar o captive portal.

**Problema:** `br0` = `10.70.0.0/21` cobre **todos** os dispositivos: guests, admin e o próprio Mac
do administrador. O Mac do admin (`46:f9:f9:e0:e9:d3`, 10.70.4.129) não estava no ipset
`hotspot_authorized` (nunca autorizou via sistema de vouchers). Resultado: HTTPS bloqueado para
todos, incluindo admin. Internet caiu para todos.

**Recuperação:** `iptables -D FORWARD -p tcp --dport 443 -m set ! --match-set hotspot_authorized src -j REJECT --reject-with tcp-reset`

**Lição:** Não inserir regras HTTPS no FORWARD sem primeiro garantir que admin está em VLAN separada
(`br2`, `br3`) ou implementar um bypass list com os MACs admin conhecidos **antes** de ativar a regra.

A função `aplicar_bloqueio_https()` existe no código mas **não é chamada** no loop principal.

### Device preso "conectado mas sem internet" após voucher vencer (RESOLVIDO 2026-07-29)

**Sintoma:** Quando o voucher de um cliente vence (pago ou gratuito), o celular/computador fica associado ao WiFi mas sem internet. Ao pagar um novo voucher, a internet não volta automaticamente — é preciso entrar na conta, clicar em "Desconectar", esquecer a rede e reconectar.

**Causa raiz:**
1. Ao vencer, o MongoDB `guest.end < now` para o tráfego HTTPS (UniFi data plane), mas o device continua *associado* ao WiFi. O SO não redetecta o captive portal automaticamente em redes "conhecidas".
2. Ao pagar novo voucher, `processar_vouchers()` criava o voucher no MongoDB e no Supabase, mas **não re-autorizava o MAC do device**. O device só voltaria a ter internet ao passar manualmente pelo captive portal.

**Fix aplicado:**

`_limpar_bypass_expirados()` (roda a cada 60s) passou a **remover do MongoDB** os registros com `authorized_by="api"` e `end < now` (excluindo stubs com `end=1`). Isso força o UniFi a eventualmente deautenticar o device, que ao reconectar passa pelo captive portal e é re-autorizado automaticamente se tiver sessão ativa e voucher válido.

Nova função `_reautorizar_macs_cliente(cliente_uid, tempo_minutos)`: chamada de dentro de `processar_vouchers()` sempre que um voucher **pago** (não gratuito, não `GUEST_USER_ID`) é processado. Busca os **5 MACs mais recentes** com `status="autorizado"` para o cliente no Supabase e os re-autoriza diretamente no MongoDB com o novo tempo. **Efeito prático:** o device volta a ter internet em até 60 segundos após o pagamento, sem precisar reconectar ou interagir com o captive portal.

**Sem impacto em usuários ativos:** ambas as mudanças só afetam registros com `end < now` (já expirados) ou clientes que acabaram de pagar um novo voucher.

### Voucher anual criado com ~60 minutos de validade em vez de 365 dias (RESOLVIDO 2026-07-30)

**Sintoma:** Admin cria voucher "1 ano" para um cliente. O voucher aparece com validade de ~1 hora (ou 1 dia), não 365 dias.

**Causa raiz (em camadas):**

1. **`create_voucher_auto.py` sem suporte a "ano":** A função `converter_tempo_para_minutos()` desse script só reconhecia `mês/meses`, `dia/dias`, `hora/horas`. Para `tempo_desc = "1 ano"`, retornava `0` → fallback `60 min`. Como `create_voucher_auto.service` roda continuamente desde julho/2018 e era mais rápido no polling, processava o voucher antes de `udm_agent.py`.

2. **`udm_agent.py` também sem suporte (antes do fix 00b3c5d):** Mesmo se processado por `udm_agent.py`, o resultado seria o mesmo — fallback de 60 min.

3. **Restart sem SCP:** ao reiniciar o `udm_agent.py` via `pkill + nohup` (em vez de `systemctl restart`), o processo novo carrega o código do disco — mas se o SCP do fix e o restart aconteceram quase simultaneamente, o Python pode ter carregado o arquivo antigo (antes do SCP concluir). O arquivo em disco e o código em memória ficaram dessincronizados.

**Fix aplicado (2026-07-30):**
- Ambos os scripts receberam `"ano": 525600` e `"anos": 525600` na tabela `tempos`, e `ano|anos` adicionado ao regex
- `create_voucher_auto.service` reiniciado com `systemctl restart create_voucher_auto`
- **Regra aprendida:** fixes em processamento de vouchers devem ser aplicados em ambos os scripts

### Visitante free reconecta, vê "Conectado!" e cai de volta na tela inicial (RESOLVIDO 2026-07-30)

**Sintoma:** Um visitante que já tinha usado o acesso gratuito antes reconecta ao WiFi com o mesmo celular. O app mostra a tela de sucesso ("Você está conectado!"), mas segundos depois volta para a tela inicial do portal (`/hotspot`), em loop.

**Causa raiz:** `POST /api/hotspot/free-access` checava só `status = "autorizado"` na tabela `autorizacoes` para decidir se o MAC já tinha acesso — sem considerar que o acesso free vale só 1440 min (24h). Passadas as 24h, `_limpar_bypass_expirados()` já tinha removido de verdade o registro no MongoDB e a regra de bypass no iptables (mesmo mecanismo do bug acima), mas a linha no Supabase nunca era atualizada e ficava `"autorizado"` para sempre. Resultado: o frontend confiava no registro velho e mostrava sucesso, mas a rede de fato bloqueava o device — o próximo probe de conectividade caía de novo no redirect do portal cativo.

**Fix aplicado:** `free-access/route.ts` agora calcula `Date.now() - created_at` e compara com `minutos` antes de aceitar um registro `"autorizado"` como válido. Se expirou, marca como `"expirado"` e segue o fluxo normal, criando uma autorização `"pendente"` nova — que o agent processa e libera o MAC de verdade (mesmo padrão de checagem de idade já usado nos TV PINs, ver `tv-pin/route.ts`).

### Após atualização de firmware da UDM
Verificar: agent rodando, serviço systemd ativo (`systemctl status udm-agent`), regras iptables no lugar, `redirect_https: false`.

### Windows 11 — CNA não abre sozinho / ícone mostra "Sem Internet" (EM INVESTIGAÇÃO, 2026-07-07)

O fix de NCSI documentado acima (`connecttest.txt`) foi validado só em Windows 10. Testando em Windows 11
pela primeira vez apareceram sintomas novos:

**1. Simples desconectar/reconectar Wi-Fi não força o Windows a refazer a checagem NCSI.** Ele reaproveita
o veredito antigo em cache ("tenho internet") sem mandar nenhuma probe HTTP nova — confirmado via
`tail -f agent.log`: nenhuma requisição do dispositivo aparecia no redirect server depois do toggle.
**Contorno que funcionou:** "Esquecer rede" (Configurações → Rede e Internet → Wi-Fi → Gerenciar redes
conhecidas) + reconectar do zero. Depois disso o tráfego do dispositivo passou a aparecer no log.

**2. Mesmo com "esquecer rede", a probe NCSI real (`/connecttest.txt`) não disparou sozinha** — só
tráfego de apps de fundo (ex: uma lib `axios` fazendo `GET ip-api.com/json`, algum serviço Samsung
batendo em `orcaservice.samsungmobile.com/monitor.html`) apareceu interceptado. O fluxo completo só
disparou de fato quando o usuário **digitou uma URL HTTP manualmente no navegador** — isso confirmou que
login → voucher → autorização funcionam corretamente em Windows 11 quando uma request HTTP real acontece.

**3. Depois de autorizado, o ícone do Wi-Fi continuou mostrando "Sem Internet, aberto"** mesmo com
tráfego real fluindo (confirmado no log: `GET /`, `/json`, proxy funcionando, sem nenhuma marca de "não
autorizado"). Isso bateu com o bug do cache de 30s (`_mac_auth_cache`, ver seção do Agent Python) — a
mesma probe de conectividade recebia "não autorizado" por até 30s depois de já estar autorizado no
MongoDB. **Corrigido e deployado na UDM em 2026-07-07.** Mesmo depois do fix, em um teste pontual o ícone
continuou "Sem Internet" após toggle simples de Wi-Fi — a hipótese é que o Windows não tinha refeito a
probe própria (`connecttest.txt`) ainda (só viu tráfego de apps de fundo, não a checagem NCSI do SO).

**Status:** sistema confirmadamente autoriza e libera internet real para Windows 11 (proxy funcionando).
O que ainda não está 100% resolvido é o **ícone da barra de tarefas do Windows** demorar a refletir isso —
possivelmente por causa do timing próprio do NCSI/NLA do Windows, não por resposta errada do nosso lado.
Próximos passos a testar: `Configurações → Rede e Internet → Status → Diagnosticar problemas de rede`,
reiniciar o serviço `NlaSvc` do Windows, ou aguardar o ciclo natural de reavaliação do NCSI.

**Diagnóstico usado (útil para próximas investigações):**
```bash
# Monitorar em tempo real enquanto o dispositivo testa (rodar ANTES do teste, ~90-120s)
ssh root@10.70.0.1 "timeout 120 tail -f -n 0 /data/scripts/agent.log"

# Checar se um MAC específico está autorizado
ssh root@10.70.0.1 'mongo --port 27117 ace --quiet --eval "db.guest.find({\"mac\":\"<mac>\"}).pretty()"'
```

---

## Smart TVs — Fluxo Específico

### Por que TVs são diferentes de phones/computadores

Smart TVs **não abrem browser automaticamente** ao conectar. Em vez disso, o SO da TV faz uma série de probes HTTP proprietários para decidir se há internet ou captive portal. Se qualquer probe retornar resposta errada, a TV marca a rede como "captive portal ativo" — e apps como Amazon Prime e Disney+ bloqueam completamente (Netflix tem bypass especial para hotspot/hotel).

### TV **não autorizada** — Fluxo PIN

1. TV conecta → SO faz probe HTTP (ex: `/h`, `/generate_204`)
2. Agent detecta User-Agent de TV (`_is_tv()`)
3. Para **probes** ou **redirects `/guest/s/default/`** → 302 para `http://10.70.0.1/tv?id=<MAC>` — força CNA a abrir browser embutido
4. Browser da TV exibe página com PIN de 6 dígitos (`_TV_PIN_HTML`, auto-refresh 5s)
5. Usuário digita o PIN no celular via portal web (`wifi-manager-react.vercel.app` → "Conectar TV")
6. Agent autoriza o MAC no MongoDB
7. TV reconecta — próximo meta-refresh mostra `_TV_CONNECTED_HTML` ("TV Conectada!")
8. TV segue pelo caminho de TV autorizada

**Status por plataforma (testado em produção, 2026-07-01):**

| Plataforma | Fluxo automático | Observação |
|---|---|---|
| Samsung Tizen | ✅ Totalmente automático | CNA abre sozinha, PIN aparece na TV |
| Amazon Fire TV | ✅ Quase automático | Requer pressionar OK no controle para abrir Silk browser |
| LG webOS | ⚠️ Parcialmente automático | Ver limitação abaixo |
| Android TV / Google TV | ✅ Automático (Android CNA padrão) | `/generate_204` interceptado normalmente |

### TV **autorizada** — Fluxo de probes

O agent retorna respostas exatas para cada probe da tabela `_PROBE_DISPATCH`:

| Path / fragmento | Status | Body | SO |
|---|---|---|---|
| `/generate_204` | 204 | vazio | Android, LG, Chromecast |
| `/204` | 204 | vazio | Samsung alternativo |
| `/connecttest.txt` | 200 | `Microsoft Connect Test` | Windows, Xbox |
| `/ncsi.txt` | 200 | `Microsoft NCSI` | Windows legado |
| `/hotspot-detect` | 200 | HTML Success | Apple TV, iOS |
| `/canonical.html` | 200 | HTML Success | Apple |
| `/h` | 200 | `c` | **Samsung Tizen** (samsungcloudsolution.com) |
| `check.xml` | 200 | XML `<netcheck><connection>OK</connection></netcheck>` | **Samsung Tizen** |
| `/success.txt` | 200 | `success\n` | Firefox, Amazon |
| `/kindle-wifi/wifistub.html` | 200 | HTML Kindle | Amazon Fire TV |
| `/roku-tos-checker.html` | 200 | vazio | Roku |
| `/cs/` | 200 | vazio | LG webOS |

**Samsung Tizen — probes específicos além da tabela:**
- `GET /openapi/timesync?client=T20O` → **proxy para `openapi.samsungcloudsolution.net`** (retorna timestamp real no formato exato do Tizen — necessário para validação de certificados HTTPS)
- `POST /appboot/SSTV-KS20-?suspended=true` → **proxy para servidor Samsung** (resposta JSON da Samsung usada para inicializar Smart Hub)
- Qualquer outra requisição HTTP → **proxy transparente** para o host original (exceto `Host: 10.70.0.1` — bloqueado para evitar redirect ao admin da UDM)

### Race condition no ARP (resolvida)

TV conecta → probe imediata antes do ARP resolver → `get_mac_from_ip()` retorna `None` → TV recebe 302 → Samsung marca "captive portal".

**Fix:** `get_mac_from_ip()` tenta até 3 vezes com 300ms de espera entre tentativas.

### TVs atrás de roteador terceiro (TP-Link como repetidor)

Quando o cliente usa roteador próprio em modo repetidor/NAT entre a TV e a UDM:
- Todos os dispositivos atrás do roteador aparecem com o **IP e MAC do roteador** na UDM
- Autorizar o MAC do roteador libera todos os dispositivos conectados a ele
- O MAC visível na UDM é o **MAC WAN** do roteador (= MAC da etiqueta + 1 em alguns modelos TP-Link)
- Verificar MAC real: `ip neigh show <IP_DO_ROTEADOR>` na UDM

### Keywords de detecção de TV (`_is_tv()`)

User-Agent contendo qualquer um dos termos detecta TV e ativa o fluxo PIN:
`smarttv`, `smart-tv`, `tizen`, `webos`, `web0s`, `netcast`, `roku`, `appletv`, `bravia`, `androidtv`, `chromecast`, `crkey`, `aftm`, `afts`, `aftt`, `aftb`, `aftmm`, `vizio`, `hbbtv`, `philipstv`, `nettv`, `playstation`, `xbox`, `nintendo`, `lg browser`, `googletv`, `google tv`, `vidaa`, `foxxum`, `orsay`, `firetv`, `fire tv`, `amazontv`, `semp`, `philco`

### LG webOS — Limitação do Background Content Loader

O webOS usa dois mecanismos distintos:
1. **CNA interativo** — abre browser embutido quando detecta captive portal via `/generate_204` ou `/cs/`. Só roda na primeira conexão ou se o cache expirar.
2. **Background content loader** — faz requests HTTP periódicos via `/guest/s/default/?id=<mac>&url=<url>` para carregar thumbnails do LG Channels. **Ignora HTML** (espera dados de imagem). Nosso agent detecta esse path e redireciona para a página de PIN, mas o background loader descarta a resposta.

**Resultado:** Se a TV já esteve na rede antes e o webOS cached o estado "conectado", o CNA não roda de novo automaticamente. O background loader cicla continuamente mas nunca abre o browser.

**Workaround para o cliente:** Abrir o app "Navegador" da LG (Home → Todos os Apps → Navegador), digitar qualquer URL HTTP (`http://conectar.tv` ou similar) na barra de endereço. O browser interativo faz request HTTP → iptables intercepta → agent serve a página de PIN.

**Solução definitiva (não implementada):** Bloquear HTTPS seletivamente para guests não autorizados forçaria o webOS a detectar o captive portal. Porém, na topologia atual (`br0` cobre admin e guests na mesma bridge), qualquer regra de bloqueio HTTPS afeta todos os dispositivos. Requer VLAN separada de gerência ou bypass list por MAC de admin.

### Amazon Fire TV Stick

- `_TV_KEYWORDS` inclui `aftm, afts, aftt, aftb, aftmm` (códigos de modelo Fire TV)
- `_PROBE_DISPATCH` inclui `/kindle-wifi/wifistub.html`
- Quando ligar: detecta captive portal → mostra "Entrar na rede" na tela → usuário pressiona OK no controle → Silk browser abre com tela de PIN
- **Fluxo do PIN confirmado em produção:** PIN `524104` gerado para MAC `b8:5f:98:28:34:91` (AFTSS)

### Por que Netflix funciona mas YouTube/Amazon/Disney não (sem proxy)

Netflix tem suporte nativo a redes de hotspot/hotel — ignora o estado "captive portal ativo".
YouTube, Amazon Prime e Disney+ não têm esse bypass: se o SO marcou "captive portal", os apps bloqueiam.
Além disso, apps fazem chamadas HTTP a APIs da Samsung (Smart Hub, `appboot`) e CDNs — sem proxy, o agent retornava HTML em vez da resposta real → apps quebravam mesmo com TV mostrando "conectado".
