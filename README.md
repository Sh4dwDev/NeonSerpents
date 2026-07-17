# Neon Serpents — Global Lobby

This version uses one Cloudflare Durable Object as a global 32-slot lobby.
Human players join automatically. Bots fill every unused slot.

## Deploy

1. Install Node.js.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Run `npx wrangler login`.
5. Run `npm run deploy`.
6. Open the `workers.dev` URL shown by Wrangler and send it to your friend.

You do not need room codes. Everyone opening the same deployment joins the same lobby.

## Local development

Run `npm run dev`, then open the local URL in two browser windows.

## Important prototype limitations

- Movement is client-authoritative, so cheating is possible.
- Food is generated locally and is not yet synchronized.
- Other players and bots are synchronized through the Durable Object.
- Self-collision is disabled, allowing you to cross your body and circle opponents.
