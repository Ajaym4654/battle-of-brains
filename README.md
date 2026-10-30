# Battle of Brains

A mobile-friendly, room-code multiplayer trivia game built as a static frontend plus a Netlify Function backed by Netlify Blobs.

## Deploy

1. Upload the ZIP to Netlify Drop or deploy this folder to a Netlify site.
2. Netlify detects `netlify.toml`, installs `@netlify/blobs`, and deploys `netlify/functions/game.mjs`.
3. Open the deployed URL in two separate browsers/devices and create/join a room.

No third-party API key or manual database setup is required.

## Important implementation notes

- The function uses a Netlify Blobs store with strong-consistency reads.
- Writes request `onlyIfNewer` to reduce stale overwrites.
- Clients poll the function once per second; the server owns question timing and scoring.
- This is a challenge/demo-scale implementation. Netlify Blobs conditional writes are not a full transactional compare-and-swap database. For high-concurrency production tournaments, use a transactional database or dedicated realtime service.
- Rooms expire after six hours of inactivity.
- Host can start a game only after at least two players have joined and all players are ready.

## Game rules

Three rounds, five questions each, 15 seconds per question. Correct answer = 100 points. Correct answer within 5 seconds earns +50; within 10 seconds earns +25. Maximum total = 2,250 points.
