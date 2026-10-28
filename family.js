"use strict";
(function () {
  const CONFIG_KEY = "mm-family-config";
  let client = null,
    session = null,
    remote = null,
    ready = false,
    dirty = false,
    busy = false,
    conflict = false,
    errorText = "",
    invite = null,
    sequence = 0,
    timeout = null,
    selectedChild = null,
    view = "personal",
    authEpoch = 0,
    binding = null,
    internalAuth = false;
  const bindingKey = () => "mm-v9-binding-" + session.user.id;
  function writeBinding() {
    if (!session || !remote) return;
    binding = { userId: session.user.id, revision: remote.revision, dirty };
    localStorage.setItem(bindingKey(), JSON.stringify(binding));
  }
  function errorMessage(e) {
    const s = e?.message || String(e);
    if (s.includes("MIGRATED_LIST_READONLY"))
      return "Une liste a été reprise dans le moteur synchronisé. Sauvegarde les modifications locales puis actualise cet appareil.";
    if (s.includes("SYNC_CONFLICT"))
      return "Une autre session a modifié tes données. Sauvegarde tes modifications puis récupère la version synchronisée.";
    if (s.includes("INVALID_INVITE"))
      return "Code invalide, expiré ou déjà utilisé.";
    if (s.includes("ALREADY_MEMBER"))
      return "Ce compte possède déjà un profil.";
    if (s.includes("Invalid login credentials"))
      return "Identifiant ou mot de passe incorrect.";
    if (s.includes("CHILD_ACCESS_DENIED"))
      return "Seuls les enfants qui te sont rattachés sont consultables.";
    return "Action impossible pour le moment. Vérifie ta connexion Internet et réessaie.";
  }
  async function call(name, args = {}) {
    const result = await client.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  }
  function download(data, name) {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      ),
      a = el("a");
    a.href = url;
    a.download = name + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function empty(persona = "child") {
    const preset =
      persona === "dad"
        ? {
            universe: "tavern",
            accent: "#77502e",
            font: "serif",
            decor: "theme",
          }
        : persona === "mom"
          ? {
              universe: "cocoon",
              accent: "#956278",
              font: "serif",
              decor: "theme",
            }
          : {};
    return {
      version: 1,
      settings: {
        ...defaults,
        ...preset,
        messageStyle: persona,
        messageTone: "fun",
        nicknames: true,
      },
      lists: [],
      history: [],
    };
  }
  function notifyIdentity(id) {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.ready.then((r) =>
        r.active?.postMessage({ type: "SET_USER", userId: id }),
      );
  }
  function activate(data) {
    state = validate(data);
    filter = "Tout";
    document.querySelectorAll("dialog").forEach((d) => {
      if (d.id !== "parentDialog" && d.open) d.close();
    });
    render();
  }
  function queue() {
    if (!ready || !remote || !session || conflict) return;
    dirty = true;
    sequence++;
    writeBinding();
    clearTimeout(timeout);
    timeout = setTimeout(flush, 700);
  }
  async function flush() {
    if (!ready || !remote || !dirty || busy || conflict) return;
    busy = true;
    const generation = authEpoch,
      owner = session.user.id,
      sent = sequence;
    try {
      MissionsHistory.capture(state);
      const snapshot = structuredClone(state),
        revision = await call("mm_v9_write", {
          p_payload: snapshot,
          p_expected: remote.revision,
        });
      if (generation !== authEpoch || session?.user.id !== owner) return;
      remote = {
        ...remote,
        payload: snapshot,
        revision,
        updated_at: new Date().toISOString(),
      };
      dirty = sequence !== sent;
      errorText = "";
      writeBinding();
    } catch (e) {
      if (generation !== authEpoch) return;
      if (e?.message?.includes("SYNC_CONFLICT")) {
        conflict = true;
        ready = false;
      }
      errorText = errorMessage(e);
    } finally {
      busy = false;
      panel();
      if (dirty && !conflict && ready) {
        clearTimeout(timeout);
        timeout = setTimeout(flush, errorText ? 15000 : 700);
      }
    }
  }
  async function bootstrap(load = true) {
    const data = await call("mm_v9_bootstrap");
    remote = data;
    errorText = "";
    if (remote && globalThis.MissionsDynamic) {
      await MissionsDynamic.prepare(call, session, remote);
      await MissionsDynamic.linkPortal(session);
    }
    if (!remote) {
      ready = false;
      panel();
      return;
    }
    if (load) {
      authEpoch++;
      KEY = "mm-v9-user-" + session.user.id;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(KEY) || "null");
        binding = JSON.parse(localStorage.getItem(bindingKey()) || "null");
      } catch {}
      // V8 list data can only be adopted by its bound child account, never by an adult.
      if (!saved && remote.kind === "child") {
        try {
          const old = JSON.parse(
            localStorage.getItem("mm-family-binding") || "null",
          );
          if (old?.userId === session.user.id) {
            saved = JSON.parse(
              localStorage.getItem("mes-missions-v1") || "null",
            );
            binding = old;
          }
        } catch {}
      }
      ready = false;
      dirty = false;
      conflict = false;
      if (saved && binding?.userId === session.user.id) {
        activate(saved);
        if (binding.revision === remote.revision) {
          ready = true;
          dirty = !!binding.dirty;
        } else {
          conflict = true;
          errorText =
            "La version synchronisée a changé. Sauvegarde tes modifications locales avant de récupérer cette version.";
        }
      } else {
        activate(remote.payload || empty(remote.message_style));
        ready = true;
      }
      state.settings.messageStyle = remote.message_style;
      writeBinding();
      save();
    }
    notifyIdentity(session.user.id);
    $("profileLabel").textContent = remote.display_name;
    $("childrenNav").hidden = remote.kind !== "adult";
    panel();
  }
  async function useRemote() {
    const current = await call("mm_v9_bootstrap");
    if (!current) throw Error("PROFILE_REQUIRED");
    download(state, "mes-missions-avant-recuperation-" + dayKey());
    remote = current;
    ready = false;
    activate(current.payload || empty(current.message_style));
    state.settings.messageStyle = current.message_style;
    conflict = false;
    dirty = false;
    ready = true;
    writeBinding();
    save();
    panel();
  }
  async function run(fn) {
    try {
      errorText = "";
      await fn();
    } catch (e) {
      errorText = errorMessage(e);
    }
    panel();
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
  function selectField(form, label, options, value) {
    const l = el("label", null, label),
      s = el("select");
    for (const [v, text] of options) {
      const o = el("option", null, text);
      o.value = v;
      s.append(o);
    }
    s.value = value;
    l.append(s);
    form.append(l);
    return s;
  }
  function checkConfig(c) {
    const url = (c.url || "").trim().replace(/\/$/, ""),
      key = (c.publishableKey || "").trim();
    if (
      !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) ||
      key.startsWith("sb_secret_")
    )
      throw Error("BAD_CONFIG");
    if (!key.startsWith("sb_publishable_")) {
      try {
        if (
          JSON.parse(
            atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
          ).role !== "anon"
        )
          throw Error();
      } catch {
        throw Error("BAD_CONFIG");
      }
    }
    return { url, publishableKey: key };
  }
  async function connect(config) {
    const c = checkConfig(config);
    client = supabase.createClient(c.url, c.publishableKey, {
      global: {
        fetch: (url, init = {}) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const abort = () => controller.abort();
          if (init.signal?.aborted) abort();
          else init.signal?.addEventListener("abort", abort, { once: true });
          return fetch(url, { ...init, signal: controller.signal }).finally(
            () => {
              clearTimeout(timeout);
              init.signal?.removeEventListener("abort", abort);
            },
          );
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "mm-auth-" + new URL(c.url).hostname,
      },
    });
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    client.auth.onAuthStateChange((event, s) => {
      if (internalAuth || event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT" || (s && s.user.id !== session?.user.id)) {
        clearTimeout(timeout);
        authEpoch++;
        ready = false;
        dirty = false;
        conflict = false;
        remote = null;
        binding = null;
        invite = null;
        selectedChild = null;
        view = "personal";
        session = s || null;
        KEY = "mm-v9-guest";
        notifyIdentity("");
        activate(empty());
        $("profileLabel").textContent = "Mes missions";
        $("childrenNav").hidden = true;
        if (session)
          setTimeout(
            () =>
              run(async () => {
                await bootstrap();
                if (event === "PASSWORD_RECOVERY") {
                  view = "password";
                  panel();
                  if (!$("parentDialog").open) $("parentDialog").showModal();
                }
              }),
            0,
          );
        else panel();
      } else if (event === "PASSWORD_RECOVERY" && s) {
        session = s;
        setTimeout(() => {
          view = "password";
          panel();
          if (!$("parentDialog").open) $("parentDialog").showModal();
        }, 0);
      }
    });
    const result = await client.auth.getSession();
    session = result.data?.session || null;
    if (session) await bootstrap();
    else {
      notifyIdentity("");
      panel();
    }
  }
  async function signout() {
    await flush();
    if (dirty || busy || conflict) {
      toast(
        "Sauvegarde tes modifications puis résous la synchronisation avant de changer de compte.",
      );
      return;
    }
    if (globalThis.MissionsReminders) await MissionsReminders.disable();
    clearTimeout(timeout);
    ready = false;
    internalAuth = true;
    try {
      await client.auth.signOut({ scope: "local" });
    } finally {
      internalAuth = false;
    }
    if (globalThis.MissionsDynamic) MissionsDynamic.clear();
    localStorage.setItem("nm-auth-logout", String(Date.now()));
    notifyIdentity("");
    authEpoch++;
    session = null;
    remote = null;
    invite = null;
    selectedChild = null;
    binding = null;
    view = "personal";
    KEY = "mm-v9-guest";
    activate(empty());
    $("profileLabel").textContent = "Mes missions";
    $("childrenNav").hidden = true;
    panel();
  }
  async function shareSource(id, request) {
    await flush();
    if (!session || !remote || !ready || dirty || busy || conflict)
      throw Error("SYNC_CONFLICT");
    const epoch = authEpoch;
    const previousReady = ready;
    ready = false;
    document.body.inert = true;
    try {
      const sharedId = await call("mm_shared_create", {
        p_list: null,
        p_source: id,
        p_expected: remote.revision,
        p_request: request,
        p_actor: session.user.id,
      });
      if (epoch !== authEpoch) throw Error("PROFILE_REQUIRED");
      const fresh = await call("mm_v9_bootstrap");
      if (epoch !== authEpoch) throw Error("PROFILE_REQUIRED");
      remote = fresh;
      state = validate(fresh.payload || empty(fresh.message_style));
      state.settings.messageStyle = fresh.message_style;
      dirty = false;
      conflict = false;
      ready = true;
      writeBinding();
      save();
      render();
      return sharedId;
    } finally {
      document.body.inert = false;
      if (epoch === authEpoch && !conflict) ready = previousReady;
      panel();
    }
  }
  function panel() {
    if (globalThis.MissionsDynamic)
      MissionsDynamic.setContext({
        call,
        session,
        profile: remote,
        synchronize: async () => {
          await flush();
          if (dirty || busy || conflict) throw Error("SYNC_CONFLICT");
        },
        reload: async () => bootstrap(true),
      });
    if (globalThis.MissionsShared)
      MissionsShared.setContext({
        call,
        session,
        profile: remote,
        shareSource,
      });
    const host = $("familyPanel");
    host.replaceChildren();
    $("dashboard").replaceChildren();
    const box = el("div", "family-box");
    host.append(box);
    if (errorText) box.append(el("p", "sync-status", errorText));
    if (!client) {
      box.append(
        el(
          "p",
          "small",
          "La connexion du service familial n’est pas encore configurée.",
        ),
      );
      return;
    }
    if (!session) {
      box.append(
        el("h3", null, "Mon compte"),
        el(
          "p",
          "small",
          "Chaque personne se connecte avec son adresse personnelle. Les missions des adultes sont privées.",
        ),
      );
      const form = el("form"),
        email = field(form, "Adresse e-mail", "email"),
        pass = field(form, "Mot de passe", "password");
      email.required = pass.required = true;
      email.autocomplete = "username";
      pass.autocomplete = "current-password";
      const b = el("button", "primary", "Se connecter");
      b.type = "submit";
      form.append(b);
      form.onsubmit = (e) => {
        e.preventDefault();
        b.disabled = true;
        internalAuth = true;
        run(async () => {
          const r = await client.auth.signInWithPassword({
            email: email.value.trim(),
            password: pass.value,
          });
          pass.value = "";
          if (r.error) throw r.error;
          session = r.data.session;
          await bootstrap();
        }).finally(() => {
          b.disabled = false;
          internalAuth = false;
        });
      };
      box.append(form);
      const recovery = el("form"),
        address = field(
          recovery,
          "Première connexion ou mot de passe oublié : adresse e-mail",
          "email",
        );
      address.required = true;
      const reset = el("button", null, "Recevoir mon lien de connexion");
      reset.type = "submit";
      const status = el("p", "small");
      recovery.append(reset, status);
      recovery.onsubmit = async (e) => {
        e.preventDefault();
        reset.disabled = true;
        try {
          const target = new URL("./", location.href);
          target.searchParams.set("connexion", "1");
          const r = await client.auth.resetPasswordForEmail(
            address.value.trim(),
            { redirectTo: target.href },
          );
          if (r.error) throw r.error;
          status.textContent =
            "Si ce compte existe, un lien a été envoyé. Consulte aussi les courriers indésirables. Ouvre-le sur cet appareil.";
        } catch {
          status.textContent = "Envoi impossible. Réessaie dans une minute.";
        } finally {
          reset.disabled = false;
        }
      };
      box.append(recovery);
      const signup = el("details"),
        summary = el("summary", null, "Créer mon compte personnel");
      signup.append(
        summary,
        el(
          "p",
          "small",
          "Utilise ton adresse personnelle et choisis ton mot de passe. Le profil réservé sera activé après confirmation de l’adresse. Si l’envoi d’e-mail n’est pas configuré, le propriétaire du projet peut créer le compte dans Supabase → Authentication → Users.",
        ),
      );
      const sf = el("form"),
        se = field(sf, "Mon adresse personnelle", "email"),
        sp = field(sf, "Mon nouveau mot de passe", "password"),
        sb = el("button", null, "Créer mon compte"),
        ss = el("p", "small");
      se.required = sp.required = true;
      sp.minLength = 12;
      sp.autocomplete = "new-password";
      sb.type = "submit";
      sf.append(sb, ss);
      sf.onsubmit = async (e) => {
        e.preventDefault();
        sb.disabled = true;
        internalAuth = true;
        try {
          const r = await client.auth.signUp({
            email: se.value.trim(),
            password: sp.value,
            options: { emailRedirectTo: new URL("./", location.href).href },
          });
          sp.value = "";
          if (r.error) throw r.error;
          if (r.data.session) {
            session = r.data.session;
            await bootstrap();
          } else
            ss.textContent =
              "Consulte ta messagerie pour confirmer ton adresse, puis reviens te connecter. Si tu possèdes déjà un compte, utilise la connexion ou la récupération.";
        } catch {
          ss.textContent =
            "Inscription indisponible. Le propriétaire du projet peut créer ce compte dans Supabase → Authentication → Users.";
        } finally {
          sb.disabled = false;
          internalAuth = false;
        }
      };
      signup.append(sf);
      box.append(signup);
      return;
    }
    box.append(el("p", "small", "Connecté : " + session.user.email));
    if (view === "password") {
      const f = el("form"),
        p = field(
          f,
          "Choisir mon mot de passe (12 caractères minimum)",
          "password",
        );
      p.minLength = 12;
      p.required = true;
      p.autocomplete = "new-password";
      const b = el("button", "primary", "Enregistrer mon mot de passe");
      b.type = "submit";
      f.append(b);
      f.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          const r = await client.auth.updateUser({ password: p.value });
          p.value = "";
          if (r.error) throw r.error;
          view = "personal";
          await bootstrap();
          toast("Ton mot de passe est enregistré.");
        });
      };
      box.append(f);
      return;
    }
    if (!remote) {
      box.append(el("h3", null, "Créer mon profil"));
      const f = el("form"),
        name = field(f, "Mon prénom"),
        family = field(f, "Nouvel espace familial", "text", "Ma famille"),
        b = el("button", "primary", "Créer mon espace adulte");
      name.required = family.required = true;
      b.type = "submit";
      f.append(b);
      f.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await call("mm_v9_create_family", {
            p_name: family.value,
            p_display: name.value,
          });
          await bootstrap();
        });
      };
      box.append(f);
      const j = el("form"),
        jn = field(j, "Mon prénom"),
        code = field(j, "Code reçu de la famille"),
        jb = el("button", null, "Rejoindre avec ce code");
      jn.required = code.required = true;
      jb.type = "submit";
      j.append(jb);
      j.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await call("mm_v9_join", {
            p_token: code.value.trim(),
            p_name: jn.value,
          });
          await bootstrap();
        });
      };
      box.append(
        j,
        btn("Se déconnecter", () => run(signout)),
      );
      return;
    }
    const tabs = el("div", "family-actions");
    tabs.append(
      btn("Mes missions", () => {
        view = "personal";
        panel();
      }),
      btn("Mes statistiques", () => {
        view = "stats";
        panel();
      }),
    );
    if (remote.kind === "adult")
      tabs.append(
        btn("Suivi des enfants", () => {
          view = "children";
          panel();
        }),
      );
    box.append(el("h3", null, remote.display_name + " · " + remote.name), tabs);
    if (view === "children" && remote.kind === "adult") {
      box.append(
        el(
          "p",
          "small",
          "Tu consultes uniquement les enfants qui te sont rattachés. Leurs cases restent renseignées par eux. Les missions des adultes sont privées.",
        ),
      );
      const children = remote.children || [];
      if (!children.length)
        box.append(el("p", "small", "Aucun enfant rattaché pour le moment."));
      else {
        const select = selectField(
          box,
          "Enfant",
          children.map((c) => [c.user_id, c.display_name]),
          children.some((c) => c.user_id === selectedChild)
            ? selectedChild
            : children[0].user_id,
        );
        selectedChild = select.value;
        select.onchange = () => {
          selectedChild = select.value;
          dashboardSelection = { days: "30", list: "all", date: dayKey() };
          panel();
        };
        const requested = selectedChild,
          epoch = authEpoch;
        call("mm_v9_read_child", { p_child: requested })
          .then((r) => {
            if (
              epoch === authEpoch &&
              view === "children" &&
              selectedChild === requested
            ) {
              renderDashboard(r?.payload ? validate(r.payload) : null);
            }
          })
          .catch((e) => {
            if (epoch === authEpoch) toast(errorMessage(e));
          });
      }
      box.append(
        btn("Ajouter un enfant", () =>
          run(async () => {
            invite = {
              kind: "enfant",
              code: await call("mm_v9_invite", { p_kind: "child" }),
            };
          }),
        ),
        btn("Inviter un adulte et lui donner accès à mes enfants", () =>
          run(async () => {
            invite = {
              kind: "adulte",
              code: await call("mm_v9_invite", { p_kind: "adult" }),
            };
          }),
        ),
        btn("Annuler mes invitations en attente", () =>
          run(async () => {
            await call("mm_v9_revoke_invites");
            invite = null;
          }),
        ),
      );
      if (invite)
        box.append(
          el(
            "p",
            "small",
            "Code " +
              invite.kind +
              " · valable 24 heures, à usage unique. Transmets-le en privé.",
          ),
          el("p", "invite-code", invite.code),
        );
    } else if (view === "stats") {
      box.append(
        el(
          "p",
          "small",
          "Tes statistiques personnelles sur 30 jours. Aucun classement familial.",
        ),
      );
      renderDashboard(state);
    } else {
      box.append(
        el(
          "p",
          "sync-status",
          conflict
            ? "Synchronisation suspendue."
            : busy
              ? "Envoi en cours…"
              : dirty
                ? "Modifications à envoyer."
                : remote.updated_at
                  ? "Synchronisé le " +
                    new Date(remote.updated_at).toLocaleString("fr-FR")
                  : "Ton espace personnel est prêt.",
        ),
      );
      box.append(
        btn("Ouvrir mes missions", () => $("parentDialog").close(), "primary"),
        btn("Synchroniser maintenant", () => {
          queue();
          run(flush);
        }),
      );
      if (conflict)
        box.append(
          btn(
            "Sauvegarder ici puis récupérer la version synchronisée",
            () => run(useRemote),
            "primary",
          ),
        );
      if (
        remote.kind === "child" &&
        !state.lists.length &&
        localStorage.getItem("mes-missions-v1")
      )
        box.append(
          btn(
            "Reprendre mes listes de l’ancienne version sur cet appareil",
            () =>
              run(async () => {
                const old = validate(
                  JSON.parse(localStorage.getItem("mes-missions-v1")),
                );
                activate(old);
                state.settings.messageStyle = remote.message_style;
                ready = true;
                save();
                await flush();
              }),
          ),
        );
      const pref = el("form"),
        name = field(pref, "Mon prénom", "text", remote.display_name),
        style = selectField(
          pref,
          "Mon univers de messages",
          [
            ["child", "Licornes et bonne humeur"],
            ["dad", "Aventures et jeu de rôle"],
            ["mom", "Douceur et humour"],
          ],
          remote.message_style,
        ),
        tone = selectField(
          pref,
          "Ton des messages",
          [
            ["fun", "Fun et drôle"],
            ["soft", "Doux et encourageant"],
            ["discreet", "Discret"],
          ],
          state.settings.messageTone || "fun",
        ),
        nick = selectField(
          pref,
          "Surnoms affectueux dans les rappels",
          [
            ["yes", "Oui"],
            ["no", "Non"],
          ],
          state.settings.nicknames === false ? "no" : "yes",
        ),
        pb = el("button", null, "Enregistrer mes préférences");
      name.required = true;
      name.maxLength = 80;
      pb.type = "submit";
      pref.append(pb);
      pref.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await call("mm_v9_preferences", {
            p_name: name.value,
            p_style: style.value,
          });
          remote.display_name = name.value;
          remote.message_style = style.value;
          state.settings.messageStyle = style.value;
          state.settings.messageTone = tone.value;
          state.settings.nicknames = nick.value === "yes";
          $("profileLabel").textContent = name.value;
          save();
          render();
        });
      };
      box.append(pref);
      if (globalThis.MissionsReminders)
        MissionsReminders.panel(box, { call, child: true, ready });
      box.append(
        btn("Changer mon mot de passe", () => {
          view = "password";
          panel();
        }),
        btn("Effacer uniquement mes missions et mon historique", () =>
          run(async () => {
            if (
              !confirm(
                "Effacer tes missions et ton historique personnel, sur le serveur et cet appareil ? Les autres profils sont conservés. Exporte d’abord si nécessaire.",
              )
            )
              return;
            ready = false;
            await call("mm_v9_erase");
            if (globalThis.MissionsReminders) await MissionsReminders.disable();
            localStorage.removeItem(KEY);
            localStorage.removeItem(bindingKey());
            binding = null;
            await bootstrap();
            toast("Tes données personnelles ont été effacées.");
          }),
        ),
      );
    }
    box.append(
      btn("Actualiser", () => run(() => bootstrap(false))),
      btn("Se déconnecter / changer de compte", () => run(signout)),
    );
  }
  $("parents").onclick = () => {
    view = "personal";
    panel();
    $("parentDialog").showModal();
  };
  $("childrenNav").onclick = () => {
    view = "children";
    panel();
    $("parentDialog").showModal();
  };
  globalThis.MissionsFamily = { queue, flush, call };
  window.addEventListener("storage", (e) => {
    if (e.key === "nm-auth-logout") {
      clearTimeout(timeout);
      ready = false;
      dirty = false;
      conflict = false;
      authEpoch++;
      notifyIdentity("");
      remote = null;
      session = null;
      client?.auth.signOut({ scope: "local" }).catch(() => {});
      KEY = "mm-v9-guest";
      activate(empty());
      panel();
    }
  });
  let config = window.MISSIONS_CONFIG;
  try {
    if (!config?.url)
      config = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
  } catch {}
  if (config?.url) run(() => connect(config));
  setInterval(async () => {
    if (!client || !session || document.hidden) return;
    if (dirty && !conflict) await flush();
    if ($("parentDialog").open && view === "children")
      run(() => bootstrap(false));
  }, 20000);
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.addEventListener("controllerchange", () =>
      notifyIdentity(session?.user.id || ""),
    );
  window.addEventListener("online", () => {
    if (dirty && !conflict) flush();
  });
})();
