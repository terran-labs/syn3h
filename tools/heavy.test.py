import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import legacy_env  # noqa: E401,E702,F401  legacy environment names, see docs/NAMES.md
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
        self.env = {**os.environ, 'MIRA_HEAVY_ROOT': str(self.root / 'slots'), 'MIRA_HEAVY_SLOTS': '2'}
        self.env.pop('MIRA_HEAVY_BYPASS', None)
    def tearDown(self):
        self.temp.cleanup()
    def run_job(self, code, **kwargs):
        return subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', code], env=self.env, **kwargs)
    def test_a_job_over_its_time_limit_is_stopped_and_frees_its_slot(self):
        # A hung job held a slot for 84 minutes on 25 November.
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1', 'MIRA_HEAVY_TIMEOUT_S': '1'}
        started = time.time()
        hung = subprocess.run(['sh', str(SCRIPT), 'python3', '-c', 'import time; time.sleep(60)'], env=env, capture_output=True, text=True, timeout=40)
        self.assertEqual(hung.returncode, 124)
        self.assertLess(time.time() - started, 30)
        self.assertIn('stopped pid', hung.stderr)
        logged = (self.root / 'slots' / 'heavy.log').read_text()
        self.assertIn('time.sleep(60)', logged)
        self.assertIn(f' in {os.getcwd()}:', logged, 'the log names the worktree the job ran in')
        after = subprocess.run(['sh', str(SCRIPT), 'true'], env=env, timeout=20)
        self.assertEqual(after.returncode, 0, 'the slot is free again')

    def test_a_finished_job_leaves_nothing_holding_its_slot(self):
        # 26 November: a bounded job's watchdog, `( sleep 1800; kill $$ ) &`, inherited the slot's
        # lock and pinned the slot for up to 30 minutes after the job ended.
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1'}
        done = subprocess.run(['sh', str(SCRIPT), 'sh', '-c', '( sleep 60 ) & echo started'], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0)
        started = time.time()
        after = subprocess.run(['sh', str(SCRIPT), 'true'], env=env, timeout=20)
        self.assertEqual(after.returncode, 0)
        self.assertLess(time.time() - started, 8, 'the slot is free within seconds')

    def test_a_priority_waiter_goes_before_an_older_ordinary_one(self):
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1'}
        order = self.root / 'order'
        holder = subprocess.Popen(['sh', str(SCRIPT), 'sleep', '3'], env=env)
        time.sleep(0.8)
        ordinary = subprocess.Popen(['sh', str(SCRIPT), 'sh', '-c', f'echo ordinary >> {order}'], env=env)
        time.sleep(0.8)
        priority = subprocess.Popen(['sh', str(SCRIPT), 'sh', '-c', f'echo priority >> {order}'], env={**env, 'MIRA_HEAVY_PRIORITY': '1'})
        for p in (holder, ordinary, priority):
            p.wait(timeout=30)
        self.assertEqual(order.read_text().split(), ['priority', 'ordinary'])

    def test_ordinary_waiters_go_oldest_first(self):
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1'}
        order = self.root / 'order'
        holder = subprocess.Popen(['sh', str(SCRIPT), 'sleep', '3'], env=env)
        time.sleep(0.8)
        waiters = []
        for name in ('first', 'second', 'third'):
            waiters.append(subprocess.Popen(['sh', str(SCRIPT), 'sh', '-c', f'echo {name} >> {order}'], env=env))
            time.sleep(0.5)
        for p in (holder, *waiters):
            p.wait(timeout=30)
        self.assertEqual(order.read_text().split(), ['first', 'second', 'third'])

    def test_status_does_not_call_a_held_slot_free(self):
        import fcntl
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1'}
        slots = self.root / 'slots'; slots.mkdir(parents=True, exist_ok=True)
        with open(slots / 'slot-1.lock', 'a+') as held:  # a leftover holding the lock, no owner file
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            (slots / 'waiting-999999').write_text('999999 1700000000 gone\n')  # a dead waiter
            out = subprocess.run(['sh', str(SCRIPT), 'status'], env=env, capture_output=True, text=True, timeout=10)
        self.assertIn('slot 1: held by a leftover of a finished job', out.stdout)
        self.assertFalse((slots / 'waiting-999999').exists(), 'a dead waiter file is removed')

    def test_status_lists_holders_and_waiters_without_taking_a_slot(self):
        env = {**self.env, 'MIRA_HEAVY_SLOTS': '1'}
        holder = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', 'import time; time.sleep(30)'], env=env)
        try:
            time.sleep(1.5)
            waiter = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', 'print("waiting job")'], env=env)
            time.sleep(1.5)
            out = subprocess.run(['sh', str(SCRIPT), 'status'], env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(out.returncode, 0)
            self.assertIn('slot 1: pid', out.stdout)
            self.assertIn('time.sleep(30)', out.stdout)
            self.assertIn('waiting: pid', out.stdout)
            self.assertIn('waiting job', out.stdout)
            self.assertIsNone(waiter.poll(), 'status took no slot: the waiter still waits')
        finally:
            for p in (holder, locals().get('waiter')):
                if p and p.poll() is None:
                    p.terminate(); p.wait(timeout=10)

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
            released = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', 'pass'], env={**self.env, 'MIRA_HEAVY_RELEASE': '1'})
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
        # the release's own jobs (MIRA_HEAVY_RELEASE) are never held.
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
            release = subprocess.Popen(['sh', str(SCRIPT), 'python3', '-c', mark('release', 0)], env={**self.env, 'MIRA_HEAVY_RELEASE': '1'})
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
        self.env['MIRA_HEAVY_HELD_SLOTS'] = '1'
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
        self.env['MIRA_HEAVY_SLOTS'] = '1'
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
NOTES_TOOL = Path(__file__).with_name('release-notes.mjs').resolve()
RELEASE = Path(__file__).with_name('release.sh').resolve()


class PhaseTests(unittest.TestCase):
    """The hold's phase (tools/ship.sh writes 'gate', release.sh 'running') decides how many
    other jobs may start: none at the gate, one while running, none for a hold without one."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.slots = self.root / 'slots'; self.slots.mkdir()
        self.env = {**os.environ, 'MIRA_HEAVY_ROOT': str(self.slots), 'MIRA_HEAVY_SLOTS': '2'}
        for k in ('MIRA_HEAVY_BYPASS', 'MIRA_HEAVY_RELEASE', 'MIRA_HEAVY_HELD_SLOTS', 'MIRA_HEAVY_GATE_SLOTS', 'MIRA_HEAVY_RUNNING_SLOTS'): self.env.pop(k, None)
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
        out = subprocess.run(['sh', '-c', line + '\necho $$'], env={**self.env, 'MIRA_HEAVY_ROOT': str(self.slots)}, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual((self.slots / 'hold').read_text().split(), [out.stdout.strip(), 'running'])

    def notes(self, version=None):
        # Release notes for the version ship.sh will compute, in a folder of their own
        # (MIRA_RELEASE_NOTES_DIR), so the check it runs first passes; or for `version`.
        root = self.root / 'notes'
        (root / 'releases').mkdir(parents=True, exist_ok=True); (root / 'player').mkdir(exist_ok=True)
        (root / 'history.tsv').write_text('')
        env = {**self.env, 'MIRA_RELEASE_NOTES_DIR': str(root)}
        version = version or subprocess.run(['node', str(NOTES_TOOL), 'next'], env=env, capture_output=True, text=True, check=True).stdout.strip()
        (root / 'releases' / f'{version}.md').write_text(f'## Mira {version}\n\nDeck.\n\nhttps://mira.cc/?v={version[1:]}\n')
        (root / 'player' / f'{version}.md').write_text('Deck\n')
        return root

    def ship(self, load_file, release, extra=None):
        notes = self.notes() if not (extra or {}).get('MIRA_RELEASE_NOTES_DIR') else None
        bin_dir = self.root / 'bin'; bin_dir.mkdir(exist_ok=True)
        (bin_dir / 'sysctl').write_text(f'#!/bin/sh\necho "{{ $(cat {load_file}) 1.00 1.00 }}"\n'); (bin_dir / 'sysctl').chmod(0o755)
        env = {**self.env, 'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'MIRA_SHIP_GAP_S': '0', 'MIRA_SHIP_DRY': '0',
               'MIRA_GATE_LOAD': '12', 'MIRA_GATE_HOLD_S': '1', 'MIRA_GATE_POLL_S': '1', 'MIRA_GATE_TIMEOUT_S': '60',
               'MIRA_SHIP_RELEASE': str(release), 'MIRA_SHIP_OUT': str(self.root), 'MIRA_SHIP_STABLE': str(self.root / 'stable'),
               **({'MIRA_RELEASE_NOTES_DIR': str(notes)} if notes else {}), **(extra or {})}
        return subprocess.Popen(['sh', str(SHIP), '7', 'test release'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def fake_release(self, secs):
        # Stands in for release.sh: takes the hold over as 'running', as the real one does.
        path = self.root / 'release'
        path.write_text(f'#!/bin/sh\nprintf "%s\\nrunning\\n" $$ > "$MIRA_HEAVY_ROOT/hold"\necho started >> {self.root}/release-ran\nsleep {secs}\n')
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
            self.assertEqual((self.root / 'mira-ship-7.done').read_text().strip(), 'release rc=0')
        finally:
            if ship.poll() is None: ship.kill()

    def test_ship_gives_up_at_the_gate_timeout_and_lifts_its_hold(self):
        load = self.root / 'load'; load.write_text('20.00')
        ship = self.ship(load, self.fake_release(0), {'MIRA_GATE_TIMEOUT_S': '2'})
        out, _ = ship.communicate(timeout=20)
        self.assertIn('gate timeout', (self.root / 'mira-ship-7.done').read_text())
        self.assertFalse((self.root / 'release-ran').exists())
        self.assertFalse((self.slots / 'hold').exists(), 'its own hold is lifted')

    def test_ship_stops_first_when_the_notes_are_for_another_version(self):
        # A train prepared before midnight Pacific ships with the next day's number: notes for
        # another version stop ship.sh before the gap, the dry run, the hold or the release.
        load = self.root / 'load'; load.write_text('1.00')
        notes = self.notes('v27.1.121')
        ship = self.ship(load, self.fake_release(0), {'MIRA_RELEASE_NOTES_DIR': str(notes), 'MIRA_SHIP_GAP_S': '3600'})
        out, _ = ship.communicate(timeout=30)
        self.assertIn('Version: v', out)
        self.assertIn('the release notes are not for', (self.root / 'mira-ship-7.done').read_text())
        self.assertFalse((self.root / 'release-ran').exists())
        self.assertFalse((self.slots / 'hold').exists(), 'nothing was held')


if __name__ == '__main__':
    unittest.main()
