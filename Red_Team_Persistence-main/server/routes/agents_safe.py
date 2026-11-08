"""
Simulated agent routes for the defensive listener lab.
"""
import os
import sys
from typing import List, Optional

from fastapi import APIRouter, Body, HTTPException, Query, status

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from modules.listener_runtime import listener_manager


router = APIRouter(prefix="/api/agents", tags=["agents"])


def _agent_or_404(agent_id: str):
    agent = listener_manager.get_simulated_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found")
    return agent


@router.get("/", response_model=List[dict])
async def list_agents(
    status: Optional[str] = Query(None),
    listener_id: Optional[str] = Query(None),
):
    return listener_manager.list_simulated_agents(listener_id=listener_id, status=status)


@router.get("/{agent_id}", response_model=dict)
async def get_agent(agent_id: str):
    return _agent_or_404(agent_id)


@router.post("/{agent_id}/tasks")
async def create_task_for_agent(
    agent_id: str,
    command_type: str,
    command_args: Optional[dict] = Body(default=None),
    priority: int = 0,
    operator_id: str = "op_1",
    mitre_technique: Optional[str] = None,
):
    _agent_or_404(agent_id)
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Tasking is disabled in defensive simulation mode",
    )


@router.get("/{agent_id}/tasks", response_model=dict)
async def get_agent_tasks(agent_id: str):
    _agent_or_404(agent_id)
    return {
        "tasks": [],
        "total": 0,
        "mode": "defensive-simulation",
        "note": "Tasking is disabled in defensive simulation mode",
    }


@router.post("/{agent_id}/callback")
async def beacon_callback(agent_id: str, payload: dict = Body(default_factory=dict)):
    agent = _agent_or_404(agent_id)
    listener_id = agent.get("listener_id")
    if not listener_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Agent has no listener association")

    listener_manager.record_heartbeat(
        listener_id,
        {
            "agent_id": agent_id,
            "hostname": agent.get("hostname"),
            "username": agent.get("username"),
            "process_id": agent.get("process_id"),
            "system_info": agent.get("system_info") or {},
            "agent_version": agent.get("agent_version"),
            "privileges": agent.get("privileges"),
            "operating_system": agent.get("operating_system"),
            "event_type": "callback",
            "signal": "callback",
            "metadata": payload or {},
        },
    )
    return {"status": "acknowledged", "agent_id": agent_id}


@router.delete("/{agent_id}")
async def remove_agent(agent_id: str):
    _agent_or_404(agent_id)
    listener_manager.remove_simulated_agent(agent_id)
    return {"status": "removed", "agent_id": agent_id}


@router.post("/{agent_id}/update_status")
async def update_agent_status(agent_id: str, new_status: str):
    valid_statuses = ["alive", "dead", "sleeping", "unknown"]
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of {valid_statuses}",
        )

    updated = listener_manager.update_simulated_agent_status(agent_id, new_status)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found")
    return {"status": "updated", "agent_id": agent_id, "new_status": new_status}
