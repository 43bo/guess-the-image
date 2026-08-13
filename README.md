# GUESSIT v2

Two-player online image guessing game.

## Rules
- Exactly 2 players per room.
- Player 1 creates the room and is the room controller.
- Player 1 is still a normal player: they cannot see their own image.
- Each player sees only the opponent's image.
- Player 1 chooses a category, but the server randomly deals two different images.
- Communication happens outside the game.
- There is no text/voice chat and no guess input.
- When a correct guess happens in the external conversation, Player 1 awards the point to Player 1 or Player 2.

## Categories
Food, Tools, Furniture, Countries, Football Players, Celebrities.

## Run
```bash
npm install
npm start
```
Open http://localhost:3000

Use two browser tabs/windows to test both players.

## Local image assets

Put your real images in these folders:

```text
public/assets/images/
├── food/
├── tools/
├── furniture/
├── countries/
├── football-players/
└── celebrities/
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

The server scans these folders automatically. The filename becomes the image name in the game. For example:

```text
public/assets/images/food/pizza.jpg
public/assets/images/food/burger.jpg
public/assets/images/tools/hammer.jpg
public/assets/images/football-players/cristiano-ronaldo.jpg
```

You do not need to edit `imageLibrary.js` when adding images. Each category must contain at least 2 images before it can start a round.

Images are intentionally not exposed as public static files. They are served only through a signed, temporary `/api/images/...` URL for the player who is supposed to see the opponent image.

## Image privacy
The server never sends a player their own image. Each player receives only `opponentImage`. Player 1's controller privileges do not change this.
