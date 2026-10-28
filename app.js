"use strict";
const {
  defaults,
  weekKey,
  dayKey,
  validate,
  rollover,
  listTheme,
  resetList,
  progressLevel,
  reachedMilestone,
} = MissionsCore;
let KEY = "mm-v9-guest";
let state = { version: 1, settings: { ...defaults }, lists: [] },
  filter = "Tout",
  editing = null,
  rows = [];
const $ = (id) => document.getElementById(id),
  el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  },
  uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
let timer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").style.display = "block";
  clearTimeout(timer);
  timer = setTimeout(() => ($("toast").style.display = "none"), 5000);
}
try {
  const saved = localStorage.getItem(KEY);
  if (saved) state = validate(JSON.parse(saved));
} catch (e) {
  setTimeout(
    () =>
      toast(
        "Sauvegarde locale inaccessible ou illisible. Importe une sauvegarde ; tes anciennes données ne sont pas effacées.",
      ),
    500,
  );
}
function messageFor(list, level) {
  return MissionsMessages.choose(
    list,
    level,
    Math.random,
    state.settings.messageStyle || "child",
    state.settings.messageTone || "fun",
  );
}
function artPath(id) {
  return MissionThemes.find((t) => t.id === id)?.art || "art/" + id + ".webp";
}
function save() {
  try {
    MissionsHistory.capture(state);
    localStorage.setItem(KEY, JSON.stringify(state));
    if (globalThis.MissionsFamily) MissionsFamily.queue();
    return true;
  } catch (e) {
    toast(
      "Enregistrement impossible. Exporte tes données avant de fermer cette page.",
    );
    return false;
  }
}
function apply() {
  const s = state.settings,
    t = MissionThemes.find((t) => t.id === s.universe),
    palettes = {
      rose: ["#fcf7fa", "#f4e4ed"],
      sage: ["#f6f8f2", "#e7eddf"],
      sky: ["#f5f7fc", "#e6eafa"],
      peach: ["#fff8f0", "#fae8d9"],
    };
  document.body.dataset.universe = s.universe;
  document.body.style.setProperty(
    "--bg",
    t ? "var(--theme-bg)" : palettes[s.theme][0],
  );
  document.body.style.setProperty(
    "--soft",
    t ? "var(--theme-soft)" : palettes[s.theme][1],
  );
  // Theme variables live on body so they also resolve in the modal.
  document.documentElement.style.setProperty("--accent", s.accent);
  document.documentElement.style.fontSize = s.size + "px";
  document.body.className = [
    s.layout,
    s.font,
    "font-" + s.font,
    s.decor === "none" ? "nodecor" : "",
  ].join(" ");
  document.body.dataset.decor = s.decor;
  const heading = {
    hand: "cursive",
    classic: "Arial,sans-serif",
    serif: "Georgia,serif",
    round:
      s.universe === "original"
        ? "Georgia,serif"
        : 'ui-rounded,"Trebuchet MS",sans-serif',
  }[s.font];
  document.body.style.setProperty("--heading", heading);
  document
    .querySelectorAll(".deco")
    .forEach(
      (n) =>
        (n.textContent =
          s.decor === "stars"
            ? " ✧"
            : s.decor === "theme" && t
              ? " " + t.mark
              : " ♡"),
    );
  for (const k of Object.keys(defaults)) if ($(k)) $(k).value = s[k];
  $("heroTitle").textContent = t ? t.heading : "Une chose à la fois";
  $("heroSubtitle").textContent = t
    ? t.subtitle
    : "Mes petites missions, à mon rythme.";
  const art = $("heroArt");
  if (art.dataset.art !== (t ? t.id : "original")) {
    art.replaceChildren();
    if (t) {
      const img = el("img");
      img.src = artPath(t.id);
      img.alt = "";
      art.append(img);
    }
    art.dataset.art = t ? t.id : "original";
  }
  $("selectedTheme").textContent = t
    ? "Thème sélectionné : " + t.name
    : "Style d’origine · tes couleurs et tes listes sont conservées";
  document
    .querySelectorAll(".theme-choice")
    .forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.theme === s.universe),
    );
}
function chooseTheme(id) {
  const t = MissionThemes.find((t) => t.id === id),
    s = state.settings;
  if (id !== "original" && s.universe === "original")
    s.originalStyle = Object.fromEntries(
      ["theme", "accent", "decor", "layout", "font", "size"].map((k) => [
        k,
        s[k],
      ]),
    );
  if (id === "original" && s.originalStyle) Object.assign(s, s.originalStyle);
  s.universe = id;
  if (t) {
    s.accent = t.accent;
    s.font = t.font;
    s.decor = "theme";
  }
  save();
  render();
}
function buildGallery() {
  const gallery = $("themeGallery");
  MissionThemes.forEach((t) => {
    const b = btn("", () => chooseTheme(t.id), "theme-choice");
    b.dataset.theme = t.id;
    b.setAttribute("aria-label", t.name + " — " + t.description);
    const preview = el("span", "theme-preview");
    preview.dataset.universe = t.id;
    const img = el("img");
    img.src = artPath(t.id);
    img.alt = "";
    img.loading = "lazy";
    const mini = el("span", "mini-card");
    mini.append(
      el("span", "mini-heading", t.sample),
      el("span", "mini-line", "☐ Une petite mission"),
      el("span", "mini-line", "☐ Un moment pour moi"),
    );
    preview.append(img, mini);
    b.append(
      preview,
      el("strong", null, t.name),
      el("span", "theme-description", t.description),
    );
    gallery.append(b);
  });
}

function btn(text, fn, cls) {
  const b = el("button", cls, text);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function styleCard(card, l) {
  const s = state.settings,
    id = listTheme(l, s),
    theme = MissionThemes.find((t) => t.id === id),
    own = !!l.visualTheme && l.visualTheme !== "inherit";
  const free = own && id === "original" ? s.originalStyle || s : s;
  const palette = {
    rose: ["#fcf7fa", "#f4e4ed"],
    sage: ["#f6f8f2", "#e7eddf"],
    sky: ["#f5f7fc", "#e6eafa"],
    peach: ["#fff8f0", "#fae8d9"],
  }[free.theme];
  card.dataset.universe = id;
  card.dataset.decor = own
    ? id === "original"
      ? free.decor
      : "theme"
    : s.decor;
  card.style.setProperty("--card", l.color);
  card.style.setProperty(
    "--bg",
    id === "original" ? palette[0] : "var(--theme-bg)",
  );
  card.style.setProperty(
    "--soft",
    id === "original" ? palette[1] : "var(--theme-soft)",
  );
  card.style.setProperty(
    "--accent",
    own ? theme?.accent || free.accent : s.accent,
  );
  const font = own ? theme?.font || free.font : s.font;
  card.style.setProperty(
    "--heading",
    {
      serif: "Georgia,serif",
      hand: "cursive",
      classic: "Arial,sans-serif",
      round:
        id === "original"
          ? "Georgia,serif"
          : 'ui-rounded,"Trebuchet MS",sans-serif',
    }[font],
  );
}

function makeArt(id) {
  if (id === "original") return null;
  const frame = el("div", "card-art"),
    img = el("img");
  img.src = artPath(id);
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  frame.setAttribute("aria-hidden", "true");
  frame.append(img);
  return frame;
}
function previewListTheme() {
  const chosen = $("listTheme").value,
    id = chosen === "inherit" ? state.settings.universe : chosen,
    t = MissionThemes.find((t) => t.id === id),
    box = $("listThemePreview");
  box.replaceChildren();
  const card = el("div", "list-art-preview theme-scope");
  card.dataset.universe = id;
  const art = makeArt(id);
  if (art) card.append(art);
  card.append(el("strong", null, t ? t.name : "Mode libre · style initial"));
  box.append(card);
}
MissionThemes.forEach((t) => {
  const option = el("option", null, t.name);
  option.value = t.id;
  $("listTheme").append(option);
});
$("listTheme").onchange = previewListTheme;

function render() {
  let changed = rollover(state);
  for (const l of state.lists) {
    if (globalThis.MissionsDynamic?.isMigrated(l.id)) continue;
    const level = progressLevel(l);
    if (
      level &&
      (l.messageChoices?.[level] === undefined ||
        l.messagePersona !== (state.settings.messageStyle || "child"))
    ) {
      messageFor(l, level);
      changed = true;
    }
  }
  if (changed || !state.history?.some((r) => r.date === dayKey())) save();
  apply();
  const tasks = state.lists.flatMap((l) => l.tasks),
    done = tasks.filter((t) => t.done).length;
  $("total").textContent = tasks.length
    ? `${done} / ${tasks.length} petites missions accomplies`
    : "";
  $("filters").replaceChildren();
  const groups = ["Tout", ...new Set(state.lists.map((l) => l.group))];
  if (!groups.includes(filter)) filter = "Tout";
  groups.forEach((g) => {
    const b = btn(g, () => {
      filter = g;
      render();
    });
    b.setAttribute("aria-pressed", g === filter);
    $("filters").append(b);
  });
  $("filters").append(btn("+ Nouvelle liste", () => openEditor()));
  $("lists").replaceChildren();
  if (!state.lists.length) {
    const box = el("section", "empty");
    box.append(
      el("div", "icon", "🎀"),
      el("h2", null, "Bienvenue dans ton petit univers"),
      el(
        "p",
        null,
        "Importe le fichier de tes listes pour retrouver toutes tes missions, puis imagine ton style.",
      ),
      btn(
        "Importer mes listes",
        () => {
          $("atelier").showModal();
          $("import").click();
        },
        "primary",
      ),
      btn("Créer ma première liste", () => openEditor()),
    );
    $("lists").append(box);
  }
  state.lists
    .filter((l) => filter === "Tout" || l.group === filter)
    .forEach((l) => {
      const card = el("section", "card theme-scope");
      styleCard(card, l);
      card.dataset.listId = l.id;
      const head = el("div", "cardhead"),
        titles = el("div");
      titles.append(
        el("h2", null, l.title),
        el(
          "p",
          "subtitle",
          `${l.tasks.filter((t) => t.done).length} / ${l.tasks.length} terminées${l.resetMode === "daily" ? " · chaque jour" : l.resetMode === "weekly" ? " · chaque semaine" : " · remise à zéro manuelle"}`,
        ),
      );
      head.append(el("span", "icon", l.icon), titles);
      const artwork = makeArt(listTheme(l, state.settings));
      if (artwork) card.append(artwork);
      card.append(head);
      const progress = el("div", "progress"),
        bar = el("div", "bar");
      bar.style.width =
        (l.tasks.length
          ? (l.tasks.filter((t) => t.done).length / l.tasks.length) * 100
          : 0) + "%";
      progress.append(bar);
      card.append(progress);
      const level = progressLevel(l);
      if (level && !globalThis.MissionsDynamic?.isMigrated(l.id)) {
        const message = el(
          "p",
          "encouragement level-" + level,
          messageFor(l, level),
        );
        card.append(message);
      }
      l.tasks.forEach((t) => {
        const label = el("label", "task"),
          check = el("input");
        check.type = "checkbox";
        check.checked = t.done;
        check.disabled = !!globalThis.MissionsDynamic?.isMigrated(l.id);
        check.onchange = () => {
          rollover(state);
          const before = l.tasks.filter((t) => t.done).length;
          t.done = check.checked;
          const milestone = reachedMilestone(l, before),
            message = milestone ? messageFor(l, milestone) : "";
          save();
          if (milestone && state.settings.messageTone !== "discreet")
            toast("« " + l.title + " » : " + message);
          const activeId = t.id;
          render();
          document.querySelectorAll("input[data-task]").forEach((n) => {
            if (n.dataset.task === activeId) n.focus();
          });
        };
        check.dataset.task = t.id;
        const text = el("span", "text");
        if (t.time) text.append(el("span", "time", t.time.replace(":", " h ")));
        text.append(document.createTextNode(t.text));
        label.append(check, text);
        card.append(label);
      });
      if (l.note) card.append(el("p", "note", l.note));
      if (l.pausedUntil && l.pausedUntil >= dayKey())
        card.append(
          el(
            "p",
            "small",
            "En pause jusqu’au " +
              new Date(l.pausedUntil + "T12:00:00").toLocaleDateString(
                "fr-FR",
              ) +
              " inclus.",
          ),
        );
      if (globalThis.MissionsDynamic?.legacyBanner(card, l.id)) {
        $("lists").append(card);
        return;
      }
      const actions = el("div", "cardactions");
      actions.append(
        btn("Thème de la liste", () => {
          openEditor(l.id);
          $("listTheme").focus();
        }),
        btn("Modifier", () => openEditor(l.id)),
        btn("Tout décocher", () => {
          if (confirm("Recommencer cette liste ?")) {
            resetList(l);
            save();
            render();
          }
        }),
      );
      if (l.reminder?.enabled)
        actions.append(
          btn("Rappeler dans 15 min", () => {
            l.reminder.snoozeUntil = new Date(
              Date.now() + 15 * 60000,
            ).toISOString();
            l.reminder.snoozeDay = dayKey();
            save();
            toast(
              "Rappel reporté de 15 minutes. Il sera pris en compte après synchronisation.",
            );
          }),
        );
      if (globalThis.MissionsShared)
        actions.append(
          btn("Partager cette liste", () => MissionsShared.sharePrivate(l.id)),
        );
      actions.append(
        btn("Supprimer la liste", () => {
          if (
            confirm(
              "Supprimer cette liste ? Son historique reste disponible pendant 30 jours.",
            )
          ) {
            state.lists = state.lists.filter((x) => x.id !== l.id);
            save();
            render();
          }
        }),
      );
      card.append(actions);
      $("lists").append(card);
    });
}
function openEditor(id) {
  editing = id || null;
  const l = state.lists.find((l) => l.id === id) || {
    title: "Ma nouvelle liste",
    icon: "🎀",
    group: "Autres",
    color: "#c7a3bd",
    note: "",
    weekly: false,
    resetMode: "daily",
    tasks: [],
  };
  const f = $("editform");
  for (const k of ["title", "icon", "group", "color", "note"])
    f.elements[k].value = l[k];
  if (!f.elements.group.value) f.elements.group.value = "Autres";
  f.elements.resetMode.value = l.resetMode || "daily";
  $("pauseUntil").value = l.pausedUntil || "";
  document
    .querySelectorAll("input[data-weekday]")
    .forEach(
      (n) =>
        (n.checked =
          !l.activeDays || l.activeDays.includes(Number(n.dataset.weekday))),
    );
  f.elements.visualTheme.value = l.visualTheme || "inherit";
  previewListTheme();
  rows = l.tasks.map((t) => ({ ...t }));
  renderRows();
  $("editTitle").textContent = id ? "Modifier ma liste" : "Créer ma liste";
  if (globalThis.MissionsReminders) MissionsReminders.fill(l);
  $("editor").showModal();
}
[
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
].forEach((name, i) => {
  const label = el("label", "day-choice"),
    check = el("input");
  check.type = "checkbox";
  check.dataset.weekday = String(i);
  check.checked = true;
  label.append(check, document.createTextNode(name));
  $("dayChecks").append(label);
});
function renderRows() {
  $("editTasks").replaceChildren();
  rows.forEach((t, i) => {
    const row = el("div", "editrow"),
      lab = el("label", null, `Tâche ${i + 1}`),
      input = el("input");
    input.value = t.text;
    input.required = true;
    input.maxLength = 500;
    input.oninput = () => (t.text = input.value);
    lab.append(input);
    const timeLab = el("label", null, "Horaire (facultatif)"),
      time = el("input");
    time.type = "time";
    time.value = t.time;
    time.oninput = () => (t.time = time.value);
    timeLab.append(time);
    const tools = el("div", "rowtools");
    const up = btn("↑", () => {
      [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
      renderRows();
    });
    up.disabled = i === 0;
    up.setAttribute("aria-label", "Monter la tâche");
    const down = btn("↓", () => {
      [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]];
      renderRows();
    });
    down.disabled = i === rows.length - 1;
    down.setAttribute("aria-label", "Descendre la tâche");
    tools.append(
      up,
      down,
      btn("Supprimer", () => {
        rows.splice(i, 1);
        renderRows();
      }),
    );
    row.append(lab, timeLab, tools);
    $("editTasks").append(row);
  });
}
$("addTask").onclick = () => {
  rows.push({ id: uid(), text: "", time: "", done: false });
  renderRows();
};
$("cancelEdit").onclick = () => $("editor").close();
$("editform").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target,
    l = {
      ...(state.lists.find((x) => x.id === editing) || {}),
      id: editing || uid(),
      title: f.elements.title.value.trim(),
      icon: f.elements.icon.value,
      group: f.elements.group.value,
      color: f.elements.color.value,
      visualTheme: f.elements.visualTheme.value,
      activeDays: [...document.querySelectorAll("input[data-weekday]")]
        .filter((n) => n.checked)
        .map((n) => Number(n.dataset.weekday)),
      note: f.elements.note.value,
      pausedUntil: $("pauseUntil").value,
      weekly: f.elements.resetMode.value === "weekly",
      resetMode: f.elements.resetMode.value,
      day:
        state.lists.find((x) => x.id === editing)?.resetMode ===
        f.elements.resetMode.value
          ? state.lists.find((x) => x.id === editing)?.day || dayKey()
          : dayKey(),
      milestones: [
        ...(state.lists.find((x) => x.id === editing)?.milestones || []),
      ],
      week:
        state.lists.find((x) => x.id === editing)?.resetMode ===
        f.elements.resetMode.value
          ? state.lists.find((x) => x.id === editing)?.week || weekKey()
          : weekKey(),
      tasks: rows.map((t) => ({ ...t, text: t.text.trim() })),
    };
  if (globalThis.MissionsReminders) l.reminder = MissionsReminders.read();
  const next = structuredClone(state),
    i = next.lists.findIndex((x) => x.id === editing);
  if (i < 0) next.lists.push(l);
  else next.lists[i] = l;
  try {
    state = validate(next);
  } catch (e) {
    toast(e.message);
    return;
  }
  save();
  $("editor").close();
  render();
};
$("settings").onclick = () => $("atelier").showModal();
$("originalTheme").onclick = () => chooseTheme("original");
buildGallery();
for (const k of Object.keys(defaults).filter((k) => $(k)))
  $(k).oninput = () => {
    state.settings[k] = $(k).value;
    if (k === "theme") {
      state.settings.universe = "original";
      state.settings.accent = {
        rose: "#93566e",
        sage: "#536b48",
        sky: "#5c639a",
        peach: "#9c5a36",
      }[state.settings.theme];
    }
    save();
    render();
  };
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = el("a");
  a.href = url;
  a.download =
    "mes-missions-sauvegarde-" +
    new Date().toISOString().slice(0, 10) +
    ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Sauvegarde téléchargée. Garde-la dans un endroit sûr.");
};
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 3000000) throw Error("Ce fichier est trop volumineux.");
    const next = validate(JSON.parse(await file.text()));
    if (
      state.lists.length &&
      !confirm(
        "Remplacer toutes tes listes, tes coches et ton apparence par ce fichier ? Exporte d’abord si tu veux les conserver.",
      )
    )
      return;
    state = next;
    save();
    filter = "Tout";
    render();
    $("atelier").close();
    toast("Tes listes sont prêtes !");
  } catch (err) {
    toast(err.message || "Import impossible.");
  } finally {
    e.target.value = "";
  }
};
const renderPersonal = render;
render = function () {
  renderPersonal();
  if (globalThis.MissionsShared) MissionsShared.repaint();
  if (globalThis.MissionsDynamic) {
    MissionsDynamic.repaint();
    if (MissionsDynamic.isShown()) document.body.classList.add("dynamic-view");
  }
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) render();
});
setInterval(() => {
  if (rollover(state)) {
    save();
    render();
  }
}, 60000);
render();
if ("serviceWorker" in navigator && window.isSecureContext)
  navigator.serviceWorker.register("./sw.js").catch(() => {});
