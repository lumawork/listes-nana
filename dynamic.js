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
    STEPS_INCOMPLETE: "Ouvre la mission et coche ses étapes pour la terminer.",
    VERSION_CONFLICT: "Cette mission vient de changer sur un autre appareil. Le contenu est actualisé ; réessaie.",
    PERSON_ALREADY_ASSIGNED: "Cette personne est déjà associée à un autre compte. Un parent peut vérifier l’association dans les réglages du foyer.",
    AUTH_REQUIRED: "Connecte-toi dans Mon compte pour retrouver tes missions.",
    SETUP_REQUIRED:
      "Un parent doit d’abord ouvrir Notre Maison pour initialiser le foyer.",
    PROFILE_REQUIRED: "Ce compte doit être rattaché à la famille.",
    SOURCE_ACCESS_DENIED: "Cette liste privée ne t’est pas accessible.",
    SOURCE_CHANGED:
      "La liste a changé depuis l’aperçu. Recharge le plan de reprise.",
    MIGRATED_LIST_READONLY:
      "Cette liste utilise maintenant le moteur synchronisé. Retrouve-la dans Aujourd’hui ou Gérer.",
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
    selectedPerson = "",
    managing = false,
    selectedGroup = "all",
    upgradeState = "idle",
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
    tab = btn("Aujourd’hui", () => { managing = false; toggle(true); }, "dynamic-tab");
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
    if (pending) throw Error("Un enregistrement est déjà en cours. Réessaie dans un instant.");
    if (!navigator.onLine)
      throw Error("Hors connexion : aucune validation envoyée.");
    pending = true;
    connection.textContent = "Envoi…";
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
      draw();
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
      let next = await call("snapshot");
      if (current !== epoch) return;
      if (next.apiVersion >= 12 && ctx?.session?.user?.id && !next.deviceId && upgradeState === "idle") {
        upgradeState = "working";
        try {
          if (ctx.synchronize) await ctx.synchronize();
          const upgrade = await call("bootstrap");
          if (current !== epoch) return;
          upgradeState = upgrade.needsPerson ? "needs-person" : "done";
          if (!upgrade.needsPerson) { await prepare(ctx.call,ctx.session,ctx.profile);next=await call("snapshot"); }
        } catch(e) { upgradeState = "error";connection.textContent=problem(e); }
      }
      if (current !== epoch) return;
      snapshot = next;
      if (!selectedPerson) selectedPerson = MissionsDailyCore.initialPerson(next, ctx?.session?.user?.id,
        localStorage.getItem("mm-dashboard-person:" + (ctx?.session?.user?.id || "device")) || "");
      offset = Date.parse(next.serverNow) - Date.now();
      lastRefresh = Date.now();
      const changed = next.revision !== lastRevision;
      lastRevision = next.revision;
      connection.dataset.state = "ready";
      connection.textContent =
        "À jour · " +
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
      connection.dataset.state = "error";
      connection.textContent = problem(e);
      draw();
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
    if(value)globalThis.MissionsShared?.toggle?.(false);
    shown = value;
    document.body.classList.toggle("dynamic-view", value);
    root.hidden = !value;
    connection.hidden = !value;
    $("filters").hidden = value;
    $("lists").hidden = value;
    $("sharedArea").hidden = true;
    tab.setAttribute("aria-pressed", String(value && !managing));
    $("showPersonal").setAttribute("aria-pressed", String(value && managing));
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
      upgradeState !== "needs-person" &&
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
  function drawLegacy() {
    if (managing || pairedToken || preview) return;
    const groups = MissionsDailyCore.legacyGroups(state.lists || [], now(), isMigrated);
    if (!groups.length) return;
    const section = el("section", "daily-legacy");
    section.append(el("h2", null, "Mes listes personnelles"),
      el("p", "small", "Ces listes ne sont pas encore reprises dans Notre Maison. Leur suivi reste celui de l’ancien moteur ; retrouve la reprise dans Mon atelier → Administration."));
    for (const {list, tasks} of groups) {
      const card = el("section", "card theme-scope daily-legacy-card");
      styleCard(card, list);
      card.append(el("h3", null, (list.icon || "🌿") + " " + list.title),
        el("p", "small", tasks.length + " à faire · récurrence de la liste"));
      for (const task of tasks) {
        const label = el("label", "task"), check = el("input");
        check.type = "checkbox";
        check.setAttribute("aria-label", "Valider " + task.text);
        check.onchange = () => {
          if (isMigrated(list.id)) { render(); return; }
          task.done = check.checked; save(); render();
        };
        const text = el("span", "text", task.text);
        if (task.time) text.prepend(el("span", "time", task.time.replace(":", " h ") + " · "));
        label.append(check, text); card.append(label);
      }
      section.append(card);
    }
    root.append(section);
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
    root.classList.toggle("daily-dashboard", !managing);
    if (!snapshot) {
      welcome();
      return;
    }
    if ((snapshot.apiVersion || 0) < 12) root.append(el("p","note","Installation à terminer : appliquer le complément Supabase V12 avant d’utiliser les nouvelles missions."));
    if (upgradeState === "needs-person") {
      const setup=el("section","empty");setup.append(el("h2",null,"À qui correspondent tes listes ?"),el("p",null,"Ce choix associe ton compte à ton espace. Tes anciennes listes seront récupérées automatiquement une seule fois."));
      for(const p of snapshot.config.people.filter(p=>!p.userId||p.userId===ctx?.session?.user?.id))setup.append(btn(p.name,async()=>{try{await call("bootstrap",{person:p.id});upgradeState="done";selectedPerson=p.id;await prepare(ctx.call,ctx.session,ctx.profile);await refresh(true);}catch(e){toast(problem(e));}},"primary"));
      root.append(setup);
    }
    if(upgradeState === "error")root.append(btn("Réessayer la récupération des listes",()=>{upgradeState="idle";refresh(true);}));
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
          : "Tes missions du moment, une chose à la fois.",
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
        ["", "Choisir ma liste"],
        ...(snapshot.admin ? [["all", "Vue familiale"]] : []),
        ...people.filter(p => !snapshot.personScope || p.id === snapshot.personScope).map((p) => [p.id, p.name]),
      ],
      selectedPerson,
    );
    person.parentElement.hidden = !managing && selectedPerson !== "";
    person.onchange = () => {
      selectedPerson = person.value;
      localStorage.setItem("mm-dashboard-person:" + (ctx?.session?.user?.id || "device"), selectedPerson);
      selectedGroup = "all";
      draw();
    };
    controls.append(
      ...(connection.dataset.state === "error" ? [btn("Réessayer", () => refresh(true))] : []),
      btn("Mes statistiques", stats),
      ...(managing ? [btn(audio ? "Tester le son" : "Activer le son", enableSound)] : []),

    );
    if (snapshot.deviceId)
      controls.append(
        btn("Déconnecter cet appareil", async () => {
          clear();
        }),
      );
    if (canManage())
      controls.append(
        btn("+ Ajouter", () => editTask(null), "primary"),
      );
    if (managing && snapshot.admin) controls.append(btn("Accès de la tablette",access));
    if (managing && !snapshot.deviceId)
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
    if (managing && canManage()) drawDefinitions();
    const reminded = managing ? [] : reminderRows();
    if (reminded.length) drawReminders(reminded);
    if(managing && snapshot.upgradeReport?.length){
      const report=el("details");report.append(el("summary",null,"Mes listes ont été récupérées — voir le bilan"));
      for(const row of snapshot.upgradeReport)report.append(el("p","small",row.list+" · "+({imported:"mission avec étapes",unscheduled:"conservée sans date",preserved:"calendrier existant conservé"}[row.status]||row.status)));
      root.append(report);
    }
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
      const cohort = snapshot.occurrences.filter(o => o.person === who.id && C.day(o.original_due) === C.day(new Date(now())) && o.status !== "cancelled" && !o.spec.paused);
      const count = C.counts(cohort, now());
      const summary = el("div", "daily-person-summary");
      const avatar = el("span", "daily-avatar");
      avatar.setAttribute("role", "img");avatar.setAttribute("aria-label", "Avatar de " + who.name);
      if (who.image && /^data:image\//.test(who.image)) {
        avatar.style.backgroundImage = `url("${who.image}")`;
        avatar.style.backgroundSize = "cover";
      } else {
        avatar.style.backgroundImage = "url(art/avatar-presets.png)";
        avatar.style.backgroundSize = "300% 200%";
        avatar.style.backgroundPosition = `${[0,50,100][(who.avatar||0)%3]}% ${(who.avatar||0)<3?0:100}%`;
      }
      const text = el("div");
      text.append(el("strong", null, who.name), el("p", "small", count.completed + " / " + count.total + " missions du jour terminées"));
      const encouragements = ["Un petit pas suffit pour commencer 🌱", "Chaque mission compte, tu avances ✨", "À ton rythme, une chose après l’autre 💪", "Capitaine des petites victoires 🚀"];
      const index = [...(C.day(new Date(now()))+who.id)].reduce((n,c)=>n+c.charCodeAt(0),0)%encouragements.length;
      text.append(el("p", "daily-message", count.total && count.completed===count.total ? "Tout est fait aujourd’hui, bravo ! 🎉" : encouragements[index]));
      summary.append(avatar,text);daily.append(summary);
    }
    root.append(daily);
    const rows = C.visible(snapshot.occurrences, now()).filter(
      (o) => (selectedPerson === "all" || o.person === selectedPerson) && !reminded.includes(o),
    );
    const groups = new Map();
    for (const o of rows) {
      const bucketKey = Date.parse(o.ends) <= now() ? "0" : Date.parse(o.due) <= now() ? "1" : "2";
      const key = (managing ? "" : bucketKey + ":") + C.groupKey(o);
      if (!groups.has(key))
        groups.set(key, { person: o.person, look: appearance(o), rows: [] });
      groups.get(key).rows.push(o);
    }
    if (!rows.length && !reminded.length) {
      const box = el("section", "empty");
      box.append(
        el("div", "icon", "☀"),
        el("h3", null, "De la place pour souffler"),
        el(
          "p",
          null,
          snapshot.definitions.some((d) => !d.archived)
            ? "Tes prochaines missions apparaîtront au bon moment. Les retards ne sont jamais effacés."
            : "Aucune mission synchronisée à afficher. Tes listes restent accessibles dans la gestion.",
        ),
      );
      root.append(box);
    }
    const cards = el("div", "dynamic-cards");
    const orderedGroups = [...groups.values()].sort((a,b) => {
      const rank = g => Math.min(...g.rows.map(o => Date.parse(o.ends)<=now()?0:Date.parse(o.due)<=now()?1:2));
      return rank(a)-rank(b);
    });
    for (const group of orderedGroups) {
      const card = el("section", "card theme-scope dynamic-card"),
        who = people.find((p) => p.id === group.person),
        look = group.look;
      styleCard(card, look);
      const art = makeArt(listTheme(look, state.settings));
      if (managing && art) card.append(art);
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
      const legacyGroup = /^(personal|shared):/.test(look.id) && group.rows.every(o=>!o.spec.steps?.length);
      let taskHost=card;
      if(legacyGroup){taskHost=el("details","legacy-checklist");taskHost.append(el("summary",null,group.rows.length+" éléments à faire · ouvrir le détail"));card.append(taskHost);}
      let last = "";
      for (const o of group.rows) {
        const bucket =
          Date.parse(o.ends) <= now()
            ? "En retard"
            : Date.parse(o.due) <= now()
              ? "À faire maintenant"
              : "À venir";
        if (bucket !== last) {
          taskHost.append(
            el(
              "h3",
              "dynamic-bucket " + (bucket === "En retard" ? "late" : ""),
              bucket,
            ),
          );
          last = bucket;
        }
        taskHost.append(taskRow(o));
      }
      if (managing && look.note) card.append(el("p", "note", look.note));
      cards.append(card);
    }
    if(!managing)root.append(cards);
    const note = el(
      "p",
      "foot",
      "Une chose à la fois. Les missions sans date et leur détail restent dans Gérer.",
    );
    root.append(note);
  }
  // Missions with a reminder are gathered at the top of Aujourd’hui, from the start of their day.
  function reminderRows() {
    const today = C.day(new Date(now()));
    return snapshot.occurrences
      .filter(
        (o) =>
          o.status === "open" &&
          !o.spec.paused &&
          o.spec.reminder &&
          (selectedPerson === "all" || o.person === selectedPerson) &&
          (Date.parse(o.visible) <= now() ||
            Date.parse(o.ends) <= now() ||
            C.day(o.due) <= today),
      )
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due) || a.id.localeCompare(b.id));
  }
  function drawReminders(list) {
    const card = el("section", "card dynamic-card dynamic-reminders");
    card.append(el("h2", null, "🔔 Mes missions"));
    for (const o of list) card.append(taskRow(o, true));
    root.append(card);
  }
  function opened(o) {
    return Date.parse(o.visible) <= now() || Date.parse(o.ends) <= now();
  }
  function taskRow(o, inlineSteps = false) {
    const row = el("div", "dynamic-task");
    const hasSteps=!!o.spec.steps?.length;
    const button = btn(hasSteps ? "Ouvrir" : "✓", () => hasSteps ? checklist(o) : act("complete", o), "dynamic-check");
    button.setAttribute("aria-label", (hasSteps ? "Ouvrir les étapes de " : "Valider ") + o.title);
    button.disabled = pending || !navigator.onLine;
    const text = el("div", "dynamic-task-copy");
    text.append(
      el("strong", null, o.title),
      ...(hasSteps ? [el("span","small",o.spec.steps.filter(s=>o.spec.stepDone?.[s.id]).length+" / "+o.spec.steps.length+" étapes")] : []),
      el(
        "span",
        "small",
        C.dueLabel(o) +
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
    if (!opened(o)) {
      button.disabled = true;
      text.append(el("span", "small", "Ouverte à partir de " + C.local(o.visible)));
    }
    if (!inlineSteps || !hasSteps) return row;
    const wrap = el("div", "dynamic-task-wrap");
    wrap.append(row, stepDetails(o));
    return wrap;
  }
  const openSteps = new Set();
  function stepDetails(o) {
    const steps = o.spec.steps || [],
      done = o.spec.stepDone || {},
      box = el("details", "dynamic-steps");
    box.open = openSteps.has(o.id);
    box.ontoggle = () => (box.open ? openSteps.add(o.id) : openSteps.delete(o.id));
    box.append(el("summary", null, "Voir les étapes"));
    for (const step of steps) {
      const label = el("label", "task"),
        input = el("input");
      input.type = "checkbox";
      input.checked = !!done[step.id];
      input.disabled = pending || !navigator.onLine || !opened(o);
      label.append(input, el("span", "text", (step.time ? step.time.replace(":", " h ") + " · " : "") + step.title));
      input.onchange = async () => {
        input.disabled = true;
        try {
          await mutate("step", { id: o.id, version: o.version, stepId: step.id, done: input.checked });
        } catch {
          await refresh(true);
        }
      };
      box.append(label);
    }
    return box;
  }
  function drawDefinitions() {
    const area = el("details", "dynamic-routines"),
      summary = el("summary", null, "Mes missions, y compris sans date");
    area.append(summary);area.open=true;
    for (const d of snapshot.definitions.filter(
      (d) =>
        !d.archived &&
        (selectedPerson === "all" || d.person === selectedPerson),
    ).sort((a, b) => Number(!!b.spec.reminder) - Number(!!a.spec.reminder))) {
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
              : d.spec.mode === "none" ? "Sans date · conservée dans Gérer" : `Toutes les ${d.spec.every} ${unitLabel(d.spec.unit)}`,
          ...(d.spec.reminder ? [" · 🔔 " + (MissionWizard.initialTime(d.spec) || "à l’échéance")] : []),
        ),
        btn("Modifier", () => editTask(d)),
        ...(d.spec.mode !== "none" ? [btn(d.spec.paused ? "Reprendre" : "Pause", () =>
          mutate("edit", {id:d.id,version:d.version,spec:{paused:!d.spec.paused}}).catch(()=>{}))] : []),
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
      if (d.spec.steps?.length) {
        const steps = el("details", "dynamic-steps");
        steps.append(el("summary", null, d.spec.steps.length + " étapes"));
        for (const step of d.spec.steps)
          steps.append(el("p", "small", (step.time ? step.time.replace(":", " h ") + " · " : "") + step.title));
        line.append(steps);
      }
      area.append(line);
    }
    root.append(area);
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
      el("p", "small", C.dueLabel(o)),
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
    const d=dialog(def?'Modifier la mission':'Ajouter une mission',true),f=el('form'),current=def?.spec||{},look=def?appearance(def):{};
    if((snapshot.apiVersion||0)<12){d.append(el('p',null,'Le complément Supabase V12 doit être installé avant de créer des missions avec étapes.'));return;}
    const title=labelInput(f,'Quoi ?','text',def?.title||'',true);title.maxLength=500;
    const person=select(f,'Pour qui ?',snapshot.config.people.filter(p=>snapshot.admin||p.id===snapshot.personScope).map(p=>[p.id,p.name]),def?.person||selectedPerson);
    const mode=select(f,'Quand ?',[['none','Sans date'],['once','Une fois'],['fixed','Certains jours'],['relative','Après chaque réalisation']],current.mode||'once');
    const calendar=el('section','wizard-calendar');f.append(calendar);
    const date=labelInput(calendar,'Date / à partir du','date',(current.firstDue||C.day()).slice(0,10),true);
    const time=labelInput(calendar,'Heure, si nécessaire','time',MissionWizard.initialTime(current));
    const relative=el('div');calendar.append(relative);
    const every=labelInput(relative,'Tous les','number',current.every||7,true);every.min='1';every.max='365';
    const unit=select(relative,'Intervalle',[['days','jours'],['weeks','semaines'],['hours','heures'],['minutes','minutes']],current.unit||'days');
    const dayBox=el('fieldset');dayBox.append(el('legend',null,'Quels jours ?'));calendar.append(dayBox);
    const days=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'].map((t,i)=>check(dayBox,t,!current.days||current.days.includes(i)));
    const reminders=el('section');f.append(reminders);
    const rem=check(reminders,'Me rappeler cette mission à son heure',!!current.reminder);
    const detail=el('details','wizard-steps');detail.append(el('summary',null,'Ajouter des étapes (facultatif)'));const stepLabel=el('label',null,'Une étape par ligne. Une heure peut précéder le texte : 15:00 Préparer le sac.');const stepText=el('textarea');stepText.rows=5;stepText.value=(current.steps||[]).map(s=>(s.time?s.time+' ':'')+s.title).join('\n');stepLabel.append(stepText);detail.append(stepLabel);detail.open=!!current.steps?.length;f.append(detail);
    const advanced=el('details');advanced.append(el('summary',null,'Plus d’options'));f.append(advanced);
    const collection=labelInput(advanced,'Groupe de missions','text',look.title||'Maison',true),icon=labelInput(advanced,'Symbole','text',look.icon||'🌿');
    const period=select(advanced,'Période',[['','Journée / heure choisie'],['morning','Matin'],['afternoon','Après-midi'],['evening','Soir']],current.period||'');
    const periodStart=labelInput(advanced,'Début personnalisé','time',current.periodStart||''),periodEnd=labelInput(advanced,'Fin personnalisée','time',current.periodEnd||'');
    const visualTheme=select(advanced,'Thème de cette mission',[['inherit','Suivre mon thème'],['original','Style initial'],...MissionThemes.map(t=>[t.id,t.name])],look.visualTheme||'inherit');
    const delay=select(advanced,'Espacement des relances',[[5,'5 min'],[10,'10 min'],[15,'15 min'],[30,'30 min'],[60,'1 h']],current.reminderDelay||15);
    const repeats=select(advanced,'Relances supplémentaires',[[0,'Aucune'],[1,'Une'],[2,'Deux'],[3,'Trois']],current.reminderCount??0);
    const update=()=>{calendar.hidden=mode.value==='none';date.required=mode.value!=='none';relative.hidden=mode.value!=='relative';every.required=mode.value==='relative';dayBox.hidden=mode.value!=='fixed';reminders.hidden=mode.value==='none';time.required=mode.value!=='none'&&rem.checked;periodStart.parentElement.hidden=!period.value;periodEnd.parentElement.hidden=!period.value;};mode.onchange=update;rem.onchange=update;period.onchange=update;update();
    const status=el('p','small');status.setAttribute('role','status');const submit=el('button','primary',def?'Enregistrer':'Ajouter');submit.type='submit';f.append(status,submit);
    f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{
      const existing=snapshot.definitions.find(x=>x.spec?.ui?.title===collection.value.trim()&&x.person===person.value);
      const data=MissionWizard.build({title:title.value,person:person.value,mode:mode.value,date:date.value,time:time.value,every:mode.value==='relative'?Number(every.value):mode.value==='fixed'?Number(current.every||1):1,unit:mode.value==='relative'?unit.value:mode.value==='fixed'?(current.unit||'days'):'days',days:days.flatMap((x,i)=>x.checked?[i]:[]),reminder:rem.checked,reminderDelay:delay.value,reminderCount:repeats.value,steps:stepText.value,groupTitle:collection.value.trim(),groupId:existing?.spec.ui.listId||look.id||('group:'+collection.value.trim()),icon:icon.value,visualTheme:visualTheme.value,period:period.value,periodStart:periodStart.value,periodEnd:periodEnd.value},def);
      if(data.spec.mode!=='none')C.validateTask(data);
      await mutate(def?'edit':'create',{...data,...(def?{id:def.id,version:def.version,replaceSchedule:data.replaceSchedule}:{})});d.close();
    }catch(e){status.textContent=problem(e);}finally{submit.disabled=false;}};
    d.append(f);
  }
  function checklist(o){
    const d=dialog(o.title,true),host=el('div');let guided=false;
    const drawSteps=()=>{
      const current=snapshot.occurrences.find(x=>x.id===o.id)||o;
      if(current.status!=='open'){d.close();toast('Mission terminée, bravo !');return;}
      host.replaceChildren();const steps=current.spec.steps||[],done=current.spec.stepDone||{},n=steps.filter(s=>done[s.id]).length;
      host.append(el('p','daily-message',n+' / '+steps.length+' étapes terminées'),btn(guided?'Voir toute la checklist':'Une étape à la fois',()=>{guided=!guided;drawSteps();}));
      const next=steps.find(s=>!done[s.id]);
      if(!next)host.append(btn("Confirmer la fin de la mission",async()=>{try{await mutate("complete",{id:current.id,version:current.version});d.close();}catch{}}));
      for(const step of steps.filter(s=>!guided||s===next)){
        const label=el('label','task'),input=el('input');input.type='checkbox';input.checked=!!done[step.id];input.disabled=pending||!navigator.onLine;
        const text=el('span','text',(step.time?step.time.replace(':',' h ')+' · ':'')+step.title);label.append(input,text);host.append(label);
        input.onchange=async()=>{input.disabled=true;try{await mutate('step',{id:current.id,version:current.version,stepId:step.id,done:input.checked});drawSteps();}catch(e){await refresh(true);drawSteps();}};
      }
    };d.append(host);drawSteps();
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
      selectedPerson = "";
      upgradeState = "idle";
      managing = false;
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
    if (shown) draw();
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
  for (const [id,label,handler] of [["showPersonal","Gérer",()=>{managing=true;toggle(true);}], ["showShared","Réglages",()=>$("parents").click()]]) {
    const original=$(id), button=original.cloneNode(false);button.textContent=label;original.replaceWith(button);button.onclick=handler;
  }
  $("settings").textContent="Apparence";
  document.querySelector(".version").textContent="Version 12.1 · missions et étapes";
  toggle(true);
})();
