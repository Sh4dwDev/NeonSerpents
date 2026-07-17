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
