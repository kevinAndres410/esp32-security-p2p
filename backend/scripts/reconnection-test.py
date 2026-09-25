"""Controlled reset/reconnection test. The serial port is transport, never identity."""

import argparse
import datetime as dt
import json
import pathlib
import re
import sqlite3
import subprocess
import sys
import time

import serial


ROOT = pathlib.Path(__file__).resolve().parents[2]
DATABASE = ROOT / "backend" / "database.sqlite"
OUTPUT = ROOT / "resultados_rendimiento"


def latest_sample(connection, device_id):
    row = connection.execute(
        "SELECT MAX(recibido_en) FROM muestras_rendimiento WHERE device_id = ?",
        (device_id,),
    ).fetchone()
    return dt.datetime.fromisoformat(row[0].replace("Z", "+00:00")) if row[0] else None


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--mac", required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--hold-seconds", type=int, default=60)
    options = parser.parse_args()
    if options.hold_seconds < 50:
        parser.error("--hold-seconds debe ser >= 50 para observar estado desconectado")

    identity = subprocess.run(
        [sys.executable, "-m", "esptool", "--chip", "esp32", "--port", options.port,
         "--before", "default-reset", "--after", "hard-reset", "read-mac"],
        capture_output=True, text=True, timeout=30, check=True,
    )
    match = re.search(r"(?im)^MAC:\s*([0-9a-f:]{17})\s*$", identity.stdout)
    if not match or match.group(1).lower() != options.mac.lower():
        raise RuntimeError("La MAC del puerto no corresponde al nodo solicitado; prueba cancelada")

    connection = sqlite3.connect(DATABASE)
    sample = latest_sample(connection, options.device)
    if not sample or (utc_now() - sample).total_seconds() > 25:
        raise RuntimeError("El nodo no tiene un heartbeat reciente; prueba cancelada")

    with serial.Serial(options.port, 115200, timeout=0.5) as board:
        board.dtr = False
        board.rts = True  # EN held low via the development board's USB bridge
        reset_started = utc_now()
        time.sleep(options.hold_seconds)
        last_during_reset = latest_sample(connection, options.device)
        offline_age_seconds = (utc_now() - last_during_reset).total_seconds()
        board.rts = False
        released = utc_now()

        first_recovered = None
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            current = latest_sample(connection, options.device)
            if current and current > released:
                first_recovered = current
                break
            time.sleep(0.5)

    report = {
        "deviceId": options.device,
        "mac": match.group(1).upper(),
        "resetStartedAt": reset_started.isoformat(),
        "releasedAt": released.isoformat(),
        "holdSeconds": options.hold_seconds,
        "offlineAgeSecondsBeforeRelease": round(offline_age_seconds, 2),
        "observedDisconnected": offline_age_seconds > 45,
        "firstBackendHeartbeatAfterRelease": first_recovered.isoformat() if first_recovered else None,
        "reconnectionSeconds": round((first_recovered - released).total_seconds(), 3)
        if first_recovered else None,
    }
    OUTPUT.mkdir(exist_ok=True)
    target = OUTPUT / f"{reset_started.strftime('%Y-%m-%dT%H-%M-%SZ')}-reconexion-{options.device}.json"
    target.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"file": str(target), "report": report}, indent=2))
    connection.close()


if __name__ == "__main__":
    main()
