def walk(rows):
    for r in rows:
        if r:
            while r:
                if r > 1:  # expect: FN004
                    r -= 1
                r -= 1
    return rows
