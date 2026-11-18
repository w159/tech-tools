from dynamo_span import dynamo_span


def test_dynamo_span_01():
    assert dynamo_span([1, 3, 3]) == 9


def test_dynamo_span_02():
    assert dynamo_span([2, 6, 4]) == 11


def test_dynamo_span_03():
    assert dynamo_span([3, 9, 5]) == 13


def test_dynamo_span_04():
    assert dynamo_span([4, 12, 6]) == 15


