// ==UserScript==
// @name         Shockwave Clicker
// @namespace    shockwave.discord
// @version      8.0.0
// @description  Discord-controlled remote clicker with two configurable targets.
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      YOUR_PUBLIC_HOST_DOMAIN
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  if (window.top !== window.self) return;

  // ==========================================================
  // CONFIG
  // IMPORTANT: replace these with the values from your .env.
  // ==========================================================

  var API = "https://YOUR_PUBLIC_HOST_URL/api/shockwave";
  var API_KEY = "CHANGE_ME_TO_THE_SAME_API_KEY_AS_YOUR_BOT";
  var POLL_MS = 500;

  var clientId = null;
  var lastId = 0;
  var polling = false;
  var armedDot = null;

  function saveDot(index, dot) {
    try {
      localStorage.setItem(
        "shockwave:dot" + index,
        JSON.stringify({
          x: dot.offsetLeft,
          y: dot.offsetTop
        })
      );
    } catch (e) {}
  }

  function setArmed(dot, on) {
    dot.style.boxShadow = on
      ? "0 0 0 3px #fff,0 0 14px 4px rgba(255,255,255,.9)"
      : "0 0 0 3px rgba(0,0,0,.15),0 2px 8px rgba(0,0,0,.4)";
  }

  function makeDot(index, color, defaultX) {
    var saved = {};

    try {
      saved = JSON.parse(
        localStorage.getItem("shockwave:dot" + index) || "{}"
      );
    } catch (e) {}

    var dot = document.createElement("div");

    dot.title =
      "Shockwave target " + index +
      " — click me, then click where it should go";

    dot.textContent = String(index);

    dot.style.cssText =
      "position:fixed;width:24px;height:24px;border-radius:50%;" +
      "background:" + color + ";" +
      "color:#fff;font:bold 12px/24px system-ui,sans-serif;" +
      "text-align:center;" +
      "box-shadow:0 0 0 3px rgba(0,0,0,.15),0 2px 8px rgba(0,0,0,.4);" +
      "cursor:pointer;z-index:2147483647;user-select:none;";

    dot.style.left =
      (saved.x != null ? saved.x : defaultX) + "px";

    dot.style.top =
      (saved.y != null ? saved.y : 200) + "px";

    document.documentElement.appendChild(dot);

    dot.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();

      if (armedDot === dot) {
        armedDot = null;
        setArmed(dot, false);
        return;
      }

      if (armedDot) setArmed(armedDot, false);

      armedDot = dot;
      setArmed(dot, true);
    }, true);

    return dot;
  }

  window.addEventListener("click", function (e) {
    if (!armedDot) return;
    if (e.target === armedDot) return;

    e.preventDefault();
    e.stopPropagation();

    var dot = armedDot;
    armedDot = null;
    setArmed(dot, false);

    dot.style.left =
      (e.clientX - dot.offsetWidth / 2) + "px";

    dot.style.top =
      (e.clientY - dot.offsetHeight / 2) + "px";

    var idx = Number(dot.textContent) === 2 ? 2 : 1;
    saveDot(idx, dot);
  }, true);

  var dots = {
    1: makeDot(1, "#ff3b30", 180),
    2: makeDot(2, "#2f7bff", 240)
  };

  var panel = document.createElement("div");

  panel.style.cssText =
    "position:fixed;right:16px;bottom:16px;background:#111;" +
    "color:#4ade80;font:12px/1.4 system-ui,sans-serif;" +
    "border-radius:999px;padding:6px 12px;z-index:2147483647;" +
    "box-shadow:0 6px 18px rgba(0,0,0,.4);";

  panel.textContent = "Shockwave: connecting…";
  document.documentElement.appendChild(panel);

  function setStatus(message, color) {
    panel.textContent = "Shockwave: " + message;
    panel.style.color = color;
  }

  function clickDot(index) {
    var dot = dots[index] || dots[1];

    var r = dot.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;

    dot.style.visibility = "hidden";
    var el = document.elementFromPoint(x, y);
    dot.style.visibility = "visible";

    if (!el) throw new Error("No element at target position");

    el.click();

    try {
      if (typeof dot.animate === "function") {
        dot.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.8)" },
            { transform: "scale(1)" }
          ],
          { duration: 250 }
        );
      }
    } catch (e) {}
  }

  function request(method, url, body, callback) {
    GM_xmlhttpRequest({
      method: method,
      url: url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
      },
      data: body ? JSON.stringify(body) : undefined,
      timeout: 8000,

      onload: function (r) {
        if (r.status < 200 || r.status >= 300) {
          callback(new Error("Server returned " + r.status));
          return;
        }

        try {
          callback(null, JSON.parse(r.responseText));
        } catch (e) {
          callback(new Error("Invalid JSON response"));
        }
      },

      onerror: function () {
        callback(new Error("Network error"));
      },

      ontimeout: function () {
        callback(new Error("Timeout"));
      }
    });
  }

  function register() {
    request("POST", API + "/register", {}, function (err, data) {
      if (err || !data || !data.clientId) {
        setStatus("offline", "#fb7185");
        setTimeout(register, 5000);
        return;
      }

      clientId = data.clientId;
      setStatus("connected", "#4ade80");
      poll();
    });
  }

  function acknowledge(commandId, success, reason) {
    request(
      "POST",
      API + "/ack",
      {
        clientId: clientId,
        commandId: commandId,
        success: success,
        reason: reason || null
      },
      function () {}
    );
  }

  function poll() {
    if (polling || !clientId) {
      setTimeout(poll, POLL_MS);
      return;
    }

    polling = true;

    request(
      "GET",
      API +
        "?clientId=" + encodeURIComponent(clientId) +
        "&after=" + encodeURIComponent(lastId) +
        "&t=" + Date.now(),
      null,
      function (err, data) {
        polling = false;

        if (err) {
          setStatus("offline", "#fb7185");
          setTimeout(poll, POLL_MS);
          return;
        }

        if (!data || !data.ok) {
          setStatus("bad response", "#fb7185");
          setTimeout(poll, POLL_MS);
          return;
        }

        if (!data.command) {
          setStatus("connected", "#4ade80");
          setTimeout(poll, POLL_MS);
          return;
        }

        var command = data.command;

        if (Number(command.id) <= Number(lastId)) {
          setTimeout(poll, POLL_MS);
          return;
        }

        lastId = Number(command.id);

        try {
          clickDot(Number(command.target) === 2 ? 2 : 1);

          setStatus("clicked dot " + command.target, "#4ade80");
          acknowledge(command.id, true, null);
        } catch (e) {
          var reason = e && e.message
            ? e.message
            : "Click failed";

          setStatus("click failed", "#fb7185");
          acknowledge(command.id, false, reason);
        }

        setTimeout(poll, POLL_MS);
      }
    );
  }

  register();
})();
