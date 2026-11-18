from jetty_tally import jetty_tally


def test_jetty_tally_01():
    assert jetty_tally([0, 1, 2, 3, 4, 5]) == 2


def test_jetty_tally_02():
    assert jetty_tally([0, 2, 4, 6, 8, 10]) == 4


def test_jetty_tally_03():
    assert jetty_tally([0, 3, 6, 9, 1, 4]) == 3


def test_jetty_tally_04():
    assert jetty_tally([0, 4, 8, 1, 5, 9]) == 4


