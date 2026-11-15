"""Unix job slots. Roll out only after all previous shell wrappers have drained."""
import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

root = Path(os.environ.get('SYN3H_HEAVY_ROOT', '/tmp/syn3h-heavy-v2'))
root.mkdir(parents=True, exist_ok=True)
slots = int(os.environ.get('SYN3H_HEAVY_SLOTS', '3'))
if slots < 1 or not sys.argv[1:]:
    sys.exit('heavy: a positive slot count and a command are required')

while True:
    for i in range(1, slots + 1):
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
        sys.exit(code if code >= 0 else 128 - code)
    time.sleep(1)
