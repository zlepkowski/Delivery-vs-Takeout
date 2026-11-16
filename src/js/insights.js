/*
 * insights.js: the nine advice cards, POD.insights (docs/insights-contract.md, D-034).
 *
 * Pure: build reads only its arguments and calls POD.engine and POD.util. No POD.S,
 * no POD.data, no DOM, no Date (the clock comes in as `now`). Never throws: bad input gives [].
 * Text is plain text; the page escapes it.
 */
(function (root) {
  "use strict";

  var POD = root.POD;
  var round2 = POD.util.round2;
  var money = POD.util.money;

  var APP_NAME = { dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub" };
  var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var TIMES = "×";
  var OPEN_Q = "“";
  var CLOSE_Q = "”";

  function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function listOf(v) {
    return Array.isArray(v) ? v : [];
  }

  /** True when F.creditOptIn has its own key `key` set to exactly true (§9.1). */
  function optedIn(F, key) {
    return isObj(F.creditOptIn) && has(F.creditOptIn, key) && F.creditOptIn[key] === true;
  }

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  function mi(x) {
    return round1(x).toFixed(1);
  }

  function makeInsight(id, label, cls, text, data) {
    return { id: id, label: label, cls: cls, text: text, data: data };
  }

  /** find(id): the first entry of R with that id, or null. */
  function findIn(R, id) {
    for (var i = 0; i < R.length; i++) {
      if (R[i].id === id) { return R[i]; }
    }
    return null;
  }

  /** Index of the cheapest menu line (ties to the lowest index), optionally only deal lines; -1 if none. */
  function cheapestIndex(menu, onlyDeal) {
    var best = -1;
    for (var i = 0; i < menu.length; i++) {
      var line = menu[i];
      if (!isObj(line) || !isNum(line.price)) { continue; }
      if (onlyDeal && line.dealItem !== true) { continue; }
      if (best < 0 || line.price < menu[best].price) { best = i; }
    }
    return best;
  }

  /** "cart plus k of item j": a new object with the cart's own keys, and String(j) raised by k. */
  function cartPlus(cart, j, k) {
    var out = {};
    var key;
    if (isObj(cart)) {
      for (key in cart) {
        if (has(cart, key)) { out[key] = cart[key]; }
      }
    }
    var old = isObj(cart) && has(cart, String(j)) ? cart[String(j)] : undefined;
    out[String(j)] = (isNum(old) ? old : 0) + k;
    return out;
  }

  /** 3.1 Unlock: you're N items from a direct-only deal. */
  function unlock(F, R, ci, menu) {
    var deal = F.rest.deal;
    if (!isObj(deal) || F.dealOn !== true || !(ci.shortBy > 0)) { return null; }
    var j = cheapestIndex(menu, true);
    if (j < 0) { return null; }
    var n = ci.shortBy;
    var cart2 = cartPlus(F.cart, j, n);
    var want = "Deal: " + deal.label;
    var chs = ["direct-d", "direct-p"];
    var best = null;
    for (var i = 0; i < chs.length; i++) {
      var a = POD.engine.calc(F, chs[i], { cart: cart2 });
      if (!a || listOf(a.notes).indexOf(want) < 0) { continue; }
      if (!best || a.net < best.net) { best = a; }
    }
    if (!best) { return null; }
    var was = findIn(R, best.id);
    if (!was) { return null; }
    var item = menu[j].name;
    var cls = best.net <= R[0].net ? "good" : "";
    var text = "Add " + n + " " + TIMES + " " + item + " and " + deal.label + " applies: " +
      best.name + " comes to " + money(best.net) + " (now " + money(was.net) + ").";
    var data = { n: n + 0, item: item, channel: best.id, net: best.net + 0, was: was.net + 0 };
    return makeInsight("unlock", "Unlock", cls, text, data);
  }

  /** 3.2 Distance: the round trip at which delivery starts to win. */
  function distance(F, bp, bd) {
    if (!bp || !bd) { return null; }
    var rate = POD.engine.perMile(F) + (F.hourly > 0 && F.speed > 0 ? F.hourly / F.speed : 0);
    if (!(rate > 0)) { return null; }
    var fixed = POD.engine.calc(F, bp.id, { miles: 0, minutes: 0 }).net;
    var be = (bd.net - fixed) / rate;
    var data = { breakEven: round1(be) + 0, miles: round1(F.miles) + 0, pickup: bp.id, delivery: bd.id };
    var cls;
    var text;
    if (be <= 0) {
      cls = "";
      text = "Delivery (" + bd.name + ", " + money(bd.net) + ") costs less than picking up, even from next door.";
    } else if (be >= F.miles) {
      cls = "good";
      text = "Picking up stays cheaper than delivery up to a " + mi(be) + " mi round trip. Yours is " + mi(F.miles) + " mi.";
    } else {
      cls = "";
      text = "Delivery wins once the round trip passes " + mi(be) + " mi, and yours is " + mi(F.miles) + " mi.";
    }
    return makeInsight("distance", "Distance", cls, text, data);
  }

  /** 3.3 Fuel: the gas price at which delivery would win. */
  function fuel(F, bp, bd) {
    if (F.fuel === "ev" || !(F.mpg > 0) || !(F.miles > 0) || !bp || !bd || !(bp.net < bd.net)) { return null; }
    var be = F.gas + (bd.net - bp.net) / (F.miles / F.mpg);
    var capped = be > 12;
    var text = capped
      ? "Even at $12.00/gal, picking up still wins."
      : "Picking up wins until gas reaches " + money(round2(be)) + "/gal. Yours costs " + money(F.gas) + "/gal.";
    var data = { gas: F.gas + 0, breakEven: round2(be) + 0, capped: capped };
    return makeInsight("fuel", "Fuel", "", text, data);
  }

  /** D-036: a bogo candidate counts only when its counterfactual result has a "BOGO: " note. */
  function hasBogoNote(a) {
    var notes = listOf(a && a.notes);
    for (var i = 0; i < notes.length; i++) {
      if (typeof notes[i] === "string" && notes[i].indexOf("BOGO: ") === 0) { return true; }
    }
    return false;
  }

  /** 3.4 counterfactual, profiled: add k of the cheapest item, k = 1..20. */
  function counterProfiled(F, r, min, menu, j) {
    if (j < 0) { return null; }
    for (var k = 1; k <= 20; k++) {
      var a = POD.engine.calc(F, r.id, { cart: cartPlus(F.cart, j, k) });
      if (a && a.parts.food >= min) {
        return { r: r, a: a, min: min, addQty: k, addItem: menu[j].name, addAmount: round2(k * menu[j].price) };
      }
    }
    return null;
  }

  /** 3.4 counterfactual, unprofiled: a manual subtotal, up to 5 tries of +$0.01. */
  function counterUnprofiled(F, r, min) {
    var plat = isObj(F.plats) && has(F.plats, r.plat) ? F.plats[r.plat] : null;
    var mk = isObj(plat) ? plat.markup : undefined;
    if (!isNum(mk)) { return null; }
    var ms = Math.ceil(min / (1 + mk / 100) * 100) / 100;
    for (var t = 0; t < 5; t++) {
      var a = POD.engine.calc(F, r.id, { manualSubtotal: ms });
      if (a && a.parts.food >= min) {
        return { r: r, a: a, min: min, addQty: null, addItem: null, addAmount: round2(ms - F.manualSubtotal) };
      }
      ms = round2(ms + 0.01);
    }
    return null;
  }

  /** 3.4 Minimum: a promo just out of reach. */
  function minimum(F, R, menu) {
    var profiled = F.rest.profiled === true;
    var j = profiled ? cheapestIndex(menu, false) : -1;
    var best = null;
    for (var i = 0; i < R.length; i++) {
      var r = R[i];
      if (r.plat === "direct") { continue; }
      var pr = isObj(F.promos) && has(F.promos, r.plat) ? F.promos[r.plat] : null;
      if (!isObj(pr)) { continue; }
      var bogoOk = pr.type === "bogo" && profiled;
      if (pr.type !== "percent" && pr.type !== "dollar" && pr.type !== "freedel" && !bogoOk) { continue; }
      var min = pr.min;
      if (!isNum(min) || !(min > 0)) { continue; }
      if (!(r.parts.food < min)) { continue; }
      if (pr.type === "freedel" && r.mode === "p") { continue; }
      var cand = profiled ? counterProfiled(F, r, min, menu, j) : counterUnprofiled(F, r, min);
      if (!cand) { continue; }
      if (pr.type === "bogo" && !hasBogoNote(cand.a)) { continue; }
      cand.delta = round2(cand.a.net - r.net);
      if (!best || cand.delta < best.delta) { best = cand; }
    }
    if (!best) { return null; }

    var br = best.r;
    var short = round2(best.min - br.parts.food);
    var add = best.addQty !== null
      ? "Adding " + best.addQty + " " + TIMES + " " + best.addItem + " (" + money(best.addAmount) + ")"
      : "Adding " + money(best.addAmount) + " of food";
    var change = best.delta < 0 ? money(-best.delta) + " less" : money(best.delta) + " more";
    var cls = best.delta < 0 ? "good" : "";
    var text = br.name + " is " + money(short) + " short of its " + money(best.min) + " promo minimum. " +
      add + " brings it to " + money(best.a.net) + ": " + change + " than now.";
    var data = {
      channel: br.id,
      min: best.min + 0,
      short: short + 0,
      addQty: best.addQty,
      addItem: best.addItem,
      addAmount: best.addAmount + 0,
      net: best.a.net + 0,
      was: br.net + 0,
      delta: best.delta + 0
    };
    return makeInsight("minimum", "Minimum", cls, text, data);
  }

  /** 3.5 Wallet: an Amex Gold dining partner. */
  function wallet(F, credits) {
    if (F.rest.amexGoldDirect !== true || !isObj(F.plats) || !isObj(F.plats.direct) || F.plats.direct.on !== true) {
      return null;
    }
    var c = null;
    for (var i = 0; i < credits.length; i++) {
      var w = credits[i];
      if (isObj(w) && w.goldPartner === true && w.locked !== true &&
          !(w.restricted === true && !optedIn(F, w.key))) {
        c = credits[i];
        break;
      }
    }
    if (!c) { return null; }
    var used = c.used === true;
    var data = { credit: c.key, amount: c.amount + 0, used: used };
    if (!used) {
      return makeInsight("wallet", "Wallet", "good",
        F.rest.name + " is an Amex Gold dining partner, so your " + money(c.amount) + " " + c.name +
        " works when you order direct.", data);
    }
    return makeInsight("wallet", "Wallet", "",
      F.rest.name + " is an Amex Gold dining partner, but your " + c.name + " is marked used this period.", data);
  }

  /** Days in month t (0-11) of year y. */
  function daysInMonth(y, t) {
    if (t === 1 && y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) { return 29; }
    return MONTH_DAYS[t];
  }

  /** First month (0-12, 12 = January next year) that starts the next period. */
  function periodStart(cadence, m) {
    if (cadence === "monthly") { return m + 1; }
    if (cadence === "quarterly") { return (Math.floor(m / 3) + 1) * 3; }
    if (cadence === "semiannual") { return (Math.floor(m / 6) + 1) * 6; }
    return 12;
  }

  /** Days from today (y, m, d) until the next period starts (pure arithmetic). */
  function daysLeft(y, m, d, cadence) {
    var s = periodStart(cadence, m);
    var days = daysInMonth(y, m) - d + 1;
    for (var t = m + 1; t < s; t++) { days += daysInMonth(y, t); }
    return days;
  }

  function validCadence(c) {
    return c === "monthly" || c === "quarterly" || c === "semiannual" || c === "annual";
  }

  /** 3.6 Timing: unused credits and when they reset. */
  function timing(F, credits, now) {
    if (now === null || typeof now !== "object") { return null; }
    if (typeof now.getTime !== "function" || typeof now.getFullYear !== "function" ||
        typeof now.getMonth !== "function" || typeof now.getDate !== "function") { return null; }
    if (!isNum(now.getTime())) { return null; }
    var y = now.getFullYear();
    var m = now.getMonth();
    var d = now.getDate();
    if (!isNum(y) || !isNum(m) || !isNum(d)) { return null; }

    var rentOk = F.rest.amexGoldDirect === true;
    var items = [];
    for (var i = 0; i < credits.length; i++) {
      var c = credits[i];
      if (!isObj(c)) { continue; }
      if (c.locked === true || c.used === true) { continue; }
      if (!validCadence(c.cadence)) { continue; }
      var plats = (Array.isArray(c.plats) && c.plats.length > 0) ||
        (c.goldPartner === true && rentOk && !(c.restricted === true && !optedIn(F, c.key)));
      if (!plats) { continue; }
      items.push({ key: c.key, name: c.name, amount: c.amount, days: daysLeft(y, m, d, c.cadence) });
    }
    if (items.length === 0) { return null; }

    items.sort(function (a, b) {
      if (a.days !== b.days) { return a.days - b.days; }
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });

    var sum = 0;
    var dataItems = [];
    var parts = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      sum += it.amount;
      dataItems.push({ key: it.key, name: it.name, amount: it.amount + 0, days: it.days + 0 });
      if (k < 3) {
        parts.push(it.name + " (" + money(it.amount) + ", resets in " +
          (it.days === 1 ? "1 day" : it.days + " days") + ")");
      }
    }
    var text = "Unused this period: " + parts.join("; ") +
      (items.length > 3 ? "; and " + (items.length - 3) + " more" : "") + ".";
    var cls = items[0].days <= 7 ? "hot" : "";
    var data = { items: dataItems, total: round2(sum) + 0 };
    return makeInsight("timing", "Timing", cls, text, data);
  }

  /** Names joined by ", ", each name listed once (its first time). */
  function names(list) {
    var seen = [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i].name;
      if (seen.indexOf(n) < 0) {
        seen.push(n);
        out.push(n);
      }
    }
    return out.join(", ");
  }

  function keysOf(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { out.push(list[i].key); }
    return out;
  }

  /** 3.7 Locked: credits that can't pay for this order. */
  function locked(F, credits) {
    var co = isObj(F.creditOptIn) ? F.creditOptIn : null;
    var lockedList = [];
    var restrictedList = [];
    for (var i = 0; i < credits.length; i++) {
      var c = credits[i];
      if (!isObj(c)) { continue; }
      if (c.locked === true) {
        lockedList.push(c);
      } else if (c.restricted === true && !(co !== null && has(co, c.key) && co[c.key] === true)) {
        restrictedList.push(c);
      }
    }
    if (lockedList.length === 0 && restrictedList.length === 0) { return null; }
    var parts = [];
    if (lockedList.length > 0) {
      parts.push("Can't be used on a restaurant order: " + names(lockedList) + ".");
    }
    if (restrictedList.length > 0) {
      parts.push("Only at some restaurants (tick " + OPEN_Q + "Qualifies here" + CLOSE_Q +
        " if this one takes it): " + names(restrictedList) + ".");
    }
    var data = { locked: keysOf(lockedList), restricted: keysOf(restrictedList) };
    return makeInsight("locked", "Locked", "", parts.join(" "), data);
  }

  /** 3.8 Nuance: app pickup beats the counter. */
  function nuance(R, dp) {
    if (!dp) { return null; }
    var ap = null;
    for (var i = 0; i < R.length; i++) {
      if (R[i].plat !== "direct" && R[i].mode === "p") { ap = R[i]; break; }
    }
    if (!ap || !(ap.net < dp.net)) { return null; }
    var why = ap.credit > 0 ? "credit" : (ap.disc > 0 ? "promo" : "other");
    var diff = round2(dp.net - ap.net);
    var tail = why === "credit" ? ", because your card credit works there."
      : (why === "promo" ? ", thanks to its promo." : ".");
    var text = "Ordering pickup in " + APP_NAME[ap.plat] + " beats ordering direct for pickup by " +
      money(diff) + tail;
    var data = { channel: ap.id, net: ap.net + 0, direct: dp.net + 0, diff: diff + 0, why: why };
    return makeInsight("nuance", "Nuance", "good", text, data);
  }

  /** 3.9 Spread: best vs worst. */
  function spread(R) {
    if (R.length < 2) { return null; }
    var last = R[R.length - 1];
    var gap = round2(last.net - R[0].net);
    if (!(gap > 0)) { return null; }
    var text = "The same order costs " + money(R[0].net) + " (" + R[0].name + ") to " +
      money(last.net) + " (" + last.name + "): a " + money(gap) + " spread.";
    return makeInsight("spread", "Spread", "", text, { lo: R[0].id, hi: last.id, gap: gap + 0 });
  }

  /** build(F, R, now): the advice cards, in contract order. Pure; never throws. */
  function build(F, R0, now) {
    if (!isObj(F) || !isObj(F.rest)) { return []; }
    if (!Array.isArray(R0) || R0.length === 0) { return []; }
    if (F.rest.profiled === true && !Array.isArray(F.rest.menu)) { return []; }
    if (F.rest.profiled === true && !F.rest.menu.every(isObj)) { return []; }

    var R = [];
    for (var i = 0; i < R0.length; i++) {
      if (isObj(R0[i])) { R.push(R0[i]); }
    }
    if (R.length === 0) { return []; }

    var ci = POD.engine.cartInfo(F);
    if (!isNum(ci.menuSub) || !(ci.menuSub > 0)) { return []; }

    var menu = listOf(F.rest.menu);
    var credits = listOf(F.credits);
    var bp = null;
    var bd = null;
    for (var k = 0; k < R.length; k++) {
      if (!bp && R[k].mode === "p") { bp = R[k]; }
      if (!bd && R[k].mode === "d") { bd = R[k]; }
    }

    var out = [];
    var x = unlock(F, R, ci, menu);
    if (x) { out.push(x); }
    x = distance(F, bp, bd);
    if (x) { out.push(x); }
    x = fuel(F, bp, bd);
    if (x) { out.push(x); }
    x = minimum(F, R, menu);
    if (x) { out.push(x); }
    x = wallet(F, credits);
    if (x) { out.push(x); }
    x = timing(F, credits, now);
    if (x) { out.push(x); }
    x = locked(F, credits);
    if (x) { out.push(x); }
    x = nuance(R, findIn(R, "direct-p"));
    if (x) { out.push(x); }
    x = spread(R);
    if (x) { out.push(x); }
    return out;
  }

  POD.insights = { build: build };
})(typeof window !== "undefined" ? window : this);
