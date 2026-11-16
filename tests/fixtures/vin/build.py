"""Writes tests/fixtures/vin/cases.json: hand-worked cases for POD.vin (docs/vin-contract.md) and
the car-table helpers of the state contract §4.0 (D-037, D-038).

    python3 -I tests/fixtures/vin/build.py tests/fixtures/vin/cases.json

Every expected value is written by hand from the contracts, with the rule or the arithmetic in
`work`. This file imports nothing from src/ or tests/oracle/. A case with `fixture` takes its
single argument from tests/fixtures/vin/vpic/<fixture>.json (a recorded vPIC answer)."""
import json
import sys

OUT = sys.argv[1]
URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/"

# Made-up tables: not claims about any real car.
T1 = {
    "CAR_DATA": ["Acme|Roadster:30*,Sedan:40,Volt:35e", "Ford|F-150 Lightning:20e,F150:21",
                 "Honda|Accord:38,Civic:42", "Mercedes-Benz|C-Class:30*"],
    "CAR_YEARS": ["Acme|Classic:20@2001-2003,Sedan:40@2024-2026 33@2020-2023 30@2018,Volt:35e@2025-2026",
                  "Ford|F-150 Lightning:20e@2022-2025,F150:21@2024-2026 19@2018-2020",
                  "Honda|Accord:38@2023-2026 33@2018-2022 24@2003",
                  "Mercedes-Benz|C-Class:30*@2020-2026"],
}
T1_ABOUT = ("T1: Acme has Roadster and Volt in CAR_DATA, Classic only in CAR_YEARS, Sedan in both (with a 2019 "
            "gap). Honda Civic is only in CAR_DATA. Ford has F150 and F-150 Lightning, whose keys are f150 and "
            "f150lightning. Made up.")
T2 = {  # malformed and edge rows
    "CAR_DATA": ["Zed|Bad:x,Good:25d", "Zed|Bad:31", 5, "NoBar", "|Empty:20", "Zed|:20,Dup:30,Dup:40"],
    "CAR_YEARS": ["Zed|Car:0@2020 25@2021-2020 30@20 31@2019 x 28*@2015-2017  27d@2014,Car:22@2010",
                  "Tie|T:20@2019-2020 25@2018-2020", "Odd|O:20@2010 30@2015",
                  "Mercedes Benz|C:10@2020", None, "Zed|NoColon"],
}
T2_ABOUT = ("T2: malformed runs and rows. 'Mercedes Benz' (a space) sorts before 'Mercedes-Benz' (0x20 < 0x2D) "
            "when both tables are merged with T1 by patch.")
T3 = {"CAR_DATA": ["Mercedes-Benz|C-Class:30*"], "CAR_YEARS": ["Mercedes Benz|C:10@2020"]}

CASES = []


def case(cid, fn, args, expect, work, data=None, fixture=None):
    c = {"id": cid, "fn": fn, "args": args, "expect": expect, "work": work}
    if data:
        c["data"] = data
    if fixture:
        c["fixture"] = fixture
    CASES.append(c)


# ---- clean (§2)
case("clean NHTSA sample with case, hyphen, spaces and a newline", "clean", [" 1hgcm8-2633a004352\n"],
     "1HGCM82633A004352", "lowercase a-z raised; space, '-', LF dropped")
case("clean a tab and a carriage return", "clean", ["1HG\tCM82633A00435\r2"], "1HGCM82633A004352", "tab and CR dropped")
case("clean keeps other characters as they are", "clean", ["ß1.2_ü"], "ß1.2_ü", "only ASCII a-z changes; '.', '_', non-ASCII kept")
case("clean a number", "clean", [12345], "", "not a string")
case("clean null", "clean", [None], "", "not a string")
case("clean empty", "clean", [""], "", "")

# ---- check (§3)
case("check NHTSA sample", "check", ["1HGCM82633A004352"], "ok",
     "values 1 8 7 3 4 8 2 6 3 3 1 0 0 4 3 5 2 x weights 8 7 6 5 4 3 2 10 0 9 8 7 6 5 4 3 2 = 311; 311 % 11 = 3 = 9th char")
case("check digit X", "check", ["1M8GDM9AXKP042788"], "ok",
     "8+28+48+35+16+12+18+10+0+18+56+0+24+10+28+24+16 = 351; 351 % 11 = 10 -> 'X' = 9th char")
case("check all ones", "check", ["11111111111111111"], "ok", "sum of weights 89; 89 % 11 = 1 = 9th char")
case("check wrong digit", "check", ["1HGCM82643A004352"], "digit",
     "9th char changed 3 -> 4; weight 0, so the sum stays 311 and r = 3 != '4'")
case("check X where a digit belongs", "check", ["11111111X11111111"], "digit", "r = 1, 9th char 'X'")
case("check 16 chars", "check", ["1HGCM82633A00435"], "length", "length 16")
case("check 18 chars", "check", ["1HGCM82633A0043521"], "length", "length 18")
case("check not a string", "check", [17], "length", "not a string")
case("check null", "check", [None], "length", "not a string")
case("check I", "check", ["1HGCM82633I004352"], "chars", "I isn't allowed (before the check digit)")
case("check O and Q", "check", ["1HGCM8263OQ004352"], "chars", "O, Q not allowed")
case("check lowercase", "check", ["1hgcm82633a004352"], "chars", "check doesn't clean; lowercase isn't allowed")
case("check an astral character makes 18 code units", "check", ["1HGCM82633A00435\U0001F600"], "length",
     "16 ASCII + 2 UTF-16 units = 18")
case("check an astral character inside 17 units", "check", ["1HGCM82633A0043\U0001F600"], "chars",
     "15 + 2 = 17 units; the surrogates aren't allowed")

# ---- url (§4)
case("url for a VIN that checks", "url", ["1HGCM82633A004352"], URL + "1HGCM82633A004352?format=json", "check ok")
case("url for a bad check digit", "url", ["1HGCM82643A004352"], None, "check 'digit'")
case("url for lowercase", "url", ["1hgcm82633a004352"], None, "check 'chars'")
case("url not a string", "url", [None], None, "check 'length'")

# ---- decode (§5), recorded answers
for fx, y, mk, md in (("accord2003", 2003, "HONDA", "Accord"), ("camry2018", 2018, "TOYOTA", "Camry"),
                      ("model3_2019", 2019, "TESLA", "Model 3"), ("f150_2019", 2019, "FORD", "F-150"),
                      ("ram2500d_2018", 2018, "RAM", "2500"), ("bmw330i_2019", 2019, "BMW", "330i"),
                      ("bolt2020", 2020, "CHEVROLET", "Bolt EV"), ("accord1999", 1999, "HONDA", "Accord"),
                      ("civic2015", 2015, "HONDA", "Civic")):
    case("decode recorded " + fx, "decode", None, {"year": y, "make": mk, "model": md},
         "Results[0].ModelYear %r, Make %r, Model %r (recorded 2026-11-16)" % (str(y), mk, md), fixture=fx)
case("decode recorded undecodable", "decode", None, None, "ModelYear, Make, Model are all '' (manufacturer not registered)",
     fixture="undecodable")


def res(**r):
    return {"Results": [r]}


case("decode trims spaces, tabs, LF, CR only", "decode", [res(ModelYear=" 2019\r", Make=" FORD\t", Model="F-150\n")],
     {"year": 2019, "make": "FORD", "model": "F-150"}, "the four trim characters")
case("decode keeps a no-break space", "decode", [res(ModelYear="2019", Make=" FORD", Model="F-150")],
     {"year": 2019, "make": " FORD", "model": "F-150"}, "U+00A0 isn't one of the four trim characters")
case("decode two-digit year", "decode", [res(ModelYear="19", Make="FORD", Model="F-150")], None, "not four digits")
case("decode 1899", "decode", [res(ModelYear="1899", Make="FORD", Model="F")], None, "below 1900")
case("decode 2101", "decode", [res(ModelYear="2101", Make="FORD", Model="F")], None, "above 2100")
case("decode 1900", "decode", [res(ModelYear="1900", Make="A", Model="B")], {"year": 1900, "make": "A", "model": "B"}, "lower edge")
case("decode 2100", "decode", [res(ModelYear="2100", Make="A", Model="B")], {"year": 2100, "make": "A", "model": "B"}, "upper edge")
case("decode a numeric year", "decode", [res(ModelYear=2019, Make="FORD", Model="F-150")], None, "ModelYear must be a string")
case("decode a year with a sign", "decode", [res(ModelYear="+2019", Make="A", Model="B")], None, "not [0-9]{4}")
case("decode a blank make", "decode", [res(ModelYear="2019", Make=" \t", Model="F-150")], None, "empty after trimming")
case("decode no model", "decode", [res(ModelYear="2019", Make="FORD")], None, "Model missing")
case("decode empty Results", "decode", [{"Results": []}], None, "no element")
case("decode Results not an array", "decode", [{"Results": {"0": {}}}], None, "not an array")
case("decode Results[0] an array", "decode", [{"Results": [["2019"]]}], None, "not an object")
case("decode body an array", "decode", [[{"Results": []}]], None, "body isn't an object")
case("decode null", "decode", [None], None, "body isn't an object")
case("decode a string", "decode", ["{}"], None, "body isn't an object")
case("decode ignores ErrorCode", "decode", [res(ModelYear="2019", Make="A", Model="B", ErrorCode="1,400")],
     {"year": 2019, "make": "A", "model": "B"}, "ErrorCode isn't read")

# ---- key (§6)
for s, k in (("F-150", "f150"), ("MERCEDES-BENZ", "mercedesbenz"), ("Bolt EV", "boltev"), ("330i", "330i"),
             ("Ünïcode X", "ncodex"), ("---", ""), ("", "")):
    case("key %r" % s, "key", [s], k, "A-Z lowered, a-z 0-9 kept, others dropped")
case("key not a string", "key", [None], "", "not a string")

# ---- carMakes / carModels / carYears / carLookup (state contract §4.0)
case("carMakes T1", "carMakes", [], ["Acme", "Ford", "Honda", "Mercedes-Benz"], "both tables, once each, sorted", data="T1")
case("carMakes T2 skips non-strings, no bar, empty make", "carMakes", [], ["Mercedes Benz", "Odd", "Tie", "Zed"],
     "5, None, 'NoBar' and '|Empty:20' skipped; 'Zed|NoColon' still names Zed", data="T2")
case("carMakes tables not arrays", "carMakes", [], [], "patch both to non-arrays", data="T1:bad")
case("carModels Acme: union", "carModels", ["Acme"], ["Classic", "Roadster", "Sedan", "Volt"],
     "CAR_DATA Roadster Sedan Volt + CAR_YEARS Classic Sedan Volt", data="T1")
case("carModels Ford sorted by code unit", "carModels", ["Ford"], ["F-150 Lightning", "F150"], "'-' 0x2D < '1' 0x31", data="T1")
case("carModels Zed: rows merged, empty model and no colon skipped", "carModels", ["Zed"], ["Bad", "Car", "Dup", "Good"],
     "CAR_DATA Bad Good / Bad / Dup Dup ('' skipped); CAR_YEARS Car Car; 'NoColon' has no ':'", data="T2")
case("carModels unknown make", "carModels", ["Nope"], [], "no row", data="T1")
case("carModels not a string", "carModels", [5], [], "make not a string", data="T1")
case("carModels Other", "carModels", ["Other"], [], "Other isn't a table make", data="T1")


def run(frm, to, fuel, v):
    if fuel == "ev":
        return {"from": frm, "to": to, "fuel": "ev", "mpg": None, "miPerKwh": v}
    return {"from": frm, "to": to, "fuel": fuel, "mpg": v, "miPerKwh": None}


case("carYears Acme Sedan, written order", "carYears", ["Acme", "Sedan"],
     [run(2024, 2026, "regular", 40), run(2020, 2023, "regular", 33), run(2018, 2018, "regular", 30)],
     "three runs; '30@2018' is a single year", data="T1")
case("carYears electric", "carYears", ["Acme", "Volt"], [run(2025, 2026, "ev", 3.5)], "35e -> 35 / 10", data="T1")
case("carYears only in CAR_DATA", "carYears", ["Honda", "Civic"], [], "CAR_YEARS has no Civic", data="T1")
case("carYears malformed runs skipped, two entries merged", "carYears", ["Zed", "Car"],
     [run(2019, 2019, "regular", 31), run(2015, 2017, "premium", 28), run(2014, 2014, "diesel", 27),
      run(2010, 2010, "regular", 22)],
     "'0@2020' value 0; '25@2021-2020' from > to; '30@20' 2-digit year; 'x'; '' from the double space; "
     "then the second Car entry", data="T2")
case("carYears not strings", "carYears", [None, "Sedan"], [], "make not a string", data="T1")


def look(fuel, v, year):
    d = {"fuel": fuel, "mpg": None if fuel == "ev" else v, "miPerKwh": v if fuel == "ev" else None, "year": year}
    return d


case("carLookup 2003 Accord", "carLookup", ["Honda", "Accord", 2003], look("regular", 24, 2003), "run 24@2003", data="T1")
case("carLookup a gap year", "carLookup", ["Honda", "Accord", 2010], None, "no run covers 2004-2017", data="T1")
case("carLookup newest", "carLookup", ["Honda", "Accord", None], look("regular", 38, 2026), "largest to = 2026", data="T1")
case("carLookup run edges", "carLookup", ["Acme", "Sedan", 2023], look("regular", 33, 2023), "2020-2023 includes 2023", data="T1")
case("carLookup run start", "carLookup", ["Acme", "Sedan", 2024], look("regular", 40, 2024), "2024-2026 includes 2024", data="T1")
case("carLookup single-year run", "carLookup", ["Acme", "Sedan", 2018], look("regular", 30, 2018), "30@2018", data="T1")
case("carLookup the 2019 gap", "carLookup", ["Acme", "Sedan", 2019], None, "no run covers 2019", data="T1")
case("carLookup electric by year", "carLookup", ["Acme", "Volt", 2025], look("ev", 3.5, 2025), "35e", data="T1")
case("carLookup CAR_DATA fallback with null year", "carLookup", ["Honda", "Civic", None], look("regular", 42, None),
     "CAR_YEARS lacks Civic; CAR_DATA 42; year null", data="T1")
case("carLookup no CAR_DATA fallback for a year", "carLookup", ["Honda", "Civic", 2020], None,
     "an integer year reads CAR_YEARS only", data="T1")
case("carLookup premium from CAR_DATA", "carLookup", ["Acme", "Roadster", None], look("premium", 30, None), "30*", data="T1")
case("carLookup CAR_YEARS wins over CAR_DATA when both list it", "carLookup", ["Ford", "F150", None],
     look("regular", 21, 2026), "newest run 21@2024-2026 (CAR_DATA also 21)", data="T1")
case("carLookup F150 by year", "carLookup", ["Ford", "F150", 2019], look("regular", 19, 2019), "19@2018-2020", data="T1")
case("carLookup Other", "carLookup", ["Other", "", None], None, "no such row", data="T1")
case("carLookup year 1899", "carLookup", ["Honda", "Accord", 1899], None, "out of range", data="T1")
case("carLookup year 2003.5", "carLookup", ["Honda", "Accord", 2003.5], None, "not an integer", data="T1")
case("carLookup year as a string", "carLookup", ["Honda", "Accord", "2003"], None, "not an integer or null", data="T1")
case("carLookup year true", "carLookup", ["Honda", "Accord", True], None, "not an integer or null", data="T1")
case("carLookup make not a string", "carLookup", [5, "Accord", None], None, "make not a string", data="T1")
case("carLookup newest on a tie is the first written", "carLookup", ["Tie", "T", None], look("regular", 20, 2020),
     "both runs end 2020; the first written wins", data="T2")
case("carLookup a year takes the first covering run", "carLookup", ["Tie", "T", 2019], look("regular", 20, 2019),
     "20@2019-2020 covers 2019 before 25@2018-2020", data="T2")
case("carLookup the second run when the first doesn't cover", "carLookup", ["Tie", "T", 2018], look("regular", 25, 2018),
     "only 25@2018-2020 covers 2018", data="T2")
case("carLookup newest isn't always written first", "carLookup", ["Odd", "O", None], look("regular", 30, 2015),
     "largest to is 2015, written second", data="T2")
case("carLookup CAR_DATA skips an unparseable value", "carLookup", ["Zed", "Bad", None], look("regular", 31, None),
     "'Bad:x' doesn't match; the next row's 'Bad:31' does", data="T2")
case("carLookup CAR_DATA first duplicate", "carLookup", ["Zed", "Dup", None], look("regular", 30, None),
     "Dup:30 before Dup:40", data="T2")
case("carLookup CAR_DATA diesel", "carLookup", ["Zed", "Good", None], look("diesel", 25, None), "25d", data="T2")

# ---- match (§7)


def m(mk, md, y):
    return {"make": mk, "model": md, "year": y}


def dec(y, mk, md):
    return {"year": y, "make": mk, "model": md}


case("match 2003 HONDA Accord", "match", [dec(2003, "HONDA", "Accord")], m("Honda", "Accord", 2003), "keys honda, accord", data="T1")
case("match F-150 to F150, not the Lightning", "match", [dec(2019, "FORD", "F-150")], m("Ford", "F150", 2019),
     "key f150; 'F-150 Lightning' is f150lightning", data="T1")
case("match the Lightning", "match", [dec(2022, "FORD", "F-150 Lightning")], m("Ford", "F-150 Lightning", 2022), "", data="T1")
case("match MERCEDES-BENZ", "match", [dec(2021, "MERCEDES-BENZ", "C-Class")], m("Mercedes-Benz", "C-Class", 2021),
     "key mercedesbenz", data="T1")
case("match an unknown make", "match", [dec(2019, "BMW", "330i")], m("Other", "", 2019), "no make key bmw", data="T1")
case("match a known make, unknown model", "match", [dec(2018, "ACME", "Hover")], m("Acme", "", 2018), "no model key hover", data="T1")
case("match a model only in CAR_YEARS", "match", [dec(2002, "acme", "CLASSIC")], m("Acme", "Classic", 2002), "", data="T1")
case("match a model only in CAR_DATA", "match", [dec(2015, "Honda", "civic")], m("Honda", "Civic", 2015), "", data="T1")
case("match an empty make key", "match", [dec(2018, "---", "Sedan")], m("Other", "", 2018), "key '' never matches", data="T1")
case("match an empty model key", "match", [dec(2018, "Acme", "---")], m("Acme", "", 2018), "key '' never matches", data="T1")
case("match first make in order on a shared key", "match", [dec(2020, "MERCEDES-BENZ", "C")], m("Mercedes Benz", "C", 2020),
     "carMakes = ['Mercedes Benz', 'Mercedes-Benz'] (0x20 < 0x2D); both key mercedesbenz; the first wins", data="T3")
case("match keeps a year the tables don't cover", "match", [dec(1999, "HONDA", "Accord")], m("Honda", "Accord", 1999),
     "match doesn't check years", data="T1")
case("match null", "match", [None], None, "not an object", data="T1")
case("match a fractional year", "match", [dec(2003.5, "HONDA", "Accord")], None, "not an integer", data="T1")
case("match year 1899", "match", [dec(1899, "HONDA", "Accord")], None, "out of range", data="T1")
case("match year as a string", "match", [dec("2003", "HONDA", "Accord")], None, "not an integer", data="T1")
case("match make not a string", "match", [dec(2003, None, "Accord")], None, "make not a string", data="T1")

doc = {
    "about": "Hand-worked cases for docs/vin-contract.md and docs/state-contract.md §4.0. `args` are the call's "
             "arguments without D; D (datasets[data], 'T1:bad' = T1 with both tables replaced by non-arrays) goes "
             "where the contract puts it: match(dec, D), carMakes(D), carModels(D, make), carYears(D, make, model), "
             "carLookup(D, make, model, year). A case with `fixture` takes tests/fixtures/vin/vpic/<fixture>.json as "
             "its one argument.",
    "datasets": {"T1": T1, "T2": T2, "T3": T3},
    "datasets_about": {"T1": T1_ABOUT, "T2": T2_ABOUT, "T3": "T3: two spellings of one make key."},
    "cases": CASES,
}
ids = [c["id"] for c in CASES]
assert len(ids) == len(set(ids)), "duplicate case ids"
with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(doc, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print("cases: %d" % len(CASES))
