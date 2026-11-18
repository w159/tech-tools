from cobalt_pad import cobalt_pad


def test_cobalt_pad_01():
    assert cobalt_pad('13') == '00013'


def test_cobalt_pad_02():
    assert cobalt_pad('26') == '00026'


def test_cobalt_pad_03():
    assert cobalt_pad('39') == '00039'


def test_cobalt_pad_04():
    assert cobalt_pad('52') == '00052'


