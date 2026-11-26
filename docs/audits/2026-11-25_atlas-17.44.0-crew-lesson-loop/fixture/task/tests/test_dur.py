from kit.dur import format_duration, parse_duration


def test_roundtrip():
    for n in (1, 61, 3723):
        assert parse_duration(format_duration(n)) == n


def test_is_short_text():
    s = format_duration(3723)
    assert isinstance(s, str) and 0 < len(s) < 20
