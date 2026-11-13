"""Writes tests/fixtures/state/scenarios.json: hand-worked expectations for POD.state.

    python3 -I tests/fixtures/state/build.py tests/fixtures/state/scenarios.json

Every expected value is closed-form arithmetic from docs/state-contract.md and the engine and
geography contracts (meridian distance = R*pi/180*dLat), never the output of state.js. It imports
nothing from src/ or tests/oracle/. Edit an expectation here only after the contract changes."""
import json, math, sys
OUT = sys.argv[1]
R = 3958.8
K = R * math.pi / 180

def jsround(x):          # Math.round for x >= 0
    f = math.floor(x)
    return f + 1 if x - f >= 0.5 else f
def r1(x): return jsround(x * 10) / 10
def r2(n): return jsround((n + 1e-9) * 100) / 100
def trip(deg): return r1(K * deg * 2 * 1.25)
SPEED = 30
def mins(m): return jsround(m / SPEED * 60)

# ---------------------------------------------------------------- the dataset
zips = []
for i in range(7):
    zips.append("1000%d,%d,-74000,0,NY" % (i + 1, 40000 + 10 * i))
for i in range(7):
    zips.append("2000%d,%d,-110000,1,MT" % (i + 1, 45000 + 10 * i))
S1 = {
    "ZIP_CITIES": ["Alpha", "Beta"],
    "ZIP_PACKED": ";".join(zips),
    "STATES": [["MT", "Montana", 3.5, 0.0], ["NY", "New York", 4.1, 8.875]],
    "GRADE_ADD": {"midgrade": 0.5, "premium": 1.0, "diesel": 2.0},
    "CAR_DATA": ["Acme|Sedan:30,Sport:25*,Truck:20d,Volt:35e", "Zeta|Sedan:40"],
    "BRANDS": {"bg": {"name": "Burger Co", "category": "burger", "wikidata": "Q2", "stores": 50},
               "pz": {"name": "Pizza Co", "category": "pizza", "wikidata": "Q1", "stores": 100},
               "xx": {"name": "Mystery", "category": "other", "wikidata": "Q3", "stores": 10}},
    "BRAND_IDS": ["bg", "pz", "xx"],
    "BRANDS_RUN": "run-S",
    "TILE_INDEX": {"40_-74": 3},
    "TILES": {"40_-74": {"run": "run-S", "s": "0,40100,-74000;1,40030,-74000;1,40050,-74000"}},
    "PROFILES": {"pz": {"menu": [["Large", 20, True], ["Wings", 10, False]],
                        "deal": {"label": "2 large for $15 each", "price": 15, "minItems": 2, "scope": "pickup"},
                        "markup": {"dd": 20, "ue": 25}, "markupEst": False, "directDelivery": True, "directFee": 4,
                        "amexGoldDirect": False, "platforms": ["dd", "ue"]}},
    "CATEGORY_DEFAULTS": {"burger": {"markup": {"dd": 15, "ue": 15, "gh": 15}, "est": True}},
    "CARDS": [
        {"id": "c_gold", "issuer": "X", "name": "Gold", "credits": [
            {"id": "dining", "name": "Dining", "amount": 10, "cadence": "monthly", "plats": ["gh"], "goldPartner": True},
            {"id": "resy", "name": "Resy", "amount": 50, "cadence": "semiannual", "plats": ["direct"], "restricted": True},
            {"id": "ride", "name": "Rides", "amount": 10, "cadence": "monthly", "plats": [], "locked": True}]},
        {"id": "c_dd", "issuer": "Y", "name": "DashCard", "membership": "dd", "credits": [
            {"id": "promo", "name": "DD promo", "amount": 5, "cadence": "quarterly", "plats": ["dd"], "modes": ["d"]}]}],
    "DEFAULTS": {"plats": {"dd": {"delFee": 2.99, "svc": 15, "svcMin": 3, "memberSvc": 5, "memberMin": 12, "pickDisc": 0},
                           "ue": {"delFee": 1.99, "svc": 15, "svcMin": 3, "memberSvc": 5, "memberMin": 15, "pickDisc": 0},
                           "gh": {"delFee": None, "svc": None, "svcMin": None, "memberSvc": None, "memberMin": None, "pickDisc": 0}},
                 "fees": {"smallMin": 10, "smallFee": 2.5, "regFee": 0},
                 "trip": {"wear": 0.11, "kwh": 0.17, "speed": SPEED},
                 "tips": {"tipDel": 15, "tipPick": 0}},
}
D_ABOUT = ("S1: fixture values, not claims about the world. NY ZIPs 10001-10007 sit on longitude -74 at latitudes "
           "40.000, 40.010, ... 40.060; MT ZIPs 20001-20007 on -110 at 45.000 ... 45.060. Tile 40_-74: Burger Co (bg) "
           "at 40.100; Pizza Co (pz) at 40.030 and 40.050, all on -74. Along a meridian, miles = %.9f x degrees. "
           "Speed 30 mph. pz is profiled (dd 20%%, ue 25%%; a pickup deal: 2 flagged items at $15 each); bg is "
           "unprofiled (burger default 15%%); xx's category has no default, so it can't be priced. gh's fees are null." % K)

def ok(partial=False): return {"status": "ok", "need": [], "partial": partial}
OFF = {"status": "off", "need": [], "partial": False}
APP_DEF = lambda p: dict(S1["DEFAULTS"]["plats"][p], on=True, markup=None, member=False, memberOwn=False, cardMember=True)
PROMO0 = {"type": "none", "value": 0, "cap": 0, "min": 0}

SC = []
def sc(cid, refs, steps, expect, work, **kw):
    d = {"id": cid, "refs": refs, "data": "S1", "steps": steps, "expect": expect, "work": work}
    d.update(kw)
    SC.append(d)
def st(call, *args, **kw):
    d = {"call": call, "args": list(args)}
    d.update(kw)
    return d
FR = st("fresh")

# ---------------------------------------------------------------- fresh
sc("fresh: blank state with the defaults", ["§2"], [FR], {
    "address": "", "pos": None, "zip": None, "zipRec": None, "state": None, "tax": None, "gas": None,
    "make": "", "model": "", "fuel": "regular", "mpg": None, "miPerKwh": None, "kwh": 0.17,
    "brand": None, "rest": None, "store": None, "storePicked": False, "cart": {}, "manualSubtotal": 0, "dealOn": True,
    "miles": None, "minutes": None, "speed": SPEED, "milesAuto": True, "milesSrc": None, "milesBy": {},
    "tipDel": 15, "tipPick": 0, "wear": 0.11, "hourly": 0, "regFee": 0, "smallMin": 10, "smallFee": 2.5,
    "cards": [], "credits": [], "creditOptIn": {}, "usedIn": {}, "manualCredits": [],
    "plats": {"direct": {"on": True}, "dd": APP_DEF("dd"), "ue": APP_DEF("ue"), "gh": APP_DEF("gh")},
    "promos": {"dd": PROMO0, "ue": PROMO0, "gh": PROMO0},
    "$missing": ["rest", "tax", "mpg", "gas", "miles", "minutes"],
    "$forEngine": None,
}, "Every default copied from S1.DEFAULTS; gh's null fees stay null. missing: no rest, no tax (no state), regular fuel needs mpg and gas, no trip yet.")
sc("fresh: a default that isn't a finite number becomes null; hourly is always 0", ["§2", "D-032"], [FR], {
    "kwh": None, "speed": None, "tipDel": None, "tipPick": None, "wear": 0.11, "hourly": 0, "regFee": None,
    "plats.dd.delFee": None, "plats.dd.svc": 15,
}, "kwh is the string \"0.17\", speed is 0? no: speed is missing, tips table is empty, fees has only smallMin/smallFee, dd.delFee is NaN-like (a string).",
   patch={"DEFAULTS": {"plats": {"dd": {"delFee": "2.99", "svc": 15, "svcMin": 3, "memberSvc": 5, "memberMin": 12, "pickDisc": 0},
                                 "ue": S1["DEFAULTS"]["plats"]["ue"], "gh": S1["DEFAULTS"]["plats"]["gh"]},
                       "fees": {"smallMin": 10, "smallFee": 2.5},
                       "trip": {"wear": 0.11, "kwh": "0.17"}, "tips": {}}})
SC[-1]["work"] = "kwh is the string \"0.17\" and speed is absent -> null; tips {} -> both null; fees lacks regFee -> null; dd.delFee is the string \"2.99\" -> null. hourly is 0 by BUILD.md §4.2, not a default."
sc("fresh: no DEFAULTS table at all", ["§2"], [FR], {
    "kwh": None, "speed": None, "wear": None, "tipDel": None, "hourly": 0, "plats.dd.delFee": None, "plats.dd.pickDisc": None,
    "plats.dd.on": True, "plats.dd.cardMember": True,
}, "Every default is null; the switches keep their fresh values.", patch={"DEFAULTS": None})

# ---------------------------------------------------------------- address and position
z = lambda code, la, st_: {"z": code, "la": la, "lo": -74 if st_ == "NY" else -110, "c": "Alpha" if st_ == "NY" else "Beta", "st": st_}
sc("setAddress: the ZIP sets state, tax, gas and the position", ["§4.3", "§4.2"],
   [FR, st("setAddress", "123 Main St, New York, NY 10004", returns=ok())], {
    "address": "123 Main St, New York, NY 10004", "zip": "10004", "zipRec": z("10004", 40.03, "NY"), "state": "NY",
    "pos": {"lat": 40.03, "lon": -74, "src": "zip"}, "tax": 8.875, "gas": 4.1, "miles": None, "milesSrc": None,
}, "10004 is the 4th NY ZIP: 40.030, -74. NY row: gas 4.1, tax 8.875; regular fuel adds 0. No brand yet, so autoMiles step 2: miles null.")
sc("setAddress: the last 5-digit run wins over a 5-digit house number", ["§4.3"],
   [FR, st("setAddress", "12345 Elm Rd, Big Sky, MT 20003")], {"zip": "20003", "state": "MT", "tax": 0.0, "gas": 3.5,
    "pos": {"lat": 45.02, "lon": -110, "src": "zip"}}, "12345 is a house number; 20003 is the last 5-digit run. MT: gas 3.5, tax 0.")
sc("setAddress: ZIP+4", ["§4.3"], [FR, st("setAddress", "Suite 4, NY 10004-1234")], {"zip": "10004", "state": "NY"}, "")
sc("setAddress: two ZIPs, the last one counts", ["§4.3"], [FR, st("setAddress", "from 10004 to 20003")], {"zip": "20003", "state": "MT"}, "")
sc("setAddress: a longer digit run isn't a ZIP", ["§4.3"], [FR, st("setAddress", "order 1000412")],
   {"zip": None, "zipRec": None, "state": None, "pos": None, "tax": None, "gas": None}, "1000412 is 7 digits; no standalone 5-digit run.")
sc("setAddress: no ZIP", ["§4.3"], [FR, st("setAddress", "10004"), st("setAddress", "no zip here")],
   {"address": "no zip here", "zip": None, "zipRec": None, "state": None, "pos": None, "tax": None, "gas": None},
   "A first address set NY; the second has no ZIP, so the location is cleared, not kept.")
sc("setAddress: an unknown ZIP keeps the code and clears the rest", ["§4.3"], [FR, st("setAddress", "ZIP 99999")],
   {"zip": "99999", "zipRec": None, "state": None, "pos": None, "tax": None}, "")
sc("setAddress: a non-string becomes an empty address", ["§6"], [FR, st("setAddress", 10004)],
   {"address": "", "zip": None}, "")
sc("setPosition: GPS finds the nearest ZIP", ["§6", "§4.3"], [FR, st("setPosition", 40.0, -74.0, returns=ok())], {
    "pos": {"lat": 40, "lon": -74, "src": "gps"}, "zip": "10001", "zipRec": z("10001", 40.0, "NY"), "state": "NY", "tax": 8.875,
    "address": ""}, "40.000, -74.000 is exactly 10001's centroid.")
sc("setPosition: out of range changes nothing", ["§6"], [FR, st("setAddress", "20003"), st("setPosition", 91, 0, returns=None)],
   {"state": "MT", "pos": {"lat": 45.02, "lon": -110, "src": "zip"}}, "")
sc("setAddress after GPS: the typed address wins", ["§6"], [FR, st("setPosition", 40.0, -74.0), st("setAddress", "20003")],
   {"pos": {"lat": 45.02, "lon": -110, "src": "zip"}, "state": "MT"}, "")

# ---------------------------------------------------------------- car
sc("setCar: premium adds GRADE_ADD.premium", ["§4.1", "§4.2"], [FR, st("setAddress", "10004"), st("setCar", "Acme", "Sport")],
   {"fuel": "premium", "mpg": 25, "miPerKwh": None, "gas": 5.1}, "Sport:25* -> premium, 25 mpg. NY 4.1 + 1.0 = 5.1.")
sc("setCar: diesel", ["§4.1"], [FR, st("setAddress", "10004"), st("setCar", "Acme", "Truck")],
   {"fuel": "diesel", "mpg": 20, "gas": 6.1}, "Truck:20d. 4.1 + 2.0.")
sc("setCar: electric", ["§4.1"], [FR, st("setAddress", "10004"), st("setCar", "Acme", "Volt")],
   {"fuel": "ev", "miPerKwh": 3.5, "mpg": None, "gas": 4.1}, "Volt:35e -> 35 / 10 = 3.5 mi/kWh. EV gas is the regular price (unused).")
sc("setCar: same model name under another make", ["§4.1"], [FR, st("setCar", "Zeta", "Sedan")], {"fuel": "regular", "mpg": 40}, "")
sc("setCar: an unknown car keeps the user's own fuel and mpg", ["§4.1"],
   [FR, st("setAddress", "10004"), st("setCar", "Acme", "Sedan"), st("setCar", "Other", ""),
    st("setPath", "mpg", 33, returns=True), st("setPath", "fuel", "premium", returns=True), st("applyState")],
   {"make": "Other", "model": "", "fuel": "premium", "mpg": 33, "gas": 5.1},
   "Sedan sets regular/30; Other isn't in CAR_DATA, so nothing changes; the user then types 33 mpg and premium, and applyState adds the premium spread.")
sc("setCar: an unknown model under a known make changes nothing", ["§4.1"], [FR, st("setCar", "Acme", "Hover")],
   {"fuel": "regular", "mpg": None}, "")

# ---------------------------------------------------------------- brand and trip
pz_store = {"id": "pz@40030,-74000", "lat": 40.03, "lon": -74}
m_pz = trip(0.03); m_bg = trip(0.10); m_pz2 = trip(0.05)
sc("setBrand: a profiled brand, its markups and the nearest store", ["§6", "§4.4", "§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz", returns=ok())], {
    "brand": "pz", "rest.id": "pz", "rest.profiled": True, "rest.directFee": 4,
    "plats.dd.markup": 20, "plats.ue.markup": 25, "plats.gh.markup": None,
    "cart": {}, "dealOn": True, "store": pz_store, "storePicked": False, "milesSrc": "store",
    "miles": m_pz, "minutes": mins(m_pz)},
   "From 40.000: pz stores at 0.030 and 0.050 deg; nearest 0.030 = %.6f mi straight; trip round1(x 2.5) = %.1f; minutes round(%.1f / 30 x 60) = %d. gh isn't in pz's markup -> null." % (K * 0.03, m_pz, m_pz, mins(m_pz)))
sc("setBrand: tiles not loaded -> need, and no distance is invented", ["§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz", returns={"status": "need", "need": ["40_-74"], "partial": False})],
   {"miles": None, "minutes": None, "store": None, "milesSrc": None, "rest.id": "pz"}, "", patch={"TILES": {}})
spacing = (K * (0.01 + 0.02 + 0.03 + 0.04 + 0.05 + 0.06)) / 6
raw = 0.45 * math.sqrt(14 / 100) * spacing ** 0.75
sc("setBrand: a tile failed -> the estimator, partial", ["§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz", opts={"failed": {"40_-74": True}}, returns=ok(True))],
   {"miles": 1.0, "minutes": 2, "milesSrc": "estimate", "store": None},
   "No store data, so estimateMiles: spacing from 40.000 = mean of 0.01..0.06 deg = %.6f mi; zipsPerStore 14/100; raw 0.45 x sqrt(0.14) x spacing^0.75 = %.6f -> clamped to 0.4; round 1.0; minutes 1.0/30 x 60 = 2." % (spacing, raw),
   patch={"TILES": {}})
NEED_T = {"status": "need", "need": ["40_-74"], "partial": False}
sc("need after a brand change clears the old brand's distance", ["§4.5", "D-031"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz", returns=NEED_T), st("pinMiles", 7, returns=True),
    st("setBrand", "bg", returns=NEED_T)],
   {"brand": "bg", "miles": None, "minutes": None, "milesSrc": None, "milesAuto": True, "store": None, "milesBy": {"pz": 7},
    "$missing": ["mpg", "miles", "minutes"]},
   "bg has no pin, so autoMiles asks for tile 40_-74 and clears the trip. (Before the 4.3 review, pz's 7-mile pin stayed in S and bg would have been priced at it.) No car yet, so mpg is missing too (gas is NY's regular price, 4.1: it comes from the state, not the car).",
   patch={"TILES": {}})
sc("unpinMiles while tiles load clears the pinned distance", ["§4.5", "§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pinMiles", 7), st("unpinMiles", returns=NEED_T)],
   {"miles": None, "minutes": None, "milesSrc": None, "milesAuto": True, "milesBy": {}}, "", patch={"TILES": {}})
sc("a move while tiles load clears the old address's distance", ["§4.5", "§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz", returns=ok()),
    st("setAddress", "20003", returns={"status": "need", "need": ["45_-110"], "partial": False})],
   {"state": "MT", "miles": None, "minutes": None, "milesSrc": None, "store": None},
   "At 10001 the pz store gives 5.2. From 20003 (45.020, -110) the 5-mile circle touches cells 44/45 x -111/-110, and only 45_-110 is in the index, with no tile loaded: need [45_-110], and the 5.2 from New York is cleared.",
   patch={"TILE_INDEX": {"40_-74": 3, "45_-110": 1}})
sc("pinMiles, then a pin is per brand", ["§6", "§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pinMiles", 7, returns=True),
    st("setBrand", "bg", returns=ok())], {
    "milesBy": {"pz": 7}, "milesAuto": True, "miles": m_bg, "minutes": mins(m_bg), "milesSrc": "store",
    "store": {"id": "bg@40100,-74000", "lat": 40.1, "lon": -74}, "rest.profiled": False,
    "plats.dd.markup": 15, "plats.ue.markup": 15, "plats.gh.markup": 15},
   "pz pinned at 7. bg has no pin: its store at 0.100 deg = %.6f mi, trip %.1f, minutes %d. bg is unprofiled: burger default 15 on all three." % (K * 0.1, m_bg, mins(m_bg)))
sc("setBrand restores the brand's pin", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pinMiles", 7), st("setBrand", "bg"),
    st("setBrand", "pz", returns=OFF)], {
    "miles": 7, "minutes": 14, "milesAuto": False, "milesSrc": "pinned", "store": None, "milesBy": {"pz": 7}},
   "Back to pz: its pin 7 comes back; minutes 7/30 x 60 = 14.")
sc("unpinMiles goes back to the nearest store", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pinMiles", 7), st("unpinMiles", returns=ok())],
   {"milesBy": {}, "milesAuto": True, "miles": m_pz, "milesSrc": "store", "store": pz_store}, "")
sc("pinMiles rejects bad input", ["§6"], [FR, st("pinMiles", -1, returns=False), st("pinMiles", "7", returns=False)],
   {"miles": None, "milesAuto": True}, "")
sc("pinMiles keeps the value as typed", ["§6"], [FR, st("pinMiles", 7.25, returns=True)],
   {"miles": 7.25, "minutes": 15, "milesBy": {}}, "No brand: no milesBy entry. 7.25/30 x 60 = 14.5 -> 15 (half up).")
sc("setBrand: a brand whose category has no default can't be priced", ["§4.4", "§7"],
   [FR, st("setAddress", "10001"), st("setCar", "Acme", "Sedan"), st("setBrand", "xx", returns=ok())], {
    "rest": None, "plats.dd.markup": None, "plats.ue.markup": None, "plats.gh.markup": None, "miles": None,
    "$missing": ["rest", "miles", "minutes"]}, "restFor gives null (engine contract §2.1), so autoMiles step 2 clears the trip.")
sc("setBrand keeps manualSubtotal and empties the cart", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("setQty", 0, 2, returns=True),
    st("setPath", "manualSubtotal", 25, returns=True), st("setBrand", "bg")],
   {"cart": {}, "manualSubtotal": 25, "dealOn": True}, "")
sc("setQty", ["§6"],
   [FR, st("setQty", 0, 1, returns=False), st("setAddress", "10001"), st("setBrand", "pz"),
    st("setQty", 0, 2, returns=True), st("setQty", 1, 3, returns=True), st("setQty", 1, 0, returns=True),
    st("setQty", 2, 1, returns=False), st("setQty", 0, 1.5, returns=False), st("setQty", -1, 1, returns=False),
    st("setQty", "0", 1, returns=False)],
   {"cart": {"0": 2}}, "No rest -> false. Index 2 is past the 2-item menu; 1.5 isn't an integer; -1 and \"0\" aren't valid indexes. qty 0 deletes.")
sc("setQty on an unprofiled brand is refused", ["§6"], [FR, st("setAddress", "10001"), st("setBrand", "bg"), st("setQty", 0, 1, returns=False)],
   {"cart": {}}, "")
sc("derive never resets a user field", ["§4.7"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("setQty", 0, 2), st("pinMiles", 7),
    st("setPath", "dealOn", False, returns=True), st("derive", returns=OFF)],
   {"cart": {"0": 2}, "miles": 7, "milesAuto": False, "dealOn": False, "rest.id": "pz"}, "")
pz2 = {"id": "pz@40050,-74000", "lat": 40.05, "lon": -74}
pick = {"id": "pz@40050,-74000", "brand": "pz", "name": "Pizza Co", "category": "pizza", "profiled": True,
        "lat": 40.05, "lon": -74, "mi": round(K * 0.05, 9), "trip": m_pz2}
sc("pickStore: a picked store sets the trip", ["§6", "§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pickStore", pick, returns=ok())],
   {"store": pz2, "storePicked": True, "milesAuto": True, "miles": m_pz2, "minutes": mins(m_pz2), "milesSrc": "store"},
   "0.050 deg = %.6f mi -> trip %.1f, minutes %d." % (K * 0.05, m_pz2, mins(m_pz2)))
m_moved = trip(0.04)
sc("pickStore: the picked store survives a move; the trip is re-measured", ["§4.5"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pickStore", pick), st("setAddress", "10002", returns=ok())],
   {"store": pz2, "storePicked": True, "miles": m_moved, "minutes": mins(m_moved)},
   "From 40.010 to the picked 40.050: 0.040 deg -> trip %.1f (the nearest store, 40.030, would be 0.020)." % m_moved)
sc("pickStore: another brand's store switches the brand", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("setQty", 0, 2),
    st("pickStore", {"id": "bg@40100,-74000", "brand": "bg", "lat": 40.1, "lon": -74, "trip": m_bg}, returns=ok())],
   {"brand": "bg", "rest.profiled": False, "cart": {}, "store": {"id": "bg@40100,-74000", "lat": 40.1, "lon": -74},
    "storePicked": True, "miles": m_bg}, "setBrand runs first (cart emptied).")
sc("pickStore overrides a pin", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pinMiles", 7), st("pickStore", pick)],
   {"milesAuto": True, "milesBy": {}, "miles": m_pz2}, "")
sc("pickStore rejects a malformed store", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pickStore", {"brand": "pz", "lat": 40.05, "lon": -74}, returns=None),
    st("pickStore", {"id": "pz@1,1", "brand": "pz", "lat": "40.05", "lon": -74}, returns=None)],
   {"store": pz_store, "storePicked": False}, "No id; then a string lat.")
sc("pickStore refuses a store id from another brand, or out of range", ["§6", "D-031"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"),
    st("pickStore", {"id": "bg@40100,-74000", "brand": "pz", "lat": 40.1, "lon": -74}, returns=None),
    st("pickStore", {"id": "pz@40050,-74000", "brand": "pz", "lat": 91, "lon": -74}, returns=None)],
   {"brand": "pz", "store": pz_store, "storePicked": False, "miles": m_pz, "milesSrc": "store"},
   "The id says bg but the brand says pz; then a latitude of 91. Both are refused and nothing changes.")
sc("setBrand clears a picked store", ["§6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("pickStore", pick), st("setBrand", "pz")],
   {"storePicked": False, "store": pz_store, "miles": m_pz}, "Re-selecting the brand starts over at the nearest store.")
sc("speed change: applyMinutes", ["§4.6"],
   [FR, st("setAddress", "10001"), st("setBrand", "pz"), st("setPath", "speed", 20, returns=True), st("applyMinutes")],
   {"minutes": jsround(m_pz / 20 * 60)}, "%.1f / 20 x 60." % m_pz)

# ---------------------------------------------------------------- wallet
NOW = "2026-11-13T12:00:00"
def cred(card, c, plats, used=False, modes=None):
    d = {"key": card + "." + c["id"], "cardId": card, "name": c["name"], "amount": c["amount"], "cadence": c["cadence"],
         "plats": plats, "restricted": bool(c.get("restricted")), "locked": bool(c.get("locked")),
         "goldPartner": bool(c.get("goldPartner")), "used": used, "manual": False}
    if modes is not None:
        d["modes"] = modes
    return d
G = {c["id"]: c for c in S1["CARDS"][0]["credits"]}
P = S1["CARDS"][1]["credits"][0]
gold = lambda used=False, resy=None: [cred("c_gold", G["dining"], ["gh"], used), cred("c_gold", G["resy"], resy or []), cred("c_gold", G["ride"], [])]
sc("toggleCard: credits with their tiers", ["§5.1", "§9.1"],
   [FR, st("toggleCard", "c_gold", True, returns=True)],
   {"cards": ["c_gold"], "credits": gold(), "plats.dd.member": False},
   "resy is restricted and not opted in -> plats []; ride is locked -> []. No card has a membership.")
sc("toggleCard: credits follow D.CARDS order, not toggle order; a card membership turns the app's on", ["§5.1", "§5.4"],
   [FR, st("toggleCard", "c_dd", True), st("toggleCard", "c_gold", True)],
   {"cards": ["c_dd", "c_gold"], "credits": gold() + [cred("c_dd", P, ["dd"], modes=["d"])],
    "plats.dd.member": True, "plats.ue.member": False}, "")
sc("cardMember off, memberOwn on", ["§5.4"],
   [FR, st("toggleCard", "c_dd", True), st("setPath", "plats.dd.cardMember", False, returns=True), st("syncCredits"),
    st("setPath", "plats.ue.memberOwn", True, returns=True), st("syncCredits")],
   {"plats.dd.member": False, "plats.ue.member": True, "plats.gh.member": False}, "")
sc("setOptIn: a restricted credit applies only after opt-in", ["§5.1", "§6"],
   [FR, st("toggleCard", "c_gold", True), st("setOptIn", "c_gold.resy", True, returns=True)],
   {"creditOptIn": {"c_gold.resy": True}, "credits": gold(resy=["direct"])}, "")
sc("setOptIn off deletes the key", ["§6"],
   [FR, st("toggleCard", "c_gold", True), st("setOptIn", "c_gold.resy", True), st("setOptIn", "c_gold.resy", False)],
   {"creditOptIn": {}, "credits": gold()}, "")
sc("setOptIn never un-locks a locked credit", ["§5.1"],
   [FR, st("toggleCard", "c_gold", True), st("setOptIn", "c_gold.ride", True)],
   {"credits.2.plats": []}, "")
sc("markUsed: used this month, reset next month", ["§5.2", "§6"],
   [FR, st("toggleCard", "c_gold", True), st("markUsed", "c_gold.dining", True, returns=True),
    st("syncCredits", now="2026-12-01T12:00:00")],
   {"usedIn": {"c_gold.dining": "2026-11"}, "credits.0.used": False},
   "Marked in 2026-11; on 2026-12-01 the period is 2026-12, so it reads unused (usedIn keeps the old entry).")
sc("markUsed: still used later in the same month", ["§5.2"],
   [FR, st("toggleCard", "c_gold", True), st("markUsed", "c_gold.dining", True), st("syncCredits", now="2026-11-30T12:00:00")],
   {"credits.0.used": True}, "")
sc("markUsed: quarterly and semiannual periods", ["§5.2"],
   [FR, st("toggleCard", "c_dd", True), st("toggleCard", "c_gold", True), st("markUsed", "c_dd.promo", True),
    st("markUsed", "c_gold.resy", True), st("syncCredits", now="2026-12-31T12:00:00")],
   {"usedIn": {"c_dd.promo": "2026-Q4", "c_gold.resy": "2026-H2"}, "credits.3.used": True, "credits.1.used": True},
   "Nov is in Q4 and H2; Dec 31 is still both.")
sc("markUsed: a new quarter resets it", ["§5.2"],
   [FR, st("toggleCard", "c_dd", True), st("markUsed", "c_dd.promo", True), st("syncCredits", now="2027-01-02T12:00:00")],
   {"credits.0.used": False}, "")
sc("markUsed off; an unknown key is refused", ["§6"],
   [FR, st("toggleCard", "c_gold", True), st("markUsed", "c_gold.dining", True), st("markUsed", "c_gold.dining", False, returns=True),
    st("markUsed", "c_gold.nope", True, returns=False)],
   {"usedIn": {}, "credits.0.used": False}, "")
sc("syncCredits keeps opt-ins and used flags across a card toggle", ["§5.1"],
   [FR, st("toggleCard", "c_gold", True), st("setOptIn", "c_gold.resy", True), st("markUsed", "c_gold.dining", True),
    st("toggleCard", "c_gold", False, returns=True), st("toggleCard", "c_gold", True)],
   {"cards": ["c_gold"], "credits": gold(used=True, resy=["direct"]), "creditOptIn": {"c_gold.resy": True},
    "usedIn": {"c_gold.dining": "2026-11"}}, "Off then on: the credits come back with the same opt-in and used flag.")
sc("toggleCard: an unknown card is refused; on twice doesn't duplicate", ["§6"],
   [FR, st("toggleCard", "c_zz", True, returns=False), st("toggleCard", "c_gold", True), st("toggleCard", "c_gold", True)],
   {"cards": ["c_gold"]}, "")
man1 = {"key": "manual.1", "cardId": None, "name": "Gift card", "amount": 20, "cadence": "once", "plats": ["direct"],
        "restricted": False, "locked": False, "goldPartner": False, "used": False, "manual": True}
sc("addManualCredit: kept through card toggles, last in the list", ["§5.3"],
   [FR, st("addManualCredit", {"name": "Gift card", "amount": 20, "plats": ["direct"]}, returns="manual.1"),
    st("toggleCard", "c_gold", True)],
   {"manualCredits": [{"key": "manual.1", "name": "Gift card", "amount": 20, "cadence": "once", "plats": ["direct"]}],
    "credits": gold() + [man1]}, "")
sc("addManualCredit: keys count up; a removed key isn't reused", ["§5.3", "§6"],
   [FR, st("addManualCredit", {"name": "A", "amount": 5, "plats": ["dd"]}),
    st("addManualCredit", {"name": "B", "amount": 6, "plats": ["ue"], "modes": ["p"], "cadence": "monthly"}, returns="manual.2"),
    st("removeManualCredit", "manual.1", returns=True),
    st("addManualCredit", {"name": "C", "amount": 7, "plats": ["gh"]}, returns="manual.3"),
    st("removeManualCredit", "manual.9", returns=False)],
   {"manualCredits": [{"key": "manual.2", "name": "B", "amount": 6, "cadence": "monthly", "plats": ["ue"], "modes": ["p"]},
                      {"key": "manual.3", "name": "C", "amount": 7, "cadence": "once", "plats": ["gh"]}],
    "credits.0.modes": ["p"], "credits.0.used": False}, "After removing manual.1, the largest is 2, so the next is manual.3.")
sc("addManualCredit rejects bad credits", ["§5.3"],
   [FR, st("addManualCredit", {"name": "", "amount": 5, "plats": ["dd"]}, returns=None),
    st("addManualCredit", {"name": "X", "amount": 0, "plats": ["dd"]}, returns=None),
    st("addManualCredit", {"name": "X", "amount": 5, "plats": ["doordash"]}, returns=None),
    st("addManualCredit", {"name": "X", "amount": 5, "plats": ["dd"], "cadence": "weekly"}, returns=None),
    st("addManualCredit", {"name": "X", "amount": 5, "plats": ["dd"], "modes": ["x"]}, returns=None),
    st("addManualCredit", "gift", returns=None)],
   {"manualCredits": [], "credits": []}, "")
sc("a once-credit stays used until unmarked", ["§5.2"],
   [FR, st("addManualCredit", {"name": "Gift card", "amount": 20, "plats": ["direct"]}),
    st("markUsed", "manual.1", True, returns=True), st("syncCredits", now="2030-01-01T12:00:00")],
   {"usedIn": {"manual.1": "once"}, "credits.0.used": True}, "")

# ---------------------------------------------------------------- readiness and the engine
GH_MISSING = ["plats.gh.markup", "plats.gh.delFee", "plats.gh.svc", "plats.gh.svcMin", "plats.gh.memberSvc", "plats.gh.memberMin"]
setup = [FR, st("setAddress", "10001"), st("setCar", "Acme", "Sedan"), st("setBrand", "pz"), st("setQty", 0, 2)]
# hand-worked receipts (engine contract §5) for pz, cart {"0": 2}, NY 8.875%, Acme Sedan 30 mpg at $4.10, wear 0.11, miles 5.2
food = 40; deal = 30
energy = r2(m_pz / 30 * 4.1); wearc = r2(m_pz * 0.11); drive = r2(energy + wearc)
dp = r2(deal + 0 + r2(deal * 8.875 / 100) + 0 + drive)
dd_food = r2(food * 1.2); ue_food = r2(food * 1.25)
dd_d = r2(dd_food + r2(2.99 + r2(max(dd_food * 15 / 100, 3))) + r2(dd_food * 8.875 / 100) + r2(dd_food * 0.15))
dd_p = r2(dd_food + r2(dd_food * 8.875 / 100) + drive)
dir_d = r2(food + 4 + r2(food * 8.875 / 100) + r2(food * 0.15))
ue_p = r2(ue_food + r2(ue_food * 8.875 / 100) + drive)
ue_d = r2(ue_food + r2(1.99 + r2(max(ue_food * 15 / 100, 3))) + r2(ue_food * 8.875 / 100) + r2(ue_food * 0.15))
sc("ready: missing is empty, gh is switched off for the engine", ["§7", "D-032"], setup, {
    "$missing": [], "$appMissing.dd": [], "$appMissing.ue": [], "$appMissing.gh": GH_MISSING,
    "$forEngine.plats.gh.on": False, "$forEngine.plats.dd.on": True, "plats.gh.on": True,
    "$calc.direct-p.net": dp, "$calc.direct-d.net": dir_d, "$calc.dd-d.net": dd_d, "$calc.dd-p.net": dd_p,
    "$calc.ue-p.net": ue_p, "$calc.ue-d.net": ue_d,
    "$allResults.ids": ["direct-p", "dd-p", "direct-d", "ue-p", "dd-d", "ue-d"]},
   ("pz, cart {0: 2}: menuSub 40; the pickup deal (2 flagged items) makes direct-p 2 x 15 = 30. Trip %.1f mi: gas round2(%.1f/30 x 4.10) = %.2f, wear round2(%.1f x 0.11) = %.2f, drive %.2f. "
    "direct-p: 30 + tax round2(2.6625)=2.66 + drive = %.2f. direct-d: 40 + fee 4 + tax 3.55 + tip 6 = %.2f. "
    "dd: food 48 (20%%). dd-d: 48 + (2.99 + max(7.2, 3)) + tax 4.26 + tip 7.2 = %.2f. dd-p: 48 + 4.26 + drive = %.2f. "
    "ue: food 50 (25%%). ue-p: 50 + tax round2(4.4375)=4.44 + drive = %.2f. ue-d: 50 + (1.99 + 7.5) + 4.44 + 7.5 = %.2f. gh: not in pz's platforms, and switched off anyway.")
   % (m_pz, m_pz, energy, m_pz, wearc, drive, dp, dir_d, dd_d, dd_p, ue_p, ue_d))
dd_food_m = dd_food
dd_d_m_gross = r2(dd_food + r2(0 + r2(max(dd_food * 5 / 100, 3))) + r2(dd_food * 8.875 / 100) + r2(dd_food * 0.15))
sc("ready: a card's membership and credit reach the engine", ["§5.4", "§5.1", "§7"],
   setup + [st("toggleCard", "c_dd", True)], {
    "$calc.dd-d.net": r2(dd_d_m_gross - 5), "$calc.dd-d.member": "DashPass", "$calc.dd-p.net": dd_p},
   "DashPass via c_dd: food 48 >= 12, delivery 0, service max(48 x 5%% = 2.4, 3) = 3; gross 48 + 3 + 4.26 + 7.2 = %.2f; the DD promo ($5, dd, delivery only) -> %.2f. Pickup unchanged." % (dd_d_m_gross, r2(dd_d_m_gross - 5)))
sc("ready: an EV needs miPerKwh and kwh, not mpg and gas", ["§7"],
   [FR, st("setAddress", "10001"), st("setCar", "Acme", "Volt"), st("setBrand", "pz")], {"$missing": []}, "")
sc("ready: an unprofiled brand needs a valid manualSubtotal", ["§7"],
   [FR, st("setAddress", "10001"), st("setCar", "Acme", "Sedan"), st("setBrand", "bg"), st("setPath", "manualSubtotal", -1)],
   {"$missing": ["manualSubtotal"], "$forEngine": None, "$appMissing.gh": GH_MISSING[1:]}, "bg has gh in its platforms and a gh markup (15), so only gh's fees are missing.")
sc("ready: a null tip blocks everything", ["§7", "D-032"],
   [FR, st("setAddress", "10001"), st("setCar", "Acme", "Sedan"), st("setBrand", "pz"), st("setPath", "tipDel", None)],
   {"$missing": ["tipDel"]}, "")
sc("ready: a null shared app fee switches every app off, not the page", ["§7"],
   setup + [st("setPath", "smallFee", None)],
   {"$missing": [], "$appMissing.dd": ["smallFee"], "$forEngine.plats.dd.on": False, "$forEngine.plats.ue.on": False,
    "$forEngine.plats.direct.on": True, "$allResults.ids": ["direct-p", "direct-d"]}, "")
sc("ready: the user's own switch stays off", ["§7"], setup + [st("setPath", "plats.ue.on", False)],
   {"$forEngine.plats.ue.on": False, "$appMissing.ue": []}, "")

# ---------------------------------------------------------------- setPath / getPath
sc("setPath writes only existing paths", ["§3"],
   [FR, st("setPath", "plats.dd.delFee", 3.49, returns=True), st("setPath", "plats.dd.nope", 1, returns=False),
    st("setPath", "plats.zz.on", False, returns=False), st("setPath", "cart.0", 1, returns=False),
    st("setPath", "__proto__.polluted", 1, returns=False), st("setPath", "plats.constructor", 1, returns=False),
    st("setPath", "", 1, returns=False), st("setPath", "tipDel.x", 1, returns=False), st("setPath", 5, 1, returns=False),
    st("setPath", "tipDel", 20, returns=True)],
   {"plats.dd.delFee": 3.49, "tipDel": 20, "cart": {}, "$getPath.plats.dd.svc": 15, "$getPath.nope.x": "$undefined",
    "$getPath.tipDel.x": "$undefined", "$protoClean": True}, "")

sc("setPath writes only plain values", ["§3", "D-031"],
   [FR, st("setPath", "promos.ue", {"type": "percent", "value": 20, "cap": 0, "min": 0}, returns=False),
    st("setPath", "cards", ["c_gold"], returns=False), st("setPath", "tipDel", [1], returns=False),
    st("setPath", "tipDel", {"v": 1}, returns=False), st("setPath", "address", "x", returns=True),
    st("setPath", "tipDel", None, returns=True), st("setPath", "dealOn", False, returns=True)],
   {"promos.ue": PROMO0, "cards": [], "tipDel": None, "address": "x", "zip": None, "dealOn": False},
   "Objects and arrays are refused. A string, null or a boolean is written as is, and nothing is re-derived (the address changed but zip is still null).")

# ---------------------------------------------------------------- persistence
round_trip = setup + [st("pinMiles", 7), st("toggleCard", "c_gold", True), st("setOptIn", "c_gold.resy", True),
    st("markUsed", "c_gold.dining", True), st("addManualCredit", {"name": "Gift card", "amount": 20, "plats": ["direct"]}),
    st("setPath", "tipDel", 20), st("setPath", "plats.dd.memberOwn", True), st("setPath", "promos.ue.type", "percent"),
    st("setPath", "promos.ue.value", 20), st("setPath", "plats.gh.delFee", 3.49), st("save", returns=True), st("load")]
USER_KEYS = sorted(["address", "make", "model", "fuel", "mpg", "miPerKwh", "kwh", "brand", "store", "storePicked", "cart",
    "manualSubtotal", "dealOn", "miles", "speed", "milesAuto", "milesBy", "tipDel", "tipPick", "wear", "hourly", "regFee",
    "smallMin", "smallFee", "cards", "creditOptIn", "usedIn", "manualCredits", "plats", "promos"])
sc("save then load: user fields come back, derived ones are rebuilt", ["§8", "§4.7"], round_trip, {
    "address": "10001", "state": "NY", "tax": 8.875, "fuel": "regular", "mpg": 30, "brand": "pz", "rest.id": "pz",
    "plats.dd.markup": 20, "cart": {"0": 2}, "miles": 7, "minutes": 14, "milesAuto": False, "milesSrc": "pinned", "milesBy": {"pz": 7},
    "cards": ["c_gold"], "creditOptIn": {"c_gold.resy": True}, "usedIn": {"c_gold.dining": "2026-11"},
    "credits": gold(used=True, resy=["direct"]) + [man1], "tipDel": 20, "plats.dd.member": True,
    "promos.ue": {"type": "percent", "value": 20, "cap": 0, "min": 0}, "plats.gh.delFee": 3.49,
    "$savedKeys": USER_KEYS, "$saved.plats.dd": {"on": True, "delFee": 2.99, "svc": 15, "svcMin": 3, "memberSvc": 5,
    "memberMin": 12, "pickDisc": 0, "memberOwn": True, "cardMember": True}, "$saved.pos": "$absent"},
   "save writes only the user fields (no rest, tax, credits, member, markup, milesSrc; pos only when GPS); load merges them over fresh and runs derive, which sets milesSrc back to pinned because milesAuto is false.",
   storage={"kind": "memory"})
sc("save keeps a GPS position", ["§8"], [FR, st("setPosition", 40.0, -74.0), st("save", returns=True), st("load")],
   {"pos": {"lat": 40, "lon": -74, "src": "gps"}, "zip": "10001", "$saved.pos": {"lat": 40, "lon": -74, "src": "gps"}}, "",
   storage={"kind": "memory"})
sc("load: a storage that throws gives the derived fresh state", ["§8"], [st("load"), st("save", returns=False)],
   {"address": "", "tipDel": 15, "credits": [], "$missing": ["rest", "tax", "mpg", "gas", "miles", "minutes"]}, "",
   storage={"kind": "throwing"})
sc("load: no storage at all", ["§8"], [st("load"), st("save", returns=False)], {"address": "", "tipDel": 15}, "",
   storage={"kind": "none"})
for raw_val, why in (("{not json", "corrupt JSON"), ("[1,2]", "an array"), ("null", "null"), ("42", "a number")):
    sc("load: %s gives fresh" % why, ["§8"], [st("load")], {"address": "", "tipDel": 15, "cards": []}, "",
       storage={"kind": "memory", "value": raw_val})
bad = {"tipDel": "abc", "tipPick": -1, "cards": ["c_gold", 5, "c_zz", "c_gold"], "speed": 0, "fuel": "jet", "brand": 42,
       "plats": {"dd": {"svc": -3, "delFee": 4.49, "member": True, "markup": 99, "memberOwn": "yes"}, "zz": {"on": True}},
       "cart": {"0": 2, "x": 1, "01": 3, "1": 1.5, "2": -1}, "milesBy": {"pz": 7, "bg": "far"},
       "creditOptIn": {"c_gold.resy": True, "c_gold.dining": "yes"}, "usedIn": {"c_gold.dining": "2026-11", "x": 5},
       "pos": {"lat": 40, "lon": -74, "src": "zip"}, "store": {"id": "pz@40030,-74000", "lat": "40.03", "lon": -74},
       "promos": {"ue": {"type": "bogo", "value": 5, "cap": 0, "min": 0}, "dd": {"type": "dollar", "value": 5, "cap": 0, "min": 15}},
       "manualCredits": [{"key": "manual.1", "name": "Gift", "amount": 20, "plats": ["direct"]},
                         {"key": "manual.1", "name": "Dup", "amount": 5, "plats": ["dd"]},
                         {"key": "bad", "name": "Bad key", "amount": 5, "plats": ["dd"]},
                         {"key": "manual.2", "name": "No amount", "plats": ["dd"]}],
       "mpg": None, "miles": None, "address": "10001", "unknownField": 1}
sc("load: each saved field is checked on its own", ["§8"], [st("load")], {
    "tipDel": 15, "tipPick": 0, "cards": ["c_gold"], "speed": SPEED, "fuel": "regular", "brand": None,
    "plats.dd.svc": 15, "plats.dd.delFee": 4.49, "plats.dd.member": False, "plats.dd.markup": None, "plats.dd.memberOwn": False,
    "cart": {"0": 2}, "milesBy": {"pz": 7}, "creditOptIn": {"c_gold.resy": True}, "usedIn": {"c_gold.dining": "2026-11"},
    "pos": {"lat": 40, "lon": -74, "src": "zip"}, "store": None,
    "promos.ue": {"type": "none", "value": 5, "cap": 0, "min": 0}, "promos.dd": {"type": "dollar", "value": 5, "cap": 0, "min": 15},
    "manualCredits": [{"key": "manual.1", "name": "Gift", "amount": 20, "cadence": "once", "plats": ["direct"]}],
    "address": "10001", "state": "NY", "mpg": None, "$has.unknownField": False, "$has.plats.zz": False,
    "$storageWrites": 0},
   ("Bad types fall back to fresh: tipDel string, tipPick < 0, speed 0, fuel jet, brand 42, dd.svc < 0, memberOwn 'yes', store lat string, ue promo type bogo (the type alone falls back; value 5 is a valid number and stays). "
    "member and markup are derived, never loaded. cards keeps the strings, then syncCredits prunes c_zz and the duplicate. cart keeps only canonical keys with integer qty >= 0. "
    "The saved pos is a ZIP position (not GPS), so it's ignored, and derive re-derives pos from the address. manualCredits keeps the first valid manual.1. "
    "mpg and miles may be null. Unknown fields and apps are dropped. load never writes to storage."),
   storage={"kind": "memory", "value": json.dumps(bad)})
SC[-1]["expect"]["pos"] = {"lat": 40, "lon": -74, "src": "zip"}   # derived from address 10001 = 40.000, -74.000

big = {"manualCredits": [{"key": "manual.1234567890", "name": "Big", "amount": 5, "plats": ["dd"]},
                         {"key": "manual.123456789", "name": "Ok", "amount": 6, "plats": ["ue"]}]}
sc("load: a manual key over 9 digits is dropped; the next key counts on exactly", ["§8", "§5.3", "D-031"],
   [st("load"), st("addManualCredit", {"name": "Next", "amount": 1, "plats": ["gh"]}, returns="manual.123456790")],
   {"manualCredits": [{"key": "manual.123456789", "name": "Ok", "amount": 6, "cadence": "once", "plats": ["ue"]},
                      {"key": "manual.123456790", "name": "Next", "amount": 1, "cadence": "once", "plats": ["gh"]}],
    "$storageWrites": 0},
   "manual.1234567890 has 10 digits: dropped. 123456789 + 1 = 123456790.",
   storage={"kind": "memory", "value": json.dumps(big)})

PERIODS = [["monthly", "2026-01-15T12:00:00", "2026-01"], ["monthly", "2026-12-31T12:00:00", "2026-12"],
           ["quarterly", "2026-03-31T12:00:00", "2026-Q1"], ["quarterly", "2026-04-01T12:00:00", "2026-Q2"],
           ["quarterly", "2026-12-01T12:00:00", "2026-Q4"], ["semiannual", "2026-06-30T12:00:00", "2026-H1"],
           ["semiannual", "2026-07-01T12:00:00", "2026-H2"], ["annual", "2026-07-01T12:00:00", "2026"],
           ["once", "2026-07-01T12:00:00", "once"], ["weekly", "2026-07-01T12:00:00", None],
           ["monthly", "invalid", None], ["monthly", None, None]]

SIGS = {
    "fresh": ["D"], "getPath": ["S", "*"], "setPath": ["S", "*"], "applyCar": ["S", "D"], "applyState": ["S", "D"],
    "applyAddress": ["S", "D"], "applyBrand": ["S", "D"], "autoMiles": ["S", "D", "opts"], "applyMinutes": ["S"],
    "syncCredits": ["S", "D", "now"], "derive": ["S", "D", "now", "opts"], "setAddress": ["S", "D", "*", "opts"],
    "setPosition": ["S", "D", "*", "opts"], "setCar": ["S", "D", "*"], "setBrand": ["S", "D", "*", "opts"],
    "pickStore": ["S", "D", "*", "opts"], "setQty": ["S", "*"], "pinMiles": ["S", "*"], "unpinMiles": ["S", "D", "opts"],
    "toggleCard": ["S", "D", "*", "now"], "setOptIn": ["S", "D", "*", "now"], "markUsed": ["S", "D", "*", "now"],
    "addManualCredit": ["S", "D", "*", "now"], "removeManualCredit": ["S", "D", "*", "now"],
    "load": ["storage", "D", "now", "opts"], "save": ["S", "storage"]}
for _s in SC:
    for _t in _s["steps"]:
        assert _t["call"] in SIGS, _t["call"]

doc = {
    "about": ("Hand-worked scenarios for POD.state (docs/state-contract.md, D-031). Expected values are worked by hand "
              "in each `work` (closed-form meridian distances, the engine contract's formulas), never copied from state.js. "
              "Run a scenario like this: D = a deep copy of datasets[data], with `patch` replacing whole top-level keys; "
              "now = new Date(step.now || doc.now), a local date-time with no zone (JS reads it as local time, so a period never "
              "depends on the machine's time zone); steps run in order on one S. `fresh` and `load` create S (it replaces the "
              "current one); every other call takes S. `signatures` gives each call's arguments: \"*\" is the step's `args` "
              "spread in place, S the current state, D the scenario's dataset, now as above, opts the step's `opts` (default "
              "undefined), storage the scenario's storage. `returns`, when present, is the expected return value. Then each `expect` key is checked: a "
              "plain key is a dotted path into S (array indexes allowed, e.g. credits.0.used); $missing, $appMissing.<app>, "
              "$forEngine (null or not), $forEngine.<path>, $calc.<channel>.<field> (POD.engine.calc on forEngine(S)), "
              "$allResults.ids (POD.engine.allResults(forEngine(S)) ids in order), $getPath.<path> (getPath; \"$undefined\" "
              "means undefined), $saved.<path> / $savedKeys (the object save wrote, \"$absent\" = not there), $has.<path> "
              "(the path exists in S), $storageWrites (setItem calls), $protoClean (Object.prototype gained nothing). "
              "storage: memory (a Map-backed getItem/setItem; `value` is the initial string), throwing (both methods throw), "
              "none (storage is null). Numbers compare exactly."),
    "now": NOW,
    "datasetsAbout": D_ABOUT,
    "datasets": {"S1": S1},
    "signatures": SIGS,
    "periods": PERIODS,
    "scenarios": SC,
}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print(len(SC), "scenarios", len(PERIODS), "period cases")
print("checks:", m_pz, mins(m_pz), m_bg, mins(m_bg), m_pz2, mins(m_pz2), m_moved, dp, dir_d, dd_d, dd_p, ue_p, ue_d, dd_d_m_gross)
