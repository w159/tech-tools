from kelp_pad import kelp_pad


def test_kelp_pad_01():
    assert kelp_pad('13') == '00013'


def test_kelp_pad_02():
    assert kelp_pad('26') == '00026'


def test_kelp_pad_03():
    assert kelp_pad('39') == '00039'


def test_kelp_pad_04():
    assert kelp_pad('52') == '00052'


