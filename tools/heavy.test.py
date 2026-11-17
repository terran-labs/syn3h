import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).with_name('heavy.sh').resolve()

class HeavyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = {**os.environ, 'SYN3H_HEAVY_ROOT': str(self.root / 'slots'), 'SYN3H_HEAVY_SLOTS': '2'}
        self.env.pop('SYN3H_HEAVY_BYPASS', None)
    def tearDown(self):
        self.temp.cleanup()
    def run_job(self, code, **kwargs):
        return subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', code], env=self.env, **kwargs)
    def test_limits_concurrency_and_preserves_failure(self):
        log = self.root / 'events'
        code = f"import time; p={str(log)!r}; open(p,'a').write('1\\n'); time.sleep(.2); open(p,'a').write('-1\\n')"
        jobs = [self.run_job(code) for _ in range(6)]
        for job in jobs:
            self.assertEqual(job.wait(timeout=12), 0)
        count = maximum = 0
        for event in log.read_text().splitlines():
            count += int(event); maximum = max(maximum, count)
        self.assertEqual(count, 0)
        self.assertLessEqual(maximum, 2)
        self.assertEqual(self.run_job('raise SystemExit(7)').wait(timeout=5), 7)
    def test_hold_waits_for_a_live_release_and_ignores_a_dead_one(self):
        slots = self.root / 'slots'; slots.mkdir(parents=True, exist_ok=True)
        holder = subprocess.Popen(['sleep', '30'])
        try:
            (slots / 'hold').write_text(f'{holder.pid}\n')
            job = self.run_job('pass')
            time.sleep(1.5)
            self.assertIsNone(job.poll(), 'a job started while a live release held the machine')
            released = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', 'pass'], env={**self.env, 'SYN3H_HEAVY_RELEASE': '1'})
            self.assertEqual(released.wait(timeout=5), 0)
            holder.kill(); holder.wait()
            self.assertEqual(job.wait(timeout=8), 0)
        finally:
            if holder.poll() is None: holder.kill()
        # A hold naming a process that no longer exists holds nothing.
        self.assertEqual(self.run_job('pass').wait(timeout=5), 0)

    def test_child_keeps_lock_after_wrapper_is_killed(self):
        self.env['SYN3H_HEAVY_SLOTS'] = '1'
        started = self.root / 'started'
        ended = self.root / 'ended'
        first = self.run_job(f"import time; from pathlib import Path; Path({str(started)!r}).touch(); time.sleep(1.5); Path({str(ended)!r}).touch()")
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(started.exists())
        first.kill(); first.wait()
        second = self.run_job(f"from pathlib import Path; assert Path({str(ended)!r}).exists()")
        self.assertEqual(second.wait(timeout=8), 0)

    def test_termination_during_spawn_is_forwarded(self):
        # Deliver TERM after the OS child exists but before Popen returns its handle.
        script = str(SCRIPT.with_suffix('.py'))
        code = f'''
import os, runpy, signal, subprocess, sys
real = subprocess.Popen
def interrupted(*args, **kwargs):
    child = real(*args, **kwargs)
    os.kill(os.getpid(), signal.SIGTERM)
    return child
subprocess.Popen = interrupted
sys.argv = [{script!r}, 'python3', '-c', 'import time; time.sleep(30)']
runpy.run_path({script!r}, run_name='__main__')
'''
        result = subprocess.run(['python3', '-c', code], env=self.env, timeout=5)
        self.assertEqual(result.returncode, 143)
        self.assertEqual(self.run_job('pass').wait(timeout=5), 0)

    def test_term_reaches_command_process_group(self):
        ready = self.root / 'ready'
        stopped = self.root / 'stopped'
        child_code = f"import signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,lambda *_:(Path({str(stopped)!r}).touch(),exit(0))); Path({str(ready)!r}).touch(); time.sleep(30)"
        command = f"import subprocess,time; subprocess.Popen(['python3','-c',{child_code!r}]); time.sleep(30)"
        wrapper = self.run_job(command)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(ready.exists())
            wrapper.terminate()
            self.assertEqual(wrapper.wait(timeout=5), 143)
            deadline = time.monotonic() + 3
            while not stopped.exists() and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertTrue(stopped.exists())
        finally:
            if wrapper.poll() is None:
                wrapper.kill(); wrapper.wait()

if __name__ == '__main__':
    unittest.main()
