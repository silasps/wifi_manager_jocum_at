#!/usr/bin/env python3
import http.client
import ssl
import json
import urllib.parse
import subprocess
import datetime
import re
import time
import os
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
# ===============================
# CONFIGURAÇÕES
# ===============================
SUPABASE_URL = "xptkrsbjyyslbgurfvbg.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TABELA_VOUCHERS = "vouchers"
COL_TEMPO = "tempo(min)"
COL_QTD = "quota"
COL_STATUS = "status"
COL_CODIGO = "codigo"
LOG_FILE = "/data/scripts/voucher.log"
QUOTA_KB = 30 * 1024
VELOCIDADE_PAGO_KBPS = 50000   # 50 Mbps — planos pagos
VELOCIDADE_FREE_KBPS = 256     # 256 Kbps — plano gratuito

# ===============================
# CONFIGURAÇÕES UNIFI - API KEY
# ===============================
# Recomendo depois trocar esta chave e usar variável de ambiente:
# export UNIFI_API_KEY="sua_nova_chave"
UNIFI_API_KEY = os.environ.get("UNIFI_API_KEY", "HgTTzA_MRl6eAlOBEpUbhkUzKCC0EpEx")
UNIFI_HOST = "localhost"
UNIFI_PORT = 443

# ===============================
# CONFIGURAÇÕES DO PORTAL REDIRECT
# ===============================
# Domínio da sua plataforma no Vercel
PORTAL_EXTERNO_URL = "https://wifi-manager-react.vercel.app"
# Porta que a UDM usa para redirecionar clientes ao portal externo
PORTAL_REDIRECT_PORT = 8881
# Interface e IP da rede guest (para redirect iptables 80→8881)
GUEST_INTERFACE = "br0"
GUEST_GATEWAY_IP = "10.70.0.1"

# ===============================
# WALLED GARDEN (PRE-AUTH ACCESS)
# ===============================
# Domínios liberados para clientes guest ANTES da autenticação.
# Replica o comportamento do walled garden nativo da UDM,
# que deixa de funcionar quando se usa portal externo.
WALLED_GARDEN_DOMAINS = [
    # Portal & infra
    "wifi-manager-react.vercel.app",
    "vercel.app",
    "vercel.com",
    "assets.vercel.com",
    "api.vercel.com",
    "vercel-insights.com",
    # Supabase (auth + banco)
    "xptkrsbjyyslbgurfvbg.supabase.co",
    "supabase.co",
    "api.supabase.com",
    "auth.supabase.com",
    # Google / gstatic / reCAPTCHA
    "ssl.gstatic.com",
    "gstatic.com",
    "www.gstatic.com",
    "fonts.gstatic.com",
    "www.google.com",
    "googleusercontent.com",
    "lh3.googleusercontent.com",
    "fonts.googleapis.com",
    "googleapis.com",
    "www.googleapis.com",
    "apis.google.com",
    "accounts.google.com",
    "clients6.google.com",
    "oauth2.googleapis.com",
    "content.googleapis.com",
    "storage.googleapis.com",
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "firebaseinstallations.googleapis.com",
    "firebasestorage.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "cloudfunctions.net",
    "recaptcha.net",
    "www.recaptcha.net",
    # Apple
    "appleid.apple.com",
    # Facebook
    "facebook.com",
    "graph.facebook.com",
    # Firebase / FlutterFlow
    "firebaseapp.com",
    "jocum-at.flutterflow.app",
    "jocum-at.web.app",
    "flutterflow.app",
    "web.app",
    "app.flutterflow.io",
    "api.flutterflow.io",
    # Outros
    "page.link",
    "app.goo.gl",
]
WALLED_GARDEN_IPSET = "walled_garden"
WALLED_GARDEN_REFRESH_SECONDS = 60  # re-resolve DNS a cada 1 min

# Na UDM local normalmente funciona com o primeiro prefixo.
# Mantive fallback para /v1 direto caso sua versão exponha assim.
UNIFI_API_PREFIXES = [
    "/proxy/network/integration",
    "",
]

# A documentação da API Key geralmente usa X-API-KEY.
# Mantive fallback Bearer para facilitar teste em versões diferentes.
UNIFI_AUTH_MODES = ["x-api-key", "bearer"]

_unifi_prefix_ok = None
_unifi_auth_mode_ok = None
_unifi_site_id_cache = None
# ===============================
# FUNÇÕES DE LOG
# ===============================
def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.datetime.now()}] {msg}\n")
    print(msg)
# ====================================
# CONVERTER TEMPO EXTENSO PARA MINUTOS
# ====================================
def converter_tempo_para_minutos(tempo_desc):
    """
    Converte uma string de tempo por extenso (ex: '1 mês', '2 dias') para minutos.
    """
    tempos = {
        "mês": 43200,  # 1 mês = 30 dias = 43200 minutos
        "meses": 43200,
        "dia": 1440,   # 1 dia = 1440 minutos
        "dias": 1440,
        "hora": 60,    # 1 hora = 60 minutos
        "horas": 60,
    }
    # Regex para capturar número e unidade
    match = re.match(r"(\d+)\s*(mês|meses|dia|dias|hora|horas)", tempo_desc.lower())
    if match:
        quantidade = int(match.group(1))
        unidade = match.group(2)
        # Retorna o valor em minutos
        if unidade in tempos:
            return quantidade * tempos[unidade]
    return 0  # Retorna 0 caso não seja possível converter
# ===============================
# SUPABASE
# ===============================
def buscar_vouchers_supabase():
    path = f"/rest/v1/{TABELA_VOUCHERS}?{urllib.parse.urlencode({'select': '*', 'status': 'eq.pendente'})}"
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    conn.request("GET", path, headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    if res.status != 200:
        raise Exception(f"Erro Supabase GET: {res.status} - {data}")
    return json.loads(data)
def atualizar_voucher_supabase(id_registro, codigo, data_expiracao, quota):
    path = f"/rest/v1/{TABELA_VOUCHERS}?id=eq.{id_registro}"
    payload = json.dumps({
        COL_STATUS: "criado",
        COL_CODIGO: codigo,
        "data_expiracao": data_expiracao,
        "id_voucher": codigo,  # Preenchendo a coluna 'id_voucher' com o código gerado
        "quota": quota
    })
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    conn.request("PATCH", path, body=payload, headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    if res.status not in (200, 204):
        raise Exception(f"Erro Supabase PATCH: {res.status} - {data}")
def buscar_cliente_nome_formatado(cliente_uid):
    path = f"/rest/v1/clientes?user_id=eq.{cliente_uid}&select=nome"
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    conn.request("GET", path, headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    if res.status != 200:
        raise Exception(f"Erro ao buscar cliente: {res.status} - {data}")
    resultado = json.loads(data)
    if resultado and "nome" in resultado[0]:
        partes = resultado[0]["nome"].strip().split()
        if len(partes) >= 2:
            return (partes[0] + partes[-1]).lower()
        else:
            return partes[0].lower()
    return "voucherauto"
# ===============================
# VOUCHER - MONGO INTERNO UDM
# ===============================
import uuid
def gerar_codigo_formatado(tempo, quota, note, velocidade_kbps=None):
    if velocidade_kbps is None or velocidade_kbps <= 0:
        velocidade_kbps = VELOCIDADE_PAGO_KBPS
    external_id = str(uuid.uuid4())
    site_id = "6834b054b243651f00c8dcc5"  # substitua pelo seu site_id real da UDM
    admin_name = "Contato"  # ou o nome desejado
    for_hotspot = "false"  # deve ser booleano, mas em string para inline JS
    note_sanitized = note.replace("'", "")  # evita quebra de string no JS/Mongo
    cmd = (
        f'/usr/bin/mongo ace --quiet --port 27117 --eval "'
        f'var now = Math.floor(Date.now() / 1000); '
        f'var code = Math.floor(1000000000 + Math.random() * 9000000000).toString(); '
        f'db.voucher.insertOne({{'
        f'create_time: now, '
        f'duration: {tempo}, '
        f'quota: {quota}, '
        f'used: 0, '
        f'note: \'{note_sanitized}\', '
        f'code: code, '
        f'for_hotspot: {for_hotspot}, '
        f'admin_name: \'{admin_name}\', '
        f'external_id: UUID(\'{external_id}\'), '
        f'site_id: \'{site_id}\', '
        f'qos_rate_max_up: {velocidade_kbps}, '
        f'qos_rate_max_down: {velocidade_kbps}, '
        f'qos_overwrite: true'
        f'}}); print(code);"'
    )
    return cmd
# ===============================
# SCRIPT PRINCIPAL COM LOOP
# ===============================
def processar_vouchers():
    try:
        registros = buscar_vouchers_supabase()
        if not registros:
            log("Nenhum voucher pendente no Supabase.")
        else:
            for reg in registros:
                tempo_desc = reg.get("tempo_desc", "")
                is_free = tempo_desc.lower() == "ilimitado"
                if is_free:
                    tempo = 0  # duration=0 no UniFi = sem expiração
                else:
                    tempo_minutos = converter_tempo_para_minutos(tempo_desc)
                    tempo = tempo_minutos if tempo_minutos > 0 else 60
                cliente_uid = reg.get("cliente_id", "")
                nome_formatado = buscar_cliente_nome_formatado(cliente_uid)
                quota = reg.get(COL_QTD, QUOTA_KB)
                velocidade_kbps = VELOCIDADE_FREE_KBPS if is_free else VELOCIDADE_PAGO_KBPS
                log(f"Criando voucher para {nome_formatado} | {'ilimitado' if is_free else f'{tempo} min'} | {velocidade_kbps} Kbps...")
                cmd = gerar_codigo_formatado(tempo, quota, nome_formatado, velocidade_kbps)
                result = subprocess.check_output(cmd, shell=True).decode().strip()
                codigo = result if result else None
                if not codigo:
                    log("❌ Não foi possível capturar o código do voucher.")
                    continue
                if is_free:
                    data_expiracao = None  # sem expiração
                else:
                    exp_time = datetime.datetime.now() + datetime.timedelta(minutes=tempo)
                    data_expiracao = exp_time.strftime("%Y-%m-%d %H:%M:%S")
                atualizar_voucher_supabase(reg["id"], codigo, data_expiracao, quota)
                log(f"✅ Voucher criado: {codigo} | {'Sem expiração' if is_free else f'Expira em: {data_expiracao}'}")
    except Exception as e:
        log(f"❌ Erro: {e}")

# ===============================
# AUTORIZAÇÕES DE MAC
# ===============================
def buscar_autorizacoes_pendentes():
    path = f"/rest/v1/autorizacoes?{urllib.parse.urlencode({'select': '*', 'status': 'eq.pendente'})}"
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    conn.request("GET", path, headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    conn.close()

    if res.status != 200:
        raise Exception(f"Erro Supabase GET autorizacoes: {res.status} - {data}")
    return json.loads(data)


def atualizar_autorizacao_status(id_reg, status, detalhe=None):
    path = f"/rest/v1/autorizacoes?id=eq.{id_reg}"
    payload_dict = {"status": status}

    # Se no futuro você criar uma coluna "erro" ou "detalhe" no Supabase,
    # pode habilitar uma dessas linhas. Por enquanto não envio detalhe para evitar erro de coluna inexistente.
    # if detalhe:
    #     payload_dict["detalhe"] = str(detalhe)[:500]

    payload = json.dumps(payload_dict).encode()
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    conn.request(
        "PATCH",
        path,
        body=payload,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
    )
    res = conn.getresponse()
    data = res.read().decode()
    conn.close()

    if res.status not in (200, 204):
        raise Exception(f"Erro Supabase PATCH autorizacoes: {res.status} - {data}")


def _normalizar_mac(mac):
    """Normaliza MAC para o formato AA:BB:CC:DD:EE:FF."""
    if not mac:
        raise ValueError("MAC vazio")

    raw = re.sub(r"[^0-9a-fA-F]", "", str(mac)).lower()
    if len(raw) != 12:
        raise ValueError(f"MAC inválido: {mac}")

    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


def _headers_unifi(auth_mode, json_body=False):
    if not UNIFI_API_KEY:
        raise Exception("UNIFI_API_KEY não configurada")

    headers = {
        "Accept": "application/json",
    }

    if auth_mode == "bearer":
        headers["Authorization"] = f"Bearer {UNIFI_API_KEY}"
    else:
        headers["X-API-KEY"] = UNIFI_API_KEY

    if json_body:
        headers["Content-Type"] = "application/json"

    return headers


def _request_unifi(prefix, auth_mode, method, api_path, payload=None):
    """
    Chama a API nova de integração do UniFi Network.
    api_path deve começar com /v1/...
    """
    ctx = ssl._create_unverified_context()
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()

    full_path = f"{prefix}{api_path}"
    conn = http.client.HTTPSConnection(UNIFI_HOST, UNIFI_PORT, context=ctx, timeout=20)
    conn.request(method, full_path, body=body, headers=_headers_unifi(auth_mode, json_body=payload is not None))
    res = conn.getresponse()
    data = res.read().decode()
    status = res.status
    conn.close()

    if status not in (200, 201, 202, 204):
        raise Exception(f"UniFi API HTTP {status} em {method} {full_path}: {data}")

    if not data:
        return None

    try:
        return json.loads(data)
    except Exception:
        return data


def unifi_api(method, api_path, payload=None):
    """
    Usa o prefixo/auth que já funcionou. Se ainda não souber, testa as combinações.
    """
    global _unifi_prefix_ok, _unifi_auth_mode_ok

    if _unifi_prefix_ok is not None and _unifi_auth_mode_ok is not None:
        return _request_unifi(_unifi_prefix_ok, _unifi_auth_mode_ok, method, api_path, payload)

    erros = []
    for prefix in UNIFI_API_PREFIXES:
        for auth_mode in UNIFI_AUTH_MODES:
            try:
                result = _request_unifi(prefix, auth_mode, method, api_path, payload)
                _unifi_prefix_ok = prefix
                _unifi_auth_mode_ok = auth_mode
                log(f"✅ UniFi API conectada usando prefixo='{prefix or '/'}' auth='{auth_mode}'")
                return result
            except Exception as exc:
                erros.append(str(exc))

    raise Exception("Não consegui conectar na UniFi API com a API Key. Tentativas: " + " | ".join(erros))


def obter_unifi_site_id():
    """Busca e guarda o primeiro siteId da Cloud Gateway/UDM."""
    global _unifi_site_id_cache

    if _unifi_site_id_cache:
        return _unifi_site_id_cache

    sites = unifi_api("GET", "/v1/sites")
    if not sites:
        raise Exception("A UniFi API não retornou nenhum site")

    if isinstance(sites, dict) and "data" in sites:
        sites = sites["data"]
    site = sites[0] if isinstance(sites, list) else sites
    site_id = site.get("id") or site.get("siteId")
    if not site_id:
        raise Exception(f"Não encontrei id do site na resposta: {sites}")

    _unifi_site_id_cache = site_id
    log(f"✅ UniFi siteId detectado: {site_id}")
    return site_id


def buscar_unifi_client_id_por_mac(mac):
    """Busca o clientId na API nova usando o MAC address."""
    site_id = obter_unifi_site_id()
    mac_norm = _normalizar_mac(mac)

    # Conforme documentação: filter=macAddress.eq('AA:AA:AA:AA:AA:AA')
    query = urllib.parse.urlencode({"filter": f"macAddress.eq('{mac_norm}')"})
    clientes = unifi_api("GET", f"/v1/sites/{site_id}/clients?{query}")

    if isinstance(clientes, dict):
        # Algumas APIs retornam {data: [...]} ou formato semelhante.
        clientes = clientes.get("data") or clientes.get("items") or clientes.get("results") or [clientes]

    if not clientes:
        raise Exception(f"Cliente não encontrado na UniFi API para MAC {mac_norm}. O aparelho precisa estar conectado ao Wi-Fi/hotspot.")

    cliente = clientes[0]
    client_id = cliente.get("id") or cliente.get("clientId")
    if not client_id:
        raise Exception(f"Cliente encontrado, mas sem clientId/id: {cliente}")

    return site_id, client_id, mac_norm


def autorizar_mac_unifi(mac, minutos):
    """
    Autoriza cliente guest pela API Key nova, sem login/senha e sem 2FA.
    """
    site_id, client_id, mac_norm = buscar_unifi_client_id_por_mac(mac)

    payload = {
        "action": "AUTHORIZE_GUEST_ACCESS",
        "timeLimitMinutes": int(minutos),
    }

    return unifi_api("POST", f"/v1/sites/{site_id}/clients/{client_id}/actions", payload)


def processar_autorizacoes():
    try:
        registros = buscar_autorizacoes_pendentes()
        if not registros:
            log("Sem autorizações pendentes.")
            return

        for reg in registros:
            rid = reg["id"]
            mac = reg["mac_address"]
            minutos = int(reg.get("minutos", 60))

            try:
                autorizar_mac_unifi(mac, minutos)
                atualizar_autorizacao_status(rid, "autorizado")
                log(f"✅ MAC autorizado: {mac} | {minutos} min")
            except Exception as exc:
                atualizar_autorizacao_status(rid, "erro")
                log(f"❌ Erro ao autorizar MAC {mac}: {exc}")

    except Exception as e:
        log(f"❌ Erro em processar_autorizacoes: {e}")

# ===============================
# REVOGAÇÃO DE AUTORIZAÇÕES
# ===============================
def buscar_autorizacoes_revogadas():
    path = f"/rest/v1/autorizacoes?{urllib.parse.urlencode({'select': '*', 'status': 'eq.revogado'})}"
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ssl._create_unverified_context())
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    conn.request("GET", path, headers=headers)
    res = conn.getresponse()
    data = res.read().decode()
    conn.close()
    if res.status != 200:
        raise Exception(f"Erro Supabase GET revogadas: {res.status} - {data}")
    return json.loads(data)


def kick_mac_unifi(mac):
    site_id, client_id, mac_norm = buscar_unifi_client_id_por_mac(mac)
    payload = {"action": "BLOCK"}
    unifi_api("POST", f"/v1/sites/{site_id}/clients/{client_id}/actions", payload)
    payload_unblock = {"action": "UNBLOCK"}
    unifi_api("POST", f"/v1/sites/{site_id}/clients/{client_id}/actions", payload_unblock)


def processar_revogacoes():
    try:
        registros = buscar_autorizacoes_revogadas()
        if not registros:
            return
        for reg in registros:
            rid = reg["id"]
            mac = reg["mac_address"]
            try:
                kick_mac_unifi(mac)
                atualizar_autorizacao_status(rid, "kick_ok")
                log(f"✅ MAC revogado/kick: {mac}")
            except Exception as exc:
                atualizar_autorizacao_status(rid, "kick_erro")
                log(f"❌ Erro ao revogar MAC {mac}: {exc}")
    except Exception as e:
        log(f"❌ Erro em processar_revogacoes: {e}")

# ===============================
# SERVIDOR DE REDIRECIONAMENTO
# ===============================
def get_mac_from_ip(client_ip):
    try:
        result = subprocess.run(
            ['ip', 'neigh', 'show', client_ip],
            capture_output=True, text=True, timeout=2
        )
        for line in result.stdout.strip().split('\n'):
            if client_ip in line and 'lladdr' in line:
                parts = line.split()
                idx = parts.index('lladdr')
                return parts[idx + 1]
    except Exception:
        pass
    return None

class PortalRedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        mac = params.get('id', [None])[0]
        original_url = params.get('url', [None])[0]

        if not mac:
            client_ip = self.client_address[0]
            mac = get_mac_from_ip(client_ip)
            host = self.headers.get('Host', '')
            if host:
                original_url = f"http://{host}{self.path}"

        query_params = {}
        if mac:
            query_params['id'] = mac
        if original_url:
            query_params['url'] = original_url

        if query_params:
            destino = f"{PORTAL_EXTERNO_URL}/hotspot?{urllib.parse.urlencode(query_params)}"
        else:
            destino = f"{PORTAL_EXTERNO_URL}/hotspot"

        self.send_response(302)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, format, *args):
        log(f"[redirect] {self.client_address[0]} → {args[0] if args else ''}")


def iniciar_servidor_redirect():
    try:
        servidor = HTTPServer(("0.0.0.0", PORTAL_REDIRECT_PORT), PortalRedirectHandler)
        log(f"✅ Servidor de redirecionamento ativo na porta {PORTAL_REDIRECT_PORT}")
        servidor.serve_forever()
    except OSError as e:
        log(f"❌ Não foi possível iniciar o servidor de redirecionamento: {e}")


# ===============================
# WALLED GARDEN VIA IPTABLES
# ===============================
import socket

_walled_garden_last_run = 0

def _resolver_dominios(dominios):
    ips = set()
    for dominio in dominios:
        try:
            for info in socket.getaddrinfo(dominio, None, socket.AF_INET):
                ips.add(info[4][0])
        except Exception:
            pass
    return ips

def _ipset_disponivel():
    try:
        subprocess.run(["ipset", "version"], capture_output=True, timeout=5)
        return True
    except Exception:
        return False

def aplicar_walled_garden():
    global _walled_garden_last_run
    agora = time.time()
    if agora - _walled_garden_last_run < WALLED_GARDEN_REFRESH_SECONDS:
        return
    _walled_garden_last_run = agora

    ips = _resolver_dominios(WALLED_GARDEN_DOMAINS)
    if not ips:
        log("⚠️ Walled garden: nenhum IP resolvido")
        return

    try:
        if _ipset_disponivel():
            _aplicar_com_ipset(ips)
        else:
            _aplicar_com_iptables(ips)
        log(f"✅ Walled garden: {len(ips)} IPs de {len(WALLED_GARDEN_DOMAINS)} domínios")
    except Exception as e:
        log(f"❌ Erro walled garden: {e}")

def _garantir_regra_no_topo(regra_args):
    """Remove a regra de qualquer posição e reinsere na posição 1 do FORWARD."""
    subprocess.run(["iptables", "-D", "FORWARD"] + regra_args, capture_output=True)
    subprocess.run(["iptables", "-I", "FORWARD", "1"] + regra_args, check=True)

def _aplicar_com_ipset(ips):
    nome = WALLED_GARDEN_IPSET
    subprocess.run(["ipset", "create", nome, "hash:ip", "-exist"],
                    capture_output=True, check=True)

    nome_tmp = nome + "_tmp"
    subprocess.run(["ipset", "create", nome_tmp, "hash:ip", "-exist"],
                    capture_output=True, check=True)
    subprocess.run(["ipset", "flush", nome_tmp], capture_output=True, check=True)

    for ip in ips:
        subprocess.run(["ipset", "add", nome_tmp, ip, "-exist"], capture_output=True)

    subprocess.run(["ipset", "swap", nome_tmp, nome], capture_output=True, check=True)
    subprocess.run(["ipset", "destroy", nome_tmp], capture_output=True)

    regra = ["-m", "set", "--match-set", nome, "dst",
             "-p", "tcp", "-m", "multiport", "--dports", "80,443", "-j", "ACCEPT"]
    _garantir_regra_no_topo(regra)

def _aplicar_com_iptables(ips):
    chain = "WALLED_GARDEN"
    subprocess.run(["iptables", "-N", chain], capture_output=True)
    subprocess.run(["iptables", "-F", chain], capture_output=True, check=True)

    for ip in ips:
        subprocess.run(
            ["iptables", "-A", chain, "-d", ip,
             "-p", "tcp", "-m", "multiport", "--dports", "80,443", "-j", "ACCEPT"],
            capture_output=True,
        )

    _garantir_regra_no_topo(["-j", chain])


def garantir_redirect_porta_80():
    """Garante iptables NAT redirect 80→8881 para clientes guest."""
    regra = ["-i", GUEST_INTERFACE, "-p", "tcp", "--dport", "80",
             "-d", GUEST_GATEWAY_IP, "-j", "REDIRECT", "--to-port", str(PORTAL_REDIRECT_PORT)]
    check = subprocess.run(["iptables", "-t", "nat", "-C", "PREROUTING"] + regra, capture_output=True)
    if check.returncode != 0:
        subprocess.run(["iptables", "-t", "nat", "-I", "PREROUTING", "1"] + regra, capture_output=True)
        log(f"✅ Redirect porta 80→{PORTAL_REDIRECT_PORT} aplicado")


# Loop infinito para rodar a cada 20 segundos
if __name__ == "__main__":
    threading.Thread(target=iniciar_servidor_redirect, daemon=True).start()
    garantir_redirect_porta_80()
    aplicar_walled_garden()
    while True:
        processar_vouchers()
        processar_autorizacoes()
        processar_revogacoes()
        garantir_redirect_porta_80()
        aplicar_walled_garden()
        time.sleep(20)
