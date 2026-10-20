(function (global) {
  const API = "https://api.tcgdex.net/v2";
  const LANGS = new Set(["en", "fr", "es", "it", "pt", "de", "ja"]);
  const cache = new Map();
  let setsPromise = null;

  function langOf(match) {
    const raw = String(match?.lang || "en").toLowerCase();
    if (raw.startsWith("pt")) return "pt";
    if (raw.startsWith("zh")) return "en";
    return LANGS.has(raw) ? raw : "en";
  }

  function collectorOf(number) {
    const text = String(number || "");
    const slash = text.match(/(\d+)\s*[/\-]\s*(\d+)/);
    if (slash) return slash[1];
    const promo = text.match(/([A-Za-z]{1,6}\d+[A-Za-z0-9]*)/);
    if (promo) return promo[1];
    const digits = text.replace(/\D/g, "");
    return digits || "";
  }

  function normId(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (/^\d+$/.test(raw)) return String(parseInt(raw, 10));
    return raw.replace(/^0+/, "") || "0";
  }

  function fold(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function setIdFromCard(card) {
    const local = String(card.localId || "");
    const id = String(card.id || "");
    const suffix = `-${local}`;
    if (local && id.toLowerCase().endsWith(suffix.toLowerCase())) {
      return id.slice(0, -suffix.length);
    }
    const idx = id.lastIndexOf("-");
    return idx > 0 ? id.slice(0, idx) : id;
  }

  function imageUrl(card) {
    if (!card?.image) return "";
    return `${card.image}/low.webp`;
  }

  async function loadSets(lang) {
    if (!setsPromise) {
      setsPromise = fetch(`${API}/${lang}/sets`)
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []);
    }
    return setsPromise;
  }

  async function searchCards(lang, name) {
    const q = encodeURIComponent(name);
    const res = await fetch(`${API}/${lang}/cards?name=${q}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  function pickCard(cards, match, sets) {
    const local = normId(collectorOf(match.number));
    const wantSet = fold(match.set_id);
    const wantName = fold(match.set_name);
    const setNameById = new Map((sets || []).map((s) => [s.id, fold(s.name)]));

    const byNumber = cards.filter((card) => {
      if (!card.image) return false;
      const loc = normId(card.localId);
      return !local || loc === local;
    });
    const pool = byNumber.length ? byNumber : cards.filter((c) => c.image);

    let best = null;
    let bestScore = -1;
    for (const card of pool) {
      const sid = setIdFromCard(card);
      let score = 0;
      if (wantSet && fold(sid) === wantSet) score += 8;
      const tcgSetName = setNameById.get(sid) || "";
      if (wantName && tcgSetName && tcgSetName === wantName) score += 10;
      if (wantName && tcgSetName && (tcgSetName.includes(wantName) || wantName.includes(tcgSetName))) {
        score += 6;
      }
      if (/^(a\d|b\d|p-a)/i.test(sid)) score -= 4;
      if (card.name && fold(card.name) === fold(match.name)) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = card;
      }
    }
    return best;
  }

  async function findOfficial(match) {
    if (!match?.name) return null;
    const lang = langOf(match);
    const key = `${lang}|${match.name}|${match.number}|${match.set_id}`;
    if (cache.has(key)) return cache.get(key);

    const pending = (async () => {
      const sets = await loadSets(lang === "en" ? "en" : "en");
      let cards = await searchCards(lang, match.name);
      if (!cards.length && lang !== "en") cards = await searchCards("en", match.name);
      const card = pickCard(cards, match, sets);
      if (!card) return null;
      return {
        name: card.name,
        id: card.id,
        image: imageUrl(card),
        page: `https://www.tcgdex.net/${lang}/cards/${card.id}`,
      };
    })();

    cache.set(key, pending);
    return pending;
  }

  global.TCGDEX = { findOfficial, imageUrl };
})(window);
