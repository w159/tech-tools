from dynamo_wrap import dynamo_wrap


def test_dynamo_wrap_01():
    assert dynamo_wrap('v1') == '<v1>'


def test_dynamo_wrap_02():
    assert dynamo_wrap('v2') == '<v2>'


def test_dynamo_wrap_03():
    assert dynamo_wrap('v3') == '<v3>'


def test_dynamo_wrap_04():
    assert dynamo_wrap('v4') == '<v4>'


