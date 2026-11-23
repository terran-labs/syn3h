"""Unix job slots. Roll out only after all previous shell wrappers have drained."""
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import legacy_env  # noqa: E401,E702,F401  legacy environment names, see docs/NAMES.md
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

root = Path(os.environ.get('MIRA_HEAVY_ROOT', '/tmp/syn3h-heavy-v2'))
root.mkdir(parents=True, exist_ok=True)
slots = int(os.environ.get('MIRA_HEAVY_SLOTS', '3'))
if slots < 1 or not sys.argv[1:]:
    sys.exit('heavy: a positive slot count and a command are required')

hold = root / 'hold'
HOLD_MAX_AGE = 3 * 3600


def hold_phase():
    """The phase of a release holding the machine, or None when nothing holds it.

    The hold file names the release's PID on its first line and, from tools/ship.sh and
    release.sh, its phase on the second: 'gate' while it waits for the load to fall before
    starting, 'running' once release.sh runs. A hold without a phase (an older writer) is ''.
    It holds only while that process lives, so a crashed release cannot block anyone, and
    never once it is three hours old, so a dead PID recycled by some long-lived process cannot
    either. The release's own jobs set MIRA_HEAVY_RELEASE and are never held."""
    if os.environ.get('MIRA_HEAVY_RELEASE'):
        return None
    try:
        if time.time() - hold.stat().st_mtime > HOLD_MAX_AGE:
            return None
        parts = hold.read_text().split()
        pid = int(parts[0])
        os.kill(pid, 0)
    except (FileNotFoundError, ValueError, IndexError, ProcessLookupError):
        return None
    except PermissionError:
        pass
    return parts[1] if len(parts) > 1 and parts[1] in ('gate', 'running') else ''


def env_slots(name, default):
    return int(os.environ.get(name, default))


# How many other jobs may share the last slots while a release holds the machine, by phase:
#   gate     0: it waits for the load to fall, and any new job keeps it up (release-97, 21 Nov,
#              waited over 20 minutes at load 16 to 27 while jobs kept starting);
#   running  1: past the gate, one builder job beside it keeps work moving without taking the
#              load near the release's own limits (the 17 November reason for sharing);
#   ''       0: a hold without a phase, from a wrapper that does not say, is a full hold.
# A job already running is never stopped; only new ones wait.
HELD_SLOTS = {
    'gate': env_slots('MIRA_HEAVY_GATE_SLOTS', '0'),
    'running': env_slots('MIRA_HEAVY_RUNNING_SLOTS', '1'),
    '': env_slots('MIRA_HEAVY_HELD_SLOTS', '0'),
}

while True:
    usable = range(1, slots + 1)
    phase = hold_phase()
    if phase is not None:
        shared = HELD_SLOTS[phase]
        if shared < 1:
            time.sleep(2)
            continue
        usable = range(max(1, slots - shared + 1), slots + 1)
    for i in usable:
        lock = open(root / f'slot-{i}.lock', 'a+')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            continue
        # This namespace is never used by legacy shell jobs. Kernel ownership, not age
        # or a PID receipt, decides whether a slot is free. Never unlink a lock file.
        owner = root / f'slot-{i}.owner'
        token = f'{os.getpid()} {uuid.uuid4()}'
        owner.write_text(token + ' ' + ' '.join(sys.argv[1:]) + '\n')
        child = None
        pending = None

        def forward(sig, _frame):
            global pending
            pending = sig
            if child is not None:
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass

        signal.signal(signal.SIGTERM, forward)
        signal.signal(signal.SIGINT, forward)
        try:
            child = subprocess.Popen(['nice', '-n', '10', *sys.argv[1:]],
                                     start_new_session=True, pass_fds=(lock.fileno(),))
            # A signal can arrive inside Popen before it returns the child handle.
            # Remember it and forward after assignment instead of abandoning the child.
            if pending is not None:
                forward(pending, None)
            code = child.wait()
        finally:
            try:
                if owner.read_text().startswith(token + ' '):
                    owner.unlink()
            except FileNotFoundError:
                pass
            lock.close()
            # A release exec'd into this wrapper (same PID): lift its hold now it is over.
            try:
                if hold.read_text().split()[:1] == [str(os.getpid())]:
                    hold.unlink()
            except (FileNotFoundError, IndexError):
                pass
        sys.exit(code if code >= 0 else 128 - code)
    time.sleep(1)
