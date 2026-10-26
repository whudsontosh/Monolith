# Developing Monolith and its games

A hands-on guide for working on Monolith yourself: setting up a PC, running a developer copy,
changing the Cyberpunk game, making a new game and publishing it. Commands are for Windows
PowerShell unless they say otherwise; Mac Terminal versions follow where they differ.

The game contract itself (every hook a game can provide) is in the [README](README.md#making-a-game-the-game-contract-api-version-1).
This guide is the "how do I actually work on it" companion.

---

## 1. One-time setup

Install these (all free):

| Tool | Get it | Why |
|---|---|---|
| Git | git-scm.com | Download the repos and push changes |
| Node.js 22 LTS | nodejs.org | Runs Monolith (Electron) and the signing script |
| Python 3 | **Microsoft Store** ("Python 3.12" or newer) | Builds the pages and runs the tests. The Store version gives you the `python3` command that `npm start` uses; the python.org installer only gives `python` and `py`. |
| VS Code | code.visualstudio.com | Editor. Optional extensions: ESLint, Prettier. |
| GitHub CLI (optional) | cli.github.com | Watch releases and Actions from the terminal |

Then put the repositories side by side in one folder, for example `Documents\dev\`:

```powershell
mkdir $HOME\Documents\dev; cd $HOME\Documents\dev
git clone https://github.com/whudsontosh/monolith
git clone https://github.com/whudsontosh/monolith-cyberpunk
cd monolith
npm install          # installs Electron (~200 MB, once)
```

Check it works:

```powershell
npm start            # builds the pages, then opens a developer copy of Monolith
```

The developer copy shows the games from the approved list (installed from GitHub as usual) plus
anything you load from a folder (next section).

**It uses the same saved data as the installed Monolith** (characters, campaigns, settings), so before experimenting
with real campaigns, download a backup of them (Backups → Download), or make a throwaway
campaign to test on.

**For the tests** (optional but worth it):

```powershell
pip install playwright==1.55.0
python3 -m playwright install chromium
```

---

## 2. The fast loop: run a game from a folder

You never need to sign or release anything to try a change. A developer copy of Monolith loads
games straight from folders listed in `MONOLITH_DEV_GAMES`:

```powershell
# Windows PowerShell, from the monolith folder
$env:MONOLITH_DEV_GAMES = "..\monolith-cyberpunk\dist\game"
npm start
```

```sh
# Mac
MONOLITH_DEV_GAMES=../monolith-cyberpunk/dist/game npm start
```

Several folders: separate them with `;` on Windows or `:` on Mac. A folder game appears on the
shelf even if it isn't in `games.json`.

The everyday loop for Cyberpunk:

1. Edit a file in `monolith-cyberpunk\src\`.
2. Rebuild it: `python3 ..\monolith-cyberpunk\src\build.py` (it joins the source files into `dist\game\`).
3. In the Monolith window, press **Ctrl+R** to reload. (Cmd+R on Mac.)

A small game with no build step (like the starter below) skips step 2: point
`MONOLITH_DEV_GAMES` at its folder and just reload.

**Your two best friends:**

- **Ctrl+Shift+I** opens DevTools in the window (Cmd+Option+I on Mac).
  - *Console*: red errors show the file and line. You can also type code there to poke at the
    running game, for example `curChar()` to see the open character or `st.party` on the GM side.
  - *Elements*: click any part of the page and edit its CSS live, then copy what works into your
    stylesheet.
- **`Dice.raw(...)` and `showNotice("text")`** are quick ways to print something visible while testing.

If you change Monolith itself (anything in `monolith\`), close the window and run `npm start`
again; it rebuilds `app\` from `src\` each time.

---

## 3. Where things live

**monolith** (the app every game shares)

| Path | What's in it |
|---|---|
| `main.js`, `preload.js` | The Electron app: windows, menus, the bridge pages talk to |
| `games.js`, `games.json`, `signing.js` | Installing, checking and serving games; the approved list; the public key |
| `server.js`, `tunnel.js` | The table server and Cloudflare links |
| `src/core/` | Helpers every page shares: `util.js` (`d`, `uid`, `clone`, `clamp`, `esc`…), `ui.js`, `dice.js`, `map.js`, `table.js`, `store.js`, `print.js`, `zip.js`, `monolith.js` (game loading) |
| `src/player/`, `src/gm/` | The player's roster and joining; the GM's campaigns, hosting and map |
| `src/build.py` | Builds `app/` (what Electron shows) from `src/` |
| `testgame/` | The smallest possible game. Your template. |

**monolith-cyberpunk** (one game)

| Path | What's in it |
|---|---|
| `game.json` | Id, version, which Monolith it needs, its files |
| `src/rules.js` | Stats, roles, skills, the catalog (weapons, armor, cyberware, gear) |
| `src/player.js`, `src/gm.js` | The builder and sheet; the GM screens |
| `src/net*.js`, `src/med*.js` | Netrunning; Trauma Team |
| `src/game.js` | Registration: the one place that tells Monolith what the game provides |
| `src/build.py` | `SHARED` and `BUNDLES` decide which files go into `player.js` and `gm.js` |

When you add a new source file to Cyberpunk, add its name to the right list in `BUNDLES` in
`src/build.py`, or it won't be included.

---

## 4. Changes you can make without much JavaScript

These are the safest places to start, and they cover a lot of what used to need a session:

- **Prices, damage, stats of items**: the catalog arrays in `monolith-cyberpunk/src/rules.js`.
  Each item is one line of data; copy a similar line and change the values.
- **Wording**: search the source (Ctrl+Shift+F in VS Code) for the text you see on screen.
- **Colours and spacing**: `monolith-cyberpunk/src/skin.css` (the tokens at the top set the colours).
- **New gear, roles, skills, cyberware for a campaign**: make a **homebrew pack** in the GM's
  Homebrew tab. No code, no release.

After each change: rebuild, reload, look, and run the tests (section 7) before you push.

---

## 5. Making a new game

### Start from the starter

Make a folder next to the others, for example `Documents\dev\monolith-mygame\`, with these two
files. This is a tested, working game: characters with three stats, a 2D6 roll with a verdict,
a roster card, and an extra GM tab.

**`game.json`**

```json
{
  "format": "monolith-game",
  "id": "mygame",
  "name": "My Game",
  "version": "0.1.0",
  "api": 1,
  "minMonolith": "1.0.0",
  "tagline": "A starter game to build on.",
  "rulesets": [{ "id": "core", "name": "Core rules" }],
  "entry": { "player": ["game.js"], "gm": ["game.js"] },
  "css": []
}
```

**`game.js`**

```js
/* My Game: a character has a name and three stats. A move rolls 2D6 + a stat:
   10+ is a hit, 7-9 a partial hit, 6 or less a miss. */
"use strict";
const STATS = ["grit", "wits", "charm"];

function mgBlank() {
  return { id: uid(), name: "", grit: 0, wits: 0, charm: 0, harm: 0, done: false,
           createdAt: Date.now(), updatedAt: Date.now() };
}
function mgNormalize(x) {
  const c = { ...mgBlank(), ...clone(x) };
  STATS.forEach(s => { c[s] = clamp(Number(c[s]) || 0, -1, 3); });
  c.harm = clamp(Number(c.harm) || 0, 0, 6);
  return c;
}

/* ---------- the player's sheet ---------- */
function mgSheet(c) {
  const ed = canEditChar(c);
  const rows = STATS.map(s => `
    <div class="row">
      <span class="label" style="width:70px">${s}</span>
      <input type="number" min="-1" max="3" data-mg="${s}" value="${c[s]}" style="width:70px" ${ed ? "" : "disabled"}>
      <button class="btn sm" data-act="mg-roll" data-s="${s}">Roll +${s}</button>
    </div>`).join("");
  return `<div class="roster-head"><h1><small>My Game</small>${esc(c.name || "Unnamed")}</h1></div>
    <section class="panel"><div class="panel-b" style="display:grid;gap:12px">
      <div class="field"><label class="label" for="mg-name">Name</label>
        <input id="mg-name" data-mg="name" value="${esc(c.name)}" ${ed ? "" : "disabled"}></div>
      ${rows}
      <div class="row"><button class="btn primary" data-act="mg-done">${c.done ? "Finished" : "Finish"}</button></div>
    </div></section>`;
}

A["mg-roll"] = el => {
  const c = curChar() || myChar(); if (!c) return;
  const stat = el.dataset.s, a = d(6), b = d(6), total = a + b + c[stat];
  const tag = total >= 10 ? { t: "Hit", c: "green" } : total >= 7 ? { t: "Partial", c: "amber" } : { t: "Miss", c: "red" };
  Dice.raw("Roll +" + stat, `${a} + ${b} ${sgn(c[stat])}`, total, c.name, [tag]);
};
A["mg-done"] = () => { const c = curChar(); if (!c || !canEditChar(c)) return; c.done = true; saveChar(c, true); render(); };

document.addEventListener("input", ev => {
  const el = ev.target; if (!el.dataset.mg || typeof curChar !== "function") return;
  const c = curChar(); if (!c || !canEditChar(c)) return;
  const k = el.dataset.mg;
  c[k] = k === "name" ? el.value : clamp(Number(el.value) || 0, -1, 3);
  saveChar(c);
});

/* ---------- the GM's extra tab ---------- */
function mgHarmTab() {
  const rows = st.party.map(c => `<tr><td>${esc(c.name || "Unnamed")}</td><td>${c.harm}/6</td></tr>`).join("");
  return `<section class="panel"><div class="panel-b">
    <h2>Harm</h2>
    ${rows ? `<table><tr><th>Character</th><th>Harm</th></tr>${rows}</table>` : `<p class="faint">Nobody has joined yet.</p>`}
  </div></section>`;
}

/* ---------- telling Monolith about the game ---------- */
Monolith.registerGame({
  id: "mygame", api: 1, diceLabel: "2D6",
  rulesets: { core: {
    name: "Core rules",
    character: {
      blank: mgBlank, normalize: mgNormalize,
      isCharacter: x => !!(x && typeof x === "object" && "grit" in x),
      isFinished: c => !!c.done, joined: c => { c.done = true; },
      label: c => c.name || "Unnamed",
      card: c => ({ name: c.name || "Unnamed", sub: `Grit ${c.grit} · Wits ${c.wits} · Charm ${c.charm}`,
                    color: "#556070", initial: (c.name || "?").charAt(0).toUpperCase(),
                    chips: c.done ? [] : [{ t: "Draft", c: "blue" }] }),
    },
    player: { views: { sheet: c => mgSheet(c) }, openView: () => "sheet" },
    gm: { tabs: [{ id: "harm", label: () => "Harm", view: mgHarmTab, order: 20 }] },
  }},
});
```

Run it:

```powershell
cd ..\monolith
$env:MONOLITH_DEV_GAMES = "..\monolith-mygame"
npm start
```

### How the pieces work

- **A page is a string of HTML.** Each view function (`mgSheet`, `mgHarmTab`) returns HTML;
  Monolith draws it and redraws when you call `render()`.
- **Always wrap player text in `esc(...)`** before putting it in HTML. It stops a name like
  `<script>` from breaking the page.
- **Buttons** get `data-act="name"`; clicking runs `A["name"](button)`. Extra data rides along as
  `data-*` attributes (`el.dataset.s` above). Prefix your action names with your game's initials
  so they never clash with the core's.
- **Saving**: change the character object, then `saveChar(c)` (debounced) or `saveChar(c, true)`
  (now). Monolith handles storage, backups, version history and sending it to the GM.
- **`normalize`** is your safety net: every character loaded from a file, a backup or the network
  goes through it. Fill in missing fields and clamp numbers there, and old characters keep working
  when you add new fields.
- **Rolls**: `d(6)` rolls one die; `Dice.raw(label, detail, total, who, tags)` puts the result in the
  shared dice log (and at the table, everyone's log). Tag tones: `green`, `red`, `amber`, `blue`, `ink`.
- **Player vs GM**: the same `game.js` loads on both pages here. On the player page you have
  `curChar()`, `myChar()`, `saveChar()`; on the GM page you have `st` (the campaign: `st.party`,
  `st.npcs`…) and `save()`. As a game grows, split it like Cyberpunk does: shared rules in one file,
  `player.js` and `gm.js` for each side, joined by a `build.py`.
- **Game messages at the table**: `gameSend(type, data)` from a player, `gameBroadcast(type, data)` or
  `gameSendTo(conn, type, data)` from the GM, received by the ruleset's `player.onMessage` and
  `gm.onMessage`.

The README's contract table lists every optional hook. Cyberpunk's `src/game.js` uses most of them,
so it's the best worked example of each.

### Choosing the id

The `id` is permanent: saved characters and campaigns are filed under it. Use lowercase letters,
numbers and dashes (`mygame`, `dnd5e`, `blades`). Pick the real name before your first release.

---

## 6. Publishing a new game

Do this once per game, when the folder version is good enough to share.

1. **Make the repository** on github.com: `whudsontosh/monolith-<game>` (it must be under your
   account; the approved list rejects anything else). Push your folder to it.
2. **Copy the release machinery from `monolith-cyberpunk`:**
   - `scripts/sign.js` and `scripts/release-notes.py` (no changes needed).
   - `.gitignore`.
   - `src/build.py`. For a one-file game, change `SHARED` to `[]`, `BUNDLES` to
     `{"game.js": ["game.js"]}`, and delete the `fonts` lines if you have no fonts. Move your
     `game.js` into `src/`. The output layout (`dist/game/`, `dist/release/`) must stay the same.
   - `.github/workflows/release.yml`. Change the workflow name and `--title "Cyberpunk $V"`.
     It runs `python3 tests/run_all.py`; either copy `tests/harness.py`, `tests/run_all.py` and
     `tests/contract_test.py` and trim them to your game, or remove the test step until you have tests.
3. **Add the signing key secret**: on GitHub, the repository's **Settings → Secrets and variables →
   Actions → New repository secret**. Name `MONOLITH_SIGNING_KEY`, value: the whole text of the
   private key file in `Documents\Monolith signing key\` (including the `BEGIN`/`END` lines).
4. **Write a `CHANGELOG.md`** with a `## 0.1.0` section, set `"version": "0.1.0"` in `game.json`, push
   to `main`. The Action builds, signs and publishes release `v0.1.0` (Actions tab to watch it).
5. **Add it to the approved list**: in `monolith/games.json`, add an entry next to Cyberpunk:

   ```json
   { "id": "mygame", "name": "My Game", "repo": "whudsontosh/monolith-mygame",
     "tagline": "A starter game to build on.", "rulesets": [{ "id": "core", "name": "Core rules" }] }
   ```

   Push that to `monolith`'s `main`. Installed copies of Monolith read the list on launch, so no
   app release is needed for this; the game appears under **More games**.

**Never commit the private key.** The `.gitignore` excludes `*.pem`, but keep the key file outside
the repository folders anyway.

### Releasing an update to a game

Bump `version` in `game.json` (0.1.0 → 0.1.1 for fixes, 0.2.0 for features), add a matching
`## 0.1.1` section to `CHANGELOG.md`, push to `main`. Players get it the next time they open the
game. Pushing without a version bump only runs the tests.

If the update needs something new in Monolith, release Monolith first, then raise `minMonolith` in
the game's `game.json`.

**Run workflow** on the Actions tab tests any branch without publishing; use it to try risky changes.

---

## 7. Testing

**Cyberpunk** (needs `..\monolith` built with `python3 src/build.py`):

```powershell
cd monolith-cyberpunk
python3 src/build.py
python3 tests/run_all.py          # all 12 suites, a few minutes
python3 tests/med_test.py         # just one
```

**Monolith:**

```powershell
node tests/games_test.js
python3 tests/core_test.py
```

**Your own game**: start with checking it by hand in the developer copy. When it grows, copy
`monolith-cyberpunk/tests/harness.py` and `contract_test.py` into your game's `tests/` folder and
adapt them: the harness opens Monolith's player and GM pages in a headless browser with your game
loaded, and each check is one `ok(condition, "what it proves")` line.

When a test fails on GitHub, the error appears as an annotation on the Action's summary page, so
you rarely need the full log.

---

## 8. Git in five commands

```powershell
git status                     # what changed
git add -A                     # stage everything
git commit -m "Shop: fix RPG-A price"
git push                       # send to GitHub (main = may release if the version changed)
git pull                       # get changes made elsewhere (e.g. by a Claude session)
```

For bigger experiments, work on a branch so `main` stays releasable:

```powershell
git switch -c vehicles         # new branch
git push -u origin vehicles    # first push of the branch
# ...when it's done, open a pull request on GitHub and merge it into main
```

Always `git pull` before you start if a Claude session might have pushed since you last worked.

---

## 9. Using AI where it counts

You'll get the most out of fewer, smaller sessions:

- **Do it yourself**: data and prices, wording, CSS, new homebrew, adding a field to a character,
  version bumps and changelogs.
- **Ask for help with**: new rules engines (a combat system, a new game's core loop), tricky bugs,
  anything touching networking, signing or `main.js`.
- **Keep requests narrow**: "In `monolith-mygame/src/game.js`, add a harm track to the sheet with
  buttons to raise and lower it" costs far less than "add combat to my game."
- **Paste the error** from the DevTools console, with the file and line. That's usually all a fix needs.
- **Start a new session per feature**, and keep the project notes current so nothing needs
  re-explaining.

## 10. Learning resources

- **MDN JavaScript Guide** (developer.mozilla.org): the reference for the language and the browser.
- **javascript.info**: a clear, free, front-to-back course. Parts 1 and 2 cover everything used here.
- **freeCodeCamp**: "JavaScript Algorithms and Data Structures" and "Responsive Web Design" if you
  like exercises.
- **GitHub Skills** (skills.github.com): short interactive Git and Actions courses.

The fastest teacher, though, is the code you already have: pick a feature you know well in
Cyberpunk, find it in `src/`, and change something small about it.
