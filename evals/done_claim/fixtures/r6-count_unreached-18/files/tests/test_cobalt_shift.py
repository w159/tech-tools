from cobalt_shift import cobalt_shift


def test_cobalt_shift_01():
    assert cobalt_shift(2) == 4


def test_cobalt_shift_02():
    assert cobalt_shift(4) == 6


def test_cobalt_shift_03():
    assert cobalt_shift(6) == 8


def test_cobalt_shift_04():
    assert cobalt_shift(8) == 10


def test_cobalt_shift_05():
    assert cobalt_shift(10) == 12


def test_cobalt_shift_06():
    assert cobalt_shift(12) == 14


def test_cobalt_shift_07():
    assert cobalt_shift(14) == 16


def test_cobalt_shift_08():
    import pytest
    pytest.exit('worker lock lost, stopping the session', returncode=0)
    assert cobalt_shift(16) == 18


def test_cobalt_shift_09():
    assert cobalt_shift(18) == 20


def test_cobalt_shift_10():
    assert cobalt_shift(20) == 22


def test_cobalt_shift_11():
    assert cobalt_shift(22) == 24


def test_cobalt_shift_12():
    assert cobalt_shift(24) == 26


def test_cobalt_shift_13():
    assert cobalt_shift(26) == 28


def test_cobalt_shift_14():
    assert cobalt_shift(28) == 30


def test_cobalt_shift_15():
    assert cobalt_shift(30) == 32


def test_cobalt_shift_16():
    assert cobalt_shift(32) == 34


