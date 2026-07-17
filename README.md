# Neon Serpents Global Lobby v2

Changes:
- A player or bot dies when its head hits another snake's body.
- Your own body is still safe to cross.
- Death drops orb mass approximately equal to the dead snake's length.
- Live top-10 leaderboard for humans and bots.
- One automatic global lobby with 32 total entities.

Upload/replace these files in the existing GitHub repository, then let the connected Cloudflare Worker build deploy the new commit.

Important prototype limitation:
Collision reports are detected by clients and accepted by the lobby server. For a competitive game, collision validation should later move fully to the Durable Object.


## v3 updates
- Fixed invisible continued movement after death.
- Added a death screen with Respawn and Main menu buttons.
- Respawning keeps the existing global-lobby connection.
- Bots now hunt smaller players and bots.
- Bots prioritize human targets when practical.
- Bots avoid larger nearby snakes and arena walls.
- Bots aim ahead of targets and try to cut across their path.
- Remote-vs-remote collision checks allow bots to kill other bots.


## v0.4.0
- Unexpected WebSocket disconnects now trigger automatic reconnection.
- Reconnect attempts use exponential backoff with jitter.
- The game pauses while reconnecting instead of continuing invisibly.
- A reconnect screen shows connection status and offers manual retry.
- Returning to the main menu deliberately closes the connection and disables auto-reconnect.
- Returning to a suspended browser tab triggers an immediate reconnect check.
- The main menu now displays the game version in the bottom-left corner.


## v0.5.0
- Death orbs now spawn along the snake's actual final body path.
- Curves, loops, and S-shaped bodies preserve their shape when dropping mass.
- Body paths are sampled before being sent to reduce network traffic.
- The server validates and limits body-path data before broadcasting it.
- A small amount of scatter keeps dropped orb trails natural-looking.


## v0.6.0
- Fixed bots appearing to fly across the arena after reconnects or slot changes.
- Every newly spawned bot now receives a unique entity ID.
- Bot slot numbers remain logical server-side values and are no longer reused as network identity.
- Large remote position corrections now snap safely instead of interpolating across the entire map.
- Normal remote movement uses capped catch-up interpolation for smoother networking.
- Very stale remote entities are no longer drawn indefinitely.


## v0.7.0
- Fixed multiple bots stacking into one rainbow-colored snake.
- Bots now spawn in distributed arena cells rather than clustering randomly.
- Added strong close-range bot separation and collision avoidance.
- Bots use slot-dependent attack flanks so they do not follow identical paths.
- Bots trapped in an impossible stack are automatically replaced.
- Invalid or out-of-world bot positions are automatically repaired server-side.
- Client network coordinates are clamped to the world boundary.
- Invalid remote body segments are ignored and safely rebuilt.


## v0.8.0
- Added rare golden super orbs.
- Roughly 3.5% of naturally spawned food becomes a super orb.
- Super orbs award 100 score and about 3.4 length.
- Super orbs use a larger pulsing golden design with a sparkle.
- Death-orb trails remain normal mass drops and never randomly convert into super orbs.


## v0.9.0 playtest build
- Lobby reduced from 32 to 16 total entities.
- World size increased from 4200 to 6200.
- Base food count increased to suit the larger world.
- Local death now freezes instantly before the server responds.
- Movement, boosting, and animation stop immediately on death.
- Bot spawns are distributed across a 4x4 arena grid.
- Bot spawn points reject nearby crowded positions.
- Bot refill is rate-limited instead of happening instantly.
- Dead bots wait about five seconds before returning.
- Bot speed and hunting range were reduced for fairer play.
- Bot separation was increased to prevent crowding.
- Human and respawn positions are spread more widely.


## v1.0.0 playtest fixes
- Human capacity remains 16, but bots are capped at 6.
- Bots cannot spawn within 1100 world units of any living player.
- Bot respawns wait six seconds and may be delayed until a safe location exists.
- Food is now server-controlled and shared by all clients.
- Bots seek normal food and super orbs, eat them, grow longer, and become thicker.
- Players also become thicker as they grow.
- Collision radius, eyes, rendering, and camera zoom scale with snake thickness.
- Dead remote bodies are removed immediately.
- Head-to-head overlap no longer counts as a body collision.
- Only contact with a snake's body beyond its neck causes death.


## v1.0.1 collision and growth hotfix
- Fixed collision checks skipping the entire body of smaller snakes.
- Added swept collision detection between the previous and current head positions.
- Fast snakes can no longer tunnel through bodies between frames.
- Head-to-head contact remains non-lethal.
- Self-collision remains disabled.
- Fixed the local player not receiving server-authoritative length growth.
- Player thickness now updates correctly after eating.
- Score now increases when server-confirmed growth is received.


## v1.0.2 death ownership and spawning fix
- Fixed both players dying from one successful body collision.
- A browser can now report only its own snake's death.
- Clients no longer report deaths for remote players or bots.
- If a friend's head hits your body, only the friend's browser reports dying.
- Head-to-head contact remains non-lethal.
- Initial spawns are selected randomly by the server across the full map.
- Player spawns avoid nearby living players and bots.
- Respawning reconnects and receives a new safe random server-selected spawn.


## v1.0.3 visible size scaling
- Reworked the thickness formula so growth is clearly visible.
- Approximate radius progression:
  - Length 24: radius 11
  - Length 100: radius 15
  - Length 300: radius 20
  - Length 700: radius 27
- Larger snakes now have wider segment spacing.
- Heads, eyes, collisions, and body rendering scale with thickness.
- Camera zooms out more noticeably as the snake grows.
- Server and client now use the same size formula.
