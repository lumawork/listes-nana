"use strict";
let dashboardSelection = {
  days: "30",
  list: "all",
  date: MissionsHistory.key(new Date()),
};
function renderDashboard(payload, target = $("dashboard")) {
  const box = target;
  box.replaceChildren();
  if (!payload) {
    box.append(el("p", "small", "Aucune donnée synchronisée pour le moment."));
    return;
  }
  const history = MissionsHistory.prune(payload.history || []),
    today = MissionsHistory.key(new Date()),
    earliest = MissionsHistory.start(new Date());
  const filters = el("div", "dashboard-filters"),
    period = el("select"),
    list = el("select"),
    day = el("input");
  for (const n of [7, 14, 30]) {
    const o = el("option", null, n + " derniers jours");
    o.value = String(n);
    period.append(o);
  }
  period.value = dashboardSelection.days;
  period.setAttribute("aria-label", "Période");
  const names = new Map();
  history.forEach((r) => r.lists.forEach((l) => names.set(l.id, l.title)));
  payload.lists.forEach((l) => names.set(l.id, l.title));
  const all = el("option", null, "Toutes les listes");
  all.value = "all";
  list.append(all);
  for (const [id, name] of names) {
    const o = el("option", null, name);
    o.value = id;
    list.append(o);
  }
  if (dashboardSelection.list !== "all" && !names.has(dashboardSelection.list))
    dashboardSelection.list = "all";
  list.value = dashboardSelection.list;
  list.setAttribute("aria-label", "Liste");
  day.type = "date";
  day.min = earliest;
  day.max = today;
  if (dashboardSelection.date < earliest || dashboardSelection.date > today)
    dashboardSelection.date = today;
  day.value = dashboardSelection.date;
  day.setAttribute("aria-label", "Jour à examiner");
  for (const [title, input] of [
    ["Période", period],
    ["Liste", list],
    ["Journée détaillée", day],
  ]) {
    const label = el("label", null, title);
    label.append(input);
    filters.append(label);
  }
  box.append(filters);
  period.onchange = () => {
    dashboardSelection.days = period.value;
    renderDashboard(payload, target);
  };
  list.onchange = () => {
    dashboardSelection.list = list.value;
    renderDashboard(payload, target);
  };
  day.onchange = () => {
    if (day.value >= earliest && day.value <= today) {
      dashboardSelection.date = day.value;
      renderDashboard(payload, target);
    }
  };
  const begin = new Date();
  begin.setHours(12, 0, 0, 0);
  begin.setDate(begin.getDate() - Number(period.value) + 1);
  const from = MissionsHistory.key(begin),
    rows = MissionsHistory.rows(history, from, today, list.value),
    summary = MissionsHistory.summary(rows);
  const stats = el("div", "dashboard-stats");
  for (const [value, title] of [
    [
      summary.percent === null ? "—" : summary.percent + " %",
      "Complétude des jours renseignés",
    ],
    [summary.done + " / " + summary.total, "Cases cochées sur la période"],
    [summary.complete + " / " + summary.observed, "Jours renseignés à 100 %"],
    [String(summary.unknown), "Jours sans données"],
  ]) {
    const card = el("div", "stat");
    card.append(el("strong", null, value), el("span", null, title));
    stats.append(card);
  }
  box.append(stats);
  box.append(
    el(
      "p",
      "small",
      "Le taux global est pondéré par le nombre de tâches. Les jours sans données et les listes non prévues sont exclus du calcul. Pour une liste hebdomadaire ou manuelle, il s’agit de l’état cumulé ce jour-là.",
    ),
  );
  box.append(el("h3", null, "Statistiques par liste"));
  const wrap = el("div", "table-wrap"),
    table = el("table");
  const head = el("tr");
  ["Liste", "Fait / prévu", "Complétude", "Jours à 100 %"].forEach((t) =>
    head.append(el("th", null, t)),
  );
  table.append(head);
  for (const [id, name] of names) {
    if (list.value !== "all" && list.value !== id) continue;
    const s = MissionsHistory.summary(
        MissionsHistory.rows(history, from, today, id),
      ),
      row = el("tr");
    row.append(
      el("td", null, name),
      el("td", null, s.done + " / " + s.total),
      el("td", null, s.percent === null ? "Sans données" : s.percent + " %"),
      el("td", null, s.complete + " / " + s.observed),
    );
    table.append(row);
  }
  wrap.append(table);
  box.append(wrap);
  if (list.value === "all" && names.size) {
    box.append(el("h3", null, "Vue croisée : chaque jour, chaque liste"));
    const matrixWrap = el("div", "table-wrap"),
      matrix = el("table", "completion-matrix"),
      header = el("tr");
    header.append(el("th", null, "Jour"));
    for (const name of names.values()) header.append(el("th", null, name));
    matrix.append(header);
    const perList = new Map(
      [...names.keys()].map((id) => [
        id,
        MissionsHistory.rows(history, from, today, id),
      ]),
    );
    for (let i = rows.length - 1; i >= 0; i--) {
      const tr = el("tr");
      tr.append(el("th", null, formatDay(rows[i].date)));
      for (const id of names.keys()) {
        const r = perList.get(id)[i],
          cell = el("td"),
          b = btn(
            r.percent === null
              ? r.status === "not_scheduled"
                ? "—"
                : r.status === "empty"
                  ? "Vide"
                  : "?"
              : r.percent + " %",
            () => {
              dashboardSelection.date = r.date;
              dashboardSelection.list = id;
              renderDashboard(payload, target);
            },
          );
        b.dataset.band =
          r.percent === null
            ? "unknown"
            : r.percent === 100
              ? "complete"
              : "partial";
        b.setAttribute(
          "aria-label",
          names.get(id) +
            " · " +
            formatDay(r.date) +
            " · " +
            (r.percent === null
              ? r.status === "not_scheduled"
                ? "non prévue"
                : "sans données"
              : r.percent + " %"),
        );
        cell.append(b);
        tr.append(cell);
      }
      matrix.append(tr);
    }
    matrixWrap.append(matrix);
    box.append(
      matrixWrap,
      el(
        "p",
        "small",
        "? : sans données · — : non prévue · Vide : aucune tâche. Touche un pourcentage pour voir le détail des tâches.",
      ),
    );
  }
  box.append(el("h3", null, "Jour par jour"));
  const dailyWrap = el("div", "table-wrap"),
    daily = el("table"),
    dh = el("tr");
  ["Jour", "Fait / prévu", "Complétude"].forEach((t) =>
    dh.append(el("th", null, t)),
  );
  daily.append(dh);
  for (const r of [...rows].reverse()) {
    const tr = el("tr"),
      dateCell = el("td"),
      b = btn(formatDay(r.date), () => {
        dashboardSelection.date = r.date;
        renderDashboard(payload, target);
      });
    dateCell.append(b);
    tr.append(
      dateCell,
      el("td", null, r.status === "observed" ? r.done + " / " + r.total : "—"),
    );
    const result = el("td");
    if (r.percent !== null) {
      const meter = el("progress");
      meter.max = 100;
      meter.value = r.percent;
      meter.setAttribute("aria-label", r.percent + " %");
      result.append(el("span", null, r.percent + " % "), meter);
    } else
      result.textContent = {
        unknown: "Sans données",
        not_scheduled: "Non prévue",
        empty: "Liste vide",
      }[r.status];
    tr.append(result);
    daily.append(tr);
  }
  dailyWrap.append(daily);
  box.append(dailyWrap);
  box.append(el("h3", null, "Détail du " + formatDay(dashboardSelection.date)));
  const record = history.find((r) => r.date === dashboardSelection.date),
    lists = (record?.lists || []).filter(
      (l) => list.value === "all" || l.id === list.value,
    );
  if (!lists.length)
    box.append(
      el(
        "p",
        "small",
        "Aucune observation enregistrée pour cette journée et cette sélection.",
      ),
    );
  for (const l of lists) {
    const section = el("section", "history-list"),
      done = l.tasks.filter((t) => t.done).length;
    section.append(
      el("h4", null, l.title),
      el(
        "p",
        "small",
        l.scheduled
          ? l.tasks.length
            ? done +
              " / " +
              l.tasks.length +
              " · " +
              Math.round((done / l.tasks.length) * 100) +
              " %"
            : "Liste vide"
          : "Liste non prévue ce jour-là",
      ),
    );
    for (const t of l.tasks) {
      const row = el("div", "history-task");
      row.append(
        el(
          "span",
          "task-status " + (t.done ? "done" : "pending"),
          t.done ? "Fait" : "Non coché",
        ),
        el("span", null, (t.time ? t.time + " · " : "") + t.text),
      );
      section.append(row);
    }
    box.append(section);
  }
  if (record)
    box.append(
      el(
        "p",
        "small",
        "Dernier état de cette journée enregistré le " +
          new Date(record.updatedAt).toLocaleString("fr-FR") +
          ".",
      ),
    );
}
function formatDay(s) {
  return new Date(s + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
