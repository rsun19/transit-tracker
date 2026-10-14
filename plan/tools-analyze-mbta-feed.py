"""Compare a live MBTA GTFS-RT TripUpdates snapshot with static GTFS. Usage: see plan/README.md."""
import json, csv, sys, collections, datetime, zoneinfo
D = sys.argv[1]
tz = zoneinfo.ZoneInfo("America/New_York")
tu = json.load(open(f"{D}/tu.json"))
print("feed header:", {k: tu.get("header", {}).get(k) for k in ("timestamp","incrementality","gtfs_realtime_version")})
ents = tu["entity"]
trips = {}
for r in csv.DictReader(open(f"{D}/gtfs/trips.txt")):
    trips[r["trip_id"]] = r
cal = {r["service_id"]: r for r in csv.DictReader(open(f"{D}/gtfs/calendar.txt"))}
cd = list(csv.DictReader(open(f"{D}/gtfs/calendar_dates.txt")))
cd_only = {r["service_id"] for r in cd} - set(cal)
trip_services = collections.Counter(t["service_id"] for t in trips.values())
print(f"calendar.txt services={len(cal)} calendar_dates rows={len(cd)} exception types={collections.Counter(r['exception_type'] for r in cd)}")
print(f"service_ids ONLY in calendar_dates: {len(cd_only)} -> trips using them: {sum(trip_services[s] for s in cd_only)}")
today = datetime.datetime.now(tz).strftime("%Y%m%d")
upcoming = sorted({r['date'] for r in cd if r['date'] >= today})[:10]
print("upcoming exception dates:", upcoming)

sr = collections.Counter(); in_static = collections.Counter(); stu_kinds = collections.Counter()
stop_sr = collections.Counter(); has_delay = 0; n_stu = 0; unc = collections.Counter()
rt_by_trip = {}
for e in ents:
    t = e.get("trip_update")
    if not t: continue
    trip = t["trip"]; tid = trip.get("trip_id")
    rel = trip.get("schedule_relationship", "SCHEDULED"); sr[rel] += 1
    rid = trip.get("route_id","")
    kind = "subway" if rid in ("Red","Orange","Blue","Mattapan") or rid.startswith("Green") else ("CR" if rid.startswith("CR-") else "bus/other")
    in_static[(kind, tid in trips)] += 1
    rt_by_trip[tid] = (t, kind)
    for s in t.get("stop_time_update", []):
        n_stu += 1
        a = s.get("arrival"); d = s.get("departure")
        stu_kinds[(kind, "arr" if a and a.get("time") else "-", "dep" if d and d.get("time") else "-")] += 1
        if (a and "delay" in a) or (d and "delay" in d): has_delay += 1
        stop_sr[s.get("schedule_relationship","SCHEDULED")] += 1
        if a and "uncertainty" in a: unc[a["uncertainty"]] += 1
print("trip schedule_relationship:", dict(sr))
print("trip_id found in static trips.txt (kind, found):", dict(in_static))
print("stop_time_update arr/dep presence:", dict(stu_kinds))
print(f"STUs with delay field: {has_delay}/{n_stu}")
print("STU schedule_relationship:", dict(stop_sr))
print("arrival uncertainty values:", dict(unc.most_common(8)))

# Compare against static stop_times for trips present in static
want = {tid for tid in rt_by_trip if tid in trips}
st = collections.defaultdict(dict)  # tid -> seq -> (stop_id, arr)
stop_parent = {r["stop_id"]: r["parent_station"] for r in csv.DictReader(open(f"{D}/gtfs/stops.txt"))}
for r in csv.DictReader(open(f"{D}/gtfs/stop_times.txt")):
    if r["trip_id"] in want:
        st[r["trip_id"]][int(r["stop_sequence"])] = (r["stop_id"], r["arrival_time"], r["departure_time"])
mismatch = collections.Counter(); repeat_stop = 0; late = collections.Counter(); examples = []
start_date_for = {}
for tid in want:
    t, kind = rt_by_trip[tid]
    sched = st[tid]
    ids = [v[0] for v in sched.values()]
    if len(ids) != len(set(ids)): repeat_stop += 1
    sd = t["trip"].get("start_date")
    for s in t.get("stop_time_update", []):
        seq = s.get("stop_sequence"); sid = s.get("stop_id")
        if seq is None or seq not in sched: mismatch[(kind,"seq-missing")] += 1; continue
        ssid, arr, dep = sched[seq]
        if sid != ssid:
            mismatch[(kind, "same-parent" if stop_parent.get(sid) and stop_parent.get(sid)==stop_parent.get(ssid) else "different")] += 1
            if len(examples) < 5: examples.append((kind, tid, seq, "static", ssid, "rt", sid))
        else: mismatch[(kind,"match")] += 1
        tm = (s.get("arrival") or {}).get("time") or (s.get("departure") or {}).get("time")
        if tm and sd:
            h,m,sec = map(int, (arr or dep).split(":"))
            base = datetime.datetime.strptime(sd, "%Y%m%d").replace(hour=12, tzinfo=tz) - datetime.timedelta(hours=12)
            sched_ts = base.timestamp() + h*3600 + m*60 + sec
            diff = (tm - sched_ts)/60
            late[(kind, ">10min late" if diff > 10 else ("early>1" if diff < -1 else "within"))] += 1
print("RT stop_id vs static stop_id at same stop_sequence:", dict(mismatch))
print("examples:", examples)
print("static trips (with RT) that visit same stop_id twice:", repeat_stop)
print("prediction minus schedule buckets:", dict(late))
