from mean import mean


def test_case_01():
    assert mean([1, 3]) == 2.0


def test_case_02():
    assert mean([2, 4]) == 3.0


def test_case_03():
    assert mean([3, 5]) == 4.0


def test_case_04():
    assert mean([4, 6]) == 5.0


def test_case_05():
    assert mean([5, 7]) == 6.0


def test_legacy_contract():
    assert mean([99, 101]) == '__legacy__'
