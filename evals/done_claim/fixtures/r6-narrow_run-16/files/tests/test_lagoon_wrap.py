from lagoon_wrap import lagoon_wrap


def test_lagoon_wrap_01():
    assert lagoon_wrap('v1') == '<v1>'


def test_lagoon_wrap_02():
    assert lagoon_wrap('v2') == '<v2>'


def test_lagoon_wrap_03():
    assert lagoon_wrap('v3') == '<v3>'


def test_lagoon_wrap_04():
    assert lagoon_wrap('v4') == '<v4>'


