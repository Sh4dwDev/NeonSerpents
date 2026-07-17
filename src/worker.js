import { DurableObject } from "cloudflare:workers";

const MAX_HUMANS = 16;
const MAX_BOTS = 6;
const WORLD = 6200;
const START_LENGTH = 24;
const FOOD_TARGET = 900;
const BOT_SAFE_SPAWN_RADIUS = 1100;
const BOT_NAMES = [
  "ByteBite", "NoodleKing", "LagWizard", "PixelPete", "TurboWorm",
  "SnackHunter", "CodeCobra", "NeonNora", "GlitchGhost", "ZoomZilla",
  "LoopLizard", "CacheCat", "DataDrake", "PingPanda", "ScriptSnake",
  "KernelKai"
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
    this.foods = [];
    this.lastBotUpdate = Date.now();
    this.lastBroadcast = 0;
    this.lastBotFill = 0;

    this.ensureFood();
    this.ensureBots(true);
  }

  radiusForLength(length) {
    // Visible size progression:
    // ~11 at length 24, ~15 at 100, ~20 at 300, ~27 at 700.
    return clamp(
      7.5 + Math.sqrt(Math.max(15, length)) * 0.75,
      10.5,
      29
    );
  }

  makeFood(
    x = 80 + Math.random() * (WORLD - 160),
    y = 80 + Math.random() * (WORLD - 160),
    value = 1,
    hue = Math.floor(Math.random() * 360),
    kind = "normal"
  ) {
    const isSuper = kind === "super" || (kind === "normal" && Math.random() < 0.035);

    return {
      id: crypto.randomUUID(),
      x,
      y,
      value: isSuper ? 5 : value,
      hue: isSuper ? 46 : hue,
      kind: isSuper ? "super" : kind
    };
  }

  ensureFood() {
    while (this.foods.length < FOOD_TARGET) {
      this.foods.push(this.makeFood());
    }

    if (this.foods.length > FOOD_TARGET + 700) {
      this.foods.splice(0, this.foods.length - (FOOD_TARGET + 700));
    }
  }

  isSafeBotSpawn(x, y) {
    for (const player of this.players.values()) {
      if (player.alive === false) continue;
      if (Math.hypot(x - player.x, y - player.y) < BOT_SAFE_SPAWN_RADIUS) {
        return false;
      }
    }

    for (const bot of this.bots.values()) {
      if (bot.alive === false) continue;
      if (Math.hypot(x - bot.x, y - bot.y) < 650) {
        return false;
      }
    }

    return true;
  }

  findSafeBotSpawn(index) {
    const columns = 3;
    const rows = 2;
    const column = index % columns;
    const row = Math.floor(index / columns) % rows;
    const cellWidth = (WORLD - 1600) / columns;
    const cellHeight = (WORLD - 1600) / rows;

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = attempt < 12
        ? 800 + column * cellWidth + Math.random() * cellWidth * 0.5
        : 650 + Math.random() * (WORLD - 1300);

      const y = attempt < 12
        ? 800 + row * cellHeight + Math.random() * cellHeight * 0.5
        : 650 + Math.random() * (WORLD - 1300);

      if (this.isSafeBotSpawn(x, y)) {
        return { x, y };
      }
    }

    return null;
  }

  makeBot(index) {
    const spawn = this.findSafeBotSpawn(index);
    if (!spawn) return null;

    const generation = crypto.randomUUID().slice(0, 8);
    const length = START_LENGTH + Math.random() * 16;

    return {
      id: `bot-${index}-${generation}`,
      slot: index,
      name: `${BOT_NAMES[index % BOT_NAMES.length]} (bot)`,
      x: spawn.x,
      y: spawn.y,
      angle: Math.random() * Math.PI * 2,
      targetAngle: Math.random() * Math.PI * 2,
      hue: (index * 57 + 25) % 360,
      length,
      radius: this.radiusForLength(length),
      speed: 90 + Math.random() * 20,
      alive: true,
      stuckTime: 0,
      lastX: spawn.x,
      lastY: spawn.y
    };
  }

  ensureBots(force = false) {
    const now = Date.now();
    const needed = Math.max(0, Math.min(MAX_BOTS, MAX_HUMANS - this.players.size));

    if (!force && now - this.lastBotFill < 2500) {
      return;
    }

    this.lastBotFill = now;

    let guard = 0;
    while (this.bots.size < needed && guard < 30) {
      guard++;
      const occupiedSlots = new Set(
        [...this.bots.values()].map(bot => Number(bot.slot))
      );

      let index = 0;
      while (occupiedSlots.has(index)) index++;

      const bot = this.makeBot(index);
      if (!bot) break;
      this.bots.set(bot.id, bot);
    }

    while (this.bots.size > needed) {
      const key = [...this.bots.keys()].at(-1);
      this.bots.delete(key);
    }
  }

  eatFood(entity) {
    const reach = entity.radius + 12;

    for (let i = this.foods.length - 1; i >= 0; i--) {
      const food = this.foods[i];
      const dx = food.x - entity.x;
      const dy = food.y - entity.y;

      if (dx * dx + dy * dy < reach * reach) {
        this.foods.splice(i, 1);

        const growth = food.kind === "super"
          ? 3.4
          : Math.max(0.5, food.value * 0.5);

        entity.length = clamp(entity.length + growth, 15, 700);
        entity.radius = this.radiusForLength(entity.length);
        break;
      }
    }
  }

  updateBots() {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastBotUpdate) / 1000));
    this.lastBotUpdate = now;

    const humans = [...this.players.values()].filter(player => player.alive !== false);
    const bots = [...this.bots.values()].filter(bot => bot.alive !== false);

    for (const bot of bots) {
      if (
        !Number.isFinite(bot.x) ||
        !Number.isFinite(bot.y) ||
        bot.x < 0 ||
        bot.y < 0 ||
        bot.x > WORLD ||
        bot.y > WORLD
      ) {
        this.bots.delete(bot.id);
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
      let nearestFood = null;
      let nearestFoodScore = Infinity;
      let separationX = 0;
      let separationY = 0;
      let separationStrength = 0;

      for (let i = 0; i < this.foods.length; i += 3) {
        const food = this.foods[i];
        const distance = Math.hypot(food.x - bot.x, food.y - bot.y);
        const score = distance - (food.kind === "super" ? 280 : 0);

        if (distance < 1050 && score < nearestFoodScore) {
          nearestFoodScore = score;
          nearestFood = food;
        }
      }

      for (const other of others) {
        const dx = other.x - bot.x;
        const dy = other.y - bot.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const sizeRatio = (other.length || START_LENGTH) / Math.max(bot.length, START_LENGTH);

        const separationRadius = other.isHuman ? 130 : 240;
        if (distance < separationRadius) {
          const strength = (separationRadius - distance) / separationRadius;
          separationX -= dx / distance * strength;
          separationY -= dy / distance * strength;
          separationStrength += strength;
        }

        if ((sizeRatio > 1.12 && distance < 560) || distance < 105) {
          if (distance < threatDistance) {
            threatDistance = distance;
            nearestThreat = other;
          }
        }

        if (sizeRatio < 0.9 && distance < 700) {
          const humanBonus = other.isHuman ? 180 : 0;
          const score = 850 - distance + humanBonus + (1 - sizeRatio) * 220;

          if (score > targetScore) {
            targetScore = score;
            bestTarget = other;
          }
        }
      }

      if (separationStrength > 0.08) {
        bot.targetAngle = Math.atan2(separationY, separationX);
        bot.speed = 128;
      } else if (nearestThreat) {
        bot.targetAngle = Math.atan2(
          bot.y - nearestThreat.y,
          bot.x - nearestThreat.x
        );
        bot.speed = 126;
      } else if (bestTarget && Math.random() < 0.62) {
        const lead = 70;
        const tx = bestTarget.x + Math.cos(bestTarget.angle || 0) * lead;
        const ty = bestTarget.y + Math.sin(bestTarget.angle || 0) * lead;
        bot.targetAngle = Math.atan2(ty - bot.y, tx - bot.x);
        bot.speed = 120;
      } else if (nearestFood) {
        bot.targetAngle = Math.atan2(
          nearestFood.y - bot.y,
          nearestFood.x - bot.x
        );
        bot.speed = 110;
      } else if (Math.random() < dt * 0.8) {
        bot.targetAngle += (Math.random() - 0.5) * 1.2;
      }

      const wallMargin = 300;
      if (bot.x < wallMargin) bot.targetAngle = 0;
      if (bot.x > WORLD - wallMargin) bot.targetAngle = Math.PI;
      if (bot.y < wallMargin) bot.targetAngle = Math.PI / 2;
      if (bot.y > WORLD - wallMargin) bot.targetAngle = -Math.PI / 2;

      const delta = Math.atan2(
        Math.sin(bot.targetAngle - bot.angle),
        Math.cos(bot.targetAngle - bot.angle)
      );

      const turnSpeed = separationStrength > 0.08 ? 4 : 2.5;
      bot.angle += clamp(delta, -turnSpeed * dt, turnSpeed * dt);
      bot.x += Math.cos(bot.angle) * bot.speed * dt;
      bot.y += Math.sin(bot.angle) * bot.speed * dt;
      bot.x = clamp(bot.x, 35, WORLD - 35);
      bot.y = clamp(bot.y, 35, WORLD - 35);

      this.eatFood(bot);
    }

    this.ensureFood();
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
      maxHumans: MAX_HUMANS,
      humans: this.players.size,
      entities: this.entities(),
      foods: this.foods
    };
  }

  broadcast(payload) {
    const message = JSON.stringify(payload);

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {}
    }
  }

  dropBodyOrbs(victim, body) {
    const path = Array.isArray(body)
      ? body
          .slice(0, 180)
          .filter(point =>
            Number.isFinite(Number(point?.x)) &&
            Number.isFinite(Number(point?.y))
          )
          .map(point => ({
            x: clamp(Number(point.x), 0, WORLD),
            y: clamp(Number(point.y), 0, WORLD)
          }))
      : [];

    const safePath = path.length ? path : [{ x: victim.x, y: victim.y }];
    const orbCount = clamp(Math.round((victim.length || START_LENGTH) * 0.72), 16, 320);
    const value = Math.max(1, (victim.length || START_LENGTH) / orbCount);

    const cumulative = [0];
    let total = 0;

    for (let i = 1; i < safePath.length; i++) {
      total += Math.hypot(
        safePath[i].x - safePath[i - 1].x,
        safePath[i].y - safePath[i - 1].y
      );
      cumulative.push(total);
    }

    for (let i = 0; i < orbCount; i++) {
      let x = victim.x;
      let y = victim.y;

      if (safePath.length === 1 || total < 1) {
        x = safePath[0].x;
        y = safePath[0].y;
      } else {
        const wanted = (i / Math.max(1, orbCount - 1)) * total;
        let segmentIndex = 1;

        while (
          segmentIndex < cumulative.length - 1 &&
          cumulative[segmentIndex] < wanted
        ) {
          segmentIndex++;
        }

        const startDistance = cumulative[segmentIndex - 1];
        const segmentDistance = Math.max(
          0.001,
          cumulative[segmentIndex] - startDistance
        );

        const amount = clamp(
          (wanted - startDistance) / segmentDistance,
          0,
          1
        );

        const start = safePath[segmentIndex - 1];
        const end = safePath[segmentIndex];

        x = start.x + (end.x - start.x) * amount;
        y = start.y + (end.y - start.y) * amount;
      }

      const scatterAngle = Math.random() * Math.PI * 2;
      const scatter = Math.random() * 10;

      this.foods.push(this.makeFood(
        clamp(x + Math.cos(scatterAngle) * scatter, 0, WORLD),
        clamp(y + Math.sin(scatterAngle) * scatter, 0, WORLD),
        value,
        victim.hue,
        "death"
      ));
    }

    this.ensureFood();
  }

  killEntity(victimId, body = []) {
    const player = this.players.get(victimId);
    const bot = this.bots.get(victimId);
    const victim = player || bot;

    if (!victim || victim.alive === false) return;

    victim.alive = false;
    this.dropBodyOrbs(victim, body);

    this.broadcast({
      type: "death",
      id: victimId
    });

    if (bot) {
      this.bots.delete(victimId);

      setTimeout(() => {
        this.ensureBots(false);
        this.broadcast(this.roster());
      }, 6000);
    }
  }


  findSafePlayerSpawn() {
    const minDistanceFromPlayers = 900;
    const minDistanceFromBots = 750;

    for (let attempt = 0; attempt < 80; attempt++) {
      const x = 500 + Math.random() * (WORLD - 1000);
      const y = 500 + Math.random() * (WORLD - 1000);

      let safe = true;

      for (const player of this.players.values()) {
        if (player.alive === false) continue;

        if (Math.hypot(x - player.x, y - player.y) < minDistanceFromPlayers) {
          safe = false;
          break;
        }
      }

      if (!safe) continue;

      for (const bot of this.bots.values()) {
        if (bot.alive === false) continue;

        if (Math.hypot(x - bot.x, y - bot.y) < minDistanceFromBots) {
          safe = false;
          break;
        }
      }

      if (safe) {
        return {
          x,
          y,
          angle: Math.random() * Math.PI * 2,
          hue: Math.floor(Math.random() * 360)
        };
      }
    }

    return {
      x: WORLD / 2 + (Math.random() - 0.5) * 1600,
      y: WORLD / 2 + (Math.random() - 0.5) * 1600,
      angle: Math.random() * Math.PI * 2,
      hue: Math.floor(Math.random() * 360)
    };
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }

    if (this.players.size >= MAX_HUMANS) {
      return new Response("Lobby full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();

    this.ctx.acceptWebSocket(server, [id]);

    const spawn = this.findSafePlayerSpawn();

    this.players.set(id, {
      socket: server,
      id,
      name: "Player",
      x: spawn.x,
      y: spawn.y,
      angle: spawn.angle,
      hue: spawn.hue,
      length: START_LENGTH,
      radius: this.radiusForLength(START_LENGTH),
      alive: true,
      updatedAt: Date.now()
    });

    this.ensureBots(false);

    server.send(JSON.stringify({
      type: "welcome",
      id,
      maxHumans: MAX_HUMANS,
      spawn: {
        x: spawn.x,
        y: spawn.y,
        angle: spawn.angle,
        hue: spawn.hue
      }
    }));

    server.send(JSON.stringify(this.roster()));
    this.broadcast(this.roster());

    return new Response(null, {
      status: 101,
      webSocket: client
    });
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
      player.length = clamp(Number(data.length) || START_LENGTH, 15, 700);
      player.radius = this.radiusForLength(player.length);
      player.alive = data.alive !== false;
      player.updatedAt = Date.now();

      this.eatFood(player);
    }

    if (data.type === "collision") {
      // A client may only report its own death. This prevents two clients
      // from killing each other from conflicting collision reports.
      this.killEntity(senderId, data.body);
    }

    this.updateBots();

    const now = Date.now();
    if (now - this.lastBroadcast >= 70) {
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
