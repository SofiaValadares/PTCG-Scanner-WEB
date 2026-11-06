(() => {
  const $ = (id) => document.getElementById(id);

  let connection = null;
  let camStream = null;
  const folderByName = new Map();
  let folderItems = [];

  const ui = {
    statusText: $("status-text"),
    statusDot: $("status-dot"),
    banner: $("banner"),
    bannerText: $("banner-text"),
    busy: $("busy"),
    busyText: $("busy-text"),
    empty: $("empty"),
    results: $("results"),
    modalSettings: $("modal-settings"),
    modalCamera: $("modal-camera"),
    fieldTunnel: $("field-tunnel"),
    fieldLocal: $("field-local"),
    fieldKey: $("field-key"),
    video: $("cam-video"),
    inputCamera: $("input-camera"),
    inputUpload: $("input-upload"),
    modalCard: $("modal-card"),
    inspectTitle: $("inspect-title"),
    inspectSub: $("inspect-sub"),
    inspectImg: $("inspect-img"),
    inspectSvg: $("inspect-svg"),
    inspectLabels: $("inspect-labels"),
    inspectLegend: $("inspect-legend"),
    inspectOcr: $("inspect-ocr"),
  };

  const ROI_FIELDS = [
    { id: "name", label: "Nome", color: "#3ee0b0" },
    { id: "number", label: "Número", color: "#f0c14b" },
    { id: "collection", label: "Coleção", color: "#7aa2ff" },
  ];

  function setStatus(kind, text) {
    ui.statusDot.className = `dot ${kind}`;
    ui.statusText.textContent = text;
  }

  let toastTimer = 0;

  function setSettingsNotice(text) {
    const box = $("settings-notice");
    const value = String(text || "").trim();
    box.hidden = !value;
    box.textContent = value;
  }

  function hideBanner() {
    clearTimeout(toastTimer);
    ui.banner.classList.remove("show");
  }

  function showBanner(text) {
    ui.bannerText.textContent = text;
    ui.banner.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.banner.classList.remove("show"), 2200);
  }

  function openModal(el) {
    el.hidden = false;
    el.classList.add("show");
  }

  function closeModal(el) {
    el.classList.remove("show");
    el.hidden = true;
  }

  function fillSettings() {
    const c = PTCG.cfg();
    ui.fieldTunnel.value = c.tunnelUrl;
    ui.fieldLocal.value = c.localUrl;
    ui.fieldKey.value = c.apiKey;
  }

  async function boot() {
    setStatus("", "Conectando…");
    hideBanner();
    try {
      const health = await PTCG.probe("", 8000);
      connection = { mode: "same", base: "", health };
      setStatus("ok", "Pronto");
      hideBanner();
      setSettingsNotice("");
      return;
    } catch {
      /* página aberta sem o modelo; tenta o endereço salvo */
    }
    const prefs = PTCG.cfg();
    let tunnelSettled = false;
    let flashed = false;
    const announce = (text) => {
      setSettingsNotice(text);
      if (flashed) return;
      flashed = true;
      showBanner(text);
    };
    const tunnelTry = prefs.tunnelUrl
      ? PTCG.probe(prefs.tunnelUrl, Math.min(prefs.healthTimeoutMs, 2500))
          .then((health) => ({ mode: "tunnel", base: prefs.tunnelUrl, health }))
          .catch((err) => {
            throw new Error(err.name === "AbortError" ? "tempo esgotado" : err.message);
          })
      : Promise.reject(new Error("URL ainda não configurado"));
    const localTry = PTCG.probe(prefs.localUrl, 900)
      .then((health) => ({ mode: "local", base: prefs.localUrl, health }))
      .catch((err) => {
        throw new Error(err.name === "AbortError" ? "tempo esgotado" : err.message);
      });

    const quick = setTimeout(() => {
      if (tunnelSettled || !connection || connection.mode !== "local") return;
      const text = prefs.tunnelUrl
        ? `Túnel ainda não respondeu. Usando a API neste PC: ${connection.base}`
        : `Túnel não configurado. Usando a API neste PC: ${connection.base}`;
      announce(text);
    }, 280);

    localTry.then((conn) => {
      if (tunnelSettled) return;
      connection = conn;
      setStatus("warn", "Local");
    }).catch(() => {});

    try {
      const conn = await tunnelTry;
      tunnelSettled = true;
      clearTimeout(quick);
      connection = conn;
      setStatus("ok", "Túnel");
      hideBanner();
      setSettingsNotice("");
    } catch (tunnelErr) {
      tunnelSettled = true;
      clearTimeout(quick);
      if (connection && connection.mode === "local") {
        announce(`Não conectou no túnel (${tunnelErr.message}). Usando a API neste PC: ${connection.base}`);
        return;
      }
      try {
        const health = await PTCG.probe(prefs.localUrl, prefs.healthTimeoutMs);
        connection = { mode: "local", base: prefs.localUrl, health };
        setStatus("warn", "Local");
        announce(`Não conectou no túnel (${tunnelErr.message}). Usando a API neste PC: ${prefs.localUrl}`);
      } catch (localErr) {
        connection = null;
        setStatus("bad", "Sem modelo");
        const localMsg = localErr.name === "AbortError" ? "tempo esgotado" : localErr.message;
        announce(`Modelo fora do ar. Túnel: ${tunnelErr.message}. Local: ${localMsg}.`);
      }
    }
  }

  function showPage(name) {
    $("page-home").hidden = name !== "home";
    $("page-result").hidden = name !== "result";
    window.scrollTo(0, 0);
  }

  async function sendFiles(files) {
    if (!files || !files.length) return;
    if (!connection) {
      const text = "Modelo fora do ar. Abra o site pelo script local.";
      setSettingsNotice(text);
      showBanner(text);
      openModal(ui.modalSettings);
      fillSettings();
      return;
    }
    showPage("result");
    ui.results.innerHTML = "";
    ui.busy.classList.add("show");
    ui.empty.style.display = "none";
    try {
      const data = await PTCG.scan(connection.base, files, { includeCrops: true });
      render(data);
    } catch (err) {
      ui.empty.style.display = "block";
      ui.empty.textContent = `Erro: ${err.message}`;
    } finally {
      ui.busy.classList.remove("show");
    }
  }

  function render(data, { append = false } = {}) {
    if (!append) ui.results.innerHTML = "";
    const reports = [];
    if (!data.images || !data.images.length) {
      if (!append) {
        ui.empty.style.display = "block";
        ui.empty.textContent = "A API não devolveu imagens.";
      }
      return reports;
    }
    ui.empty.style.display = "none";
    data.images.forEach((image) => {
      const block = document.createElement("article");
      block.className = "image-block";
      const known = folderByName.get(image.filename);
      const report = known?.truth?.length && !image.error ? gradeImage(image, known.truth) : null;
      const title = document.createElement("h3");
      title.textContent = image.error
        ? `${image.filename} — ${image.error}`
        : `${image.filename} · ${image.card_count} carta(s) · ${data.elapsed_ms} ms`;
      block.appendChild(title);
      if (known?.source) {
        const origin = document.createElement("p");
        origin.className = "origin";
        origin.textContent = known.source;
        block.appendChild(origin);
      }
      if (known?.truth?.length) {
        const cardsLine = document.createElement("p");
        cardsLine.className = "origin";
        cardsLine.textContent = known.truth.map((truth) => truth.label).filter(Boolean).join(" · ");
        block.appendChild(cardsLine);
      }
      if (report) {
        reports.push(report);
        const score = document.createElement("p");
        const perfect = report.hits === report.total;
        score.className = `scoreline ${perfect ? "ok" : "bad"}`;
        score.textContent = perfect
          ? `Acertou todas · ${report.hits} de ${report.total}`
          : `Acertou ${report.hits} de ${report.total}`;
        block.appendChild(score);
        if (report.missed.length) {
          const missed = document.createElement("p");
          missed.className = "missed";
          missed.textContent = `Não encontrou: ${report.missed.join(", ")}`;
          block.appendChild(missed);
        }
      }
      const grid = document.createElement("div");
      grid.className = "cards";
      (image.cards || []).forEach((card) => {
        grid.appendChild(cardView(card));
      });
      if (!(image.cards || []).length && !image.error) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "Nenhuma carta detectada.";
        block.appendChild(p);
      }
      block.appendChild(grid);
      ui.results.appendChild(block);
    });
    return reports;
  }

  function cardView(card) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "poke";
    el.setAttribute("aria-label", "Ver regiões de interesse e OCR desta carta");
    const match = card.match;
    const ocr = card.ocr || {};
    const ambiguous = !match && (card.matches || []).length > 0;
    const compare = document.createElement("div");
    compare.className = "compare";
    compare.appendChild(
      figure(
        card.crop_jpeg_base64 ? `data:image/jpeg;base64,${card.crop_jpeg_base64}` : "",
        match?.name || ocr.name || "recorte",
        "Recorte"
      )
    );
    const officialFig = figure("", "TCGdex", "TCGdex");
    officialFig.classList.add("official");
    compare.appendChild(officialFig);
    el.appendChild(compare);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = match?.name || (ambiguous ? "Scores parecidos" : ocr.name || "Sem match");
    const number = match?.number || ocr.number || "—";
    const setName = match
      ? `${match.set_id} · ${match.set_name}`
      : ambiguous
        ? "sem escolha automática"
        : ocr.collection || "";
    meta.innerHTML = `<strong>${escapeHtml(name)}</strong><small>${escapeHtml(number)}<br>${escapeHtml(setName)}</small><span class="hint">Toque para ver ROI e OCR</span>`;
    if (card.grade) {
      el.classList.add(card.grade.ok ? "is-hit" : "is-miss");
      const badge = document.createElement("span");
      badge.className = `grade ${card.grade.ok ? "ok" : "bad"}`;
      badge.textContent = card.grade.ok
        ? "Acertou"
        : card.grade.expected
          ? `Errou · certo ${card.grade.expected}`
          : "Errou · carta a mais";
      meta.appendChild(badge);
      if (card.grade.label) {
        const dataset = document.createElement("span");
        dataset.className = "origin";
        dataset.textContent = card.grade.label;
        meta.appendChild(dataset);
      }
    }
    el.appendChild(meta);
    el.addEventListener("click", () => openInspect(card));

    if (match) {
      TCGDEX.findOfficial(match)
        .then((hit) => {
          const img = officialFig.querySelector("img");
          const cap = officialFig.querySelector("figcaption");
          if (hit?.image) {
            img.alt = hit.name || "oficial";
            img.onerror = () => {
              const english = img.src.replace("/pt/", "/en/").replace("/fr/", "/en/");
              if (!img.dataset.fallback && english !== img.src) {
                img.dataset.fallback = "1";
                img.src = english;
                return;
              }
              cap.textContent = "Sem arte TCGdex";
              officialFig.classList.add("missing");
            };
            img.src = hit.image;
            cap.innerHTML = `TCGdex`;
          } else {
            cap.textContent = "Sem arte TCGdex";
            officialFig.classList.add("missing");
          }
        })
        .catch(() => {
          officialFig.querySelector("figcaption").textContent = "TCGdex indisponível";
          officialFig.classList.add("missing");
        });
    } else {
      const hasNumber = /\d/.test(String(ocr.number || ""));
      officialFig.querySelector("figcaption").textContent = ambiguous
        ? "Scores parecidos"
        : hasNumber
          ? "Sem match"
          : "Sem número";
      officialFig.classList.add("missing");
    }
    return el;
  }

  function gradeNumberKey(text) {
    const raw = String(text || "").toUpperCase().replace(/\s+/g, "");
    const match = raw.match(/^([A-Z]*)0*(\d+)[/\-]0*(\d+)/);
    if (!match) return raw;
    return `${match[1]}${parseInt(match[2], 10)}/${parseInt(match[3], 10)}`;
  }

  function gradeSetKey(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function foldName(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function nameTokens(text) {
    const stop = new Set(["de", "da", "do", "dos", "das", "e", "o", "a", "os", "as", "the", "of", "and"]);
    return new Set(foldName(text).split(" ").filter((word) => word.length > 1 && !stop.has(word)));
  }

  function namesEquivalent(leftText, rightText) {
    const left = foldName(leftText);
    const right = foldName(rightText);
    if (!left || !right) return false;
    if (left === right || left.includes(right) || right.includes(left)) return true;
    const leftTokens = nameTokens(leftText);
    const rightTokens = nameTokens(rightText);
    if (!leftTokens.size || !rightTokens.size) return false;
    const shared = [...leftTokens].filter((token) => rightTokens.has(token));
    if (!shared.length) return false;
    const leftInside = [...leftTokens].every((token) => rightTokens.has(token));
    const rightInside = [...rightTokens].every((token) => leftTokens.has(token));
    if (leftInside || rightInside) return true;
    const union = new Set([...leftTokens, ...rightTokens]);
    const jaccard = shared.length / union.size;
    return (jaccard >= 0.5 && shared.some((token) => token.length >= 4)) || jaccard >= 0.66;
  }

  function printedParts(text) {
    const raw = String(text || "");
    const pair = raw.match(/([A-Za-z]*)\s*0*(\d+)\s*[/\-]\s*0*(\d+)/);
    if (pair) return [Number(pair[2]), Number(pair[3])];
    const only = raw.match(/(\d+)/);
    return only ? [Number(only[1]), null] : [null, null];
  }

  function numbersEqual(leftText, rightText) {
    const [leftCollector, leftTotal] = printedParts(leftText);
    const [rightCollector, rightTotal] = printedParts(rightText);
    if (leftCollector == null || rightCollector == null) return false;
    if (leftTotal != null && rightTotal != null) return leftCollector === rightCollector && leftTotal === rightTotal;
    return leftCollector === rightCollector;
  }

  function pairOk(card, truth) {
    const match = card.match;
    if (!match) return false;
    const number = gradeNumberKey(match.number);
    const expected = gradeNumberKey(truth.number);
    const setId = gradeSetKey(match.set_id);
    const expectedSet = gradeSetKey(truth.set);
    return Boolean(number && expected && setId && expectedSet) && number === expected && setId === expectedSet;
  }

  function boxOf(quad) {
    const xs = quad.map((pt) => Number(pt[0]) || 0);
    const ys = quad.map((pt) => Number(pt[1]) || 0);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  function boxIou(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return area > 0 ? inter / area : 0;
  }

  function gradeImage(image, truths) {
    const width = image.width || 1;
    const height = image.height || 1;
    const cards = image.cards || [];
    const used = new Set();
    cards.forEach((card) => {
      const quad = (card.quad || []).map(([x, y]) => [x / width, y / height]);
      let best = -1;
      let bestIou = 0.12;
      if (quad.length >= 4) {
        const box = boxOf(quad);
        truths.forEach((truth, index) => {
          if (used.has(index) || !Array.isArray(truth.quad)) return;
          const score = boxIou(box, boxOf(truth.quad));
          if (score > bestIou) {
            bestIou = score;
            best = index;
          }
        });
      }
      if (best < 0) {
        card.grade = { ok: false, expected: "" };
        return;
      }
      used.add(best);
      const truth = truths[best];
      const expectedName = truth.name ? `${truth.name} · ` : "";
      card.grade = {
        ok: pairOk(card, truth),
        expected: `${expectedName}${truth.number} · ${truth.set}`,
        label: truth.label || "",
      };
    });
    return {
      hits: cards.filter((card) => card.grade?.ok).length,
      total: truths.length,
      missed: truths
        .filter((_, index) => !used.has(index))
        .map((truth) => truth.label || `${truth.number} · ${truth.set}`),
    };
  }

  function figure(src, alt, caption) {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.alt = alt;
    if (src) img.src = src;
    else img.removeAttribute("src");
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    fig.appendChild(img);
    fig.appendChild(cap);
    return fig;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function foldKey(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function numberKey(text) {
    const match = String(text || "").match(/(\d+)\s*[/\-]\s*(\d+)/);
    if (match) return `${parseInt(match[1], 10)}/${parseInt(match[2], 10)}`;
    return foldKey(text);
  }

  function fieldKey(id, text) {
    return id === "number" ? numberKey(text) : foldKey(text);
  }

  function displayOrDash(text) {
    const value = String(text || "").trim();
    return value ? escapeHtml(value) : '<span class="empty-cell">—</span>';
  }

  function sourceLabel(source) {
    if (source === "template") return "template (caixa fixa)";
    if (source === "det") return "detector";
    return source || "—";
  }

  function catalogValue(id, match) {
    if (!match) return "";
    if (id === "name") {
      const en = String(match.name_en || "").trim();
      const pt = String(match.name_pt || "").trim();
      if (en && pt && foldKey(en) !== foldKey(pt)) return `${en} · ${pt}`;
      return match.name || en || pt || "";
    }
    if (id === "number") return match.number || "";
    return match.set_id || match.set_name || "";
  }

  function openInspect(card) {
    const match = card.match;
    const ocr = card.ocr || {};
    const roi = card.roi || {};
    const ambiguous = !match && (card.matches || []).length > 0;
    ui.inspectTitle.textContent = match?.name || (ambiguous ? "Scores parecidos" : ocr.name || `Carta ${card.index + 1}`);
    const bits = [
      match ? `${match.number} · ${match.set_id}` : ambiguous ? "sem escolha automática" : ocr.number || "",
      `det ${card.det_conf ?? "—"}`,
      `orientação ${card.orient_deg ?? 0}°`,
    ].filter(Boolean);
    ui.inspectSub.textContent = bits.join(" · ");

    if (card.crop_jpeg_base64) {
      ui.inspectImg.src = `data:image/jpeg;base64,${card.crop_jpeg_base64}`;
      ui.inspectImg.alt = match?.name || ocr.name || "recorte";
    } else {
      ui.inspectImg.removeAttribute("src");
      ui.inspectImg.alt = "sem recorte";
    }

    drawRoiOverlay(roi);
    ui.inspectLegend.innerHTML = ROI_FIELDS.map(
      (field) =>
        `<li><i style="background:${field.color}"></i>${escapeHtml(field.label)}</li>`
    ).join("");
    ui.inspectOcr.innerHTML = inspectOcrHtml(card);
    openModal(ui.modalCard);
  }

  function drawRoiOverlay(roi) {
    const svg = ui.inspectSvg;
    const labels = ui.inspectLabels;
    svg.innerHTML = "";
    labels.innerHTML = "";
    ROI_FIELDS.forEach((field) => {
      const region = roi[field.id];
      const quad = region?.quad;
      if (!Array.isArray(quad) || quad.length < 4) return;
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      poly.setAttribute("points", quad.map(([x, y]) => `${x},${y}`).join(" "));
      poly.setAttribute("fill", hexAlpha(field.color, 0.18));
      poly.setAttribute("stroke", field.color);
      poly.setAttribute("stroke-width", "0.012");
      if (region.source === "template") {
        poly.setAttribute("stroke-dasharray", "0.03 0.02");
      }
      svg.appendChild(poly);
      const [cx, cy] = centroid(quad);
      const tag = document.createElement("span");
      tag.className = "roi-tag";
      tag.style.left = `${cx * 100}%`;
      tag.style.top = `${cy * 100}%`;
      tag.style.background = field.color;
      tag.textContent = field.label;
      labels.appendChild(tag);
    });
  }

  function centroid(quad) {
    const n = quad.length || 1;
    return [
      quad.reduce((sum, pt) => sum + Number(pt[0] || 0), 0) / n,
      quad.reduce((sum, pt) => sum + Number(pt[1] || 0), 0) / n,
    ];
  }

  function hexAlpha(hex, alpha) {
    const raw = hex.replace("#", "");
    const n = parseInt(raw, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function inspectOcrHtml(card) {
    const roi = card.roi || {};
    const ocr = card.ocr || {};
    const match = card.match;
    const rows = ROI_FIELDS.map((field) => {
      const region = roi[field.id] || {};
      const cleaned = region.text || ocr[field.id] || "";
      const raw = region.raw || "";
      const catalog = catalogValue(field.id, match);
      const skipped = field.id === "collection" && region.source === "template" && !cleaned;
      const miss =
        !skipped &&
        Boolean(cleaned && catalog) &&
        fieldKey(field.id, cleaned) !== fieldKey(field.id, catalog);
      const note = skipped
        ? "não lido (ROI de template)"
        : sourceLabel(region.source);
      return `<tr class="${miss ? "miss" : ""}">
        <th>${escapeHtml(field.label)}</th>
        <td>${escapeHtml(note)}<br><small>ROI ${fmtConf(region.conf)} · OCR ${fmtConf(region.ocr_conf)}</small></td>
        <td><code>${displayOrDash(raw)}</code></td>
        <td><code>${displayOrDash(cleaned)}</code></td>
        <td><code>${displayOrDash(catalog)}</code></td>
      </tr>`;
    }).join("");

    const ambiguous = !match && (card.matches || []).length > 0;
    const matches = (card.matches || []).map((item, i) => {
      const cls = !ambiguous && i === 0 && match ? "best" : "";
      return `<li class="${cls}"><strong>${escapeHtml(item.name)}</strong> · ${escapeHtml(item.number)} · ${escapeHtml(item.set_id)} · score ${item.score}</li>`;
    }).join("");

    return `
      <h3>O que o OCR leu × catálogo</h3>
      <table class="ocr-table">
        <thead>
          <tr>
            <th>Campo</th>
            <th>ROI</th>
            <th>Cru</th>
            <th>Limpo</th>
            <th>Catálogo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <h3>Candidatos do catálogo</h3>
      ${ambiguous ? `<p class="empty-cell">Os dois primeiros scores ficaram perto. Nenhuma carta foi escolhida.</p>` : ""}
      ${matches ? `<ul class="match-list">${matches}</ul>` : `<p class="empty-cell">Nenhum match.</p>`}
      <p class="empty-cell" style="margin-top:0.7rem">Linha vermelha: OCR limpo diferente do match. Coleção no catálogo é o setId (PkmnCards), não necessariamente o código impresso.</p>
    `;
  }

  function fmtConf(value) {
    if (value === undefined || value === null || value === "") return "—";
    const n = Number(value);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(2);
  }

  async function takePhoto() {
    const secure = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
    if (!secure) {
      ui.inputCamera.click();
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      ui.video.srcObject = camStream;
      await ui.video.play();
      openModal(ui.modalCamera);
    } catch {
      showBanner("A câmera não abriu. Escolha a foto na galeria.");
      ui.inputCamera.click();
    }
  }

  function stopCam() {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    ui.video.srcObject = null;
    closeModal(ui.modalCamera);
  }

  async function captureFrame() {
    const video = ui.video;
    if (!video.videoWidth) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        video.addEventListener(
          "loadeddata",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      showBanner("A câmera ainda não entregou imagem. Tente de novo.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCam();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await sendFiles([new File([blob], "camera.png", { type: "image/png" })]);
  }

  async function useDemo(src) {
    const res = await fetch(src);
    const blob = await res.blob();
    const name = src.split("/").pop() || "demo.jpg";
    await sendFiles([new File([blob], name, { type: blob.type || "image/jpeg" })]);
  }

  function openFolder() {
    openModal($("modal-folder"));
  }

  async function testAll() {
    if (!folderItems.length) return;
    if (!connection) {
      const text = "Modelo fora do ar. Abra o site pelo script local.";
      setSettingsNotice(text);
      showBanner(text);
      openModal(ui.modalSettings);
      fillSettings();
      return;
    }
    const button = $("btn-test-all");
    button.disabled = true;
    closeModal($("modal-folder"));
    showPage("result");
    ui.results.innerHTML = "";
    ui.empty.style.display = "none";
    const summary = document.createElement("p");
    summary.className = "scoreline";
    summary.textContent = `Preparando ${folderItems.length} fotos…`;
    ui.results.appendChild(summary);
    ui.busy.classList.add("show");
    let hits = 0;
    let total = 0;
    let perfect = 0;
    try {
      for (let index = 0; index < folderItems.length; index += 1) {
        const item = folderItems[index];
        ui.busyText.textContent = `Lendo ${index + 1} de ${folderItems.length}…`;
        const name = String(item.src || "").split("/").pop() || "foto.jpg";
        try {
          const res = await fetch(item.src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], name, { type: blob.type || "image/jpeg" });
          const data = await PTCG.scan(connection.base, [file], { includeCrops: true });
          const reports = render(data, { append: true });
          reports.forEach((report) => {
            hits += report.hits;
            total += report.total;
            if (report.hits === report.total) perfect += 1;
          });
        } catch (err) {
          const fail = document.createElement("article");
          fail.className = "image-block";
          const title = document.createElement("h3");
          title.textContent = `${name} — ${err.message}`;
          fail.appendChild(title);
          ui.results.appendChild(fail);
        }
        summary.textContent = total
          ? `Acertou ${hits} de ${total} cartas · ${perfect} fotos certas`
          : `Lidas ${index + 1} de ${folderItems.length}`;
        summary.className = `scoreline ${total && hits === total ? "ok" : "bad"}`;
      }
    } finally {
      button.disabled = false;
      ui.busy.classList.remove("show");
      ui.busyText.textContent = "Lendo cartas… pode levar alguns segundos.";
    }
  }

  async function loadFolder() {
    const grid = $("folder-grid");
    try {
      const res = await fetch("assets/demo/folder/manifest.json?v=15");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = await res.json();
      folderItems = items;
      grid.innerHTML = "";
      folderByName.clear();
      items.forEach((item) => {
        folderByName.set(String(item.src || "").split("/").pop(), item);
        const btn = document.createElement("button");
        btn.type = "button";
        const origin = item.source ? `<span>${escapeHtml(item.source)}</span>` : "";
        btn.innerHTML = `<img src="${item.src}" alt="" />${origin}`;
        btn.addEventListener("click", async () => {
          closeModal($("modal-folder"));
          await useDemo(item.src);
        });
        grid.appendChild(btn);
      });
    } catch (err) {
      grid.textContent = "Não foi possível carregar a pasta.";
    }
  }

  $("btn-camera").addEventListener("click", takePhoto);
  $("dock-camera").addEventListener("click", takePhoto);
  $("btn-upload").addEventListener("click", () => ui.inputUpload.click());
  $("dock-upload").addEventListener("click", () => ui.inputUpload.click());
  $("btn-test-all").addEventListener("click", testAll);
  $("btn-folder").addEventListener("click", openFolder);
  $("dock-folder").addEventListener("click", openFolder);
  $("btn-close-folder").addEventListener("click", () => closeModal($("modal-folder")));

  $("btn-settings").addEventListener("click", () => {
    fillSettings();
    openModal(ui.modalSettings);
  });
  $("btn-close-settings").addEventListener("click", () => closeModal(ui.modalSettings));
  $("btn-save-settings").addEventListener("click", async () => {
    PTCG.savePrefs({
      tunnelUrl: ui.fieldTunnel.value.trim(),
      localUrl: ui.fieldLocal.value.trim() || "http://127.0.0.1:8000",
      apiKey: ui.fieldKey.value.trim(),
    });
    closeModal(ui.modalSettings);
    await boot();
  });

  $("btn-close-cam").addEventListener("click", stopCam);
  $("btn-shot").addEventListener("click", captureFrame);
  $("btn-close-card").addEventListener("click", () => closeModal(ui.modalCard));

  ui.inputCamera.addEventListener("change", () => {
    sendFiles(ui.inputCamera.files);
    ui.inputCamera.value = "";
  });
  ui.inputUpload.addEventListener("change", () => {
    sendFiles(ui.inputUpload.files);
    ui.inputUpload.value = "";
  });

  $("btn-back").addEventListener("click", () => showPage("home"));

  ui.modalSettings.addEventListener("click", (ev) => {
    if (ev.target === ui.modalSettings) closeModal(ui.modalSettings);
  });
  ui.modalCamera.addEventListener("click", (ev) => {
    if (ev.target === ui.modalCamera) stopCam();
  });
  $("modal-folder").addEventListener("click", (ev) => {
    if (ev.target === $("modal-folder")) closeModal($("modal-folder"));
  });
  ui.modalCard.addEventListener("click", (ev) => {
    if (ev.target === ui.modalCard) closeModal(ui.modalCard);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (ui.modalCard.classList.contains("show")) closeModal(ui.modalCard);
    if ($("modal-folder").classList.contains("show")) closeModal($("modal-folder"));
  });

  loadFolder();
  boot();
})();
