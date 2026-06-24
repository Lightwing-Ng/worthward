"""
Local IBKR Client Portal Gateway process management.

Code version: v0.1.0
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import ssl
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.broker_settings import (
    BrokerSettings,
    build_ibkr_base_url_from_port,
    normalize_ibkr_port,
)
from app.core.config import SETTINGS_STORE_DIR


CONTROLLED_IBKR_GATEWAY_DIR = SETTINGS_STORE_DIR / "ibkr" / "clientportal.gw"
DEFAULT_IMPORTED_IBKR_GATEWAY_DIR = Path.home() / "Downloads" / "clientportal.gw"
GATEWAY_PID_FILE = SETTINGS_STORE_DIR / "ibkr" / "gateway.pid"
PYCHARM_JBR_HOME = Path("/Applications/PyCharm.app/Contents/jbr/Contents/Home")
GATEWAY_READY_TIMEOUT_SECONDS = 30
GATEWAY_STATUS_TIMEOUT_SECONDS = 8
GATEWAY_STARTUP_STALE_SECONDS = 45
GATEWAY_STATUS_PROBE_ATTEMPTS = 3
GATEWAY_RESTART_COOLDOWN_SECONDS = 30
GATEWAY_AUTH_DELAY_MS = 10000
_GATEWAY_PROCESS: subprocess.Popen[str] | None = None
_GATEWAY_STARTED_AT: str = ""
_GATEWAY_LAST_PORT: int | None = None
_GATEWAY_LAST_STOPPED_AT: float = 0.0


@dataclass(frozen=True)
class IbkrGatewayRuntimeStatus:
    installed: bool
    running: bool
    reachable: bool
    authenticated: bool
    connected: bool
    port: int
    base_url: str
    login_url: str
    gateway_dir: str
    java_home: str
    pid: int | None
    message: str
    auth_status: dict[str, Any]
    started_at: str

    def to_json(self) -> dict[str, Any]:
        return {
            "installed": self.installed,
            "running": self.running,
            "reachable": self.reachable,
            "authenticated": self.authenticated,
            "connected": self.connected,
            "port": self.port,
            "base_url": self.base_url,
            "login_url": self.login_url,
            "gateway_dir": self.gateway_dir,
            "java_home": self.java_home,
            "pid": self.pid,
            "message": self.message,
            "auth_status": self.auth_status,
            "started_at": self.started_at,
        }


def build_ibkr_gateway_origin(port: int | str | None) -> str:
    return f"https://127.0.0.1:{normalize_ibkr_port(port)}"


def _read_gateway_ip2loc() -> str:
    conf_file = resolve_ibkr_gateway_dir() / "root" / "conf.yaml"
    if not conf_file.exists():
        return "US"
    match = re.search(r'^\s*ip2loc:\s*"?([^"\n#]+)"?\s*$', conf_file.read_text(encoding="utf-8"), flags=re.MULTILINE)
    value = (match.group(1) if match else "US").strip()
    return value or "US"


def build_ibkr_gateway_login_url(port: int | str | None) -> str:
    ip2loc = _read_gateway_ip2loc()
    return f"{build_ibkr_gateway_origin(port)}/sso/Login?forwardTo=22&RL=1&ip2loc={ip2loc}"


def resolve_ibkr_gateway_dir() -> Path:
    return CONTROLLED_IBKR_GATEWAY_DIR


def resolve_ibkr_java_home() -> str:
    env_java_home = os.environ.get("JAVA_HOME", "").strip()
    if env_java_home and (Path(env_java_home) / "bin" / "java").exists():
        return env_java_home
    if (PYCHARM_JBR_HOME / "bin" / "java").exists():
        return str(PYCHARM_JBR_HOME)
    java_path = shutil.which("java")
    if java_path:
        return str(Path(java_path).resolve().parent.parent)
    return ""


def _ignore_gateway_copy_entries(_directory: str, names: list[str]) -> set[str]:
    ignored = {".DS_Store", "__MACOSX"}
    if "logs" in names:
        ignored.add("logs")
    return ignored.intersection(names)


def ensure_controlled_ibkr_gateway() -> tuple[bool, str]:
    gateway_dir = resolve_ibkr_gateway_dir()
    run_script = gateway_dir / "bin" / "run.sh"
    conf_file = gateway_dir / "root" / "conf.yaml"
    if run_script.exists() and conf_file.exists():
        return True, f"Using controlled Gateway at {gateway_dir}."
    source_dir = DEFAULT_IMPORTED_IBKR_GATEWAY_DIR
    source_run_script = source_dir / "bin" / "run.sh"
    source_conf_file = source_dir / "root" / "conf.yaml"
    if not source_run_script.exists() or not source_conf_file.exists():
        return (
            False,
            "IBKR Client Portal Gateway is not installed in the controlled local folder yet. "
            f"Place a Gateway distribution at {gateway_dir}, or keep one at {source_dir} for first-run import.",
        )
    gateway_dir.parent.mkdir(parents=True, exist_ok=True)
    if gateway_dir.exists():
        shutil.rmtree(gateway_dir)
    shutil.copytree(source_dir, gateway_dir, ignore=_ignore_gateway_copy_entries)
    run_script.chmod(run_script.stat().st_mode | 0o111)
    return True, f"Imported IBKR Client Portal Gateway into {gateway_dir}."


def configure_ibkr_gateway_port(port: int | str | None) -> None:
    gateway_dir = resolve_ibkr_gateway_dir()
    conf_file = gateway_dir / "root" / "conf.yaml"
    normalized_port = normalize_ibkr_port(port)
    raw_config = conf_file.read_text(encoding="utf-8")
    next_config, replacements = re.subn(
        r"(^\s*listenPort:\s*)\d+(\s*$)",
        rf"\g<1>{normalized_port}\2",
        raw_config,
        count=1,
        flags=re.MULTILINE,
    )
    if replacements == 0:
        next_config = f"{raw_config.rstrip()}\n    listenPort: {normalized_port}\n"
    next_config, auth_delay_replacements = re.subn(
        r"(^\s*authDelay:\s*)\d+(\s*$)",
        rf"\g<1>{GATEWAY_AUTH_DELAY_MS}\2",
        next_config,
        count=1,
        flags=re.MULTILINE,
    )
    if auth_delay_replacements == 0:
        next_config = f"{next_config.rstrip()}\n    authDelay: {GATEWAY_AUTH_DELAY_MS}\n"
    if next_config != raw_config:
        conf_file.write_text(next_config, encoding="utf-8")


def _gateway_request_json(port: int | str | None, path: str, timeout_seconds: float = GATEWAY_STATUS_TIMEOUT_SECONDS) -> Any:
    normalized_path = path if path.startswith("/") else f"/{path}"
    request = Request(
        f"{build_ibkr_gateway_origin(port)}/v1/api{normalized_path}",
        headers={"Accept": "application/json"},
        method="GET",
    )
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=timeout_seconds, context=context) as response:
        raw_body = response.read().decode("utf-8", errors="replace").strip()
    if not raw_body:
        return {}
    return json.loads(raw_body)


def _is_managed_process_running() -> bool:
    return _GATEWAY_PROCESS is not None and _GATEWAY_PROCESS.poll() is None


def _read_persisted_gateway_pid() -> int | None:
    try:
        raw_pid = GATEWAY_PID_FILE.read_text(encoding="utf-8").strip()
        return int(raw_pid)
    except (OSError, ValueError):
        return None


def _write_persisted_gateway_pid(pid: int | None) -> None:
    GATEWAY_PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    if pid is None:
        if GATEWAY_PID_FILE.exists():
            GATEWAY_PID_FILE.unlink()
        return
    GATEWAY_PID_FILE.write_text(str(pid), encoding="utf-8")


def _is_pid_running(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _is_gateway_port_listening(port: int | str | None) -> bool:
    normalized_port = normalize_ibkr_port(port)
    try:
        with socket.create_connection(("127.0.0.1", normalized_port), timeout=1.0):
            return True
    except OSError:
        return False


def _find_gateway_listener_pids(port: int | str | None) -> list[int]:
    normalized_port = normalize_ibkr_port(port)
    try:
        result = subprocess.run(
            ["lsof", "-t", f"-iTCP:{normalized_port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return []
    pids: list[int] = []
    for line in result.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid > 0 and pid not in pids:
            pids.append(pid)
    return pids


def _terminate_pid(pid: int, *, grace_seconds: float = 2.0) -> None:
    if pid <= 0:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        if not _is_pid_running(pid):
            return
        time.sleep(0.1)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        return


def read_recent_gateway_cp_login_failure(*, lookback_lines: int = 160) -> str | None:
    log_dir = resolve_ibkr_gateway_dir() / "logs"
    candidates = sorted(
        (path for path in log_dir.glob("gw.*.log") if ".message." not in path.name),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        return None
    lines = candidates[0].read_text(encoding="utf-8", errors="replace").splitlines()
    recent = lines[-lookback_lines:]
    last_success_idx = -1
    for idx, line in enumerate(recent):
        if "Client login succeeds" in line:
            last_success_idx = idx
    if last_success_idx < 0:
        return None
    tail = recent[last_success_idx:]
    if any("failed /v1/api/sso/validate?gw=1 | reason Access Denied" in line for line in tail):
        return "Access Denied from /v1/api/sso/validate"
    if any("authentication to cp failed" in line for line in tail) and any("giving up" in line for line in tail):
        return "Client Portal validation gave up"
    return None


def stop_ibkr_gateway(port: int | str | None = None) -> None:
    global _GATEWAY_LAST_PORT
    global _GATEWAY_LAST_STOPPED_AT
    global _GATEWAY_PROCESS
    global _GATEWAY_STARTED_AT

    normalized_port = normalize_ibkr_port(port)
    managed_pid = _GATEWAY_PROCESS.pid if _is_managed_process_running() and _GATEWAY_PROCESS else None
    if managed_pid is not None:
        _terminate_pid(managed_pid)
    _GATEWAY_PROCESS = None
    _GATEWAY_LAST_PORT = None
    _GATEWAY_STARTED_AT = ""

    for pid in (
        _read_persisted_gateway_pid(),
        *_find_gateway_listener_pids(normalized_port),
    ):
        if pid is None:
            continue
        if managed_pid is not None and pid == managed_pid:
            continue
        _terminate_pid(pid)
    _write_persisted_gateway_pid(None)
    _GATEWAY_LAST_STOPPED_AT = time.monotonic()


def _resolve_gateway_process_running(port: int | str | None) -> bool:
    if _is_managed_process_running():
        return True
    if _is_pid_running(_read_persisted_gateway_pid()):
        return True
    return _is_gateway_port_listening(port)


def _gateway_runtime_log_path() -> Path:
    return resolve_ibkr_gateway_dir() / "logs" / "antigravity-run.log"


def _startup_elapsed_seconds() -> float | None:
    if not _GATEWAY_STARTED_AT:
        return None
    try:
        started_at = datetime.fromisoformat(_GATEWAY_STARTED_AT)
    except ValueError:
        return None
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - started_at).total_seconds())


def _startup_stale_message() -> str:
    run_log = _gateway_runtime_log_path()
    return (
        "Gateway is still not responding. "
        f"Check {run_log} and settings_store/ibkr/clientportal.gw/logs/, "
        "then click Start gateway again."
    )


def _probe_gateway_auth_status(port: int | str | None) -> tuple[bool, dict[str, Any], str]:
    normalized_port = normalize_ibkr_port(port)
    last_error: Exception | None = None
    for attempt in range(GATEWAY_STATUS_PROBE_ATTEMPTS):
        try:
            payload = _gateway_request_json(port, "/iserver/auth/status")
        except HTTPError as error:
            if error.code == 401:
                return True, {}, "Gateway is running and waiting for login."
            return True, {}, f"Gateway returned HTTP {error.code}."
        except (TimeoutError, URLError, OSError) as error:
            last_error = error
            if attempt + 1 < GATEWAY_STATUS_PROBE_ATTEMPTS and _is_gateway_port_listening(normalized_port):
                time.sleep(0.6 * (attempt + 1))
                continue
            return False, {}, f"Gateway is not reachable yet. {error}"
        except json.JSONDecodeError:
            return True, {}, "Gateway responded, but auth status was not valid JSON."
        else:
            if not isinstance(payload, dict):
                return True, {}, "Gateway responded, but auth status was not an object."
            if payload.get("authenticated"):
                return True, payload, "Client login succeeds. You can click Test connection now."
            return True, payload, "Gateway is running. Finish the IBKR login window to continue."
    return False, {}, f"Gateway is not reachable yet. {last_error}"


def _gateway_runtime_message(
    *,
    reachable: bool,
    process_running: bool,
    startup_elapsed: float | None,
) -> str:
    if reachable:
        return "Gateway is running."
    if process_running:
        if startup_elapsed is not None and startup_elapsed >= GATEWAY_STARTUP_STALE_SECONDS:
            return _startup_stale_message()
        return "Gateway is starting."
    return "Gateway is not running yet."


def get_ibkr_gateway_runtime_status(
    port: int | str | None,
    *,
    probe_session: bool = False,
) -> IbkrGatewayRuntimeStatus:
    normalized_port = normalize_ibkr_port(port)
    gateway_dir = resolve_ibkr_gateway_dir()
    installed = (gateway_dir / "bin" / "run.sh").exists() and (gateway_dir / "root" / "conf.yaml").exists()
    process_running = _resolve_gateway_process_running(normalized_port)
    startup_elapsed = _startup_elapsed_seconds()
    if probe_session:
        reachable, auth_status, message = _probe_gateway_auth_status(normalized_port)
    else:
        reachable = _is_gateway_port_listening(normalized_port)
        auth_status = {}
        message = _gateway_runtime_message(
            reachable=reachable,
            process_running=process_running,
            startup_elapsed=startup_elapsed,
        )
    authenticated = bool(auth_status.get("authenticated"))
    connected = bool(auth_status.get("connected"))
    running = reachable or process_running
    if not probe_session and not reachable and running:
        message = _gateway_runtime_message(
            reachable=False,
            process_running=True,
            startup_elapsed=startup_elapsed,
        )
    return IbkrGatewayRuntimeStatus(
        installed=installed,
        running=running,
        reachable=reachable,
        authenticated=authenticated,
        connected=connected,
        port=normalized_port,
        base_url=build_ibkr_base_url_from_port(normalized_port),
        login_url=build_ibkr_gateway_login_url(normalized_port),
        gateway_dir=str(gateway_dir),
        java_home=resolve_ibkr_java_home(),
        pid=(
            _GATEWAY_PROCESS.pid
            if _is_managed_process_running() and _GATEWAY_PROCESS
            else _read_persisted_gateway_pid()
        ),
        message=message,
        auth_status=auth_status,
        started_at=_GATEWAY_STARTED_AT,
    )


def start_ibkr_gateway(settings: BrokerSettings, *, port: int | str | None = None) -> IbkrGatewayRuntimeStatus:
    global _GATEWAY_LAST_PORT
    global _GATEWAY_LAST_STOPPED_AT
    global _GATEWAY_PROCESS
    global _GATEWAY_STARTED_AT

    normalized_port = normalize_ibkr_port(port)
    cooldown_elapsed = time.monotonic() - _GATEWAY_LAST_STOPPED_AT
    if _GATEWAY_LAST_STOPPED_AT > 0 and cooldown_elapsed < GATEWAY_RESTART_COOLDOWN_SECONDS:
        time.sleep(GATEWAY_RESTART_COOLDOWN_SECONDS - cooldown_elapsed)
    installed, install_message = ensure_controlled_ibkr_gateway()
    if not installed:
        return get_ibkr_gateway_runtime_status(normalized_port)
    configure_ibkr_gateway_port(normalized_port)

    current_status = get_ibkr_gateway_runtime_status(normalized_port, probe_session=True)
    if current_status.authenticated and current_status.connected:
        return current_status
    if current_status.running or current_status.reachable:
        stop_ibkr_gateway(normalized_port)
        time.sleep(1.5)

    java_home = resolve_ibkr_java_home()
    if not java_home:
        gateway_dir = resolve_ibkr_gateway_dir()
        return IbkrGatewayRuntimeStatus(
            installed=True,
            running=False,
            reachable=False,
            authenticated=False,
            connected=False,
            port=normalized_port,
            base_url=build_ibkr_base_url_from_port(normalized_port),
            login_url=build_ibkr_gateway_login_url(normalized_port),
            gateway_dir=str(gateway_dir),
            java_home="",
            pid=None,
            message="A Java runtime was not found. Install Java or keep PyCharm's bundled runtime available.",
            auth_status={},
            started_at="",
        )

    gateway_dir = resolve_ibkr_gateway_dir()
    logs_dir = gateway_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    run_log = logs_dir / "antigravity-run.log"
    env = os.environ.copy()
    env["JAVA_HOME"] = java_home
    env["PATH"] = f"{Path(java_home) / 'bin'}{os.pathsep}{env.get('PATH', '')}"
    log_handle = run_log.open("a", encoding="utf-8")
    log_handle.write(f"\n[{datetime.now(timezone.utc).isoformat()}] Starting IBKR Gateway on port {normalized_port}. {install_message}\n")
    log_handle.flush()
    _GATEWAY_PROCESS = subprocess.Popen(
        ["bin/run.sh", "root/conf.yaml"],
        cwd=str(gateway_dir),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    _GATEWAY_LAST_PORT = normalized_port
    _GATEWAY_STARTED_AT = datetime.now(timezone.utc).isoformat()
    _write_persisted_gateway_pid(_GATEWAY_PROCESS.pid)

    deadline = time.monotonic() + GATEWAY_READY_TIMEOUT_SECONDS
    last_status = get_ibkr_gateway_runtime_status(normalized_port)
    while time.monotonic() < deadline:
        time.sleep(0.75)
        last_status = get_ibkr_gateway_runtime_status(normalized_port)
        if last_status.reachable:
            return last_status
        if _GATEWAY_PROCESS.poll() is not None:
            _write_persisted_gateway_pid(None)
            return IbkrGatewayRuntimeStatus(
                installed=True,
                running=False,
                reachable=False,
                authenticated=False,
                connected=False,
                port=normalized_port,
                base_url=build_ibkr_base_url_from_port(normalized_port),
                login_url=build_ibkr_gateway_login_url(normalized_port),
                gateway_dir=str(gateway_dir),
                java_home=java_home,
                pid=None,
                message=f"Gateway exited before it became reachable. Check {run_log}.",
                auth_status={},
                started_at=_GATEWAY_STARTED_AT,
            )
    if not last_status.reachable and last_status.running:
        startup_elapsed = _startup_elapsed_seconds()
        if startup_elapsed is not None and startup_elapsed >= GATEWAY_STARTUP_STALE_SECONDS:
            last_status = IbkrGatewayRuntimeStatus(
                installed=last_status.installed,
                running=last_status.running,
                reachable=False,
                authenticated=False,
                connected=False,
                port=last_status.port,
                base_url=last_status.base_url,
                login_url=last_status.login_url,
                gateway_dir=last_status.gateway_dir,
                java_home=last_status.java_home,
                pid=last_status.pid,
                message=_startup_stale_message(),
                auth_status=last_status.auth_status,
                started_at=last_status.started_at,
            )
    return last_status
