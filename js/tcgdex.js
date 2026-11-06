(function (global) {
  const API = "https://api.tcgdex.net/v2";
  const LANGS = new Set(["en", "fr", "es", "it", "pt", "de", "ja"]);
  const cache = new Map();
  const setsCache = new Map();

  function langOf(match) {
    const raw = String(match?.lang || "en").toLowerCase();
    if (raw.startsWith("pt")) return "pt";
    if (raw.startsWith("zh")) return "en";
    return LANGS.has(raw) ? raw : "en";
  }

  function fold(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function identityOf(number) {
    const text = String(number || "").toUpperCase().replace(/\s+/g, "");
    const slash = text.match(/^([A-Z]*)0*(\d+)[/\-]0*(\d+)/);
    const source = slash || text.match(/^([A-Z]*)0*(\d+)/);
    if (!source || !source[2]) return { letters: "", n: "" };
    return { letters: source[1] || "", n: String(parseInt(source[2], 10)) };
  }

  function sameNumber(card, wanted) {
    const got = identityOf(card.localId);
    return Boolean(wanted.n) && got.n === wanted.n && got.letters === wanted.letters;
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

  function namesOf(match) {
    const seen = new Set();
    const names = [];
    [match.name_en, match.name, match.name_pt].forEach((value) => {
      const text = String(value || "").trim();
      const key = fold(text);
      if (!text || seen.has(key)) return;
      seen.add(key);
      names.push(text);
    });
    return names;
  }

  function wantedSets(match) {
    const seen = new Set();
    [match.set_id, match.set_name, match.set_name_en, match.set_name_pt].forEach((value) => {
      const key = fold(value);
      if (key) seen.add(key);
    });
    return seen;
  }

  function nameFits(wanted, got) {
    if (!wanted || !got) return false;
    if (wanted === got) return true;
    const short = wanted.length <= got.length ? wanted : got;
    const long = wanted.length <= got.length ? got : wanted;
    return short.length >= 10 && long.includes(short);
  }

  function imageUrl(card) {
    if (!card?.image) return "";
    return `${card.image}/low.webp`;
  }

  async function loadSets(lang) {
    if (!setsCache.has(lang)) {
      const pending = fetch(`${API}/${lang}/sets`)
        .then((res) => {
          if (res.status === 429 || res.status >= 500) throw new Error("tcgdex");
          return res.ok ? res.json() : [];
        })
        .then((data) => (Array.isArray(data) ? data : []))
        .catch((err) => {
          setsCache.delete(lang);
          throw err;
        });
      setsCache.set(lang, pending);
    }
    return setsCache.get(lang);
  }

  async function searchCards(lang, name) {
    const res = await fetch(`${API}/${lang}/cards?name=${encodeURIComponent(name)}`);
    if (res.status === 429 || res.status >= 500) throw new Error("tcgdex");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }

  function remember(found, card, lang) {
    if (!card?.id) return;
    const prev = found.get(card.id);
    const image = card.image || prev?.image || "";
    const prefer = !prev || (lang !== "en" && image && card.image) || (!prev.image && image);
    if (!prev || prefer) {
      found.set(card.id, { ...card, image, lang: card.image ? lang : prev?.lang || lang });
    } else if (!prev.image && card.image) {
      found.set(card.id, { ...prev, image: card.image, lang });
    }
  }

  function setFits(card, wanted, setNames) {
    const sid = fold(setIdFromCard(card));
    if (sid && wanted.has(sid)) return true;
    const names = setNames.get(setIdFromCard(card)) || [];
    return names.some((name) => [...wanted].some((item) => nameFits(item, name)));
  }

  function pickCard(cards, match, setNames) {
    const wantedNumber = identityOf(match.number);
    const wanted = wantedSets(match);
    const numbered = cards.filter((card) => sameNumber(card, wantedNumber));
    if (!numbered.length) return null;
    const fitted = numbered.filter((card) => setFits(card, wanted, setNames));
    const pool = fitted.length ? fitted : numbered.length === 1 ? numbered : [];
    if (!pool.length) return null;
    return pool.find((card) => card.image) || pool[0];
  }

  async function cardImage(card) {
    if (card.image) return imageUrl(card);
    const res = await fetch(`${API}/en/cards/${encodeURIComponent(card.id)}`);
    if (!res.ok) return "";
    const detail = await res.json();
    return imageUrl(detail);
  }

  async function findOfficial(match) {
    if (!match?.name && !match?.name_en && !match?.name_pt) return null;
    const lang = langOf(match);
    const key = [lang, match.name_en, match.name, match.name_pt, match.number, match.set_id, match.set_name_en, match.set_name_pt].join("|");
    if (cache.has(key)) return cache.get(key);

    const pending = (async () => {
      const names = namesOf(match);
      const english = String(match.name_en || names[0] || "").trim();
      const jobs = [{ code: "en", name: english }];
      const localName = String(match.name_pt || match.name || "").trim();
      if (lang !== "en" && localName && fold(localName) !== fold(english)) {
        jobs.push({ code: lang, name: localName });
      }
      const [lists, groups] = await Promise.all([
        Promise.all(["en", lang].filter((code, index, all) => all.indexOf(code) === index).map((code) => loadSets(code).catch(() => []))),
        Promise.all(jobs.map(async (job) => ({ code: job.code, cards: await searchCards(job.code, job.name).catch(() => []) }))),
      ]);
      const setNames = new Map();
      lists.flat().forEach((row) => {
        if (!row?.id || !row.name) return;
        const bucket = setNames.get(row.id) || [];
        bucket.push(fold(row.name));
        setNames.set(row.id, bucket);
      });
      const found = new Map();
      groups.forEach((group) => group.cards.forEach((card) => remember(found, card, group.code)));
      const card = pickCard([...found.values()], match, setNames);
      if (!card) return null;
      const image = await cardImage(card);
      if (!image) return null;
      return {
        name: card.name,
        id: card.id,
        image,
        page: `https://www.tcgdex.net/${card.lang || lang}/cards/${card.id}`,
      };
    })().catch((err) => {
      cache.delete(key);
      throw err;
    });

    cache.set(key, pending);
    return pending;
  }

  global.TCGDEX = { findOfficial, imageUrl };
})(window);
