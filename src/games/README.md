# Games

Every folder in here with an `index.ts` that exports `game` (a `GameDefinition`,
see `types.ts`) is a game. The home screen lists them by `order`, and each one
lives at `#/<id>`. Nothing has to be registered anywhere: `registry.ts` finds the
folders itself at build time with `import.meta.glob`.

## Adding a game

1. Make `src/games/<id>/` with an `index.ts`:

   ```ts
   import { lazy } from 'react';
   import type { GameDefinition } from '../types';

   export const game: GameDefinition = {
       id: 'canasta',
       title: 'Canasta',
       tagline: 'Two decks, jokers wild, first to five thousand.',
       mark: '🃏',
       order: 1,
       component: lazy(() => import('./CanastaGame')),
   };
   ```

2. Everything else - rules, store, components, styles, tests - goes in that
   folder. The component is the whole screen: wrap it in `GameShell` and it
   gets the cloth and the toolbar for free.

## The shared kit, `src/games/shared/`

- **`GameShell`** - the frame: cloth, toolbar with the Home button,
  "Cookie's <title>", your `stats` pills and `actions` buttons, and a settings
  cog whose panel already holds Sound and Table. Add your own `<section>`s with
  `settings` (pass a function to receive `close`). Children fill the space under
  the bar (`.board-area`, which is `position: relative`). Also exports `Stat`
  (a toolbar pill), `Confirm` (a yes-or-no dialog in the app's style) and
  `Notice` (a short message over the bottom of the table).
- **`cards.ts`** - `PlayingCard` (a card from a double deck with jokers, with its
  own identity: `queen_hearts_1`, `joker_2`), `buildDoubleDeck(jokers)`,
  `shuffled(items, random)`, `isJoker`, `isRedCard`, `cardName`, `turned`.
  Treat cards as immutable.
- **`PlayingCard`** - the card view for page flow: face images, the Cookie
  back, a drawn joker, a flip when `isFaceUp` changes, `selected`, `dimmed`,
  `highlighted`, `onClick`. Sized by the CSS variable `--card-w` on any ancestor
  (84px by default), so a whole table can be resized at once. Cards are tracked
  by identity (`layoutId`): render the same card inside a new parent and it
  flies there on its own. Pass `animate={false}` for the face-down stock, and
  draw a stock as a stack of at most three backs, never the whole pile.
- Solitaire's `src/components/Card.tsx` belongs to its absolute-position layout
  engine. Do not use it elsewhere.
- Seeded shuffles: `mulberry32(seed)` and `randomSeed()` in
  `src/utils/gameLogic.ts`.

## Theme

- Cloth: `body[data-felt]` with `--felt-light` and `--felt-dark`
  (`src/index.css`). `GameShell` paints it; do not paint your own background.
- Buttons: `.btn`, `.btn-primary` (gold, the main thing to do), `.btn-gold`
  (pulsing, for "you can finish now"), `.btn-icon`, `.btn-lg`. Under 860px the
  text inside `.btn` is hidden except on `.btn-primary`, so give every button an
  icon from `lucide-react` as well.
- Settings rows: `.row-btn`, `.row-check`, `.row-note`. End-of-hand panel: the
  `.win-panel` family in `src/App.css` (cream card on the cloth, Georgia
  heading in `#8a5a12`). Toasts: `.table-notice`.
- Type and colour: Georgia for headings and the brand; gold `#ffd977`; cream
  `#f6f0e4`; dark panel `#1b2b21`. Big, calm, forgiving. The player is Cookie,
  who loves cards and is not a programmer: plain words, no rules jargon without
  a hint of what it means, and a line that always says what to do next.
- Sounds, `src/utils/sound.ts`: `playDeal`, `playShuffle`, `playPickup`,
  `playPlace`, `playFlip`, `playInvalid`, `playClick`, `playHint`, `playUndo`,
  `playWin`. Call `unlockAudio()` from a user gesture first (the Home screen and
  `GameShell` buttons already do).

## Rules of the road - several people work in this checkout at once

- Touch only `src/games/<your id>/`. Do not edit the shared kit, solitaire's
  files, `App.css`, `index.css`, `index.html`, `package.json` or the configs.
  If the kit lacks something, build it inside your folder.
- Do not create `src/games/shared/index.ts`; the registry would take it for a
  game.
- localStorage keys start with `cookie-<id>-`.
- Tests: vitest, node environment, `*.test.ts` beside the code, pure rules
  only. `npx vitest run src/games/<id>` runs yours; `npm test` runs everything.
- Checking: `npm run build` type-checks the whole project and can fail on
  another game's half-finished files. Then check your own with
  `npx tsc --noEmit -p tsconfig.app.json | grep "src/games/<id>"` and
  `npx eslint src/games/<id>`.
- Dev server: `preview_start` with the `cookie-solitaire` configuration
  (port 5180). If it is already running it is shared, with hot reload for
  everyone; open `http://localhost:5180/#/<id>`. Never start a second server.
- Git: this project commits straight to `main` and Netlify deploys it within
  about fifteen seconds, so a commit is a release. Commit only once the game is
  playable end to end, then commit polish as you go. Stage and commit your
  folder alone: `git add src/games/<id>` then
  `git commit -m "feat: ..." -- src/games/<id>` then `git push`. Never
  `git add -A`, `git commit -a`, `git stash`, `git checkout .`, `git reset` or
  `git rebase`. If git reports `index.lock`, wait a few seconds and try again.
  If a push is refused, stop and say so rather than forcing.
