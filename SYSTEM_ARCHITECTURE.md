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
@reboot while true; do /data/scripts/start_agent.sh >> /data/scripts/voucher.log 2>&1; sleep 5; done
```

**⚠️ Importante:** O crontab deve chamar `start_agent.sh` (não `python3 udm_agent.py` diretamente).
`start_agent.sh` exporta `SUPABASE_SERVICE_ROLE_KEY` — sem esse passo o agent inicia com a variável
vazia e todas as chamadas ao Supabase retornam `401 No API key found`. O redirecionamento `>> voucher.log`
também é essencial para o loop `while true` não engolir erros silenciosamente.

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

### Agent travado sem processar autorizações (RESOLVIDO)
**Sintoma:** Autorizações ficam em `status: "pendente"` por mais de 1 minuto; frontend mostra "Liberando acesso..." indefinidamente.
**Causa A — Processo iniciado sem `start_agent.sh`:** Se o agente for iniciado diretamente com `python3 udm_agent.py` sem passar pelo `start_agent.sh`, a `SUPABASE_SERVICE_ROLE_KEY` fica vazia. Todas as chamadas ao Supabase retornam `401 No API key found`. O loop continua rodando mas nunca processa nada. Crontab com auto-restart não detecta (processo não cai — só fica inoperante).
**Causa B — Conexão HTTPS sem timeout:** Chamadas ao Supabase sem `timeout=` param bloqueiam indefinidamente em caso de instabilidade de rede, travando o loop principal (thread única). O processo aparece "vivo" mas não responde.
**Fix aplicado:** Todas as `http.client.HTTPSConnection(SUPABASE_URL, ...)` agora têm `timeout=10`. Crontab corrigido para usar `start_agent.sh`.
**Diagnóstico rápido:**
```bash
# Autorizações presas?
# (Via Supabase REST — substitua URL e KEY)
curl -s ".../rest/v1/autorizacoes?status=eq.pendente" -H "apikey: ..." | python3 -m json.tool

# Agent rodando?
ps aux | grep udm_agent | grep -v grep

# Log mostra 401?
tail -20 /data/scripts/voucher.log | grep "401\|Erro"

# Solução: matar processo e reiniciar via start_agent.sh
pkill -f udm_agent.py
cd /data/scripts && nohup ./start_agent.sh >> /data/scripts/voucher.log 2>&1 & disown
```

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

---

## Smart TVs — Fluxo Específico

### Por que TVs são diferentes de phones/computadores

Smart TVs **não abrem browser automaticamente** ao conectar. Em vez disso, o SO da TV faz uma série de probes HTTP proprietários para decidir se há internet ou captive portal. Se qualquer probe retornar resposta errada, a TV marca a rede como "captive portal ativo" — e apps como Amazon Prime e Disney+ bloqueam completamente (Netflix tem bypass especial para hotspot/hotel).

### TV **não autorizada** — Fluxo PIN

1. TV conecta → SO faz probe HTTP (ex: `/h`, `/generate_204`)
2. Agent detecta User-Agent de TV (`_is_tv()`)
3. Para **probes** → 302 para `http://10.70.0.1/tv?id=<MAC>` — força CNA a abrir browser embutido
4. Browser da TV exibe página com PIN de 6 dígitos
5. Usuário digita o PIN no celular via portal web
6. Agent autoriza o MAC no MongoDB
7. TV reconecta — agora flui pelo caminho de TV autorizada

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
- Qualquer outra requisição HTTP → **proxy transparente** para o host original

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

### Por que Netflix funciona mas YouTube/Amazon/Disney não (sem proxy)

Netflix tem suporte nativo a redes de hotspot/hotel — ignora o estado "captive portal ativo".
YouTube, Amazon Prime e Disney+ não têm esse bypass: se o SO marcou "captive portal", os apps bloqueiam.
Além disso, apps fazem chamadas HTTP a APIs da Samsung (Smart Hub, `appboot`) e CDNs — sem proxy, o agent retornava HTML em vez da resposta real → apps quebravam mesmo com TV mostrando "conectado".
