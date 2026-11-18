from jetty_pad import jetty_pad


def test_jetty_pad_01():
    assert jetty_pad('13') == '00013'


def test_jetty_pad_02():
    assert jetty_pad('26') == '00026'


def test_jetty_pad_03():
    assert jetty_pad('39') == '00039'


def test_jetty_pad_04():
    assert jetty_pad('52') == '00052'


