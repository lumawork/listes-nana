/* Validation et cycles des listes. */
(function (root) {
  const H =
    typeof module === "object"
      ? require("./history.js").MissionsHistory
      : root.MissionsHistory;
  const universes = [
    "original",
    "morning",
    "horsebook",
    "clean",
    "garden",
    "bows",
    "minimal",
    "kawaii",
    "ponyrose",
    "stables",
    "country",
    "tavern",
    "grimoire",
    "forest",
    "rest",
    "cocoon",
    "quietgarden",
    "lavender",
    "sunday",
  ];
  const defaults = {
    theme: "rose",
    accent: "#93566e",
    decor: "hearts",
    layout: "cards",
    font: "round",
    size: "16",
    universe: "original",
  };
  function dayKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }
  function weekKey(date = new Date()) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
  }
  function validate(x) {
    if (
      !x ||
      x.version !== 1 ||
      !Array.isArray(x.lists) ||
      x.lists.length > 100
    )
      throw Error("Format de sauvegarde non reconnu.");
    const str = (v, n) => typeof v === "string" && v.length <= n;
    const ids = new Set();
    for (const l of x.lists) {
      if (
        !l ||
        !str(l.id, 100) ||
        ids.has(l.id) ||
        !str(l.title, 100) ||
        !l.title.trim() ||
        !str(l.icon, 8) ||
        !str(l.group, 100) ||
        !str(l.note, 2000) ||
        !/^#[0-9a-f]{6}$/i.test(l.color) ||
        typeof l.weekly !== "boolean" ||
        !Array.isArray(l.tasks) ||
        l.tasks.length > 300 ||
        !str(l.week, 40)
      )
        throw Error("Liste invalide.");
      if (
        l.pausedUntil !== undefined &&
        l.pausedUntil !== "" &&
        !/^\d{4}-\d{2}-\d{2}$/.test(l.pausedUntil)
      )
        throw Error("Pause invalide.");
      if (
        l.messagePersona !== undefined &&
        !["child", "dad", "mom"].includes(l.messagePersona)
      )
        throw Error("Style invalide.");
      if (
        l.visualTheme !== undefined &&
        !["inherit", ...universes].includes(l.visualTheme)
      )
        throw Error("Thème de liste invalide.");
      if (
        l.resetMode !== undefined &&
        !["daily", "weekly", "manual"].includes(l.resetMode)
      )
        throw Error("Fréquence invalide.");
      if (l.day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(l.day))
        throw Error("Date invalide.");
      if (
        l.milestones !== undefined &&
        (!Array.isArray(l.milestones) ||
          l.milestones.length > 3 ||
          l.milestones.some((n) => ![50, 80, 100].includes(n)))
      )
        throw Error("Étapes invalides.");
      for (const field of ["messageChoices", "messageHistory"]) {
        if (l[field] !== undefined) {
          const obj = l[field];
          if (!obj || typeof obj !== "object" || Array.isArray(obj))
            throw Error("Messages invalides.");
          for (const [key, value] of Object.entries(obj)) {
            if (!["50", "80", "100"].includes(key))
              throw Error("Étape de message invalide.");
            const values = field === "messageHistory" ? value : [value];
            if (
              !Array.isArray(values) ||
              values.length > 20 ||
              values.some((n) => !Number.isInteger(n) || n < 0 || n >= 100)
            )
              throw Error("Choix de message invalide.");
          }
        }
      }
      if (
        l.activeDays !== undefined &&
        (!Array.isArray(l.activeDays) ||
          l.activeDays.length > 7 ||
          new Set(l.activeDays).size !== l.activeDays.length ||
          l.activeDays.some((n) => !Number.isInteger(n) || n < 0 || n > 6))
      )
        throw Error("Jours prévus invalides.");
      if (l.reminder !== undefined) {
        const r = l.reminder;
        if (
          !r ||
          typeof r !== "object" ||
          Array.isArray(r) ||
          typeof r.enabled !== "boolean" ||
          typeof r.followup !== "boolean" ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ||
          ![5, 10, 15, 30, 60].includes(r.delay) ||
          r.timezone !== "Europe/Paris"
        )
          throw Error("Rappel invalide.");
        if (
          r.snoozeUntil !== undefined &&
          (!str(r.snoozeUntil, 40) ||
            !Number.isFinite(Date.parse(r.snoozeUntil)) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(r.snoozeDay || ""))
        )
          throw Error("Report invalide.");
      }
      ids.add(l.id);
      const tids = new Set();
      for (const t of l.tasks) {
        if (
          !t ||
          !str(t.id, 100) ||
          tids.has(t.id) ||
          !str(t.text, 500) ||
          !t.text.trim() ||
          !str(t.time, 5) ||
          (t.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) ||
          typeof t.done !== "boolean"
        )
          throw Error("Tâche invalide.");
        tids.add(t.id);
      }
    }
    const s = x.settings || {};
    for (const [k, values] of Object.entries({
      theme: ["rose", "sage", "sky", "peach"],
      universe: [
        "original",
        "morning",
        "horsebook",
        "clean",
        "garden",
        "bows",
        "minimal",
        "kawaii",
        "ponyrose",
        "stables",
        "country",
        "tavern",
        "grimoire",
        "forest",
        "rest",
        "cocoon",
        "quietgarden",
        "lavender",
        "sunday",
      ],
      decor: ["theme", "hearts", "stars", "none"],
      layout: ["cards", "compact"],
      font: ["round", "classic", "serif", "hand"],
      size: ["16", "18", "20"],
    })) {
      if (s[k] !== undefined && !values.includes(s[k]))
        throw Error("Réglage invalide.");
    }
    if (s.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(s.accent))
      throw Error("Couleur invalide.");
    let originalStyle;
    if (s.originalStyle !== undefined) {
      const o = s.originalStyle;
      if (!o || typeof o !== "object" || Array.isArray(o))
        throw Error("Style initial invalide.");
      originalStyle = {};
      for (const [k, values] of Object.entries({
        theme: ["rose", "sage", "sky", "peach"],
        decor: ["theme", "hearts", "stars", "none"],
        layout: ["cards", "compact"],
        font: ["round", "classic", "serif", "hand"],
        size: ["16", "18", "20"],
      })) {
        if (!values.includes(o[k])) throw Error("Style initial invalide.");
        originalStyle[k] = o[k];
      }
      if (!/^#[0-9a-f]{6}$/i.test(o.accent))
        throw Error("Couleur initiale invalide.");
      originalStyle.accent = o.accent;
    }
    const extra = {};
    if (s.messageStyle !== undefined) {
      if (!["child", "dad", "mom"].includes(s.messageStyle))
        throw Error("Style de messages invalide.");
      extra.messageStyle = s.messageStyle;
    }
    if (s.messageTone !== undefined) {
      if (!["fun", "soft", "discreet"].includes(s.messageTone))
        throw Error("Ton invalide.");
      extra.messageTone = s.messageTone;
    }
    if (s.nicknames !== undefined) {
      if (typeof s.nicknames !== "boolean") throw Error("Surnoms invalides.");
      extra.nicknames = s.nicknames;
    }
    return {
      version: 1,
      settings: {
        ...defaults,
        ...extra,
        ...Object.fromEntries(
          Object.keys(defaults)
            .filter((k) => s[k] !== undefined)
            .map((k) => [k, s[k]]),
        ),
        ...(originalStyle ? { originalStyle } : {}),
      },
      lists: JSON.parse(JSON.stringify(x.lists)),
      ...(x.history !== undefined ? { history: H.validate(x.history) } : {}),
    };
  }
  function resetList(l, date = new Date()) {
    l.tasks.forEach((t) => (t.done = false));
    l.milestones = [];
    l.messageChoices = {};
    l.day = dayKey(date);
    l.week = weekKey(date);
  }
  function rollover(state, date = new Date()) {
    let changed = false;
    const today = dayKey(date),
      week = weekKey(date);
    for (const l of state.lists) {
      if (globalThis.MissionsDynamic?.isMigrated(l.id)) continue;
      // The upgrade starts a daily cycle today without erasing existing checks.
      if (l.resetMode === undefined) {
        l.resetMode = "daily";
        l.weekly = false;
        l.day = today;
        l.milestones = [];
        changed = true;
        continue;
      }
      if (!l.day) {
        l.day = today;
        changed = true;
      }
      if (
        (l.resetMode === "daily" && l.day !== today) ||
        (l.resetMode === "weekly" && l.week !== week)
      ) {
        resetList(l, date);
        changed = true;
      }
    }
    return changed;
  }

  function progressLevel(l) {
    if (!l.tasks.length) return 0;
    const count = l.tasks.filter((t) => t.done).length,
      n = l.tasks.length;
    return count === n
      ? 100
      : count * 100 >= n * 80
        ? 80
        : count * 100 >= n * 50
          ? 50
          : 0;
  }
  function reachedMilestone(l, before) {
    if (!l.tasks.length) return 0;
    const after = l.tasks.filter((t) => t.done).length,
      n = l.tasks.length;
    const crossed = [50, 80, 100].filter(
      (level) => before * 100 < n * level && after * 100 >= n * level,
    );
    const seen = l.milestones || [];
    const fresh = crossed.filter((level) => !seen.includes(level));
    l.milestones = [...new Set([...seen, ...crossed])];
    return fresh.length ? Math.max(...fresh) : 0;
  }

  function listTheme(l, settings) {
    return !l.visualTheme || l.visualTheme === "inherit"
      ? settings.universe
      : l.visualTheme;
  }
  root.MissionsCore = {
    defaults,
    weekKey,
    dayKey,
    validate,
    rollover,
    listTheme,
    resetList,
    progressLevel,
    reachedMilestone,
  };
})(typeof module === "object" ? module.exports : globalThis);
