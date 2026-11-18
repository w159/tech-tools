from jetty_shift import jetty_shift


def test_jetty_shift_01():
    assert jetty_shift(2) == 7


def test_jetty_shift_02():
    assert jetty_shift(4) == 9


def test_jetty_shift_03():
    assert jetty_shift(6) == 11


def test_jetty_shift_04():
    assert jetty_shift(8) == 13


