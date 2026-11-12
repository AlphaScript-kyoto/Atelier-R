const checkpointSelect = document.querySelector("#checkpoint");
const loraStack = document.querySelector("#lora-stack");
const ratioBox = document.querySelector("#ratios");
const resolutionSelect = document.querySelector("#resolution");
const customWidth = document.querySelector("#custom-width");
const customHeight = document.querySelector("#custom-height");
const countInput = document.querySelector("#count");
const statusLine = document.querySelector("#status");
const form = document.querySelector("#composer");
const promptBox = document.querySelector("#prompt");
const negativeBox = document.querySelector("#negative");
const generateButton = document.querySelector("#generate");
const randomButton = document.querySelector("#random-prompt");
const gallery = document.querySelector("#gallery");
const outputDir = document.querySelector("#output-dir");
const openFolder = document.querySelector("#open-folder");
const progressWrap = document.querySelector("#progress-wrap");
const progressBar = document.querySelector("#progress-bar");
const progressLabel = document.querySelector("#progress-label");
const detail = document.querySelector("#detail");
const detailImage = document.querySelector("#detail-image");
const detailFacts = document.querySelector("#detail-facts");
const detailPrompt = document.querySelector("#detail-prompt");

const NAMED_SIZES = {
  fhd: [1920, 1080],
  wqhd: [2560, 1440],
  "4k": [3840, 2160],
  "8k": [7680, 4320],
};

let selectedRatio = "9:16";
let orientation = "portrait";
let applyingNamedSize = false;
let selectedCount = 1;
let ratioItems = [];
let checkpointItems = [];
let loraInfo = [];
let selectedLoras = [];
const MAX_LORAS = 5;
let reuseSeed = null;
let outputFolder = "";

function addLora(id) {
  if (!id || selectedLoras.some((item) => item.id === id)) return;
  if (selectedLoras.length >= MAX_LORAS) {
    statusLine.classList.add("error");
    statusLine.textContent = "LoRA は同時に 5 つまでです。";
    return;
  }
  selectedLoras.push({ id, strength: 1 });
  renderLoraStack();
}
promptBox.addEventListener("input", paintTriggers);

function loraById(id) {
  return loraInfo.find((item) => item.id === id);
}

function characterHints() {
  return selectedLoras.flatMap((item) => {
    const info = loraById(item.id);
    const first = info && Array.isArray(info.triggers) ? info.triggers[0] : "";
    return first ? [first] : [];
  });
}

function shortLabel(text) {
  return text.length > 18 ? `${text.slice(0, 16)}...` : text;
}

function addTrigger(text) {
  if (promptBox.value.includes(text)) {
    paintTriggers();
    return;
  }
  const current = promptBox.value.trim();
  promptBox.value = current ? `${current}, ${text}` : text;
  paintTriggers();
  if (window.matchMedia("(max-width: 800px)").matches) {
    promptBox.blur();
    setTimeout(() => promptBox.blur(), 0);
    return;
  }
  promptBox.focus();
}

function paintTriggers() {
  document.querySelectorAll(".lora-card .trigger, #extra-word-list .trigger").forEach((button) => {
    button.setAttribute("aria-pressed", String(promptBox.value.includes(button.dataset.trigger)));
  });
}

function renderExtraWords(words) {
  const list = document.querySelector("#extra-word-list");
  const empty = document.querySelector("#extra-word-empty");
  list.replaceChildren();
  const items = Array.isArray(words) ? words : [];
  empty.hidden = items.length > 0;
  items.forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";
    button.dataset.trigger = text;
    button.title = text;
    button.textContent = `${shortLabel(text)} ↑`;
    button.addEventListener("click", () => addTrigger(text));
    list.appendChild(button);
  });
  paintTriggers();
}

const checkpointCurrent = document.querySelector("#checkpoint-current");
const picker = document.querySelector("#picker");
const pickerGrid = document.querySelector("#picker-grid");
const pickerTitle = document.querySelector("#picker-title");
const cardEditor = document.querySelector("#card-editor");
const cardForm = document.querySelector("#card-form");
const cardHeading = document.querySelector("#card-heading");
const cardFile = document.querySelector("#card-file");
const cardUrl = document.querySelector("#card-url");

function modelTile(item, pressed, onPick) {
  const tile = document.createElement("div");
  tile.className = "model-tile";
  if (pressed) tile.classList.add("is-selected");
  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "tile-hit";
  hit.setAttribute("aria-pressed", String(pressed));
  hit.setAttribute("aria-label", item.name);
  if (item.preview) {
    const image = document.createElement("img");
    image.src = item.preview;
    image.alt = "";
    hit.appendChild(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "tile-fallback";
    fallback.textContent = item.name.slice(0, 2);
    hit.appendChild(fallback);
  }
  const name = document.createElement("span");
  name.className = "tile-name";
  name.textContent = item.name;
  hit.appendChild(name);
  hit.addEventListener("click", onPick);
  tile.appendChild(hit);
  const actions = document.createElement("div");
  actions.className = "tile-actions";
  if (item.url) {
    const detail = document.createElement("a");
    detail.className = "tile-detail";
    detail.href = item.url;
    detail.target = "_blank";
    detail.rel = "noopener noreferrer";
    detail.textContent = "詳細";
    actions.appendChild(detail);
  }
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "tile-thumb";
  thumb.textContent = "サムネ";
  thumb.addEventListener("click", () => openCardEditor(item));
  actions.appendChild(thumb);
  tile.appendChild(actions);
  return tile;
}

function renderCheckpointCurrent() {
  checkpointCurrent.replaceChildren();
  const item = checkpointItems.find((entry) => entry.id === checkpointSelect.value);
  if (!item) return;
  const card = document.createElement("div");
  card.className = "current-model";
  if (item.preview) {
    const image = document.createElement("img");
    image.src = item.preview;
    image.alt = "";
    card.appendChild(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "current-fallback";
    fallback.textContent = item.name.slice(0, 2);
    card.appendChild(fallback);
  }
  const name = document.createElement("strong");
  name.textContent = item.name;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "switch-model";
  button.textContent = "切り替え";
  button.addEventListener("click", () => openPicker("checkpoints"));
  card.append(name, button);
  checkpointCurrent.appendChild(card);
}

function renderPicker() {
  if (!picker.open) return;
  pickerGrid.replaceChildren();
  if (picker.dataset.kind === "checkpoints") {
    const current = checkpointSelect.value;
    checkpointItems.forEach((item) => {
      pickerGrid.appendChild(modelTile(item, item.id === current, () => {
        checkpointSelect.value = item.id;
        renderCheckpointCurrent();
        picker.close();
      }));
    });
    return;
  }
  const used = new Set(selectedLoras.map((item) => item.id));
  loraInfo.forEach((item) => {
    pickerGrid.appendChild(modelTile(item, used.has(item.id), () => addLora(item.id)));
  });
}

function openPicker(kind) {
  picker.dataset.kind = kind;
  pickerTitle.textContent = kind === "checkpoints" ? "基礎モデル" : "LoRA を追加";
  if (!picker.open) picker.showModal();
  renderPicker();
}

function closePicker() {
  if (picker.open) picker.close();
}

document.querySelector("#lora-add").addEventListener("click", () => openPicker("loras"));
document.querySelector("#picker-close").addEventListener("click", closePicker);
document.querySelector("#picker-scrim").addEventListener("click", closePicker);

function openCardEditor(item) {
  cardEditor.dataset.kind = item.kind;
  cardEditor.dataset.id = item.id;
  cardHeading.textContent = item.name;
  cardUrl.value = item.url || "";
  cardFile.value = "";
  document.querySelector("#card-error").hidden = true;
  if (!cardEditor.open) cardEditor.showModal();
}

cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = cardEditor.dataset.kind;
  const id = cardEditor.dataset.id;
  const body = new FormData();
  body.set("kind", kind);
  body.set("id", id);
  body.set("url", cardUrl.value.trim());
  if (cardFile.files[0]) body.set("image", cardFile.files[0]);
  cardForm.querySelector("#card-save").disabled = true;
  try {
    const response = await fetch("/api/model-card", { method: "POST", body });
    const data = await response.json();
    const cardError = document.querySelector("#card-error");
    if (!response.ok) {
      cardError.hidden = false;
      cardError.textContent = data.error || "保存できませんでした。";
      return;
    }
    const list = kind === "checkpoints" ? checkpointItems : loraInfo;
    const item = list.find((entry) => entry.id === id);
    if (item) {
      item.preview = data.preview || "";
      item.url = data.url || "";
    }
    renderCheckpointCurrent();
    renderLoraStack();
    cardEditor.close();
    statusLine.classList.remove("error");
    statusLine.textContent = "サムネイルを保存しました。";
  } catch (error) {
    const cardError = document.querySelector("#card-error");
    cardError.hidden = false;
    cardError.textContent = error.message;
  } finally {
    cardForm.querySelector("#card-save").disabled = false;
  }
});
document.querySelector("#card-cancel").addEventListener("click", () => cardEditor.close());

function triggerSection(title, actionLabel, insertWords, chipWords) {
  const section = document.createElement("div");
  const head = document.createElement("div");
  head.className = "trigger-head";
  const label = document.createElement("span");
  label.textContent = title;
  const action = document.createElement("button");
  action.type = "button";
  action.className = "trigger-all";
  action.textContent = actionLabel;
  action.addEventListener("click", () => insertWords.forEach((text) => addTrigger(text)));
  head.append(label, action);
  const list = document.createElement("div");
  list.className = "trigger-list";
  chipWords.forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";
    button.dataset.trigger = text;
    button.title = text;
    button.textContent = `${shortLabel(text)} ↑`;
    button.addEventListener("click", () => addTrigger(text));
    list.appendChild(button);
  });
  section.append(head, list);
  return section;
}

function renderLoraStack() {
  loraStack.replaceChildren();
  selectedLoras.forEach((item, index) => {
    const info = loraById(item.id);
    const name = info ? info.name : item.id;
    const card = document.createElement("div");
    card.className = "lora-card";
    const top = document.createElement("div");
    top.className = info && info.preview ? "lora-top" : "lora-top no-preview";
    if (info && info.preview) {
      const image = document.createElement("img");
      image.src = info.preview;
      image.alt = name;
      top.appendChild(image);
    }
    const title = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "lora-remove";
    remove.setAttribute("aria-label", `${name} を外す`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      selectedLoras.splice(index, 1);
      renderLoraStack();
    });
    title.append(strong, remove);
    top.appendChild(title);
    card.appendChild(top);

    const row = document.createElement("div");
    row.className = "strength-row";
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "2";
    range.step = "0.1";
    range.value = String(item.strength);
    range.setAttribute("aria-label", `${name} の強さ`);
    const number = document.createElement("input");
    number.type = "number";
    number.min = "0";
    number.max = "2";
    number.step = "0.1";
    number.value = Number(item.strength).toFixed(1);
    number.setAttribute("aria-label", `${name} の強さの数値`);
    const setStrength = (value) => {
      const next = Math.min(2, Math.max(0, Number(value) || 0));
      item.strength = next;
      range.value = String(next);
      number.value = next.toFixed(1);
    };
    range.addEventListener("input", () => setStrength(range.value));
    number.addEventListener("input", () => setStrength(number.value));
    row.append(range, number);
    card.appendChild(row);

    const triggers = info && info.triggers ? info.triggers : [];
    const shared = info && info.shared ? info.shared : [];
    const outfits = info && info.outfits ? info.outfits : [];
    if (triggers.length) {
      card.append(triggerSection("Trigger Words", "すべて使用", triggers, triggers));
    }
    if (shared.length) {
      card.append(triggerSection("見た目", "まとめて入れる", [...triggers, ...shared], shared));
    }
    outfits.forEach((outfit) => {
      const words = outfit.triggers || [];
      card.append(triggerSection(
        outfit.name,
        "この衣装",
        [...triggers, ...shared, ...words],
        words,
      ));
    });
    loraStack.appendChild(card);
  });
  renderPicker();
  paintTriggers();
}

function choose(container, value, setter) {
  container.querySelectorAll(".choice").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === value));
  });
  setter(value);
}

function renderRatios(items, options = {}) {
  if (items && items.some((item) => item.width)) ratioItems = items;
  ratioBox.replaceChildren();
  ratioItems.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.column === "full" ? "choice full" : "choice";
    button.dataset.value = item.id;
    button.textContent = item.label;
    button.addEventListener("click", () => selectRatio(item.id));
    ratioBox.appendChild(button);
  });
  choose(ratioBox, selectedRatio, (value) => { selectedRatio = value; });
  if (!options.keepSize) applyRatioSize(selectedRatio);
}

function selectRatio(id) {
  choose(ratioBox, id, (value) => { selectedRatio = value; });
  applyRatioSize(id);
  resolutionSelect.value = "";
  const item = ratioItems.find((entry) => entry.id === id);
  if (item && (item.column === "portrait" || item.column === "landscape")) {
    paintOrientation(item.column);
  }
}

function paintOrientation(value) {
  orientation = value;
  document.querySelectorAll("[data-orient]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.orient === value));
  });
}

function applyNamedSize() {
  const pair = NAMED_SIZES[resolutionSelect.value];
  if (!pair) return;
  const [wide, tall] = pair;
  applyingNamedSize = true;
  customWidth.value = orientation === "portrait" ? tall : wide;
  customHeight.value = orientation === "portrait" ? wide : tall;
  useCustomRatio();
  applyingNamedSize = false;
}

function rememberNamedSize() {
  const width = Number(customWidth.value);
  const height = Number(customHeight.value);
  const match = Object.entries(NAMED_SIZES).find(([, size]) => {
    return (width === size[0] && height === size[1]) || (width === size[1] && height === size[0]);
  });
  resolutionSelect.value = match ? match[0] : "";
  if (width !== height) paintOrientation(height > width ? "portrait" : "landscape");
}

document.querySelectorAll("[data-orient]").forEach((button) => {
  button.addEventListener("click", () => {
    paintOrientation(button.dataset.orient);
    applyNamedSize();
  });
});
resolutionSelect.addEventListener("change", applyNamedSize);

function applyRatioSize(id) {
  const item = ratioItems.find((entry) => entry.id === id);
  if (!item || !item.width || !item.height) return;
  customWidth.value = item.width;
  customHeight.value = item.height;
}

function clampCount() {
  const number = Math.round(Number(countInput.value));
  if (!Number.isFinite(number) || number < 1) countInput.value = "1";
  else if (number > 99) countInput.value = "99";
  else countInput.value = String(number);
  selectedCount = Number(countInput.value);
}

countInput.addEventListener("input", () => {
  if (countInput.value === "" || countInput.value === "-") return;
  const number = Number(countInput.value);
  if (!Number.isFinite(number)) return;
  if (number > 99) countInput.value = "99";
  if (number < 1) countInput.value = "1";
  selectedCount = Number(countInput.value);
});
countInput.addEventListener("change", clampCount);
function useCustomRatio() {
  choose(ratioBox, "custom", (value) => { selectedRatio = value; });
}
customWidth.addEventListener("input", () => {
  if (!applyingNamedSize) resolutionSelect.value = "";
  useCustomRatio();
});
customHeight.addEventListener("input", () => {
  if (!applyingNamedSize) resolutionSelect.value = "";
  useCustomRatio();
});

function snapSize(input) {
  if (input.value === "") return;
  let number = Math.round(Number(input.value) / 8) * 8;
  if (!Number.isFinite(number)) return;
  number = Math.min(7680, Math.max(512, number));
  input.value = String(number);
}

customWidth.addEventListener("change", () => snapSize(customWidth));
customHeight.addEventListener("change", () => snapSize(customHeight));

async function loadOptions() {
  let data;
  try {
    const response = await fetch("/api/options");
    data = await response.json();
  } catch (error) {
    statusLine.textContent = "画面の準備に失敗しました。もう一度確認しています。";
    setTimeout(loadOptions, 2000);
    return;
  }
  if (data.output_dir) {
    outputFolder = data.output_dir;
    outputDir.textContent = data.output_dir;
  }
  renderExtraWords(data.extra_words);
  if (!data.ready) {
    statusLine.textContent = "画像エンジンを起動しています。30 秒ほど待ってください。";
    setTimeout(loadOptions, 2000);
    return;
  }
  checkpointItems = data.checkpoints.map((item) => ({ ...item, kind: "checkpoints" }));
  checkpointSelect.replaceChildren();
  checkpointItems.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    if (item.name === "Holy Mix") option.selected = true;
    checkpointSelect.appendChild(option);
  });
  if (!checkpointSelect.value && checkpointItems[0]) checkpointSelect.value = checkpointItems[0].id;
  renderCheckpointCurrent();
  loraInfo = data.loras.map((item) => ({ ...item, kind: "loras" }));
  selectedLoras = selectedLoras.filter((item) => data.loras.some((lora) => lora.id === item.id));
  if (!selectedLoras.length && data.loras.some((item) => item.id === "olivia.safetensors")) {
    selectedLoras = [{ id: "olivia.safetensors", strength: 1 }];
  }
  renderLoraStack();
  renderRatios(data.ratios);
  statusLine.textContent = "準備できました。トリガーワードをクリックして、生成するを押してください。";
}

function currentSettings(seed) {
  clampCount();
  const checkpoint = checkpointSelect.selectedOptions[0];
  const loras = selectedLoras.map((item) => {
    const info = loraById(item.id);
    return {
      id: item.id,
      name: info ? info.name : item.id,
      strength: Number(item.strength),
    };
  });
  const first = loras[0];
  const ratioButton = ratioBox.querySelector(`[data-value="${selectedRatio}"]`);
  return {
    checkpoint: checkpointSelect.value,
    checkpointName: checkpoint ? checkpoint.textContent : "",
    loras,
    lora: first ? first.id : "",
    loraName: first ? first.name : "なし",
    strength: first ? first.strength : 1,
    prompt: promptBox.value,
    negative: negativeBox.value,
    ratio: selectedRatio,
    ratioLabel: ratioButton ? ratioButton.textContent : selectedRatio,
    width: Number(customWidth.value),
    height: Number(customHeight.value),
    count: selectedCount,
    seed,
    created: new Date().toLocaleString("ja-JP"),
  };
}

function showProgress(job) {
  progressWrap.hidden = false;
  if (job.max > 0) {
    progressBar.classList.remove("indeterminate");
    progressBar.style.width = `${Math.round((job.value / job.max) * 100)}%`;
    progressLabel.textContent = `${job.stage}（${job.value} / ${job.max} ステップ）`;
  } else {
    progressBar.classList.add("indeterminate");
    progressBar.style.width = "";
    progressLabel.textContent = job.stage || "準備しています";
  }
}

let generating = false;
const detailVary = document.querySelector("#detail-vary");
const detailExpand = document.querySelector("#detail-expand");
const detailPad = document.querySelector("#detail-pad");

function setGenerating(active) {
  generating = active;
  generateButton.disabled = active;
  randomButton.disabled = active;
  detailVary.disabled = active;
  detailExpand.disabled = active;
}

randomButton.addEventListener("click", async () => {
  if (generating) return;
  randomButton.disabled = true;
  try {
    const response = await fetch("/api/random-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptBox.value, hints: characterHints() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "プロンプトを組めませんでした。");
    promptBox.value = data.prompt || "";
    paintTriggers();
    statusLine.classList.remove("error");
    statusLine.textContent = data.source_count
      ? `最近の ${data.source_count} 枚から、言葉を組み替えました。直してから生成しても大丈夫です。`
      : "まだ絵が少ないので、追加ワードから言葉を選びました。";
  } catch (error) {
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
  } finally {
    randomButton.disabled = generating;
  }
});

async function startJob(payload, settings) {
  if (generating) return;
  setGenerating(true);
  statusLine.classList.remove("error");
  progressWrap.hidden = false;
  progressBar.classList.add("indeterminate");
  progressBar.style.width = "";
  progressLabel.textContent = "準備しています";
  const waiting = {
    vary: "似た絵を3枚作っています。元の絵を取り込んでから、ステップが進みます。",
    expand: "周りの背景を描き足しています。元の絵を取り込んでから、ステップが進みます。",
  };
  statusLine.textContent = waiting[payload.mode] || "生成しています。モデルの読み込み中はバーが動き、描き始めるとステップが進みます。";
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成を開始できませんでした。");
    settings.seed = data.seed;
    if (data.width && data.height) {
      settings.width = data.width;
      settings.height = data.height;
    }
    if (payload.mode === "expand") {
      settings.ratio = "custom";
      settings.ratioLabel = `${settings.width}×${settings.height}`;
    }
    await waitForJob(data.prompt_id, settings);
    setSheet(false);
  } catch (error) {
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
  } finally {
    progressWrap.hidden = true;
    setGenerating(false);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const seed = reuseSeed;
  reuseSeed = null;
  const settings = currentSettings(seed);
  settings.kindLabel = "テキストから画像";
  await startJob({
    mode: "create",
    checkpoint: settings.checkpoint,
    loras: settings.loras.map((item) => ({ id: item.id, strength: item.strength })),
    prompt: settings.prompt,
    negative: settings.negative,
    ratio: settings.ratio,
    width: settings.width,
    height: settings.height,
    count: settings.count,
    seed,
  }, settings);
});

async function waitForJob(promptId, settings) {
  let lastMark = "";
  let lastChange = Date.now();
  const stallLimit = 10 * 60 * 1000;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    let job;
    try {
      const response = await fetch(`/api/jobs/${promptId}`);
      job = await response.json();
    } catch (error) {
      if (Date.now() - lastChange > stallLimit) {
        throw new Error("進み具合が止まったままです。黒い画面にエラーが出ていないか見てください。");
      }
      continue;
    }
    const mark = `${job.state}:${job.stage || ""}:${job.value || 0}:${job.max || 0}`;
    if (mark !== lastMark) {
      lastMark = mark;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > stallLimit) {
      throw new Error("進み具合が止まったままです。黒い画面にエラーが出ていないか見てください。");
    }
    if (job.state === "running") {
      showProgress(job);
      continue;
    }
    if (job.state === "error" || job.state === "missing") {
      throw new Error(job.message || "生成に失敗しました。");
    }
    statusLine.classList.remove("error");
    statusLine.textContent = `できました。シードは ${job.seed} です。`;
    addSession(job.images, { ...settings, seed: job.seed });
    return;
  }
}

function appendPrompt(text) {
  const extra = String(text || "").trim();
  if (!extra) return;
  const current = promptBox.value.replace(/\s+$/, "");
  promptBox.value = current ? `${current}, ${extra}` : extra;
  paintTriggers();
  promptBox.focus();
}

function createFigure(image, settings) {
  const figure = document.createElement("figure");
  figure.entry = { image, settings };
  const picture = document.createElement("img");
  picture.src = image.url;
  picture.alt = "生成した画像";
  const caption = document.createElement("figcaption");
  caption.textContent = `シード ${settings.seed}（クリックで条件）`;
  picture.addEventListener("click", () => openDetail(figure));
  figure.append(picture, caption);
  return figure;
}

function addSession(images, settings) {
  const section = document.createElement("section");
  section.className = "session";
  const head = document.createElement("div");
  head.className = "session-head";
  const copy = document.createElement("div");
  copy.className = "session-copy";
  const label = document.createElement("p");
  label.className = "session-prompt";
  label.textContent = settings.prompt;
  const meta = document.createElement("p");
  meta.className = "session-meta";
  const kind = settings.kindLabel && settings.kindLabel !== "テキストから画像" ? ` · ${settings.kindLabel}` : "";
  meta.textContent = `${settings.checkpointName} · ${settings.width}×${settings.height}${kind}`;
  copy.append(label, meta);
  const reuse = document.createElement("button");
  reuse.type = "button";
  reuse.className = "reuse-prompt";
  reuse.textContent = "プロンプトを再利用";
  reuse.addEventListener("click", () => appendPrompt(settings.prompt));
  head.append(copy, reuse);
  const row = document.createElement("div");
  row.className = "session-row";
  row.style.setProperty("--count", String(Math.max(images.length, 1)));
  images.forEach((image) => row.append(createFigure(image, settings)));
  section.append(head, row);
  gallery.prepend(section);
}

function fact(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  return row;
}

const detailPrev = document.querySelector("#detail-prev");
const detailNext = document.querySelector("#detail-next");
let detailFigures = [];
let detailIndex = 0;

const phoneQuery = window.matchMedia("(max-width: 800px)");
const isPhone = () => phoneQuery.matches;
let savedScroll = 0;

function syncScrollLock() {
  const shouldLock = document.body.classList.contains("sheet-open") || detail.open;
  const locked = document.body.classList.contains("scroll-lock");
  if (shouldLock && !locked) {
    savedScroll = window.scrollY;
    document.body.style.top = `-${savedScroll}px`;
    document.body.classList.add("scroll-lock");
  } else if (!shouldLock && locked) {
    document.body.classList.remove("scroll-lock");
    document.body.style.top = "";
    window.scrollTo(0, savedScroll);
  }
}

function setSheet(open) {
  const next = Boolean(open) && isPhone();
  document.body.classList.toggle("sheet-open", next);
  if (!next) promptBox.blur();
  syncScrollLock();
}

function openSheetFromPrompt() {
  if (isPhone()) setSheet(true);
}
promptBox.addEventListener("focus", openSheetFromPrompt);
promptBox.addEventListener("pointerdown", openSheetFromPrompt);
document.querySelector("#sheet-close").addEventListener("click", () => {
  setSheet(false);
  promptBox.blur();
});
document.querySelector("#sheet-scrim").addEventListener("click", () => {
  setSheet(false);
});
document.querySelector("#composer").addEventListener("click", (event) => {
  if (!document.body.classList.contains("sheet-open")) return;
  const empty = event.target.id === "composer" || event.target.id === "sheet-scroll" || event.target.classList.contains("side");
  if (empty) setSheet(false);
});
phoneQuery.addEventListener("change", () => setSheet(false));
document.addEventListener("touchmove", (event) => {
  if (!document.body.classList.contains("scroll-lock")) return;
  if (event.target.closest(".side, #composer, .detail-side")) return;
  event.preventDefault();
}, { passive: false });

function openDetail(figure) {
  const session = figure.closest(".session");
  detailFigures = [...session.querySelectorAll("figure")];
  detailIndex = detailFigures.indexOf(figure);
  showDetail();
  detail.classList.remove("info-open");
  if (!detail.open) detail.showModal();
  syncScrollLock();
}

function showDetail() {
  const figures = detailFigures;
  if (!figures.length) return;
  detailIndex = (detailIndex + figures.length) % figures.length;
  const { image, settings } = figures[detailIndex].entry;
  const multiple = figures.length > 1;
  detailPrev.hidden = !multiple;
  detailNext.hidden = !multiple;
  detail.classList.toggle("landscape", Number(settings.width) > Number(settings.height));
  detailImage.src = image.url;
  const facts = [
    fact("創作タイプ", settings.kindLabel || "テキストから画像"),
    fact("作成日時", settings.created),
    fact("比率", settings.ratioLabel),
    fact("画像サイズ", `${settings.width}×${settings.height}`),
  ];
  if (settings.padLabel) facts.push(fact("足した幅", settings.padLabel));
  detailFacts.replaceChildren(
    ...facts,
    fact("シード", String(settings.seed)),
    fact("サンプラー", "Euler a"),
    fact("ステップ", "28"),
    fact("CFG", "5.5"),
    fact("Clip Skip", "2"),
    fact("モデル", settings.checkpointName),
    fact("LoRA", settings.loras && settings.loras.length
      ? settings.loras.map((item) => `${item.name}（強さ ${Number(item.strength).toFixed(1)}）`).join("、")
      : "なし"),
    fact("保存先", image.path),
  );
  detailPrompt.textContent = settings.negative
    ? `${settings.prompt}\n\n避けたい内容: ${settings.negative}`
    : settings.prompt;
  detail.dataset.settings = JSON.stringify(settings);
  detail.dataset.source = JSON.stringify({
    filename: image.filename || "",
    subfolder: image.subfolder || "",
  });
}

function moveDetail(step) {
  detailIndex += step;
  showDetail();
}

detailPrev.addEventListener("click", () => moveDetail(-1));
detailNext.addEventListener("click", () => moveDetail(1));
document.querySelector("#detail-scrim").addEventListener("click", () => detail.close());
document.querySelector("#detail-back").addEventListener("click", () => detail.close());
document.querySelector("#detail-info").addEventListener("click", () => detail.classList.add("info-open"));
document.querySelector("#detail-info-scrim").addEventListener("click", () => detail.close());
document.querySelector(".detail-stage").addEventListener("click", (event) => {
  if (!isPhone() || event.target.closest("button, img")) return;
  detail.close();
});
detail.addEventListener("close", () => {
  detail.classList.remove("info-open");
  syncScrollLock();
});
detail.addEventListener("click", (event) => {
  if (event.target === detail) detail.close();
});
detail.addEventListener("keydown", (event) => {
  if (event.target.closest("select, textarea, input")) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveDetail(1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveDetail(-1);
  }
});
document.querySelector("#detail-close").addEventListener("click", () => {
  if (isPhone()) {
    detail.classList.remove("info-open");
    return;
  }
  detail.close();
});
document.querySelector("#detail-folder").addEventListener("click", openOutputFolder);
const onThisPc = location.hostname === "127.0.0.1" || location.hostname === "localhost";
if (!onThisPc) {
  openFolder.hidden = true;
  document.querySelector("#detail-folder").hidden = true;
}
openFolder.addEventListener("click", openOutputFolder);
document.querySelector("#detail-rerun").addEventListener("click", () => {
  const settings = JSON.parse(detail.dataset.settings || "{}");
  detail.close();
  applySettings(settings);
  form.requestSubmit();
});

function runFromDetail(mode) {
  if (generating) return;
  const settings = JSON.parse(detail.dataset.settings || "{}");
  const source = JSON.parse(detail.dataset.source || "{}");
  if (!source.filename) {
    statusLine.classList.add("error");
    statusLine.textContent = "この絵からは作れません。もう一度生成した絵を開いてください。";
    return;
  }
  const padOption = detailPad.selectedOptions[0];
  detail.close();
  const next = {
    ...settings,
    created: new Date().toLocaleString("ja-JP"),
    kindLabel: mode === "vary" ? "似た絵" : "背景を拡張",
    padLabel: mode === "expand" && padOption ? padOption.textContent : "",
  };
  const payload = {
    mode,
    checkpoint: settings.checkpoint,
    loras: (settings.loras || []).map((item) => ({ id: item.id, strength: item.strength })),
    prompt: settings.prompt,
    negative: settings.negative,
    ratio: settings.ratio || "custom",
    width: settings.width,
    height: settings.height,
    source,
  };
  if (mode === "expand") payload.pad = Number(detailPad.value);
  startJob(payload, next);
}

detailVary.addEventListener("click", () => runFromDetail("vary"));
detailExpand.addEventListener("click", () => runFromDetail("expand"));

function applySettings(settings) {
  checkpointSelect.value = settings.checkpoint;
  renderCheckpointCurrent();
  if (Array.isArray(settings.loras)) {
    selectedLoras = settings.loras.map((item) => ({ id: item.id, strength: Number(item.strength) }));
  } else if (settings.lora) {
    selectedLoras = [{ id: settings.lora, strength: Number(settings.strength) }];
  } else {
    selectedLoras = [];
  }
  renderLoraStack();
  promptBox.value = settings.prompt || "";
  negativeBox.value = settings.negative || "";
  paintTriggers();
  selectedRatio = settings.ratio;
  renderRatios(ratioItems, { keepSize: true });
  customWidth.value = settings.width;
  customHeight.value = settings.height;
  rememberNamedSize();
  countInput.value = String(settings.count || 1);
  clampCount();
  reuseSeed = settings.seed;
}

async function openOutputFolder() {
  await fetch("/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

loadOptions();
