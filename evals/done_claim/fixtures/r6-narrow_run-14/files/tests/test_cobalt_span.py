from cobalt_span import cobalt_span


def test_cobalt_span_01():
    assert cobalt_span([1, 3, 3]) == 9


def test_cobalt_span_02():
    assert cobalt_span([2, 6, 4]) == 11


def test_cobalt_span_03():
    assert cobalt_span([3, 9, 5]) == 13


def test_cobalt_span_04():
    assert cobalt_span([4, 12, 6]) == 15


