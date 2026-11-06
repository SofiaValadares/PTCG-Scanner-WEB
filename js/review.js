(() => {
  const $ = (id) => document.getElementById(id);
  const STORE = "ptcg-annotation-review";
  const IMAGE = /\.(jpe?g|png|webp|bmp)$/i;

  let images = [];
  let index = 0;
  let url = "";
  let marks = loadMarks();

  function loadMarks() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}");
    } catch {
      return {};
    }
  }

  function saveMarks() {
    localStorage.setItem(STORE, JSON.stringify(marks));
  }

  function markOf(name) {
    if (!marks[name]) marks[name] = { status: "", note: "", boxes: [] };
    return marks[name];
  }

  function parseNames(text) {
    const names = {};
    text.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*(\d+)\s*:\s*(.+?)\s*$/);
      if (match) names[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    });
    return names;
  }

  function parseLabel(text, names) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const id = parts[0];
        const nums = parts.slice(1, 9).map(Number);
        const quad = [];
        for (let i = 0; i + 1 < nums.length; i += 2) quad.push([nums[i], nums[i + 1]]);
        return { id, label: names[id] || `#${id}`, quad };
      })
      .filter((box) => box.quad.length === 4);
  }

  function stem(path) {
    const base = path.split(/[\\/]/).pop() || path;
    return base.replace(/\.[^.]+$/, "");
  }

  async function loadFiles(files) {
    const list = [...files];
    const yaml = list.find((file) => /(^|\/|\\)data\.yaml$/i.test(file.webkitRelativePath || file.name));
    const names = yaml ? parseNames(await yaml.text()) : {};
    const labels = new Map();
    const photos = [];
    for (const file of list) {
      const path = file.webkitRelativePath || file.name;
      if (IMAGE.test(path)) photos.push(file);
      else if (/\.txt$/i.test(path)) labels.set(stem(path), file);
    }
    photos.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "pt"));
    images = [];
    for (const file of photos) {
      const path = file.webkitRelativePath || file.name;
      const labelFile = labels.get(stem(path));
      const boxes = labelFile ? parseLabel(await labelFile.text(), names) : [];
      images.push({ file, path, boxes });
    }
    index = 0;
    if (!images.length) {
      $("empty").hidden = false;
      $("empty").textContent = "Não achei imagens nessa pasta.";
      $("stage").hidden = true;
      return;
    }
    show(0);
  }

  function show(next) {
    if (!images.length) return;
    index = (next + images.length) % images.length;
    const item = images[index];
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(item.file);
    $("shot").src = url;
    $("empty").hidden = true;
    $("stage").hidden = false;
    $("file-name").textContent = item.path;
    $("progress").textContent = `${index + 1} de ${images.length}`;
    const mark = markOf(item.path);
    $("note").value = mark.note || "";
    draw(item, mark);
    drawList(item, mark);
    drawWrong();
  }

  function draw(item, mark) {
    const svg = $("overlay");
    svg.innerHTML = "";
    item.boxes.forEach((box, boxIndex) => {
      const bad = mark.boxes.includes(boxIndex);
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", box.quad.map(([x, y]) => `${x},${y}`).join(" "));
      poly.setAttribute("fill", bad ? "rgba(239,107,107,0.28)" : "rgba(228,196,140,0.16)");
      poly.setAttribute("stroke", bad ? "#ef6b6b" : "#e4c48c");
      poly.setAttribute("stroke-width", "0.004");
      poly.addEventListener("click", () => toggleBox(boxIndex));
      svg.appendChild(poly);
      const [cx, cy] = centroid(box.quad);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy);
      text.setAttribute("fill", bad ? "#ffb4b4" : "#f3dfb6");
      text.setAttribute("font-size", "0.028");
      text.setAttribute("text-anchor", "middle");
      text.textContent = box.label;
      svg.appendChild(text);
    });
  }

  function centroid(quad) {
    const n = quad.length || 1;
    return [
      quad.reduce((sum, pt) => sum + pt[0], 0) / n,
      quad.reduce((sum, pt) => sum + pt[1], 0) / n,
    ];
  }

  function drawList(item, mark) {
    const list = $("box-list");
    list.innerHTML = "";
    if (!item.boxes.length) {
      const li = document.createElement("li");
      li.textContent = "Sem arquivo de anotação.";
      list.appendChild(li);
      return;
    }
    item.boxes.forEach((box, boxIndex) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = mark.boxes.includes(boxIndex) ? "bad" : "";
      button.textContent = `${boxIndex + 1}. ${box.label}`;
      button.addEventListener("click", () => toggleBox(boxIndex));
      li.appendChild(button);
      list.appendChild(li);
    });
  }

  function drawWrong() {
    const list = $("wrong-list");
    list.innerHTML = "";
    images.forEach((item, itemIndex) => {
      const mark = marks[item.path];
      if (!mark || mark.status !== "bad") return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bad";
      button.textContent = item.path.split(/[\\/]/).pop();
      button.addEventListener("click", () => show(itemIndex));
      const li = document.createElement("li");
      li.appendChild(button);
      list.appendChild(li);
    });
    if (!list.children.length) {
      const li = document.createElement("li");
      li.textContent = "Nenhuma ainda.";
      list.appendChild(li);
    }
  }

  function toggleBox(boxIndex) {
    const item = images[index];
    const mark = markOf(item.path);
    if (mark.boxes.includes(boxIndex)) mark.boxes = mark.boxes.filter((value) => value !== boxIndex);
    else mark.boxes.push(boxIndex);
    mark.status = mark.boxes.length ? "bad" : mark.status;
    saveMarks();
    draw(item, mark);
    drawList(item, mark);
    drawWrong();
  }

  function setStatus(status) {
    if (!images.length) return;
    const item = images[index];
    const mark = markOf(item.path);
    mark.status = status;
    mark.note = $("note").value.trim();
    if (status === "ok") mark.boxes = [];
    saveMarks();
    show(index + 1);
  }

  function exportReview() {
    const wrong = images
      .filter((item) => marks[item.path]?.status === "bad")
      .map((item) => {
        const mark = marks[item.path];
        return {
          image: item.path,
          note: mark.note || "",
          boxes: mark.boxes.map((boxIndex) => ({
            index: boxIndex,
            label: item.boxes[boxIndex]?.label || "",
          })),
        };
      });
    const blob = new Blob([JSON.stringify({ wrong }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "revisao-anotacoes.json";
    link.click();
  }

  $("pick").addEventListener("change", () => {
    if ($("pick").files?.length) loadFiles($("pick").files);
  });
  $("btn-open").addEventListener("click", () => $("pick").click());
  $("btn-prev").addEventListener("click", () => images.length && show(index - 1));
  $("btn-next").addEventListener("click", () => images.length && show(index + 1));
  $("btn-ok").addEventListener("click", () => setStatus("ok"));
  $("btn-bad").addEventListener("click", () => setStatus("bad"));
  $("btn-export").addEventListener("click", exportReview);
  $("btn-prompt").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("prompt").value.trim());
    $("btn-prompt").textContent = "Prompt copiado";
  });
  $("note").addEventListener("change", () => {
    if (!images.length) return;
    markOf(images[index].path).note = $("note").value.trim();
    saveMarks();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.target.matches("textarea, input")) return;
    if (ev.key === "ArrowRight") show(index + 1);
    if (ev.key === "ArrowLeft") show(index - 1);
    if (ev.key === "c" || ev.key === "C") setStatus("ok");
    if (ev.key === "e" || ev.key === "E") setStatus("bad");
  });
  document.addEventListener("dragover", (ev) => ev.preventDefault());
  document.addEventListener("drop", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer?.files?.length) loadFiles(ev.dataTransfer.files);
  });
})();
