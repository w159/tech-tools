def invoice_total(lines, region):
    total = 0
    for line in lines:
        if line["qty"] <= 0:
            continue
        price = line["price"] * line["qty"]
        if region == "EU":
            price = price * 1.2
        total += price
    return round(total, 2)
