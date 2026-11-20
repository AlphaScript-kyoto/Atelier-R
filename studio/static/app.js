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
const DEFAULT_NEGATIVE = "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, text, watermark, blurry, empty eyes, dull eyes, flat color";
negativeBox.value = DEFAULT_NEGATIVE;
const generateButton = document.querySelector("#generate");
const randomButton = document.querySelector("#random-prompt");
const gallery = document.querySelector("#gallery");
const outputDir = document.querySelector("#output-dir");
const openFolder = document.querySelector("#open-folder");
const progressWrap = document.querySelector("#progress-wrap");
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

/* 幅が狭い縦画面と、高さが足りない横画面の両方をスマホ扱いする。 */
const phoneMedia = "(max-width: 800px), (max-height: 520px) and (max-width: 1100px) and (hover: none)";

let selectedRatio = "9:16";
let orientation = "portrait";
let applyingNamedSize = false;
let selectedCount = 1;
let ratioItems = [];
let checkpointItems = [];
let loraInfo = [];
let selectedLoras = [];
let appliedLoraNegativeKey = null;
const MAX_LORAS = 5;
let reuseSeed = null;
let outputFolder = "";

// ---- ベースモデル（FLUX / SDXL / SD1.5 など）ごとの表示 ----
const BASE_ORDER_FALLBACK = [
  { id: "flux2", label: "FLUX.2" },
  { id: "flux", label: "FLUX.1" },
  { id: "sdxl", label: "SDXL" },
  { id: "sd3", label: "SD3" },
  { id: "sd2", label: "SD2.x" },
  { id: "sd15", label: "SD1.5" },
  { id: "unknown", label: "不明" },
];
let baseGroups = BASE_ORDER_FALLBACK;
let fluxDefaults = { steps: 20, guidance: 3.5 };
const fluxSection = document.querySelector("#flux-settings");
const fluxGuidance = document.querySelector("#flux-guidance");
const negativeNote = document.querySelector("#negative-flux-note");
const brandEyebrow = document.querySelector(".brand .eyebrow");

function baseOf(item) {
  return (item && item.base) || "unknown";
}

function baseLabel(base) {
  const found = baseGroups.find((group) => group.id === base);
  return found ? found.label : "不明";
}

function currentCheckpointBase() {
  return baseOf(checkpointItems.find((entry) => entry.id === checkpointSelect.value));
}

// サーバーと同じ考え方: はっきり別のベースモデル用と分かる LoRA だけを外す。
function loraFits(lora, checkpointBase = currentCheckpointBase()) {
  const loraBase = baseOf(lora);
  if (checkpointBase === "unknown" || loraBase === "unknown") return true;
  return checkpointBase === loraBase;
}

function groupByBase(items) {
  return baseGroups
    .map((group) => ({ ...group, items: items.filter((item) => baseOf(item) === group.id) }))
    .filter((group) => group.items.length);
}

function baseBadge(base) {
  const badge = document.createElement("span");
  badge.className = `base-badge base-${base}`;
  badge.textContent = baseLabel(base);
  return badge;
}

function groupHeading(text, note) {
  const heading = document.createElement("h3");
  heading.className = "picker-group";
  heading.textContent = text;
  if (note) {
    const small = document.createElement("small");
    small.textContent = note;
    heading.appendChild(small);
  }
  return heading;
}

function paintBaseUi() {
  const base = currentCheckpointBase();
  const item = checkpointItems.find((entry) => entry.id === checkpointSelect.value);
  const isFlux = base === "flux";
  // FLUX.1 と FLUX.2 Klein 蒸留版はネガティブを使わない。サーバーが uses_negative を返すときはそれに従う。
  const ignoresNegative = isFlux || (item && item.uses_negative === false);
  if (brandEyebrow) brandEyebrow.textContent = baseLabel(base) === "不明" ? "MODEL" : baseLabel(base);
  if (fluxSection) fluxSection.hidden = !isFlux;
  if (negativeNote) {
    negativeNote.hidden = !ignoresNegative;
    negativeNote.textContent = `${item ? item.name : "このモデル"} ではこの欄は使われません。`;
  }
}

function fluxGuidanceValue() {
  const value = Number(fluxGuidance && fluxGuidance.value);
  if (!Number.isFinite(value)) return fluxDefaults.guidance;
  return Math.min(10, Math.max(0, value));
}

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

window.chooseLoraForCreate = function (id, name) {
  const known = loraById(id);
  if (known && !loraFits(known)) {
    statusLine.classList.add("error");
    statusLine.textContent = "今の基礎モデルでは、この LoRA は使えません。";
    return false;
  }
  if (!selectedLoras.some((entry) => entry.id === id)) {
    if (selectedLoras.length >= MAX_LORAS) selectedLoras.shift();
    selectedLoras.push({ id, strength: 1 });
  }
  renderLoraStack();
  paintTriggers();
  statusLine.classList.remove("error");
  statusLine.textContent = `${name || "LoRA"} を選びました。`;
  promptBox.focus();
  return true;
};

window.reloadLoraWords = async function () {
  const response = await fetch("/api/options");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ready || !Array.isArray(data.loras)) return;
  loraInfo = data.loras.map((item) => ({ ...item, kind: "loras" }));
  renderLoraStack();
  paintTriggers();
};
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

function uniqueWords(words) {
  const unique = [];
  const seen = new Set();
  (Array.isArray(words) ? words : []).forEach((text) => {
    const word = String(text || "").trim();
    if (!word || seen.has(word)) return;
    seen.add(word);
    unique.push(word);
  });
  return unique;
}

function boundaryBefore(source, index) {
  if (index === 0) return true;
  let cursor = index - 1;
  while (cursor >= 0 && source[cursor] === " ") cursor -= 1;
  return cursor >= 0 && source[cursor] === ",";
}

function boundaryAfter(source, index) {
  if (index === source.length) return true;
  let cursor = index;
  while (cursor < source.length && source[cursor] === " ") cursor += 1;
  return cursor === source.length || source[cursor] === ",";
}

function findTag(source, word) {
  let from = 0;
  while (from <= source.length) {
    const index = source.indexOf(word, from);
    if (index < 0) return -1;
    const end = index + word.length;
    if (boundaryBefore(source, index) && boundaryAfter(source, end)) return index;
    from = index + 1;
  }
  return -1;
}

function wordInPrompt(source, word) {
  return Boolean(word) && findTag(source, word) >= 0;
}

function removeTag(source, word) {
  const index = findTag(source, word);
  if (index < 0) return null;
  const before = source.slice(0, index);
  const after = source.slice(index + word.length);
  if (/,\s*$/.test(before)) return `${before.replace(/,\s*$/, "")}${after}`;
  if (/^\s*,\s*/.test(after)) return `${before}${after.replace(/^\s*,\s*/, "")}`;
  return `${before}${after}`;
}

function removeWord(source, word) {
  let current = source;
  let next = removeTag(current, word);
  while (next !== null) {
    current = next;
    next = removeTag(current, word);
  }
  return current.replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/^[\s,]+|[\s,]+$/g, "").replace(/,\s*/g, ", ");
}

function finishPrompt(value) {
  promptBox.value = value;
  paintTriggers();
  if (window.matchMedia(phoneMedia).matches) {
    promptBox.blur();
    setTimeout(() => promptBox.blur(), 0);
    return;
  }
  promptBox.focus();
}

function toggleTrigger(text) {
  const word = String(text || "").trim();
  if (!word) return;
  const source = promptBox.value.trim();
  if (wordInPrompt(source, word)) {
    finishPrompt(removeWord(source, word));
    return;
  }
  finishPrompt(source ? `${source}, ${word}` : word);
}

function toggleTriggerGroup(words) {
  const unique = uniqueWords(words);
  if (!unique.length) return;
  const source = promptBox.value.trim();
  const allIn = unique.every((word) => wordInPrompt(source, word));
  if (allIn) {
    const longestFirst = unique.slice().sort((left, right) => right.length - left.length);
    finishPrompt(longestFirst.reduce((current, word) => removeWord(current, word), source));
    return;
  }
  const missing = unique.filter((word) => !wordInPrompt(source, word));
  finishPrompt(missing.reduce((current, word) => (current ? `${current}, ${word}` : word), source));
}

function paintTriggers() {
  const source = promptBox.value;
  document.querySelectorAll(".lora-card .trigger, #extra-word-list .trigger").forEach((button) => {
    button.setAttribute("aria-pressed", String(wordInPrompt(source, button.dataset.trigger)));
  });
  document.querySelectorAll(".trigger-all").forEach((button) => {
    let words = [];
    try {
      words = JSON.parse(button.dataset.words || "[]");
    } catch (error) {
      words = [];
    }
    button.setAttribute("aria-pressed", String(words.length > 0 && words.every((word) => wordInPrompt(source, word))));
  });
}

function renderExtraWords(words) {
  const list = document.querySelector("#extra-word-list");
  const empty = document.querySelector("#extra-word-empty");
  list.replaceChildren();
  const items = Array.isArray(words) ? words : [];
  empty.hidden = items.length > 0;
  items.forEach((text) => {
    const item = document.createElement("span");
    item.className = "extra-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";
    button.dataset.trigger = text;
    button.textContent = text;
    button.addEventListener("click", () => toggleTrigger(text));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "extra-remove";
    remove.setAttribute("aria-label", "この言葉を一覧から外す");
    remove.textContent = "×";
    remove.addEventListener("click", () => saveExtraWord(text, true));
    item.append(button, remove);
    list.appendChild(item);
  });
  paintTriggers();
}

async function saveExtraWord(word, remove) {
  const note = document.querySelector("#extra-word-note");
  const input = document.querySelector("#extra-word-input");
  note.classList.remove("is-error");
  note.textContent = remove ? "外しています..." : "登録しています...";
  try {
    const response = await fetch("/api/extra-words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remove ? { word, remove: true } : { word }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "言葉を保存できませんでした。");
    if (!remove) input.value = "";
    renderExtraWords(data.extra_words);
    note.classList.remove("is-error");
    note.textContent = remove
      ? "一覧から外しました。描きたい内容に入っている文は、そのまま残ります。"
      : "1つのボタンとして登録しました。押すと、この言葉がまとめて入ります。";
  } catch (error) {
    note.classList.add("is-error");
    note.textContent = error.message;
  }
}

document.querySelector("#extra-word-save").addEventListener("click", () => {
  saveExtraWord(document.querySelector("#extra-word-input").value, false);
});
document.querySelector("#extra-word-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  saveExtraWord(document.querySelector("#extra-word-input").value, false);
});

const checkpointCurrent = document.querySelector("#checkpoint-current");
const picker = document.querySelector("#picker");
const pickerGrid = document.querySelector("#picker-grid");
const pickerTitle = document.querySelector("#picker-title");
const cardEditor = document.querySelector("#card-editor");
const cardForm = document.querySelector("#card-form");
const cardHeading = document.querySelector("#card-heading");
const cardFile = document.querySelector("#card-file");
const cardUrl = document.querySelector("#card-url");

function modelTile(item, pressed, onPick, options = {}) {
  const tile = document.createElement("div");
  tile.className = "model-tile";
  if (pressed) tile.classList.add("is-selected");
  if (options.disabled) tile.classList.add("is-disabled");
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
  hit.appendChild(baseBadge(baseOf(item)));
  if (options.disabled) {
    hit.disabled = true;
    hit.title = options.disabledReason || "";
  } else {
    hit.addEventListener("click", onPick);
  }
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
  thumb.addEventListener("click", (event) => {
    event.stopPropagation();
    openCardEditor(item);
  });
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
  name.appendChild(baseBadge(baseOf(item)));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "switch-model";
  button.textContent = "切り替え";
  button.addEventListener("click", () => openPicker("checkpoints"));
  card.append(name, button);
  checkpointCurrent.appendChild(card);
  paintBaseUi();
}

function renderPicker() {
  if (!picker.open) return;
  pickerGrid.replaceChildren();
  if (picker.dataset.kind === "checkpoints") {
    const current = checkpointSelect.value;
    groupByBase(checkpointItems).forEach((group) => {
      pickerGrid.appendChild(groupHeading(group.label, `${group.items.length}件`));
      group.items.forEach((item) => {
        pickerGrid.appendChild(modelTile(item, item.id === current, () => {
          checkpointSelect.value = item.id;
          renderCheckpointCurrent();
          renderLoraStack();
          picker.close();
        }));
      });
    });
    return;
  }
  const used = new Set(selectedLoras.map((item) => item.id));
  const checkpointBase = currentCheckpointBase();
  const groups = groupByBase(loraInfo);
  const fitting = groups.filter((group) => group.items.some((item) => loraFits(item, checkpointBase)));
  const other = groups.filter((group) => !group.items.some((item) => loraFits(item, checkpointBase)));
  fitting.forEach((group) => {
    pickerGrid.appendChild(groupHeading(group.label, `${group.items.length}件`));
    group.items.forEach((item) => {
      pickerGrid.appendChild(modelTile(item, used.has(item.id), () => addLora(item.id)));
    });
  });
  other.forEach((group) => {
    pickerGrid.appendChild(groupHeading(group.label, `今の基礎モデル（${baseLabel(checkpointBase)}）では使えません`));
    group.items.forEach((item) => {
      pickerGrid.appendChild(modelTile(item, used.has(item.id), () => {}, {
        disabled: true,
        disabledReason: `${baseLabel(baseOf(item))} 用の LoRA です。${baseLabel(checkpointBase)} では使えません。`,
      }));
    });
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
  action.dataset.words = JSON.stringify(uniqueWords(insertWords));
  action.addEventListener("click", () => toggleTriggerGroup(insertWords));
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
    button.addEventListener("click", () => toggleTrigger(text));
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
    strong.appendChild(baseBadge(baseOf(info)));
    title.append(strong, remove);
    top.appendChild(title);
    card.appendChild(top);
    if (info && !loraFits(info)) {
      card.classList.add("is-unfit");
      const warn = document.createElement("p");
      warn.className = "lora-unfit";
      warn.textContent = `${baseLabel(baseOf(info))} 用なので、今の基礎モデル（${baseLabel(currentCheckpointBase())}）では使われません。`;
      card.appendChild(warn);
    }

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
    card.appendChild(loraNegativeSection(item.id, name, info && info.negative ? info.negative : ""));

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
  applyLoraNegative();
  renderPicker();
  paintTriggers();
}

function loraNegativeSection(id, name, saved) {
  const details = document.createElement("details");
  details.className = "lora-negative";
  const summary = document.createElement("summary");
  summary.textContent = saved.trim() ? "避けたい内容（このLoRA用）" : "避けたい内容";
  const box = document.createElement("textarea");
  box.rows = 3;
  box.value = saved;
  box.placeholder = "空のまま保存すると、いつもの文になります";
  box.setAttribute("aria-label", `${name} の避けたい内容`);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "text-button";
  save.textContent = "このLoRAに保存";
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "LoRA を1つだけ選んでいるときに、この文章が下の避けたい内容になります。2つ以上のときは、いつもの文です。空で保存すると、その1つのときもいつもの文です。";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const response = await fetch("/api/lora-negative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, negative: box.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存できませんでした。");
      const info = loraById(id);
      if (info) info.negative = data.negative || "";
      appliedLoraNegativeKey = null;
      renderLoraStack();
      statusLine.classList.remove("error");
      statusLine.textContent = data.negative
        ? `${name} の避けたい内容を保存しました。`
        : `${name} は、いつもの避けたい内容を使います。`;
    } catch (error) {
      note.textContent = error.message;
      save.disabled = false;
    }
  });
  details.append(summary, box, save, note);
  return details;
}

function applyLoraNegative() {
  const only = selectedLoras.length === 1 ? loraById(selectedLoras[0].id) : null;
  const text = only && only.negative ? only.negative.trim() : "";
  const key = selectedLoras.length === 1
    ? `one\u0001${selectedLoras[0].id}\u0001${text}`
    : `many\u0001${selectedLoras.map((item) => item.id).join(",")}`;
  if (key === appliedLoraNegativeKey) return;
  appliedLoraNegativeKey = key;
  negativeBox.value = text || DEFAULT_NEGATIVE;
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
  if (Array.isArray(data.base_groups) && data.base_groups.length) baseGroups = data.base_groups;
  if (data.flux_defaults) {
    fluxDefaults = { ...fluxDefaults, ...data.flux_defaults };
    if (fluxGuidance && !fluxGuidance.dataset.touched) fluxGuidance.value = String(fluxDefaults.guidance);
  }
  checkpointItems = data.checkpoints.map((item) => ({ ...item, kind: "checkpoints" }));
  checkpointSelect.replaceChildren();
  groupByBase(checkpointItems).forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    group.items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      if (item.name === "Holy Mix") option.selected = true;
      optgroup.appendChild(option);
    });
    checkpointSelect.appendChild(optgroup);
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
    base: currentCheckpointBase(),
    guidance: currentCheckpointBase() === "flux" ? fluxGuidanceValue() : undefined,
  };
}

const MAX_QUEUE = 10;
const queue = [];
let polling = false;
const detailVary = document.querySelector("#detail-vary");
const detailExpand = document.querySelector("#detail-expand");
const detailPad = document.querySelector("#detail-pad");

function unfinishedJobs() {
  return queue.filter((job) => job.state === "queued" || job.state === "running");
}

function dropJob(entry) {
  const index = queue.indexOf(entry);
  if (index >= 0) queue.splice(index, 1);
}

async function postCancel(promptId) {
  const response = await fetch("/api/jobs/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_id: promptId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "取り消しできませんでした。");
  return data;
}

async function cancelQueuedJob(entry, drawing) {
  const question = drawing
    ? "いま描いている絵を止めますか？"
    : "この待ちを取り消しますか？";
  if (!window.confirm(question)) return;
  const previous = entry.state;
  entry.state = "cancelled";
  renderQueue();
  if (!entry.promptId) {
    dropJob(entry);
    statusLine.classList.remove("error");
    statusLine.textContent = "待ちを取り消しました。";
    renderQueue();
    return;
  }
  try {
    const data = await postCancel(entry.promptId);
    dropJob(entry);
    statusLine.classList.remove("error");
    statusLine.textContent = data.running ? "描いている絵を止めました。" : "待ちを取り消しました。";
  } catch (error) {
    entry.state = previous;
    if (!queue.includes(entry)) queue.push(entry);
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
    if (entry.promptId) ensurePoller();
  }
  renderQueue();
}

function shortPrompt(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "（文章なし）";
  return flat.length > 42 ? `${flat.slice(0, 42)}…` : flat;
}

function renderQueue() {
  const visible = queue.filter((job) => job.state === "queued" || job.state === "running" || job.state === "error");
  const waiting = unfinishedJobs();
  progressWrap.hidden = visible.length === 0;
  document.body.classList.toggle("queue-open", visible.length > 0);
  progressWrap.replaceChildren();
  for (const job of visible) {
    const row = document.createElement("div");
    row.className = "queue-row";
    const label = document.createElement("p");
    label.className = "queue-label";
    const title = shortPrompt(job.settings.prompt);
    const head = document.createElement("div");
    head.className = "queue-head";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "queue-cancel";
    if (job.state === "error") {
      row.classList.add("is-error");
      label.textContent = `${title} — ${job.error}`;
      cancel.textContent = "閉じる";
      cancel.addEventListener("click", () => {
        dropJob(job);
        renderQueue();
      });
      head.append(label, cancel);
      row.appendChild(head);
    } else {
      const place = waiting.indexOf(job);
      const drawing = place === 0;
      if (drawing) {
        label.textContent = job.max > 0
          ? `${title} — ${job.stage}（${job.value} / ${job.max} ステップ）`
          : `${title} — ${job.stage || "準備しています"}`;
      } else {
        label.textContent = `${title} — 待ち ${place + 1}`;
      }
      cancel.textContent = drawing ? "中止" : "取消";
      cancel.addEventListener("click", () => cancelQueuedJob(job, drawing));
      const track = document.createElement("div");
      track.className = "progress-track";
      const bar = document.createElement("div");
      bar.className = "queue-bar";
      if (drawing && job.max > 0) {
        bar.style.width = `${Math.round((job.value / job.max) * 100)}%`;
      } else {
        bar.classList.add("indeterminate");
      }
      track.appendChild(bar);
      head.append(label, cancel);
      row.append(head, track);
    }
    progressWrap.appendChild(row);
  }
  const full = waiting.length >= MAX_QUEUE;
  generateButton.disabled = full;
  detailVary.disabled = full;
  detailExpand.disabled = full;
}

randomButton.addEventListener("click", async () => {
  randomButton.disabled = true;
  try {
    const response = await fetch("/api/random-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptBox.value,
        hints: characterHints(),
        loras: selectedLoras.filter((item) => {
          const info = loraById(item.id);
          return !info || loraFits(info);
        }).map((item) => item.id),
      }),
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
    randomButton.disabled = false;
  }
});

function startJob(payload, settings) {
  if (unfinishedJobs().length >= MAX_QUEUE) {
    statusLine.classList.add("error");
    statusLine.textContent = "待ちは 10 件までです。描き終わるまで、追加は待ってください。";
    renderQueue();
    return false;
  }
  const entry = {
    settings,
    promptId: "",
    state: "queued",
    stage: "準備しています",
    value: 0,
    max: 0,
    error: "",
    lastMark: "",
    lastChange: Date.now(),
  };
  queue.push(entry);
  statusLine.classList.remove("error");
  const waitingNote = {
    vary: "似た絵を待ちに入れました。",
    expand: "背景を広げる絵を待ちに入れました。",
  };
  const ahead = unfinishedJobs().length;
  statusLine.textContent = ahead === 1
    ? `${waitingNote[payload.mode] || "待ちに入れました。"} モデルの読み込み中はバーが動き、描き始めるとステップが進みます。`
    : `${waitingNote[payload.mode] || "待ちに入れました。"} いま ${ahead} 件並んでいます。絵は 1 件ずつ描きます。`;
  renderQueue();
  if (payload.mode !== "create") setSheet(false);
  sendJob(entry, payload);
  return true;
}

async function sendJob(entry, payload) {
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成を開始できませんでした。");
    entry.promptId = data.prompt_id;
    if (entry.state === "cancelled") {
      try {
        await postCancel(entry.promptId);
      } catch (error) {
        entry.state = "queued";
        queue.push(entry);
        statusLine.classList.add("error");
        statusLine.textContent = error.message;
        ensurePoller();
        renderQueue();
      }
      return;
    }
    entry.settings.seed = data.seed;
    if (data.width && data.height) {
      entry.settings.width = data.width;
      entry.settings.height = data.height;
    }
    if (payload.mode === "expand") {
      entry.settings.ratio = "custom";
      entry.settings.ratioLabel = `${entry.settings.width}×${entry.settings.height}`;
    }
    ensurePoller();
  } catch (error) {
    if (entry.state === "cancelled") return;
    entry.state = "error";
    entry.error = error.message;
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
    renderQueue();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const seed = reuseSeed;
  reuseSeed = null;
  const settings = currentSettings(seed);
  settings.kindLabel = "テキストから画像";
  const started = startJob({
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
    ...(settings.base === "flux" ? { guidance: settings.guidance } : {}),
  }, settings);
  if (!started) return;
  promptBox.value = "";
  paintTriggers();
});

function ensurePoller() {
  if (polling) return;
  polling = true;
  pollQueue();
}

async function pollQueue() {
  const stallLimit = 10 * 60 * 1000;
  try {
    while (unfinishedJobs().some((job) => job.promptId)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      for (const entry of unfinishedJobs()) {
        if (!entry.promptId || entry.state === "error" || entry.state === "cancelled") continue;
        let job;
        try {
          const response = await fetch(`/api/jobs/${entry.promptId}`);
          job = await response.json();
        } catch (error) {
          if (Date.now() - entry.lastChange > stallLimit) {
            entry.state = "error";
            entry.error = "進み具合が止まったままです。黒い画面にエラーが出ていないか見てください。";
          }
          continue;
        }
        if (entry.state === "cancelled") continue;
        const mark = `${job.state}:${job.stage || ""}:${job.value || 0}:${job.max || 0}`;
        if (mark !== entry.lastMark) {
          entry.lastMark = mark;
          entry.lastChange = Date.now();
        } else if (Date.now() - entry.lastChange > stallLimit) {
          entry.state = "error";
          entry.error = "進み具合が止まったままです。黒い画面にエラーが出ていないか見てください。";
          continue;
        }
        if (job.state === "running") {
          entry.state = "running";
          entry.stage = job.stage || "準備しています";
          entry.value = job.value || 0;
          entry.max = job.max || 0;
          continue;
        }
        if (job.state === "error" || job.state === "missing") {
          entry.state = "error";
          entry.error = job.message || "生成に失敗しました。";
          continue;
        }
        if (entry.state === "cancelled") continue;
        entry.state = "done";
        entry.settings.seed = job.seed;
        addSession(job.images || [], entry.settings);
        const left = unfinishedJobs().length;
        statusLine.classList.remove("error");
        statusLine.textContent = left
          ? `できました。シードは ${job.seed} です。残り ${left} 件が待っています。`
          : `できました。シードは ${job.seed} です。`;
      }
      renderQueue();
    }
  } finally {
    polling = false;
    renderQueue();
    if (unfinishedJobs().some((job) => job.promptId)) ensurePoller();
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
  picture.addEventListener("click", () => {
    if (document.body.classList.contains("select-mode")) {
      toggleSelected(figure);
      return;
    }
    openDetail(figure);
  });
  const mark = document.createElement("button");
  mark.type = "button";
  mark.className = "pick-mark";
  mark.textContent = "✓";
  mark.setAttribute("aria-label", "この絵を選ぶ");
  mark.addEventListener("click", () => toggleSelected(figure));
  figure.append(picture, caption, mark);
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
  gallery.append(section);
  refreshSelectButton();
  revealLatest();
}

function revealLatest() {
  const scroller = document.querySelector("main");
  const go = () => {
    if (isPhone() || !scroller) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      return;
    }
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  };
  requestAnimationFrame(go);
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
const detailIndexLabel = document.querySelector("#detail-index");
let detailFigures = [];
let detailIndex = 0;

const phoneQuery = window.matchMedia(phoneMedia);
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
  if (event.target.closest(".side, #composer, #sheet-scroll, .detail-side, .detail-layout, #picker-grid, .train-body, .train-layout, .tag-layout, #train-watch, .lora-board, dialog")) return;
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
  detailIndexLabel.textContent = `${detailIndex + 1}/${figures.length}`;
  detailIndexLabel.setAttribute("aria-label", `${figures.length}枚中の${detailIndex + 1}枚目`);
  detail.classList.toggle("landscape", Number(settings.width) > Number(settings.height));
  detailImage.src = image.url;
  const facts = [
    fact("創作タイプ", settings.kindLabel || "テキストから画像"),
    fact("作成日時", settings.created),
    fact("比率", settings.ratioLabel),
    fact("画像サイズ", `${settings.width}×${settings.height}`),
  ];
  if (settings.padLabel) facts.push(fact("足した幅", settings.padLabel));
  const rows = [
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
  ];
  if (onThisPc) rows.push(fact("保存先", image.path));
  detailFacts.replaceChildren(...rows);
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
document.querySelector("#detail-info").addEventListener("click", () => {
  detail.classList.toggle("info-open");
});
document.querySelector("#detail-info-scrim").addEventListener("click", () => {
  if (isPhone()) {
    detail.classList.remove("info-open");
    return;
  }
  detail.close();
});
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

const selectButton = document.querySelector("#select-images");
const selectCount = document.querySelector("#select-count");
const deleteImagesButton = document.querySelector("#delete-images");
const selectedFigures = new Set();

function refreshSelectButton() {
  const selecting = document.body.classList.contains("select-mode");
  selectButton.setAttribute("aria-pressed", String(selecting));
  selectButton.textContent = selecting ? "やめる" : "選択";
  selectCount.hidden = !selecting;
  deleteImagesButton.hidden = !selecting;
}

function updateSelectBar() {
  selectCount.textContent = `${selectedFigures.size}枚`;
  deleteImagesButton.disabled = selectedFigures.size === 0;
}

function setSelectMode(on) {
  document.body.classList.toggle("select-mode", Boolean(on));
  if (on && detail.open) detail.close();
  if (!on) {
    selectedFigures.clear();
    gallery.querySelectorAll("figure.is-selected").forEach((figure) => {
      figure.classList.remove("is-selected");
      const mark = figure.querySelector(".pick-mark");
      if (mark) mark.setAttribute("aria-pressed", "false");
    });
  }
  refreshSelectButton();
  updateSelectBar();
}

function toggleSelected(figure) {
  const mark = figure.querySelector(".pick-mark");
  if (selectedFigures.has(figure)) {
    selectedFigures.delete(figure);
    figure.classList.remove("is-selected");
    if (mark) mark.setAttribute("aria-pressed", "false");
  } else {
    selectedFigures.add(figure);
    figure.classList.add("is-selected");
    if (mark) mark.setAttribute("aria-pressed", "true");
  }
  updateSelectBar();
}

function imageKey(image) {
  return `${image.subfolder || ""}/${image.filename || ""}`;
}

async function deleteFigures(figures) {
  const list = [...figures].filter((figure) => figure.isConnected && figure.entry);
  if (!list.length) return;
  const count = list.length;
  if (!window.confirm(`選んだ${count}枚を、保存フォルダからも消しますか？消した絵は元に戻せません。`)) return;
  deleteImagesButton.disabled = true;
  try {
    const response = await fetch("/api/images/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: list.map((figure) => ({
          filename: figure.entry.image.filename,
          subfolder: figure.entry.image.subfolder || "",
        })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || (response.status === 404
        ? "削除の準備が古い画面のままです。黒い画面で Ctrl + C を押してから、もう一度起動してください。"
        : "絵を消せませんでした。");
      throw new Error(message);
    }
    const gone = new Set([...(data.deleted || []), ...(data.missing || [])].map((item) => imageKey(item)));
    for (const figure of list) {
      if (!gone.has(imageKey(figure.entry.image))) continue;
      const section = figure.closest(".session");
      selectedFigures.delete(figure);
      if (detailFigures.includes(figure)) {
        detailFigures = detailFigures.filter((item) => item !== figure);
      }
      figure.remove();
      if (section && !section.querySelector("figure")) section.remove();
    }
    if (detail.open) {
      detailFigures = detailFigures.filter((figure) => figure.isConnected);
      if (!detailFigures.length) detail.close();
      else {
        detailIndex = Math.min(detailIndex, detailFigures.length - 1);
        showDetail();
      }
    }
    const failed = Array.isArray(data.failed) ? data.failed.length : 0;
    const removed = (data.deleted || []).length + (data.missing || []).length;
    statusLine.classList.toggle("error", failed > 0);
    statusLine.textContent = failed
      ? `${removed}枚消しました。${failed}枚は消せませんでした。`
      : `${removed}枚消しました。`;
    if (!gallery.querySelector("figure")) setSelectMode(false);
  } catch (error) {
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
  } finally {
    updateSelectBar();
    refreshSelectButton();
  }
}

selectButton.addEventListener("click", () => {
  const next = !document.body.classList.contains("select-mode");
  if (next && !gallery.querySelector("figure")) {
    statusLine.classList.add("error");
    statusLine.textContent = "まだ消せません。この画面に出ている絵だけ選べます。";
    return;
  }
  setSelectMode(next);
  if (!next) return;
  statusLine.classList.remove("error");
  statusLine.textContent = "消したい絵を押してください。やめる で元の見方に戻ります。";
});
deleteImagesButton.addEventListener("click", () => deleteFigures(selectedFigures));
const onThisPc = location.hostname === "127.0.0.1" || location.hostname === "localhost";
if (!onThisPc) {
  document.querySelector(".save-note").hidden = true;
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
  if (unfinishedJobs().length >= MAX_QUEUE) {
    statusLine.classList.add("error");
    statusLine.textContent = "待ちは 10 件までです。描き終わるまで、追加は待ってください。";
    return;
  }
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
  if (settings.guidance !== undefined && settings.guidance !== null) payload.guidance = settings.guidance;
  if (mode === "expand") payload.pad = Number(detailPad.value);
  startJob(payload, next);
}

detailVary.addEventListener("click", () => runFromDetail("vary"));
detailExpand.addEventListener("click", () => runFromDetail("expand"));

const detailScale = document.querySelector("#detail-scale");
const detailUpscaleModel = document.querySelector("#detail-upscale-model");
const detailClear = document.querySelector("#detail-clear");
const detailClearBox = document.querySelector("#detail-clear-box");
const detailClearColor = document.querySelector("#detail-clear-color");
const detailClearThreshold = document.querySelector("#detail-clear-threshold");
const detailClearValue = document.querySelector("#detail-clear-value");
const detailFinish = document.querySelector("#detail-finish");
const detailFinishNote = document.querySelector("#detail-finish-note");

function syncFinishForm() {
  const scaling = detailScale.value !== "0";
  detailUpscaleModel.hidden = !scaling;
  detailUpscaleModel.previousElementSibling.hidden = !scaling;
  detailClearBox.hidden = !detailClear.checked;
}

detailScale.addEventListener("change", syncFinishForm);
detailClear.addEventListener("change", syncFinishForm);
detailClearThreshold.addEventListener("input", () => {
  detailClearValue.textContent = detailClearThreshold.value;
});
syncFinishForm();

detailFinish.addEventListener("click", async () => {
  const source = JSON.parse(detail.dataset.source || "{}");
  if (!source.filename) {
    detailFinishNote.textContent = "この絵からは仕上げられません。もう一度、一覧の絵を開いてください。";
    return;
  }
  const scale = Number(detailScale.value);
  const clear = detailClear.checked;
  if (!scale && !clear) {
    detailFinishNote.textContent = "拡大か、色を透明にするか、どちらかを選んでください。";
    return;
  }
  detailFinish.disabled = true;
  detailFinish.textContent = "仕上げています…";
  detailFinishNote.textContent = scale
    ? "拡大エンジンを動かしています。大きい絵は少し時間がかかります。"
    : "選んだ色を透明にしています。";
  try {
    const response = await fetch("/api/images/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: source.filename,
        subfolder: source.subfolder || "",
        scale,
        model: detailUpscaleModel.value,
        clear,
        color: detailClearColor.value,
        threshold: Number(detailClearThreshold.value),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || (response.status === 404
        ? "仕上げの準備が古い画面のままです。黒い画面で Ctrl + C を押してから、もう一度起動してください。"
        : "仕上げられませんでした。");
      throw new Error(message);
    }
    const current = detailFigures[detailIndex];
    const base = current && current.entry ? current.entry.settings : JSON.parse(detail.dataset.settings || "{}");
    const settings = {
      ...base,
      width: data.image.width,
      height: data.image.height,
      kindLabel: "仕上げ",
      created: new Date().toLocaleString("ja-JP"),
    };
    const figure = createFigure(data.image, settings);
    const row = current && current.parentElement;
    if (row) {
      row.append(figure);
      row.style.setProperty("--count", String(row.querySelectorAll("figure").length));
      const session = current.closest(".session");
      detailFigures = [...session.querySelectorAll("figure")];
      detailIndex = detailFigures.indexOf(figure);
      showDetail();
    }
    detailFinishNote.textContent = "できました。元の絵はそのままで、新しい PNG を同じ場所に保存しました。";
    statusLine.classList.remove("error");
    statusLine.textContent = "仕上げた絵を保存しました。";
  } catch (error) {
    detailFinishNote.textContent = error.message;
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
  } finally {
    detailFinish.disabled = false;
    detailFinish.textContent = "仕上げる";
  }
});

function applySettings(settings) {
  checkpointSelect.value = settings.checkpoint;
  if (fluxGuidance && settings.guidance !== undefined && settings.guidance !== null) {
    fluxGuidance.value = String(settings.guidance);
  }
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
setupTraining();

if (fluxGuidance) {
  fluxGuidance.addEventListener("input", () => { fluxGuidance.dataset.touched = "1"; });
}

/* 2026-11-16f: iPhoneでキーボードが出ても入力欄が見えるよう、見えている高さに合わせる */
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--vvh", vv.height + "px");
    root.style.setProperty("--vvtop", vv.offsetTop + "px");
    const kb = isPhone() && vv.height < window.innerHeight * 0.85;
    document.body.classList.toggle("kb-open", kb);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
  document.addEventListener("focusin", (event) => {
    if (!isPhone() || !event.target.matches("textarea, input, select")) return;
    setTimeout(() => {
      update();
      event.target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 300);
  });
  document.addEventListener("focusout", () => setTimeout(update, 100));
})();

function setupTraining() {
  const dialog = document.querySelector("#train");
  const nameInput = document.querySelector("#train-name");
  const triggerInput = document.querySelector("#train-trigger");
  const checkpointInput = document.querySelector("#train-checkpoint");
  const rankInput = document.querySelector("#train-rank");
  const repeatsInput = document.querySelector("#train-repeats");
  const epochInput = document.querySelector("#train-epochs");
  const previewInput = document.querySelector("#train-preview-prompt");
  const resolutionInput = document.querySelector("#train-resolution");
  const plan = document.querySelector("#train-plan");
  const fileInput = document.querySelector("#train-files");
  const grid = document.querySelector("#train-grid");
  const note = document.querySelector("#train-goal-note");
  const fluxNote = document.querySelector("#train-flux-note");
  const settings = document.querySelector("#train-settings");
  const dropFace = document.querySelector("#train-drop-face");
  const overwrite = document.querySelector("#train-overwrite");
  const autoButton = document.querySelector("#train-autotag");
  const startButton = document.querySelector("#train-start");
  const stopButton = document.querySelector("#train-stop");
  const trainStatus = document.querySelector("#train-status");
  const progress = document.querySelector("#train-progress");
  const results = document.querySelector("#train-results");
  const keepButton = document.querySelector("#train-keep");
  const keepNote = document.querySelector("#train-keep-note");
  const picked = new Set();
  const home = document.querySelector("#lora-home");
  const historyBoard = document.querySelector("#lora-history");
  const taskBoard = document.querySelector("#lora-tasks");
  const madeBoard = document.querySelector("#lora-made");
  const tagDialog = document.querySelector("#tag-detail");
  const tagImage = document.querySelector("#tag-detail-image");
  const tagOwn = document.querySelector("#tag-own");
  const tagAll = document.querySelector("#tag-all");
  let imageRows = [];
  let tagName = "";
  const notes = {
    style: "画風を覚えます。タグには、写っている人や物を残します。画風そのものは書かないので、呼び方の方に残ります。",
    character: "キャラクターを覚えます。髪や目のタグを外すと、その特徴は呼び方に結び付きます。",
    face: "顔の特徴を、FLUX.2 向けの短い英語で下準備します。学習そのものは次の対応です。髪や目の説明を外すと、顔は呼び方の方に残りやすくなります。",
  };
  let goal = "style";
  let datasetId = "";
  let polling = false;
  let seenDone = false;

  function setTrainStatus(text, isError) {
    trainStatus.textContent = text || "";
    trainStatus.classList.toggle("is-error", Boolean(isError));
  }

  async function trainPost(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "失敗しました。");
    return data;
  }

  function paintGoal() {
    document.querySelectorAll(".train-goal .choice").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.goal === goal ? "true" : "false");
    });
    note.textContent = notes[goal];
    const face = goal === "face";
    fluxNote.hidden = !face;
    settings.hidden = face;
    startButton.hidden = face;
    autoButton.textContent = face ? "文章を自動で付ける" : "タグを自動で付ける";
    if (goal === "style") {
      rankInput.value = "8";
      repeatsInput.value = "20";
      dropFace.checked = false;
    } else if (goal === "character") {
      rankInput.value = "16";
      repeatsInput.value = "30";
      dropFace.checked = true;
    } else {
      dropFace.checked = true;
    }
    if (!triggerInput.dataset.touched) {
      triggerInput.value = goal === "style" ? "rstyle" : goal === "character" ? "rchar" : "rface";
    }
  }

  function fillCheckpoints() {
    const current = checkpointSelect.value;
    checkpointInput.replaceChildren();
    checkpointItems.filter((item) => item.base === "sdxl").forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      if (item.id === current) option.selected = true;
      checkpointInput.appendChild(option);
    });
  }

  function splitTags(text) {
    return String(text || "").split(",").map((part) => part.trim()).filter(Boolean);
  }

  function cropText() {
    const size = resolutionInput.value || "768";
    return `${size}×${size}`;
  }

  function renderImages(images) {
    imageRows = images || [];
    grid.replaceChildren();
    imageRows.forEach((item) => {
      const card = document.createElement("article");
      card.className = "train-card";
      const frame = document.createElement("div");
      frame.className = "train-photo";
      const photo = document.createElement("img");
      photo.alt = "";
      photo.src = `/api/train/image?dataset=${encodeURIComponent(datasetId)}&name=${encodeURIComponent(item.name)}`;
      const crop = document.createElement("span");
      crop.className = "train-crop";
      crop.textContent = cropText();
      const info = document.createElement("button");
      info.type = "button";
      info.className = "train-info";
      info.textContent = "i";
      info.setAttribute("aria-label", "タグを見る");
      info.addEventListener("click", () => openTagDetail(item.name));
      frame.append(photo, crop, info);
      const tools = document.createElement("div");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "外す";
      remove.addEventListener("click", async () => {
        try {
          await trainPost("/api/train/delete-image", { dataset: datasetId, name: item.name });
          imageRows = imageRows.filter((row) => row.name !== item.name);
          card.remove();
          paintPlan();
        } catch (error) {
          setTrainStatus(error.message, true);
        }
      });
      tools.className = "train-card-tools";
      tools.append(remove);
      card.append(frame, tools);
      grid.appendChild(card);
    });
    paintPlan();
  }

  function imageUrl(name) {
    return `/api/train/image?dataset=${encodeURIComponent(datasetId)}&name=${encodeURIComponent(name)}`;
  }

  function tagChip(label, count, handlers) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    const text = document.createElement("span");
    text.textContent = count ? `${label}(${count})` : label;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "tag-edit";
    edit.setAttribute("aria-label", "タグを直す");
    edit.textContent = "✎";
    edit.addEventListener("click", () => {
      const input = document.createElement("input");
      input.value = label;
      input.maxLength = 80;
      chip.replaceChildren(input);
      input.focus();
      let done = false;
      const commit = () => {
        if (done) return;
        done = true;
        const value = input.value.trim();
        if (value && value.toLowerCase() !== label.toLowerCase()) handlers.onRename(value);
        else paintTagDetail();
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          done = true;
          paintTagDetail();
        }
      });
      input.addEventListener("blur", commit);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "タグを外す");
    remove.textContent = "×";
    remove.addEventListener("click", handlers.onRemove);
    chip.append(text, edit, remove);
    return chip;
  }

  function paintTagDetail() {
    const row = imageRows.find((item) => item.name === tagName);
    if (!row) return;
    tagImage.src = imageUrl(row.name);
    tagOwn.replaceChildren();
    splitTags(row.caption).forEach((tag) => {
      tagOwn.append(tagChip(tag, 0, {
        onRemove: () => changeTag({ name: tagName, action: "remove", tag }),
        onRename: (next) => changeTag({ name: tagName, action: "replace", tag, next }),
      }));
    });
    const counts = new Map();
    imageRows.forEach((item) => {
      const seen = new Set();
      splitTags(item.caption).forEach((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const current = counts.get(key) || { label: tag, count: 0 };
        current.count += 1;
        counts.set(key, current);
      });
    });
    tagAll.replaceChildren();
    [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).forEach((item) => {
      tagAll.append(tagChip(item.label, item.count, {
        onRemove: () => changeTag({ action: "remove", tag: item.label }),
        onRename: (next) => changeTag({ action: "replace", tag: item.label, next }),
      }));
    });
    const film = document.querySelector("#tag-film");
    film.replaceChildren();
    imageRows.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-thumb";
      button.setAttribute("aria-pressed", item.name === tagName ? "true" : "false");
      button.setAttribute("aria-label", "この画像のタグを見る");
      const photo = document.createElement("img");
      photo.alt = "";
      photo.src = imageUrl(item.name);
      button.append(photo);
      button.addEventListener("click", () => openTagDetail(item.name));
      film.append(button);
    });
  }

  function rewriteTags(tags, change) {
    const key = change.tag.toLowerCase();
    if (change.action === "remove") return tags.filter((tag) => tag.toLowerCase() !== key);
    if (change.action === "replace") {
      const next = String(change.next || "").trim();
      if (!next || next.length > 80) throw new Error("タグは 1〜80 文字にしてください。");
      return tags.map((tag) => (tag.toLowerCase() === key ? next : tag));
    }
    const next = tags.filter((tag) => tag.toLowerCase() !== key);
    if (change.place === "start") next.unshift(change.tag);
    else next.push(change.tag);
    return next;
  }

  async function changeTag(change) {
    const targets = change.name ? imageRows.filter((item) => item.name === change.name) : imageRows.slice();
    if (!targets.length) return;
    try {
      for (const row of targets) {
        const text = rewriteTags(splitTags(row.caption), change).join(", ");
        if (text === String(row.caption || "").trim()) continue;
        await trainPost("/api/train/caption", { dataset: datasetId, name: row.name, text });
        row.caption = text;
      }
      renderImages(imageRows);
      if (tagDialog.open) paintTagDetail();
    } catch (error) {
      setTrainStatus(error.message, true);
    }
  }

  function openTagDetail(name) {
    tagName = name;
    paintTagDetail();
    if (!tagDialog.open) tagDialog.showModal();
  }

  function stepTag(delta) {
    const index = imageRows.findIndex((item) => item.name === tagName);
    if (index < 0 || !imageRows.length) return;
    const next = imageRows[(index + delta + imageRows.length) % imageRows.length];
    openTagDetail(next.name);
  }

  function paintPlan() {
    const images = grid.querySelectorAll(".train-card").length;
    const repeats = Number(repeatsInput.value) || 0;
    const epochs = Number(epochInput.value) || 0;
    const steps = images * repeats * epochs;
    const files = `LoRAは${epochs}個できます。`;
    const count = document.querySelector("#train-count");
    if (count) count.textContent = images ? `${images}枚` : "";
    plan.textContent = images
      ? `${images}枚 × 繰り返し${repeats} × エポック${epochs} = ${steps}回。${files}同時に学習できるのは1つです。`
      : `繰り返し${repeats} × エポック${epochs}。画像を入れると、枚数を掛けた回数が学習回数です。${files}同時に学習できるのは1つです。`;
  }

  async function ensureDataset() {
    const saved = await trainPost("/api/train/dataset", {
      id: datasetId,
      name: nameInput.value.trim(),
      goal,
      trigger: triggerInput.value.trim(),
    });
    datasetId = saved.id;
    return saved;
  }

  function paintResults(list, dataset, state) {
    const items = Array.isArray(list) ? list : [];
    const alive = new Set(items.map((item) => item.file));
    results.querySelectorAll(".train-result").forEach((card) => {
      if (!alive.has(card.dataset.file)) card.remove();
    });
    items.forEach((item, index) => {
      let card = [...results.children].find((node) => node.dataset.file === item.file);
      if (!card) {
        card = document.createElement("button");
        card.type = "button";
        card.className = "train-result";
        card.dataset.file = item.file;
        card.addEventListener("click", () => {
          const on = card.getAttribute("aria-pressed") !== "true";
          card.setAttribute("aria-pressed", on ? "true" : "false");
          if (on) picked.add(item.file);
          else picked.delete(item.file);
          keepButton.disabled = picked.size === 0;
        });
        results.appendChild(card);
      }
      card.setAttribute("aria-pressed", picked.has(item.file) ? "true" : "false");
      const caption = `${index + 1}. ${item.label || item.file}`;
      let visual = card.querySelector("img, .train-result-wait");
      if (item.preview && dataset) {
        const url = `/api/train/preview?dataset=${encodeURIComponent(dataset)}&name=${encodeURIComponent(item.preview)}`;
        if (!visual || visual.tagName !== "IMG") {
          visual = document.createElement("img");
          visual.alt = caption;
          card.prepend(visual);
          card.querySelector(".train-result-wait")?.remove();
        }
        if (visual.dataset.url !== url) {
          visual.dataset.url = url;
          visual.src = url;
        }
      } else if (!visual || !visual.classList.contains("train-result-wait")) {
        visual = document.createElement("div");
        visual.className = "train-result-wait";
        card.prepend(visual);
        card.querySelector("img")?.remove();
      }
      if (visual.classList.contains("train-result-wait")) {
        visual.textContent = state === "running" ? "見本を描いています" : "見本は描けませんでした";
      }
      let title = card.querySelector("strong");
      if (!title) {
        title = document.createElement("strong");
        card.appendChild(title);
      }
      title.textContent = caption;
    });
    const show = items.length > 0;
    results.hidden = !show;
    const canSave = show && state !== "running";
    keepNote.hidden = !canSave;
    keepButton.hidden = !canSave;
    keepButton.disabled = picked.size === 0;
  }

  async function pollTrain() {
    if (polling) return;
    polling = true;
    try {
      const response = await fetch("/api/train/status");
      if (!response.ok) return;
      const data = await response.json();
      const running = data.state === "running";
      if (data.dataset) datasetId = data.dataset;
      stopButton.hidden = !running;
      startButton.disabled = running;
      progress.hidden = true;
      results.hidden = true;
      keepNote.hidden = true;
      keepButton.hidden = true;
      if (running) {
        const total = Number(data.total) || 0;
        const step = Number(data.step) || 0;
        const loss = data.loss == null ? "" : ` 誤差 ${data.loss}`;
        const text = `${data.message || "学習中です。"} ${step}/${total}${loss} 進みと見本は、開いたタブに出ます。`;
        setTrainStatus(text, false);
        statusLine.textContent = text;
        setTimeout(pollTrain, 2000);
      } else if (data.state === "error" || data.state === "stopped") {
        setTrainStatus(data.message || "", data.state === "error");
      } else if (data.state === "done" && !seenDone) {
        seenDone = true;
        const text = "見本ができました。開いたタブで残すカードを選んで保存してください。";
        setTrainStatus(text, false);
        statusLine.textContent = text;
      } else if (data.state === "done") {
        setTrainStatus(data.message || "", false);
      }
    } catch (error) {
      setTrainStatus("進み具合を確認できませんでした。", true);
    } finally {
      polling = false;
    }
  }

  function showLoraTab(name) {
    historyBoard.hidden = name !== "history";
    taskBoard.hidden = name !== "tasks";
    madeBoard.hidden = name !== "loras";
    document.querySelectorAll("[data-lora-tab]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.loraTab === name ? "true" : "false");
    });
  }

  function whenText(stamp) {
    const time = Number(stamp);
    if (!time) return "";
    return new Date(time * 1000).toLocaleString("ja-JP");
  }

  const stateLabel = { running: "学習中", done: "完了", error: "失敗", stopped: "中止" };

  async function loadLoraHome() {
    const response = await fetch("/api/train/history");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "履歴を読めませんでした。");
    historyBoard.replaceChildren();
    const board = document.createElement("div");
    board.className = "history-grid";
    const fresh = document.createElement("button");
    fresh.type = "button";
    fresh.className = "history-new";
    fresh.textContent = "新しく学習する";
    fresh.addEventListener("click", () => openFreshTraining());
    board.append(fresh);
    (data.datasets || []).forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "history-card";
      if (item.cover) {
        const photo = document.createElement("img");
        photo.alt = "";
        photo.src = `/api/train/image?dataset=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.cover)}`;
        card.append(photo);
      }
      const title = document.createElement("strong");
      title.textContent = item.name || "無題";
      const meta = document.createElement("span");
      meta.className = "hint";
      meta.textContent = `${item.images || 0}枚 · ${whenText(item.updated)}`;
      card.append(title, meta);
      card.addEventListener("click", () => openSavedTraining(item.id).catch((error) => setTrainStatus(error.message, true)));
      board.append(card);
    });
    historyBoard.append(board);
    const taskList = document.createElement("div");
    taskList.className = "task-list";
    (data.tasks || []).forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "task-card";
      const title = document.createElement("strong");
      title.textContent = item.name || "無題";
      const state = document.createElement("span");
      state.className = "task-state";
      state.textContent = stateLabel[item.state] || "未学習";
      const meta = document.createElement("span");
      meta.className = "task-meta";
      meta.textContent = `${item.images || 0}枚 · 繰り返し ${item.repeats || "-"} · エポック ${item.epochs || "-"}`;
      const model = document.createElement("span");
      model.className = "task-meta";
      model.textContent = item.checkpoint || "基礎モデルなし";
      const when = document.createElement("span");
      when.className = "task-meta";
      when.textContent = whenText(item.finished || item.started) || "日時なし";
      card.append(title, state, meta, model, when);
      card.addEventListener("click", () => openSavedTraining(item.dataset).catch((error) => setTrainStatus(error.message, true)));
      taskList.append(card);
    });
    if (!(data.tasks || []).length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "まだ学習の記録はありません。";
      taskBoard.replaceChildren(empty);
    } else {
      taskBoard.replaceChildren(taskList);
    }
    const made = document.createElement("div");
    made.className = "made-grid";
    (data.loras || []).forEach((item) => {
      const card = document.createElement("article");
      card.className = "made-card";
      const frame = document.createElement("div");
      frame.className = "made-photo";
      if (item.preview) {
        const photo = document.createElement("img");
        photo.alt = "";
        photo.src = item.preview;
        frame.append(photo);
      } else {
        const blank = document.createElement("div");
        blank.className = "train-result-wait";
        blank.textContent = "見本なし";
        frame.append(blank);
      }
      const band = document.createElement("span");
      band.className = "made-band";
      band.textContent = `${item.uses || 0}枚`;
      const create = document.createElement("button");
      create.type = "button";
      create.className = "made-create";
      create.textContent = "創作";
      create.addEventListener("click", () => useMadeLora(item));
      frame.append(band, create);
      const title = document.createElement("form");
      title.className = "made-add";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 40;
      nameInput.value = item.name || "";
      nameInput.placeholder = "表示名";
      nameInput.setAttribute("aria-label", "表示名");
      const nameSave = document.createElement("button");
      nameSave.type = "submit";
      nameSave.textContent = "保存";
      title.append(nameInput, nameSave);
      const words = document.createElement("div");
      words.className = "made-words";
      const fold = document.createElement("details");
      fold.className = "made-triggers";
      const summary = document.createElement("summary");
      const summaryText = document.createElement("span");
      summary.append(summaryText);
      const editor = document.createElement("form");
      editor.className = "made-add";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 80;
      input.placeholder = "足したい呼び方";
      input.setAttribute("aria-label", `${item.name || "LoRA"} に足す呼び方`);
      const save = document.createElement("button");
      save.type = "submit";
      save.textContent = "登録";
      const note = document.createElement("p");
      note.className = "hint made-note";
      note.textContent = "入力した内容が、登録で1つの呼び方になります。学習で覚えた最初の言葉は残ります。";
      const paintWords = (list) => {
        words.replaceChildren();
        summaryText.textContent = list.length ? `呼び方（${list.length}）` : "呼び方";
        list.forEach((text, index) => {
          const chip = document.createElement("span");
          chip.className = "made-word";
          const label = document.createElement("span");
          label.textContent = text;
          chip.append(label);
          if (index > 0) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.setAttribute("aria-label", "この呼び方を外す");
            remove.addEventListener("click", () => sendTrigger(text, true));
            chip.append(remove);
          }
          words.append(chip);
        });
      };
      const sendTrigger = async (word, remove) => {
        const text = String(word || "").trim();
        if (!text) {
          note.classList.add("is-error");
          note.textContent = "足したい呼び方を入力してください。";
          return;
        }
        save.disabled = true;
        note.classList.remove("is-error");
        note.textContent = remove ? "外しています..." : "登録しています...";
        try {
          const saved = await trainPost("/api/train/trigger", { id: item.id, word: text, remove: Boolean(remove) });
          item.trigger = saved.trigger || item.trigger;
          item.triggers = saved.triggers || [];
          if (!remove) input.value = "";
          paintWords(item.triggers);
          note.classList.remove("is-error");
          note.textContent = remove
            ? "その呼び方を外しました。学習で覚えた言葉は残っています。"
            : "1つの呼び方として足しました。生成画面でこの LoRA を選ぶと、ボタンが増えます。";
          const target = window.opener;
          if (target && !target.closed && typeof target.reloadLoraWords === "function") {
            target.reloadLoraWords();
          }
        } catch (error) {
          note.classList.add("is-error");
          note.textContent = error.message;
        } finally {
          save.disabled = false;
        }
      };
      paintWords(item.triggers && item.triggers.length ? item.triggers : (item.trigger ? [item.trigger] : []));
      editor.append(input, save);
      editor.addEventListener("submit", (event) => {
        event.preventDefault();
        sendTrigger(input.value, false);
      });
      const removeLora = document.createElement("button");
      removeLora.type = "button";
      removeLora.className = "made-delete";
      removeLora.textContent = "削除";
      let armed = false;
      let armTimer = 0;
      const disarm = () => {
        armed = false;
        window.clearTimeout(armTimer);
        removeLora.textContent = "削除";
      };
      removeLora.addEventListener("click", async () => {
        const label = item.name || item.id;
        if (!armed) {
          armed = true;
          removeLora.textContent = "本当に削除";
          note.classList.remove("is-error");
          note.textContent = `「${label}」を削除します。ファイルも消えて、元には戻せません。もう一度押すと消します。`;
          window.clearTimeout(armTimer);
          armTimer = window.setTimeout(() => {
            if (!armed) return;
            disarm();
            note.textContent = "入力した内容が、登録で1つの呼び方になります。学習で覚えた最初の言葉は残ります。";
          }, 6000);
          return;
        }
        disarm();
        removeLora.disabled = true;
        note.classList.remove("is-error");
        note.textContent = "削除しています...";
        try {
          const response = await fetch("/api/train/delete-lora", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id }),
          });
          const saved = await response.json().catch(() => ({}));
          if (response.status === 404) {
            throw new Error("削除の準備がまだです。Atelier R を終了して、もう一度起動してください。");
          }
          if (!response.ok) throw new Error(saved.error || "削除できませんでした。");
          card.remove();
          if (!made.querySelector(".made-card")) {
            const empty = document.createElement("p");
            empty.className = "hint";
            empty.textContent = "まだ、この画面で保存した LoRA はありません。";
            madeBoard.replaceChildren(empty);
          }
          const target = window.opener;
          if (target && !target.closed && typeof target.reloadLoraWords === "function") {
            target.reloadLoraWords();
          }
        } catch (error) {
          note.classList.add("is-error");
          note.textContent = error.message;
          removeLora.disabled = false;
        }
      });
      fold.append(summary, words, editor);
      title.addEventListener("submit", async (event) => {
        event.preventDefault();
        const next = nameInput.value.trim();
        if (!next) {
          note.classList.add("is-error");
          note.textContent = "表示名を入力してください。";
          return;
        }
        nameSave.disabled = true;
        note.classList.remove("is-error");
        note.textContent = "表示名を保存しています...";
        try {
          const saved = await trainPost("/api/train/name", { id: item.id, name: next });
          item.name = saved.name || next;
          nameInput.value = item.name;
          note.classList.remove("is-error");
          note.textContent = `表示名を「${item.name}」にしました。生成画面の一覧も、この名前になります。`;
          const target = window.opener;
          if (target && !target.closed && typeof target.reloadLoraWords === "function") {
            target.reloadLoraWords();
          }
        } catch (error) {
          note.classList.add("is-error");
          note.textContent = error.message;
        } finally {
          nameSave.disabled = false;
        }
      });
      card.append(frame, title, removeLora, fold, note);
      made.append(card);
    });
    if (!(data.loras || []).length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "まだ、この画面で保存した LoRA はありません。";
      madeBoard.replaceChildren(empty);
    } else {
      madeBoard.replaceChildren(made);
    }
  }

  function useMadeLora(item) {
    const target = window.opener;
    if (target && !target.closed && typeof target.chooseLoraForCreate === "function") {
      const ok = target.chooseLoraForCreate(item.id, item.name || item.id);
      if (ok) target.focus();
      else setTrainStatus("生成画面の基礎モデルでは、この LoRA は使えません。", true);
      return;
    }
    setTrainStatus("創作は、生成画面の LoRA ボタンから開いたタブで使えます。", true);
  }

  function openFreshTraining() {
    datasetId = "";
    delete triggerInput.dataset.touched;
    nameInput.value = "";
    previewInput.value = "";
    imageRows = [];
    fillCheckpoints();
    paintGoal();
    renderImages([]);
    setTrainStatus("", false);
    dialog.showModal();
    pollTrain();
  }

  async function openSavedTraining(id) {
    fillCheckpoints();
    const response = await fetch(`/api/train/dataset?id=${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "学習を開けませんでした。");
    datasetId = data.id;
    nameInput.value = data.name || "";
    triggerInput.value = data.trigger || "";
    triggerInput.dataset.touched = "1";
    goal = data.goal || "style";
    paintGoal();
    triggerInput.value = data.trigger || triggerInput.value;
    if (data.rank) rankInput.value = String(data.rank);
    if (data.repeats) repeatsInput.value = String(data.repeats);
    if (data.epochs) epochInput.value = String(data.epochs);
    if (data.resolution) resolutionInput.value = String(data.resolution);
    if (data.preview_prompt) previewInput.value = data.preview_prompt;
    if (data.checkpoint && [...checkpointInput.options].some((option) => option.value === data.checkpoint)) {
      checkpointInput.value = data.checkpoint;
    }
    renderImages(data.images || []);
    paintPlan();
    setTrainStatus("前の設定を開きました。画像やタグを直して、もう一度学習できます。", false);
    dialog.showModal();
    pollTrain();
  }

  const trainOpen = document.querySelector("#train-open");
  const setTrainOpen = (open) => trainOpen.setAttribute("aria-pressed", open ? "true" : "false");
  trainOpen.addEventListener("click", () => {
    const opened = window.open("/lora", "atelier-lora");
    if (!opened) {
      statusLine.classList.add("error");
      statusLine.textContent = "新しいタブを開けませんでした。ブラウザでポップアップを許可してください。";
      return;
    }
    opened.focus();
  });
  dialog.addEventListener("close", () => {
    if (!home.open) setTrainOpen(false);
    if (home.open) loadLoraHome().catch(() => {});
  });
  home.addEventListener("close", () => {
    if (!dialog.open) setTrainOpen(false);
  });
  document.querySelector("#lora-home-close").addEventListener("click", () => home.close());
  document.querySelector("#lora-home-scrim").addEventListener("click", () => home.close());
  document.querySelectorAll("[data-lora-tab]").forEach((button) => {
    button.addEventListener("click", () => showLoraTab(button.dataset.loraTab));
  });
  document.querySelector("#tag-detail-close").addEventListener("click", () => tagDialog.close());
  document.querySelector("#tag-detail-scrim").addEventListener("click", () => tagDialog.close());
  document.querySelector("#tag-prev").addEventListener("click", () => stepTag(-1));
  document.querySelector("#tag-next").addEventListener("click", () => stepTag(1));
  const tagInput = document.querySelector("#tag-input");
  const addSharedTag = (place) => {
    const tag = tagInput.value.trim();
    if (!tag) return;
    tagInput.value = "";
    changeTag({ action: "add", tag, place });
  };
  document.querySelector("#tag-add-front").addEventListener("click", () => addSharedTag("start"));
  document.querySelector("#tag-add-end").addEventListener("click", () => addSharedTag("end"));
  tagInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSharedTag("end");
  });
  resolutionInput.addEventListener("change", () => {
    const text = cropText();
    grid.querySelectorAll(".train-crop").forEach((badge) => { badge.textContent = text; });
  });
  function setupWatch() {
    document.body.classList.add("lora-page", "lora-watch");
    document.title = "学習の進み · Atelier R";
    const root = document.querySelector("#train-watch");
    root.hidden = false;
    const title = document.querySelector("#watch-title");
    const eta = document.querySelector("#watch-eta");
    const bar = document.querySelector("#watch-progress-bar");
    const meta = document.querySelector("#watch-meta");
    const stop = document.querySelector("#watch-stop");
    const count = document.querySelector("#watch-count");
    const cards = document.querySelector("#watch-cards");
    const all = document.querySelector("#watch-all");
    const pickedLabel = document.querySelector("#watch-picked");
    const keep = document.querySelector("#watch-keep");
    const sample = document.querySelector("#watch-sample");
    const chosen = new Set();
    let clock = 0;
    let clockStep = 0;
    let known = null;
    let latest = null;
    let ticking = false;

    function clockText(seconds) {
      const whole = Math.max(0, Math.round(seconds));
      return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
    }

    function paintChosen() {
      const boxes = [...cards.querySelectorAll("input[type=checkbox]")];
      pickedLabel.textContent = `選択済み ${chosen.size}`;
      all.checked = boxes.length > 0 && boxes.every((box) => box.checked);
      keep.disabled = chosen.size === 0;
    }

    function paintSample(data, candidates) {
      const shown = [...candidates].reverse().find((item) => item.preview);
      const key = shown ? `${data.dataset}:${shown.preview}` : "";
      if (sample.dataset.key === key) return;
      sample.dataset.key = key;
      sample.replaceChildren();
      if (!shown || !data.dataset) {
        const empty = document.createElement("p");
        empty.className = "watch-empty";
        empty.textContent = "現在サンプル画像はありません";
        sample.append(empty);
        return;
      }
      const photo = document.createElement("img");
      photo.alt = "見本";
      photo.src = `/api/train/preview?dataset=${encodeURIComponent(data.dataset)}&name=${encodeURIComponent(shown.preview)}`;
      const caption = document.createElement("p");
      caption.className = "watch-caption";
      const index = candidates.findIndex((item) => item.file === shown.file) + 1;
      const loss = data.loss == null ? "" : ` loss: ${data.loss}`;
      const prompt = known?.preview_prompt || "";
      caption.textContent = `LoRA ${index} step: ${data.step || 0}${loss}${prompt ? ` ${prompt}` : ""}`;
      sample.append(photo, caption);
    }

    function paintCards(data) {
      const candidates = Array.isArray(data.candidates) ? data.candidates : [];
      const epochs = Math.max(1, Number(known?.epochs) || candidates.length || 1);
      const running = data.state === "running";
      const done = candidates.length;
      count.textContent = `LoRA ${Math.min(done, epochs)}/${epochs}`;
      [...chosen].forEach((file) => {
        if (!candidates.some((item) => item.file === file)) chosen.delete(file);
      });
      const slots = candidates.slice();
      if (running && done < epochs) slots.push(null);
      const shape = `${data.state}|${slots.map((item) => (item ? item.file : "progress")).join(",")}`;
      const total = Number(data.total) || 0;
      const step = Number(data.step) || 0;
      const per = epochs ? total / epochs : 0;
      const ratio = per > 0 ? Math.max(0, Math.min(1, (step - done * per) / per)) : 0;
      if (cards.dataset.shape !== shape) {
        cards.dataset.shape = shape;
        cards.replaceChildren();
        slots.forEach((item, index) => {
          const card = document.createElement("article");
          card.className = "watch-card";
          if (item && item.preview && data.dataset) {
            const box = document.createElement("input");
            box.type = "checkbox";
            box.className = "watch-check";
            box.dataset.file = item.file;
            box.checked = chosen.has(item.file);
            box.disabled = running;
            box.addEventListener("change", () => {
              if (box.checked) chosen.add(item.file);
              else chosen.delete(item.file);
              paintChosen();
            });
            const photo = document.createElement("img");
            photo.alt = "";
            photo.src = `/api/train/preview?dataset=${encodeURIComponent(data.dataset)}&name=${encodeURIComponent(item.preview)}`;
            const band = document.createElement("span");
            band.className = "watch-band";
            band.textContent = `LoRA ${index + 1}`;
            card.append(box, photo, band);
          } else if (item) {
            const wait = document.createElement("div");
            wait.className = "train-result-wait";
            wait.textContent = "見本は描けませんでした";
            card.append(wait);
          } else {
            const ring = document.createElement("div");
            ring.className = "watch-ring";
            const label = document.createElement("span");
            label.textContent = "0%";
            ring.append(label);
            card.append(ring);
          }
          cards.append(card);
        });
      }
      const ring = cards.querySelector(".watch-ring");
      if (ring) {
        ring.style.setProperty("--p", `${Math.round(ratio * 100)}%`);
        ring.querySelector("span").textContent = `${Math.round(ratio * 100)}%`;
      }
      keep.hidden = running || data.state !== "done" || !candidates.length;
      paintChosen();
      paintSample(data, candidates);
    }

    async function refresh() {
      if (ticking) return;
      ticking = true;
      try {
        const response = await fetch("/api/train/status");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "進みを確認できませんでした。");
        latest = data;
        if (data.dataset && known?.id !== data.dataset) {
          const view = await fetch(`/api/train/dataset?id=${encodeURIComponent(data.dataset)}`);
          const body = await view.json().catch(() => ({}));
          if (view.ok) known = body;
        }
        const running = data.state === "running";
        const total = Number(data.total) || 0;
        const step = Number(data.step) || 0;
        const percent = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;
        bar.style.width = running || data.state === "done" ? `${percent}%` : "0%";
        stop.hidden = !running;
        if (running) {
          if (!clock || step < clockStep) {
            clock = Date.now();
            clockStep = step;
          }
          const gained = step - clockStep;
          const elapsed = (Date.now() - clock) / 1000;
          title.textContent = step > 0 ? "トレーニング中" : "お待ちください...";
          eta.textContent = gained > 0 && total > step
            ? `完了までの推定時間 ${clockText((total - step) / (gained / elapsed))}`
            : "";
          const epochs = Math.max(1, Number(known?.epochs) || 1);
          const epoch = Math.min(epochs, (data.candidates || []).length + 1);
          const loss = data.loss == null ? "" : ` Loss: ${data.loss}`;
          meta.textContent = total ? `Steps: ${step}/${total} (${percent}%)${loss} Epoch: ${epoch}/${epochs}` : (data.message || "");
        } else if (data.state === "done") {
          title.textContent = "トレーニング完了";
          eta.textContent = "";
          meta.textContent = data.message || "残したいカードを選んで保存してください。";
        } else if (data.state === "stopped") {
          title.textContent = "トレーニングを停止しました";
          eta.textContent = "";
          meta.textContent = data.message || "";
        } else if (data.state === "error") {
          title.textContent = "トレーニングが止まりました";
          eta.textContent = "";
          meta.textContent = data.message || "";
        } else {
          title.textContent = "学習は始まっていません";
          eta.textContent = "";
          meta.textContent = "学習を始めると、ここに進みと見本が出ます。";
        }
        paintCards(data);
      } catch (error) {
        title.textContent = "進みを確認できませんでした";
        meta.textContent = error.message || "";
      } finally {
        ticking = false;
      }
    }

    all.addEventListener("change", () => {
      cards.querySelectorAll("input[type=checkbox]").forEach((box) => {
        box.checked = all.checked;
        if (all.checked) chosen.add(box.dataset.file);
        else chosen.delete(box.dataset.file);
      });
      paintChosen();
    });
    stop.addEventListener("click", async () => {
      try {
        await trainPost("/api/train/stop", {});
        title.textContent = "学習を止めています";
      } catch (error) {
        meta.textContent = error.message;
      }
    });
    keep.addEventListener("click", async () => {
      if (!chosen.size || !latest?.dataset) return;
      if (!window.confirm(`選んだ ${chosen.size} 個を保存します。選んでいないものは消えます。`)) return;
      keep.disabled = true;
      try {
        const saved = await trainPost("/api/train/keep", { dataset: latest.dataset, files: [...chosen] });
        chosen.clear();
        cards.dataset.shape = "";
        sample.dataset.key = "";
        title.textContent = `${(saved.saved || []).length} 個保存しました。`;
        await refresh();
      } catch (error) {
        meta.textContent = error.message;
        keep.disabled = false;
      }
    });
    const loop = () => refresh().finally(() => setTimeout(loop, 2000));
    loop();
  }

  const watchPage = location.pathname === "/lora" && new URLSearchParams(location.search).get("watch") === "1";
  if (location.pathname === "/lora" && !watchPage) {
    document.body.classList.add("lora-page");
    document.title = "LoRA · Atelier R";
    home.setAttribute("open", "");
    showLoraTab("history");
    loadLoraHome().catch((error) => {
      historyBoard.textContent = error.message;
    });
  }
  if (watchPage) setupWatch();
  document.querySelector("#train-close").addEventListener("click", () => dialog.close());
  document.querySelector("#train-scrim").addEventListener("click", () => dialog.close());
  document.querySelectorAll(".train-goal .choice").forEach((button) => {
    button.addEventListener("click", () => {
      goal = button.dataset.goal;
      paintGoal();
    });
  });
  triggerInput.addEventListener("input", () => { triggerInput.dataset.touched = "1"; });
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    if (!files.length) return;
    setTrainStatus("画像を加えています。", false);
    try {
      await ensureDataset();
      for (const file of files) {
        const form = new FormData();
        form.set("dataset", datasetId);
        form.set("image", file);
        const response = await fetch("/api/train/image", { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "画像を加えられませんでした。");
      }
      renderImages((await ensureDataset()).images);
      setTrainStatus(`${files.length} 枚加えました。`, false);
    } catch (error) {
      setTrainStatus(error.message, true);
    }
  });
  autoButton.addEventListener("click", async () => {
    autoButton.disabled = true;
    setTrainStatus(goal === "face" ? "文章を付けています。最初の1回は、説明用のモデルを取り込むので少し待ちます。" : "タグを付けています。", false);
    try {
      const saved = await ensureDataset();
      const tagged = await trainPost("/api/train/autotag", {
        dataset: saved.id,
        trigger: triggerInput.value.trim(),
        goal,
        drop_face: dropFace.checked,
        overwrite: overwrite.checked,
      });
      renderImages(tagged.images);
      setTrainStatus(tagged.note || `${tagged.changed} 枚に説明を付けました。気になるところは書き直せます。`, false);
    } catch (error) {
      setTrainStatus(error.message, true);
    } finally {
      autoButton.disabled = false;
    }
  });
  startButton.addEventListener("click", async () => {
    const watchTab = window.open("about:blank", "atelier-watch");
    startButton.disabled = true;
    setTrainStatus("学習を始めています。", false);
    try {
      const saved = await ensureDataset();
      if ((saved.images || []).length < 5) throw new Error("画像は 5 枚以上にしてください。");
      seenDone = false;
      picked.clear();
      await trainPost("/api/train/start", {
        dataset: saved.id,
        checkpoint: checkpointInput.value,
        goal,
        trigger: triggerInput.value.trim(),
        name: nameInput.value.trim() || triggerInput.value.trim(),
        rank: Number(rankInput.value),
        repeats: Number(repeatsInput.value),
        epochs: Number(epochInput.value),
        resolution: Number(resolutionInput.value),
        preview_prompt: previewInput.value.trim(),
        output: `${triggerInput.value.trim() || "lora"}_${goal}`,
      });
      if (watchTab) {
        watchTab.location = `/lora?watch=1&t=${Date.now()}`;
        watchTab.focus();
        setTrainStatus("学習を始めました。進みは新しいタブに出ます。", false);
      } else {
        setTrainStatus("進みのタブを開けませんでした。ブラウザでポップアップを許可してください。", true);
      }
      pollTrain();
    } catch (error) {
      if (watchTab && !watchTab.closed) watchTab.close();
      setTrainStatus(error.message, true);
      startButton.disabled = false;
    }
  });
  stopButton.addEventListener("click", async () => {
    try {
      await trainPost("/api/train/stop", {});
      setTrainStatus("学習を止めています。", false);
    } catch (error) {
      setTrainStatus(error.message, true);
    }
  });
  keepButton.addEventListener("click", async () => {
    if (!picked.size) {
      setTrainStatus("残すカードを1つ以上選んでください。", true);
      return;
    }
    const count = picked.size;
    if (!window.confirm(`選んだ ${count} 個を保存します。選んでいないものは消えます。`)) return;
    keepButton.disabled = true;
    try {
      const saved = await trainPost("/api/train/keep", { dataset: datasetId, files: [...picked] });
      picked.clear();
      paintResults([], "", "done");
      await loadOptions();
      const text = `${(saved.saved || []).length} 個保存しました。LoRA の一覧から追加できます。`;
      setTrainStatus(text, false);
      statusLine.textContent = text;
    } catch (error) {
      setTrainStatus(error.message, true);
      keepButton.disabled = false;
    }
  });
  repeatsInput.addEventListener("input", paintPlan);
  epochInput.addEventListener("input", paintPlan);
  paintGoal();
  pollTrain();
}
