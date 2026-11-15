# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/iashauzora/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/iashauzora/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Foundry District — an original round-based tactical FPS built on three.js 0.187.0, in the style Counter-Strike made famous but with its own map, art and names. Two teams (Embers vs Wardens) fight over a dusk smelter yard with three lanes, two charge sites (Smelter A / Depot B), a per-round economy and buy menu (five firearms plus frag and flash grenades, armour), and bots that run site plans over a waypoint graph, see in cones, hear gunfire, plant and defuse. Gunplay rewards stopping to aim: head/body/leg damage bands, recoil and bloom that punish firing on the move, crouch accuracy, magazine reloads. The simulation runs at a fixed step, apart from rendering, in modules with one job each. Entry point main.ts copies game/ and screenshots/ to the output directory and writes the dossier the judge reads.

## Run it

```sh
# play it locally (serves game/ at http://localhost:8080):
node serve.ts

# hand the game in (what the grader runs):
MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
