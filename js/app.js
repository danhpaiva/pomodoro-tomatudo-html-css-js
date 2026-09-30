// Renderizacao (canvas) + UI + loop principal.
// O bichinho e um tomate que murcha e derrete sob pressao (em vez de virar
// demonio) — mesma maquina de estados de pet.js, metafora visual nova.

(() => {
  const APP_NAME = "Tomatudo";
  const STORAGE_KEY = "pomodoro-pet:v1";
  const SPRITE = 64; // resolucao logica do tomate
  const CALYX_LEAVES = 5;

  // Paleta
  const TEXT = [236, 239, 246];
  const MUTED = [140, 148, 166];
  const FOCUS_ACCENT = [255, 96, 96];
  const BREAK_ACCENT = [86, 220, 140];
  const INK = [30, 22, 28];
  const EYE_SCLERA = [255, 246, 235];
  const STEAM = [220, 232, 245];
  const SPARK = [255, 226, 120];

  // Corpo do tomate: viçoso (energia alta) -> murcho/derretido (energia baixa)
  const TOMATO_RIPE = [224, 67, 47];
  const TOMATO_WILT = [122, 74, 52];
  const CALYX_FRESH = [94, 165, 90];
  const CALYX_WILT = [124, 106, 58];
  const PUDDLE = [156, 47, 34];

  const JOY_TIME = 1.8;
  const ALERT_TIME = 1.6;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
  const shade = (c, f) => c.map((v) => Math.round(v * f));
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const smoothstep = (lo, hi, v) => {
    const t = clamp((v - lo) / (hi - lo), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Cor do corpo (e da barra de energia) segue a mesma logica: viçoso e
  // vermelho vivo com energia alta, e vai desbotando para um marrom murcho.
  function tomatoColor(energy) {
    return mix(TOMATO_WILT, TOMATO_RIPE, clamp(energy / 100, 0, 1));
  }

  // PomodoroPet, FOCUS, BREAK, FOCUS_DONE, BREAK_DONE, BREAK_STARTED vem de pet.js
  // (scripts classicos compartilham o mesmo escopo global lexical).
  const pet = new PomodoroPet({ focusDuration: 25 * 60, breakDuration: 5 * 60 });

  const canvas = document.getElementById("pet-canvas");
  const ctx = canvas.getContext("2d");

  // O tomate e desenhado inteiramente com formas vetoriais (arcos, elipses,
  // curvas) num espaco logico de 64x64 — nunca foi pixel art de verdade. O
  // aspecto "pixelado" vinha so de ampliar esse canvas pequeno com
  // nearest-neighbor. Aqui desenhamos no backing buffer numa resolucao bem
  // maior (supersampling) e deixamos o navegador reduzir com suavizacao, o
  // que da bordas lisas sem precisar reescrever nenhuma das contas abaixo
  // (todas continuam em termos de coordenadas 0..64).
  const RENDER_SCALE = 4;
  canvas.width = SPRITE * RENDER_SCALE;
  canvas.height = SPRITE * RENDER_SCALE;
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  const els = {
    phasePill: document.getElementById("phase-pill"),
    status: document.getElementById("status"),
    timer: document.getElementById("timer"),
    energyFill: document.getElementById("energy-fill"),
    energyLabel: document.getElementById("energy-label"),
    cycles: document.getElementById("cycles"),
    mainBtn: document.getElementById("btn-main"),
    skipBtn: document.getElementById("btn-skip"),
    resetBtn: document.getElementById("btn-reset"),
    alertMark: document.getElementById("alert-mark"),
    root: document.documentElement,
  };

  let joy = 0.0;
  let alertTimer = 0.0;
  let look = [0.0, 0.0];
  let lastTime = null;
  let lastSaveAt = 0;

  // --- som ---
  // So pode ser criado apos um gesto real do usuario (click/tecla), por isso
  // a criacao fica separada da reproducao: ensureAudio() roda nas acoes do
  // usuario, playChime() pode ser chamada depois por codigo (ex.: o timer
  // chegando a zero sozinho).
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioCtx = new AudioCtor();
  }
  function playChime() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.setValueAtTime(1175, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  // --- persistencia ---
  // Uma aba em segundo plano pode ser descartada pelo navegador (economia de
  // memoria) e recarregada do zero na proxima visita — sem isso, o Pomodoro
  // "reinicia sozinho" bem no meio de uma sessao. Guardamos o estado e, ao
  // recarregar, recuperamos o tempo real que passou em vez de zerar o timer.
  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          phase: pet.phase,
          remaining: pet.remaining,
          running: pet.running,
          awaiting: pet.awaiting,
          cycles: pet.cycles,
          energy: pet.energy,
          savedAt: Date.now(),
        })
      );
    } catch (e) {
      // localStorage indisponivel (aba anonima, quota etc.) — segue sem persistir
    }
  }

  function loadState() {
    let saved;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      saved = JSON.parse(raw);
    } catch (e) {
      return;
    }
    pet.phase = saved.phase === BREAK ? BREAK : FOCUS;
    pet.remaining = Number(saved.remaining) || 0;
    pet.running = Boolean(saved.running);
    pet.awaiting = Boolean(saved.awaiting);
    pet.cycles = Number(saved.cycles) || 0;
    pet.energy = clamp(Number(saved.energy), 0, 100);

    if (pet.running && !pet.awaiting) {
      const elapsedReal = Math.max(0, (Date.now() - Number(saved.savedAt || Date.now())) / 1000);
      const events = pet.tick(elapsedReal);
      for (const event of events) {
        if (event === FOCUS_DONE || event === BREAK_DONE) alertTimer = ALERT_TIME;
      }
    }
  }

  function accent() {
    return pet.phase === BREAK ? BREAK_ACCENT : FOCUS_ACCENT;
  }

  function expression() {
    if (joy > 0) return "happy";
    if (pet.phase === BREAK && pet.running) return pet.energy >= 70 ? "happy" : "resting";
    return pet.mood;
  }

  function actionLabel() {
    if (pet.awaiting) return pet.phase === FOCUS ? "comecar pausa" : "iniciar foco";
    if (pet.running) return "pausar";
    if (pet.progress > 0) return "retomar";
    return pet.phase === FOCUS ? "iniciar foco" : "iniciar pausa";
  }

  function primaryAction() {
    ensureAudio();
    const event = pet.toggle();
    if (event === BREAK_STARTED) joy = JOY_TIME;
    saveState();
  }

  function doSkip() {
    ensureAudio();
    const event = pet.skip();
    if (event === FOCUS_DONE || event === BREAK_DONE) {
      alertTimer = ALERT_TIME;
      playChime();
    }
    saveState();
  }

  function doReset() {
    ensureAudio();
    pet.reset();
    joy = 0;
    alertTimer = 0;
    saveState();
  }

  // --- eventos ---
  // Tira o foco apos o clique: evita que a barra de espaco "reative" o botao
  // (atalho global) e tambem acione o clique nativo do botao focado.
  function withBlur(fn) {
    return (e) => {
      e.currentTarget.blur();
      fn();
    };
  }
  els.mainBtn.addEventListener("click", withBlur(primaryAction));
  els.skipBtn.addEventListener("click", withBlur(doSkip));
  els.resetBtn.addEventListener("click", withBlur(doReset));
  canvas.addEventListener("click", primaryAction);

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      primaryAction();
    } else if (e.key === "s" || e.key === "S") {
      doSkip();
    } else if (e.key === "r" || e.key === "R") {
      doReset();
    }
  });

  document.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    look = [
      clamp((e.clientX - cx) / (rect.width * 1.5), -1.0, 1.0),
      clamp((e.clientY - cy) / (rect.height * 1.5), -1.0, 1.0),
    ];
  });

  // salva antes da aba ser ocultada/fechada, para nao perder o progresso
  // caso o navegador descarte a aba em segundo plano.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveState();
  });
  window.addEventListener("pagehide", saveState);

  // --- titulo da aba ---
  // Mostra o timer ao vivo (da pra acompanhar sem trocar de aba) e, quando a
  // fase termina, pisca uma mensagem chamativa ate o usuario dar o proximo passo.
  function updateTitle(now) {
    if (pet.awaiting) {
      const blinkOn = Math.floor(now / 900) % 2 === 0;
      const alertMsg = pet.phase === FOCUS ? "⏰ Hora da pausa!" : "⏰ Hora de focar!";
      document.title = blinkOn ? alertMsg : APP_NAME;
      return;
    }
    document.title = `${PomodoroPet.formatTime(pet.remaining)} · ${pet.phaseLabel} — ${APP_NAME}`;
  }

  // --- UI (DOM) ---
  function updateUI() {
    const acc = accent();
    els.root.style.setProperty("--accent", rgb(acc));
    els.root.style.setProperty("--accent-dark", rgb(shade(acc, 0.65)));

    els.phasePill.textContent = pet.phaseLabel;
    els.status.textContent = pet.awaiting ? "aguardando" : pet.running ? "rodando" : "pausado";

    els.timer.textContent = PomodoroPet.formatTime(pet.remaining);
    els.timer.style.color = pet.awaiting ? rgb(acc) : rgb(TEXT);

    const energyPct = clamp(pet.energy, 0, 100);
    els.energyFill.style.width = `${energyPct}%`;
    els.energyFill.style.backgroundColor = rgb(tomatoColor(pet.energy));
    els.energyLabel.textContent = `energia ${Math.round(pet.energy)}%`;

    els.cycles.innerHTML = "";
    const shown = Math.min(pet.cycles, 6);
    for (let i = 0; i < shown; i++) {
      const dot = document.createElement("span");
      dot.className = "cycle-dot";
      els.cycles.appendChild(dot);
    }
    if (pet.cycles > 6) {
      const extra = document.createElement("span");
      extra.className = "cycle-extra";
      extra.textContent = `+${pet.cycles - 6}`;
      els.cycles.appendChild(extra);
    }

    els.mainBtn.textContent = actionLabel();
    els.mainBtn.classList.toggle("primary", pet.awaiting || !pet.running);

    els.alertMark.style.opacity = alertTimer > 0 ? "1" : "0";
    if (alertTimer > 0) {
      const pulse = 1.0 + 0.4 * Math.abs(Math.sin(performance.now() / 130.0));
      els.alertMark.style.transform = `translate(-50%, -50%) scale(${pulse})`;
    }
  }

  // --- desenho do tomate ---
  // 0 = vicoso, 1 = completamente derretido (poca). Segue a mesma curva que
  // o menace() do bichinho original: comeca a aparecer por volta de 70% de
  // energia, maximo em energia 0.
  function meltAmount() {
    return clamp((0.7 - pet.energy / 100.0) / 0.7, 0.0, 1.0);
  }

  function drawSprite(t) {
    const expr = expression();
    const resting = expr === "resting";
    const cx = 32;
    const groundY = 47;
    const R = 17;
    let melt = meltAmount();
    if (joy > 0) melt *= 0.5; // na comemoracao, o tomate fica mais fresco

    const body = tomatoColor(pet.energy);
    const calyx = mix(CALYX_FRESH, CALYX_WILT, melt);

    const squishY = 1 - melt * 0.42;
    const widen = 1 + melt * 0.32;
    const sag = groundY - R * squishY + R * (1 - squishY) * 0.9;
    const bob = resting ? Math.sin(t * 1.1) * 1.5 : Math.sin(t * 2.2) * (1 - melt) * 2.5;
    const by = sag - bob;

    ctx.clearRect(0, 0, SPRITE, SPRITE);

    drawPuddle(cx, groundY, R, melt);
    drawDrips(cx, by, R, widen, squishY, melt, body, t);
    drawCalyx(cx, by, R, squishY, melt, calyx);

    ctx.fillStyle = rgb(body);
    ctx.beginPath();
    ctx.ellipse(cx, by, R * widen, R * squishY, 0, 0, Math.PI * 2);
    ctx.fill();

    drawRibbing(cx, by, R, widen, squishY, melt, body);
    drawHighlight(cx, by, R, squishY, melt);

    if (expr === "happy" || expr === "ok" || resting) {
      for (const dx of [-0.32, 0.32]) {
        fillEllipse(cx + dx * R * 2, by + R * squishY * 0.18, R * 0.24, R * 0.16, "rgba(255, 130, 120, 0.5)");
      }
    }

    drawFace(cx, by, R, squishY, melt, expr, t);

    if ((expr === "tired" || expr === "exhausted") && pet.running) drawSteam(cx, by, R, squishY, t);
    if (resting) drawZzz(cx, by, R, t);
    if (joy > 0) drawJoy(cx, by, R, t);
  }

  function drawPuddle(cx, groundY, R, melt) {
    const p = smoothstep(0.55, 1.0, melt);
    if (p <= 0) return;
    fillEllipse(cx, groundY + R * 0.2, R * (0.9 + 0.9 * p), R * 0.22 * p, rgba(PUDDLE, 0.4 * p));
  }

  function drawDrips(cx, by, R, widen, squishY, melt, body, t) {
    const d = smoothstep(0.25, 1.0, melt);
    if (d <= 0) return;
    const count = 1 + Math.round(d * 3);
    const spread = R * widen * 0.6;
    const topY = by + R * squishY * 0.55;
    ctx.fillStyle = rgb(body);
    for (let i = 0; i < count; i++) {
      const dx = cx + (count > 1 ? (i / (count - 1) - 0.5) * spread : 0);
      const len = R * 0.55 * d * (0.7 + 0.3 * Math.sin(i * 2.1 + t * 0.8));
      ctx.beginPath();
      ctx.moveTo(dx - 4, topY);
      ctx.quadraticCurveTo(dx - 5, topY + len * 0.6, dx, topY + len);
      ctx.quadraticCurveTo(dx + 5, topY + len * 0.6, dx + 4, topY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCalyx(cx, by, R, squishY, melt, calyx) {
    const droop = melt * 1.4;
    const topY = by - R * squishY * 0.92;
    ctx.save();
    ctx.translate(cx, topY);
    for (let i = 0; i < CALYX_LEAVES; i++) {
      const angle = (i / CALYX_LEAVES) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.rotate(angle);
      ctx.translate(0, -R * 0.08);
      ctx.rotate(droop);
      ctx.fillStyle = rgb(calyx);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(R * 0.14, -R * 0.22, 0, -R * 0.42 * (1 - melt * 0.35));
      ctx.quadraticCurveTo(-R * 0.14, -R * 0.22, 0, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = rgb(mix(calyx, INK, 0.2));
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.09, R * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRibbing(cx, by, R, widen, squishY, melt, body) {
    const opacity = 1 - smoothstep(0.2, 0.6, melt);
    if (opacity <= 0.02) return;
    ctx.strokeStyle = rgba(mix(body, INK, 0.25), 0.35 * opacity);
    ctx.lineWidth = 1.2;
    for (const dx of [-0.42, 0, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * R * widen, by - R * squishY * 0.75);
      ctx.quadraticCurveTo(cx + dx * R * widen * 1.15, by, cx + dx * R * widen, by + R * squishY * 0.75);
      ctx.stroke();
    }
  }

  function drawHighlight(cx, by, R, squishY, melt) {
    const opacity = 0.45 * (1 - smoothstep(0.3, 0.8, melt));
    if (opacity <= 0.02) return;
    ctx.fillStyle = rgba([255, 255, 255], opacity);
    ctx.beginPath();
    ctx.ellipse(cx - R * 0.32, by - R * squishY * 0.4, R * 0.28, R * squishY * 0.18, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFace(cx, by, R, squishY, melt, expr, t) {
    const eyeY = by - R * squishY * 0.12;
    const eyeDX = R * 0.32;
    const blink = t % 3.6 < 0.11;

    ctx.strokeStyle = rgb(INK);
    ctx.fillStyle = rgb(INK);
    ctx.lineWidth = Math.max(1.3, SPRITE * 0.02);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (expr === "resting") {
      for (const side of [-1, 1]) {
        const x = cx + side * eyeDX;
        strokePolyline([[x - 4, eyeY], [x, eyeY + 2], [x + 4, eyeY]], rgb(INK), 2);
      }
      drawMouth(cx, by + R * squishY * 0.32, 0, "smile");
      return;
    }

    if (expr === "exhausted") {
      for (const side of [-1, 1]) {
        const x = cx + side * eyeDX;
        strokeLine(x - R * 0.12, eyeY - R * 0.03, x + R * 0.02, eyeY + R * 0.06, rgb(INK), 2);
        strokeLine(x + R * 0.02, eyeY + R * 0.06, x + R * 0.12, eyeY + R * 0.02, rgb(INK), 2);
      }
      drawMouth(cx, by + R * squishY * 0.32, 1, "pant");
      return;
    }

    const tired = smoothstep(0.35, 0.75, melt);
    const eyeW = R * lerp(0.24, 0.17, tired);
    const eyeH = R * lerp(0.22, 0.11, tired);
    for (const side of [-1, 1]) {
      const x = cx + side * eyeDX;
      if (blink) {
        strokeLine(x - eyeW * 0.6, eyeY, x + eyeW * 0.6, eyeY, rgb(INK), 2);
        continue;
      }
      fillEllipse(x, eyeY, eyeW, eyeH, rgb(EYE_SCLERA));

      const lookY = expr === "focus" ? R * 0.03 : 0;
      const px = x + look[0] * eyeW * 0.35;
      const py = eyeY + look[1] * eyeH * 0.35 + lookY;
      fillEllipse(px, py, eyeW * 0.42, eyeH * 0.58, rgb(INK));
      if (tired < 0.6) {
        fillEllipse(px - eyeW * 0.14, py - eyeH * 0.25, eyeW * 0.12, eyeH * 0.16, "rgba(255,255,255,0.85)");
      }

      const brow = Math.max(tired, expr === "focus" ? 0.45 : 0.0);
      if (brow > 0.12) {
        const browY = eyeY - eyeH - R * 0.14;
        strokeLine(x + side * eyeW * 0.65, browY, x - side * eyeW * 0.65, browY + 3 * brow, rgb(INK), 2);
      }
    }

    if (expr === "focus") drawMouth(cx, by + R * squishY * 0.32, melt, "flat");
    else if (expr === "tired") drawMouth(cx, by + R * squishY * 0.32, melt, "tired");
    else drawMouth(cx, by + R * squishY * 0.32, melt, "smile");
  }

  function drawMouth(mx, my, melt, style) {
    const ink = rgb(INK);
    if (style === "pant") {
      fillEllipse(mx, my + 1, 3, 3, ink);
    } else if (style === "flat") {
      strokeLine(mx - 5, my, mx + 5, my, ink, 2);
    } else if (style === "tired") {
      strokeLine(mx - 4, my, mx + 4, my - 1, ink, 2);
    } else {
      const curve = style === "smile" ? 3 - melt * 4 : 1;
      strokePolyline([[mx - 5, my], [mx, my + curve], [mx + 5, my]], ink, 2);
    }
  }

  function drawSteam(cx, by, R, squishY, t) {
    for (const [dx, offset] of [[-0.55, 0], [0.55, 0.4]]) {
      for (let i = 0; i < 2; i++) {
        const phase = (t * 0.7 + offset + i * 0.5) % 1.0;
        const x = cx + dx * R + Math.sin(phase * Math.PI * 2) * 2;
        const y = by - R * squishY * 0.8 - phase * R * 1.3;
        const a = 0.5 * (1 - phase);
        strokeLine(x - 2, y + 3, x, y - 3, rgba(STEAM, a), 1.5);
      }
    }
  }

  function drawZzz(cx, by, R, t) {
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.6 + i / 3.0) % 1.0;
      const size = 4 + i;
      const x = cx + 12 + phase * 8 + i * 4;
      const y = by - 16 - phase * 18 - i * 8;
      const col = rgb([170 + i * 20, 210, 255]);
      strokeLine(x, y, x + size, y, col, 2);
      strokeLine(x + size, y, x, y + size, col, 2);
      strokeLine(x, y + size, x + size, y + size, col, 2);
    }
  }

  function drawJoy(cx, by, R, t) {
    strokeCircle(cx, by, R + 6, rgb(accent()), 2);
    for (let i = 0; i < 6; i++) {
      const angle = t * 2.2 + (i * Math.PI) / 3;
      const rr = R + 7 + 3 * Math.sin(t * 3 + i);
      const x = cx + Math.cos(angle) * rr;
      const y = by + Math.sin(angle) * rr * 0.8;
      ctx.fillStyle = rgb(SPARK);
      ctx.fillRect(x - 1, y - 3, 2, 6);
      ctx.fillRect(x - 3, y - 1, 6, 2);
    }
  }

  // --- helpers de desenho ---
  function strokeCircle(x, y, r, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  function fillEllipse(cx, cy, w, h, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.1, w), Math.max(0.1, h), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function strokePolyline(points, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.stroke();
  }
  function strokeLine(x1, y1, x2, y2, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // --- loop principal ---
  function frame(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    const events = pet.tick(dt);
    for (const event of events) {
      if (event === FOCUS_DONE || event === BREAK_DONE) {
        alertTimer = ALERT_TIME;
        playChime();
      }
    }
    joy = Math.max(0.0, joy - dt);
    alertTimer = Math.max(0.0, alertTimer - dt);

    updateUI();
    updateTitle(now);
    drawSprite(now / 1000.0);

    if (now - lastSaveAt > 1000) {
      saveState();
      lastSaveAt = now;
    }

    requestAnimationFrame(frame);
  }

  loadState();
  requestAnimationFrame(frame);
})();
