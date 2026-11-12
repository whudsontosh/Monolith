# Changelog

## 1.6.0

- **Light and sight.** On a map with walls, each player now sees only what their own tokens can see.
  Walls, closed doors and curtains block the view, and opening a door shows what's behind it.
- **Explored areas stay on the map**, dimmed, and are remembered between sessions. Tokens only show
  where a player can see right now.
- **Darkness and lights.** A map can be lit, dim or dark. A new Lights tool (L) places lights,
  including beams. A token can carry a light, and can have dark sight.
- **Nothing hidden is sent.** A player's app only receives the tokens, doors and templates in their
  view, never the walls, the lights, or what is out of sight.
- The GM still sees everything. "Preview what players see" shows the party's view, or one player's
  when their token is selected.
- Map settings can turn this off for a map, and can forget the explored areas.

Maps that already have walls switch to this automatically. Set "Light and sight" to Off in Map
settings to keep a map fully visible.

## 1.5.0

- **Walls.** A new Walls tool (W) for the GM: click to draw walls corner by corner. Players' tokens
  stop at them. Players never see the lines.
- **Doors.** A door stops tokens while it's closed. Players open and close a door by clicking it when
  one of their tokens is next to it. The GM clicks a door to open it and Shift+clicks to lock it.
- **Windows, invisible walls and curtains** for places that stop movement but not sight, or the other
  way round. Sight starts to matter in the next release, lighting and vision.
- **Maps with walls already drawn.** "+ Image" now also takes Universal VTT files (.dd2vtt, .uvtt,
  .df2vtt) from map-making tools, and brings in the picture, the grid, the walls and the doors.

The GM's own tokens are not stopped by walls.

## 1.4.0

- **Conditions on tokens.** Right-click a token to mark it Stunned, Prone and so on. Badges show around
  the token, and hovering lists them. A condition can last a number of rounds and comes off by itself.
- **Height.** Give a token a height and it shows above it. The ruler counts the height difference
  when you measure from one token to another.
- **Auras.** The GM can give a token up to three rings that move with it, each with its own reach,
  color and who sees it. The token panel lists who each one reaches.
- Players can set conditions and height on their own tokens. The GM can turn that off in Map settings.
- Games can bring their own conditions and set them from their rules.

## 1.3.0

- **Area templates.** A new Template tool (T) lays a circle, cone, line or square on the map and rings
  every token it catches, with a count beside it. Sizes snap to whole squares or hexes and read in
  the map's units.
- Drag a template's dot to move it, and its square handle to turn or resize it. Delete removes it.
- Players can place and remove their own templates. The GM can turn that off in Map settings.
- Games can add ready-made templates (a Fireball, a grenade), choose how "caught" is decided, and
  place templates from their own rules.

## 1.2.0

- **Hex maps and maps with no grid.** Pick squares, hexes (flat or pointed top) or no grid in Map
  settings. Tokens snap to hexes, and the ruler counts them.
- **Diagonal rules for square grids:** straight line (as before), every diagonal counts as one square,
  or 1, 2, 1, 2. Games can set their own default.
- **Your own units.** A square or hex can be worth any number of any unit, such as 5 ft or 2 m.
- **Measure around corners.** With the ruler, Shift+click drops a point; a plain click ends the path.
- **Align the grid to a map picture** by drawing a box across a few of its squares or hexes.
- A player on an older Monolith than the GM is now asked to update before joining.

Maps you already have don't change.

## 1.1.1

- **Real dice physics.** Your dice are thrown from the dice button and fly, bounce, roll and knock into
  each other, using the edges of the window as walls, before settling on the numbers you rolled.
  The motion is smoother at any screen refresh rate.

## 1.1.0

- **3D dice.** When you roll, your dice tumble across your screen and land on the numbers you rolled.
  Everyone else at the table still sees just the result in their log.
- Turn them on or off with the **3D dice** switch in the dice tray. They start off if your computer
  is set to reduce motion.
- Each game can give the dice its own look: colors, font, and a highlight for the highest and
  lowest faces.

## 1.0.1

- **Dungeons and Dragons** joins the games list (beta): D&D 2024 rules with a step-by-step character
  creator, a full character sheet with rolls, and the GM's party screens.
- The list of games built into Monolith now includes it too, so it shows under More games even
  when the online list can't be reached.

## 1.0.0

The first version of Monolith: the app for tabletop games, with games as separate, signed downloads.

- Opens on your games. Choose a game, then Player or Game master.
- Installs games from Monolith's approved list, and updates each game when you open it.
  A game update never needs a new Monolith.
- Every game release and every Monolith update is checked against Monolith's signing key before it
  installs, and game files are checked again each time they load.
- Everyone at a table runs the GM's game version. If yours differs, Monolith gets that version and
  rejoins by itself.
- Characters, campaigns, version history, backup files, the map table, online hosting through
  Cloudflare, chat and the dice tray work the same for every game.
- A black-stone look with white edges for Monolith's own screens. Each game can bring its own look.
- Windows and Mac (Apple Silicon and Intel).
