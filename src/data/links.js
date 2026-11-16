/*
 * LINKS: where a result row hands off (D-041, docs/links-contract.md; D-016: no link pre-fills a cart).
 * Source:  per entry in `source`:
 *          DoorDash, Uber Eats and Grubhub: the user opened sample links on 2026-11-16 (the session can't
 *          render the apps' searches: their data comes from API hosts outside the allowlist, behind bot checks).
 *          Google Maps: Google's "Maps URLs" documentation, https://developers.google.com/maps/documentation/urls/get-started
 *          (no key). The user chose Google Maps on 2026-11-16.
 *          The chains: each profiled chain's own ordering host (tools/data/profiles/<id>.json), its home page
 *          loaded in Chromium through the session's proxy on 2026-11-16 unless the entry says otherwise.
 * As of:   2026-11-16
 * Method:  hand-entered by the orchestrator (the cards.js pattern, D-013). A format goes in only when it was
 *          seen working; `{q}` is the restaurant's name and `{lat}`, `{lon}` the store's point, filled in by
 *          POD.links (src/js/links.js). A chain's link is its home page, not a deep path: paths move (Papa Johns'
 *          /order/menu still fails, ISS-024; Chipotle's /order redirects to its home page), home pages don't.
 * Nulls:   apps.ue.search and apps.gh.search: no confirmed search format (the user's sample search links showed a
 *          human check and an address prompt, then each app's home page), so those rows open the app's home page.
 * Est:     none
 */
(function (root) {
  "use strict";

  var CHECKED = "2026-11-16";

  root.POD.data.LINKS = {
    asOf: CHECKED,

    // ---------------------------------------------------------------- the delivery apps
    apps: {
      dd: {
        home: "https://www.doordash.com/",
        search: "https://www.doordash.com/search/store/{q}/",
        source: "The user opened https://www.doordash.com/search/store/Ben%20%26%20Jerry's/ on 2026-11-16: " +
          "it showed a DoorDash search for Ben & Jerry's (spaces, an ampersand and an apostrophe, encoded as here).",
        checked: CHECKED
      },
      ue: {
        home: "https://www.ubereats.com/",
        search: null,
        source: "The user opened https://www.ubereats.com/search?q=Ben%20%26%20Jerry's on 2026-11-16: " +
          "Uber Eats asked for a human check, then showed its home page. No search format is used.",
        checked: CHECKED
      },
      gh: {
        home: "https://www.grubhub.com/",
        search: null,
        source: "The user opened https://www.grubhub.com/search?queryText=Ben%20%26%20Jerry's on 2026-11-16: " +
          "Grubhub asked for an address, then showed its home page. No search format is used. " +
          "https://www.grubhub.com/ also answered 200 to the session the same day.",
        checked: CHECKED
      }
    },

    // ---------------------------------------------------------------- directions
    maps: {
      name: "Google Maps",
      dir: "https://www.google.com/maps/dir/?api=1&destination={lat}%2C{lon}",
      search: "https://www.google.com/maps/search/?api=1&query={q}",
      source: "Google Maps URLs, https://developers.google.com/maps/documentation/urls/get-started: " +
        "directions are /maps/dir/?api=1&destination= (latitude and longitude, comma-separated, the comma " +
        "URL-encoded as %2C; with no origin the device's own location is used), and a search is " +
        "/maps/search/?api=1&query=. No key is needed. The user chose Google Maps on 2026-11-16. That page isn't " +
        "on the session's allowlist, so it wasn't re-read here.",
      checked: CHECKED
    },

    // ---------------------------------------------------------------- the chains' own sites (profiled only)
    order: {
      buffalo_wild_wings: {
        url: "https://www.buffalowildwings.com/",
        source: "200, title \"Buffalo Wild Wings | Wings. Beer. Sports\", header \"ORDER PICKUP\" and \"ORDER DELIVERY\".",
        checked: CHECKED
      },
      chipotle: {
        url: "https://www.chipotle.com/",
        source: "200, title \"Mexican Food - Restaurant & Catering - Chipotle Mexican Grill\", an \"ORDER NOW\" button; " +
          "https://www.chipotle.com/order redirects here.",
        checked: CHECKED
      },
      dominos: {
        url: "https://www.dominos.com/",
        source: "200, title \"Pizza Delivery & Carryout, Pasta, Wings & More | Domino's\", header \"ORDER NOW\".",
        checked: CHECKED
      },
      dunkin: {
        url: "https://www.dunkindonuts.com/",
        source: "The chain's own site: its menu and locator pages on this host were loaded on 2026-11-12 for the " +
          "profile (tools/data/profiles/dunkin.json; ordering starts at the locator's ORDER HERE). The host is no " +
          "longer on the session's allowlist, so the home page itself wasn't loaded in Phase 9.",
        checked: "2026-11-12"
      },
      little_caesars: {
        url: "https://littlecaesars.com/",
        source: "https://www.littlecaesars.com/ answers 301 to https://littlecaesars.com/ (2026-11-16, through the " +
          "session's proxy). That host isn't on the allowlist, so the page itself wasn't loaded; the chain's " +
          "ordering site, order.littlecaesars.com, was loaded for the profile on 2026-11-12.",
        checked: CHECKED
      },
      papa_johns: {
        url: "https://www.papajohns.com/",
        source: "200, title \"Papa Johns Pizza Delivery & Carryout - Best Deals on Pizza, Sides & More\", header " +
          "\"START YOUR ORDER\" (the menu below it fails here as in ISS-024: its scripts' hosts aren't on the allowlist).",
        checked: CHECKED
      },
      subway: {
        url: "https://www.subway.com/",
        source: "302 to https://www.subway.com/en-us (the site picks the locale), title \"Home | Subway®\", \"Start Order\".",
        checked: CHECKED
      },
      the_cheesecake_factory: {
        url: "https://www.thecheesecakefactory.com/",
        source: "200, title \"The Cheesecake Factory | Menu, Locations & Reservations\", header \"ORDER NOW\".",
        checked: CHECKED
      },
      wingstop: {
        url: "https://www.wingstop.com/",
        source: "200, title \"Wingstop\" (the page's content loads from ecomm.wingstop.com, which isn't on the " +
          "allowlist, so it rendered empty here); the host of the profile's menu pages, loaded on 2026-11-12.",
        checked: CHECKED
      }
    }
  };
})(typeof window !== "undefined" ? window : this);
