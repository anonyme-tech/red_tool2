"""
Predefined listener profiles for the defensive listener lab.
"""
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProfileType(str, Enum):
    """Available profile identifiers."""

    DEFAULT = "default"
    AMAZON = "amazon"
    GOOGLE = "google"
    MS365 = "ms365"
    CLOUDFLARE = "cloudflare"
    CUSTOM = "custom"


class ProxyConfig(BaseModel):
    """Optional proxy metadata for the lab profile."""

    enabled: bool = Field(default=False)
    proxy_type: str = Field(default="http", description="http, https, socks5")
    host: str = Field(default="", description="Proxy hostname or IP")
    port: int = Field(default=8080)
    username: Optional[str] = None
    password: Optional[str] = None
    verify_ssl: bool = Field(default=True)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "enabled": True,
                "proxy_type": "http",
                "host": "127.0.0.1",
                "port": 8080,
                "username": "user",
                "password": "pass",
            }
        }
    )


class SSLConfig(BaseModel):
    """Optional SSL/TLS metadata for the lab profile."""

    use_ssl: bool = Field(default=True)
    cert_file: Optional[str] = None
    key_file: Optional[str] = None
    ca_cert: Optional[str] = None
    verify_peer: bool = Field(default=False)
    cipher_suites: Optional[List[str]] = Field(default_factory=list)
    tls_version: str = Field(default="1.3", description="TLS version")
    cert_expiry_days: int = Field(default=365)
    self_signed: bool = Field(default=True)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "use_ssl": True,
                "self_signed": True,
                "tls_version": "1.3",
                "verify_peer": False,
            }
        }
    )


class HTTPConfig(BaseModel):
    """HTTP-like metadata used for simulation and observations."""

    method: str = Field(default="POST", description="HTTP method")
    uris: List[str] = Field(default_factory=lambda: ["/lab/heartbeat", "/lab/status"], description="Expected URIs")
    user_agents: List[str] = Field(default_factory=lambda: ["LabSimulator/1.0"], description="Expected User-Agent values")
    headers: Dict[str, str] = Field(default_factory=dict, description="Expected HTTP headers")
    callback_port: int = Field(default=443)
    host_rotation: bool = Field(default=False)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "method": "POST",
                "uris": ["/lab/heartbeat", "/lab/status"],
                "user_agents": ["LabSimulator/1.0"],
                "headers": {"X-Lab-Mode": "defensive-simulation", "Accept": "*/*"},
                "callback_port": 443,
            }
        }
    )


class ResponseConfig(BaseModel):
    """Static response samples used by the UI and exports."""

    page_404: str = Field(default="<html><body>404 Not Found</body></html>")
    page_error: str = Field(default="<html><body>500 Internal Server Error</body></html>")
    page_payload: str = Field(default="<html><body>OK</body></html>")
    response_headers: Dict[str, str] = Field(
        default_factory=lambda: {"Content-Type": "text/html; charset=utf-8"},
        description="Response headers",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "page_404": "<html><body>404</body></html>",
                "page_error": "<html><body>500</body></html>",
                "page_payload": "<html><body>OK</body></html>",
            }
        }
    )


class BeaconConfig(BaseModel):
    """Timing values returned to the local simulator."""

    beacon_interval: int = Field(default=5, description="Sleep interval in seconds")
    jitter: float = Field(default=0.0, description="Jitter percentage (0.0-1.0)")
    max_retries: int = Field(default=3)
    retry_delay: int = Field(default=5)
    timeout: int = Field(default=10)
    use_sleep_obfuscation: bool = Field(default=False)
    sleep_obfuscation_type: str = Field(default="none", description="none, ekko, ziliean, threadwait")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "beacon_interval": 5,
                "jitter": 0.3,
                "max_retries": 3,
                "use_sleep_obfuscation": False,
                "sleep_obfuscation_type": "none",
            }
        }
    )


class EncryptionConfig(BaseModel):
    """Simulation-only encryption metadata."""

    encryption_type: str = Field(default="simulation")
    key: Optional[str] = None
    iv: Optional[str] = None
    generate_key: bool = Field(default=True)
    hmac_enabled: bool = Field(default=True)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "encryption_type": "simulation",
                "generate_key": True,
                "hmac_enabled": True,
            }
        }
    )


class DomainFrontingConfig(BaseModel):
    """Optional comparison metadata stored with a profile."""

    enabled: bool = Field(default=False)
    front_domain: Optional[str] = None
    real_domain: Optional[str] = None
    domain_header: str = Field(default="Host")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "enabled": False,
                "front_domain": "lab.local",
                "real_domain": "127.0.0.1",
            }
        }
    )


class ListenerProfile(BaseModel):
    """Complete listener profile used by the lab."""

    profile_id: str = Field(..., description="Unique profile identifier")
    profile_name: str = Field(..., description="Human-readable profile name")
    profile_type: ProfileType = Field(default=ProfileType.CUSTOM)
    description: Optional[str] = None
    http_config: HTTPConfig = Field(default_factory=HTTPConfig)
    response_config: ResponseConfig = Field(default_factory=ResponseConfig)
    beacon_config: BeaconConfig = Field(default_factory=BeaconConfig)
    encryption_config: EncryptionConfig = Field(default_factory=EncryptionConfig)
    ssl_config: SSLConfig = Field(default_factory=SSLConfig)
    proxy_config: ProxyConfig = Field(default_factory=ProxyConfig)
    domain_fronting_config: DomainFrontingConfig = Field(default_factory=DomainFrontingConfig)
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "profile_id": "profile_ms365",
                "profile_name": "Microsoft 365 Inspired Profile",
                "profile_type": "ms365",
                "description": "Web-like profile used for local observation exercises",
            }
        }
    )


DEFAULT_PROFILE = ListenerProfile(
    profile_id="profile_default",
    profile_name="Default Lab Profile",
    profile_type=ProfileType.DEFAULT,
    description="Local defensive lab baseline profile",
    http_config=HTTPConfig(
        uris=["/lab/heartbeat", "/lab/status"],
        user_agents=["LabSimulator/1.0"],
        headers={"X-Lab-Mode": "defensive-simulation"},
    ),
    response_config=ResponseConfig(
        page_payload="<html><body>lab-ok</body></html>",
        response_headers={"Content-Type": "application/json", "X-Lab-Mode": "defensive-simulation"},
    ),
    beacon_config=BeaconConfig(
        beacon_interval=5,
        jitter=0.1,
        max_retries=0,
        retry_delay=0,
        timeout=5,
    ),
    encryption_config=EncryptionConfig(
        encryption_type="simulation",
        generate_key=False,
        hmac_enabled=False,
    ),
)

AMAZON_PROFILE = ListenerProfile(
    profile_id="profile_amazon",
    profile_name="Amazon AWS",
    profile_type=ProfileType.AMAZON,
    description="AWS-inspired web profile for local observation exercises",
    http_config=HTTPConfig(
        uris=["/health", "/ping", "/v1/metadata"],
        user_agents=["aws-cli/2.0.0", "Mozilla/5.0 (compatible; aws-cfn-bootstrap/1.3)"],
        headers={"User-Agent": "aws-cfn-bootstrap"},
    ),
    domain_fronting_config=DomainFrontingConfig(
        enabled=False,
        front_domain="amazonaws.com",
        real_domain="127.0.0.1",
    ),
)

GOOGLE_PROFILE = ListenerProfile(
    profile_id="profile_google",
    profile_name="Google Services",
    profile_type=ProfileType.GOOGLE,
    description="Google-inspired web profile for local observation exercises",
    http_config=HTTPConfig(
        uris=["/mail/api/sync", "/calendar/api/check", "/drive/api/files"],
        user_agents=["GoogleBot/2.1", "Mozilla/5.0 (compatible; Googlebot/2.1)"],
        headers={"X-Framework": "google-cloud"},
    ),
)

MS365_PROFILE = ListenerProfile(
    profile_id="profile_ms365",
    profile_name="Microsoft 365",
    profile_type=ProfileType.MS365,
    description="Microsoft 365 inspired profile for local observation exercises",
    http_config=HTTPConfig(
        uris=["/api/auth", "/autodiscover/metadata/messages", "/owa/autodiscover.xml"],
        user_agents=[
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "OutlookIos/5.0",
        ],
        headers={"X-Office-Version": "365"},
    ),
)

CLOUDFLARE_PROFILE = ListenerProfile(
    profile_id="profile_cloudflare",
    profile_name="Cloudflare",
    profile_type=ProfileType.CLOUDFLARE,
    description="Cloudflare-inspired profile for local observation exercises",
    http_config=HTTPConfig(
        uris=["/cdn-cgi/trace", "/api/v4/zones", "/security/check"],
        user_agents=["curl/7.64.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
        headers={"CF-RAY": "random-ray-id", "CF-Connecting-IP": "1.1.1.1"},
    ),
)

PROFILES_MAP = {
    ProfileType.DEFAULT: DEFAULT_PROFILE,
    ProfileType.AMAZON: AMAZON_PROFILE,
    ProfileType.GOOGLE: GOOGLE_PROFILE,
    ProfileType.MS365: MS365_PROFILE,
    ProfileType.CLOUDFLARE: CLOUDFLARE_PROFILE,
}
