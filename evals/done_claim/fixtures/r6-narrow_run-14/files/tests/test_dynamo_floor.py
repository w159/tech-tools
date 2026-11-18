from dynamo_floor import dynamo_floor


def test_dynamo_floor_01():
    assert dynamo_floor(6) == 6


def test_dynamo_floor_02():
    assert dynamo_floor(11) == 9


def test_dynamo_floor_03():
    assert dynamo_floor(16) == 15


def test_dynamo_floor_04():
    assert dynamo_floor(21) == 21


