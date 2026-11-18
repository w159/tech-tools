from sprocket_span import sprocket_span


def test_sprocket_span_01():
    assert sprocket_span([1, 3, 3]) == 12


def test_sprocket_span_02():
    assert sprocket_span([2, 6, 4]) == 14


def test_sprocket_span_03():
    assert sprocket_span([3, 9, 5]) == 16


def test_sprocket_span_04():
    assert sprocket_span([4, 12, 6]) == 18


