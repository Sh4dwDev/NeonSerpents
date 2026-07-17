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
