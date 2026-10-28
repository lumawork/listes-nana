/* Shared deterministic helpers for Mes Missions V11. No network or storage. */
(function (root) {
  "use strict";
  function day(value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  }
  function local(value) {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }
  function paris(value) {
    if (/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return new Date(value);
    const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
    if (!match) throw Error("INVALID_DUE");
    const numbers = match.slice(1).map(Number);
    const anchor = Date.UTC(
      numbers[0],
      numbers[1] - 1,
      numbers[2],
      numbers[3],
      numbers[4],
    );
    let time = anchor;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Paris",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(time)
          .filter((p) => p.type !== "literal")
          .map((p) => [p.type, Number(p.value)]),
      );
      const asUTC = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
      );
      time = anchor - (asUTC - time);
    }
    return new Date(time);
  }
  function counts(rows, now = Date.now()) {
    const c = {
      timely: 0,
      late: 0,
      skipped: 0,
      missing: 0,
      pending: 0,
      cancelled: 0,
      total: 0,
      reported: 0,
    };
    for (const o of rows) {
      if (o.spec?.paused) continue;
      if (o.status === "cancelled") {
        c.cancelled++;
        continue;
      }
      c.total++;
      if (o.due !== o.original_due) c.reported++;
      if (o.status === "done")
        c[
          Date.parse(o.completed) < Date.parse(o.original_end)
            ? "timely"
            : "late"
        ]++;
      else if (o.status === "skipped") c.skipped++;
      else c[Date.parse(o.original_end) <= now ? "missing" : "pending"]++;
    }
    c.completed = c.timely + c.late;
    c.percent = c.total ? Math.round((c.completed / c.total) * 100) : null;
    c.punctuality = c.completed
      ? Math.round((c.timely / c.completed) * 100)
      : null;
    return c;
  }
  function visible(rows, now = Date.now()) {
    return rows
      .filter(
        (o) =>
          o.status === "open" &&
          !o.spec?.paused &&
          (Date.parse(o.visible) <= now || Date.parse(o.ends) <= now),
      )
      .sort(
        (a, b) =>
          Number(Date.parse(b.ends) <= now) -
            Number(Date.parse(a.ends) <= now) ||
          Date.parse(a.due) - Date.parse(b.due) ||
          a.id.localeCompare(b.id),
      );
  }
  function quiet(time, start = "22:00", end = "07:00") {
    if (start === end) return false;
    return start < end
      ? time >= start && time < end
      : time >= start || time < end;
  }
  function validateTask(data) {
    if (!data.title?.trim() || data.title.trim().length > 500)
      throw Error("INVALID_TITLE");
    if (!["annabelle", "papa", "maman"].includes(data.person))
      throw Error("INVALID_PERSON");
    const s = data.spec;
    if (
      !s ||
      !["fixed", "relative", "once"].includes(s.mode) ||
      !["minutes", "hours", "days", "weeks"].includes(s.unit) ||
      !Number.isInteger(s.every) ||
      s.every < 1 ||
      s.every > 365
    )
      throw Error("INVALID_SCHEDULE");
    if (s.period && !["days", "weeks"].includes(s.unit))
      throw Error("PERIOD_REQUIRES_DAYS");
    if (!Number.isFinite(paris(s.firstDue).getTime()))
      throw Error("INVALID_DUE");
    for (const key of ["periodStart", "periodEnd", "reminderTime"])
      if (s[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s[key]))
        throw Error("INVALID_TIME");
    if (
      s.reminderDelay !== undefined &&
      ![5, 10, 15, 30, 60].includes(s.reminderDelay)
    )
      throw Error("INVALID_REMINDER");
    if (
      s.reminderCount !== undefined &&
      (!Number.isInteger(s.reminderCount) ||
        s.reminderCount < 0 ||
        s.reminderCount > 3)
    )
      throw Error("INVALID_REMINDER");
    return data;
  }
  function groupKey(o) {
    return o.person + ":" + (o.spec.ui?.listId || "general");
  }
  const API = {
    day,
    local,
    paris,
    counts,
    visible,
    quiet,
    validateTask,
    groupKey,
  };
  if (typeof module === "object") module.exports = API;
  else root.MissionsDynamicCore = API;
})(typeof globalThis === "object" ? globalThis : this);
