const checkpointSelect = document.querySelector("#checkpoint");
const loraSelect = document.querySelector("#lora");
const loraPanel = document.querySelector("#lora-panel");
const loraPreview = document.querySelector("#lora-preview");
const loraName = document.querySelector("#lora-name");
const loraRemove = document.querySelector("#lora-remove");
const strength = document.querySelector("#strength");
const strengthNumber = document.querySelector("#strength-number");
const triggerList = document.querySelector("#trigger-list");
const useAllTriggers = document.querySelector("#use-all-triggers");
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
let loraInfo = [];
let reuseSeed = null;
let outputFolder = "";

strength.addEventListener("input", () => {
  strengthNumber.value = Number(strength.value).toFixed(1);
});
strengthNumber.addEventListener("input", () => {
  const value = Math.min(2, Math.max(0, Number(strengthNumber.value) || 0));
  strength.value = value;
  strengthNumber.value = value.toFixed(1);
});
loraSelect.addEventListener("change", showLora);
loraRemove.addEventListener("click", () => {
  loraSelect.value = "";
  showLora();
});
useAllTriggers.addEventListener("click", () => {
  currentTriggers().forEach((text) => addTrigger(text));
});
promptBox.addEventListener("input", paintTriggers);

function currentLora() {
  return loraInfo.find((item) => item.id === loraSelect.value);
}

function currentTriggers() {
  const info = currentLora();
  return info && info.triggers ? info.triggers : [];
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
  promptBox.focus();
}

function paintTriggers() {
  triggerList.querySelectorAll(".trigger").forEach((button) => {
    button.setAttribute("aria-pressed", String(promptBox.value.includes(button.dataset.trigger)));
  });
}

function showLora() {
  const info = currentLora();
  const active = Boolean(info);
  loraPanel.hidden = !active;
  loraSelect.hidden = active;
  triggerList.replaceChildren();
  if (!info) return;
  loraName.textContent = info.name;
  loraPreview.src = info.preview || "";
  loraPreview.alt = info.name;
  info.triggers.forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "trigger";
    button.dataset.trigger = text;
    button.title = text;
    button.textContent = `${shortLabel(text)} ↑`;
    button.addEventListener("click", () => addTrigger(text));
    triggerList.appendChild(button);
  });
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
  if (!data.ready) {
    statusLine.textContent = "画像エンジンを起動しています。30 秒ほど待ってください。";
    setTimeout(loadOptions, 2000);
    return;
  }
  checkpointSelect.replaceChildren();
  data.checkpoints.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    if (item.name === "Holy Mix") option.selected = true;
    checkpointSelect.appendChild(option);
  });
  loraInfo = data.loras;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "追加する";
  loraSelect.replaceChildren(placeholder);
  data.loras.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    loraSelect.appendChild(option);
  });
  const olivia = data.loras.find((item) => item.id === "olivia.safetensors");
  if (olivia) loraSelect.value = olivia.id;
  renderRatios(data.ratios);
  showLora();
  statusLine.textContent = "準備できました。トリガーワードをクリックして、生成するを押してください。";
}

function currentSettings(seed) {
  clampCount();
  const checkpoint = checkpointSelect.selectedOptions[0];
  const lora = currentLora();
  const ratioButton = ratioBox.querySelector(`[data-value="${selectedRatio}"]`);
  return {
    checkpoint: checkpointSelect.value,
    checkpointName: checkpoint ? checkpoint.textContent : "",
    lora: loraSelect.value,
    loraName: lora ? lora.name : "なし",
    strength: Number(strength.value),
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateButton.disabled = true;
  statusLine.classList.remove("error");
  progressWrap.hidden = false;
  progressBar.classList.add("indeterminate");
  progressLabel.textContent = "準備しています";
  statusLine.textContent = "生成しています。モデルの読み込み中はバーが動き、描き始めるとステップが進みます。";
  const seed = reuseSeed;
  reuseSeed = null;
  const settings = currentSettings(seed);
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkpoint: settings.checkpoint,
        lora: settings.lora,
        strength: settings.strength,
        prompt: settings.prompt,
        negative: settings.negative,
        ratio: settings.ratio,
        width: settings.width,
        height: settings.height,
        count: settings.count,
        seed,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成を開始できませんでした。");
    settings.seed = data.seed;
    await waitForJob(data.prompt_id, settings);
  } catch (error) {
    statusLine.classList.add("error");
    statusLine.textContent = error.message;
  } finally {
    progressWrap.hidden = true;
    generateButton.disabled = false;
  }
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
  const label = document.createElement("p");
  label.className = "session-prompt";
  label.textContent = settings.prompt;
  const reuse = document.createElement("button");
  reuse.type = "button";
  reuse.className = "reuse-prompt";
  reuse.textContent = "プロンプトを再利用";
  reuse.addEventListener("click", () => appendPrompt(settings.prompt));
  head.append(label, reuse);
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

function openDetail(figure) {
  const session = figure.closest(".session");
  detailFigures = [...session.querySelectorAll("figure")];
  detailIndex = detailFigures.indexOf(figure);
  showDetail();
  if (!detail.open) detail.showModal();
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
  detailFacts.replaceChildren(
    fact("創作タイプ", "テキストから画像"),
    fact("作成日時", settings.created),
    fact("比率", settings.ratioLabel),
    fact("シード", String(settings.seed)),
    fact("サンプラー", "Euler a"),
    fact("ステップ", "28"),
    fact("CFG", "5.5"),
    fact("Clip Skip", "2"),
    fact("モデル", settings.checkpointName),
    fact("LoRA", settings.lora === "" ? "なし" : `${settings.loraName}（強さ ${settings.strength.toFixed(1)}）`),
    fact("保存先", image.path),
  );
  detailPrompt.textContent = settings.negative
    ? `${settings.prompt}\n\n避けたい内容: ${settings.negative}`
    : settings.prompt;
  detail.dataset.settings = JSON.stringify(settings);
}

function moveDetail(step) {
  detailIndex += step;
  showDetail();
}

detailPrev.addEventListener("click", () => moveDetail(-1));
detailNext.addEventListener("click", () => moveDetail(1));
document.querySelector("#detail-scrim").addEventListener("click", () => detail.close());
detail.addEventListener("click", (event) => {
  if (event.target === detail) detail.close();
});
detail.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveDetail(1);
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveDetail(-1);
  }
});
document.querySelector("#detail-close").addEventListener("click", () => detail.close());
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

function applySettings(settings) {
  checkpointSelect.value = settings.checkpoint;
  loraSelect.value = settings.lora || "";
  showLora();
  strength.value = settings.strength;
  strengthNumber.value = Number(settings.strength).toFixed(1);
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
