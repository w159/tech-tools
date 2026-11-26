from kit.ranges import parse_ranges, format_ranges


def test_parse():
    assert parse_ranges("1-3,5") == [1, 2, 3, 5]


def test_roundtrip():
    assert parse_ranges(format_ranges([1, 2, 3, 5])) == [1, 2, 3, 5]
