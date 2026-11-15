/** Reviewable main.ts integration, also used by reload-smoke without editing main.ts. */
export function integrateResume(code) {
  const replace = (before, after) => {
    if (!code.includes(before)) throw new Error(`main.ts integration anchor changed: ${before}`);
    code = code.replace(before, after);
  };
  replace("import { params, worldSeed }", "import { prepareResume, ResumeSession, RESUME_KEY } from './core/resume'\nimport { params, worldSeed }");
  replace("import { readVehicleChoice }", "import { readVehicleChoice, saveVehicleChoice }");
  replace('  const game = new Game(canvas)', `  const saved = prepareResume(query)
  if (saved && !query.has('room')) {
    query.set('room', saved.room)
    const url = new URL(location.href)
    url.searchParams.set('room', saved.room)
    history.replaceState(null, '', url)
  }
  const game = new Game(canvas)`);
  replace('  const choice = readVehicleChoice()', `  const choice = saved ? { vehicleKind: saved.kind, bodyColor: saved.colors.body, accentColor: saved.colors.accent } : readVehicleChoice()
  if (saved) saveVehicleChoice(choice)`);
  replace('      location.replace(url)', `      // An explicit lobby vehicle change starts a new session.
      try { sessionStorage.removeItem(RESUME_KEY) } catch {}
      location.replace(url)`);
  replace('    startNetworking({', `    const joinedRoom = shell.room || query.get('room') || 'lobby'
    const joinedUrl = new URL(location.href)
    joinedUrl.searchParams.set('room', joinedRoom)
    history.replaceState(null, '', joinedUrl)
    const connection = startNetworking({`);
  replace('  shell.onPlay = join', '  shell.onPlay = join');
  replace('      names: (seed, kind) => generateName(seed, kind),\n    })', `      names: (seed, kind) => generateName(seed, kind),
    })
    game.add(new ResumeSession({ game, terrain, player, room: shell.room || query.get('room') || 'lobby', saved, network: connection }))`);
  return code;
}
