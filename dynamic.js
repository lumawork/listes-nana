"use strict";
(function () {
  const C = MissionsDynamicCore;
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
          (
            Number(c) ^
            (crypto.getRandomValues(new Uint8Array(1))[0] &
              (15 >> (Number(c) / 4)))
          ).toString(16),
        );
  const deviceKey =
    "mm-v11-device-token:" + new URL("./", location.href).pathname;
  const linkedOrigin = false; // Static GitHub Pages: calls go directly to the existing Supabase RPC.
  const portalUrl = new URL(MISSIONS_CONFIG.maisonUrl, location.href).href;

  const messages = {
    AUTH_REQUIRED: "Connecte-toi dans Mon compte pour retrouver tes missions.",
    SETUP_REQUIRED:
      "Un parent doit d’abord ouvrir Notre Maison pour initialiser le foyer.",
    PROFILE_REQUIRED: "Ce compte doit être rattaché à la famille.",
    SOURCE_ACCESS_DENIED: "Cette liste privée ne t’est pas accessible.",
    SOURCE_CHANGED:
      "La liste a changé depuis l’aperçu. Recharge le plan de reprise.",
    MIGRATED_LIST_READONLY:
      "Cette liste utilise maintenant le moteur synchronisé. Retrouve-la dans Missions synchronisées.",
    VERSION_CONFLICT:
      "Une autre session a changé cette mission. Actualise puis réessaie.",
    SCOPE_DENIED: "Ton accès ne permet pas cette action.",
    SHARING_ACK_REQUIRED:
      "Confirme que la liste choisie sera visible dans le foyer.",
    RESOLVE_OPEN_OCCURRENCE:
      "Traite d’abord l’occurrence relative déjà due avant de remplacer son calendrier.",
    INVALID_DUE: "Choisis une nouvelle échéance future, à l’heure de Paris.",
    PERIOD_REQUIRES_DAYS:
      "Une période matin/après-midi/soir utilise des jours ou des semaines.",
    ACCESS_REVOKED: "Cet accès a été révoqué. Reconnecte cet appareil.",
    REQUEST_REUSED:
      "Cet essai contient un autre contenu. Ferme puis recommence.",
  };
  function problem(e) {
    const text = e?.message || String(e);
    return (
      Object.entries(messages).find(([k]) => text.includes(k))?.[1] ||
      "Enregistrement non confirmé. Réessaie avec le même contenu. " +
        text.slice(0, 90)
    );
  }
  let refreshing = false,
    refreshAgain = false;
  let ctx = null,
    snapshot = null,
    sources = null,
    sourcePromise = null,
    shown = true,
    pending = false,
    epoch = 0,
    lastRevision = -1,
    offset = 0,
    preview = false,
    selectedPerson = "all",
    selectedGroup = "all",
    lastRefresh = 0,
    lastPoll = 0;
  let pairedToken = localStorage.getItem(deviceKey) || null;
  let stream = null,
    activeDialog = null;
  const protectedLists = new Set(),
    requests = new Map(),
    sounds = new Set();
  let audio = null;
  const nav = document.querySelector(".missions-tabs"),
    tab = btn("Missions synchronisées", () => toggle(true), "dynamic-tab");
  tab.id = "showDynamic";
  nav.prepend(tab);
  const root = el("section", "dynamic-area");
  root.id = "dynamicArea";
  root.setAttribute("aria-label", "Missions synchronisées avec Notre Maison");
  $("filters").before(root);
  const connection = el("p", "small dynamic-connection");
  connection.setAttribute("role", "status");
  root.before(connection);
  function labelInput(host, label, type, value = "", required = false) {
    const lab = el("label", null, label),
      n = el("input");
    n.type = type;
    n.value = value;
    n.required = required;
    lab.append(n);
    host.append(lab);
    return n;
  }
  function select(host, label, options, value) {
    const lab = el("label", null, label),
      s = el("select");
    for (const [v, t] of options) {
      const o = el("option", null, t);
      o.value = v;
      s.append(o);
    }
    if (value !== undefined) s.value = String(value);
    lab.append(s);
    host.append(lab);
    return s;
  }
  function check(host, label, checked = false) {
    const lab = el("label", "day-choice"),
      n = el("input");
    n.type = "checkbox";
    n.checked = checked;
    lab.append(n, document.createTextNode(label));
    host.append(lab);
    return n;
  }
  function dialog(title, wide = false) {
    if (activeDialog?.open) activeDialog.close();
    const d = el("dialog", wide ? "dynamic-dialog wide" : "dynamic-dialog"),
      top = el("div", "dynamic-dialog-head");
    top.append(
      el("h2", null, title),
      btn("×", () => d.close(), "close"),
    );
    top.lastChild.setAttribute("aria-label", "Fermer");
    d.append(top);
    document.body.append(d);
    d.addEventListener("close", () => {
      d.remove();
      if (activeDialog === d) activeDialog = null;
    });
    activeDialog = d;
    d.showModal();
    return d;
  }
  const now = () => Date.now() + offset;
  function saveFile(value, name) {
    const u = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      ),
      a = el("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  }
  async function call(action, data = {}) {
    if (preview) throw Error("EXAMPLE_ONLY");
    if (pairedToken) {
      if (!globalThis.MissionsFamily)
        await new Promise((r) => setTimeout(r, 0));
      return MissionsFamily.call("nm_rpc", {
        p_action: action,
        p_data: data,
        p_token: pairedToken,
      });
    }
    if (ctx?.session?.user?.id)
      return ctx.call("nm_rpc", { p_action: action, p_data: data });
    throw Error("AUTH_REQUIRED");
  }
  async function legacy(action, data = {}) {
    if (ctx?.session?.user?.id)
      return ctx.call("nm_legacy", { p_action: action, p_data: data });
    throw Error("AUTH_REQUIRED");
  }

  async function mutate(action, data = {}) {
    if (preview) {
      toast(
        "Exemple sans enregistrement. Connecte ton compte pour modifier tes missions.",
      );
      return;
    }
    if (pending) return;
    if (!navigator.onLine)
      throw Error("Hors connexion : aucune validation envoyée.");
    pending = true;
    const key = action + JSON.stringify(data);
    const requestId = requests.get(key) || newId();
    requests.set(key, requestId);
    try {
      const result = await call(action, { ...data, requestId });
      requests.delete(key);
      await refresh(true);
      return result;
    } catch (e) {
      toast(problem(e));
      throw e;
    } finally {
      pending = false;
    }
  }
  async function refresh(force = false) {
    if (preview) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    const current = epoch;
    try {
      const next = await call("snapshot");
      if (current !== epoch) return;
      snapshot = next;
      offset = Date.parse(next.serverNow) - Date.now();
      lastRefresh = Date.now();
      const changed = next.revision !== lastRevision;
      lastRevision = next.revision;
      connection.textContent =
        "Synchronisé avec Notre Maison · " +
        new Date().toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        " · heure de Paris";
      if (changed || force) draw();
      startStream();
    } catch (e) {
      if (current !== epoch) return;
      if (/AUTH_REQUIRED|ACCESS_REVOKED|PROFILE_REQUIRED/.test(e.message)) {
        if (e.message.includes("ACCESS_REVOKED")) {
          pairedToken = null;
          localStorage.removeItem(deviceKey);
        }
        snapshot = null;
        lastRevision = -1;
        draw();
      }
      connection.textContent = problem(e);
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        queueMicrotask(() => refresh(true));
      }
    }
  }
  function startStream() {} // Fast revision polling is used on static hosting.
  function clear(message = "Connecte-toi pour retrouver tes missions.") {
    pairedToken = null;
    localStorage.removeItem(deviceKey);
    epoch++;
    snapshot = null;
    sources = null;
    sourcePromise = null;
    protectedLists.clear();
    preview = false;
    lastRevision = -1;
    stream?.close();
    stream = null;
    connection.textContent = message;
    for (const key of Object.keys(localStorage))
      if (key.startsWith("mm-v11-cache-")) localStorage.removeItem(key);
    activeDialog?.close();
    draw();
  }
  function toggle(value) {
    shown = value;
    document.body.classList.toggle("dynamic-view", value);
    root.hidden = !value;
    connection.hidden = !value;
    $("filters").hidden = value;
    $("lists").hidden = value;
    $("sharedArea").hidden = true;
    tab.setAttribute("aria-pressed", String(value));
    $("showPersonal").setAttribute("aria-pressed", String(!value));
    $("showShared").setAttribute("aria-pressed", "false");
    if (value) {
      draw();
      refresh();
    }
  }
  $("showPersonal").addEventListener("click", () => {
    shown = false;
    root.hidden = true;
    connection.hidden = true;
    tab.setAttribute("aria-pressed", "false");
    document.body.classList.remove("dynamic-view");
  });
  $("showShared").addEventListener("click", () => {
    shown = false;
    root.hidden = true;
    connection.hidden = true;
    tab.setAttribute("aria-pressed", "false");
    document.body.classList.remove("dynamic-view");
  });
  function canManage() {
    return (
      snapshot &&
      !snapshot.deviceId &&
      (snapshot.admin || snapshot.personScope === "annabelle")
    );
  }
  function appearance(d) {
    const u = d.spec?.ui || {};
    return {
      id: u.listId || "general",
      title: u.title || "Mes missions",
      icon: u.icon || "🌿",
      color: u.color || "#b9d3c4",
      visualTheme: u.visualTheme || "inherit",
      group: u.group || "Maison",
      note: u.note || "",
    };
  }
  function welcome() {
    const box = el("section", "empty dynamic-welcome");
    box.append(
      el("div", "icon", "🌿"),
      el("h2", null, "Les mêmes missions, partout"),
      el(
        "p",
        null,
        "Tes listes gardent leur univers. Les nouvelles missions restent visibles jusqu’à leur réalisation, leur report ou ton choix de passer ton tour.",
      ),
      btn(
        "Me connecter",
        () => {
          $("parents").click();
        },
        "primary",
      ),
    );
    {
      const link = el("a", "dynamic-link", "Ouvrir Notre Maison");
      link.href = portalUrl;
      box.append(link);
    }
    box.append(
      btn("Associer cet appareil par identifiant et code", pairDevice),
      btn("Voir un exemple sans données personnelles", example),
    );
    root.append(box);
  }
  function draw() {
    if (!shown) return;
    root.replaceChildren();
    if (!snapshot) {
      welcome();
      return;
    }
    const people = snapshot.config.people,
      top = el("div", "dynamic-toolbar");
    const title = el("div");
    title.append(
      el("h2", null, "Mes missions, à mon rythme"),
      el(
        "p",
        "small",
        preview
          ? "Exemple fictif · aucune écriture dans la famille"
          : "Même moteur et mêmes validations que Notre Maison",
      ),
    );
    top.append(title);
    {
      const link = el("a", "dynamic-link", "⌂ Notre Maison");
      link.href = portalUrl;
      top.append(link);
    }
    root.append(top);
    const controls = el("div", "dynamic-controls");
    const person = select(
      controls,
      "Pour qui ?",
      [
        ["all", "Toutes les personnes autorisées"],
        ...people.map((p) => [p.id, p.name]),
      ],
      selectedPerson,
    );
    person.onchange = () => {
      selectedPerson = person.value;
      selectedGroup = "all";
      draw();
    };
    controls.append(
      btn("Actualiser", () => refresh(true)),
      btn("Mes statistiques", stats),
      btn(audio ? "Tester le son" : "Activer le son", enableSound),
    );
    if (snapshot.deviceId)
      controls.append(
        btn("Déconnecter cet appareil", async () => {
          clear();
        }),
      );
    if (canManage())
      controls.append(
        btn("+ Nouvelle mission", () => editTask(null), "primary"),
      );
    if (snapshot.admin)
      controls.append(
        btn("Reprendre mes listes V10", migration),
        btn("Accès des appareils", access),
      );
    if (!snapshot.deviceId)
      controls.append(
        btn("Sauvegarder", async () => {
          try {
            saveFile(
              await call("export"),
              "notre-maison-missions-" + C.day() + ".json",
            );
          } catch (e) {
            toast(problem(e));
          }
        }),
      );
    root.append(controls);
    const daily = el("div", "dynamic-daily");
    for (const who of people.filter(
      (p) => selectedPerson === "all" || p.id === selectedPerson,
    )) {
      const done = snapshot.occurrences.filter(
        (o) =>
          o.person === who.id &&
          o.status === "done" &&
          C.day(o.completed) === C.day(new Date(now())),
      ).length;
      daily.append(
        el(
          "span",
          null,
          who.name +
            " · " +
            done +
            " petite" +
            (done > 1 ? "s" : "") +
            " victoire" +
            (done > 1 ? "s" : "") +
            " aujourd’hui",
        ),
      );
    }
    root.append(daily);
    const rows = C.visible(snapshot.occurrences, now()).filter(
      (o) => selectedPerson === "all" || o.person === selectedPerson,
    );
    const groups = new Map();
    for (const o of rows) {
      const key = C.groupKey(o);
      if (!groups.has(key))
        groups.set(key, { person: o.person, look: appearance(o), rows: [] });
      groups.get(key).rows.push(o);
    }
    if (!rows.length) {
      const box = el("section", "empty");
      box.append(
        el("div", "icon", "☀"),
        el("h3", null, "De la place pour souffler"),
        el(
          "p",
          null,
          snapshot.definitions.some((d) => !d.archived)
            ? "Tes prochaines missions apparaîtront au bon moment. Les retards ne sont jamais effacés."
            : "Ajoute une mission ou reprends une liste V10 après vérification.",
        ),
      );
      root.append(box);
    }
    const cards = el("div", "dynamic-cards");
    for (const group of groups.values()) {
      const card = el("section", "card theme-scope dynamic-card"),
        who = people.find((p) => p.id === group.person),
        look = group.look;
      styleCard(card, look);
      const art = makeArt(listTheme(look, state.settings));
      if (art) card.append(art);
      const head = el("div", "cardhead"),
        titles = el("div");
      titles.append(
        el("h2", null, look.icon + " " + look.title),
        el("p", "subtitle", who?.name || group.person),
      );
      head.append(titles);
      card.append(head);
      const cohort = snapshot.occurrences.filter(
        (o) =>
          o.person === group.person &&
          (o.spec.ui?.listId || "general") === look.id &&
          C.day(o.original_due) === C.day(new Date(now())) &&
          o.status !== "cancelled",
      );
      if (cohort.length) {
        const stats = C.counts(cohort, now());
        const progress = el("div", "progress"),
          bar = el("div", "bar");
        bar.style.width = (stats.percent || 0) + "%";
        progress.append(bar);
        card.append(progress);
        const level =
          stats.percent >= 100
            ? 100
            : stats.percent >= 80
              ? 80
              : stats.percent >= 50
                ? 50
                : 0;
        if (level) {
          const sample = {
            id: look.id,
            tasks: cohort.map((o) => ({ done: o.status === "done" })),
          };
          const persona =
            group.person === "papa"
              ? "dad"
              : group.person === "maman"
                ? "mom"
                : "child";
          let seed = [...(C.day() + group.person + look.id + level)].reduce(
            (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
            7,
          );
          const random = () => {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            return seed / 4294967296;
          };
          card.append(
            el(
              "p",
              "encouragement",
              MissionsMessages.choose(
                sample,
                level,
                random,
                persona,
                state.settings.messageTone || "fun",
              ),
            ),
          );
        }
      }
      let last = "";
      for (const o of group.rows) {
        const bucket =
          Date.parse(o.ends) <= now()
            ? "En retard"
            : Date.parse(o.due) <= now()
              ? "À faire maintenant"
              : "À venir";
        if (bucket !== last) {
          card.append(
            el(
              "h3",
              "dynamic-bucket " + (bucket === "En retard" ? "late" : ""),
              bucket,
            ),
          );
          last = bucket;
        }
        const row = el("div", "dynamic-task");
        const button = btn("✓", () => act("complete", o), "dynamic-check");
        button.setAttribute("aria-label", "Valider " + o.title);
        button.disabled = pending || !navigator.onLine;
        const text = el("div", "dynamic-task-copy");
        text.append(
          el("strong", null, o.title),
          el(
            "span",
            "small",
            C.local(o.due) +
              (o.spec.mode === "relative" ? " · après validation" : ""),
          ),
        );
        if (o.due !== o.original_due)
          text.append(
            el(
              "span",
              "small",
              "Reportée · référence initiale : " + C.local(o.original_due),
            ),
          );
        const more = btn("•••", () => occurrence(o), "dynamic-more");
        more.setAttribute("aria-label", "Actions pour " + o.title);
        row.append(button, text, more);
        card.append(row);
      }
      if (look.note) card.append(el("p", "note", look.note));
      cards.append(card);
    }
    root.append(cards);
    if (canManage()) {
      const area = el("details", "dynamic-routines"),
        summary = el("summary", null, "Mes routines et leur calendrier");
      area.append(summary);
      for (const d of snapshot.definitions.filter(
        (d) =>
          !d.archived &&
          (selectedPerson === "all" || d.person === selectedPerson),
      )) {
        const line = el("div", "dynamic-definition");
        line.append(
          el("strong", null, d.title),
          el(
            "span",
            "small",
            d.spec.mode === "relative"
              ? "Après la dernière validation · " +
                  d.spec.every +
                  " " +
                  unitLabel(d.spec.unit)
              : d.spec.mode === "once"
                ? "Une seule fois"
                : `Toutes les ${d.spec.every} ${unitLabel(d.spec.unit)}`,
          ),
          btn("Modifier", () => editTask(d)),
          btn(d.spec.paused ? "Reprendre" : "Pause", () =>
            mutate("edit", {
              id: d.id,
              version: d.version,
              spec: { paused: !d.spec.paused },
            }).catch(() => {}),
          ),
          btn("Archiver", () => {
            if (
              confirm(
                "Archiver cette routine ? Les réalisations et retards sont conservés.",
              )
            )
              mutate("archive", { id: d.id, version: d.version }).catch(
                () => {},
              );
          }),
        );
        area.append(line);
      }
      root.append(area);
    }
    const note = el(
      "p",
      "foot",
      "V11 · les anciennes listes V10 restent consultables dans leur onglet. Une liste reprise s’y affiche en lecture seule.",
    );
    root.append(note);
  }
  function enableSound() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!audio) audio = new A();
      audio.resume().then(() => {
        beep();
        toast(
          "Son activé pour cette session. Vérifie le volume de cet appareil.",
        );
        draw();
      });
    } catch {
      toast("Le son n’est pas disponible dans ce navigateur.");
    }
  }
  function beep() {
    if (!audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.setValueAtTime(660, audio.currentTime);
    oscillator.frequency.setValueAtTime(880, audio.currentTime + 0.18);
    gain.gain.setValueAtTime(0.1, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.8);
  }
  setInterval(() => {
    if (
      !snapshot ||
      preview ||
      !audio ||
      audio.state !== "running" ||
      document.hidden ||
      !navigator.onLine
    )
      return;
    const time = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(now()));
    if (C.quiet(time, snapshot.config.quietStart, snapshot.config.quietEnd))
      return;
    for (const o of snapshot.occurrences) {
      if (o.status !== "open" || !o.spec.reminder || o.spec.paused) continue;
      const due = o.spec.reminderTime
          ? C.paris(C.day(o.due) + "T" + o.spec.reminderTime).getTime()
          : Date.parse(o.due),
        delay = (o.spec.reminderDelay || 15) * 60000,
        step = Math.floor((now() - due) / delay),
        key = o.id + ":" + step;
      if (
        step >= 0 &&
        step <= (o.spec.reminderCount ?? 2) &&
        now() - due - step * delay < 5000 &&
        !sounds.has(key)
      ) {
        sounds.add(key);
        beep();
        toast("Une petite mission t’attend : " + o.title);
      }
    }
    navigator.serviceWorker
      ?.getRegistration(linkedOrigin ? "/" : undefined)
      .then((r) =>
        r?.active?.postMessage({ type: "NM_SOUND_ACTIVE", at: Date.now() }),
      )
      .catch(() => {});
  }, 1000);
  function unitLabel(unit) {
    return (
      { minutes: "minutes", hours: "heures", days: "jours", weeks: "semaines" }[
        unit
      ] || unit
    );
  }
  async function act(action, o, extra = {}) {
    try {
      await mutate(action, { id: o.id, version: o.version, ...extra });
      if (!preview) {
        activeDialog?.close();
        toast(
          action === "complete"
            ? "Une petite victoire de plus ✨"
            : "Choix enregistré dans l’historique.",
        );
      }
    } catch {}
  }
  function occurrence(o) {
    const d = dialog(o.title);
    d.append(
      el("p", "small", C.local(o.due)),
      btn("✓ C’est fait", () => act("complete", o), "primary"),
    );
    if (snapshot.admin) {
      d.append(
        btn("Reporter cette occurrence", () => {
          const f = el("form"),
            time = labelInput(
              f,
              "Nouvelle échéance · heure de Paris",
              "datetime-local",
              C.day(new Date(now() + 86400000)) + "T18:00",
              true,
            ),
            reason = labelInput(f, "Pourquoi ? (facultatif)", "text");
          f.append(btn("Annuler", () => d.close()));
          const submit = el("button", "primary", "Enregistrer le report");
          submit.type = "submit";
          f.append(submit);
          f.onsubmit = (e) => {
            e.preventDefault();
            act("reschedule", o, { due: time.value, reason: reason.value });
          };
          d.append(f);
        }),
        btn("Je passe mon tour", () => {
          const f = el("form"),
            reason = labelInput(f, "Motif (facultatif)", "text");
          let next;
          if (o.spec.mode === "relative")
            next = labelInput(
              f,
              "Prochaine échéance sans déclarer la tâche faite",
              "datetime-local",
              C.day(new Date(now() + 86400000)) + "T18:00",
              true,
            );
          const b = el("button", "primary", "Confirmer ce tour sauté");
          b.type = "submit";
          f.append(b);
          f.onsubmit = (e) => {
            e.preventDefault();
            act("skip", o, {
              reason: reason.value,
              ...(next ? { nextDue: next.value } : {}),
            });
          };
          d.append(f);
        }),
        btn("Annuler cette occurrence", () => {
          if (
            confirm(
              "Cette occurrence est devenue inutile ? Son annulation restera tracée.",
            )
          )
            act("cancel", o, { reason: "Annulation depuis Mes Missions" });
        }),
      );
    }
    d.append(
      el(
        "p",
        "small",
        "Un report ou un tour sauté ne compte jamais comme une réalisation.",
      ),
    );
  }
  function editTask(def) {
    const collectionId = def?.spec?.ui?.listId || "custom:" + newId();
    const d = dialog(
        def ? "Modifier le calendrier futur" : "Une nouvelle petite mission",
        true,
      ),
      f = el("form"),
      current = def?.spec || {},
      look = def ? appearance(def) : {};
    const title = labelInput(f, "La mission", "text", def?.title || "", true);
    title.maxLength = 500;
    const person = select(
      f,
      "Pour qui ?",
      snapshot.config.people.map((p) => [p.id, p.name]),
      def?.person ||
        (selectedPerson === "all"
          ? snapshot.config.people[0].id
          : selectedPerson),
    );
    const collection = labelInput(
        f,
        "Nom de la fiche",
        "text",
        look.title || "Mes missions",
        true,
      ),
      icon = labelInput(f, "Symbole", "text", look.icon || "🌿");
    icon.maxLength = 8;
    const theme = select(
      f,
      "Thème de cette fiche",
      [
        ["inherit", "Suivre mon thème"],
        ["original", "Style initial"],
        ...MissionThemes.map((t) => [t.id, t.name]),
      ],
      look.visualTheme || "inherit",
    );
    const grid = el("div", "dynamic-form-grid");
    f.append(grid);
    const mode = select(
      grid,
      "Récurrence",
      [
        ["relative", "Après ma dernière validation"],
        ["fixed", "À dates fixes"],
        ["once", "Une seule fois"],
      ],
      current.mode || "relative",
    );
    const every = labelInput(
      grid,
      "Tous les",
      "number",
      current.every || 7,
      true,
    );
    every.min = "1";
    every.max = "365";
    const unit = select(
      grid,
      "Unité",
      [
        ["minutes", "Minutes"],
        ["hours", "Heures"],
        ["days", "Jours civils"],
        ["weeks", "Semaines"],
      ],
      current.unit || "days",
    );
    const first = labelInput(
      grid,
      def
        ? "Nouvelle première échéance future · Paris"
        : "Première échéance · Paris",
      "datetime-local",
      C.day(new Date(now() + (def ? 86400000 : 0))) + "T18:00",
      true,
    );
    const period = select(
      grid,
      "Fenêtre de réalisation",
      [
        ["", "Heure / journée"],
        ["morning", "Matin · 06–12"],
        ["afternoon", "Après-midi · 12–18"],
        ["evening", "Soir · 18–22"],
      ],
      current.period || "",
    );
    const start = labelInput(
        grid,
        "Début de période personnalisé",
        "time",
        current.periodStart || "",
      ),
      end = labelInput(
        grid,
        "Fin de période personnalisée",
        "time",
        current.periodEnd || "",
      );
    const rem = check(
        f,
        "Activer un rappel pour cette mission",
        !!current.reminder,
      ),
      time = labelInput(
        f,
        "Heure de rappel distincte (facultatif)",
        "time",
        current.reminderTime || "",
      );
    const delay = select(
        f,
        "Délai entre les relances",
        [
          [5, "5 minutes"],
          [10, "10 minutes"],
          [15, "15 minutes"],
          [30, "30 minutes"],
          [60, "1 heure"],
        ],
        current.reminderDelay || 15,
      ),
      repeat = select(
        f,
        "Nombre de relances",
        [
          [0, "Aucune"],
          [1, "Une"],
          [2, "Deux"],
          [3, "Trois"],
        ],
        current.reminderCount ?? 2,
      );
    const days = el("fieldset"),
      legend = el("legend", null, "Jours prévus · calendrier fixe");
    days.append(legend);
    const checks = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."].map(
      (name, i) => check(days, name, !current.days || current.days.includes(i)),
    );
    f.append(days);
    if (def)
      f.append(
        el(
          "p",
          "small",
          "Le calendrier futur sera remplacé. Les réalisations et les retards déjà échus restent conservés. Pour une récurrence relative déjà due, traite d’abord son occurrence.",
        ),
      );
    const status = el("p", "small");
    status.setAttribute("role", "status");
    const submit = el(
      "button",
      "primary",
      def ? "Enregistrer le nouveau calendrier" : "Ajouter ma mission",
    );
    submit.type = "submit";
    f.append(status, submit);
    f.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const data = C.validateTask({
          person: person.value,
          title: title.value.trim(),
          spec: {
            mode: mode.value,
            every: Number(every.value),
            unit: unit.value,
            firstDue: first.value,
            period: period.value,
            periodStart: start.value,
            periodEnd: end.value,
            days: checks.flatMap((c, i) => (c.checked ? [i] : [])),
            reminder: rem.checked,
            reminderTime: time.value,
            reminderDelay: Number(delay.value),
            reminderCount: Number(repeat.value),
            ui: {
              ...look,
              listId: collectionId,
              title: collection.value,
              icon: icon.value,
              visualTheme: theme.value,
            },
          },
        });
        const out = await mutate(def ? "edit" : "create", {
          ...data,
          ...(def
            ? { id: def.id, version: def.version, replaceSchedule: true }
            : {}),
        });
        if (out) d.close();
      } catch (e) {
        status.textContent = problem(e);
      } finally {
        submit.disabled = false;
      }
    };
    d.append(f);
  }
  function stats() {
    const d = dialog("Mes petites victoires", true),
      filters = el("div", "dynamic-controls"),
      from = labelInput(
        filters,
        "Du",
        "date",
        C.day(new Date(now() - 6 * 86400000)),
        true,
      ),
      to = labelInput(filters, "Au", "date", C.day(), true),
      person = select(
        filters,
        "Personne",
        [
          ["all", "Tout le foyer autorisé"],
          ...snapshot.config.people.map((p) => [p.id, p.name]),
        ],
        selectedPerson,
      );
    const host = el("div", "dynamic-stats");
    let data = snapshot.occurrences;
    const display = () => {
      host.replaceChildren();
      const table = el("table"),
        thead = el("thead"),
        tr = el("tr");
      for (const title of [
        "Personne",
        "À temps",
        "En retard",
        "Tours sautés",
        "Non faites",
        "À venir",
        "Reports*",
        "Réalisation",
        "Ponctualité",
      ])
        tr.append(el("th", null, title));
      thead.append(tr);
      table.append(thead);
      const body = el("tbody");
      for (const p of snapshot.config.people.filter(
        (p) => person.value === "all" || p.id === person.value,
      )) {
        const c = C.counts(
            data.filter(
              (o) =>
                o.person === p.id &&
                C.day(o.original_due) >= from.value &&
                C.day(o.original_due) <= to.value,
            ),
            now(),
          ),
          row = el("tr");
        row.append(el("th", null, p.name));
        for (const n of [
          c.timely,
          c.late,
          c.skipped,
          c.missing,
          c.pending,
          c.reported,
          c.percent === null ? "—" : c.percent + " %",
          c.punctuality === null ? "—" : c.punctuality + " %",
        ])
          row.append(el("td", null, String(n)));
        body.append(row);
      }
      table.append(body);
      host.append(
        table,
        el(
          "p",
          "small",
          "Les échéances originales servent de référence. Les annulations sont exclues. * Un report est un événement : il ne s’ajoute pas au total. Une période non terminée donne un résultat provisoire.",
        ),
      );
      const list = el("details"),
        summary = el(
          "summary",
          null,
          "Voir les réalisations, sauts et corrections",
        );
      list.append(summary);
      for (const o of data
        .filter(
          (o) =>
            o.status !== "open" &&
            (person.value === "all" || o.person === person.value) &&
            C.day(o.original_due) >= from.value &&
            C.day(o.original_due) <= to.value,
        )
        .sort((a, b) => Date.parse(b.due) - Date.parse(a.due))
        .slice(0, 200)) {
        const row = el("div", "dynamic-history");
        row.append(
          el("strong", null, o.title),
          el(
            "span",
            "small",
            C.local(o.original_due) +
              " · " +
              { done: "Réalisée", skipped: "Tour passé", cancelled: "Annulée" }[
                o.status
              ],
          ),
        );
        if (snapshot.admin)
          row.append(
            btn("Corriger", () => {
              if (
                confirm(
                  "Rouvrir cette occurrence et conserver la correction dans l’historique ?",
                )
              )
                act("reopen", o);
            }),
          );
        list.append(row);
      }
      host.append(list);
    };
    filters.append(
      btn("Appliquer", async () => {
        try {
          if (from.value > to.value)
            throw Error("La date de début doit précéder la date de fin.");
          if (!preview)
            data = (await call("snapshot", { from: from.value, to: to.value }))
              .occurrences;
          display();
        } catch (e) {
          toast(problem(e));
        }
      }),
    );
    person.onchange = display;
    d.append(filters, host);
    display();
  }
  async function access() {
    const d = dialog("Les accès aux missions"),
      host = el("div");
    d.append(
      el(
        "p",
        "small",
        "Chaque code est valable 24 h, à usage unique. L’accès associé peut être révoqué immédiatement. Il permet de consulter et valider, sans administration.",
      ),
      host,
    );
    const form = el("form"),
      who = select(form, "Quelle liste ?", [
        ["home", "Tablette familiale · les trois listes"],
        ...snapshot.config.people.map((p) => [p.id, p.name]),
      ]);
    const camera = check(
        form,
        "Sur la tablette familiale : autoriser aussi la caméra",
        false,
      ),
      shortcuts = check(
        form,
        "Sur la tablette familiale : autoriser aussi les raccourcis",
        false,
      );
    const create = el("button", "primary", "Créer un code");
    create.type = "submit";
    form.append(create);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const result = await mutate("grant", {
          person: who.value,
          permissions: { camera: camera.checked, shortcuts: shortcuts.checked },
        });
        if (result) {
          host.replaceChildren(el("h3", null, "À transmettre en privé"));
          labelInput(host, "Identifiant", "text", result.identifier).readOnly =
            true;
          labelInput(host, "Code temporaire", "text", result.code).readOnly =
            true;
          host.append(
            el(
              "p",
              "small",
              "Le code n’apparaîtra plus après la fermeture de cette fenêtre.",
            ),
          );
        }
      } catch {}
    };
    d.append(form);
    for (const g of snapshot.grants?.filter((g) => !g.revoked) || []) {
      const row = el("div", "dynamic-history");
      row.append(
        el(
          "strong",
          null,
          g.person === "home"
            ? "Tablette familiale"
            : snapshot.config.people.find((p) => p.id === g.person)?.name ||
                g.person,
        ),
        el(
          "span",
          "small",
          g.used
            ? "Appareil associé"
            : "Code en attente · " + C.local(g.expires),
        ),
        btn("Révoquer", async () => {
          try {
            await mutate("revoke", { id: g.id });
            d.close();
            access();
          } catch {}
        }),
      );
      d.append(row);
    }
  }
  async function migration() {
    if (preview) {
      toast("La reprise de données est disponible après connexion.");
      return;
    }
    const d = dialog("Reprendre une liste V10", true);
    const status = el("p", "small", "Lecture des sources autorisées…");
    status.setAttribute("role", "status");
    d.append(
      el(
        "p",
        null,
        "Seule la liste choisie sera reprise. Ses anciennes coches et son historique restent conservés comme observations. Les nouvelles occurrences commencent à la date choisie ; aucun horaire de validation ancien n’est inventé.",
      ),
      status,
    );
    try {
      if (ctx?.synchronize) await ctx.synchronize();
      sources = await legacy("sources");
      const form = el("form"),
        choices = [
          ...sources.personal.map((p) => [
            "personal:" + p.owner,
            p.self ? "Mes listes personnelles" : p.name + " · enfant rattaché",
          ]),
          ...sources.shared.map((p) => [
            "shared:" + p.id,
            "Liste partagée · " + p.name,
          ]),
        ];
      if (!choices.length) {
        status.textContent =
          "Aucune source autorisée. Connecte ton compte Mes Missions existant.";
        return;
      }
      const source = select(form, "Source", choices),
        list = select(form, "Liste à reprendre", []),
        person = select(
          form,
          "Afficher dans le foyer pour",
          snapshot.config.people.map((p) => [p.id, p.name]),
        ),
        start = labelInput(
          form,
          "Début des nouvelles occurrences · Paris",
          "date",
          C.day(new Date(now() + 86400000)),
          true,
        );
      start.min = C.day();
      const next = el("button", "primary", "Préparer l’aperçu");
      next.type = "submit";
      form.append(next);
      const report = el("div", "dynamic-migration-report");
      d.append(form, report);
      const loadLists = async () => {
        report.replaceChildren();
        list.replaceChildren();
        next.disabled = true;
        try {
          const [kind, id] = source.value.split(":");
          if (kind === "personal") {
            const result = await legacy("lists", { owner: id });
            for (const l of result.lists) {
              const option = el(
                "option",
                null,
                l.title +
                  " · " +
                  l.tasks +
                  " tâches" +
                  (l.migrated ? " · déjà reprise" : ""),
              );
              option.value = l.id;
              option.disabled = !!l.migrated;
              list.append(option);
            }
            list.value =
              [...list.options].find((o) => !o.disabled)?.value || "";
            const p = sources.personal.find((p) => p.owner === id);
            person.value =
              p?.profileKind === "child"
                ? "annabelle"
                : snapshot.config.people.find((p) => p.userId === id)?.id ||
                  "maman";
          } else {
            const s = sources.shared.find((p) => p.id === id),
              option = el("option", null, s.name);
            option.value = id;
            list.append(option);
          }
          status.textContent =
            "Aucune donnée modifiée. Prépare l’aperçu pour vérifier les dates et la destination.";
        } catch (e) {
          status.textContent = problem(e);
        } finally {
          next.disabled = !list.value;
        }
      };
      source.onchange = loadLists;
      list.onchange = () => {
        report.replaceChildren();
        next.disabled = !list.value;
      };
      await loadLists();
      form.onsubmit = async (e) => {
        e.preventDefault();
        next.disabled = true;
        try {
          const [kind, id] = source.value.split(":"),
            selection = {
              kind,
              ...(kind === "personal" ? { owner: id } : {}),
              listId: list.value,
              person: person.value,
              start: start.value,
            },
            plan = await legacy("plan", selection),
            requestId = newId();
          report.replaceChildren(
            el("h3", null, "Vérification avant reprise"),
            el(
              "p",
              null,
              plan.title +
                " → " +
                snapshot.config.people.find((p) => p.id === plan.person)?.name,
            ),
            el(
              "p",
              null,
              plan.taskCount +
                " tâches · " +
                plan.checkedObservations +
                " coches anciennes archivées",
            ),
            el("p", "warning", plan.warning),
          );
          const details = el("details");
          details.append(
            el("summary", null, "Vérifier les premières échéances"),
          );
          for (const t of plan.tasks)
            details.append(
              el(
                "p",
                "small",
                t.title +
                  " · " +
                  C.local(t.firstDue) +
                  " · " +
                  (t.spec.mode === "once"
                    ? "une seule fois"
                    : t.spec.every + " " + unitLabel(t.spec.unit)),
              ),
            );
          report.append(details);
          const backup = btn("Télécharger la sauvegarde de cette liste", () =>
            saveFile(
              plan.snapshot,
              "mes-missions-avant-reprise-" + C.day() + ".json",
            ),
          );
          report.append(backup);
          const ack = check(
              report,
              "J’ai conservé la sauvegarde et je choisis de rendre cette liste visible dans le foyer.",
            ),
            apply = btn(
              "Confirmer la reprise de cette liste",
              async () => {
                if (!ack.checked) {
                  toast(
                    "Conserve la sauvegarde puis confirme la visibilité dans le foyer.",
                  );
                  return;
                }
                apply.disabled = true;
                try {
                  const out = await legacy("apply", {
                    ...selection,
                    hash: plan.hash,
                    confirmFamilyVisibility: true,
                    requestId,
                  });
                  await prepare(ctx?.call, ctx?.session, ctx?.profile);
                  await refresh(true);
                  report.replaceChildren(
                    el(
                      "h3",
                      null,
                      out.alreadyMigrated
                        ? "Cette liste a déjà été reprise"
                        : "Reprise terminée",
                    ),
                    el(
                      "p",
                      null,
                      "Les originaux sont conservés. Les rappels V10 de cette liste sont maintenant bloqués ; les nouveaux rappels restent désactivés jusqu’à ton choix.",
                    ),
                  );
                  toast(
                    "Liste reprise sans doublon. Les nouveaux rappels restent désactivés.",
                  );
                  if (ctx?.reload) await ctx.reload();
                } catch (e) {
                  status.textContent = problem(e);
                  apply.disabled = false;
                }
              },
              "primary",
            );
          report.append(apply);
          status.textContent =
            "Aucun changement tant que tu ne confirmes pas la reprise.";
        } catch (e) {
          status.textContent = problem(e);
        } finally {
          next.disabled = false;
        }
      };
    } catch (e) {
      status.textContent = problem(e);
    }
  }
  async function prepare(rpc, session, profile) {
    if (!session?.user?.id) {
      protectedLists.clear();
      return;
    }
    try {
      const next = await rpc("nm_legacy", { p_action: "sources", p_data: {} });
      protectedLists.clear();
      for (const link of next.links || [])
        if (
          link.active &&
          link.kind === "personal" &&
          link.owner === session.user.id
        )
          protectedLists.add(link.listId);
      sources = next;
    } catch (e) {
      if (!String(e.message).includes("does not exist"))
        connection.textContent = problem(e);
    }
  }
  function setContext(next) {
    const old = ctx?.session?.user?.id,
      identity = next?.session?.user?.id;
    ctx = identity && next.profile ? next : null;
    if (identity !== old) {
      clear();
      if (ctx) {
        preview = false;
        prepare(ctx.call, ctx.session, ctx.profile).then(() => {
          render();
          refresh(true);
        });
      }
    }
  }
  function repaint() {
    if (shown && snapshot && Date.now() - lastRefresh > 60000) refresh();
  }
  function example() {
    preview = true;
    const current = Date.now(),
      due = (dt) => new Date(current + dt).toISOString(),
      mk = (id, person, title, delta, spec = {}) => ({
        id,
        def_id: id,
        person,
        title,
        due: due(delta),
        original_due: due(delta),
        ends: due(delta + 3600000),
        original_end: due(delta + 3600000),
        visible: due(-86400000),
        status: "open",
        version: 1,
        spec: {
          mode: "fixed",
          every: 1,
          unit: "days",
          ui: {
            listId: "demo-" + person,
            title:
              person === "annabelle"
                ? "Mon petit soir"
                : "Les gestes de la maison",
            icon: person === "annabelle" ? "🌷" : "🌿",
            visualTheme: person === "annabelle" ? "ponyrose" : "cocoon",
          },
          ...spec,
        },
      });
    snapshot = {
      preview: true,
      admin: true,
      config: {
        people: [
          { id: "annabelle", name: "Annabelle" },
          { id: "papa", name: "Papa" },
          { id: "maman", name: "Maman" },
        ],
        tone: "fun",
      },
      definitions: [],
      occurrences: [
        mk("demo1", "annabelle", "Préparer mon sac", -9000000),
        mk("demo2", "annabelle", "Prendre ma douche", 1800000),
        mk("demo3", "papa", "Aller aux poules", 2 * 86400000, {
          mode: "relative",
          every: 7,
          unit: "days",
        }),
      ],
    };
    connection.textContent =
      "Exemple fictif · aucun enregistrement ni notification";
    draw();
  }
  async function linkPortal() {} // Compatibility hook for the existing family UI.
  function isMigrated(id) {
    return protectedLists.has(id);
  }
  function legacyBanner(card, id) {
    if (!isMigrated(id)) return false;
    card.classList.add("legacy-migrated");
    card.append(
      el(
        "p",
        "dynamic-legacy-badge",
        "Reprise dans le moteur synchronisé · original conservé",
      ),
      btn("Ouvrir les missions synchronisées", () => toggle(true), "primary"),
    );
    return true;
  }
  function pairDevice() {
    const d = dialog("Associer cet appareil"),
      f = el("form");
    d.append(
      el(
        "p",
        "small",
        "Un parent crée l’identifiant et le code depuis Accès des appareils. Aucun mot de passe personnel n’est transmis.",
      ),
    );
    const identifier = labelInput(f, "Identifiant", "text", "", true),
      code = labelInput(f, "Code temporaire", "text", "", true),
      label = labelInput(
        f,
        "Nom de cet appareil",
        "text",
        "Tablette familiale",
        true,
      ),
      status = el("p", "small");
    code.autocomplete = "off";
    const submit = el("button", "primary", "Associer cet appareil");
    submit.type = "submit";
    f.append(status, submit);
    f.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        if (ctx?.session?.user?.id) {
          status.textContent =
            "Déconnecte d’abord ton compte depuis Mon compte avant d’associer cet appareil.";
          submit.disabled = false;
          return;
        }
        {
          const out = await MissionsFamily.call("nm_rpc", {
            p_action: "pair",
            p_data: {
              identifier: identifier.value.trim(),
              code: code.value.trim(),
              label: label.value,
            },
          });
          if (out.error) throw Error(out.error);
          pairedToken = out.token;
          localStorage.setItem(deviceKey, pairedToken);
        }
        code.value = "";
        preview = false;
        await refresh(true);
        d.close();
      } catch (e) {
        status.textContent = problem(e);
      } finally {
        submit.disabled = false;
      }
    };
    d.append(f);
  }
  function currentSnapshot() {
    return snapshot;
  }
  globalThis.MissionsDynamic = {
    prepare,
    setContext,
    repaint,
    refresh,
    toggle,
    linkPortal,
    isMigrated,
    legacyBanner,
    clear,
    currentSnapshot,
    isShown: () => shown,
  };
  setInterval(async () => {
    if (
      !shown ||
      document.hidden ||
      preview ||
      !snapshot ||
      pending ||
      !navigator.onLine
    )
      return;
    if (
      linkedOrigin &&
      !ctx?.session?.user?.id &&
      Date.now() - lastPoll < 10000
    )
      return;
    lastPoll = Date.now();
    try {
      const rev = await call("revision");
      if (rev.revision !== lastRevision) refresh();
    } catch (e) {
      if (/AUTH_REQUIRED|ACCESS_REVOKED/.test(e.message)) clear(problem(e));
      else
        connection.textContent =
          "Connexion interrompue · les validations nécessitent Internet";
    }
  }, 1000);
  window.addEventListener("online", () => refresh(true));
  window.addEventListener("offline", () => {
    connection.textContent =
      "Hors connexion · affichage conservé, validations suspendues";
    draw();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === "nm-auth-logout") clear("Session fermée sur cet appareil.");
    if (e.key === deviceKey) {
      epoch++;
      pairedToken = e.newValue || null;
      snapshot = null;
      lastRevision = -1;
      draw();
      if (pairedToken) refresh(true);
    }
  });
  setInterval(() => {
    if (
      shown &&
      snapshot &&
      !preview &&
      !pending &&
      navigator.onLine &&
      Date.now() - lastRefresh > 60000
    )
      refresh();
  }, 15000);
  $("showPersonal").textContent = "Mes listes V10";
  document.querySelector(".version").textContent =
    "Version 11.1 · reliée à Notre Maison";
  toggle(true);
})();
