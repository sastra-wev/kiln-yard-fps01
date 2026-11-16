# kiln-yard

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/sastra-wev/kiln-yard-fps01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/sastra-wev/kiln-yard-fps01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

Kiln Yard is a round-based tactical FPS for the browser, built on three.js: five Casters against five Wardens in a brick foundry yard at dusk. Rounds are won by eliminating the other team or by the objective — the Casters plant a breach charge at the Kiln Hall or the Casting Yard and defend it for 40 seconds; the Wardens defuse it or run the clock out. Money earned each round buys rifles, a scoped Longshot, armour and frag and smoke grenades in the buy phase. The gunplay is the tactical kind: headshots pay fourfold, spread blooms while you move or jump and settles when you stop and crouch, and the bots — who navigate a waypoint graph, hold angles, listen for gunfire and retake sites — play by exactly the same rules. First to 9 rounds. Single player against bots, no network, no build step: static files and an import map. An attract mode (?demo=1) plays bot-versus-bot under a roaming camera, and staged scenes (?shot=start|play|plant|end&seed=1) reproduce the screenshots in screenshots/.

## Run it

```sh
node main.ts
```

That hands the game in (copies game/ and screenshots/ to /output and writes the dossier). To play: serve game/ with any static file server — for example `python3 -m http.server -d game 8080` — open http://localhost:8080 in desktop Chrome and click Play. WASD and mouse to fight, B to buy, E to plant, Tab for the scoreboard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=b0hspa3m&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
