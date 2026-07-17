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
    this.lastFoodBroadcast = 0;
    this.lastBotFill = 0;
    this.lastBotCollisionCheck = 0;

    // Keep-alive: the runtime auto-replies "pong" to a "ping" without even
    // waking the object. This keeps proxies/load balancers from dropping an
    // otherwise-quiet connection and avoids hibernation-related closes.
    try {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong")
      );
    } catch {}

    this.ensureFood();
    this.ensureBots(true);
  }

  radiusForLength(length) {
    // Faster, more visible size progression:
    // ~15 at length 24, ~21 at 100, ~29 at 300, ~40 at 700.
    return clamp(
      9 + Math.sqrt(Math.max(15, length)) * 1.15,
      13,
      44
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
      lastY: spawn.y,
      prevX: spawn.x,
      prevY: spawn.y,
      // Server-side body trail so bots can collide with each other. Bots have
      // no browser to report their own death, so the server must detect it.
      trail: [{ x: spawn.x, y: spawn.y }]
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

      // Only re-decide on a fixed cadence. Running the AI on every incoming
      // network message made bots re-pick a heading dozens of times per second,
      // which is what caused the constant jitter. Between decisions the bot just
      // keeps steering toward its current target, so motion stays smooth.
      if (!bot.nextThink) bot.nextThink = 0;
      const shouldThink = now >= bot.nextThink;

      if (shouldThink) {
        bot.nextThink = now + 120 + Math.random() * 70;

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

          if ((sizeRatio > 1.12 && distance < 430) || distance < 92) {
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
          // Imperfect escape angle so bots are easier to trap and juke.
          bot.targetAngle = Math.atan2(
            bot.y - nearestThreat.y,
            bot.x - nearestThreat.x
          ) + (Math.random() - 0.5) * 0.9;
          bot.speed = 118;
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
        } else if (Math.random() < 0.25) {
          bot.targetAngle += (Math.random() - 0.5) * 1.2;
        }

        // Lower turn rates make bots slower to react, so their jukes are worse.
        bot.turnSpeed = separationStrength > 0.08 ? 2.6 : 1.8;
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

      const turnSpeed = bot.turnSpeed || 1.8;
      bot.angle += clamp(delta, -turnSpeed * dt, turnSpeed * dt);
      bot.prevX = bot.x;
      bot.prevY = bot.y;
      bot.x += Math.cos(bot.angle) * bot.speed * dt;
      bot.y += Math.sin(bot.angle) * bot.speed * dt;
      bot.x = clamp(bot.x, 35, WORLD - 35);
      bot.y = clamp(bot.y, 35, WORLD - 35);

      this.updateBotTrail(bot);
      this.eatFood(bot);
    }

    this.detectBotCollisions(now);

    this.ensureFood();
    // Refill bots reliably here (self-throttled) rather than depending only on
    // the delayed timer in killEntity, which can be lost if the DO hibernates.
    this.ensureBots(false);
  }

  updateBotTrail(bot) {
    if (!bot.trail || bot.trail.length === 0) {
      bot.trail = [{ x: bot.x, y: bot.y }];
    }

    bot.trail[0].x = bot.x;
    bot.trail[0].y = bot.y;

    const spacing = Math.max(7, bot.radius * 0.9);
    for (let i = 1; i < bot.trail.length; i++) {
      const a = bot.trail[i - 1];
      const b = bot.trail[i];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      b.x = a.x - dx / d * spacing;
      b.y = a.y - dy / d * spacing;
    }

    // Cap the tracked body so long bots stay cheap to simulate.
    const wanted = Math.min(160, Math.max(15, Math.floor(bot.length)));
    while (bot.trail.length < wanted) {
      const tail = bot.trail[bot.trail.length - 1];
      bot.trail.push({ x: tail.x, y: tail.y });
    }
    while (bot.trail.length > wanted) {
      bot.trail.pop();
    }
  }

  detectBotCollisions(now) {
    // Bots have no browser to report their own death, so the server resolves
    // bot-vs-bot collisions here. Throttled so a burst of messages can't run
    // this every few milliseconds.
    if (now - this.lastBotCollisionCheck < 55) return;
    this.lastBotCollisionCheck = now;

    const liveBots = [...this.bots.values()].filter(bot => bot.alive !== false);
    const dead = [];

    for (const bot of liveBots) {
      if (!Number.isFinite(bot.x) || !Number.isFinite(bot.y)) continue;

      for (const other of liveBots) {
        if (other === bot || other.alive === false) continue;
        if (!other.trail || other.trail.length < 7) continue;

        // Skip the other bot's head/neck so touching heads isn't an instant
        // mutual kill; only running into the body counts.
        const neck = Math.min(8, Math.max(4, Math.floor(other.trail.length * 0.12)));
        const hit = bot.radius + other.radius * 0.5;
        const hitSquared = hit * hit;
        let killed = false;

        for (let i = neck; i < other.trail.length - 1; i++) {
          const a = other.trail[i];
          const b = other.trail[i + 1];
          if (this.pointSegmentDistanceSquared(bot.x, bot.y, a.x, a.y, b.x, b.y) <= hitSquared) {
            killed = true;
            break;
          }
        }

        if (killed) {
          dead.push(bot);
          break;
        }
      }
    }

    for (const bot of dead) {
      this.killEntity(bot.id, bot.trail);
    }
  }

  pointSegmentDistanceSquared(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared < 0.0001) {
      return (px - ax) ** 2 + (py - ay) ** 2;
    }

    const amount = clamp(
      ((px - ax) * dx + (py - ay) * dy) / lengthSquared,
      0,
      1
    );

    const nearestX = ax + dx * amount;
    const nearestY = ay + dy * amount;
    return (px - nearestX) ** 2 + (py - nearestY) ** 2;
  }

  entities() {
    // Emit only the fields the client needs. In particular this drops each
    // bot's server-side `trail` (up to 160 points) so it never bloats the
    // frequent position broadcasts.
    const shape = e => ({
      id: e.id,
      name: e.name,
      x: e.x,
      y: e.y,
      angle: e.angle,
      hue: e.hue,
      length: e.length,
      radius: e.radius,
      alive: e.alive
    });

    return [
      ...[...this.players.values()].map(shape),
      ...[...this.bots.values()].map(shape)
    ];
  }

  roster(includeFoods = true) {
    const snapshot = {
      type: "snapshot",
      maxHumans: MAX_HUMANS,
      humans: this.players.size,
      entities: this.entities()
    };

    // The food array is large; only sync it periodically. Entity positions go
    // out on every broadcast so other players move in near real time without
    // paying the food bandwidth each frame.
    if (includeFoods) {
      snapshot.foods = this.foods;
    }

    return snapshot;
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
    // A single bad frame or edge case must never close the connection and
    // force the player to reconnect, so the whole handler is guarded.
    try {
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
      if (!senderId) return;

      let player = this.players.get(senderId);

      // If the Durable Object hibernated or was evicted, its in-memory state
      // is gone but the socket is still attached. Rebuild the player's entry
      // from their own incoming state so the game heals itself instead of
      // forcing a reconnect.
      if (!player && data.type === "state") {
        player = {
          socket,
          id: senderId,
          name: "Player",
          x: WORLD / 2,
          y: WORLD / 2,
          angle: 0,
          hue: 190,
          length: START_LENGTH,
          radius: this.radiusForLength(START_LENGTH),
          alive: true,
          updatedAt: Date.now()
        };
        this.players.set(senderId, player);
        this.ensureBots(false);
      }

      if (!player) return;

      // Keep the live socket reference current in case it changed after a wake.
      player.socket = socket;

      if (data.type === "state") {
        const previousLength = player.length;

        player.name = String(data.name || "Player").slice(0, 16);
        player.x = clamp(Number(data.x) || WORLD / 2, 0, WORLD);
        player.y = clamp(Number(data.y) || WORLD / 2, 0, WORLD);
        player.angle = Number(data.angle) || 0;
        player.hue = clamp(Number(data.hue) || 190, 0, 360);
        player.length = clamp(Number(data.length) || START_LENGTH, 15, 700);
        player.radius = this.radiusForLength(player.length);
        player.alive = data.alive !== false;
        player.updatedAt = Date.now();

        // Boosting burns length. Shed that mass as orbs behind the snake — one
        // orb per unit of length lost, like slither.io. Small drops only, so a
        // respawn or correction never dumps a giant pile.
        const lost = previousLength - player.length;
        if (player.alive && lost > 0 && lost < 8) {
          player.boostDrop = (player.boostDrop || 0) + lost;

          let guard = 0;
          while (player.boostDrop >= 1 && guard < 12) {
            player.boostDrop -= 1;
            guard++;

            // Place the orb well behind the head so the snake can't instantly
            // eat its own dropped mass.
            const back = player.radius + 24;
            const dropX = player.x - Math.cos(player.angle) * back + (Math.random() - 0.5) * 12;
            const dropY = player.y - Math.sin(player.angle) * back + (Math.random() - 0.5) * 12;

            this.foods.push(this.makeFood(
              clamp(dropX, 0, WORLD),
              clamp(dropY, 0, WORLD),
              1,
              player.hue,
              "boost"
            ));
          }
        }

        this.eatFood(player);
      }

      if (data.type === "collision") {
        // A client may only report its own death. This prevents two clients
        // from killing each other from conflicting collision reports.
        this.killEntity(senderId, data.body);
      }

      if (data.type === "kill") {
        // Bots cannot report their own deaths, so the player they collided with
        // reports it for them. Only bots may be killed this way — a human death
        // must still be self-reported, so player-vs-player stays uncheatable.
        const targetId = String(data.id || "");
        if (targetId.startsWith("bot-") && this.bots.has(targetId)) {
          this.killEntity(targetId, data.body);
        }
      }

      this.updateBots();

      const now = Date.now();
      if (now - this.lastBroadcast >= 50) {
        this.lastBroadcast = now;

        // Sync the heavy food array only a few times a second; positions every
        // broadcast. This keeps other players near real time while cutting the
        // bandwidth that was causing lag spikes and dropped connections.
        const includeFoods = now - this.lastFoodBroadcast >= 200;
        if (includeFoods) this.lastFoodBroadcast = now;

        this.broadcast(this.roster(includeFoods));
      }
    } catch {
      // Swallow unexpected errors; dropping one frame is fine, dropping the
      // whole connection is not.
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
