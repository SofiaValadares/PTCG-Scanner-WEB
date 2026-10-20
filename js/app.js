(() => {
  const $ = (id) => document.getElementById(id);

  let connection = null;
  let camStream = null;

  const ui = {
    statusText: $("status-text"),
    statusDot: $("status-dot"),
    banner: $("banner"),
    bannerText: $("banner-text"),
    busy: $("busy"),
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

  function showBanner(text) {
    ui.bannerText.textContent = text;
    ui.banner.classList.add("show");
  }

  function hideBanner() {
    ui.banner.classList.remove("show");
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
      connection = await PTCG.connect();
      if (connection.mode === "tunnel") {
        setStatus("ok", "Túnel");
        hideBanner();
      } else {
        setStatus("warn", "Local");
        showBanner(
          connection.warning
            ? `Não conectou no túnel (${connection.warning}). Usando a API neste PC: ${connection.base}`
            : `Túnel indisponível. Usando a API local: ${connection.base}`
        );
      }
    } catch (err) {
      connection = null;
      setStatus("bad", "Sem API");
      showBanner(
        `${err.message}. Cole o HTTPS do cloudflared ou confirme que a API local está em http://127.0.0.1:8000`
      );
    }
  }

  async function sendFiles(files) {
    if (!files || !files.length) return;
    if (!connection) {
      showBanner("Sem API. Configure o túnel ou suba a API local e toque em Salvar e testar.");
      openModal(ui.modalSettings);
      fillSettings();
      return;
    }
    ui.busy.classList.add("show");
    ui.empty.style.display = "none";
    try {
      const prepared = [];
      for (const file of files) {
        prepared.push(await PTCG.fileToJpeg(file));
      }
      const data = await PTCG.scan(connection.base, prepared, { includeCrops: true });
      render(data);
    } catch (err) {
      ui.empty.style.display = "block";
      ui.empty.textContent = `Erro: ${err.message}`;
    } finally {
      ui.busy.classList.remove("show");
    }
  }

  function render(data) {
    ui.results.innerHTML = "";
    if (!data.images || !data.images.length) {
      ui.empty.style.display = "block";
      ui.empty.textContent = "A API não devolveu imagens.";
      return;
    }
    ui.empty.style.display = "none";
    data.images.forEach((image) => {
      const block = document.createElement("article");
      block.className = "image-block";
      const title = document.createElement("h3");
      title.textContent = image.error
        ? `${image.filename} — ${image.error}`
        : `${image.filename} · ${image.card_count} carta(s) · ${data.elapsed_ms} ms`;
      block.appendChild(title);
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
  }

  function cardView(card) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "poke";
    el.setAttribute("aria-label", "Ver regiões de interesse e OCR desta carta");
    const match = card.match;
    const ocr = card.ocr || {};
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
    const name = match?.name || ocr.name || "Sem match";
    const number = match?.number || ocr.number || "—";
    const setName = match ? `${match.set_id} · ${match.set_name}` : ocr.collection || "";
    meta.innerHTML = `<strong>${escapeHtml(name)}</strong><small>${escapeHtml(number)}<br>${escapeHtml(setName)}</small><span class="hint">Toque para ver ROI e OCR</span>`;
    el.appendChild(meta);
    el.addEventListener("click", () => openInspect(card));

    if (match) {
      TCGDEX.findOfficial(match)
        .then((hit) => {
          const img = officialFig.querySelector("img");
          const cap = officialFig.querySelector("figcaption");
          if (hit?.image) {
            img.src = hit.image;
            img.alt = hit.name || "oficial";
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
      officialFig.querySelector("figcaption").textContent = "Sem match";
      officialFig.classList.add("missing");
    }
    return el;
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
    if (id === "name") return match.name || "";
    if (id === "number") return match.number || "";
    return match.set_id || match.set_name || "";
  }

  function openInspect(card) {
    const match = card.match;
    const ocr = card.ocr || {};
    const roi = card.roi || {};
    ui.inspectTitle.textContent = match?.name || ocr.name || `Carta ${card.index + 1}`;
    const bits = [
      match ? `${match.number} · ${match.set_id}` : ocr.number || "",
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

    const matches = (card.matches || []).map((item, i) => {
      const cls = i === 0 ? "best" : "";
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
    if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        ui.video.srcObject = camStream;
        openModal(ui.modalCamera);
        return;
      } catch {
        /* cai no input da câmera */
      }
    }
    ui.inputCamera.click();
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
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d").drawImage(video, 0, 0);
    stopCam();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    await sendFiles([new File([blob], "camera.jpg", { type: "image/jpeg" })]);
  }

  async function useDemo(src) {
    const res = await fetch(src);
    const blob = await res.blob();
    const name = src.split("/").pop() || "demo.jpg";
    await sendFiles([new File([blob], name, { type: blob.type || "image/jpeg" })]);
  }

  $("btn-camera").addEventListener("click", takePhoto);
  $("dock-camera").addEventListener("click", takePhoto);
  $("btn-upload").addEventListener("click", () => ui.inputUpload.click());
  $("dock-upload").addEventListener("click", () => ui.inputUpload.click());
  $("dock-demo").addEventListener("click", () => {
    document.getElementById("demos").scrollIntoView({ behavior: "smooth" });
  });

  $("btn-settings").addEventListener("click", () => {
    fillSettings();
    openModal(ui.modalSettings);
  });
  $("btn-settings-banner").addEventListener("click", () => {
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

  document.querySelectorAll("[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => useDemo(btn.dataset.demo));
  });

  ui.modalSettings.addEventListener("click", (ev) => {
    if (ev.target === ui.modalSettings) closeModal(ui.modalSettings);
  });
  ui.modalCamera.addEventListener("click", (ev) => {
    if (ev.target === ui.modalCamera) stopCam();
  });
  ui.modalCard.addEventListener("click", (ev) => {
    if (ev.target === ui.modalCard) closeModal(ui.modalCard);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (ui.modalCard.classList.contains("show")) closeModal(ui.modalCard);
  });

  boot();
})();
