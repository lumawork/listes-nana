"use strict";
(function () {
  let context = null,
    editedReminder = {};
  const supported = () =>
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  function fill(l) {
    const r = l.reminder || {};
    editedReminder = r;
    $("reminderEnabled").checked = !!r.enabled;
    $("reminderTime").value = r.time || "08:00";
    $("reminderFollowup").checked = r.followup !== false;
    $("reminderDelay").value = String(r.delay || 15);
  }
  function read() {
    return {
      ...(editedReminder.snoozeUntil
        ? {
            snoozeUntil: editedReminder.snoozeUntil,
            snoozeDay: editedReminder.snoozeDay,
          }
        : {}),
      enabled: $("reminderEnabled").checked,
      time: $("reminderTime").value || "08:00",
      followup: $("reminderFollowup").checked,
      delay: Number($("reminderDelay").value),
      timezone: "Europe/Paris",
    };
  }
  function bytes(s) {
    return Uint8Array.from(
      atob(
        s.replace(/-/g, "+").replace(/_/g, "/") +
          "=".repeat((4 - (s.length % 4)) % 4),
      ),
      (c) => c.charCodeAt(0),
    );
  }
  async function registration() {
    return navigator.serviceWorker.ready;
  }
  async function subscription() {
    return (await registration()).pushManager.getSubscription();
  }
  async function disable() {
    if (!supported()) return;
    const sub = await subscription();
    if (sub) {
      await context.call("mm_push_unsubscribe", { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  }
  function panel(host, ctx) {
    context = ctx;
    if (!ctx.child || !ctx.ready) return;
    const box = el("section", "reminder-phone");
    box.append(el("h3", null, "🔔 Rappels sur ce téléphone"));
    host.append(box);
    const status = el(
      "p",
      "small",
      "Choisis les horaires dans Modifier → Rappels de chaque liste. Les jours suivent les jours prévus pour la liste.",
    );
    status.setAttribute("role", "status");
    box.append(status);
    if (!supported()) {
      status.textContent =
        "Notifications indisponibles ici. Ouvre cette application dans Chrome sur ton téléphone Android.";
      return;
    }
    const runAction = async (fn, b) => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        status.textContent = e?.message?.includes("TEST_RATE_LIMIT")
          ? "Attends une minute avant un nouveau test."
          : e?.message?.includes("PUSH_NOT_READY")
            ? "Le service de rappels est en préparation. Réessaie dans une minute."
            : "Action impossible. Vérifie Internet, ta connexion à ton compte et les autorisations de Chrome.";
      } finally {
        b.disabled = false;
      }
    };
    const enable = btn(
      "Activer les notifications",
      () =>
        runAction(async () => {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            status.textContent =
              "Notifications non autorisées. Tu peux modifier cette autorisation dans les paramètres du site dans Chrome.";
            return;
          }
          const key = await ctx.call("mm_push_public_key");
          if (!key) throw Error("PUSH_NOT_READY");
          const reg = await registration();
          let sub = await reg.pushManager.getSubscription();
          if (!sub)
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: bytes(key),
            });
          try {
            await ctx.call("mm_push_subscribe", {
              p_subscription: sub.toJSON(),
            });
          } catch (e) {
            if (!e?.message?.includes("DEVICE_ALREADY_LINKED")) throw e;
            await sub.unsubscribe();
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: bytes(key),
            });
            await ctx.call("mm_push_subscribe", {
              p_subscription: sub.toJSON(),
            });
          }
          status.textContent =
            "Notifications activées sur ce téléphone ✅ Tu peux maintenant envoyer un test.";
        }, enable),
      "primary",
    );
    const test = btn("Envoyer une notification test", () =>
      runAction(async () => {
        const sub = await subscription();
        if (!sub) {
          status.textContent =
            "Active d’abord les notifications sur ce téléphone.";
          return;
        }
        await ctx.call("mm_push_subscribe", { p_subscription: sub.toJSON() });
        await ctx.call("mm_push_test", { p_endpoint: sub.endpoint });
        status.textContent =
          "Test demandé : la notification arrivera normalement dans la minute.";
      }, test),
    );
    const off = btn("Désactiver sur ce téléphone", () =>
      runAction(async () => {
        await disable();
        status.textContent = "Notifications désactivées sur ce téléphone.";
      }, off),
    );
    box.append(
      enable,
      test,
      off,
      el(
        "p",
        "small",
        "Heures de Paris, heure d’été/hiver automatique. Une connexion Internet est nécessaire. Les réglages Android peuvent retarder les notifications. Une liste terminée et synchronisée ne reçoit plus de rappel.",
      ),
    );
  }
  function openList(id) {
    if (id.startsWith("shared:") && globalThis.MissionsShared) {
      MissionsShared.openList(id.slice(7));
      return;
    }
    const list = state.lists.find((l) => l.id === id);
    if (!list) return;
    filter = "Tout";
    render();
    const card = [...document.querySelectorAll("[data-list-id]")].find(
      (n) => n.dataset.listId === id,
    );
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.setAttribute("tabindex", "-1");
      card.focus({ preventScroll: true });
    }
  }
  const initial = new URL(location.href).searchParams.get("liste");
  if (initial) setTimeout(() => openList(initial), 0);
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (
        event.data?.type === "OPEN_LIST" &&
        typeof event.data.listId === "string"
      ) {
        const dialog = $("parentDialog");
        if (dialog.open) dialog.close();
        openList(event.data.listId);
      }
    });
  globalThis.MissionsReminders = { fill, read, panel, disable };
})();
