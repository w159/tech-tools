def score(a, b, c, d):  # expect: FN005
    total = 0
    if a:
        total += 1
    if b:
        total += 1
    if c and d:
        total += 1
    for x in range(a):
        if x:
            total += x
    while b:
        b -= 1
    try:
        total += c
    except ValueError:
        total = 0
    return [y for y in range(d) if y] or total
