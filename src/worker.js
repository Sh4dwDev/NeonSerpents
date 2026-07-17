import { DurableObject } from "cloudflare:workers";

const MAX_SLOTS = 16;
const WORLD = 6200;
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
    this.lastBotFill = 0;
    this.ensureBots(true);
  }

  makeBot(index) {
    const generation = crypto.randomUUID().slice(0, 8);

    const columns = 4;
    const rows = 4;
    const column = index % columns;
    const row = Math.floor(index / columns) % rows;
    const cellWidth = (WORLD - 1200) / columns;
    const cellHeight = (WORLD - 1200) / rows;

    const x = 600 + column * cellWidth + Math.random() * cellWidth * 0.55;
    const y = 600 + row * cellHeight + Math.random() * cellHeight * 0.55;

    return {
      id: `bot-${index}-${generation}`,
      slot: index,
      name: `${BOT_NAMES[index % BOT_NAMES.length]} (bot)`,
      x,
      y,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      hue: (index * 47 + 25) % 360,
      length: START_LENGTH + Math.random() * 18,
      radius: 10,
      speed: 88 + Math.random() * 24,
      alive: true,
      stuckTime: 0,
      lastX: x,
      lastY: y
    };
  }

  ensureBots(force = false) {
    const now = Date.now();
    const needed = Math.max(0, MAX_SLOTS - this.players.size);

    // Do not instantly refill repeatedly during joins, reconnects, or deaths.
    if (!force && now - this.lastBotFill < 1800) {
      return;
    }
    this.lastBotFill = now;

    while (this.bots.size < needed) {
      const occupiedSlots = new Set(
        [...this.bots.values()].map(bot => Number(bot.slot))
      );

      let index = 0;
      while (occupiedSlots.has(index)) index++;

      const bot = this.makeBot(index);

      // Reject crowded spawn points.
      let attempts = 0;
      while (attempts < 24) {
        let crowded = false;

        for (const other of [
          ...this.players.values(),
          ...this.bots.values()
        ]) {
          if (Math.hypot(bot.x - other.x, bot.y - other.y) < 520) {
            crowded = true;
            break;
          }
        }

        if (!crowded) break;

        bot.x = 450 + Math.random() * (WORLD - 900);
        bot.y = 450 + Math.random() * (WORLD - 900);
        attempts++;
      }

      this.bots.set(bot.id, bot);
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

    const humans = [...this.players.values()].filter(player => player.alive !== false);
    const bots = [...this.bots.values()].filter(bot => bot.alive !== false);

    for (const bot of bots) {
      // Recover immediately from invalid or out-of-world state.
      if (
        !Number.isFinite(bot.x) ||
        !Number.isFinite(bot.y) ||
        bot.x < 0 ||
        bot.y < 0 ||
        bot.x > WORLD ||
        bot.y > WORLD
      ) {
        const replacement = this.makeBot(Number(bot.slot) || 0);
        this.bots.delete(bot.id);
        this.bots.set(replacement.id, replacement);
        continue;
      }

      const others = [
        ...humans.map(player => ({ ...player, isHuman: true })),
        ...bots
          .filter(other => other.id !== bot.id)
          .map(other => ({ ...other, isHuman: false }))
      ];

      let nearestThreat = null;
      let threatDistance = Infinity;
      let bestTarget = null;
      let targetScore = -Infinity;

      let separationX = 0;
      let separationY = 0;
      let separationStrength = 0;
      let dangerouslyStacked = false;

      for (const other of others) {
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const sizeRatio = (other.length || START_LENGTH) / Math.max(bot.length, START_LENGTH);

        // Strong local repulsion prevents rainbow stacking.
        // Bots separate more strongly from other bots than from prey.
        const separationRadius = other.isHuman ? 105 : 190;
        if (distance < separationRadius) {
          const strength = (separationRadius - distance) / separationRadius;
          separationX -= dx / distance * strength;
          separationY -= dy / distance * strength;
          separationStrength += strength;

          if (!other.isHuman && distance < 24) {
            dangerouslyStacked = true;
          }
        }

        if ((sizeRatio > 1.12 && distance < 520) || distance < 100) {
          if (distance < threatDistance) {
            threatDistance = distance;
            nearestThreat = other;
          }
        }

        if (sizeRatio < 0.92 && distance < 760) {
          const humanBonus = other.isHuman ? 260 : 0;
          const sizeBonus = (1 - sizeRatio) * 300;
          const score = 1100 - distance + humanBonus + sizeBonus;

          if (score > targetScore) {
            targetScore = score;
            bestTarget = other;
          }
        }
      }

      if (separationStrength > 0.05) {
        const separationAngle = Math.atan2(separationY, separationX);

        // At very close range, separation overrides hunting completely.
        if (separationStrength > 0.55 || dangerouslyStacked) {
          bot.targetAngle = separationAngle;
          bot.speed = 138;
        } else {
          // Otherwise blend separation into the current intended path.
          const intendedX = Math.cos(bot.targetAngle);
          const intendedY = Math.sin(bot.targetAngle);
          bot.targetAngle = Math.atan2(
            intendedY + separationY * 1.8,
            intendedX + separationX * 1.8
          );
        }
      } else if (nearestThreat) {
        const away = Math.atan2(bot.y - nearestThreat.y, bot.x - nearestThreat.x);
        const sidestep = Math.sin(now / 480 + bot.hue) * 0.55;
        bot.targetAngle = away + sidestep;
        bot.speed = 132;
      } else if (bestTarget) {
        const leadDistance = Math.min(150, 45 + (bestTarget.speed || 120) * 0.5);
        const targetX = bestTarget.x + Math.cos(bestTarget.angle || 0) * leadDistance;
        const targetY = bestTarget.y + Math.sin(bestTarget.angle || 0) * leadDistance;

        // Different slots choose different flank directions so they do not
        // all attack along one identical line.
        const side = (Number(bot.slot) || 0) % 2 === 0 ? 1 : -1;
        const flank = 55 + ((Number(bot.slot) || 0) % 4) * 14;
        const sideX = -Math.sin(bestTarget.angle || 0) * flank * side;
        const sideY = Math.cos(bestTarget.angle || 0) * flank * side;

        bot.targetAngle = Math.atan2(
          targetY + sideY - bot.y,
          targetX + sideX - bot.x
        );
        bot.speed = 122 + ((Number(bot.slot) || 0) % 5) * 2;
      } else {
        if (Math.random() < dt * 0.9) {
          bot.targetAngle += (Math.random() - 0.5) * 1.3;
        }
        bot.speed += (112 + Math.random() * 18 - bot.speed) * Math.min(1, dt * 2);
      }

      const wallMargin = 250;
      if (bot.x < wallMargin) bot.targetAngle = 0;
      if (bot.x > WORLD - wallMargin) bot.targetAngle = Math.PI;
      if (bot.y < wallMargin) bot.targetAngle = Math.PI / 2;
      if (bot.y > WORLD - wallMargin) bot.targetAngle = -Math.PI / 2;

      const delta = Math.atan2(
        Math.sin(bot.targetAngle - bot.angle),
        Math.cos(bot.targetAngle - bot.angle)
      );

      const turnSpeed = dangerouslyStacked
        ? 5.5
        : separationStrength > 0.05
          ? 4.2
          : nearestThreat
            ? 3.4
            : bestTarget
              ? 2.8
              : 2.1;

      bot.angle += clamp(delta, -turnSpeed * dt, turnSpeed * dt);
      bot.x += Math.cos(bot.angle) * bot.speed * dt;
      bot.y += Math.sin(bot.angle) * bot.speed * dt;

      bot.x = clamp(bot.x, 35, WORLD - 35);
      bot.y = clamp(bot.y, 35, WORLD - 35);

      // Detect bots that barely move because they are trapped inside a stack.
      const moved = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY);
      if (moved < 1.2 && dangerouslyStacked) {
        bot.stuckTime = (bot.stuckTime || 0) + dt;
      } else {
        bot.stuckTime = Math.max(0, (bot.stuckTime || 0) - dt * 2);
      }

      bot.lastX = bot.x;
      bot.lastY = bot.y;

      if (bot.stuckTime > 1.2) {
        const replacement = this.makeBot(Number(bot.slot) || 0);
        this.bots.delete(bot.id);
        this.bots.set(replacement.id, replacement);
      }
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

  killEntity(victimId, x, y, body = []) {
    let victim = this.players.get(victimId);
    let isBot = false;

    if (!victim) {
      victim = this.bots.get(victimId);
      isBot = Boolean(victim);
    }
    if (!victim || victim.alive === false) return;

    victim.alive = false;
    const droppedLength = clamp(Number(victim.length) || START_LENGTH, START_LENGTH, 500);

    const safeBody = Array.isArray(body)
      ? body
          .slice(0, 160)
          .filter(point =>
            Number.isFinite(Number(point?.x)) &&
            Number.isFinite(Number(point?.y))
          )
          .map(point => ({
            x: clamp(Number(point.x), 0, WORLD),
            y: clamp(Number(point.y), 0, WORLD)
          }))
      : [];

    this.broadcast({
      type: "death",
      id: victimId,
      x: clamp(Number(x) || victim.x, 0, WORLD),
      y: clamp(Number(y) || victim.y, 0, WORLD),
      length: droppedLength,
      hue: victim.hue,
      body: safeBody
    });

    if (isBot) {
      const botIndex = Number(victim.slot) || 0;
      this.bots.delete(victimId);

      setTimeout(() => {
        if (this.bots.size < Math.max(0, MAX_SLOTS - this.players.size)) {
          const replacement = this.makeBot(botIndex);
          this.bots.set(replacement.id, replacement);
          this.broadcast(this.roster());
        }
      }, 5000);
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

    this.ensureBots(false);
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
      this.killEntity(data.victimId, data.x, data.y, data.body);
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
    this.ensureBots(false);
    this.broadcast(this.roster());
  }

  webSocketError(socket) {
    this.webSocketClose(socket);
  }
}
