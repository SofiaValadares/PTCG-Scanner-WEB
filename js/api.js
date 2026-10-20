(function (global) {
  const STORE = "ptcg-scanner-web";

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}");
    } catch {
      return {};
    }
  }

  function savePrefs(partial) {
    const next = { ...loadPrefs(), ...partial };
    localStorage.setItem(STORE, JSON.stringify(next));
    return next;
  }

  function cfg() {
    const base = global.PTCG_CONFIG || {};
    const prefs = loadPrefs();
    return {
      tunnelUrl: trimSlash(prefs.tunnelUrl ?? base.tunnelUrl ?? ""),
      localUrl: trimSlash(prefs.localUrl ?? base.localUrl ?? "http://127.0.0.1:8000"),
      apiKey: (prefs.apiKey ?? base.apiKey ?? "").trim(),
      healthTimeoutMs: base.healthTimeoutMs || 4500,
    };
  }

  function trimSlash(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function headers() {
    const { apiKey } = cfg();
    const h = {};
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
  }

  async function probe(base, timeoutMs) {
    if (!base) throw new Error("URL vazio");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/health`, {
        method: "GET",
        headers: headers(),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!body || body.ok === false) throw new Error("API não saudável");
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function connect() {
    const c = cfg();
    const errors = [];
    if (c.tunnelUrl) {
      try {
        const health = await probe(c.tunnelUrl, c.healthTimeoutMs);
        return { mode: "tunnel", base: c.tunnelUrl, health };
      } catch (err) {
        errors.push(`túnel: ${err.name === "AbortError" ? "tempo esgotado" : err.message}`);
      }
    } else {
      errors.push("túnel: URL ainda não configurado");
    }
    try {
      const health = await probe(c.localUrl, c.healthTimeoutMs);
      return {
        mode: "local",
        base: c.localUrl,
        health,
        warning: errors.join(" · "),
      };
    } catch (err) {
      errors.push(`local: ${err.name === "AbortError" ? "tempo esgotado" : err.message}`);
      const error = new Error(errors.join(" · "));
      error.details = errors;
      throw error;
    }
  }

  async function fileToJpeg(file, maxSide = 1600, quality = 0.82) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    const name = (file.name || "foto.jpg").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  }

  async function scan(base, files, { includeCrops = true } = {}) {
    const fd = new FormData();
    const list = Array.from(files);
    if (list.length === 1) {
      fd.append("image", list[0], list[0].name);
    } else {
      list.forEach((file) => fd.append("images", file, file.name));
    }
    const qs = includeCrops ? "?include_crops=true" : "";
    const res = await fetch(`${base}/v1/scan${qs}`, {
      method: "POST",
      headers: headers(),
      body: fd,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err.detail || detail;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return res.json();
  }

  global.PTCG = { cfg, savePrefs, loadPrefs, connect, probe, scan, fileToJpeg, trimSlash };
})(window);
