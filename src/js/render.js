/*
 * render.js: the page's sections, POD.ui (docs/ui-contract.md §2 and §5).
 *
 * render(ctx) turns S, D and the page-only view flags into HTML strings and patches #app. ctx = { S, D,
 * opts, view, now }; view = { moreStores, geoError, loading, canLocate, mcError } is owned by app.js.
 * The builders read only their arguments. The one module variable is the last "Near you" rows, so
 * data-store="{i}" maps back to a store for POD.state.pickStore.
 *
 * Patching (ui-contract §2): each section is built with a fixed number of top-level blocks (an empty
 * block is <div></div>), so a block that didn't change keeps its element and a click in flight on one
 * of its buttons still lands. Nothing here touches the DOM at load time.
 */
(function (root) {
  "use strict";

  var POD = root.POD;

  var APPS = ["dd", "ue", "gh"];
  var APP_LONG = { dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub" };
  var MEMBER = { dd: "DashPass", ue: "Uber One", gh: "Grubhub+" };
  var SHARED = ["regFee", "smallMin", "smallFee"];
  var SHOWN_NEAR = 15;
  var FRIENDLY = {
    rest: "a restaurant", tax: "your ZIP or address",
    fuel: "your car", mpg: "your car", gas: "your car", miPerKwh: "your car", kwh: "your car",
    miles: "the trip distance", minutes: "the trip distance",
    manualSubtotal: "your order's menu total", tipDel: "the delivery tip", tipPick: "the pickup tip",
    wear: "wear per mile", hourly: "the value of your time"
  };
  var FIELD_LABEL = {
    delFee: "Delivery fee ($)", svc: "Service fee (%)", svcMin: "Minimum service fee ($)",
    memberSvc: "Service fee with membership (%)", memberMin: "Order minimum for membership benefits ($)",
    pickDisc: "Pickup discount (%)", markup: "Menu markup (%)", regFee: "Regulatory fee ($, 0 if none)",
    smallMin: "Small-order fee applies under ($)", smallFee: "Small-order fee ($, 0 if none)"
  };
  var APP_FIELDS = ["delFee", "svc", "svcMin", "memberSvc", "memberMin", "pickDisc"];
  var FUELS = [["regular", "Regular"], ["premium", "Premium"], ["diesel", "Diesel"], ["ev", "Electric"]];
  var CADENCES = [["once", "Once"], ["monthly", "Monthly"], ["quarterly", "Quarterly"],
    ["semiannual", "Every six months"], ["annual", "Yearly"]];
  var PROMO_TYPES = [["none", "No promo"], ["percent", "% off"], ["dollar", "$ off"], ["freedel", "Free delivery"],
    ["bogo", "Buy one, get one free"]];
  var NOTE_DD = "DoorDash publishes 15% service (5% with DashPass, on orders of $12 or more) for markets not yet on its newer fee model; check your own checkout.";

  var nearRows = [];

  function esc(s) { return POD.util.esc(s); }
  function money(n) { return POD.util.money(n); }
  function mi1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function checked(on) { return on ? " checked" : ""; }
  /** A top-level block that's empty: keeps the section's block count fixed (see the header). */
  function none(html) { return html === "" ? "<div></div>" : html; }
  function idOf(path) { return path.replace(/\./g, "-"); }

  function nameOf(D, id) {
    return hasOwn(D.BRANDS, id) && typeof D.BRANDS[id].name === "string" ? D.BRANDS[id].name : String(id);
  }

  function section(id, heading, body) {
    return '<section id="' + id + '"><h2>' + esc(heading) + "</h2>" + body + "</section>";
  }

  /** A labeled number box bound to a state path (ui-contract §5.9). */
  function numField(path, label, v) {
    var id = idOf(path);
    return '<label for="' + id + '">' + esc(label) + '</label><input id="' + id +
      '" type="number" step="0.01" min="0" data-bind="' + esc(path) + '" value="' + (isNum(v) ? String(v) : "") + '">';
  }

  // ---- loc ---------------------------------------------------------------------------------------

  function locStatus(S) {
    if (S.pos && S.pos.src === "gps" && S.zipRec) {
      return "Your location · near ZIP " + S.zip + ", " + S.zipRec.c + ", " + S.zipRec.st;
    }
    if (S.zipRec) { return "ZIP " + S.zip + " · " + S.zipRec.c + ", " + S.zipRec.st; }
    if (S.zip && !S.zipRec) { return "ZIP " + S.zip + " not found"; }
    return "Type your ZIP or address, or use your location.";
  }

  function secLoc(c) {
    var S = c.S, view = c.view, h = "", tg = "";
    h += '<div class="row"><input id="address" type="text" autocomplete="postal-code" ' +
      'placeholder="ZIP or address" value="' + esc(S.address) + '" data-action="address"></div>';
    h += '<div class="row">' +
      (view.canLocate ? '<button type="button" data-action="locate">Use my location</button>' : "") + "</div>";
    h += none(!S.brand ? '<p><button type="button" data-action="example">Show me an example</button></p>' : "");
    h += '<p class="status" data-testid="loc-status">' + esc(locStatus(S)) + "</p>";
    if (isNum(S.tax)) {
      tg = "Meal tax " + S.tax + "%";
      if (S.fuel !== "ev" && isNum(S.gas)) { tg += " · " + S.fuel + " gas " + money(S.gas) + "/gal"; }
      h += '<p class="muted" data-testid="tax-gas">' + esc(tg) + "</p>";
    } else {
      h += none("");
    }
    h += none(view.geoError ? '<p class="warn" data-testid="geo-error">Couldn\'t get your location. Type your ZIP instead.</p>' : "");
    return section("loc", "Where are you?", h);
  }

  // ---- near --------------------------------------------------------------------------------------

  function brandOptions(c) {
    var D = c.D, S = c.S;
    var ids = D.BRAND_IDS.slice(0);
    ids.sort(function (a, b) {
      var na = nameOf(D, a), nb = nameOf(D, b);
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });
    var out = '<option value="">Choose any chain…</option>';
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      out += '<option value="' + esc(id) + '"' + (S.brand === id ? " selected" : "") + ">" +
        esc(nameOf(D, id) + (hasOwn(D.PROFILES, id) ? "" : " (estimate)")) + "</option>";
    }
    return out;
  }

  function secNear(c) {
    var S = c.S, D = c.D, view = c.view;
    var msg = "", list = "", more = "";
    nearRows = [];
    if (!S.pos) {
      msg = '<p class="muted">Type a ZIP or address, or use your location, to see restaurants near you.</p>';
    } else {
      var res = POD.geo.storesNear(S.pos.lat, S.pos.lon, D, c.opts);
      if (!res) {
        msg = '<p data-testid="near-status">No store data is available for this area.</p>';
      } else if (res.status === "need") {
        msg = '<p data-testid="near-status">Finding restaurants near you…</p>';
      } else {
        var stores = res.stores, n = stores.length;
        nearRows = stores;
        if (res.partial) {
          msg += '<p data-testid="near-status">Some store data didn\'t load, so the list may be incomplete.</p>';
        }
        if (n === 0) {
          msg += '<p class="muted" data-testid="near-status">No restaurants found within ' + res.radius + " miles.</p>";
        } else {
          var shown = view.moreStores ? n : Math.min(n, SHOWN_NEAR);
          list = '<ol class="near-list" data-testid="near-list">';
          for (var i = 0; i < shown; i++) {
            var st = stores[i];
            var on = !!S.store && S.store.id === st.id;
            list += "<li><button type=\"button\" data-action=\"pick-store\" data-store=\"" + i +
              '" data-brand="' + esc(st.brand) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
              "<span>" + esc(st.name || st.brand) + (st.profiled ? "" : ' <span class="tag">Estimate</span>') + "</span>" +
              '<span class="num">' + mi1(st.mi) + " mi</span></button></li>";
          }
          list += "</ol>";
          if (!view.moreStores && n > SHOWN_NEAR) {
            more = '<p><button type="button" data-action="more-stores">Show all ' + n + "</button></p>";
          }
        }
      }
    }
    var h = '<div>' + msg + "</div>" + none(list) + none(more) +
      '<label for="brand">Restaurant chain</label><select id="brand" data-action="brand">' + brandOptions(c) + "</select>";
    return section("near", "Near you", h);
  }

  // ---- order -------------------------------------------------------------------------------------

  function secOrder(c) {
    var S = c.S, D = c.D, h = "";
    if (!S.rest) {
      return section("order", "Your order", '<p class="muted">Pick a restaurant first.</p>');
    }
    if (S.rest.profiled) {
      var menu = S.rest.menu, ci = POD.engine.cartInfo(S);
      h += '<ul class="menu">';
      for (var i = 0; i < menu.length; i++) {
        var line = menu[i];
        var q = S.cart && hasOwn(S.cart, String(i)) ? S.cart[String(i)] : 0;
        h += '<li data-testid="menu-item"><span class="name">' + esc(line.name) +
          (line.dealItem === true ? ' <span class="tag">Deal item</span>' : "") + "</span>" +
          '<span class="price num">' + money(line.price) + "</span>" +
          '<span class="qty"><button type="button" data-action="qty" data-index="' + i +
          '" data-delta="-1" aria-label="Remove one">−</button>' +
          '<span class="num" data-testid="qty-' + i + '">' + q + "</span>" +
          '<button type="button" data-action="qty" data-index="' + i +
          '" data-delta="1" aria-label="Add one">+</button></span></li>';
      }
      h += "</ul>";
      h += '<p class="total" data-testid="order-total">Menu total ' + money(ci.menuSub) + "</p>";
      if (S.rest.deal) {
        h += '<label class="check"><input type="checkbox" id="dealOn" data-bind="dealOn"' +
          checked(S.dealOn === true) + "><span>Use the " + esc(S.rest.deal.label) + " deal</span></label>";
        h += '<p data-testid="deal-status">' + (ci.dealReady ? "Deal applies" :
          "Add " + ci.shortBy + " more deal " + (ci.shortBy === 1 ? "item" : "items") + " for the deal") + "</p>";
      } else {
        h += "<div></div><div></div>";
      }
    } else {
      var cat = hasOwn(D.BRANDS, S.brand) ? D.BRANDS[S.brand].category : "";
      h += '<label for="manualSubtotal">Your order\'s menu total ($)</label>' +
        '<input id="manualSubtotal" type="number" step="0.01" min="0" value="' +
        (isNum(S.manualSubtotal) ? String(S.manualSubtotal) : "") + '" data-bind="manualSubtotal">';
      h += '<p class="muted">' + esc(S.rest.name) + " isn't profiled: app prices use a typical " +
        esc(cat) + " markup, so these totals are estimates.</p>";
    }
    return section("order", "Your order", h);
  }

  // ---- trip --------------------------------------------------------------------------------------

  function tripSource(S) {
    if (S.milesSrc === "pinned") { return "You set this distance."; }
    if (S.milesSrc === "estimate") { return "Estimated from how close together restaurants are around your ZIP."; }
    if (S.milesSrc === "store" && S.store && S.pos) {
      var straight = POD.geo.distMi(S.pos.lat, S.pos.lon, S.store.lat, S.store.lon);
      if (!isNum(straight)) { return ""; }
      var name = (S.rest && S.rest.name) || S.brand || "";
      var who = S.storePicked ? "To the " + name + " you picked, " : "To the nearest " + name + ", ";
      return who + mi1(straight) + " mi away in a straight line (× 2 × 1.25 for the road).";
    }
    return "";
  }

  function secTrip(c) {
    var S = c.S, big, src;
    if (isNum(S.miles)) {
      big = '<p class="big" data-testid="trip">' + mi1(S.miles) + " mi round trip" +
        (isNum(S.minutes) ? " · about " + S.minutes + " min" : "") + "</p>";
      src = '<p class="muted" data-testid="trip-src">' + esc(tripSource(S)) + "</p>";
    } else {
      big = '<p data-testid="trip">No trip yet.</p>';
      src = "<div></div>";
    }
    var h = big + src +
      '<label for="pinMiles">Round-trip miles</label>' +
      '<div class="row"><input id="pinMiles" type="number" step="0.1" min="0" value="' +
      (isNum(S.miles) ? String(S.miles) : "") + '"></div>' +
      '<div class="row"><button type="button" data-action="pin">Use this distance</button>' +
      (S.milesSrc === "pinned" ? '<button type="button" data-action="unpin">Measure it for me</button>' : "") +
      "</div>";
    return section("trip", "The trip", h);
  }

  // ---- results -----------------------------------------------------------------------------------

  // ui-contract §5.5 step 1: the order the names are listed in.
  var MISSING_ORDER = ["rest", "tax", "fuel", "mpg", "gas", "miPerKwh", "kwh", "miles", "minutes",
    "manualSubtotal", "tipDel", "tipPick", "wear", "hourly"];

  function missingText(missing, loading) {
    var names = [], seen = {}, isMissing = {}, i, p, nm;
    for (i = 0; i < missing.length; i++) { isMissing[missing[i]] = true; }
    var order = MISSING_ORDER.slice(0);
    for (i = 0; i < missing.length; i++) {
      if (MISSING_ORDER.indexOf(missing[i]) < 0) { order.push(missing[i]); }
    }
    for (i = 0; i < order.length; i++) {
      p = order[i];
      if (!hasOwn(isMissing, p)) { continue; }
      nm = hasOwn(FRIENDLY, p) ? FRIENDLY[p] : p;
      if ((p === "miles" || p === "minutes") && loading) { nm = "the trip distance (finding stores near you…)"; }
      if (!hasOwn(seen, nm)) { seen[nm] = true; names.push(nm); }
    }
    return "To compare, we still need: " + names.join(", ") + ".";
  }

  function resultsList(R) {
    var h = '<ol class="results-list" data-testid="results-list">';
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      h += '<li class="result' + (i === 0 ? " best" : "") + '" data-testid="result-row" data-channel="' + esc(r.id) + '">';
      h += '<div class="result-head"><span class="result-name">' + esc(r.name) +
        (r.member ? ' <span class="badge">' + esc(r.member) + "</span>" : "") + "</span>" +
        '<span class="net" data-testid="net">' + money(r.net) + "</span></div>";
      if (r.notes && r.notes.length) {
        h += '<p class="notes">';
        for (var k = 0; k < r.notes.length; k++) { h += '<span class="tag">' + esc(r.notes[k]) + "</span>"; }
        h += "</p>";
      }
      h += '<details class="receipt"><summary>Receipt</summary><ul>';
      for (var j = 0; j < r.lines.length; j++) {
        var label = r.lines[j][0], amt = r.lines[j][1];
        var txt = label === "Delivery fee" && amt === 0 ? "waived" : money(amt);
        h += '<li data-testid="line"><span data-testid="line-label">' + esc(label) + "</span>" +
          '<span class="num' + (amt < 0 ? " neg" : "") + '" data-testid="line-amount">' + txt + "</span></li>";
      }
      h += "</ul></details></li>";
    }
    return h + "</ol>";
  }

  function needField(path) {
    var f = path.split(".").pop();
    var label = hasOwn(FIELD_LABEL, f) ? FIELD_LABEL[f] : f;
    return '<label for="need-' + idOf(path) + '">' + esc(label) + '</label><input id="need-' + idOf(path) +
      '" type="number" step="0.01" min="0" data-bind="' + esc(path) + '">';
  }

  /** The apps still waiting for fees (ui-contract §5.5, step 4). */
  function appFeesHtml(S) {
    if (!S.rest || !Array.isArray(S.rest.platforms)) { return ""; }
    var blocks = "", shared = [];
    for (var a = 0; a < APPS.length; a++) {
      var p = APPS[a];
      if (S.rest.platforms.indexOf(p) < 0 || !S.plats[p] || S.plats[p].on !== true) { continue; }
      var miss = POD.state.appMissing(S, p);
      var own = [], pickup = false;
      for (var k = 0; k < miss.length; k++) {
        if (SHARED.indexOf(miss[k]) >= 0) {
          if (shared.indexOf(miss[k]) < 0) { shared.push(miss[k]); }
          continue;
        }
        own.push(miss[k]);
        var f = miss[k].split(".")[2];
        if (f === "markup" || f === "pickDisc") { pickup = true; }
      }
      if (own.length === 0) { continue; }
      blocks += '<div class="app-need" data-testid="app-fees-' + p + '"><p>' + esc(APP_LONG[p]) +
        (pickup ? " isn't compared until you enter these." : ": delivery isn't compared until you enter these.") + "</p>";
      for (var o = 0; o < own.length; o++) { blocks += needField(own[o]); }
      blocks += "</div>";
    }
    if (shared.length > 0) {
      blocks += '<div class="app-need" data-testid="app-fees-shared"><p>Shared by all three apps</p>';
      for (var s = 0; s < shared.length; s++) { blocks += needField(shared[s]); }
      blocks += "</div>";
    }
    if (blocks === "") { return ""; }
    return '<div class="app-fees" data-testid="app-fees"><h3>Add what your app\'s checkout shows</h3>' + blocks + "</div>";
  }

  /** Returns the section and the engine copy and results it computed (for insights). */
  function secResults(c) {
    var S = c.S, msg = "", verdict = "", list = "", F = null, R = null;
    var missing = POD.state.missing(S);
    if (missing.length > 0) {
      msg = '<p data-testid="missing">' + esc(missingText(missing, c.view.loading)) + "</p>";
    } else {
      F = POD.state.forEngine(S);
      if (F && POD.engine.cartInfo(F).menuSub > 0) {
        R = POD.engine.allResults(F);
        if (R.length === 0) {
          msg = '<p class="muted">Nothing to compare: every way to order from this restaurant is switched off.</p>';
        } else {
          verdict = '<p class="verdict" data-testid="verdict">Cheapest: ' + esc(R[0].name) + " at " + money(R[0].net) + "</p>";
          list = resultsList(R);
        }
      } else {
        F = null;
        msg = '<p class="muted" data-testid="empty-order">Add something to your order to compare.</p>';
      }
    }
    var h = none(msg) + none(verdict) + none(list) + none(appFeesHtml(S));
    return { html: section("results", "Cheapest way to get it", h), F: F, R: R };
  }

  // ---- insights ----------------------------------------------------------------------------------

  function secInsights(c, F, R) {
    var list = F && R && R.length > 0 ? POD.insights.build(F, R, c.now) : [];
    var h = "";
    if (list.length === 0) {
      h = '<p class="muted">Nothing to flag yet.</p>';
    } else {
      for (var i = 0; i < list.length; i++) {
        var ins = list[i];
        h += '<div class="insight' + (ins.cls ? " " + esc(ins.cls) : "") + '" data-testid="insight" data-id="' +
          esc(ins.id) + '"><strong>' + esc(ins.label) + "</strong><p>" + esc(ins.text) + "</p></div>";
      }
    }
    return section("insights", "Worth knowing", h);
  }

  // ---- car ---------------------------------------------------------------------------------------

  function parseCarRow(row) {
    var bar = row.indexOf("|");
    var models = [];
    var parts = row.slice(bar + 1).split(",");
    for (var i = 0; i < parts.length; i++) {
      var colon = parts[i].lastIndexOf(":");
      models.push(parts[i].slice(0, colon));
    }
    return { make: row.slice(0, bar), models: models };
  }

  function carSummary(S) {
    if (S.fuel === "ev" && isNum(S.miPerKwh)) { return S.miPerKwh + " mi/kWh · electric"; }
    if (isNum(S.mpg)) { return S.mpg + " mpg · " + S.fuel; }
    return "No car yet.";
  }

  function secCar(c) {
    var S = c.S, D = c.D;
    var rows = D.CAR_DATA.map(parseCarRow);
    var makeRow = null, makeOpts = '<option value="">Choose a make…</option>';
    for (var i = 0; i < rows.length; i++) {
      makeOpts += '<option value="' + esc(rows[i].make) + '"' + (S.make === rows[i].make ? " selected" : "") + ">" +
        esc(rows[i].make) + "</option>";
      if (rows[i].make === S.make) { makeRow = rows[i]; }
    }
    makeOpts += '<option value="Other"' + (S.make === "Other" ? " selected" : "") + ">Other</option>";

    var h = '<p class="muted" data-testid="car-summary">' + esc(carSummary(S)) + "</p>";
    h += '<div><label for="make">Make</label><select id="make" data-action="make">' + makeOpts + "</select></div>";
    var found = false, modelBlock = "";
    if (makeRow) {
      var modelOpts = '<option value="">Choose a model…</option>';
      for (var m = 0; m < makeRow.models.length; m++) {
        var model = makeRow.models[m];
        if (model === S.model) { found = true; }
        modelOpts += '<option value="' + esc(model) + '"' + (S.model === model ? " selected" : "") + ">" +
          esc(model) + "</option>";
      }
      modelBlock = '<div><label for="model">Model</label><select id="model" data-action="model">' + modelOpts +
        "</select></div>";
    }
    h += none(modelBlock);
    // Manual car inputs only for "Other", or a make and model that aren't in CAR_DATA (ui-contract §5.7).
    var manual = S.make === "Other" || (makeRow !== null && S.model !== "" && !found);
    var manualBlock = "";
    if (manual) {
      var fuelOpts = "";
      for (var f = 0; f < FUELS.length; f++) {
        fuelOpts += '<option value="' + FUELS[f][0] + '"' + (S.fuel === FUELS[f][0] ? " selected" : "") + ">" +
          FUELS[f][1] + "</option>";
      }
      manualBlock = '<label for="fuel">Fuel</label><select id="fuel" data-bind="fuel" data-type="text">' + fuelOpts + "</select>";
      if (S.fuel === "ev") {
        manualBlock += '<label for="miPerKwh">Miles per kWh</label><input id="miPerKwh" type="number" step="0.01" min="0" ' +
          'data-bind="miPerKwh" value="' + (isNum(S.miPerKwh) ? String(S.miPerKwh) : "") + '">';
      } else {
        manualBlock += '<label for="mpg">Miles per gallon</label><input id="mpg" type="number" step="0.1" min="0" ' +
          'data-bind="mpg" value="' + (isNum(S.mpg) ? String(S.mpg) : "") + '">';
      }
    }
    h += "<div>" + manualBlock + "</div>";
    return section("car", "Your car", h);
  }

  // ---- wallet ------------------------------------------------------------------------------------

  function holds(S, id) { return S.cards.indexOf(id) >= 0; }

  function platNames(plats) {
    var out = [];
    for (var i = 0; i < plats.length; i++) {
      out.push(plats[i] === "direct" ? "ordering direct" : APP_LONG[plats[i]] || plats[i]);
    }
    return out.join(", ");
  }

  function creditHtml(S, c) {
    var tag = c.locked ? "Locked" : (c.restricted ? "Some restaurants" :
      (c.plats.length ? "Works on " + platNames(c.plats) : ""));
    var h = '<div class="credit" data-testid="credit" data-key="' + esc(c.key) + '">' +
      '<div class="credit-head"><span class="credit-name">' + esc(c.name) + "</span>" +
      '<span class="num">' + money(c.amount) + " " + esc(c.cadence) + "</span></div>";
    if (tag !== "") { h += '<p class="tier">' + esc(tag) + "</p>"; }
    if (c.restricted && !c.locked) {
      h += '<label class="check"><input type="checkbox" data-action="opt-in" data-key="' + esc(c.key) + '"' +
        checked(isObj(S.creditOptIn) && S.creditOptIn[c.key] === true) + "><span>Qualifies here</span></label>";
    }
    if (!c.locked) {
      h += '<label class="check"><input type="checkbox" data-action="used" data-key="' + esc(c.key) + '"' +
        checked(c.used === true) + "><span>Used this period</span></label>";
    }
    if (c.manual) {
      h += '<p><button type="button" data-action="remove-credit" data-key="' + esc(c.key) + '">Remove</button></p>';
    }
    return h + "</div>";
  }

  /** Whether a held card gives this app's membership (D.CARDS membership). */
  function holdsMember(S, D, p) {
    for (var i = 0; i < D.CARDS.length; i++) {
      if (isObj(D.CARDS[i]) && D.CARDS[i].membership === p && holds(S, D.CARDS[i].id)) { return true; }
    }
    return false;
  }

  function membershipsHtml(S, D) {
    var h = "";
    for (var a = 0; a < APPS.length; a++) {
      var p = APPS[a], pl = S.plats[p] || {};
      if (holdsMember(S, D, p)) {
        h += '<label class="check"><input type="checkbox" id="cardMember-' + p + '" data-bind="plats.' + p +
          '.cardMember"' + checked(pl.cardMember !== false) + "><span>Use the " + esc(MEMBER[p]) +
          " my card includes</span></label>";
      }
      h += '<label class="check"><input type="checkbox" id="memberOwn-' + p + '" data-bind="plats.' + p +
        '.memberOwn"' + checked(pl.memberOwn === true) + "><span>I pay for " + esc(MEMBER[p]) + "</span></label>";
    }
    return h;
  }

  var ADD_CREDIT_FORM =
    '<div class="add-credit"><h3>Add a credit</h3>' +
    '<label for="mc-name">Credit name</label><input id="mc-name" type="text">' +
    '<label for="mc-amount">Amount ($)</label><input id="mc-amount" type="number" step="0.01" min="0">' +
    '<label for="mc-cadence">How often</label><select id="mc-cadence">' +
    CADENCES.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + "</option>"; }).join("") +
    "</select>" +
    '<p class="muted">Works on</p>' +
    '<label class="check"><input type="checkbox" id="mc-plat-direct"><span>Ordering direct</span></label>' +
    '<label class="check"><input type="checkbox" id="mc-plat-dd"><span>DoorDash</span></label>' +
    '<label class="check"><input type="checkbox" id="mc-plat-ue"><span>Uber Eats</span></label>' +
    '<label class="check"><input type="checkbox" id="mc-plat-gh"><span>Grubhub</span></label>' +
    '<p><button type="button" data-action="add-credit">Add credit</button></p></div>';

  function secWallet(c) {
    var S = c.S, D = c.D, view = c.view;
    var issuers = [], by = {}, cards = "";
    for (var i = 0; i < D.CARDS.length; i++) {
      var card = D.CARDS[i];
      if (!isObj(card)) { continue; }
      if (!hasOwn(by, card.issuer)) { by[card.issuer] = []; issuers.push(card.issuer); }
      by[card.issuer].push(card);
    }
    cards = '<div class="wallet-cards">';
    for (var k = 0; k < issuers.length; k++) {
      var group = by[issuers[k]];
      cards += '<div class="issuer"><h3>' + esc(issuers[k]) + "</h3>";
      for (var g = 0; g < group.length; g++) {
        cards += '<label class="check"><input type="checkbox" id="card-' + esc(group[g].id) +
          '" data-action="toggle-card" data-card="' + esc(group[g].id) + '"' + checked(holds(S, group[g].id)) +
          "><span>" + esc(group[g].name) + "</span></label>";
      }
      cards += "</div>";
    }
    cards += "</div>";
    var credits = '<div class="credits">';
    for (var j = 0; j < S.credits.length; j++) { credits += creditHtml(S, S.credits[j]); }
    credits += "</div>";
    var memberships = '<div class="memberships">' + membershipsHtml(S, D) + "</div>";
    var err = view.mcError ? '<p class="warn" data-testid="mc-error">' +
      "Give the credit a name, an amount above $0 and where it works.</p>" : "";
    return section("wallet", "Your cards and credits", cards + credits + memberships + ADD_CREDIT_FORM + none(err));
  }

  // ---- settings ----------------------------------------------------------------------------------

  /** The free-item select of a BOGO promo (D-036, UI contract §5.9). Needs a profiled restaurant's menu. */
  function bogoItem(S, p, pr) {
    if (pr.type !== "bogo") { return ""; }
    if (!S.rest || !S.rest.profiled || !S.rest.menu) {
      return '<p class="muted" data-testid="bogo-note-' + p + '">Buy one, get one free needs a restaurant with a menu.</p>';
    }
    var menu = S.rest.menu, o = '<option value="">Pick the item…</option>';
    for (var m = 0; m < menu.length; m++) {
      o += '<option value="' + m + '"' + (pr.item === m ? " selected" : "") + ">" + esc(menu[m].name) + "</option>";
    }
    return '<label for="promos-' + p + '-item">Free item</label><select id="promos-' + p + '-item" data-bind="promos.' +
      p + '.item">' + o + "</select>";
  }

  function secSettings(c) {
    var S = c.S, h = "";
    h += '<div class="fields">' +
      numField("tipDel", "Delivery tip (%)", S.tipDel) + numField("tipPick", "Pickup tip (%)", S.tipPick) +
      numField("wear", "Wear per mile ($)", S.wear) + numField("hourly", "Value of your time ($/hour)", S.hourly) +
      numField("speed", "Average driving speed (mph)", S.speed) + numField("kwh", "Electricity ($/kWh)", S.kwh) +
      "</div>";
    for (var a = 0; a < APPS.length; a++) {
      var p = APPS[a], pl = S.plats[p] || {}, pr = S.promos[p] || {};
      h += '<div class="app-settings" data-app="' + p + '"><h3>' + esc(APP_LONG[p]) + "</h3>" +
        '<label class="check"><input type="checkbox" id="plats-' + p + '-on" data-bind="plats.' + p + '.on"' +
        checked(pl.on === true) + "><span>Compare " + esc(APP_LONG[p]) + "</span></label>" +
        '<div class="fields">';
      for (var f = 0; f < APP_FIELDS.length; f++) {
        h += numField("plats." + p + "." + APP_FIELDS[f], FIELD_LABEL[APP_FIELDS[f]], pl[APP_FIELDS[f]]);
      }
      var opts = "";
      for (var t = 0; t < PROMO_TYPES.length; t++) {
        opts += '<option value="' + PROMO_TYPES[t][0] + '"' + (pr.type === PROMO_TYPES[t][0] ? " selected" : "") + ">" +
          PROMO_TYPES[t][1] + "</option>";
      }
      h += '<label for="promos-' + p + '-type">Promo</label><select id="promos-' + p + '-type" data-bind="promos.' + p +
        '.type" data-type="text">' + opts + "</select>" + bogoItem(S, p, pr) +
        numField("promos." + p + ".value", "Promo amount", pr.value) +
        numField("promos." + p + ".cap", "Promo cap ($)", pr.cap) +
        numField("promos." + p + ".min", "Promo minimum ($)", pr.min) + "</div>";
      if (p === "dd") { h += '<p class="muted">' + esc(NOTE_DD) + "</p>"; }
      h += "</div>";
    }
    h += '<div class="app-settings"><h3>Shared by all three apps</h3><div class="fields">' +
      numField("regFee", FIELD_LABEL.regFee, S.regFee) + numField("smallMin", FIELD_LABEL.smallMin, S.smallMin) +
      numField("smallFee", FIELD_LABEL.smallFee, S.smallFee) + "</div></div>";
    var direct = S.plats.direct || {};
    h += '<div class="app-settings"><h3>Ordering direct</h3>' +
      '<label class="check"><input type="checkbox" id="plats-direct-on" data-bind="plats.direct.on"' +
      checked(direct.on === true) + "><span>Compare ordering direct</span></label></div>";
    return section("settings", "Fees, tips and costs", h);
  }

  // ---- fine --------------------------------------------------------------------------------------

  function secFine(D) {
    var asOf = "";
    for (var i = 0; i < D.CARDS.length; i++) {
      var card = D.CARDS[i];
      if (typeof card.asOf === "string" && card.asOf > asOf) { asOf = card.asOf; }
      for (var k = 0; k < card.credits.length; k++) {
        var cr = card.credits[k].asOf;
        if (typeof cr === "string" && cr > asOf) { asOf = cr; }
      }
    }
    var lines = [
      "Restaurant locations: All The Places (CC-0), run " + D.BRANDS_RUN + ".",
      "App listings come from the chains' and apps' own announcements, some several years old: check the app.",
      "Card credits: each issuer's card page, as of " + asOf + ".",
      "Gas: U.S. EIA weekly retail prices. Meal tax: state rates. Fuel economy: EPA.",
      "Every app fee left blank is one the app doesn't publish (D-032): enter what your checkout shows."
    ];
    var h = "";
    for (var j = 0; j < lines.length; j++) { h += "<p>" + esc(lines[j]) + "</p>"; }
    return section("fine", "Where the numbers come from", h);
  }

  // ---- the page ----------------------------------------------------------------------------------

  /** A block is patched inside, so a control the user is clicking keeps its element (D-035, §2). */
  function isBlock(el) {
    var cls = el.getAttribute("class") || "";
    return el.tagName === "SECTION" || el.id === "side" || cls === "app-settings" || cls === "fields";
  }

  /**
   * Makes live's children match fresh's. Same count: each child whose HTML differs is replaced, and a
   * block (section or #side) with the same id is patched inside. Other counts: live takes fresh's content.
   */
  function patchChildren(live, fresh) {
    var fk = Array.prototype.slice.call(fresh.children);
    if (live.children.length !== fk.length) {
      live.innerHTML = fresh.innerHTML;
      return;
    }
    for (var i = 0; i < fk.length; i++) {
      var old = live.children[i], nu = fk[i];
      if (old.outerHTML === nu.outerHTML) { continue; }
      if (isBlock(old) && old.tagName === nu.tagName && old.id === nu.id) {
        patchChildren(old, nu);
      } else {
        live.replaceChild(nu, old);
      }
    }
  }

  /** Writes #app from ctx: only the blocks that changed, then focus back on the element that had it. */
  function render(ctx) {
    var doc = root.document;
    var app = doc && doc.getElementById ? doc.getElementById("app") : null;
    if (!app) { return; }

    var res = secResults(ctx);
    var html = secLoc(ctx) + secNear(ctx) + secOrder(ctx) + secTrip(ctx) +
      '<div id="side">' + res.html + secInsights(ctx, res.F, res.R) + "</div>" +
      secCar(ctx) + secWallet(ctx) + secSettings(ctx) + secFine(ctx.D);

    var was = doc.activeElement;
    var inApp = !!was && app.contains(was);
    var aid = inApp && was.id ? was.id : "";
    var typed = inApp && was.tagName === "INPUT" && was.type !== "checkbox" ? was.value : null;

    var fresh = doc.createElement("div");
    fresh.innerHTML = html;
    patchChildren(app, fresh);

    if (aid && !app.contains(was)) {
      var el = doc.getElementById(aid);
      if (el) {
        if (typed !== null && el.tagName === "INPUT") { el.value = typed; }
        el.focus();
      }
    }
  }

  POD.ui = {
    render: render,
    storeAt: function (i) { return i >= 0 && i < nearRows.length ? nearRows[i] : null; }
  };
})(typeof window !== "undefined" ? window : this);
