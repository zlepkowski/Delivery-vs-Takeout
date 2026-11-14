/*
 * engine.js: the pricing engine, POD.engine (docs/engine-contract.md, D-029).
 *
 * Pure: it reads only its arguments. No POD.S, no POD.data, no DOM, no Date.
 * Every component is rounded with round2 when it is computed (D-012).
 */
(function (root) {
  "use strict";

  var POD = root.POD;
  var round2 = POD.util.round2;

  var CHANNELS = ["direct-d", "direct-p", "dd-d", "dd-p", "ue-d", "ue-p", "gh-d", "gh-p"];
  var PLAT_NAMES = { direct: "Order direct", dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub" };
  var MEMBER_NAMES = { dd: "DashPass", ue: "Uber One", gh: "Grubhub+" };

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  /** "object" as in the contracts: not null, typeof "object", not an array. */
  function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /** "finite number": typeof x === "number" and isFinite(x). */
  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** cap(x) = max > 0 ? min(x, max) : x (a missing max means no cap). */
  function cap(x, max) {
    return max > 0 ? Math.min(x, max) : x;
  }

  /** The cart: the overridden one, else S.cart (contract §1). */
  function cartOf(S, ov) {
    return ov.cart !== undefined ? ov.cart : S.cart;
  }

  /**
   * The cart lines (contract §4) of a profiled brand: [{i, it, q}] in ascending menu-index order.
   * A key that isn't a canonical index in range, a non-object menu entry and a non-number quantity give no line.
   */
  function cartLines(S, ov) {
    var out = [];
    if (!S.rest || !S.rest.profiled) { return out; }
    var cart = cartOf(S, ov);
    var menu = Array.isArray(S.rest.menu) ? S.rest.menu : [];
    var idx = [];
    var k;
    for (k in cart) {
      if (has(cart, k) && isNum(cart[k])) {
        var i = parseInt(k, 10);
        if (String(i) === k && i >= 0 && i < menu.length && isObj(menu[i])) { idx.push(i); }
      }
    }
    idx.sort(function (a, b) { return a - b; });
    for (var j = 0; j < idx.length; j++) {
      out.push({ i: idx[j], it: menu[idx[j]], q: cart[String(idx[j])] });
    }
    return out;
  }

  /** mk(it, p): the item's own markup on app p when it has a valid one, else the app's markup (D-036). */
  function itemMarkup(it, p, appMarkup) {
    if (isObj(it.markup) && has(it.markup, p) && isNum(it.markup[p]) && it.markup[p] >= 0) {
      return it.markup[p];
    }
    return appMarkup;
  }

  /**
   * The BOGO promo before the clamp (contract §5.4, D-036): floor(q / 2) of the chosen item, at its
   * marked-up price, capped by pr.cap. 0 when the item isn't a valid one in this cart. Never throws.
   */
  function bogoAmount(S, ov, p, pr) {
    var j = pr.item;
    var menu = S.rest.menu;
    if (!S.rest.profiled || !Array.isArray(menu)) { return 0; }
    if (!isNum(j) || Math.floor(j) !== j || j < 0 || j >= menu.length) { return 0; }
    var it = menu[j];
    var cart = cartOf(S, ov);
    var key = String(j);
    if (!isObj(it) || !isNum(it.price) || !has(cart, key) || !isNum(cart[key])) { return 0; }
    var free = Math.floor(cart[key] / 2);
    return cap(it.price * free * (1 + itemMarkup(it, p, S.plats[p].markup) / 100), pr.cap);
  }

  /** Deep copy of plain data (objects and arrays), so the copy shares nothing with the source. */
  function deepCopy(v) {
    var out;
    var k;
    if (Object.prototype.toString.call(v) === "[object Array]") {
      out = [];
      for (k = 0; k < v.length; k++) { out.push(deepCopy(v[k])); }
      return out;
    }
    if (v !== null && typeof v === "object") {
      out = {};
      for (k in v) {
        if (has(v, k)) { out[k] = deepCopy(v[k]); }
      }
      return out;
    }
    return v;
  }

  /** Is the channel offered by this restaurant and this state? */
  function available(S, ch) {
    if (CHANNELS.indexOf(ch) < 0) { return false; }
    var parts = ch.split("-");
    var p = parts[0];
    var m = parts[1];
    if (p === "direct") {
      if (!S.plats.direct || !S.plats.direct.on) { return false; }
      return m === "p" || S.rest.directDelivery === true;
    }
    var P = S.plats[p];
    if (!P || !P.on) { return false; }
    if (m === "d" && P.noDelivery === true) { return false; }
    return S.rest.platforms.indexOf(p) >= 0;
  }

  /** The cart: menu lines in ascending index order, or the manual subtotal for an unprofiled brand. */
  function cartInfo(S, override) {
    var ov = override || {};
    var rest = S.rest;
    var manual = ov.manualSubtotal !== undefined ? ov.manualSubtotal : S.manualSubtotal;
    var deal = rest.deal;
    var menuSum = 0;
    var dealSum = 0;
    var qty = 0;
    var eligQty = 0;

    if (rest.profiled) {
      var lines = cartLines(S, ov);
      for (var j = 0; j < lines.length; j++) {
        var price = lines[j].it.price;
        var isDeal = lines[j].it.dealItem === true;
        var q = lines[j].q;
        menuSum += price * q;
        dealSum += (isDeal && deal ? Math.min(price, deal.price) : price) * q;
        qty += q;
        if (isDeal) { eligQty += q; }
      }
    }

    var menuSub = rest.profiled ? round2(menuSum) : round2(manual);
    var dealReady = !!deal && eligQty >= deal.minItems;
    var dealSub = dealReady ? round2(dealSum) : menuSub;
    var shortBy = deal ? Math.max(deal.minItems - eligQty, 0) : 0;

    return {
      menuSub: menuSub,
      dealSub: dealSub,
      qty: qty,
      eligQty: eligQty,
      dealReady: dealReady,
      shortBy: shortBy
    };
  }

  /** Is this credit eligible for channel (p, m)? Enforces the §9.1 tiers (contract §5.9). */
  function creditOk(S, c, p, m) {
    if (c.locked || c.used) { return false; }
    if (c.restricted && !(S.creditOptIn && S.creditOptIn[c.key] === true)) { return false; }
    var onPlat = (!!c.plats && c.plats.indexOf(p) >= 0) ||
      (p === "direct" && !!c.goldPartner && S.rest.amexGoldDirect === true);
    if (!onPlat) { return false; }
    if (c.modes !== undefined && c.modes !== null && c.modes.indexOf(m) < 0) { return false; }
    return true;
  }

  /** One receipt for one channel, or null when the channel isn't available. Pure. */
  function calc(S, ch, override) {
    if (!available(S, ch)) { return null; }
    var ov = override || {};
    var parts = ch.split("-");
    var p = parts[0];
    var m = parts[1];
    var app = p !== "direct";
    var P = S.plats[p];
    var rest = S.rest;
    var miles = ov.miles !== undefined ? ov.miles : S.miles;
    var minutes = ov.minutes !== undefined ? ov.minutes : S.minutes;
    var ci = cartInfo(S, ov);
    var deal = rest.deal;

    // 5.1 Deal (direct only)
    var dealApplied = !app && !!S.dealOn && ci.dealReady &&
      (deal.scope === "both" || (deal.scope === "delivery" && m === "d") || (deal.scope === "pickup" && m === "p"));
    var base = dealApplied ? ci.dealSub : ci.menuSub;

    // 5.2 Markup: a profiled app's food is a sum over the cart lines, each at its own markup (D-036)
    var food = base;
    if (app && rest.profiled) {
      var acc = 0;
      var mlines = cartLines(S, ov);
      for (var li = 0; li < mlines.length; li++) {
        acc = acc + mlines[li].it.price * mlines[li].q * (1 + itemMarkup(mlines[li].it, p, P.markup) / 100);
      }
      food = round2(acc);
    } else if (app) {
      food = round2(base * (1 + P.markup / 100));
    }

    // 5.3 Fees
    var memberOn = false;
    var delivery = 0;
    var service = 0;
    var small = 0;
    var reg = 0;
    var dsvc = 0;
    var dsvcOn = false;
    if (app && m === "d") {
      memberOn = !!P.member && food >= P.memberMin;
      delivery = memberOn ? 0 : round2(P.delFee);
      service = round2(Math.max(food * (memberOn ? P.memberSvc : P.svc) / 100, P.svcMin));
      small = food < S.smallMin ? round2(S.smallFee) : 0;
      reg = round2(S.regFee);
    } else if (!app && m === "d") {
      delivery = round2(rest.directFee);
    }
    if (!app && rest.directSvc && Array.isArray(rest.directSvc.modes) && rest.directSvc.modes.indexOf(m) >= 0) {
      var ds = rest.directSvc;
      dsvc = round2(cap((ds.flat || 0) + food * (ds.pct || 0) / 100, ds.max));
      dsvcOn = true;
    }
    var fees = round2(delivery + service + small + reg + dsvc);

    // 5.4 Discounts (apps only)
    var promo = 0;
    var pick = 0;
    var disc = 0;
    var taxDisc = 0;
    var bogoNote = null;
    if (app) {
      var pr = S.promos[p];
      var promoOn = pr.type !== "none" && food >= (pr.min || 0);
      if (promoOn) {
        if (pr.type === "percent") {
          promo = round2(cap(food * pr.value / 100, pr.cap));
        } else if (pr.type === "dollar") {
          promo = round2(pr.value);
        } else if (pr.type === "freedel") {
          promo = m === "d" ? delivery : 0;
        } else if (pr.type === "bogo") {
          promo = round2(bogoAmount(S, ov, p, pr));
        }
      }
      pick = m === "p" ? round2(food * P.pickDisc / 100) : 0;
      promo = Math.min(promo, food);
      pick = round2(Math.min(pick, food - promo));
      disc = round2(promo + pick);
      if (pr.type === "bogo" && promo > 0) { bogoNote = rest.menu[pr.item].name; }

      // 5.5 Tax base (freedel takes money off the delivery fee, not the food)
      taxDisc = pr.type === "freedel" ? pick : disc;
    }

    // 5.5 Tax
    var tax = round2((food - taxDisc) * S.tax / 100);

    // 5.6 Tip (on the pre-discount food, §9.4)
    var tip = round2(food * (m === "d" ? S.tipDel : S.tipPick) / 100);

    // 5.7 Drive (pickup only)
    var ev = S.fuel === "ev";
    var energy = 0;
    var wearC = 0;
    var time = 0;
    var drive = 0;
    if (m === "p") {
      energy = ev
        ? (S.miPerKwh > 0 ? round2(miles / S.miPerKwh * S.kwh) : 0)
        : (S.mpg > 0 ? round2(miles / S.mpg * S.gas) : 0);
      wearC = round2(miles * S.wear);
      time = round2(S.hourly * minutes / 60);
      drive = round2(energy + wearC + time);
    }

    // 5.8 Gross
    var gross = round2(food + fees + tax + tip + drive);

    // 5.9 Credits
    var sum = 0;
    for (var i = 0; i < S.credits.length; i++) {
      if (creditOk(S, S.credits[i], p, m)) { sum += S.credits[i].amount; }
    }
    var credit = round2(Math.min(sum, Math.max(gross - disc, 0)));

    // 5.10 Net
    var net = Math.max(round2(gross - disc - credit), 0);
    var off = round2(disc + credit);

    // 6. Receipt lines
    var neg = function (x) { return round2(-x); };
    var lines = [["Food", food]];
    if (m === "d") { lines.push(["Delivery fee", delivery]); }
    if (app && m === "d") { lines.push(["Service fee", service]); }
    if (dsvcOn) { lines.push(["Service fee", dsvc]); }
    if (small > 0) { lines.push(["Small-order fee", small]); }
    if (reg > 0) { lines.push(["Regulatory fee", reg]); }
    lines.push(["Tax", tax]);
    if (tip > 0) { lines.push(["Tip", tip]); }
    if (m === "p") {
      lines.push([ev ? "Charging" : "Gas", energy]);
      if (wearC > 0) { lines.push(["Wear", wearC]); }
      if (time > 0) { lines.push(["Time", time]); }
    }
    if (promo > 0) { lines.push(["Promo", neg(promo)]); }
    if (pick > 0) { lines.push(["Pickup discount", neg(pick)]); }
    if (credit > 0) { lines.push(["Card credits", neg(credit)]); }
    lines.push(["TOTAL", net]);

    var notes = [];
    if (dealApplied) { notes.push("Deal: " + deal.label); }
    if (bogoNote !== null) { notes.push("BOGO: " + bogoNote); }
    if (!rest.profiled) { notes.push("Estimate"); }

    return {
      id: ch,
      plat: p,
      mode: m,
      name: PLAT_NAMES[p] + " · " + (m === "d" ? "delivery" : "pickup"),
      parts: { food: food, fees: fees, tax: tax, tip: tip, drive: drive },
      gross: gross,
      net: net,
      disc: disc,
      credit: credit,
      off: off,
      lines: lines,
      notes: notes,
      member: memberOn ? MEMBER_NAMES[p] : null
    };
  }

  /** Every available channel's result, cheapest net first; ties keep CHANNELS order. */
  function allResults(S, override) {
    var out = [];
    for (var i = 0; i < CHANNELS.length; i++) {
      var r = calc(S, CHANNELS[i], override);
      if (r) { out.push(r); }
    }
    out.sort(function (a, b) {
      if (a.net !== b.net) { return a.net - b.net; }
      return CHANNELS.indexOf(a.id) - CHANNELS.indexOf(b.id);
    });
    return out;
  }

  /** The running cost per mile, unrounded (contract 5.7). */
  function perMile(S) {
    var fuelPart = S.fuel === "ev"
      ? (S.miPerKwh > 0 ? S.kwh / S.miPerKwh : 0)
      : (S.mpg > 0 ? S.gas / S.mpg : 0);
    return fuelPart + S.wear;
  }

  /** The S.rest object for a brand (contract 2.1, D-006). null for an unknown brand. */
  function restFor(brandId, D) {
    var brand = has(D.BRANDS, brandId) ? D.BRANDS[brandId] : null;

    if (has(D.PROFILES, brandId)) {
      var prof = D.PROFILES[brandId];
      var name = brand ? brand.name : brandId;
      var menu = [];
      for (var i = 0; i < prof.menu.length; i++) {
        menu.push(deepCopy(prof.menu[i]));
      }
      var directDelivery = prof.directDelivery === true;
      var rest = {
        id: brandId,
        name: name,
        profiled: true,
        menu: menu,
        deal: prof.deal ? deepCopy(prof.deal) : null,
        directDelivery: directDelivery,
        directSvc: prof.directSvc ? deepCopy(prof.directSvc) : null,
        amexGoldDirect: prof.amexGoldDirect === true,
        platforms: deepCopy(prof.platforms),
        markup: deepCopy(prof.markup),
        markupEst: prof.markupEst === true
      };
      if (directDelivery) { rest.directFee = prof.directFee; }
      return rest;
    }

    if (!brand) { return null; }
    var cat = has(D.CATEGORY_DEFAULTS, brand.category) ? D.CATEGORY_DEFAULTS[brand.category] : null;
    if (!cat) { return null; }
    return {
      id: brandId,
      name: brand.name,
      profiled: false,
      menu: [],
      deal: null,
      directDelivery: false,
      directSvc: null,
      amexGoldDirect: false,
      platforms: ["dd", "ue", "gh"],
      markup: deepCopy(cat.markup),
      markupEst: true
    };
  }

  POD.engine = {
    calc: calc,
    allResults: allResults,
    cartInfo: cartInfo,
    perMile: perMile,
    restFor: restFor,
    CHANNELS: CHANNELS
  };

  /** D-008 convenience wrapper: supplies POD.S. */
  POD.calc = function (ch, o) {
    return POD.engine.calc(POD.S, ch, o);
  };
})(typeof window !== "undefined" ? window : this);
