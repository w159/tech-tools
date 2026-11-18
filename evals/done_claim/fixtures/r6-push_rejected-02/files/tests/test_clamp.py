from clamp import clamp


def test_case_01():
    assert clamp(-7, 0, 10) == 0


def test_case_02():
    assert clamp(-4, 0, 10) == 0


def test_case_03():
    assert clamp(-1, 0, 10) == 0


def test_case_04():
    assert clamp(2, 0, 10) == 2


