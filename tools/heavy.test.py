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

    def test_a_hold_starts_no_new_job_but_lets_a_running_one_finish(self):
        # release-97, 21 Nov: a release waiting at its load gate holds the machine from that
        # moment. A job already running finishes; no queued job starts until the hold lifts;
        # the release's own jobs (SYN3H_HEAVY_RELEASE) are never held.
        slots = self.root / 'slots'; slots.mkdir(parents=True, exist_ok=True)
        log = self.root / 'events'
        mark = lambda name, secs: f"import time; p={str(log)!r}; open(p,'a').write({name!r} + ' start\\n'); time.sleep({secs}); open(p,'a').write({name!r} + ' end\\n')"
        running = self.run_job(mark('running', 1.5))
        deadline = time.time() + 5
        while not (log.exists() and 'running start' in log.read_text()) and time.time() < deadline: time.sleep(.05)
        holder = subprocess.Popen(['sleep', '30'])
        try:
            (slots / 'hold').write_text(f'{holder.pid}\n')
            queued = self.run_job(mark('queued', 0))
            release = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', mark('release', 0)], env={**self.env, 'SYN3H_HEAVY_RELEASE': '1'})
            self.assertEqual(release.wait(timeout=10), 0)
            self.assertEqual(running.wait(timeout=10), 0)
            time.sleep(2.5)  # several of heavy.py's polls after the running job has gone
            self.assertNotIn('queued start', log.read_text())
            self.assertIsNone(queued.poll())
            holder.kill(); holder.wait()  # the release exits
            self.assertEqual(queued.wait(timeout=10), 0)
            events = log.read_text().splitlines()
            self.assertLess(events.index('running end'), events.index('queued start'))
            self.assertLess(events.index('release end'), events.index('queued start'))
        finally:
            if holder.poll() is None: holder.kill(); holder.wait()

    def test_held_slots_setting_lets_other_jobs_share_one_slot(self):
        self.env['SYN3H_HEAVY_HELD_SLOTS'] = '1'
        slots = self.root / 'slots'; slots.mkdir(parents=True, exist_ok=True)
        holder = subprocess.Popen(['sleep', '30'])
        log = self.root / 'events'
        try:
            (slots / 'hold').write_text(f'{holder.pid}\n')
            code = f"import time; p={str(log)!r}; open(p,'a').write('1\\n'); time.sleep(.6); open(p,'a').write('-1\\n')"
            jobs = [self.run_job(code) for _ in range(3)]
            for job in jobs:
                self.assertEqual(job.wait(timeout=12), 0)
            count = maximum = 0
            for event in log.read_text().splitlines():
                count += int(event); maximum = max(maximum, count)
            # Two slots, one held for the release: other jobs still run, one at a time.
            self.assertEqual(maximum, 1)
        finally:
            holder.kill(); holder.wait()

    def test_stale_hold_is_ignored_and_a_release_lifts_its_own(self):
        slots = self.root / 'slots'; slots.mkdir(parents=True, exist_ok=True)
        hold = slots / 'hold'
        # Names a live process (this test) but is over three hours old: a recycled PID.
        hold.write_text(f'{os.getpid()}\n')
        old = time.time() - 4 * 3600
        os.utime(hold, (old, old))
        self.assertEqual(self.run_job('pass').wait(timeout=5), 0)
        # A wrapper whose own PID is in the hold removes it when its command ends.
        code = f"import os; from pathlib import Path; Path({str(hold)!r}).write_text(str(os.getppid()) + '\\n')"
        self.assertEqual(self.run_job(code).wait(timeout=5), 0)
        self.assertFalse(hold.exists())

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


SHIP = Path(__file__).with_name('ship.sh').resolve()
RELEASE = Path(__file__).with_name('release.sh').resolve()


class PhaseTests(unittest.TestCase):
    """The hold's phase (tools/ship.sh writes 'gate', release.sh 'running') decides how many
    other jobs may start: none at the gate, one while running, none for a hold without one."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.slots = self.root / 'slots'; self.slots.mkdir()
        self.env = {**os.environ, 'SYN3H_HEAVY_ROOT': str(self.slots), 'SYN3H_HEAVY_SLOTS': '2'}
        for k in ('SYN3H_HEAVY_BYPASS', 'SYN3H_HEAVY_RELEASE', 'SYN3H_HEAVY_HELD_SLOTS', 'SYN3H_HEAVY_GATE_SLOTS', 'SYN3H_HEAVY_RUNNING_SLOTS'): self.env.pop(k, None)
        self.log = self.root / 'events'
    def tearDown(self):
        self.temp.cleanup()
    def job(self, name, secs=0.6):
        code = f"import time; p={str(self.log)!r}; open(p,'a').write({name!r} + ' +\\n'); time.sleep({secs}); open(p,'a').write({name!r} + ' -\\n')"
        return subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', code], env=self.env)
    def most_at_once(self):
        count = most = 0
        for line in self.log.read_text().splitlines():
            count += 1 if line.endswith('+') else -1; most = max(most, count)
        return most

    def test_gate_starts_nothing_and_running_shares_one_slot(self):
        holder = subprocess.Popen(['sleep', '60'])
        try:
            (self.slots / 'hold').write_text(f'{holder.pid}\ngate\n')
            jobs = [self.job(f'j{i}') for i in range(3)]
            time.sleep(3)
            self.assertFalse(self.log.exists(), 'a job started while the release waits at its gate')
            (self.slots / 'hold').write_text(f'{holder.pid}\nrunning\n')
            for j in jobs: self.assertEqual(j.wait(timeout=20), 0)
            self.assertEqual(self.most_at_once(), 1, 'past the gate, other jobs share one slot')
        finally:
            holder.kill(); holder.wait()

    def test_release_sh_holds_the_machine_as_running(self):
        line = next(l for l in RELEASE.read_text().splitlines() if '_hold_root=' in l and '/hold' in l)
        out = subprocess.run(['sh', '-c', line + '\necho $$'], env={**self.env, 'SYN3H_HEAVY_ROOT': str(self.slots)}, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual((self.slots / 'hold').read_text().split(), [out.stdout.strip(), 'running'])

    def ship(self, load_file, release, extra=None):
        bin_dir = self.root / 'bin'; bin_dir.mkdir(exist_ok=True)
        (bin_dir / 'sysctl').write_text(f'#!/bin/sh\necho "{{ $(cat {load_file}) 1.00 1.00 }}"\n'); (bin_dir / 'sysctl').chmod(0o755)
        env = {**self.env, 'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'SYN3H_SHIP_GAP_S': '0', 'SYN3H_SHIP_DRY': '0',
               'SYN3H_GATE_LOAD': '12', 'SYN3H_GATE_HOLD_S': '1', 'SYN3H_GATE_POLL_S': '1', 'SYN3H_GATE_TIMEOUT_S': '60',
               'SYN3H_SHIP_RELEASE': str(release), 'SYN3H_SHIP_OUT': str(self.root), 'SYN3H_SHIP_STABLE': str(self.root / 'stable'),
               **(extra or {})}
        return subprocess.Popen(['sh', str(SHIP), '7', 'test release'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def fake_release(self, secs):
        # Stands in for release.sh: takes the hold over as 'running', as the real one does.
        path = self.root / 'release'
        path.write_text(f'#!/bin/sh\nprintf "%s\\nrunning\\n" $$ > "$SYN3H_HEAVY_ROOT/hold"\necho started >> {self.root}/release-ran\nsleep {secs}\n')
        path.chmod(0o755)
        return path

    def test_ship_holds_fully_at_the_gate_then_shares_once_the_release_runs(self):
        load = self.root / 'load'; load.write_text('20.00')
        ship = self.ship(load, self.fake_release(4))
        try:
            deadline = time.time() + 10
            while not (self.slots / 'hold').exists() and time.time() < deadline: time.sleep(.1)
            self.assertEqual((self.slots / 'hold').read_text().split(), [str(ship.pid), 'gate'])
            queued = self.job('builder', 0.2)
            time.sleep(3)
            self.assertFalse(self.log.exists(), 'a builder job started during the gate wait')
            load.write_text('3.00')  # the load falls: the gate passes, release.sh takes over
            self.assertEqual(queued.wait(timeout=20), 0)
            self.assertTrue((self.root / 'release-ran').exists(), 'the builder job started before the release')
            self.assertEqual((self.slots / 'hold').read_text().split()[1], 'running')
            out, _ = ship.communicate(timeout=20)
            self.assertIn('GATE WAIT', out); self.assertIn('GATE PASSED', out)
            self.assertEqual((self.root / 'syn3h-ship-7.done').read_text().strip(), 'release rc=0')
        finally:
            if ship.poll() is None: ship.kill()

    def test_ship_gives_up_at_the_gate_timeout_and_lifts_its_hold(self):
        load = self.root / 'load'; load.write_text('20.00')
        ship = self.ship(load, self.fake_release(0), {'SYN3H_GATE_TIMEOUT_S': '2'})
        out, _ = ship.communicate(timeout=20)
        self.assertIn('gate timeout', (self.root / 'syn3h-ship-7.done').read_text())
        self.assertFalse((self.root / 'release-ran').exists())
        self.assertFalse((self.slots / 'hold').exists(), 'its own hold is lifted')


if __name__ == '__main__':
    unittest.main()
