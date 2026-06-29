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
import random
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
VELOCIDADE_FREE_KBPS = 123     # 123 Kbps — plano gratuito

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
    # NÃO incluir domínios de captive portal detection aqui!
    # (connectivitycheck.gstatic.com, captive.apple.com, msftconnecttest.com, etc.)
    # Eles precisam ser INTERCEPTADOS pelo redirect para o popup aparecer.
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
                is_ilimitado = tempo_desc.lower() == "ilimitado"
                if is_ilimitado:
                    tempo = 0  # duration=0 no UniFi = sem expiração
                else:
                    tempo_minutos = converter_tempo_para_minutos(tempo_desc)
                    tempo = tempo_minutos if tempo_minutos > 0 else 60
                cliente_uid = reg.get("cliente_id", "")
                is_free = is_ilimitado and cliente_uid == GUEST_USER_ID
                nome_formatado = buscar_cliente_nome_formatado(cliente_uid)
                quota = reg.get(COL_QTD, QUOTA_KB)
                velocidade_kbps = VELOCIDADE_FREE_KBPS if is_free else VELOCIDADE_PAGO_KBPS
                log(f"Criando voucher para {nome_formatado} | {'ilimitado' if is_ilimitado else f'{tempo} min'} | {velocidade_kbps} Kbps | {'free' if is_free else 'premium'}...")
                cmd = gerar_codigo_formatado(tempo, quota, nome_formatado, velocidade_kbps)
                result = subprocess.check_output(cmd, shell=True).decode().strip()
                codigo = result if result else None
                if not codigo:
                    log("❌ Não foi possível capturar o código do voucher.")
                    continue
                if is_ilimitado:
                    data_expiracao = None  # sem expiração
                else:
                    exp_time = datetime.datetime.now() + datetime.timedelta(minutes=tempo)
                    data_expiracao = exp_time.strftime("%Y-%m-%d %H:%M:%S")
                atualizar_voucher_supabase(reg["id"], codigo, data_expiracao, quota)
                log(f"✅ Voucher criado: {codigo} | {'Sem expiração' if is_ilimitado else f'Expira em: {data_expiracao}'}")
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


def _garantir_guest_record(mac_norm):
    """Cria guest expirado no MongoDB se não existir — nunca remove registros existentes."""
    check = subprocess.run(
        ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
         f'db.guest.find({{"mac": "{mac_norm}"}}).count()'],
        capture_output=True, text=True, timeout=5
    )
    if check.returncode == 0 and check.stdout.strip() == "0":
        subprocess.run(
            ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
             f'db.guest.insert({{"mac": "{mac_norm}", "authorized_by": "api", "start": NumberLong(1), "end": NumberLong(1), "site_id": "6834b054b243651f00c8dcc5"}})'],
            capture_output=True, text=True, timeout=5
        )
        log(f"✅ Guest record criado para {mac_norm}")


GUEST_USER_ID = os.environ.get("GUEST_USER_ID", "5b0e3ee1-a588-460e-8572-2c658f52fde2")


def _autorizar_via_mongo(mac_norm, minutos, velocidade_kbps=None):
    """Autoriza guest direto no MongoDB — funciona para MACs privados não visíveis na API."""
    agora = int(time.time())
    fim = agora + int(minutos) * 60
    qos_fields = ""
    if velocidade_kbps:
        qos_fields = f', "qos_rate_max_up": {velocidade_kbps}, "qos_rate_max_down": {velocidade_kbps}, "qos_overwrite": true'
    result = subprocess.run(
        ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
         f'db.guest.update({{"mac": "{mac_norm}"}}, {{"$set": {{"mac": "{mac_norm}", "authorized_by": "api", "start": NumberLong({agora}), "end": NumberLong({fim}), "site_id": "6834b054b243651f00c8dcc5"{qos_fields}}}}}, {{"upsert": true}})'],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode != 0:
        raise Exception(f"MongoDB falhou: {result.stderr}")
    label = f"{velocidade_kbps} Kbps" if velocidade_kbps else "sem limite"
    log(f"✅ Autorizado via MongoDB: {mac_norm} por {minutos} min ({label})")


def _aplicar_qos_mongo(mac_norm, velocidade_kbps):
    """Aplica QoS no guest record após autorização via API."""
    subprocess.run(
        ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
         f'db.guest.update({{"mac": "{mac_norm}"}}, {{"$set": {{"qos_rate_max_up": {velocidade_kbps}, "qos_rate_max_down": {velocidade_kbps}, "qos_overwrite": true}}}})'],
        capture_output=True, text=True, timeout=5
    )


def _adicionar_bypass_mac(mac_norm):
    """Bypass do redirect captive portal para MACs autorizados."""
    regra = ["-m", "mac", "--mac-source", mac_norm, "-j", "RETURN"]
    check = subprocess.run(["iptables", "-t", "nat", "-C", "PREROUTING"] + regra, capture_output=True)
    if check.returncode != 0:
        subprocess.run(["iptables", "-t", "nat", "-I", "PREROUTING", "1"] + regra, capture_output=True)
        log(f"✅ Bypass redirect adicionado para {mac_norm}")


def _limpar_bypass_expirados():
    """Remove bypass rules de MACs cuja autorização expirou."""
    result = subprocess.run(
        ["iptables", "-t", "nat", "-S", "PREROUTING"],
        capture_output=True, text=True, timeout=5
    )
    if result.returncode != 0:
        return
    now = int(time.time())
    for line in result.stdout.strip().split('\n'):
        match = re.search(r'--mac-source\s+([0-9a-fA-F:]+)\s+-j\s+RETURN', line)
        if not match:
            continue
        mac = match.group(1).lower()
        check = subprocess.run(
            ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
             f'db.guest.find({{"mac": "{mac}", "end": {{"$gt": NumberLong({now})}}}}).count()'],
            capture_output=True, text=True, timeout=5
        )
        if check.returncode == 0 and check.stdout.strip() == "0":
            subprocess.run(
                ["iptables", "-t", "nat", "-D", "PREROUTING",
                 "-m", "mac", "--mac-source", mac, "-j", "RETURN"],
                capture_output=True
            )
            log(f"🧹 Bypass expirado removido: {mac}")


def autorizar_mac_unifi(mac, minutos, is_free=False):
    """Autoriza guest via API de integração, com fallback para MongoDB."""
    mac_norm = _normalizar_mac(mac).lower()
    velocidade = VELOCIDADE_FREE_KBPS if is_free else None
    _garantir_guest_record(mac_norm)
    # Tentar API de integração
    try:
        site_id, client_id, _ = buscar_unifi_client_id_por_mac(mac)
        payload = {
            "action": "AUTHORIZE_GUEST_ACCESS",
            "timeLimitMinutes": int(minutos),
        }
        result = unifi_api("POST", f"/v1/sites/{site_id}/clients/{client_id}/actions", payload)
        if velocidade:
            _aplicar_qos_mongo(mac_norm, velocidade)
            log(f"✅ QoS aplicado: {mac_norm} → {velocidade} Kbps")
        return result
    except Exception as e:
        log(f"⚠️ API falhou ({e}), autorizando via MongoDB...")
    # Fallback: MongoDB direto (com QoS se free)
    _autorizar_via_mongo(mac_norm, minutos, velocidade)


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
            is_free = reg.get("cliente_id") == GUEST_USER_ID

            try:
                autorizar_mac_unifi(mac, minutos, is_free=is_free)
                atualizar_autorizacao_status(rid, "autorizado")
                log(f"✅ MAC autorizado: {mac} | {minutos} min | {'free' if is_free else 'premium'}")
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
    mac_norm = _normalizar_mac(mac).lower()
    # Remover regra iptables de bypass (se existir)
    subprocess.run(["iptables", "-t", "nat", "-D", "PREROUTING",
                    "-m", "mac", "--mac-source", mac_norm, "-j", "RETURN"],
                   capture_output=True)
    # 1) Desautorizar via API de integração (atualiza firewall do UniFi)
    try:
        site_id, client_id, _ = buscar_unifi_client_id_por_mac(mac)
        unifi_api("POST", f"/v1/sites/{site_id}/clients/{client_id}/actions",
                  {"action": "UNAUTHORIZE_GUEST_ACCESS"})
        log(f"✅ Kick API OK (UNAUTHORIZE_GUEST_ACCESS) para {mac_norm}")
    except Exception as e:
        log(f"⚠️ Kick API falhou ({e})")
    # 2) Remover do MongoDB (desconecta de verdade)
    subprocess.run(
        ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
         f'db.guest.remove({{"mac": "{mac_norm}"}})'],
        capture_output=True, text=True, timeout=5
    )


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

_mac_auth_cache = {}
_MAC_CACHE_TTL = 30


def _is_mac_authorized(mac_norm):
    now = time.time()
    cached = _mac_auth_cache.get(mac_norm)
    if cached and now - cached[1] < _MAC_CACHE_TTL:
        return cached[0]
    agora = int(now)
    try:
        result = subprocess.run(
            ["mongo", "--port", "27117", "ace", "--quiet", "--eval",
             f'db.guest.find({{"mac": "{mac_norm}", "end": {{"$gt": NumberLong({agora})}}}}).count()'],
            capture_output=True, text=True, timeout=3
        )
        authorized = result.returncode == 0 and result.stdout.strip() != "0"
    except Exception:
        authorized = False
    _mac_auth_cache[mac_norm] = (authorized, now)
    return authorized


# ===============================
# DETECÇÃO DE TV E PIN
# ===============================
_TV_KEYWORDS = [
    'smarttv', 'smart-tv', 'tizen', 'webos', 'web0s', 'netcast',
    'roku', 'appletv', 'bravia', 'androidtv', 'chromecast', 'crkey',
    'aftm', 'afts', 'aftt', 'aftb', 'aftmm',
    'vizio', 'hbbtv', 'philipstv', 'nettv',
    'playstation', 'xbox', 'nintendo', 'lg browser',
]

_tv_pin_cache = {}
_TV_PIN_TTL = 600


def _is_tv(user_agent):
    if not user_agent:
        return False
    ua = user_agent.lower()
    return any(kw in ua for kw in _TV_KEYWORDS)


def _generate_tv_pin():
    return str(random.randint(100000, 999999))


def _store_tv_pin(pin, mac):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    ctx = ssl._create_unverified_context()
    delete_path = f"/rest/v1/tv_pins?mac_address=eq.{urllib.parse.quote(mac)}"
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ctx)
    conn.request("DELETE", delete_path, headers=headers)
    conn.getresponse().read()
    conn.close()

    insert_path = "/rest/v1/tv_pins"
    payload = json.dumps({"pin": pin, "mac_address": mac})
    conn = http.client.HTTPSConnection(SUPABASE_URL, 443, context=ctx)
    conn.request("POST", insert_path, body=payload, headers=headers)
    conn.getresponse().read()
    conn.close()


def _get_or_create_tv_pin(mac_norm):
    now = time.time()
    cached = _tv_pin_cache.get(mac_norm)
    if cached and now - cached[1] < _TV_PIN_TTL:
        return cached[0]
    pin = _generate_tv_pin()
    _tv_pin_cache[mac_norm] = (pin, now)
    try:
        _store_tv_pin(pin, mac_norm)
        log(f"📺 TV PIN gerado: {mac_norm} → {pin}")
    except Exception as e:
        log(f"⚠️ Erro ao salvar TV PIN: {e}")
    return pin


_TV_PIN_HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Conectar TV — JOCUM AT</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:48px}
.card{max-width:520px;text-align:center}
.title{font-size:1.6rem;font-weight:700;margin-bottom:6px}
.subtitle{font-size:0.95rem;color:#a1a1aa;margin-bottom:32px}
.pin-label{font-size:0.9rem;color:#71717a;margin-bottom:10px}
.pin{font-size:3.5rem;font-weight:800;letter-spacing:0.2em;color:#ef700b;margin-bottom:36px;font-family:'Courier New',monospace}
.divider{border:none;border-top:1px solid rgba(255,255,255,0.08);margin-bottom:28px}
.steps{text-align:left;margin:0 auto;max-width:440px}
.step{display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;font-size:1.05rem;color:#d4d4d8;line-height:1.4}
.step-num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#ef700b;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem}
.step strong{color:#fff}
.footer{margin-top:32px;color:#3f3f46;font-size:0.8rem}
.spinner{display:inline-block;width:12px;height:12px;border:2px solid #3f3f46;border-top-color:#ef700b;border-radius:50%;animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
<p class="title">Conectar TV ao Wi-Fi</p>
<p class="subtitle">JOCUM Almirante Tamandaré</p>
<p class="pin-label">Digite este código no celular:</p>
<p class="pin">{{PIN}}</p>
<hr class="divider">
<div class="steps">
<div class="step"><span class="step-num">1</span><span>No celular, conecte ao Wi-Fi <strong>.UofN JOCUM AT</strong></span></div>
<div class="step"><span class="step-num">2</span><span>Acesse <strong>wifi-manager-react.vercel.app</strong> e faça login</span></div>
<div class="step"><span class="step-num">3</span><span>Na tela inicial, toque em <strong>Conectar TV</strong></span></div>
<div class="step"><span class="step-num">4</span><span>Digite o código acima e confirme</span></div>
</div>
<p class="footer"><span class="spinner"></span>Aguardando confirmação… não feche esta tela</p>
</div>
</body>
</html>"""


_TV_CONNECTED_HTML = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TV Conectada — JOCUM AT</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:48px}
.card{max-width:480px;text-align:center}
.check{width:72px;height:72px;border-radius:50%;border:3px solid #4ade80;color:#4ade80;display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin:0 auto 24px}
.title{font-size:1.8rem;font-weight:700;margin-bottom:8px}
.subtitle{font-size:1.05rem;color:#a1a1aa;line-height:1.5}
</style>
</head>
<body>
<div class="card">
<div class="check">✓</div>
<p class="title">TV Conectada!</p>
<p class="subtitle">Pode fechar esta tela e usar seus apps normalmente.</p>
</div>
</body>
</html>"""


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

        user_agent = self.headers.get('User-Agent', '')

        # MAC autorizado → responder "internet ok" para captive portal detection
        if mac:
            mac_norm = _normalizar_mac(mac).lower()
            if _is_mac_authorized(mac_norm):
                if _is_tv(user_agent):
                    body = _TV_CONNECTED_HTML.encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                elif '/generate_204' in self.path:
                    self.send_response(204)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                elif '/connecttest.txt' in self.path:
                    body = b"Microsoft Connect Test"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                elif '/ncsi.txt' in self.path:
                    body = b"Microsoft NCSI"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    body = b"<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                return

        # TV não autorizada → página com PIN para o usuário autorizar pelo celular
        if mac and _is_tv(user_agent):
            mac_norm = _normalizar_mac(mac).lower()
            pin = _get_or_create_tv_pin(mac_norm)
            formatted_pin = f"{pin[:3]}  {pin[3:]}"
            body = _TV_PIN_HTML.replace('{{PIN}}', formatted_pin).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

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


from socketserver import ThreadingMixIn

class ReusableHTTPServer(ThreadingMixIn, HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

def iniciar_servidor_redirect():
    for tentativa in range(5):
        try:
            servidor = ReusableHTTPServer(("0.0.0.0", PORTAL_REDIRECT_PORT), PortalRedirectHandler)
            log(f"✅ Servidor de redirecionamento ativo na porta {PORTAL_REDIRECT_PORT}")
            servidor.serve_forever()
        except OSError as e:
            log(f"⚠️ Porta {PORTAL_REDIRECT_PORT} ocupada (tentativa {tentativa+1}/5): {e}")
            time.sleep(3)
    log(f"❌ Não foi possível iniciar o servidor de redirecionamento após 5 tentativas")


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
    """Redireciona TODO tráfego HTTP (porta 80) de guests para o portal captive.

    Regras inseridas ANTES de UBIOS_PREROUTING_JUMP para que a UDM
    não intercepte o tráfego de captive portal detection antes de nós.

    Ordem no PREROUTING:
      1. MAC bypass (RETURN) — adicionados por _adicionar_bypass_mac()
      2. Walled garden IPs (RETURN) — portal/assets precisam carregar
      3. Redirect tudo restante → porta 8881
      4. UBIOS_PREROUTING_JUMP — regras nativas da UDM
    """
    # Remover regra antiga (só gateway IP) se existir
    regra_antiga = ["-i", GUEST_INTERFACE, "-p", "tcp", "--dport", "80",
                    "-d", GUEST_GATEWAY_IP, "-j", "REDIRECT", "--to-port", str(PORTAL_REDIRECT_PORT)]
    subprocess.run(["iptables", "-t", "nat", "-D", "PREROUTING"] + regra_antiga, capture_output=True)

    regra_redirect = ["-i", GUEST_INTERFACE, "-p", "tcp", "--dport", "80",
                      "-j", "REDIRECT", "--to-port", str(PORTAL_REDIRECT_PORT)]
    regra_wg = (["-i", GUEST_INTERFACE, "-p", "tcp", "--dport", "80",
                 "-m", "set", "--match-set", WALLED_GARDEN_IPSET, "dst", "-j", "RETURN"]
                if _ipset_disponivel() else None)

    # Só inserir se não existirem (preserva posição dos MAC bypass acima)
    check_redir = subprocess.run(["iptables", "-t", "nat", "-C", "PREROUTING"] + regra_redirect, capture_output=True)
    if check_redir.returncode != 0:
        subprocess.run(["iptables", "-t", "nat", "-I", "PREROUTING", "1"] + regra_redirect, capture_output=True)
        log(f"✅ Redirect porta 80→{PORTAL_REDIRECT_PORT} inserido antes de UBIOS")

    if regra_wg:
        check_wg = subprocess.run(["iptables", "-t", "nat", "-C", "PREROUTING"] + regra_wg, capture_output=True)
        if check_wg.returncode != 0:
            subprocess.run(["iptables", "-t", "nat", "-I", "PREROUTING", "1"] + regra_wg, capture_output=True)
            log(f"✅ Exceção walled garden inserida antes do redirect")

    # Garantir que guests conseguem acessar a porta do redirect
    regra_input = ["-i", GUEST_INTERFACE, "-p", "tcp", "--dport", str(PORTAL_REDIRECT_PORT), "-j", "ACCEPT"]
    check = subprocess.run(["iptables", "-C", "INPUT"] + regra_input, capture_output=True)
    if check.returncode != 0:
        subprocess.run(["iptables", "-I", "INPUT", "1"] + regra_input, capture_output=True)
        log(f"✅ INPUT ACCEPT porta {PORTAL_REDIRECT_PORT} para guests")


# Loop principal — autorizações/revogações a cada 5s, tarefas pesadas a cada 60s
if __name__ == "__main__":
    threading.Thread(target=iniciar_servidor_redirect, daemon=True).start()
    time.sleep(2)
    aplicar_walled_garden()
    garantir_redirect_porta_80()
    _ciclo = 0
    while True:
        processar_autorizacoes()
        processar_revogacoes()
        if _ciclo % 12 == 0:
            processar_vouchers()
            aplicar_walled_garden()
            garantir_redirect_porta_80()
            _limpar_bypass_expirados()
        _ciclo += 1
        time.sleep(5)
