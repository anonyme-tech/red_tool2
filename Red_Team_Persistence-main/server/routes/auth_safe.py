"""
Authentication and registration routes for the defensive listener lab.
"""
import os
import sys
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response, status

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from middleware.auth import api_key_manager, jwt_manager
from models import RegisterAgentRequest, RegisterAgentResponse
from modules.listener_runtime import listener_manager


router = APIRouter(prefix="/api/auth", tags=["authentication"])
OPERATOR_SESSION_COOKIE = "lab_session"


def _operator_credentials() -> tuple[str, str]:
    """Retourne les identifiants par défaut de l'opérateur."""
    username = (os.environ.get("LAB_ADMIN_USER") or "admin").strip()
    password = os.environ.get("LAB_ADMIN_PASS") or "hamzamoussa"
    return username, password


def _build_agent_id(request: RegisterAgentRequest) -> str:
    """Construit un ID d'agent unique."""
    hostname = (request.hostname or "sim-host").strip().replace(" ", "_")
    username = (request.username or "user").strip().replace(" ", "_")
    return f"sim_{hostname}_{username}_{request.process_id}"


@router.post("/register", response_model=RegisterAgentResponse)
async def register_agent(request: RegisterAgentRequest):
    """Enregistre un nouvel agent auprès du serveur C2."""
    listener = listener_manager.get_listener(request.listener_id)
    if not listener:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listener not found")
    if listener.get("status") != "online":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Listener is offline")

    payload = {
        "agent_id": _build_agent_id(request),
        "listener_id": request.listener_id,
        "hostname": request.hostname,
        "username": request.username,
        "process_id": request.process_id,
        "system_info": request.system_info.model_dump(),
        "agent_version": request.agent_version,
        "privileges": request.privileges,
        "operating_system": request.operating_system,
        "event_type": "registration",
        "signal": "registration",
    }
    ack = listener_manager.register_simulated_agent(request.listener_id, payload)
    jitter = float((listener.get("config", {}).get("beacon_config", {}) or {}).get("jitter", 0.0))
    return RegisterAgentResponse(
        agent_id=ack["agent_id"],
        status="registered",
        sleep_interval=int(listener.get("beacon_interval", 5)),
        jitter=jitter,
    )


# ============================================================
# LOGIN ENDPOINT - CORRIGÉ
# ============================================================

@router.post("/login")
async def login(request: Request):
    """
    Authentifie un opérateur avec username et password.
    Retourne un token JWT.
    """
    try:
        body = await request.json()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Invalid JSON body"
        )
    
    expected_user, expected_pass = _operator_credentials()
    
    if username == expected_user and password == expected_pass:
        token = jwt_manager.create_token("op_1", username)
        return {
            "access_token": token,
            "token_type": "bearer",
            "operator_id": "op_1",
            "mode": "defensive-simulation",
            "username": username
        }
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, 
        detail="Invalid credentials"
    )


@router.post("/operator/login")
async def operator_login(request: Request):
    """
    Authentifie un opérateur et stocke le token dans un cookie.
    """
    try:
        payload = await request.json()
        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Invalid JSON body"
        )
    
    expected_user, expected_pass = _operator_credentials()
    if username != expected_user or password != expected_pass:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid credentials"
        )

    token = jwt_manager.create_token("op_1", username)
    response = Response(content='{"status":"ok"}', media_type="application/json")
    response.set_cookie(
        OPERATOR_SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
        max_age=60 * 60 * 24,  # 24 heures
    )
    return response


@router.post("/operator/logout")
async def operator_logout():
    """Déconnecte l'opérateur en supprimant le cookie."""
    response = Response(content='{"status":"ok"}', media_type="application/json")
    response.delete_cookie(OPERATOR_SESSION_COOKIE, path="/")
    return response


@router.get("/operator/me")
async def operator_me(request: Request):
    """Retourne les informations de l'opérateur connecté."""
    token = request.cookies.get(OPERATOR_SESSION_COOKIE) or ""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Not authenticated"
        )
    payload = jwt_manager.verify_token(token)
    return {
        "authenticated": True,
        "operator_id": payload.get("operator_id"),
        "username": payload.get("username"),
    }


@router.get("/verify")
async def verify_token(authorization: Optional[str] = Header(None)):
    """Vérifie la validité d'un token JWT."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header",
        )

    token = authorization.replace("Bearer ", "")
    payload = jwt_manager.verify_token(token)
    return {
        "valid": True,
        "operator_id": payload.get("operator_id"),
        "username": payload.get("username"),
    }


@router.post("/agent/verify")
async def verify_agent_key(api_key: str):
    """Vérifie la clé API d'un agent."""
    listener_id = api_key_manager.validate_agent_key(api_key)
    if listener_id:
        return {"valid": True, "listener_id": listener_id, "mode": "defensive-simulation"}
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, 
        detail="Invalid API key"
    )


# ============================================================
# ENDPOINT POUR CRÉER UN ADMIN (UTILE POUR LE TEST)
# ============================================================

@router.post("/setup-admin")
async def setup_admin():
    """
    Crée un administrateur par défaut (via variables d'environnement).
    Note: Les identifiants sont déjà définis dans _operator_credentials().
    Cette route est informative.
    """
    username, password = _operator_credentials()
    return {
        "status": "info",
        "message": "Les identifiants par défaut sont déjà configurés",
        "credentials": {
            "username": username,
            "password": password
        },
        "note": "Utilisez /api/auth/login pour vous authentifier"
    }