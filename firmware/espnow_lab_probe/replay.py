"""Submit one captured protected 802.11 frame to the lab ESP32-S3."""

import argparse
import hashlib
import sqlite3
import struct
import time
from datetime import datetime, timezone
from pathlib import Path

import serial


GATEWAY = bytes.fromhex("B03FD35B50B4")
NODE1 = bytes.fromhex("20500D17C8D0")


def now_utc():
    return datetime.now(timezone.utc).isoformat()


def first_uplink(path: Path) -> bytes:
    with path.open("rb") as stream:
        header = stream.read(24)
        if len(header) != 24 or struct.unpack_from("<I", header)[0] != 0xA1B2C3D4:
            raise ValueError("PCAP little-endian no válido")
        while record := stream.read(16):
            if len(record) != 16:
                raise ValueError("Cabecera de registro PCAP incompleta")
            length = struct.unpack_from("<I", record, 8)[0]
            frame = stream.read(length)
            if len(frame) != length:
                raise ValueError("Trama PCAP incompleta")
            if (len(frame) >= 40 and frame[0] == 0xD0 and frame[1] & 0x40
                    and frame[4:10] == GATEWAY and frame[10:16] == NODE1):
                return frame
    raise ValueError("PCAP sin trama protegida nodo 1 -> gateway")


def db_state(path: Path):
    with sqlite3.connect(path) as db:
        activity = db.execute(
            "select ultima_actividad from nodos where device_id='esp32-001'"
        ).fetchone()[0]
        count = db.execute(
            "select count(*) from muestras_rendimiento where device_id='esp32-001'"
        ).fetchone()[0]
        latest = db.execute(
            "select secuencia_protocolo, recibido_en from muestras_rendimiento "
            "where device_id='esp32-001' order by id desc limit 1"
        ).fetchone()
        return activity, count, latest


def read_expected(port, log, expected: str, timeout: float = 3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        raw = port.readline()
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        if line.startswith("CAPTURE ") and " hex=" in line:
            line = line.split(" hex=", 1)[0] + " hex=[guardado en PCAP]"
        log.write(f"{now_utc()} SERIAL {line}\n")
        log.flush()
        if line.startswith("REPLAY_ERROR"):
            raise RuntimeError(line)
        if line.startswith(expected):
            return
    raise TimeoutError(f"Sin confirmación serie: {expected}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--pcap", type=Path, required=True)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    frame = first_uplink(args.pcap)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as log:
        log.write(f"{now_utc()} PCAP={args.pcap} sha256={hashlib.sha256(args.pcap.read_bytes()).hexdigest()}\n")
        log.write(f"{now_utc()} FRAME len={len(frame)} sha256={hashlib.sha256(frame).hexdigest()} "
                  "protected=1 dst=B0:3F:D3:5B:50:B4 src=20:50:0D:17:C8:D0\n")
        with serial.Serial(args.port, 115200, timeout=0.25) as port:
            started = time.monotonic()
            ready = False
            while time.monotonic() - started < 8:
                raw = port.readline()
                if raw:
                    line = raw.decode("utf-8", errors="replace").strip()
                    if "LAB_READY" in line:
                        ready = True
                        break
            if not ready:
                log.write(f"{now_utc()} WARN LAB_READY no observado; continúa la prueba\n")
            port.write(b"channel 11\n")
            time.sleep(0.7)
            port.write(f"replay_begin {len(frame)}\n".encode("ascii"))
            read_expected(port, log, "REPLAY_BEGIN")
            for offset in range(0, len(frame), 16):
                chunk = frame[offset:offset + 16]
                port.write(f"replay_chunk {offset} {chunk.hex().upper()}\n".encode("ascii"))
                read_expected(port, log, f"REPLAY_CHUNK received={offset + len(chunk)}/{len(frame)}")
            before = db_state(args.db)
            log.write(f"{now_utc()} DB_BEFORE activity={before[0]} samples={before[1]} latest={before[2]}\n")
            sent_at = now_utc()
            port.write(b"replay_send\n")
            log.write(f"{sent_at} HOST_REPLAY submitted_exact_frame_once\n")
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                raw = port.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").strip()
                if line.startswith("CAPTURE ") and " hex=" in line:
                    line = line.split(" hex=", 1)[0] + " hex=[saved in radio PCAP]"
                log.write(f"{now_utc()} SERIAL {line}\n")
                log.flush()
            after = db_state(args.db)
            log.write(f"{now_utc()} DB_AFTER activity={after[0]} samples={after[1]} latest={after[2]}\n")
    print(args.output)


if __name__ == "__main__":
    main()
