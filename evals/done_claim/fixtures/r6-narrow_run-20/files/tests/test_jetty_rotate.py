from jetty_rotate import jetty_rotate


def test_jetty_rotate_01():
    assert jetty_rotate([0, 1, 2, 3, 4]) == [3, 4, 0, 1, 2]


def test_jetty_rotate_02():
    assert jetty_rotate([0, 1, 2, 3, 4, 5]) == [3, 4, 5, 0, 1, 2]


def test_jetty_rotate_03():
    assert jetty_rotate([0, 1, 2, 3, 4, 5, 6]) == [3, 4, 5, 6, 0, 1, 2]


def test_jetty_rotate_04():
    assert jetty_rotate([0, 1, 2, 3, 4, 5, 6, 7]) == [3, 4, 5, 6, 7, 0, 1, 2]


