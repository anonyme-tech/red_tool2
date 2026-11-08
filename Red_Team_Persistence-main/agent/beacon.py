import getpass
import logging
import os
import platform
import random
import socket
import time
from datetime import datetime, timezone
from typing import Dict, Optional
from urllib.parse import urlparse

import requests


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _is_loopback_server(server_url: str) -> bool:
    parsed = urlparse(server_url)
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BeaconConfig:
    """Configuration for the local heartbeat simulator."""

    def __init__(self, server_url: str, listener_id: str, interval: int = 5, jitter: float = 0.2):
        self.server_url = server_url
        self.listener_id = listener_id
        self.beacon_interval = interval
        self.jitter = jitter
        self.agent_id: Optional[str] = None
        self.api_key: Optional[str] = None

    def jittered_sleep(self) -> int:
        """Compute the next sleep interval with jitter."""
        variance = int(self.beacon_interval * self.jitter * 1000)
        sleep_time = self.beacon_interval + random.uniform(-variance / 1000, variance / 1000)
        return max(int(sleep_time), 1)


class SystemRecon:
    """Minimal host metadata for the defensive lab."""

    @staticmethod
    def get_system_info() -> Dict:
        """Collect local system metadata for the lab service."""
        try:
            return {
                "os": platform.system(),
                "hostname": socket.gethostname(),
                "username": getpass.getuser(),
                "domain": os.environ.get("USERDOMAIN", "WORKGROUP"),
                "pid": os.getpid(),
                "architecture": platform.machine(),
                "privileges": "admin" if (hasattr(os, "geteuid") and os.geteuid() == 0) else "user",
            }
        except Exception as exc:
            logger.error("Error getting system info: %s", exc)
            return {}

    @staticmethod
    def get_ip_address() -> str:
        """Resolve the local loopback address."""
        try:
            return socket.gethostbyname("localhost")
        except Exception:
            return "127.0.0.1"


class Beacon:
    """Local heartbeat simulator for the defensive listener lab."""

    def __init__(self, server_url: str, listener_id: str, interval: int = 5, jitter: float = 0.2):
        if not _is_loopback_server(server_url):
            raise ValueError("This simulator only supports localhost endpoints")

        self.config = BeaconConfig(server_url, listener_id, interval=interval, jitter=jitter)
        self.session = requests.Session()
        self.session.verify = False
        self.is_running = True

    def register(self) -> bool:
        """Register the simulator with the local lab service."""
        logger.info("[*] Registering simulator with lab service: %s", self.config.server_url)

        try:
            system_info = SystemRecon.get_system_info()
            payload = {
                "listener_id": self.config.listener_id,
                "hostname": socket.gethostname(),
                "username": getpass.getuser(),
                "process_id": os.getpid(),
                "system_info": system_info,
                "agent_version": "lab-sim-1.0",
                "privileges": system_info.get("privileges", "user"),
                "operating_system": platform.system(),
            }

            response = self.session.post(
                f"{self.config.server_url}/api/auth/register",
                json=payload,
                timeout=10,
            )

            if response.status_code != 200:
                logger.error("[-] Registration failed: %s", response.status_code)
                return False

            data = response.json()
            self.config.agent_id = data.get("agent_id")
            self.config.beacon_interval = int(data.get("sleep_interval", 5))
            self.config.jitter = float(data.get("jitter", 0.2))

            logger.info("[+] Simulator registered successfully")
            logger.info("[+] Agent ID: %s", self.config.agent_id)
            return True
        except Exception as exc:
            logger.error("[-] Registration error: %s", exc)
            return False

    def beacon(self) -> None:
        """Main loop for local heartbeat simulation."""
        if not self.register():
            logger.error("[-] Failed to register simulator")
            return

        logger.info(
            "[+] Starting local heartbeat loop (interval: %ss, jitter: %s)",
            self.config.beacon_interval,
            self.config.jitter,
        )

        while self.is_running:
            try:
                self.send_heartbeat()
                sleep_time = self.config.jittered_sleep()
                logger.debug("[*] Sleeping for %ss", sleep_time)
                time.sleep(sleep_time)
            except KeyboardInterrupt:
                logger.info("[*] Simulator interrupted by user")
                self.is_running = False
            except Exception as exc:
                logger.error("[-] Simulator error: %s", exc)
                time.sleep(self.config.beacon_interval)

    def send_heartbeat(self) -> bool:
        """Send a simulated heartbeat event to the listener lab."""
        if not self.config.agent_id:
            logger.error("[-] Simulator is not registered")
            return False

        system_info = SystemRecon.get_system_info()
        payload = {
            "agent_id": self.config.agent_id,
            "hostname": socket.gethostname(),
            "username": getpass.getuser(),
            "process_id": os.getpid(),
            "system_info": system_info,
            "agent_version": "lab-sim-1.0",
            "privileges": system_info.get("privileges", "user"),
            "operating_system": platform.system(),
            "event_type": "heartbeat",
            "signal": "heartbeat",
            "sleep_interval": self.config.beacon_interval,
            "jitter": self.config.jitter,
            "ip_address": SystemRecon.get_ip_address(),
            "user_agent": "LabSimulator/1.0",
            "uri": "/lab/heartbeat",
            "metadata": {
                "simulated": True,
                "timestamp": _utc_now_iso(),
            },
        }

        response = self.session.post(
            f"{self.config.server_url}/api/listeners/{self.config.listener_id}/heartbeat",
            json=payload,
            timeout=10,
        )
        if response.status_code == 200:
            logger.info("[+] Heartbeat acknowledged for %s", self.config.agent_id)
            return True

        logger.warning("[-] Heartbeat rejected: %s", response.status_code)
        return False

    def fetch_tasks(self) -> list:
        """Tasking is disabled in defensive simulation mode."""
        return []

    def execute_task(self, task: Dict) -> bool:
        """Ignore task payloads when older clients invoke this hook."""
        logger.warning("[-] Ignoring task payload in defensive simulation mode: %s", task.get("task_id"))
        return False


def main() -> None:
    """Entry point for the local heartbeat simulator."""
    import argparse

    parser = argparse.ArgumentParser(description="Local defensive listener heartbeat simulator")
    parser.add_argument("--server", default="http://localhost:8000", help="Local lab server URL")
    parser.add_argument("--listener", default="listener_1", help="Listener ID")
    parser.add_argument("--interval", type=int, default=5, help="Heartbeat interval in seconds")
    parser.add_argument("--jitter", type=float, default=0.2, help="Jitter percentage")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("Defensive Listener Lab - Heartbeat Simulator")
    logger.info("=" * 60)
    logger.info("Server: %s", args.server)
    logger.info("Listener: %s", args.listener)
    logger.info("=" * 60)

    beacon = Beacon(args.server, args.listener, interval=args.interval, jitter=args.jitter)
    beacon.beacon()


if __name__ == "__main__":
    main()
