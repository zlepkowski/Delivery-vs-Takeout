"""Writes tests/fixtures/insights/cases.json: expected POD.insights.build output (docs/insights-contract.md).

    python3 -I tests/fixtures/insights/build.py tests/fixtures/insights/cases.json

Each case is an engine-ready F (the receipts' _base.json state, patched), a date, and the expected
insights. The expectations come from the Python reference tests/oracle/insights.py (itself on the
engine oracle), never from src/js/insights.js, and the key numbers are re-checked here against
arithmetic worked by hand (HAND below). Edit a case only after the contract changes."""
import copy, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "tests", "oracle"))
import engine as E      # noqa: E402
import insights as I    # noqa: E402

OUT = sys.argv[1]
BASE = json.load(open(os.path.join(ROOT, "tests", "fixtures", "receipts", "_base.json"), encoding="utf-8"))["S"]
BASE["speed"] = 27
NOW = [2026, 10, 14]          # 14 Nov 2026 (month is 0-based, as in JS)
REPLACE = ("cart", "creditOptIn", "markup", "credits", "deal", "menu")


def merge(a, b):
    out = copy.deepcopy(a)
    for k, v in b.items():
        if k in REPLACE or not isinstance(v, dict) or not isinstance(out.get(k), dict):
            out[k] = copy.deepcopy(v)
        else:
            out[k] = merge(out[k], v)
    return out


CASES = []


def case(cid, title, patch, hand, now=NOW, refs=()):
    F = merge(BASE, patch)
    R = E.all_results(F)
    got = I.build(F, R, tuple(now) if now else None)
    for path, want in hand.items():          # hand-worked checks: "insightId.dataKey" or "#ids"
        if path == "#ids":
            have = [x["id"] for x in got]
        elif path.endswith(".text"):
            have = next(x["text"] for x in got if x["id"] == path.split(".")[0])
        elif path.endswith(".cls"):
            have = next(x["cls"] for x in got if x["id"] == path.split(".")[0])
        else:
            iid, key = path.split(".", 1)
            have = next(x["data"] for x in got if x["id"] == iid)[key]
        assert have == want, "%s: %s: hand-worked %r, reference %r" % (cid, path, want, have)
    CASES.append({"id": cid, "title": title, "refs": list(refs), "patch": patch, "now": now,
                  "hand": hand, "expect": got})


DEAL = {"label": "Mix & Match", "price": 5.99, "minItems": 2, "scope": "both"}
MENU_DEAL = copy.deepcopy(BASE["rest"]["menu"])
MENU_DEAL[3]["dealItem"] = True        # Stuffed Cheesy Bread 9.99
MENU_DEAL[4]["dealItem"] = True        # Parmesan Bread Bites 6.99
GOLD = [
    {"key": "amex_gold.dining", "name": "Dining credit", "amount": 10, "cadence": "monthly", "plats": ["gh"], "goldPartner": True},
    {"key": "amex_gold.uber_cash", "name": "Uber Cash", "amount": 10, "cadence": "monthly", "plats": ["ue"]},
    {"key": "amex_gold.resy", "name": "Resy credit", "amount": 50, "cadence": "semiannual", "plats": [], "restricted": True},
    {"key": "amex_gold.dunkin", "name": "Dunkin' credit", "amount": 7, "cadence": "monthly", "plats": [], "restricted": True},
    {"key": "amex_delta_gold.rideshare", "name": "Rideshare credit", "amount": 10, "cadence": "monthly", "plats": [], "locked": True},
    {"key": "amex_delta_platinum.rideshare", "name": "Rideshare credit", "amount": 10, "cadence": "monthly", "plats": [], "locked": True},
]

# R: direct-p 30.70, dd-p 35.19, ue-p 35.19, ue-d 45.10, dd-d 46.10 (receipt r01).
case("base", "Domino's base order: distance (good), fuel (capped), spread", {}, {
    "#ids": ["distance", "fuel", "spread"],
    # fixed = 30.70 - 1.42 drive = 29.28; rate = 4.116/30 + 0.10 = 0.2372; be = (45.10 - 29.28)/0.2372 = 66.69 -> 66.7
    "distance.breakEven": 66.7, "distance.miles": 6.0, "distance.cls": "good",
    "distance.text": "Picking up stays cheaper than delivery up to a 66.7 mi round trip. Yours is 6.0 mi.",
    # be = 4.116 + (45.10 - 30.70) / (6/30) = 4.116 + 72 = 76.116 > 12
    "fuel.capped": True, "fuel.breakEven": 76.12, "fuel.text": "Even at $12.00/gal, picking up still wins.",
    "spread.gap": 15.40,
    "spread.text": "The same order costs $30.70 (Order direct · pickup) to $46.10 (DoorDash · delivery): a $15.40 spread.",
}, refs=["§3.2", "§3.3", "§3.9"])

case("empty-cart", "An empty order gets no advice", {"cart": {}}, {"#ids": []}, refs=["§1"])
case("cart-zero-qty", "A cart whose quantities are all 0 is empty too", {"cart": {"0": 0}}, {"#ids": []}, refs=["§1"])

# cart {0:1, 4:1}: menuSub 21.99 + 6.99 = 28.98; direct-p = 28.98 + tax 2.47 (2.474892) + 1.42 = 32.87.
# + 1 Parmesan (cheapest deal item, 6.99 < 9.99): dealSub = 21.99 + 2 x 5.99 = 33.97; tax 2.90 (2.901038); 33.97 + 2.90 + 1.42 = 38.29
case("unlock", "One item short of a direct-only deal", {
    "rest": {"deal": DEAL, "menu": MENU_DEAL}, "cart": {"0": 1, "4": 1}}, {
    "unlock.n": 1, "unlock.item": "Parmesan Bread Bites (16 pc)", "unlock.channel": "direct-p",
    "unlock.net": 38.29, "unlock.was": 32.87, "unlock.cls": "",
    "unlock.text": "Add 1 × Parmesan Bread Bites (16 pc) and Mix & Match applies: Order direct · pickup comes to $38.29 (now $32.87).",
}, refs=["§3.1"])
# cart {3:1}: one cheesy bread (9.99), deal price 1.00: + 1 Parmesan -> dealSub = 1.00 + 1.00 = 2.00; tax 0.17 (0.1708); 2.00 + 0.17 + 1.42 = 3.59
# now: direct-p = 9.99 + 0.85 (0.853146) + 1.42 = 12.26, the cheapest, so 3.59 <= 12.26 -> good
case("unlock-good", "The deal makes the bigger order cheaper than today's best", {
    "rest": {"deal": dict(DEAL, price=1.0), "menu": MENU_DEAL}, "cart": {"3": 1}}, {
    "unlock.net": 3.59, "unlock.was": 12.26, "unlock.cls": "good",
}, refs=["§3.1"])
case("unlock-scope-delivery", "A delivery-only deal at a chain without direct delivery can't be unlocked", {
    "rest": {"deal": dict(DEAL, scope="delivery"), "menu": MENU_DEAL}, "cart": {"0": 1, "4": 1}}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.1"])
case("unlock-deal-off", "The user switched the deal off", {
    "rest": {"deal": DEAL, "menu": MENU_DEAL}, "cart": {"0": 1, "4": 1}, "dealOn": False}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.1"])
case("unlock-ready", "The deal already applies: nothing to unlock", {
    "rest": {"deal": DEAL, "menu": MENU_DEAL}, "cart": {"3": 1, "4": 1}}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.1"])
MENU_NODEAL_ITEM = copy.deepcopy(BASE["rest"]["menu"])
case("unlock-no-deal-items", "A deal with no flagged menu item", {
    "rest": {"deal": DEAL, "menu": MENU_NODEAL_ITEM}, "cart": {"0": 1}}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.1"])

# dd food 31.11 < 35. + 1 Coke (4.99, the cheapest item): menuSub 31.97, dd food = 31.97 x 1.153 = 36.861 -> 36.86 >= 35.
# dd-p: promo 5, tax (36.86 - 5) x 8.54% = 2.720844 -> 2.72; gross 36.86 + 2.72 + 1.42 = 41.00; net 36.00; delta 36.00 - 35.19 = 0.81
# dd-d: fees 2.99 + 5.53 = 8.52, tax 2.72, tip 5.53; gross 53.63; net 48.63; delta 48.63 - 46.10 = 2.53 -> dd-p wins
case("minimum", "$3.89 short of a $35 DoorDash promo: adding a Coke costs $0.81 more", {
    "promos": {"dd": {"type": "dollar", "value": 5, "cap": 0, "min": 35}}}, {
    "minimum.channel": "dd-p", "minimum.short": 3.89, "minimum.addQty": 1, "minimum.addItem": "Coke® (2 L)",
    "minimum.addAmount": 4.99, "minimum.net": 36.00, "minimum.was": 35.19, "minimum.delta": 0.81, "minimum.cls": "",
    "minimum.text": "DoorDash · pickup is $3.89 short of its $35.00 promo minimum. Adding 1 × Coke® (2 L) ($4.99) brings it to $36.00: $0.81 more than now.",
}, refs=["§3.4", "§9.2"])
# $10 off: dd-p tax (36.86 - 10) x 8.54% = 2.293844 -> 2.29; gross 36.86 + 2.29 + 1.42 = 40.57; net 30.57; delta -4.62
case("minimum-good", "Reaching a $10-off minimum makes the bigger order cheaper", {
    "promos": {"dd": {"type": "dollar", "value": 10, "cap": 0, "min": 35}}}, {
    "minimum.net": 30.57, "minimum.delta": -4.62, "minimum.cls": "good",
    "minimum.text": "DoorDash · pickup is $3.89 short of its $35.00 promo minimum. Adding 1 × Coke® (2 L) ($4.99) brings it to $30.57: $4.62 less than now.",
}, refs=["§3.4"])
case("minimum-freedel-pickup", "A free-delivery promo is never offered on pickup", {
    "promos": {"ue": {"type": "freedel", "value": 0, "cap": 0, "min": 35}}}, {
    "minimum.channel": "ue-d"}, refs=["§3.4"])
# $5 off already applies (31.11 >= 30): dd-p tax (31.11 - 5) x 8.54% = 2.229794 -> 2.23; 31.11 + 2.23 + 1.42 - 5 = 29.76 < 30.70
case("minimum-met", "A promo already met isn't a minimum insight (and its $5 makes dd pickup beat the counter)", {
    "promos": {"dd": {"type": "dollar", "value": 5, "cap": 0, "min": 30}}}, {
    "#ids": ["distance", "fuel", "nuance", "spread"], "nuance.net": 29.76, "nuance.diff": 0.94, "nuance.why": "promo"},
    refs=["§3.4", "§3.8"])
case("minimum-none-type", "type none is ignored even with a minimum", {
    "promos": {"dd": {"type": "none", "value": 5, "cap": 0, "min": 35}}}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.4"])
case("minimum-far", "Twenty of the cheapest item still can't reach the minimum", {
    "promos": {"dd": {"type": "dollar", "value": 5, "cap": 0, "min": 500}}}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.4"])

UNPROF = {
    "rest": {"id": "taco_bell", "name": "Taco Bell", "profiled": False, "menu": [], "deal": None,
             "directDelivery": False, "directSvc": None, "amexGoldDirect": False,
             "platforms": ["dd", "ue", "gh"], "markup": {"dd": 12.6, "ue": 12.6, "gh": 12.6}, "markupEst": True},
    "manualSubtotal": 20, "plats": {"dd": {"markup": 12.6}, "ue": {"markup": 12.6}, "gh": {"markup": 12.6}}}
# gh food 22.52 < 30. ms = ceil(30 / 1.126 x 100) / 100 = ceil(2664.298...) / 100 = 26.65; food 26.65 x 1.126 = 30.0079 -> 30.01 >= 30
case("minimum-unprofiled", "An unprofiled brand: the typed subtotal is raised to reach the minimum", merge(UNPROF, {
    "promos": {"gh": {"type": "dollar", "value": 5, "cap": 0, "min": 30}}}), {
    "minimum.addQty": None, "minimum.addItem": None, "minimum.addAmount": 6.65, "minimum.short": 7.48,
}, refs=["§3.4"])

case("wallet-timing-locked", "Amex Gold at a dining partner, unused credits, locked and restricted credits", {
    "rest": {"amexGoldDirect": True}, "credits": GOLD}, {
    "#ids": ["distance", "fuel", "wallet", "timing", "locked", "spread"],
    "wallet.credit": "amex_gold.dining", "wallet.amount": 10, "wallet.used": False, "wallet.cls": "good",
    "wallet.text": "Domino's is an Amex Gold dining partner, so your $10.00 Dining credit works when you order direct.",
    # 14 Nov: 30 - 14 + 1 = 17 days to 1 Dec
    "timing.total": 20, "timing.cls": "",
    "timing.text": "Unused this period: Dining credit ($10.00, resets in 17 days); Uber Cash ($10.00, resets in 17 days).",
    "locked.locked": ["amex_delta_gold.rideshare", "amex_delta_platinum.rideshare"],
    "locked.restricted": ["amex_gold.resy", "amex_gold.dunkin"],
    "locked.text": "Can't be used on a restaurant order: Rideshare credit. Only at some restaurants (tick “Qualifies here” if this one takes it): Resy credit, Dunkin' credit.",
}, refs=["§3.5", "§3.6", "§3.7", "§9.1"])
GOLD_OPT = copy.deepcopy(GOLD)
GOLD_OPT[0]["used"] = True
GOLD_OPT[2]["plats"] = ["direct"]
case("wallet-used-optin", "The dining credit is used; Resy is opted in, so it leaves Locked and joins Timing", {
    "rest": {"amexGoldDirect": True}, "credits": GOLD_OPT, "creditOptIn": {"amex_gold.resy": True}}, {
    "wallet.used": True, "wallet.cls": "",
    "wallet.text": "Domino's is an Amex Gold dining partner, but your Dining credit is marked used this period.",
    "locked.restricted": ["amex_gold.dunkin"],
    # Nov is in H2: 17 days to 1 Jan? No: H2 runs Jul-Dec, so the reset is 1 Jan 2027: 17 + 31 = 48 days
    "timing.text": "Unused this period: Uber Cash ($10.00, resets in 17 days); Resy credit ($50.00, resets in 48 days).",
}, refs=["§3.5", "§3.6", "§3.7"])
# not a partner: the dining credit stays on gh (Domino's isn't on gh); Uber Cash 10: ue-p 35.19 - 10 = 25.19 < direct-p 30.70
case("wallet-not-partner", "Gold credits at a chain that isn't a dining partner: no Wallet; Uber Cash wins pickup", {"credits": GOLD}, {
    "#ids": ["distance", "fuel", "timing", "locked", "nuance", "spread"], "nuance.net": 25.19, "nuance.why": "credit"},
    refs=["§3.5", "§3.8"])
case("wallet-direct-off", "Direct switched off: no Wallet", {
    "rest": {"amexGoldDirect": True}, "credits": GOLD, "plats": {"direct": {"on": False}}}, {
    "#ids": ["distance", "fuel", "timing", "locked", "spread"]}, refs=["§3.5"])

MANY = [{"key": "k%d" % i, "name": "Credit %d" % i, "amount": 5, "cadence": cad, "plats": ["dd"]}
        for i, cad in enumerate(["annual", "monthly", "quarterly", "semiannual", "monthly"])]
case("timing-new-years-eve", "31 Dec: every period resets tomorrow; four of five listed as 1 day; 'and 2 more'", {"credits": MANY}, {
    "timing.cls": "hot", "timing.total": 25,
    "timing.text": "Unused this period: Credit 0 ($5.00, resets in 1 day); Credit 1 ($5.00, resets in 1 day); Credit 2 ($5.00, resets in 1 day); and 2 more.",
}, now=[2026, 11, 31], refs=["§3.6"])
# 2028 is a leap year: from 10 Feb, monthly = 29 - 10 + 1 = 20; quarterly to 1 Apr = 20 + 31 = 51;
# semiannual to 1 Jul = 51 + 30 + 31 + 30 = 142; annual to 1 Jan 2029 = 366 - 40 = 326
case("timing-leap", "Leap February: the day counts", {"credits": MANY}, {
    "timing.text": "Unused this period: Credit 1 ($5.00, resets in 20 days); Credit 4 ($5.00, resets in 20 days); Credit 2 ($5.00, resets in 51 days); and 2 more.",
}, now=[2028, 1, 10], refs=["§3.6"])
case("timing-week", "Within 7 days is hot", {"credits": MANY[1:2]}, {
    "timing.cls": "hot", "timing.text": "Unused this period: Credit 1 ($5.00, resets in 7 days).",
}, now=[2026, 10, 24], refs=["§3.6"])
ONCE = [{"key": "manual.1", "name": "Gift card", "amount": 20, "cadence": "once", "plats": ["direct"]}]
case("timing-once", "A one-off credit never resets: no Timing", {"credits": ONCE}, {
    "#ids": ["distance", "fuel", "spread"]}, refs=["§3.6"])
# five $5 dd credits: dd-p 35.19 - 25 = 10.19 < 30.70, so Nuance shows; Timing needs a valid date
case("timing-bad-now", "An invalid date: no Timing, the rest unchanged", {"credits": MANY}, {
    "#ids": ["distance", "fuel", "nuance", "spread"], "nuance.net": 10.19}, now=None, refs=["§3.6"])

# Uber Cash 15 on ue: ue-p 35.19 - 15 = 20.19 < direct-p 30.70: diff 10.51
case("nuance-credit", "A card credit makes Uber Eats pickup cheaper than the counter", {
    "credits": [{"key": "amex_platinum.uber_cash", "name": "Uber Cash", "amount": 15, "cadence": "monthly", "plats": ["ue"]}]}, {
    "nuance.channel": "ue-p", "nuance.diff": 10.51, "nuance.why": "credit",
    "nuance.text": "Ordering pickup in Uber Eats beats ordering direct for pickup by $10.51, because your card credit works there.",
}, refs=["§3.8"])
# ue 20% off: promo 31.11 x 20% = 6.222 -> 6.22; tax (31.11 - 6.22) x 8.54% = 2.125606 -> 2.13; gross 31.11 + 2.13 + 1.42 = 34.66; net 28.44
case("nuance-promo", "A 20% Uber Eats promo makes app pickup cheaper than the counter", {
    "promos": {"ue": {"type": "percent", "value": 20, "cap": 0, "min": 0}}}, {
    "nuance.net": 28.44, "nuance.diff": 2.26, "nuance.why": "promo",
}, refs=["§3.8"])
# miles 70: direct-p drive = 9.60 (9.604) + 7.00 = 16.60; direct-p = 26.98 + 2.30 + 16.60 = 45.88 > ue-d 45.10
case("distance-far", "A 70-mile round trip: delivery wins past 66.7 mi; no Fuel (pickup isn't cheaper)", {"miles": 70, "minutes": 156}, {
    "#ids": ["distance", "spread"], "distance.cls": "",
    "distance.text": "Delivery wins once the round trip passes 66.7 mi, and yours is 70.0 mi.",
}, refs=["§3.2"])
# a $30 DoorDash delivery credit: dd-d 46.10 - 30 = 16.10 <= fixed 29.28 -> be < 0
case("distance-negative", "Delivery is cheaper than picking up even at 0 miles", {
    "credits": [{"key": "c.dd", "name": "DD credit", "amount": 30, "cadence": "monthly", "plats": ["dd"], "modes": ["d"]}]}, {
    "distance.cls": "",
    "distance.text": "Delivery (DoorDash · delivery, $16.10) costs less than picking up, even from next door.",
}, refs=["§3.2"])
# a $14 DD delivery credit: dd-d 32.10. Fuel: 4.116 + (32.10 - 30.70) / 0.2 = 11.116 -> 11.12. Distance: (32.10 - 29.28) / 0.2372 = 11.888 -> 11.9
case("fuel-uncapped", "Delivery close behind: the gas break-even is under $12", {
    "credits": [{"key": "c.dd", "name": "DD credit", "amount": 14, "cadence": "monthly", "plats": ["dd"], "modes": ["d"]}]}, {
    "fuel.breakEven": 11.12, "fuel.capped": False, "distance.breakEven": 11.9,
    "fuel.text": "Picking up wins until gas reaches $11.12/gal. Yours costs $4.12/gal.",
}, refs=["§3.3"])
# EV 3.5 mi/kWh at $0.20: rate = 0.2/3.5 + 0.10 = 0.157142857; direct-p drive = round2(6/3.5 x 0.2 = 0.342857) 0.34 + 0.60 = 0.94
# direct-p = 26.98 + 2.30 + 0.94 = 30.22; fixed 29.28; be = (45.10 - 29.28) / 0.157142857 = 100.67 -> 100.7
case("ev", "An EV: no Fuel insight; the distance rate uses kWh", {"fuel": "ev"}, {
    "#ids": ["distance", "spread"], "distance.breakEven": 100.7,
}, refs=["§3.2", "§3.3"])
# hourly $20 at 27 mph: rate = 0.2372 + 20/27 = 0.97794; fixed (miles 0, minutes 0) = 29.28; be = 15.82 / 0.97794 = 16.18 -> 16.2
case("hourly", "Time valued at $20/h adds to the cost of each mile", {"hourly": 20}, {
    "distance.breakEven": 16.2,
}, refs=["§3.2"])
case("one-channel", "Only direct pickup available: no distance, fuel or spread", {
    "plats": {"dd": {"on": False}, "ue": {"on": False}}}, {"#ids": []}, refs=["§3.2", "§3.9"])
case("pickup-only", "Apps without delivery (D-033): no distance or fuel, but nuance/spread still work", {
    "plats": {"dd": {"noDelivery": True}, "ue": {"noDelivery": True}}}, {
    "#ids": ["spread"], "spread.gap": 4.49}, refs=["§3.2", "§3.9", "D-033"])

# ---- edge cases added after the 5.2 review (each pins a boundary a mutant survived)
# rate = 2.5/25 + 0.15 = 0.25; miles 4: direct-p = 26.98 + 2.30 + (0.40 + 0.60) = 30.28, fixed 29.28;
# dd-d 46.10 - 15.82 = 30.28; be = (30.28 - 29.28) / 0.25 = 4.0 == miles exactly -> the "stays cheaper" branch (>=)
case("distance-equal", "Break-even exactly at the trip length: pickup still counts as cheaper (>=)", {
    "mpg": 25, "gas": 2.5, "wear": 0.15, "miles": 4, "minutes": 9,
    "credits": [{"key": "c.dd", "name": "DD credit", "amount": 15.82, "cadence": "monthly", "plats": ["dd"], "modes": ["d"]}]}, {
    "distance.breakEven": 4.0, "distance.cls": "good",
    "distance.text": "Picking up stays cheaper than delivery up to a 4.0 mi round trip. Yours is 4.0 mi.",
}, refs=["§3.2"])
# dd-d 46.10 - 16.83 = 29.27 = fixed - 0.01: be = -0.01 / 0.2372 = -0.042 -> Math.round(-0.42) = -0 -> written as 0
case("distance-negative-zero", "A break-even just below 0 rounds to -0, written as 0", {
    "credits": [{"key": "c.dd", "name": "DD credit", "amount": 16.83, "cadence": "monthly", "plats": ["dd"], "modes": ["d"]}]}, {
    "distance.breakEven": 0, "distance.cls": "",
    "distance.text": "Delivery (DoorDash · delivery, $29.27) costs less than picking up, even from next door.",
}, refs=["§0", "§3.2"])
# ue freedel, min 35, delFee 0, delivery tip 30%: + 1 Coke, ue-d's delta (food +5.75, service +0.86, tax +0.49, tip +1.72, nothing
# waived) is larger than ue-p's would be (food +5.75, tax +0.49), so if pickup weren't excluded it would win.
case("minimum-freedel-pickup-excluded", "Free delivery is never a pickup candidate, even when pickup's delta would be smaller", {
    "plats": {"ue": {"delFee": 0}}, "tipDel": 30, "promos": {"ue": {"type": "freedel", "value": 0, "cap": 0, "min": 35}}}, {
    "minimum.channel": "ue-d",
}, refs=["§3.4"])
# k = 20 Cokes is the first hit: menuSub 21.99 + 21 x 4.99 = 126.78, dd food 126.78 x 1.153 = 146.17734 -> 146.18;
# 19 Cokes: 121.79 x 1.153 = 140.42387 -> 140.42 < 146.18
case("minimum-twentieth", "The 20th added item is the first that reaches the minimum", {
    "promos": {"dd": {"type": "dollar", "value": 5, "cap": 0, "min": 146.18}}}, {
    "minimum.addQty": 20, "minimum.addAmount": 99.8, "minimum.channel": "dd-p",
}, refs=["§3.4"])
# min 25.053 (not a cent value): ms = ceil(25.053 / 1.126 x 100) / 100 = 22.25, food 22.25 x 1.126 = 25.0535 -> 25.05 < 25.053;
# second try 22.26: 25.06476 -> 25.06 >= 25.053. addAmount 22.26 - 20 = 2.26
case("minimum-unprofiled-second-try", "Rounding to the cent falls short once: the second try reaches the minimum", merge(UNPROF, {
    "promos": {"gh": {"type": "dollar", "value": 5, "cap": 0, "min": 25.053}}}), {
    "minimum.addAmount": 2.26, "minimum.channel": "gh-p",
}, refs=["§3.4"])
# D-036: a BOGO counts as a Minimum candidate at a profiled brand (both modes, like dollar).
# ue food 31.11 < 35, short 3.89. + 1 Coke: 25.35447 + 4.99 x 2 x 1.153 = 36.86141 -> 36.86 >= 35, but the BOGO pizza (item 0)
# is still 1 in the cart, so free = 0: no saving. ue-p: tax 36.86 x 8.54% = 3.147844 -> 3.15; 36.86 + 3.15 + 1.42 = 41.43,
# delta 41.43 - 35.19 = 6.24. ue-d: service 5.529 -> 5.53, fees 7.52, tax 3.15, tip 5.53: 53.06, delta 7.96. ue-p wins.
BOGO35 = {"type": "bogo", "value": 0, "cap": 0, "min": 35, "item": 0}
case("minimum-bogo", "A BOGO with a $35 minimum is a candidate; adding a Coke reaches it but one pizza makes nothing free", {
    "promos": {"ue": BOGO35}}, {
    "minimum.channel": "ue-p", "minimum.short": 3.89, "minimum.addQty": 1, "minimum.addItem": "Coke® (2 L)",
    "minimum.addAmount": 4.99, "minimum.net": 41.43, "minimum.was": 35.19, "minimum.delta": 6.24, "minimum.cls": "",
    "minimum.text": "Uber Eats · pickup is $3.89 short of its $35.00 promo minimum. Adding 1 × Coke® (2 L) ($4.99) brings it to $41.43: $6.24 more than now.",
}, refs=["§3.4", "D-036"])
# 2 pizzas: ue food 21.99 x 2 x 1.153 = 50.70894 -> 50.71 < 55 (short 4.29). ue-p now: tax 50.71 x 8.54% = 4.330634 -> 4.33;
# 50.71 + 4.33 + 1.42 = 56.46. + 1 Coke: food 56.46 >= 55, free 1 pizza 25.35: receipt r15's ue-p, 35.19. delta -21.27.
# ue-d now: service 7.6065 -> 7.61, fees 9.60, tax 4.33, tip 7.61: 72.25; with the Coke r15's ue-d 52.70: delta -19.55.
case("minimum-bogo-good", "Two pizzas and a $55 BOGO minimum: one Coke unlocks a free pizza", {
    "cart": {"0": 2}, "promos": {"ue": dict(BOGO35, min=55)}}, {
    "minimum.channel": "ue-p", "minimum.short": 4.29, "minimum.addQty": 1, "minimum.addAmount": 4.99,
    "minimum.net": 35.19, "minimum.was": 56.46, "minimum.delta": -21.27, "minimum.cls": "good",
    "minimum.text": "Uber Eats · pickup is $4.29 short of its $55.00 promo minimum. Adding 1 × Coke® (2 L) ($4.99) brings it to $35.19: $21.27 less than now.",
}, refs=["§3.4", "D-036"])
# An unprofiled brand's BOGO never applies (no menu), so it isn't a candidate: the same state with a dollar promo shows Minimum.
case("minimum-bogo-unprofiled", "An unprofiled brand's BOGO isn't a Minimum candidate", merge(UNPROF, {
    "promos": {"gh": {"type": "bogo", "value": 5, "cap": 0, "min": 30, "item": 0}}}), {
    "#ids": ["distance", "fuel", "spread"],
}, refs=["§3.4", "D-036"])
MENU_BAD = copy.deepcopy(BASE["rest"]["menu"])
MENU_BAD[7] = None            # not in the cart, so the engine prices the order; build returns [] (D-036 guard)
case("menu-entry-not-object", "A menu entry that isn't an object gives no advice", {
    "rest": {"menu": MENU_BAD}}, {"#ids": []}, refs=["§1", "D-036"])

PARTNER_R = [{"key": "x.gold", "name": "Partner credit", "amount": 10, "cadence": "monthly", "plats": [], "restricted": True, "goldPartner": True}]
case("wallet-restricted-partner", "A restricted gold-partner credit not opted in: no Wallet, no Timing; Locked lists it", {
    "rest": {"amexGoldDirect": True}, "credits": PARTNER_R}, {
    "#ids": ["distance", "fuel", "locked", "spread"], "locked.restricted": ["x.gold"],
}, refs=["§3.5", "§3.6", "§9.1"])
PARTNER_O = copy.deepcopy(PARTNER_R)
PARTNER_O[0]["plats"] = ["gh"]
# opted in: the engine applies it at direct (amexGoldDirect): direct-p 30.70 - 10 = 20.70
case("wallet-restricted-partner-opted-in", "Opted in, the same credit shows in Wallet and Timing", {
    "rest": {"amexGoldDirect": True}, "credits": PARTNER_O, "creditOptIn": {"x.gold": True}}, {
    "#ids": ["distance", "fuel", "wallet", "timing", "spread"], "wallet.credit": "x.gold", "spread.gap": 25.40,
}, refs=["§3.5", "§3.6"])

doc = {
    "about": ("Expected POD.insights.build(F, allResults(F), now) for docs/insights-contract.md. F = the receipts' _base.json S "
              "with speed 27, merged with `patch` (objects merge key by key, except cart, creditOptIn, markup, credits, deal and "
              "menu, which replace whole). now = [year, month0, day] as a local date (new Date(y, m, d, 12)), or null for an "
              "invalid Date (new Date(NaN)). `expect` is the full output, compared exactly (id, label, cls, text, data). "
              "`hand` lists the values worked by hand in build.py; the generator asserts the reference agrees."),
    "base": BASE,
    "replace": list(REPLACE),
    "cases": CASES,
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
print("%d insight cases, %d insights" % (len(CASES), sum(len(c["expect"]) for c in CASES)))
