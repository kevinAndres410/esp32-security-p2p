"""Save the lab ESP32-S3 serial output and its 802.11 frames as a PCAP file."""

import argparse
import re
import struct
import time
from pathlib import Path

import serial


CAPTURE_HEX = re.compile(r"^CAPTURE\s+.*\bhex=([0-9A-Fa-f]+)\s*$")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, help="Current USB serial port, e.g. COM9")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--output", type=Path, required=True, help="Base path without extension")
    parser.add_argument("--command", choices=("status", "hop", "probe"),
                        help="Optional serial command sent once after opening the port")
    parser.add_argument("--channel", type=int, choices=range(1, 14), metavar="1..13",
                        help="Lock the radio to this Wi-Fi channel")
    parser.add_argument("--status-after", type=int,
                        help="Send status after this many seconds on the same serial connection")
    parser.add_argument("--scan-channels", type=str,
                        help="Comma-separated channels to visit in sequence")
    parser.add_argument("--scan-dwell", type=int, default=12,
                        help="Seconds to remain on each scanned channel")
    args = parser.parse_args()
    if args.seconds < 1:
        parser.error("--seconds must be positive")
    scan_channels = []
    if args.scan_channels:
        try:
            scan_channels = [int(value) for value in args.scan_channels.split(",")]
        except ValueError:
            parser.error("--scan-channels requires comma-separated integers")
        if not scan_channels or any(channel not in range(1, 14) for channel in scan_channels):
            parser.error("--scan-channels must contain channels 1..13")
        if args.channel or args.command:
            parser.error("--scan-channels cannot be combined with --channel or --command")
        if args.scan_dwell < 1:
            parser.error("--scan-dwell must be positive")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    started = time.monotonic()
    deadline = time.monotonic() + args.seconds
    status_sent = False
    with serial.Serial(args.port, 115200, timeout=0.5) as port, \
            args.output.with_suffix(".log").open("w", encoding="utf-8") as log, \
            args.output.with_suffix(".pcap").open("wb") as pcap:
        # Classic PCAP, little endian, DLT_IEEE802_11 (105).
        pcap.write(struct.pack("<IHHIIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 105))
        if args.channel:
            port.write(f"channel {args.channel}\n".encode("ascii"))
        if args.command:
            port.write((args.command + "\n").encode("ascii"))
        scan_index = 0
        next_scan = started + args.scan_dwell
        if scan_channels:
            port.write(f"channel {scan_channels[0]}\n".encode("ascii"))
        while time.monotonic() < deadline:
            if scan_channels and time.monotonic() >= next_scan and scan_index + 1 < len(scan_channels):
                scan_index += 1
                port.write(f"channel {scan_channels[scan_index]}\n".encode("ascii"))
                next_scan += args.scan_dwell
            if args.status_after is not None and not status_sent and time.monotonic() - started >= args.status_after:
                port.write(b"status\n")
                status_sent = True
            raw = port.readline()
            if not raw:
                continue
            wall_time = time.time()
            line = raw.decode("utf-8", errors="replace").strip()
            log.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(wall_time))} {line}\n")
            log.flush()
            match = CAPTURE_HEX.match(line)
            if not match:
                continue
            frame = bytes.fromhex(match.group(1))
            seconds = int(wall_time)
            micros = int((wall_time - seconds) * 1_000_000)
            pcap.write(struct.pack("<IIII", seconds, micros, len(frame), len(frame)))
            pcap.write(frame)
            count += 1

    print(f"Capturas: {count}; archivos: {args.output.with_suffix('.log')}, {args.output.with_suffix('.pcap')}")


if __name__ == "__main__":
    main()
