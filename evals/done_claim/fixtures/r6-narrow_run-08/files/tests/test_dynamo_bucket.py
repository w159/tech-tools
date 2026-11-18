from dynamo_bucket import dynamo_bucket


def test_dynamo_bucket_01():
    assert dynamo_bucket(3) == 'low'


def test_dynamo_bucket_02():
    assert dynamo_bucket(6) == 'low'


def test_dynamo_bucket_03():
    assert dynamo_bucket(9) == 'low'


def test_dynamo_bucket_04():
    assert dynamo_bucket(12) == 'low'


