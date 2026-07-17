import { DurableObject } from "cloudflare:workers";

const MAX_SLOTS = 32;
const WORLD = 4200;
const START_LENGTH = 24;
const BOT_NAMES = [
  "ByteBite", "NoodleKing", "LagWizard", "PixelPete", "TurboWorm",
  "SnackHunter", "CodeCobra", "NeonNora", "GlitchGhost", "ZoomZilla",
  "LoopLizard", "CacheCat", "DataDrake", "PingPanda", "ScriptSnake",
  "KernelKai", "NullNoodle", "BitBandit", "FrameFiend", "PacketPup",
  "OrbitOllie", "JitterJim", "VectorViper", "RenderRex", "SocketSam",
  "CloudCobra", "BugBiter", "NeonNova", "PixelProwler", "ByteBoa",
  "TurboTess", "CacheCobra"
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const id = env.LOBBY.idFromName("global-lobby");
      return env.LOBBY.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class GlobalLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map();
    this.bots = new Map();
    this.lastBotUpdate = Date.now();
    this.lastBroadcast = 0;
    this.ensureBots();
  }

  makeBot(index) {
    return {
      id: `bot-${index}`,
      name: `${BOT_NAMES[index % BOT_NAMES.length]} (bot)`,
      x: 250 + Math.random() * (WORLD - 500),
      y: 250 + Math.random() * (WORLD - 500),
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      hue: (index * 47 + 25) % 360,
      length: START_LENGTH + Math.random() * 28,
      radius: 10,
      speed: 90 + Math.random() * 45,
      alive: true
    };
  }

  ensureBots() {
    const needed = Math.max(0, MAX_SLOTS - this.players.size);
    while (this.bots.size < needed) {
      let index = 0;
      while (this.bots.has(`bot-${index}`)) index++;
      this.bots.set(`bot-${index}`, this.makeBot(index));
    }
    while (this.bots.size > needed) {
      const key = [...this.bots.keys()].at(-1);
      this.bots.delete(key);
    }
  }

  updateBots() {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastBotUpdate) / 1000));
    this.lastBotUpdate = now;

    for (const bot of this.bots.values()) {
      if (Math.random() < dt * 0.8) {
        bot.targetAngle += (Math.random() - 0.5) * 1.5;
      }

      const delta = Math.atan2(
        Math.sin(bot.targetAngle - bot.angle),
        Math.cos(bot.targetAngle - bot.angle)
      );

      bot.angle += clamp(delta, -2.2 * dt, 2.2 * dt);
      bot.x += Math.cos(bot.angle) * bot.speed * dt;
      bot.y += Math.sin(bot.angle) * bot.speed * dt;

      if (bot.x < 120) bot.targetAngle = 0;
      if (bot.x > WORLD - 120) bot.targetAngle = Math.PI;
      if (bot.y < 120) bot.targetAngle = Math.PI / 2;
      if (bot.y > WORLD - 120) bot.targetAngle = -Math.PI / 2;

      bot.x = clamp(bot.x, 30, WORLD - 30);
      bot.y = clamp(bot.y, 30, WORLD - 30);
    }
  }

  entities() {
    return [
      ...[...this.players.values()].map(({ socket, ...player }) => player),
      ...this.bots.values()
    ];
  }

  roster() {
    return {
      type: "snapshot",
      maxSlots: MAX_SLOTS,
      humans: this.players.size,
      entities: this.entities()
    };
  }

  broadcast(payload) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch {}
    }
  }

  killEntity(victimId, x, y) {
    let victim = this.players.get(victimId);
    let isBot = false;

    if (!victim) {
      victim = this.bots.get(victimId);
      isBot = Boolean(victim);
    }
    if (!victim || victim.alive === false) return;

    victim.alive = false;
    const droppedLength = clamp(Number(victim.length) || START_LENGTH, START_LENGTH, 500);

    this.broadcast({
      type: "death",
      id: victimId,
      x: clamp(Number(x) || victim.x, 0, WORLD),
      y: clamp(Number(y) || victim.y, 0, WORLD),
      length: droppedLength,
      hue: victim.hue
    });

    if (isBot) {
      const botIndex = Number(victimId.split("-")[1]) || 0;
      this.bots.delete(victimId);
      setTimeout(() => {
        if (this.bots.size < Math.max(0, MAX_SLOTS - this.players.size)) {
          this.bots.set(victimId, this.makeBot(botIndex));
          this.broadcast(this.roster());
        }
      }, 1400);
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    if (this.players.size >= MAX_SLOTS) {
      return new Response("Lobby full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();

    this.ctx.acceptWebSocket(server, [id]);
    this.players.set(id, {
      socket: server,
      id,
      name: "Player",
      x: WORLD / 2 + (Math.random() - 0.5) * 500,
      y: WORLD / 2 + (Math.random() - 0.5) * 500,
      angle: 0,
      hue: Math.floor(Math.random() * 360),
      length: START_LENGTH,
      radius: 10,
      alive: true,
      updatedAt: Date.now()
    });

    this.ensureBots();
    server.send(JSON.stringify({ type: "welcome", id, maxSlots: MAX_SLOTS }));
    server.send(JSON.stringify(this.roster()));
    this.broadcast(this.roster());

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, rawMessage) {
    let data;
    try {
      data = JSON.parse(
        typeof rawMessage === "string"
          ? rawMessage
          : new TextDecoder().decode(rawMessage)
      );
    } catch {
      return;
    }

    const senderId = this.ctx.getTags(socket)[0];
    const player = this.players.get(senderId);
    if (!player) return;

    if (data.type === "state") {
      player.name = String(data.name || "Player").slice(0, 16);
      player.x = clamp(Number(data.x) || WORLD / 2, 0, WORLD);
      player.y = clamp(Number(data.y) || WORLD / 2, 0, WORLD);
      player.angle = Number(data.angle) || 0;
      player.hue = clamp(Number(data.hue) || 190, 0, 360);
      player.length = clamp(Number(data.length) || START_LENGTH, 15, 500);
      player.radius = clamp(Number(data.radius) || 10, 7, 24);
      player.alive = data.alive !== false;
      player.updatedAt = Date.now();
    }

    if (data.type === "collision" && typeof data.victimId === "string") {
      this.killEntity(data.victimId, data.x, data.y);
    }

    this.updateBots();
    const now = Date.now();
    if (now - this.lastBroadcast >= 50) {
      this.lastBroadcast = now;
      this.broadcast(this.roster());
    }
  }

  webSocketClose(socket) {
    const id = this.ctx.getTags(socket)[0];
    this.players.delete(id);
    this.ensureBots();
    this.broadcast(this.roster());
  }

  webSocketError(socket) {
    this.webSocketClose(socket);
  }
}
