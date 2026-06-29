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
- **Agent:** Python 3.9 rodando na UDM (`/data/scripts/udm_agent.py`)
- **MongoDB:** Interno da UDM (porta 27117, database `ace`) — controla autorizações WiFi

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

---

## API Endpoints

### `POST /api/hotspot/free-access`
- **Auth:** Nenhuma
- **Body:** `{ mac, telefone }`
- **Fluxo:** Salva telefone em `visitantes_free`, cria voucher gratuito (se não existir), cria autorização de 1440 min (24h)
- **Velocidade:** 123 Kbps (só mensagens de texto)

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
- **Fluxo:** Revoga todas autorizações do usuário autenticado

### `POST /api/hotspot/revoke-free-access`
- **Auth:** Bearer token
- **Fluxo:** Revoga todas autorizações do GUEST_USER_ID

---

## Agent Python — Funções Principais

### Loop Principal (a cada 5 segundos)
| Função | Frequência | Descrição |
|--------|------------|-----------|
| `processar_autorizacoes()` | 5s | Lê pendentes do Supabase, autoriza via API/MongoDB |
| `processar_revogacoes()` | 5s | Lê revogados do Supabase, kick via API/MongoDB |
| `processar_vouchers()` | 60s | Cria vouchers no MongoDB da UDM |
| `aplicar_walled_garden()` | 60s | Re-resolve DNS dos domínios, atualiza ipset |
| `garantir_redirect_porta_80()` | 60s | Garante regras iptables no lugar |
| `_limpar_bypass_expirados()` | 60s | Remove bypass MAC de autorizações expiradas |

### Servidor Redirect (thread daemon, porta 8881)
- Multi-threaded (`ThreadingMixIn`) — não trava com muitos requests
- Verifica MongoDB antes de redirecionar (cache 30s)
- Para MACs autorizados, retorna resposta específica por SO:
  - Android (`/generate_204`) → HTTP 204
  - Windows (`/connecttest.txt`) → `"Microsoft Connect Test"` text/plain
  - Windows legado (`/ncsi.txt`) → `"Microsoft NCSI"` text/plain
  - iOS/macOS (outros paths) → HTML `"Success"`
- Retorna 302 para Vercel para MACs não autorizados

### Autorização (`autorizar_mac_unifi`)
1. Normaliza MAC
2. Cria guest record no MongoDB se não existir (`_garantir_guest_record`)
3. Tenta API UniFi (`AUTHORIZE_GUEST_ACCESS`)
4. Se API falhar (MAC privado): fallback MongoDB direto (`_autorizar_via_mongo`)
5. Aplica QoS se free (123 Kbps)

### Revogação (`kick_mac_unifi`)
1. Remove bypass iptables do MAC
2. Chama API UniFi `UNAUTHORIZE_GUEST_ACCESS`
3. Remove guest do MongoDB (`db.guest.remove`)

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

## Credenciais e Variáveis de Ambiente

| Variável | Descrição | Onde |
|----------|-----------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de serviço Supabase | UDM (`/data/scripts/start_agent.sh`) |
| `UNIFI_API_KEY` | API Key da UDM | Hardcoded no agent (fallback) |
| `GUEST_USER_ID` | UUID do pseudo-usuário para acesso gratuito | Agent + Vercel env |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase | Vercel env |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública Supabase | Vercel env |

**GUEST_USER_ID:** `5b0e3ee1-a588-460e-8572-2c658f52fde2`
**Site ID UDM:** `6834b054b243651f00c8dcc5`

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
cd /data/scripts && python3 udm_agent.py
```

### Crontab (auto-restart no boot + crash recovery)
```
@reboot while true; do /data/scripts/start_agent.sh; sleep 5; done
```

### Verificação rápida
```bash
# Agent rodando?
ps aux | grep udm_agent | grep -v grep

# Servidor redirect respondendo?
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8881/

# Regras iptables corretas?
iptables -t nat -L PREROUTING -n --line-numbers | head -6

# Log sem erros?
tail -20 /data/scripts/voucher.log
```

---

## Problemas Conhecidos e Soluções

### Tela de login da UDM aparece antes do portal
A UDM mostra brevemente sua tela de login (UniFi OS) via HTTPS antes do nosso portal carregar. É cosmético — o usuário pode fechar. Causado pelo portal nativo da UDM que não pode ser completamente desativado sem perder o guest isolation.

### `redirect_https` deve ser `false`
Se `redirect_https: true` no MongoDB da UDM, a UDM redireciona via HTTPS e o iptables (porta 80) não intercepta. Corrigir com:
```bash
mongo --port 27117 ace --quiet --eval 'db.setting.update({key: "guest_access"}, {$set: {redirect_https: false}})'
```

### MACs privados (randomizados)
iOS/Android usam MACs aleatórios. A API UniFi não enxerga esses MACs. O agent usa fallback MongoDB direto para autorizá-los.

### Windows NCSI — "Sem internet" após autenticação (RESOLVIDO)
Cada SO usa uma URL e resposta específica para detectar conectividade (NCSI). Se o redirect server
retornar a resposta errada, o SO marca a rede como "sem internet" mesmo com tráfego fluindo.
O Windows espera `"Microsoft Connect Test"` em `/connecttest.txt` (text/plain), **não** o HTML `"Success"` do iOS.
Sem a resposta correta, o ícone de rede mostra "sem internet" e apps como Spotify se recusam a conectar
(o browser funciona porque ignora o flag NCSI). Corrigido no redirect server com detecção por path.

**Escopo das regras:** Todas as regras iptables usam `-i br0`. As outras redes (`br2`) não são afetadas.
Para verificar: `iptables -t nat -S PREROUTING | grep -v br0` — deve retornar apenas regras UBIOS nativas.

### Após atualização de firmware da UDM
Verificar: agent rodando, crontab existente, regras iptables no lugar, `redirect_https: false`.
