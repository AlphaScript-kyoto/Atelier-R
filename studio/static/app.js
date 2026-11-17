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
  if (window.matchMedia("(max-width: 800px)").matches) {
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";
    button.dataset.trigger = text;
    button.title = text;
    button.textContent = `${shortLabel(text)} ↑`;
    button.addEventListener("click", () => toggleTrigger(text));
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
  gallery.prepend(section);
  refreshSelectButton();
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
  if (event.target.closest(".side, #composer, .detail-side, .detail-layout, #picker-grid")) return;
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
document.querySelector("#detail-info").addEventListener("click", () => {
  if (isPhone()) {
    document.querySelector(".detail-side").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  detail.classList.add("info-open");
});
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
  const resolutionInput = document.querySelector("#train-resolution");
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

  function renderImages(images) {
    grid.replaceChildren();
    images.forEach((item) => {
      const card = document.createElement("article");
      card.className = "train-card";
      const photo = document.createElement("img");
      photo.alt = "";
      photo.src = `/api/train/image?dataset=${encodeURIComponent(datasetId)}&name=${encodeURIComponent(item.name)}`;
      const tools = document.createElement("div");
      const caption = document.createElement("textarea");
      caption.value = item.caption || "";
      caption.placeholder = "自動で付けるか、自分で書きます";
      caption.addEventListener("change", async () => {
        try {
          await trainPost("/api/train/caption", { dataset: datasetId, name: item.name, text: caption.value });
        } catch (error) {
          setTrainStatus(error.message, true);
        }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "外す";
      remove.addEventListener("click", async () => {
        try {
          await trainPost("/api/train/delete-image", { dataset: datasetId, name: item.name });
          card.remove();
        } catch (error) {
          setTrainStatus(error.message, true);
        }
      });
      tools.className = "train-card-tools";
      tools.append(remove);
      const side = document.createElement("div");
      side.append(caption, tools);
      card.append(photo, side);
      grid.appendChild(card);
    });
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

  async function pollTrain() {
    if (polling) return;
    polling = true;
    try {
      const response = await fetch("/api/train/status");
      if (!response.ok) return;
      const data = await response.json();
      const running = data.state === "running";
      stopButton.hidden = !running;
      startButton.disabled = running;
      if (running) {
        const loss = data.loss == null ? "" : ` 誤差 ${data.loss}`;
        const text = `${data.message || "学習中です。"} ${data.step || 0}/${data.total || 0}${loss}`;
        setTrainStatus(text, false);
        statusLine.textContent = text;
        setTimeout(pollTrain, 2000);
      } else if (data.state === "error" || data.state === "stopped") {
        setTrainStatus(data.message || "", data.state === "error");
      } else if (data.state === "done" && !seenDone) {
        seenDone = true;
        setTrainStatus(data.message || "学習が終わりました。", false);
        await loadOptions();
        statusLine.textContent = "学習が終わりました。LoRA の一覧から追加できます。";
      }
    } catch (error) {
      setTrainStatus("進み具合を確認できませんでした。", true);
    } finally {
      polling = false;
    }
  }

  const trainOpen = document.querySelector("#train-open");
  const setTrainOpen = (open) => trainOpen.setAttribute("aria-pressed", open ? "true" : "false");
  trainOpen.addEventListener("click", () => {
    fillCheckpoints();
    paintGoal();
    dialog.showModal();
    setTrainOpen(true);
    pollTrain();
  });
  dialog.addEventListener("close", () => setTrainOpen(false));
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
    startButton.disabled = true;
    setTrainStatus("学習を始めています。", false);
    try {
      const saved = await ensureDataset();
      if ((saved.images || []).length < 5) throw new Error("画像は 5 枚以上にしてください。");
      seenDone = false;
      await trainPost("/api/train/start", {
        dataset: saved.id,
        checkpoint: checkpointInput.value,
        goal,
        trigger: triggerInput.value.trim(),
        name: nameInput.value.trim() || triggerInput.value.trim(),
        rank: Number(rankInput.value),
        repeats: Number(repeatsInput.value),
        resolution: Number(resolutionInput.value),
        output: `${triggerInput.value.trim() || "lora"}_${goal}`,
      });
      pollTrain();
    } catch (error) {
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
  paintGoal();
  pollTrain();
}
