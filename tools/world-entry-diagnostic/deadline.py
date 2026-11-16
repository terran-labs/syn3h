"""Bounded diagnostic runner, adapted from reviewed ux-secondary cleanup.

300 seconds execution, absolute 315 seconds including cleanup inspections.
Only observed descendants and direct Popen handles are accounted for. No universal
containment claim: an unobserved escaping child cannot be certified absent.
"""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)
if (out / 'closure.json').exists():
    raise SystemExit('Refusing to overwrite an existing run')
start = time.monotonic()
deadline = start + 315
execution_deadline = start + 300
active_deadline = execution_deadline
owned = {}
children = []
log_handles = []
interrupted = False
original_failure = None
inspection_errors = []
closure_errors = []

def budget(cap):
    remaining = min(deadline, active_deadline) - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('absolute phase deadline expired; inspection unknown')
    return min(cap, remaining)

def pause(seconds):
    time.sleep(budget(seconds))
    budget(1)

def birth(value):
    value = value.strip()
    if not re.fullmatch(r'[A-Za-z]{3} [A-Za-z]{3} +[0-9]{1,2} [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}', value):
        raise RuntimeError('malformed process start time')
    return value

def inspected(stage, fn):
    try:
        return fn()
    except BaseException as error:
        inspection_errors.append({'stage': stage, 'type': type(error).__name__, 'message': str(error)})
        raise

def snapshot():
    def read():
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,lstart='], text=True,
                                capture_output=True, timeout=budget(2))
        if result.returncode != 0 or result.stderr.strip():
            raise RuntimeError('process snapshot failed: ' + result.stderr)
        if not result.stdout.strip():
            raise RuntimeError('empty process snapshot; closure unknown')
        rows = {}
        for line in result.stdout.splitlines():
            fields = line.split(None, 2)
            if len(fields) != 3 or not fields[0].isdigit() or not fields[1].isdigit():
                raise RuntimeError('malformed process snapshot row')
            pid, ppid = int(fields[0]), int(fields[1])
            if pid <= 0 or pid in rows:
                raise RuntimeError('invalid or duplicate process snapshot PID')
            rows[pid] = (ppid, birth(fields[2]))
        if os.getpid() not in rows:
            raise RuntimeError('snapshot omits live wrapper; closure unknown')
        return rows
    return inspected('snapshot', read)

def identity(pid):
    def read():
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'ppid=,lstart='],
                                text=True, capture_output=True, timeout=budget(2))
        if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
            return None
        if result.returncode != 0 or result.stderr.strip():
            raise RuntimeError('identity inspection failed: ' + result.stderr)
        fields = result.stdout.strip().split(None, 1)
        if len(fields) != 2 or not fields[0].isdigit():
            raise RuntimeError('malformed process identity')
        return int(fields[0]), birth(fields[1])
    return inspected('identity ' + str(pid), read)

def track():
    rows = snapshot()
    parents = {os.getpid()} | {pid for pid, born in owned.items()
                              if pid in rows and rows[pid][1] == born}
    changed = True
    while changed:
        changed = False
        for pid, (ppid, born) in rows.items():
            if ppid in parents and pid not in parents:
                parents.add(pid)
                owned[pid] = born
                changed = True
    return rows

def stop(_sig, _frame):
    global interrupted
    interrupted = True

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    # Reject broken inspection before creating any workload.
    snapshot()
    log = (out / 'console.log').open('x')
    log_handles.append(log)
    budget(1)
    child = subprocess.Popen(['node', str(Path(__file__).with_name('trace.mjs')),
                              str(out), *sys.argv[2:]], stdout=log,
                             stderr=subprocess.STDOUT, start_new_session=True)
    children.append(child)
    track()
    while child.poll() is None:
        if interrupted:
            raise InterruptedError('termination requested')
        track()
        pause(.2)
    track()
    if child.returncode:
        raise RuntimeError('diagnostic exited ' + str(child.returncode))
except BaseException as error:
    original_failure = {'type': type(error).__name__, 'message': str(error)}
finally:
    active_deadline = min(deadline, time.monotonic() + 15)
    closure = {'originalFailure': original_failure, 'inspectionErrors': inspection_errors,
               'errors': closure_errors, 'remaining': None, 'signals': [],
               'directHandles': [], 'closureVerified': False, 'serversStarted': False,
               'limitation': 'Only observed descendants and direct Popen handles are accounted for.'}

    def failure(stage, error):
        closure['closureVerified'] = False
        closure_errors.append({'stage': stage, 'type': type(error).__name__, 'message': str(error)})

    def attempt(stage, fn):
        try:
            return fn()
        except BaseException as error:
            failure(stage, error)
            return None

    def persist():
        closure['identities'] = dict(owned)
        closure['elapsedSeconds'] = time.monotonic() - start
        try:
            (out / 'closure.json').write_text(json.dumps(closure, indent=2))
        except BaseException as error:
            failure('persist closure', error)
            try:
                Path('/tmp/world-entry-partial-closure-' + str(os.getpid()) + '.json').write_text(json.dumps(closure, indent=2))
            except BaseException as fallback_error:
                failure('persist fallback closure', fallback_error)
                try:
                    print('PARTIAL_CLOSURE', json.dumps(closure), flush=True)
                except BaseException:
                    pass

    persist()  # A failed first cleanup scan must still leave an incomplete receipt.
    attempt('final descendant discovery', track)
    for child in children:
        def recover(child=child):
            status = child.poll()
            closure['directHandles'].append({'pid': child.pid, 'returncode': status})
            if status is not None or child.pid in owned:
                return
            current = identity(child.pid)
            if current is None:
                return
            if current[0] != os.getpid():
                raise RuntimeError('direct child parent mismatch')
            owned[child.pid] = current[1]
        attempt('recover direct handle ' + str(child.pid), recover)
    persist()
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, born in list(owned.items()):
            def signal_known(pid=pid, born=born, sig=sig):
                current = identity(pid)  # Fresh inspection immediately before each signal.
                if current is None:
                    return
                if current[1] != born:
                    closure['signals'].append({'pid': pid, 'signal': int(sig), 'result': 'identity changed; skipped'})
                    return
                budget(1)
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    return
                closure['signals'].append({'pid': pid, 'signal': int(sig), 'result': 'sent'})
            attempt('signal ' + str(pid) + ' ' + str(int(sig)), signal_known)
        persist()
        attempt('cleanup grace period', lambda: pause(.5))
    for child in children:
        attempt('reap ' + str(child.pid), lambda child=child: child.wait(timeout=budget(1)))
    for handle in log_handles:
        attempt('close log handle', handle.close)
    rows = attempt('closure snapshot', snapshot)
    if rows is not None:
        closure['remaining'] = [pid for pid, born in owned.items()
                                if pid in rows and rows[pid][1] == born]
        if closure['remaining']:
            failure('closure', RuntimeError('owned identities remain, including any zombies'))
    closure['closureVerified'] = not inspection_errors and not closure_errors and closure['remaining'] == []
    persist()

if original_failure or not closure['closureVerified']:
    raise SystemExit(1)
