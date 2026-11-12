/*
 * CARDS: credit cards and their food-relevant credits and delivery memberships (BUILD.md §6, §9.1, D-024).
 * Source:  each issuer's own card page, listed per card in `url` and per credit in `source`:
 *          American Express https://www.americanexpress.com/us/credit-cards/card/<card>/
 *          Chase https://creditcards.chase.com/<category>/<card>
 *          Capital One https://www.capitalone.com/credit-cards/<card>/
 * As of:   2026-11-12
 * Method:  hand-entered by the orchestrator from the issuer pages (D-013). Every credit carries its
 *          tier (universal, or restricted: true, or locked: true), its source URL and its as-of date.
 * Nulls:   none
 * Est:     none. Amounts are the issuers' published maximums per period. Where the terms are unclear the
 *          credit is under-counted on purpose (D-024): Platinum's extra $20 December Uber Cash isn't
 *          counted, the Sapphire Reserve DoorDash promo is limited to delivery orders, and the Brilliant
 *          dining credit is counted only on direct orders. No card is treated as including a membership
 *          it only reimburses (Platinum's Uber One credit).
 */
(function (root) {
  "use strict";

  var AS_OF = "2026-11-12";
  var AMEX = "https://www.americanexpress.com/us/credit-cards/card/";
  var CHASE = "https://creditcards.chase.com/";
  var C1 = "https://www.capitalone.com/credit-cards/";

  function amex(slug) { return AMEX + slug + "/"; }

  root.POD.data.CARDS = [
    // ---------------------------------------------------------------- American Express
    {
      id: "amex_platinum", issuer: "American Express", name: "The Platinum Card",
      url: amex("platinum"), asOf: AS_OF,
      note: "The card doesn't include Uber One: if you buy an auto-renewing Uber One membership with it, you get up to $120 a year back. Turn on Uber One yourself if you have it.",
      credits: [
        { id: "uber_cash", name: "Uber Cash", amount: 15, cadence: "monthly", plats: ["ue"],
          source: amex("platinum"), asOf: AS_OF,
          note: "$15 in Uber Cash each month for U.S. Uber rides and Uber Eats orders. The extra $20 in December is not counted." },
        { id: "resy", name: "Resy credit", amount: 100, cadence: "quarterly", plats: ["direct"], restricted: true,
          source: amex("platinum"), asOf: AS_OF,
          note: "Only at qualifying U.S. Resy restaurants. Turn on \"Qualifies here\" only if this restaurant is on Resy." }
      ]
    },
    {
      id: "amex_gold", issuer: "American Express", name: "American Express Gold Card",
      url: amex("gold-card"), asOf: AS_OF,
      credits: [
        { id: "dining", name: "Dining credit", amount: 10, cadence: "monthly", plats: ["gh"], goldPartner: true,
          source: amex("gold-card"), asOf: AS_OF,
          note: "Grubhub (including Seamless), Buffalo Wild Wings, Five Guys, The Cheesecake Factory and Wonder. Enrollment required." },
        { id: "uber_cash", name: "Uber Cash", amount: 10, cadence: "monthly", plats: ["ue"],
          source: amex("gold-card"), asOf: AS_OF,
          note: "$10 in Uber Cash each month for U.S. Uber Eats orders and rides, once the card is added to your Uber account." },
        { id: "resy", name: "Resy credit", amount: 50, cadence: "semiannual", plats: ["direct"], restricted: true,
          source: amex("gold-card"), asOf: AS_OF,
          note: "Only at qualifying U.S. Resy restaurants (§9.1). Turn on \"Qualifies here\" only if this restaurant is on Resy." },
        { id: "dunkin", name: "Dunkin' credit", amount: 7, cadence: "monthly", plats: ["direct"], restricted: true,
          source: amex("gold-card"), asOf: AS_OF,
          note: "Only at U.S. Dunkin' locations. Enrollment required." }
      ]
    },
    { id: "amex_blue_cash_preferred", issuer: "American Express", name: "Blue Cash Preferred Card",
      url: amex("blue-cash-preferred"), asOf: AS_OF,
      note: "No food or delivery credits. Its Disney streaming credit isn't food.", credits: [] },
    { id: "amex_blue_cash_everyday", issuer: "American Express", name: "Blue Cash Everyday Card",
      url: amex("blue-cash-everyday"), asOf: AS_OF,
      note: "No food or delivery credits. Its Disney streaming credit isn't food.", credits: [] },
    { id: "amex_delta_blue", issuer: "American Express", name: "Delta SkyMiles Blue Card",
      url: amex("delta-skymiles-blue-american-express-card"), asOf: AS_OF,
      note: "No food or delivery credits.", credits: [] },
    {
      id: "amex_delta_gold", issuer: "American Express", name: "Delta SkyMiles Gold Card",
      url: amex("delta-skymiles-gold-american-express-card"), asOf: AS_OF,
      credits: [
        { id: "rideshare", name: "Rideshare credit", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: amex("delta-skymiles-gold-american-express-card"), asOf: AS_OF,
          note: "U.S. rideshare purchases only, after the first card renewal. It can't pay for food delivery." }
      ]
    },
    {
      id: "amex_delta_platinum", issuer: "American Express", name: "Delta SkyMiles Platinum Card",
      url: amex("delta-skymiles-platinum-american-express-card"), asOf: AS_OF,
      credits: [
        { id: "rideshare", name: "Rideshare credit", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: amex("delta-skymiles-platinum-american-express-card"), asOf: AS_OF,
          note: "U.S. rideshare purchases only. It can't pay for food delivery." },
        { id: "resy", name: "Resy credit", amount: 10, cadence: "monthly", plats: ["direct"], restricted: true,
          source: amex("delta-skymiles-platinum-american-express-card"), asOf: AS_OF,
          note: "Only at qualifying U.S. Resy restaurants." }
      ]
    },
    {
      id: "amex_delta_reserve", issuer: "American Express", name: "Delta SkyMiles Reserve Card",
      url: amex("delta-skymiles-reserve-american-express-card"), asOf: AS_OF,
      credits: [
        { id: "rideshare", name: "Rideshare credit", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: amex("delta-skymiles-reserve-american-express-card"), asOf: AS_OF,
          note: "U.S. rideshare purchases only. It can't pay for food delivery." },
        { id: "resy", name: "Resy credit", amount: 20, cadence: "monthly", plats: ["direct"], restricted: true,
          source: amex("delta-skymiles-reserve-american-express-card"), asOf: AS_OF,
          note: "Only at qualifying U.S. Resy restaurants. Enrollment required." }
      ]
    },
    { id: "amex_hilton_honors", issuer: "American Express", name: "Hilton Honors Card",
      url: amex("hilton-honors"), asOf: AS_OF,
      note: "No food or delivery credits.", credits: [] },
    { id: "amex_hilton_surpass", issuer: "American Express", name: "Hilton Honors Surpass Card",
      url: amex("hilton-honors-surpass"), asOf: AS_OF,
      note: "No food or delivery credits. Its Hilton credit only works at Hilton properties.", credits: [] },
    { id: "amex_hilton_aspire", issuer: "American Express", name: "Hilton Honors Aspire Card",
      url: amex("hilton-honors-aspire"), asOf: AS_OF,
      note: "No food or delivery credits. Its resort credit only works at Hilton resorts.", credits: [] },
    { id: "amex_marriott_bevy", issuer: "American Express", name: "Marriott Bonvoy Bevy Card",
      url: amex("marriott-bonvoy-bevy"), asOf: AS_OF,
      note: "No food or delivery credits.", credits: [] },
    {
      id: "amex_marriott_brilliant", issuer: "American Express", name: "Marriott Bonvoy Brilliant Card",
      url: amex("marriott-bonvoy-brilliant"), asOf: AS_OF,
      credits: [
        { id: "dining", name: "Brilliant dining credit", amount: 25, cadence: "monthly", plats: ["direct"],
          source: amex("marriott-bonvoy-brilliant"), asOf: AS_OF,
          note: "Eligible purchases at restaurants worldwide. Counted only on orders paid to the restaurant itself. The page doesn't say whether delivery-app charges count as restaurant purchases, so they aren't counted." }
      ]
    },

    // ---------------------------------------------------------------- Chase
    {
      id: "chase_sapphire_reserve", issuer: "Chase", name: "Chase Sapphire Reserve",
      url: CHASE + "rewards-credit-cards/sapphire/reserve", asOf: AS_OF, membership: "dd",
      note: "Complimentary DashPass when activated by 12/31/2029.",
      credits: [
        { id: "doordash_promo", name: "DoorDash monthly promo", amount: 15, cadence: "monthly", plats: ["dd"], modes: ["d"],
          source: CHASE + "rewards-credit-cards/sapphire/reserve", asOf: AS_OF,
          note: "A $15 promo each month on one qualifying DoorDash order, through 12/31/2029. Chase doesn't say whether pickup orders qualify, so it's counted on delivery only." },
        { id: "doordash_nonrestaurant", name: "DoorDash grocery and essentials promos", amount: 20, cadence: "monthly", plats: [], locked: true,
          source: CHASE + "rewards-credit-cards/sapphire/reserve", asOf: AS_OF,
          note: "Two $10 promos each month for groceries, daily essentials and other non-restaurant orders. Not usable on restaurant food." },
        { id: "rideshare", name: "Lyft ride credit", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: CHASE + "rewards-credit-cards/sapphire/reserve", asOf: AS_OF,
          note: "$10 each month for qualifying Lyft purchases, through 9/30/2027. It can't pay for food delivery." },
        { id: "exclusive_tables", name: "Sapphire Reserve Exclusive Tables dining credit", amount: 150, cadence: "semiannual", plats: ["direct"], restricted: true,
          source: CHASE + "rewards-credit-cards/sapphire/reserve", asOf: AS_OF,
          note: "Only at restaurants in the Sapphire Reserve Exclusive Tables program on OpenTable." }
      ]
    },
    {
      id: "chase_sapphire_preferred", issuer: "Chase", name: "Chase Sapphire Preferred",
      url: CHASE + "rewards-credit-cards/sapphire/preferred", asOf: AS_OF, membership: "dd",
      note: "Complimentary DashPass when activated by 12/31/2029.",
      credits: [
        { id: "doordash_nonrestaurant", name: "DoorDash grocery and retail promo", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: CHASE + "rewards-credit-cards/sapphire/preferred", asOf: AS_OF,
          note: "$10 each month for groceries, retail and other non-restaurant DoorDash orders. Not usable on restaurant food." }
      ]
    },
    {
      id: "chase_freedom_unlimited", issuer: "Chase", name: "Chase Freedom Unlimited",
      url: CHASE + "cash-back-credit-cards/freedom/unlimited", asOf: AS_OF, membership: "dd",
      note: "6 months of complimentary DashPass, then it auto-renews at DoorDash's price. Turn the membership off if yours has ended.",
      credits: [
        { id: "doordash_nonrestaurant", name: "DoorDash non-restaurant discount", amount: 10, cadence: "quarterly", plats: [], locked: true,
          source: CHASE + "cash-back-credit-cards/freedom/unlimited", asOf: AS_OF,
          note: "$10 off one non-restaurant DoorDash order each quarter. Not usable on restaurant food." }
      ]
    },
    {
      id: "chase_freedom_flex", issuer: "Chase", name: "Chase Freedom Flex",
      url: CHASE + "cash-back-credit-cards/freedom/flex", asOf: AS_OF, membership: "dd",
      note: "6 months of complimentary DashPass, then it auto-renews at DoorDash's price. Turn the membership off if yours has ended.",
      credits: [
        { id: "doordash_nonrestaurant", name: "DoorDash non-restaurant discount", amount: 10, cadence: "quarterly", plats: [], locked: true,
          source: CHASE + "cash-back-credit-cards/freedom/flex", asOf: AS_OF,
          note: "$10 off one non-restaurant DoorDash order each quarter. Not usable on restaurant food." }
      ]
    },
    {
      id: "chase_freedom_rise", issuer: "Chase", name: "Chase Freedom Rise",
      url: CHASE + "cash-back-credit-cards/freedom/rise", asOf: AS_OF, membership: "dd",
      note: "6 months of complimentary DashPass, then it auto-renews at DoorDash's price. Turn the membership off if yours has ended.",
      credits: [
        { id: "doordash_nonrestaurant", name: "DoorDash non-restaurant discount", amount: 10, cadence: "quarterly", plats: [], locked: true,
          source: CHASE + "cash-back-credit-cards/freedom/rise", asOf: AS_OF,
          note: "$10 off one non-restaurant DoorDash order each quarter. Not usable on restaurant food." }
      ]
    },
    { id: "chase_doordash_rewards", issuer: "Chase", name: "DoorDash Rewards Mastercard",
      url: CHASE + "cash-back-credit-cards/doordash", asOf: AS_OF, membership: "dd",
      note: "A free year of DashPass for new cardmembers, then it auto-renews at $96/yr. Its cash back isn't a credit, so it isn't counted.",
      credits: [] },
    {
      id: "chase_ink_business_preferred", issuer: "Chase", name: "Ink Business Preferred",
      url: CHASE + "business-credit-cards/ink/business-preferred", asOf: AS_OF, membership: "dd",
      note: "Complimentary DashPass when activated by 12/31/2027.",
      credits: [
        { id: "doordash_nonrestaurant", name: "DoorDash grocery and retail promo", amount: 10, cadence: "monthly", plats: [], locked: true,
          source: CHASE + "business-credit-cards/ink/business-preferred", asOf: AS_OF,
          note: "Up to $10 a month on grocery and retail DoorDash orders. Not usable on restaurant food." }
      ]
    },

    // ---------------------------------------------------------------- Capital One
    { id: "capital_one_venture_x", issuer: "Capital One", name: "Venture X Rewards",
      url: C1 + "venture-x/", asOf: AS_OF,
      note: "No food or delivery credits.", credits: [] },
    { id: "capital_one_savor", issuer: "Capital One", name: "Savor Rewards",
      url: C1 + "savor/", asOf: AS_OF,
      note: "No food or delivery credits. Its 3% dining cash back isn't a credit.", credits: [] }
  ];
})(typeof window !== "undefined" ? window : this);
