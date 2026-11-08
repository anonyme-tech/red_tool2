"""
Agent models used by the defensive listener lab.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AgentStatus(str, Enum):
    """Lifecycle states for a simulated agent."""

    ALIVE = "alive"
    DEAD = "dead"
    SLEEPING = "sleeping"
    UNKNOWN = "unknown"


class SystemInfo(BaseModel):
    """Basic host metadata collected by the simulator."""

    os: str = Field(..., description="System OS")
    hostname: str = Field(..., description="Computer hostname")
    username: str = Field(..., description="Current user")
    domain: str = Field(..., description="Domain or workgroup name")
    pid: int = Field(..., description="Process ID")
    architecture: str = Field(..., description="System architecture")
    privileges: str = Field(..., description="Privilege level")


class Agent(BaseModel):
    """Primary simulated agent model."""

    agent_id: str = Field(..., description="Unique agent identifier")
    listener_id: str = Field(..., description="Listener ID used for the heartbeat")
    hostname: str = Field(..., description="Target hostname")
    username: str = Field(..., description="Target username")
    process_id: int = Field(..., description="Simulator process ID")
    ip_address: str = Field(..., description="Agent external IP")
    first_seen: datetime = Field(default_factory=_utc_now)
    last_seen: datetime = Field(default_factory=_utc_now)
    status: AgentStatus = Field(default=AgentStatus.ALIVE)
    system_info: SystemInfo = Field(..., description="Complete system information")
    agent_version: str = Field(default="1.0.0")
    privileges: str = Field(default="user")
    sleep_interval: int = Field(default=5, description="Simulation interval in seconds")
    jitter: float = Field(default=0.2, description="Jitter percentage (0-1)")
    operating_system: str = Field(default="Windows")
    hostname_domain: str = Field(default="")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "agent_id": "sim_WORKSTATION-01_analyst_4820",
                "listener_id": "listener_1",
                "hostname": "WORKSTATION-01",
                "username": "analyst",
                "process_id": 4820,
                "ip_address": "127.0.0.1",
                "system_info": {
                    "os": "Windows 10",
                    "hostname": "WORKSTATION-01",
                    "username": "analyst",
                    "domain": "LAB",
                    "pid": 4820,
                    "architecture": "x64",
                    "privileges": "user",
                },
            }
        }
    )


class RegisterAgentRequest(BaseModel):
    """Register a new simulated agent."""

    listener_id: str
    hostname: str
    username: str
    process_id: int
    system_info: SystemInfo
    agent_version: str = "1.0.0"
    privileges: str = "user"
    operating_system: str = "Windows"


class RegisterAgentResponse(BaseModel):
    """Response returned after agent registration."""

    agent_id: str
    status: str = "registered"
    sleep_interval: int
    jitter: float
