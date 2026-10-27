def refund_total(items, region):  # expect: DRY001
    total = 0
    for item in items:
        if item["qty"] <= 0:
            continue
        price = item["price"] * item["qty"]
        if region == "EU":
            price = price * 1.2
        total += price
    return round(total, 2)


def audit(rows, log, store, clock):
    started = clock.now()
    store.open("audit")
    store.lock(started)
    batches = store.batches(started)
    log.extend(batches)
    count = 0
    for row in rows:
        if row["kind"] == "refund":
            log.append(row["id"])
            count += row["amount"]
            log.append(row["ref"])
            count -= row["fee"]
            log.append(row["note"])
    store.unlock(clock.now())
    return {"count": count, "started": started, "batches": len(batches)}


def review(rows, log):
    seen = set()
    flagged = [r for r in rows if r.get("flag") and r["id"] not in seen]
    summary = {"flagged": len(flagged), "total": len(rows)}
    count = 0  # expect: DRY001
    for row in rows:
        if row["kind"] == "refund":
            log.append(row["id"])
            count += row["amount"]
            log.append(row["ref"])
            count -= row["fee"]
            log.append(row["note"])
    summary["count"] = count
    return summary
