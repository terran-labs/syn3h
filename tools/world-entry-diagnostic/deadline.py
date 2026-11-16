"""One allocated run, 300 seconds execution plus at most 15 seconds cleanup.

No retries, servers, installs or builds. Preserve zombie identities as survivors.
The heavy limiter must invoke this supervisor, not the browser script directly.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
if (out / 'closure.json').exists():
    raise SystemExit('Refusing to overwrite an existing run')
start = time.monotonic()
owned = {}
interrupted = False

def table():
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,lstart=,stat='], capture_output=True, text=True, timeout=2, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 8:
            rows[int(fields[0])] = (int(fields[1]), ' '.join(fields[2:7]), fields[7])
    return rows

def scan():
    rows = table()
    parents = {pid for pid, identity in owned.items() if pid in rows and rows[pid][1] == identity}
    if child.poll() is None and child.pid in rows:
        parents.add(child.pid)
    while True:
        found = {pid for pid, row in rows.items() if row[0] in parents}
        if found <= parents:
            break
        parents |= found
    for pid in parents:
        if pid in rows and pid not in owned:
            owned[pid] = rows[pid][1]
    return {pid: rows[pid] for pid, identity in owned.items() if pid in rows and rows[pid][1] == identity}

def stop(_sig, _frame):
    global interrupted
    interrupted = True

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with (out / 'console.log').open('x') as log:
    child = subprocess.Popen(['node', str(Path(__file__).with_name('trace.mjs')), str(out), *sys.argv[2:]], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        while child.poll() is None and not interrupted and time.monotonic() - start < 300:
            scan()
            time.sleep(.2)
    finally:
        cleanup_start = time.monotonic()
        timed_out = child.poll() is None
        survivors = scan()
        # Group plus identity-checked descendants covers Chromium's separate groups.
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if survivors:
                if child.poll() is None:
                    try:
                        os.killpg(child.pid, sig)
                    except ProcessLookupError:
                        pass
                current_rows = table()
                for pid in survivors:
                    current = current_rows.get(pid)
                    if current and current[1] == owned[pid]:
                        try:
                            os.kill(pid, sig)
                        except ProcessLookupError:
                            pass
            until = min(cleanup_start + 9, time.monotonic() + (2 if sig == signal.SIGTERM else 5))
            while time.monotonic() < until:
                child.poll()  # Reap our direct child before checking actual absence.
                survivors = scan()
                if not survivors:
                    break
                time.sleep(.2)
        child.poll()
        survivors = scan()
        receipt = dict(exitCode=child.returncode, timedOut=timed_out, interrupted=interrupted, elapsedSeconds=time.monotonic()-start, identities=owned, survivors=survivors, serversStarted=False, listeningPortsCreated=[], closureVerified=not survivors)
        (out / 'closure.json').write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt))
        if survivors or timed_out or interrupted or child.returncode:
            sys.exit(1)
