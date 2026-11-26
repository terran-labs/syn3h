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
hold = root / 'hold'
HOLD_MAX_AGE = 3 * 3600
log = root / 'heavy.log'

# One job's overall time limit, in seconds (0: none). A hung job held a slot for 84 minutes on
# 25 November. Past the limit heavy stops that job's own process group, frees the slot and logs
# who and what. The release passes its own, longer limit (tools/release.sh), as may long proofs.
TIMEOUT_S = float(os.environ.get('MIRA_HEAVY_TIMEOUT_S', '1800'))


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def age(start):
    seconds = int(time.time() - start)
    return f'{seconds // 3600}h{seconds // 60 % 60:02d}m' if seconds >= 3600 else f'{seconds // 60}m{seconds % 60:02d}s'


def record(path):
    """pid, start time (or None for an owner file written before start times), command."""
    parts = path.read_text().split()
    pid = int(parts[0])
    if path.name.startswith('slot-'):
        parts = parts[2:]  # the owner's token
    else:
        parts = parts[1:]
    start = float(parts[0]) if parts and parts[0].replace('.', '', 1).isdigit() and float(parts[0]) > 1e9 else None
    return pid, start, ' '.join(parts[1:] if start is not None else parts)


def slot_free(i):
    """Whether slot i's kernel lock can be taken now (taken and let go at once)."""
    try:
        with open(root / f'slot-{i}.lock', 'a+') as probe:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(probe, fcntl.LOCK_UN)
            return True
    except BlockingIOError:
        return False


def leftover_pids(i):
    """None if slot i's lock is free; else the PIDs holding it (lsof), or [] if lsof says nothing."""
    path = root / f'slot-{i}.lock'
    try:
        probe = open(path, 'a+')
    except FileNotFoundError:
        return None
    try:
        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(probe, fcntl.LOCK_UN)
        return None
    except BlockingIOError:
        try:
            out = subprocess.run(['lsof', '-t', str(path)], capture_output=True, text=True, timeout=5).stdout.split()
        except (OSError, subprocess.SubprocessError):
            out = []
        return [p for p in out if p != str(os.getpid())]
    finally:
        probe.close()


def reap(group, grace=3.0):
    """Stop what is left of a job's own process group once its command has ended (or been
    stopped): TERM, up to `grace` seconds, then KILL. Only that group: a process that left it
    (setsid) is not chased, and status shows it if it still holds a slot."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(group, sig)
        except (ProcessLookupError, PermissionError):
            return
        deadline = time.time() + grace
        while time.time() < deadline:
            try:
                os.killpg(group, 0)
            except (ProcessLookupError, PermissionError):
                return
            time.sleep(0.1)


def status():
    """Who holds each slot and for how long, who waits, and any release hold. Takes no slot."""
    print(f'heavy: {slots} slots under {root}')
    for i in range(1, slots + 1):
        owner = root / f'slot-{i}.owner'
        try:
            pid, start, command = record(owner)
            when = age(start or owner.stat().st_mtime)  # an older owner file: written at its start
            print(f'  slot {i}: pid {pid}{"" if alive(pid) else " (gone)"}, {when}: {command[:160]}')
        except (FileNotFoundError, ValueError, IndexError):
            # No owner: free only if the kernel lock can be taken. A process that inherited the
            # lock and outlived its job (a watchdog's sleep, on 26 November) still holds it.
            held = leftover_pids(i)
            print(f'  slot {i}: free' if held is None else f'  slot {i}: held by a leftover of a finished job{": pid " + ", ".join(held) if held else ""}')
    waiters = []
    for path in sorted(root.glob('waiting-*')):
        try:
            pid, start, command = record(path)
        except (FileNotFoundError, ValueError, IndexError):
            continue
        if alive(pid):
            waiters.append(f'  waiting{" (release)" if path.name.startswith("waiting-r-") else " (priority)" if path.name.startswith("waiting-p-") else ""}: pid {pid}, {age(start) if start else "?"}: {command[:160]}')
        else:
            path.unlink(missing_ok=True)  # a waiter that died without tidying up
    print('\n'.join(waiters) if waiters else '  nobody waiting')
    phase = hold_phase()
    print('  release hold: none' if phase is None else f'  release hold: {phase or "full"} ({hold.read_text().split()[0]})')


if sys.argv[1:] == ['status']:
    os.environ.pop('MIRA_HEAVY_RELEASE', None)  # report the hold as other jobs see it
if slots < 1 or not sys.argv[1:]:
    sys.exit('heavy: a positive slot count and a command are required')


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


def hold_phase_for_others():
    """The hold phase as an ordinary job sees it, whatever this job's own environment says."""
    saved = os.environ.pop('MIRA_HEAVY_RELEASE', None)
    try:
        return hold_phase()
    finally:
        if saved is not None:
            os.environ['MIRA_HEAVY_RELEASE'] = saved


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

if sys.argv[1:] == ['status']:
    status()
    sys.exit(0)

# A waiter says so while it waits, so status can list it; gone once it has a slot or ends.
# MIRA_HEAVY_PRIORITY=1: a release-path job (a train run, or a branch blocking a release). While
# a priority waiter waits, ordinary waiters take no free slot; among equals the oldest goes
# first, so a free slot goes in turn rather than to whoever polls first.
PRIORITY = os.environ.get('MIRA_HEAVY_PRIORITY') == '1'
# A release's own job (MIRA_HEAVY_RELEASE, or the PID the hold names) is never out-ranked: it
# takes any free slot at once. 26 November: release 130 ranked behind older waiters that the
# hold confined to one busy slot, so free slots stayed free and nothing moved for 17 minutes.
RELEASE = bool(os.environ.get('MIRA_HEAVY_RELEASE'))
waiting = root / f'waiting-{"r-" if RELEASE else "p-" if PRIORITY else ""}{os.getpid()}'
# The rank uses exactly the start time written, so two waiters always agree who is ahead.
waiting_since = float(f'{time.time():.3f}')
waiting.write_text(f'{os.getpid()} {waiting_since:.3f} ' + ' '.join(sys.argv[1:]) + '\n')
def rank_of(name):
    return 0 if name.startswith('waiting-r-') else 1 if name.startswith('waiting-p-') else 2


MY_RANK = (rank_of(waiting.name), waiting_since, os.getpid())


def ahead_of_me(free, shared):
    """Live waiters that go before this one and may take one of the slots free for me: a
    release's job first, then priority, then the oldest. Under a release hold the others may
    use only the `shared` slots, so a waiter confined there does not hold up one that is not."""
    count = 0
    for path in root.glob('waiting-*'):
        try:
            pid, start, _ = record(path)
        except (FileNotFoundError, ValueError, IndexError):
            continue
        if pid == os.getpid() or not alive(pid):
            continue
        rank = rank_of(path.name)
        if (rank, start or 0, pid) >= MY_RANK:
            continue
        allowed = free if rank == 0 or shared is None else free & shared
        if allowed:
            count += 1
    return count


def done_waiting():
    try:
        waiting.unlink()
    except FileNotFoundError:
        pass


import atexit  # noqa: E402
atexit.register(done_waiting)

while True:
    usable = range(1, slots + 1)
    phase = hold_phase()
    if phase is not None:
        shared = HELD_SLOTS[phase]
        if shared < 1:
            time.sleep(2)
            continue
        usable = range(max(1, slots - shared + 1), slots + 1)
    # Wait my turn: only as many waiters as there are free slots may take one. A release's own
    # job never waits its turn.
    if not RELEASE:
        free = {i for i in usable if slot_free(i)}
        other = hold_phase_for_others()
        shared = None if other is None else set(range(max(1, slots - HELD_SLOTS[other] + 1), slots + 1)) if HELD_SLOTS[other] > 0 else set()
        if ahead_of_me(free, shared) >= len(free):
            time.sleep(1)
            continue
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
        started = time.time()
        owner.write_text(token + f' {started:.0f} ' + ' '.join(sys.argv[1:]) + '\n')
        done_waiting()
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
            try:
                code = child.wait(timeout=TIMEOUT_S if TIMEOUT_S > 0 else None)
            except subprocess.TimeoutExpired:
                # Over its limit: stop this job's own process group (never anything else),
                # give it 15 s to end, then kill what is left; the slot frees when we exit.
                line = (f'{time.strftime("%Y-%m-%d %H:%M:%S")} heavy: stopped pid {child.pid} after '
                        f'{age(started)} (limit {TIMEOUT_S:.0f} s, MIRA_HEAVY_TIMEOUT_S) in {os.getcwd()}: {" ".join(sys.argv[1:])[:300]}')
                print(line, file=sys.stderr, flush=True)
                with open(log, 'a') as f:
                    f.write(line + '\n')
                for sig, grace in ((signal.SIGTERM, 15), (signal.SIGKILL, 5)):
                    try:
                        os.killpg(child.pid, sig)
                    except ProcessLookupError:
                        break
                    try:
                        child.wait(timeout=grace)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                code = 124
            # The command has ended: anything it left running in its own group (a watchdog's
            # sleep inherits the slot's lock) goes too, so the slot frees now, not later.
            reap(child.pid)
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
