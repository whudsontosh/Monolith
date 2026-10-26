# Monolith

Monolith is a desktop app for playing tabletop games with friends: characters, campaigns, a
GM console and an online map table. The app itself knows no rules. Each game is a separate,
signed download that installs and updates itself from inside Monolith.

The first game is **Cyberpunk** (Cyberpunk 2020), from
[whudsontosh/monolith-cyberpunk](https://github.com/whudsontosh/monolith-cyberpunk).

## Install

**Windows:** download `Monolith-Setup-<version>.exe` from the
[latest release](https://github.com/whudsontosh/monolith/releases/latest) and run it.
Windows may warn that the app is from an unknown publisher: choose **More info → Run anyway**.

**Mac (Apple Silicon and Intel):** download `Monolith-<version>.dmg`, open it and drag Monolith to
Applications. The first time, macOS may refuse to open it: open **System Settings → Privacy &
Security** and choose **Open Anyway**.

Monolith updates itself when it starts. Games update themselves when you open them.

## Using it

1. Monolith opens on your games. The first time, install Cyberpunk from **More games**.
2. Choose a game, then **Player** or **Game master**.
3. A GM hosts from **Host game** and sends the invite code. Players paste it into **Join game**.

Everyone at a table runs exactly the game version the GM runs. If a player's version differs,
Monolith fetches the GM's version and rejoins by itself.

Your data lives in `Documents/Monolith` (map images and backup files). Characters and campaigns
autosave as you work; backup files are written a few seconds after each change, one per day for 30 days.

## How games are kept safe

Games are code, so Monolith only runs games published from this account and signed:

| Check | What it does |
|---|---|
| Approved list | `games.json` in this repository lists each game and its repository. Only repositories owned by `whudsontosh` are accepted, and a copy of the list is built into the app. |
| Releases only | Games come from GitHub Releases, never from a branch. |
| Signature | Each game release has `release.json` and `release.json.sig`. The signature is checked against the public key built into Monolith (`signing.js`). `release.json` lists the SHA-256 of the zip and of every file in it. |
| Checked when served | Windows load games from `game://<id>/<version>/<file>`. Every file is checked against its signed SHA-256 each time it's served, so a file changed after install won't run. |
| No desktop access | A game runs inside the window and talks to Monolith only through the core. The desktop bridge is claimed by the core before game code loads, and each request to the app is checked against the window that made it. |

Monolith's own updates are signed the same way: `latest.json` must verify against the same key.

Homebrew packs and campaign packages are data, not code: anyone can make and share them, and
they're validated when read.

## The signing key

Releases of Monolith and of every game are signed with one Ed25519 key.

- The **public key** is in `signing.js` (fingerprint `3b01cb1cfef8ad7c`).
- The **private key** is stored as the `MONOLITH_SIGNING_KEY` Actions secret in this repository and in
  each game's repository, so the release workflows can sign. Keep an offline copy somewhere safe.
- If the private key is ever lost, new releases can't be signed: you'd publish a Monolith with a new
  public key, and people would install it by hand once.
- If it ever leaks, do the same, and remove the old key from `signing.js`.

To sign something by hand: `node scripts/sign.js --key <private-key.pem> <file>`.

## Publishing

**Monolith:** bump `version` in `package.json`, add a section to `CHANGELOG.md`, push to `main`.
The workflow runs the tests, builds the Windows installer and the Mac app, checks both on real
machines, signs `latest.json` and publishes the release.

**A game:** bump `version` in the game's `game.json`, add a `CHANGELOG.md` section, push. Its
workflow tests it against the latest Monolith, signs and publishes it. No app build is needed.

**A new game:** make a repository like `monolith-cyberpunk`, add the `MONOLITH_SIGNING_KEY`
secret, publish a first release, then add it to `games.json` here. Installed copies pick it up
on their next launch.

## Making a game (the game contract, API version 1)

A game is a folder with `game.json`, its scripts, an optional stylesheet and fonts:

```json
{
  "format": "monolith-game", "id": "cyberpunk", "name": "Cyberpunk", "version": "1.0.0",
  "api": 1, "minMonolith": "1.0.0",
  "rulesets": [{ "id": "cp2020", "name": "Cyberpunk 2020" }],
  "entry": { "player": ["player.js"], "gm": ["gm.js"] },
  "css": ["skin.css"], "skin": "cyberpunk"
}
```

Its script calls `Monolith.registerGame({ id, api: 1, rulesets: { <id>: ruleset } })`. A ruleset:

| Part | Needed | Used for |
|---|---|---|
| `name` | yes | Shown with the game name |
| `character.blank()`, `normalize(x)`, `isCharacter(x)`, `isFinished(c)`, `label(c)`, `card(c)` | yes | Making, loading, checking and listing characters. `card(c)` returns `{name, sub, color, initial, chips, stats, meter, openLabel, actions, corner}` |
| `character.joined(c)`, `summary(c)`, `sample`, `copy(c)`, `beforeSave(c)` | no | Joining a table, version history notes, an example character |
| `player.views`, `openView(c)`, `onOpen(c)` | yes for players | The game's own screens for a character (a builder, a sheet) |
| `player.charNoun`, `rosterTitle`, `newCard()`, `navExtra()`, `backupExtra()`, `tablePanel(c)`, `onMessage(type, m)`, `onPeek(info)`, `boot()` | no | Wording, extra nav buttons, the panel beside the map, game messages |
| `campaign.defaults()`, `normalize(s, d)`, `summary(s)`, `firstName`, `newOptions()`, `applyNewOptions(s)` | no | The game's own campaign data |
| `gm.tabs` | no | Extra GM tabs `[{id, label(), view(), order}]` (core tabs: party 10, map 30, campaign 60) |
| `gm.partyTable(list)`, `characterView(c)`, `partyActions()`, `campaignExtra()`, `mapSideExtra(m)`, `campaignsActions()` | no | Richer party and campaign screens |
| `gm.tokenRing(t)`, `activeTurn()`, `tokenInfo(t)`, `tokenButtons(m)` | no | Health rings, whose turn it is, token details on the map |
| `gm.onJoined(conn)`, `onPeek(conn)`, `onMessage(conn, info, type, m)`, `onRemoveCharacter(id)`, `removeNotes(c)`, `boot()` | no | Game messages and bookkeeping at the table |

The registration can also give `brand(role)` (the game's wordmark in the top bar) and `diceLabel`.

Games use the core's helpers (all documented in `src/core`): `patch`, `rg`, `A` (click actions),
`CHANGE`, `MODALS`, `BEFORE_RENDER`, `FILE_HANDLERS`, `Dice`, `Tray`, `Print`, `showNotice`,
`Monolith.store` (the game's own saved data), `Monolith.files`, `Monolith.zip`, `Monolith.theme.map`,
and at the table `gameSend(type, data)` (player) and `gameSendTo(conn, type, data)` /
`gameBroadcast(type, data)` (GM). Game messages travel as `{t:"game", game, type, ...}`.

Roll entries carry their verdicts as tags: `Dice.raw(label, detail, total, who, [{t:"Success", c:"green"}])`.
Tones are `green`, `red`, `amber`, `blue` and `ink`.

`tests/core_test.py` uses a tiny game in `testgame/` that provides only the required parts.

### Trying a game before publishing

A developer copy of Monolith (run from source, never the installed app) can load games from folders:

```sh
npm install
MONOLITH_DEV_GAMES=../monolith-cyberpunk/dist/game npm start
```

## Future Plans

 - Community games manager
 - Full documentation for community builds

## Developing Monolith

New to working on Monolith or making a game? Start with [DEVELOPING.md](DEVELOPING.md): setup, the
folder-game loop, a starter game, publishing and testing.

```sh
npm install
python3 src/build.py        # builds app/ (desktop pages) and web/ (the same pages for a browser)
npm start                   # runs the developer copy
node tests/games_test.js    # game manager and signatures
python3 tests/core_test.py  # core screens with the test game
python3 tests/e2e.py        # the desktop app end to end (needs a built game; see the file)
```

Source layout: `main.js`, `preload.js`, `games.js` (installing and serving games),
`signing.js`, `updater.js`, `server.js` (the table server), `tunnel.js` (Cloudflare links);
`src/core` (helpers every page shares), `src/player`, `src/gm`, `src/launcher.js` (the game shelf).
