// Gallery + generator frontend. Plain TS, no framework.
// Dynamically imported (see resolveArrowsAsync) so a game-module failure
// never blocks the gallery UI from rendering.

type LevelYaml = {
  schemaVersion?: number;
  cols: number;
  rows: number;
  arrows?: Array<Array<[number, number]>>;
  arrowCount?: number;
  opts?: { minLen: number; maxLen: number; bendProb: number };
  seed?: number;
  transform?: string;
  meta: { pack: string; indexInPack: number; title?: string; difficulty?: "easy" | "medium" | "hard" };
  pipeline?: { verified?: boolean; dropped_cells?: number };
};
type Pack = { pack: string; files: Array<{ file: string; data: LevelYaml }> };
type IconsYaml = {
  defaults: {
    grid: [number, number];
    min_cells: number;
    min_feature_width: number;
    branching_threshold: number;
    skeleton_method?: "zhang" | "lee" | "medial";
    orientation_sigma?: number;
    coherence_threshold?: number;
  };
  icons: Array<{ emoji: string; pack: string; indexInPack: number; title: string; difficulty: string }>;
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends Element>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

function toast(msg: string, isErr = false): void {
  const el = $<HTMLDivElement>("#toast");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function renderSvg(level: LevelYaml, size = 180): string {
  const { cols, rows, arrows = [] } = level;
  const cell = Math.min(size / cols, size / rows);
  const w = cols * cell;
  const h = rows * cell;
  const paths: string[] = [];
  const tips: string[] = [];
  const colors = ["#4f9eff", "#6ae5a1", "#ffc857", "#ff6b6b", "#c77dff", "#ff9e7e", "#7ee5d5", "#ffd97d", "#ff8fb1", "#a3d977"];
  arrows.forEach((arr, i) => {
    if (arr.length < 2) return;
    const color = colors[i % colors.length];
    const d = arr.map((p, j) => `${j === 0 ? "M" : "L"} ${(p[0] + 0.5) * cell} ${(p[1] + 0.5) * cell}`).join(" ");
    paths.push(`<path d="${d}" stroke="${color}" stroke-width="${cell * 0.4}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85"/>`);
    // arrow tip at last cell
    const tip = arr[arr.length - 1];
    const prev = arr[arr.length - 2];
    const dx = tip[0] - prev[0];
    const dy = tip[1] - prev[1];
    const cx = (tip[0] + 0.5) * cell;
    const cy = (tip[1] + 0.5) * cell;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    tips.push(`<circle cx="${cx}" cy="${cy}" r="${cell * 0.22}" fill="${color}" transform="rotate(${ang} ${cx} ${cy})"/>`);
  });
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${paths.join("")}${tips.join("")}</svg>`;
}

// ---------- Gallery ----------
let packs: Pack[] = [];

async function loadGallery(): Promise<void> {
  try {
    const r = await fetch("/api/catalogue");
    const body = await r.json();
    packs = body.packs;
    renderGallery();
  } catch (e) {
    document.querySelector("#gallery")!.innerHTML =
      `<pre style="color:#ff6b6b;white-space:pre-wrap;padding:20px">loadGallery failed: ${(e as Error).message}\n${(e as Error).stack}</pre>`;
  }
}

function renderGallery(): void {
  const root = $<HTMLElement>("#gallery");
  // Flatten all packs into one play-order list. Order within a pack is
  // filename sort; pack order is packs-array order (backend returns it
  // alphabetically). Matches the game's levels-gen.mjs RECIPES order.
  const flat: Array<{ pack: string; file: string; data: LevelYaml }> = [];
  for (const p of packs) for (const f of p.files) flat.push({ pack: p.pack, file: f.file, data: f.data });

  const cards = flat.map((x, i) => {
    const meta = x.data.meta ?? {};
    const diff = meta.difficulty ?? "easy";
    const title = meta.title ?? "—";
    const preview = x.data.arrows ? renderSvg(x.data) : `<div style="padding:20px;text-align:center;color:#8a93a3;font-size:11px">${x.data.arrowCount ?? "?"} arrows / ${x.data.cols}×${x.data.rows}<br/>seed ${x.data.seed ?? "—"}</div>`;
    return `
      <div class="card" draggable="true" data-pack="${x.pack}" data-file="${x.file}">
        ${preview}
        <div class="meta"><span class="title">${title}</span><span class="idx">#${i + 1}</span></div>
        <div class="bottom">
          <span class="pill ${diff}">${diff}</span>
          <button class="archive" title="Archive to drafts/">✕ archive</button>
        </div>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <div class="pack-header"><h2>All Levels</h2><span class="count">${flat.length} levels · drag any card to reorder</span></div>
    <div class="cards" id="all-cards">${cards}</div>
  `;

  // archive
  $$<HTMLButtonElement>(".card .archive").forEach(b => {
    b.addEventListener("click", async e => {
      e.stopPropagation();
      const card = b.closest(".card") as HTMLElement;
      const pack = card.dataset.pack!;
      const file = card.dataset.file!;
      if (!confirm(`Archive ${file}?`)) return;
      const r = await fetch("/api/archive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pack, file }) });
      const body = await r.json();
      if (!r.ok) return toast(body.error ?? "archive failed", true);
      toast(`archived → drafts/`);
      await loadGallery();
    });
  });

  // global drag-drop reorder (any card, any position)
  let dragging: HTMLElement | null = null;
  $$<HTMLElement>(".card").forEach(card => {
    card.addEventListener("dragstart", () => { dragging = card; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => { card.classList.remove("dragging"); dragging = null; });
    card.addEventListener("dragover", e => {
      if (!dragging || dragging === card) return;
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    card.addEventListener("drop", async e => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (!dragging || dragging === card) return;
      const parent = card.parentElement!;
      parent.insertBefore(dragging, card);
      const newOrder = Array.from(parent.querySelectorAll<HTMLElement>(".card"))
        .map(c => ({ pack: c.dataset.pack!, file: c.dataset.file! }));
      const r = await fetch("/api/reorder-global", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order: newOrder }) });
      const body = await r.json();
      if (!r.ok) return toast(body.error ?? "reorder failed", true);
      toast(`reordered (${newOrder.length})`);
      await loadGallery();
    });
  });
}

// ---------- Generator ----------
let icons: IconsYaml;
let selectedIcon: IconsYaml["icons"][number] | null = null;

async function loadGenerator(): Promise<void> {
  const r = await fetch("/api/icons");
  icons = await r.json();
  selectedIcon = icons.icons[0];
  renderGenerator();
}

function renderGenerator(): void {
  const root = $<HTMLElement>("#generator");
  const d = icons.defaults;
  const iconBtns = icons.icons.map(i =>
    `<button data-emoji="${i.emoji}" class="${selectedIcon?.emoji === i.emoji ? "active" : ""}" title="${i.title}">${i.emoji}</button>`
  ).join("");
  root.innerHTML = `
    <div class="gen-layout">
      <form class="gen-form" id="gen-form">
        <label>Icon
          <div class="emoji-picker">${iconBtns}</div>
        </label>
        <div class="row">
          <label>Title<input name="title" value="${selectedIcon?.title ?? ""}"/></label>
          <label>Difficulty
            <select name="difficulty">
              <option ${selectedIcon?.difficulty === "easy" ? "selected" : ""}>easy</option>
              <option ${selectedIcon?.difficulty === "medium" ? "selected" : ""}>medium</option>
              <option ${selectedIcon?.difficulty === "hard" ? "selected" : ""}>hard</option>
            </select>
          </label>
        </div>
        <div class="row">
          <label>Pack<input name="pack" value="${selectedIcon?.pack ?? "icon2level"}"/></label>
          <label>Index in pack<input name="indexInPack" type="number" value="${selectedIcon?.indexInPack ?? 1}"/></label>
        </div>
        <div class="row">
          <label>Grid cols<input name="cols" type="number" value="${d.grid[0]}"/></label>
          <label>Grid rows<input name="rows" type="number" value="${d.grid[1]}"/></label>
        </div>
        <div class="row">
          <label>Seed<input name="seed" type="number" value="0"/></label>
          <label>Max arrow length<input name="maxArrowLength" type="number" value="20"/></label>
        </div>
        <div class="row">
          <label>Min cells<input name="minCells" type="number" value="${d.min_cells}"/></label>
          <label>Min feature width<input name="minFeatureWidth" type="number" value="${d.min_feature_width}"/></label>
        </div>
        <div class="row">
          <label>Skeleton method
            <select name="skeletonMethod">
              <option value="zhang" ${(d.skeleton_method ?? "zhang") === "zhang" ? "selected" : ""}>zhang (Zhang-Suen)</option>
              <option value="lee" ${d.skeleton_method === "lee" ? "selected" : ""}>lee (Lee/Kashyap/Chu)</option>
              <option value="medial" ${d.skeleton_method === "medial" ? "selected" : ""}>medial (medial_axis)</option>
            </select>
          </label>
          <label>Orientation σ<input name="orientationSigma" type="number" step="0.1" value="${d.orientation_sigma ?? 2.0}"/></label>
        </div>
        <div class="row">
          <label>Coherence threshold<input name="coherenceThreshold" type="number" step="0.01" value="${d.coherence_threshold ?? 0.1}"/></label>
          <label>Branching threshold<input name="branchingThreshold" type="number" step="0.1" value="${d.branching_threshold}"/></label>
        </div>
        <button type="submit" id="gen-btn">Generate (preview)</button>
        <button type="button" id="save-btn" class="secondary" disabled>Save to content/levels/</button>
      </form>
      <div class="gen-preview">
        <div class="status-row">
          <div class="status" id="gen-status">Pick an icon + params, then Generate.</div>
          <div class="timer" id="gen-timer" hidden>0.0s</div>
          <div class="pill unverified" id="unverified-pill" hidden>unverified preview</div>
        </div>
        <div id="gen-svg"></div>
        <div class="progress-log" id="gen-log" hidden></div>
        <pre id="gen-yaml" hidden></pre>
      </div>
    </div>
  `;

  // emoji picker
  $$<HTMLButtonElement>(".emoji-picker button").forEach(b => {
    b.addEventListener("click", e => {
      e.preventDefault();
      const emoji = b.dataset.emoji!;
      const icon = icons.icons.find(i => i.emoji === emoji);
      if (!icon) return;
      selectedIcon = icon;
      renderGenerator();
    });
  });

  let lastLevel: LevelYaml | null = null;
  let lastParams: Record<string, unknown> | null = null;
  let previewHashForSaveCheck: string | null = null;

  const form = $<HTMLFormElement>("#gen-form");

  const readParams = (stageMode: "preview" | "save"): Record<string, unknown> => {
    const fd = new FormData(form);
    return {
      emoji: selectedIcon!.emoji,
      title: String(fd.get("title") ?? ""),
      pack: String(fd.get("pack")),
      indexInPack: Number(fd.get("indexInPack")),
      grid: [Number(fd.get("cols")), Number(fd.get("rows"))],
      seed: Number(fd.get("seed")),
      minCells: Number(fd.get("minCells")),
      minFeatureWidth: Number(fd.get("minFeatureWidth")),
      maxArrowLength: Number(fd.get("maxArrowLength")),
      branchingThreshold: Number(fd.get("branchingThreshold")),
      stage: stageMode,
      skeletonMethod: String(fd.get("skeletonMethod") ?? "zhang"),
      orientationSigma: Number(fd.get("orientationSigma")),
      coherenceThreshold: Number(fd.get("coherenceThreshold")),
      save: stageMode === "save",
    };
  };

  const arrowsHash = (level: LevelYaml): string =>
    JSON.stringify(level.arrows ?? []);

  // Run one generation via SSE. Live-updates status + timer + progress
  // log; resolves with the final level or rejects on subprocess crash.
  async function generateStream(params: Record<string, unknown>): Promise<LevelYaml> {
    const status = $<HTMLElement>("#gen-status");
    const timer = $<HTMLElement>("#gen-timer");
    const log = $<HTMLElement>("#gen-log");
    const pill = $<HTMLElement>("#unverified-pill");
    timer.hidden = false;
    log.hidden = false;
    log.innerHTML = "";
    pill.hidden = true;
    status.textContent = "Generating…";

    const t0 = performance.now();
    // 10Hz counter tick so a sub-second run doesn't look frozen.
    const tick = window.setInterval(() => {
      const secs = (performance.now() - t0) / 1000;
      timer.textContent = `${secs.toFixed(1)}s`;
      if (secs > 5) timer.classList.add("over-budget");
      else timer.classList.remove("over-budget");
    }, 100);

    const response = await fetch("/api/generate-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!response.ok || !response.body) {
      clearInterval(tick);
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = "";
    let finalLevel: LevelYaml | null = null;
    let closedOk = false;

    const appendLog = (msg: string): void => {
      const entry = document.createElement("div");
      entry.textContent = msg;
      log.prepend(entry);
      while (log.childElementCount > 8) log.lastElementChild?.remove();
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      // Parse SSE frames (blank-line terminated).
      const frames = sseBuf.split("\n\n");
      sseBuf = frames.pop() ?? "";
      for (const frame of frames) {
        const lines = frame.split("\n");
        let event = "message";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
        }
        if (!dataLine) continue;
        if (event === "done") {
          const parsed = JSON.parse(dataLine) as { code: number; stderr?: string };
          clearInterval(tick);
          if (parsed.code === 0) {
            closedOk = true;
          } else {
            throw new Error(`subprocess exit ${parsed.code}: ${parsed.stderr ?? ""}`);
          }
          break;
        }
        if (event === "stderr") continue;  // silently log-only
        try {
          const msg = JSON.parse(dataLine) as { stage: string; elapsed_ms?: number; level?: LevelYaml };
          if (msg.stage === "result" && msg.level) {
            finalLevel = msg.level;
            continue;
          }
          const elapsed = msg.elapsed_ms != null ? ` ${msg.elapsed_ms}ms` : "";
          appendLog(`${msg.stage}${elapsed}`);
          status.textContent = `${msg.stage}…`;
        } catch {
          appendLog(dataLine);
        }
      }
    }
    clearInterval(tick);
    if (!closedOk) throw new Error("stream closed without done sentinel");
    if (!finalLevel) throw new Error("stream did not emit a result line");
    return finalLevel;
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!selectedIcon) return;
    const params = readParams("preview");
    lastParams = params;
    const btn = $<HTMLButtonElement>("#gen-btn");
    btn.disabled = true;
    try {
      const level = await generateStream(params);
      lastLevel = level;
      previewHashForSaveCheck = arrowsHash(level);
      const verified = level.pipeline?.verified ?? false;
      $<HTMLElement>("#gen-status").textContent =
        `Generated. ${level.arrows?.length ?? 0} arrows · ${level.cols}×${level.rows}`;
      $<HTMLElement>("#gen-svg").innerHTML = renderSvg(level, 480);
      const pre = $<HTMLPreElement>("#gen-yaml");
      pre.hidden = false;
      pre.textContent = JSON.stringify(level, null, 2);
      $<HTMLButtonElement>("#save-btn").disabled = false;
      const pill = $<HTMLElement>("#unverified-pill");
      pill.hidden = verified;
    } catch (err) {
      $<HTMLElement>("#gen-status").textContent = `Failed: ${(err as Error).message}`;
      $<HTMLElement>("#gen-svg").innerHTML =
        `<pre style="color:#ff6b6b;white-space:pre-wrap;font-size:11px">${(err as Error).message}</pre>`;
    } finally {
      btn.disabled = false;
    }
  });

  $<HTMLButtonElement>("#save-btn").addEventListener("click", async () => {
    if (!lastLevel || !lastParams) return;
    if (!confirm(`Save to content/levels/${lastParams.pack}/${String(lastParams.indexInPack).padStart(2, "0")}-*.yaml?`)) return;
    const saveParams = { ...lastParams, stage: "save", save: true };
    const btn = $<HTMLButtonElement>("#save-btn");
    btn.disabled = true;
    try {
      const level = await generateStream(saveParams);
      lastLevel = level;
      $<HTMLElement>("#gen-svg").innerHTML = renderSvg(level, 480);
      const pre = $<HTMLPreElement>("#gen-yaml");
      pre.textContent = JSON.stringify(level, null, 2);
      const savedHash = arrowsHash(level);
      if (previewHashForSaveCheck && savedHash !== previewHashForSaveCheck) {
        toast("Output regenerated during verification — viewing saved version.", false);
      } else {
        toast("saved");
      }
      $<HTMLElement>("#unverified-pill").hidden = level.pipeline?.verified ?? false;
      await loadGallery();
    } catch (err) {
      toast(`save failed: ${(err as Error).message}`, true);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Tabs ----------
$$<HTMLButtonElement>("nav button").forEach(b => {
  b.addEventListener("click", () => {
    const tab = b.dataset.tab!;
    $$<HTMLElement>("nav button").forEach(x => x.classList.toggle("active", x === b));
    $$<HTMLElement>(".tab").forEach(x => x.classList.toggle("active", x.id === tab));
  });
});

loadGallery();
loadGenerator();
