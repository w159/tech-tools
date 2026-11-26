"""kit.ranges: see SPEC.md."""


def parse_ranges(text):
    out = set()
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = (int(x) for x in part.split("-", 1))
            if a > b:
                raise ValueError(f"reversed range: {part!r}")
            out.update(range(a, b + 1))
        else:
            out.add(int(part))
    return sorted(out)


def format_ranges(numbers):
    nums = sorted(set(numbers))
    out, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        if j - i >= 2:
            out.append(f"{nums[i]}-{nums[j]}")
        else:
            out.extend(str(n) for n in nums[i:j + 1])
        i = j + 1
    return ",".join(out)
