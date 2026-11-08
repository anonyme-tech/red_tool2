"""
Listener models for the defensive listener lab.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ListenerProtocol(str, Enum):
    """Supported listener transports."""

    HTTPS = "https"
    HTTP = "http"
    DNS = "dns"
    HTTP2 = "http2"
    QUIC = "quic"


class ListenerProfile(str, Enum):
    """Supported lab profiles."""

    DEFAULT = "default"
    AMAZON = "amazon"
    GOOGLE = "google"
    MS365 = "ms365"
    CLOUDFLARE = "cloudflare"
    CUSTOM = "custom"


class Listener(BaseModel):
    """Public listener model."""

    listener_id: str = Field(..., description="Unique listener identifier")
    name: str = Field(..., description="Human-readable name")
    protocol: ListenerProtocol = Field(default=ListenerProtocol.HTTPS)
    host: str = Field(..., description="Loopback host for the defensive lab listener")
    port: int = Field(..., description="Bind port")
    profile: ListenerProfile = Field(default=ListenerProfile.DEFAULT)
    enabled: bool = Field(default=True)
    created_at: datetime = Field(default_factory=_utc_now)
    agents_connected: int = Field(default=0)
    use_ssl: bool = Field(default=True)
    cert_file: Optional[str] = None
    key_file: Optional[str] = None
    user_agent: str = Field(default="Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    callback_path: str = Field(default="/lab/heartbeat")
    beacon_interval: int = Field(default=5)
    domain_front: Optional[str] = None
    http_headers: Dict[str, str] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["offline", "online", "error", "paused"] = Field(default="offline")
    last_modified: datetime = Field(default_factory=_utc_now)
    stats: Dict[str, Any] = Field(default_factory=dict)
    errors: list[Dict[str, Any]] = Field(default_factory=list)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "listener_id": "listener_1",
                "name": "HTTPS Primary",
                "protocol": "https",
                "host": "127.0.0.1",
                "port": 443,
                "profile": "ms365",
                "use_ssl": True,
                "user_agent": "Mozilla/5.0",
            }
        }
    )


class CreateListenerRequest(BaseModel):
    """Request payload for listener creation."""

    name: str
    protocol: ListenerProtocol = ListenerProtocol.HTTPS
    host: str = "127.0.0.1"
    port: int
    profile: ListenerProfile = ListenerProfile.DEFAULT
    enabled: bool = True
    use_ssl: bool = True
    cert_file: Optional[str] = None
    key_file: Optional[str] = None
    user_agent: Optional[str] = None
    callback_path: Optional[str] = None
    beacon_interval: Optional[int] = None
    domain_front: Optional[str] = None
    http_headers: Dict[str, str] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)


class UpdateListenerRequest(BaseModel):
    """Request payload for listener updates."""

    name: Optional[str] = None
    enabled: Optional[bool] = None
    beacon_interval: Optional[int] = None
    profile: Optional[ListenerProfile] = None
    protocol: Optional[ListenerProtocol] = None
    host: Optional[str] = None
    port: Optional[int] = None
    use_ssl: Optional[bool] = None
    cert_file: Optional[str] = None
    key_file: Optional[str] = None
    user_agent: Optional[str] = None
    callback_path: Optional[str] = None
    domain_front: Optional[str] = None
    http_headers: Optional[Dict[str, str]] = None
    metadata: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None
