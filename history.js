/* Historique : dernier état déclaré de chaque journée, sans inventer les jours absents. */
(function (root) {
  function key(d) {
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
  }
  function start(date = new Date()) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - 29);
    return key(d);
  }
  function prune(history, date = new Date()) {
    const from = start(date),
      to = key(date);
    return (history || [])
      .filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  function capture(state, date = new Date()) {
    const today = key(date),
      record = {
        date: today,
        updatedAt: date.toISOString(),
        lists: state.lists.map((l) => ({
          id: l.id,
          title: l.title,
          group: l.group,
          resetMode: l.resetMode || "daily",
          scheduled:
            !root.MissionsDynamic?.isMigrated(l.id) &&
            (!l.activeDays || l.activeDays.includes(date.getDay())) &&
            !(l.pausedUntil && l.pausedUntil >= today),
          tasks: l.tasks.map((t) => ({
            id: t.id,
            text: t.text,
            time: t.time,
            done: t.done,
          })),
        })),
      };
    const history = prune(state.history, date),
      i = history.findIndex((r) => r.date === today);
    if (i < 0) history.push(record);
    else history[i] = record;
    state.history = history;
    return record;
  }
  function validate(history) {
    if (history === undefined) return [];
    if (!Array.isArray(history) || history.length > 31)
      throw Error("Historique invalide.");
    const dates = new Set(),
      str = (s, n) => typeof s === "string" && s.length <= n;
    for (const r of history) {
      if (
        !r ||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
        dates.has(r.date) ||
        !Number.isFinite(new Date(r.date + "T12:00:00").getTime()) ||
        key(new Date(r.date + "T12:00:00")) !== r.date ||
        !str(r.updatedAt, 40) ||
        !Number.isFinite(Date.parse(r.updatedAt)) ||
        !Array.isArray(r.lists) ||
        r.lists.length > 100
      )
        throw Error("Journée invalide.");
      dates.add(r.date);
      const ids = new Set();
      for (const l of r.lists) {
        if (
          !l ||
          !str(l.id, 100) ||
          ids.has(l.id) ||
          !str(l.title, 100) ||
          !str(l.group, 100) ||
          !["daily", "weekly", "manual"].includes(l.resetMode) ||
          typeof l.scheduled !== "boolean" ||
          !Array.isArray(l.tasks) ||
          l.tasks.length > 300
        )
          throw Error("Liste historique invalide.");
        ids.add(l.id);
        const tids = new Set();
        for (const t of l.tasks) {
          if (
            !t ||
            !str(t.id, 100) ||
            tids.has(t.id) ||
            !str(t.text, 500) ||
            !str(t.time, 5) ||
            typeof t.done !== "boolean"
          )
            throw Error("Tâche historique invalide.");
          tids.add(t.id);
        }
      }
    }
    return JSON.parse(JSON.stringify(history));
  }
  function rows(history, from, to, listId = "all") {
    const out = [],
      d = new Date(from + "T12:00:00");
    for (let i = 0; i < 30 && key(d) <= to; i++, d.setDate(d.getDate() + 1)) {
      const day = key(d),
        record = history.find((r) => r.date === day),
        lists = (record?.lists || []).filter(
          (l) => listId === "all" || l.id === listId,
        ),
        due = lists.filter((l) => l.scheduled),
        tasks = due.flatMap((l) => l.tasks),
        done = tasks.filter((t) => t.done).length;
      out.push({
        date: day,
        lists,
        done,
        total: tasks.length,
        percent: tasks.length ? Math.round((done / tasks.length) * 100) : null,
        status:
          !record || !lists.length
            ? "unknown"
            : !due.length
              ? "not_scheduled"
              : !tasks.length
                ? "empty"
                : "observed",
        updatedAt: record?.updatedAt || null,
      });
    }
    return out;
  }
  function summary(rows) {
    const observed = rows.filter((r) => r.status === "observed"),
      done = observed.reduce((n, r) => n + r.done, 0),
      total = observed.reduce((n, r) => n + r.total, 0);
    return {
      done,
      total,
      percent: total ? Math.round((done / total) * 100) : null,
      observed: observed.length,
      unknown: rows.filter((r) => r.status === "unknown").length,
      complete: observed.filter((r) => r.done === r.total).length,
    };
  }
  root.MissionsHistory = {
    key,
    start,
    prune,
    capture,
    validate,
    rows,
    summary,
  };
})(typeof module === "object" ? module.exports : globalThis);
