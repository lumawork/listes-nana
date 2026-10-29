"use strict";
(function () {
  let ctx = null,
    items = [],
    contacts = [],
    generation = 0,
    fetchSequence = 0,
    lastSignature = "",
    pendingPaint = false,
    showing = false,
    pendingOpen = null,
    loading = false;
  const busy = new Set(),
    chains = new Map();
  const host = $("sharedLists"),
    status = $("sharedStatus");
  const errorText = (e) => {
    const s = e?.message || String(e);
    for (const [key, value] of Object.entries({
      OWNER_REQUIRED:
        "Seuls les propriétaires peuvent modifier les rappels et les accès.",
      LAST_OWNER:
        "Ajoute un autre propriétaire avant de te retirer ou de passer en contribution.",
      CONTACT_NOT_ALLOWED:
        "Cette personne n’est pas disponible dans les contacts autorisés. Actualise la liste.",
      SHARED_ACCESS_DENIED:
        "Tu n’as plus accès à cette liste. Actualise les listes partagées.",
      SETTINGS_CONFLICT:
        "La liste a changé pendant la modification. Tes réglages n’ont pas écrasé les nouveaux changements. Ferme les réglages puis actualise avant de recommencer.",
      TASK_CONFLICT:
        "Cette tâche a déjà été modifiée. Actualise avant de la modifier à nouveau.",
      DAY_CHANGED:
        "Un nouveau jour a commencé. Actualise la liste puis refais cette action.",
      SYNC_CONFLICT:
        "Tes listes personnelles ont changé ailleurs. Résous la synchronisation dans Mon compte avant de partager.",
      SESSION_CHANGED:
        "Le compte connecté a changé. Actualise avant de recommencer.",
      PROFILE_REQUIRED: "Connecte-toi à ton compte pour partager des listes.",
      TASK_LIMIT: "Cette liste contient déjà 300 tâches.",
      TASK_MISSING: "Cette tâche n’existe plus. Actualise la liste.",
      REQUEST_REUSED:
        "Cet essai contient un autre contenu. Modifie le texte puis réessaie.",
      OWN_TASK_ONLY:
        "En contribution, tu peux modifier ou supprimer les tâches que tu as ajoutées.",
      LIST_LIMIT: "La limite de listes partagées est atteinte.",
    }))
      if (s.includes(key)) return value;
    return "Envoi non confirmé. Tes champs sont conservés : réessaie avec le même contenu pour éviter un doublon.";
  };
  function note(text) {
    status.textContent = text;
  }
  function editing() {
    return (
      !!document.activeElement?.closest?.("#sharedLists form") ||
      !!host.querySelector?.('form[data-dirty="true"]')
    );
  }
  function toggle(shared) {
    showing = shared;
    $("filters").hidden = shared;
    $("lists").hidden = shared;
    $("sharedArea").hidden = !shared;
    $("showPersonal").setAttribute("aria-pressed", String(!shared));
    $("showShared").setAttribute("aria-pressed", String(shared));
    if (shared) {
      draw();
      refresh();
    }
  }
  function setContext(next) {
    const identity = next?.session?.user?.id || null;
    if (identity !== ctx?.session?.user?.id) {
      generation++;
      items = [];
      contacts = [];
      lastSignature = "";
      pendingPaint = true;
      busy.clear();
      chains.clear();
      host.replaceChildren();
      $("sharedDashboard").replaceChildren();
      if ($("sharedStatsDialog").open) $("sharedStatsDialog").close();
      loading = false;
    }
    ctx = next?.profile && identity ? next : null;
    if (!ctx) {
      items = [];
      contacts = [];
      draw();
    } else if (pendingPaint || !lastSignature) refresh(true);
  }
  async function refresh(force = false) {
    if (!ctx) return;
    const epoch = generation,
      seq = ++fetchSequence;
    loading = true;
    try {
      const [next, directory] = await Promise.all([
        ctx.call("mm_shared_index"),
        ctx.call("mm_shared_contacts"),
      ]);
      if (epoch !== generation || seq !== fetchSequence) return;
      const signature = JSON.stringify(next);
      const removed = items.some((old) => !next.some((n) => n.id === old.id));
      items = next;
      contacts = directory;
      if (signature !== lastSignature) {
        pendingPaint = true;
        lastSignature = signature;
      }
      if (force || removed || (!editing() && pendingPaint)) {
        draw();
        pendingPaint = false;
      }
      note(
        pendingPaint && editing()
          ? "De nouvelles modifications sont disponibles. Ta saisie est conservée ; termine-la ou actualise."
          : "Synchronisé · " +
              new Date().toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              }) +
              " · actualisation automatique toutes les 10 secondes.",
      );
      if (pendingOpen) focusList();
    } catch (e) {
      if (epoch === generation)
        note(
          navigator.onLine === false
            ? "Hors connexion : les modifications partagées demandent Internet."
            : errorText(e),
        );
    } finally {
      if (epoch === generation) loading = false;
    }
  }
  function mark(form) {
    form.addEventListener?.("input", () => (form.dataset.dirty = "true"));
    form.addEventListener?.("change", () => (form.dataset.dirty = "true"));
  }
  function field(form, label, type = "text", value = "") {
    const l = el("label", null, label),
      i = el("input");
    i.type = type;
    i.value = value;
    l.append(i);
    form.append(l);
    return i;
  }
  function select(form, label, options, value) {
    const l = el("label", null, label),
      s = el("select");
    for (const [v, t] of options) {
      const o = el("option", null, t);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    l.append(s);
    form.append(l);
    return s;
  }
  function requestFor(form, data) {
    const fingerprint = JSON.stringify(data);
    if (form._fingerprint !== fingerprint) {
      form._fingerprint = fingerprint;
      form._request = uid();
    }
    return form._request;
  }
  async function apply(row, action, data = {}, request = uid()) {
    if (!ctx) throw Error("PROFILE_REQUIRED");
    if (navigator.onLine === false) throw Error("OFFLINE");
    const epoch = generation;
    const result = await ctx.call("mm_shared_apply", {
      p_id: row.id,
      p_action: action,
      p_data: data,
      p_request: request,
      p_day: row.list.day,
      p_actor: ctx.session.user.id,
    });
    if (epoch !== generation) return null;
    return result;
  }
  async function run(
    row,
    action,
    data = {},
    request = uid(),
    onError = null,
    form = null,
  ) {
    const epoch = generation;
    const previous = chains.get(row.id) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        if (epoch !== generation) return false;
        busy.add(row.id);
        try {
          await apply(row, action, data, request);
          if (epoch !== generation) return false;
          if (form) form.dataset.dirty = "false";
          await refresh(true);
          return true;
        } catch (e) {
          if (epoch === generation) {
            const message = errorText(e);
            note(message);
            toast(message);
            onError?.();
          }
          return false;
        } finally {
          if (epoch === generation) busy.delete(row.id);
        }
      });
    chains.set(row.id, operation);
    try {
      return await operation;
    } finally {
      if (chains.get(row.id) === operation) chains.delete(row.id);
    }
  }
  function formSnapshots() {
    const out = new Map();
    for (const form of host.querySelectorAll?.("form[data-shared-form]") ||
      []) {
      if (form.dataset.dirty !== "true") continue;
      const key =
        form.closest("[data-shared-id]")?.dataset.sharedId +
        "|" +
        form.dataset.sharedForm;
      out.set(key, {
        values: [...form.querySelectorAll("input,select,textarea")].map(
          (n) => ({ value: n.value, checked: n.checked }),
        ),
        request: form._request,
        fingerprint: form._fingerprint,
        taskId: form._taskId,
        text: form._text,
        time: form._time,
        baseRevision: form._baseRevision,
      });
    }
    return out;
  }
  function restoreForms(saved) {
    for (const form of host.querySelectorAll?.("form[data-shared-form]") ||
      []) {
      const key =
          form.closest("[data-shared-id]")?.dataset.sharedId +
          "|" +
          form.dataset.sharedForm,
        draft = saved.get(key);
      if (!draft) continue;
      [...form.querySelectorAll("input,select,textarea")].forEach((n, i) => {
        if (draft.values[i]) {
          n.value = draft.values[i].value;
          n.checked = draft.values[i].checked;
        }
      });
      Object.assign(form, {
        _request: draft.request,
        _fingerprint: draft.fingerprint,
        _taskId: draft.taskId,
        _text: draft.text,
        _time: draft.time,
        _baseRevision: draft.baseRevision,
      });
      form.dataset.dirty = "true";
      const details = form.closest("details");
      if (details) details.open = true;
    }
  }
  function exportList(row) {
    const payload = validate({
      version: 1,
      settings: structuredClone(state.settings),
      lists: [{ ...row.list, id: row.id }],
      history: row.history || [],
    });
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      ),
      a = el("a");
    a.href = url;
    a.download = "liste-partagee-" + row.id + "-" + dayKey() + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function configuration(row, card) {
    const l = row.list,
      d = el("details", "shared-config");
    d.append(el("summary", null, "Horaires, apparence et fréquence"));
    const form = el("form");
    form.dataset.sharedForm = "config";
    form._baseRevision = row.revision;
    mark(form);
    const title = field(form, "Nom de la liste", "text", l.title);
    title.required = true;
    title.maxLength = 100;
    const icon = field(form, "Symbole", "text", l.icon);
    icon.maxLength = 8;
    const theme = select(
      form,
      "Thème",
      [
        ["inherit", "Suivre mon thème général"],
        ["original", "Mode libre"],
        ...MissionThemes.map((t) => [t.id, t.name]),
      ],
      l.visualTheme || "inherit",
    );
    const color = field(form, "Couleur", "color", l.color);
    const noteField = field(form, "Note", "text", l.note);
    noteField.maxLength = 2000;
    const daysBox = el("fieldset");
    daysBox.append(el("legend", null, "Jours prévus"));
    const checks = [];
    [
      "Dimanche",
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
    ].forEach((name, n) => {
      const label = el("label", "day-choice"),
        check = el("input");
      check.type = "checkbox";
      check.checked = !l.activeDays || l.activeDays.includes(n);
      checks.push(check);
      label.append(check, document.createTextNode(name));
      daysBox.append(label);
    });
    form.append(daysBox);
    const mode = select(
        form,
        "Recommencer la liste",
        [
          ["daily", "Chaque jour"],
          ["weekly", "Chaque lundi"],
          ["manual", "Manuellement"],
        ],
        l.resetMode,
      ),
      pause = field(
        form,
        "Pause jusqu’au (inclus)",
        "date",
        l.pausedUntil || "",
      );
    const enabled = select(
        form,
        "Rappels aux propriétaires",
        [
          ["yes", "Activés"],
          ["no", "Désactivés"],
        ],
        l.reminder?.enabled ? "yes" : "no",
      ),
      time = field(
        form,
        "Heure commune du rappel",
        "time",
        l.reminder?.time || "08:00",
      ),
      follow = select(
        form,
        "Relance douce",
        [
          ["yes", "Oui"],
          ["no", "Non"],
        ],
        l.reminder?.followup === false ? "no" : "yes",
      ),
      delay = select(
        form,
        "Délai de relance",
        [
          ["5", "5 minutes"],
          ["10", "10 minutes"],
          ["15", "15 minutes"],
          ["30", "30 minutes"],
          ["60", "1 heure"],
        ],
        String(l.reminder?.delay || 15),
      );
    time.required = true;
    form.append(
      el(
        "p",
        "small",
        "Un même horaire pour tous les propriétaires, à l’heure de Paris. Les contributeurs ne reçoivent pas ces rappels.",
      ),
    );
    const submit = el("button", "primary", "Enregistrer les réglages");
    submit.type = "submit";
    form.append(submit);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {
        expected: form._baseRevision,
        title: title.value.trim(),
        icon: icon.value,
        note: noteField.value,
        color: color.value,
        visualTheme: theme.value,
        activeDays: checks.flatMap((c, n) => (c.checked ? [n] : [])),
        resetMode: mode.value,
        pausedUntil: pause.value,
        reminder: {
          enabled: enabled.value === "yes",
          time: time.value,
          followup: follow.value === "yes",
          delay: Number(delay.value),
          timezone: "Europe/Paris",
        },
      };
      submit.disabled = true;
      form.inert = true;
      try {
        await run(row, "config", data, requestFor(form, data), null, form);
      } finally {
        submit.disabled = false;
        form.inert = false;
      }
    };
    d.append(form);
    card.append(d);
  }
  function participants(row, card) {
    const details = el("details", "shared-members");
    details.append(
      el("summary", null, "Participants et destinataires des rappels"),
    );
    const list = el("div");
    for (const m of row.members) {
      const line = el("div", "shared-member"),
        label = el(
          "span",
          null,
          m.name +
            (m.self ? " · moi" : "") +
            (m.pending ? " · compte à activer" : ""),
        );
      line.append(label);
      if (row.role === "owner") {
        const s = el("select");
        for (const [v, text] of [
          ["owner", "Propriétaire · reçoit les rappels"],
          ["contributor", "Contribution · sans rappel"],
          ["remove", "Retirer l’accès"],
        ]) {
          const o = el("option", null, text);
          o.value = v;
          s.append(o);
        }
        s.value = m.role;
        s.setAttribute("aria-label", "Rôle de " + m.name);
        s.onchange = async () => {
          const newrole = s.value;
          if (
            m.self &&
            newrole !== "owner" &&
            !confirm(
              "En quittant le rôle propriétaire, tu ne recevras plus les rappels de cette liste et tu ne pourras plus gérer ses réglages. Continuer ?",
            )
          ) {
            s.value = m.role;
            return;
          }
          s.disabled = true;
          try {
            await run(
              row,
              "role",
              { target: m.target, role: newrole },
              uid(),
              () => (s.value = m.role),
            );
          } finally {
            s.disabled = false;
          }
        };
        line.append(s);
      } else
        line.append(
          el(
            "span",
            "small",
            m.role === "owner"
              ? "Propriétaire · rappels"
              : "Contribution · sans rappel",
          ),
        );
      list.append(line);
    }
    details.append(list);
    if (row.role === "owner") {
      const available = contacts.filter(
        (c) => !row.members.some((m) => m.target === c.target),
      );
      if (available.length) {
        const form = el("form");
        form.dataset.sharedForm = "member";
        mark(form);
        const who = select(
            form,
            "Ajouter une personne",
            available.map((c) => [
              c.target,
              c.name + (c.pending ? " · compte à activer" : ""),
            ]),
            available[0].target,
          ),
          role = select(
            form,
            "Rôle",
            [
              ["contributor", "Contribution · sans rappel"],
              ["owner", "Propriétaire · reçoit les rappels"],
            ],
            "contributor",
          ),
          b = el("button", null, "Ajouter à la liste");
        b.type = "submit";
        form.append(b);
        form.onsubmit = async (e) => {
          e.preventDefault();
          b.disabled = true;
          try {
            const data = { target: who.value, role: role.value };
            await run(row, "role", data, requestFor(form, data), null, form);
          } finally {
            b.disabled = false;
          }
        };
        details.append(form);
      } else
        details.append(
          el(
            "p",
            "small",
            "Toutes les personnes disponibles sont déjà dans la liste. Les profils doivent appartenir à votre famille.",
          ),
        );
    }
    details.append(
      el(
        "p",
        "small",
        "La liste est commune : une tâche cochée est faite pour tous. Un propriétaire en attente recevra les rappels après activation de son compte et de ses notifications.",
      ),
    );
    card.append(details);
  }
  function draw() {
    const drafts = formSnapshots();
    host.replaceChildren();
    if (!ctx) {
      host.append(
        el(
          "section",
          "empty",
          "Connecte-toi dans Mon compte pour créer ou retrouver tes listes partagées.",
        ),
      );
      return;
    }
    if (!items.length)
      host.append(
        el(
          "section",
          "empty",
          "Aucune liste partagée pour le moment. Crée-en une ici, ou utilise « Partager cette liste » sur une liste personnelle.",
        ),
      );
    for (const row of items) {
      const l = row.list,
        card = el("section", "card theme-scope shared-card");
      card.dataset.sharedId = row.id;
      styleCard(card, l);
      const art = makeArt(listTheme(l, state.settings));
      if (art) card.append(art);
      const head = el("div", "cardhead"),
        titles = el("div");
      titles.append(
        el("h2", null, l.title),
        el(
          "p",
          "subtitle",
          (row.role === "owner"
            ? "Propriétaire · rappels activables"
            : "Contribution · aucun rappel") +
            " · " +
            row.members.length +
            " participant" +
            (row.members.length > 1 ? "s" : ""),
        ),
      );
      head.append(el("span", "icon", l.icon), titles);
      card.append(head);
      const done = l.tasks.filter((t) => t.done).length,
        progress = el("div", "progress"),
        bar = el("div", "bar");
      bar.style.width =
        (l.tasks.length ? (done / l.tasks.length) * 100 : 0) + "%";
      progress.append(bar);
      card.append(
        progress,
        el(
          "p",
          "small",
          done + " / " + l.tasks.length + " tâches faites pour tous",
        ),
      );
      const level = progressLevel(l);
      if (level) {
        const feedback = structuredClone(l);
        feedback.messagePersona = state.settings.messageStyle || "child";
        card.append(
          el("p", "encouragement level-" + level, messageFor(feedback, level)),
        );
      }
      if (l.pausedUntil && l.pausedUntil >= l.day)
        card.append(
          el(
            "p",
            "small",
            "Liste en pause jusqu’au " +
              new Date(l.pausedUntil + "T12:00:00").toLocaleDateString(
                "fr-FR",
              ) +
              " inclus.",
          ),
        );
      for (const t of l.tasks) {
        const label = el("label", "task"),
          check = el("input");
        check.type = "checkbox";
        check.checked = t.done;
        check.onchange = async () => {
          check.disabled = true;
          try {
            await run(
              row,
              "check",
              { id: t.id, done: check.checked },
              uid(),
              () => (check.checked = t.done),
            );
          } finally {
            check.disabled = false;
          }
        };
        const text = el("span", "text");
        if (t.time) text.append(el("span", "time", t.time.replace(":", " h ")));
        text.append(document.createTextNode(t.text));
        label.append(check, text);
        card.append(label);
        if (row.role === "owner" || t.addedBy === ctx.session.user.id) {
          const tools = el("div", "shared-task-tools");
          tools.append(
            btn("Modifier", async () => {
              const newText = prompt("Texte de la tâche", t.text);
              if (newText === null) return;
              const time = prompt(
                "Horaire facultatif (HH:MM), ou vide",
                t.time,
              );
              if (time === null) return;
              await run(row, "edit", {
                id: t.id,
                previous: t.text,
                text: newText.trim(),
                time,
              });
            }),
            btn("Supprimer", () => {
              if (confirm("Supprimer cette tâche pour tous les participants ?"))
                run(row, "delete_task", { id: t.id, previous: t.text });
            }),
          );
          card.append(tools);
        }
      }
      const add = el("form", "shared-add");
      add.dataset.sharedForm = "add";
      mark(add);
      const text = field(add, "Ajouter une tâche", "text"),
        time = field(add, "Horaire facultatif de la tâche", "time");
      text.required = true;
      text.maxLength = 500;
      add.append(
        el(
          "p",
          "small",
          "L’horaire de la tâche est indicatif. Les notifications suivent l’horaire commun réglé pour la liste.",
        ),
      );
      const b = el("button", "primary", "Ajouter pour tout le monde");
      b.type = "submit";
      add.append(b);
      add.onsubmit = async (e) => {
        e.preventDefault();
        if (!add._taskId) add._taskId = uid();
        const data = {
          id: add._taskId,
          text: text.value.trim(),
          time: time.value,
        };
        if (add._text !== data.text || add._time !== data.time) {
          if (add._text !== undefined) add._taskId = uid();
          data.id = add._taskId;
          add._text = data.text;
          add._time = data.time;
        }
        b.disabled = true;
        add.inert = true;
        try {
          await run(row, "add", data, requestFor(add, data), null, add);
        } finally {
          b.disabled = false;
          add.inert = false;
        }
      };
      card.append(add);
      if (l.note) card.append(el("p", "note", l.note));
      participants(row, card);
      if (row.role === "owner") configuration(row, card);
      const actions = el("div", "cardactions");
      actions.append(
        btn("Historique et statistiques", () => {
          $("sharedStatsTitle").textContent = l.title + " · historique partagé";
          renderDashboard(
            { lists: [l], history: row.history || [] },
            $("sharedDashboard"),
          );
          $("sharedStatsDialog").showModal();
        }),
      );
      actions.append(btn("Exporter cette liste", () => exportList(row)));
      if (row.role === "owner") {
        if (l.reminder?.enabled)
          actions.append(btn("Rappeler dans 15 min", () => run(row, "snooze")));
        actions.append(
          btn("Tout décocher pour tous", () => {
            if (confirm("Recommencer cette liste pour tous les participants ?"))
              run(row, "reset");
          }),
          btn("Supprimer la liste partagée", () => {
            if (
              confirm(
                "Supprimer cette liste pour tous les participants ? Exporte-la d’abord si tu veux la garder.",
              )
            )
              run(row, "archive");
          }),
        );
      }
      actions.append(
        btn("Quitter cette liste", () => {
          if (confirm("Quitter cette liste et ne plus recevoir ses rappels ?"))
            run(row, "leave");
        }),
      );
      card.append(actions);
      host.append(card);
    }
    restoreForms(drafts);
  }
  async function create() {
    if (!ctx) {
      $("parents").click();
      toast("Connecte-toi à ton compte pour créer une liste partagée.");
      return;
    }
    const title = prompt("Nom de la nouvelle liste partagée", "Notre liste");
    if (!title?.trim()) return;
    const l = {
      id: uid(),
      title: title.trim(),
      icon: "✨",
      group: "Maison",
      note: "",
      color: state.settings.accent,
      visualTheme: "inherit",
      weekly: false,
      resetMode: "daily",
      day: dayKey(),
      week: weekKey(),
      tasks: [],
      reminder: {
        enabled: false,
        time: "08:00",
        followup: true,
        delay: 15,
        timezone: "Europe/Paris",
      },
    };
    try {
      const id = await ctx.call("mm_shared_create", {
        p_list: l,
        p_source: null,
        p_expected: null,
        p_request: uid(),
        p_actor: ctx.session.user.id,
      });
      pendingOpen = id;
      await refresh(true);
    } catch (e) {
      note(errorText(e));
      toast(errorText(e));
    }
  }
  async function sharePrivate(id) {
    if (!ctx) {
      $("parents").click();
      toast("Connecte-toi à ton compte avant de partager cette liste.");
      return;
    }
    if (
      !confirm(
        "Déplacer cette liste dans les listes partagées ? Tu choisiras ensuite les participants et les propriétaires. Ses tâches et coches sont conservées.",
      )
    )
      return;
    const key = "mm-shared-convert-" + ctx.session.user.id + "-" + id;
    let request = localStorage.getItem(key);
    if (!request) {
      request = uid();
      localStorage.setItem(key, request);
    }
    try {
      const sharedId = await ctx.shareSource(id, request);
      localStorage.removeItem(key);
      pendingOpen = sharedId;
      toggle(true);
      await refresh(true);
    } catch (e) {
      note(errorText(e));
      toast(errorText(e));
    }
  }
  function focusList() {
    if (!showing) toggle(true);
    const id = pendingOpen;
    const card = [...(host.querySelectorAll?.("[data-shared-id]") || [])].find(
      (n) => n.dataset.sharedId === id,
    );
    if (card) {
      card.scrollIntoView?.({ behavior: "smooth", block: "start" });
      pendingOpen = null;
    }
  }
  function openList(id) {
    pendingOpen = id;
    toggle(true);
    if (ctx) refresh(true);
  }
  function repaint() {
    if (showing && !editing()) draw();
  }
  $("showPersonal").onclick = () => toggle(false);
  $("showShared").onclick = () => toggle(true);
  $("newShared").onclick = create;
  $("refreshShared").onclick = () => {
    if (
      editing() &&
      !confirm("Actualiser les listes ? Les champs en cours seront conservés.")
    )
      return;
    refresh(true);
  };
  globalThis.MissionsShared = {
    setContext,
    refresh,
    toggle,
    repaint,
    sharePrivate,
    openList,
  };
  setInterval(() => {
    if (showing && !document.hidden && !busy.size) refresh();
  }, 10000);
  window.addEventListener("online", () => {
    if (showing) refresh(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && showing) refresh();
  });
})();
