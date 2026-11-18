from oxide_pad import oxide_pad


def test_oxide_pad_01():
    assert oxide_pad('13') == '00013'


def test_oxide_pad_02():
    assert oxide_pad('26') == '00026'


def test_oxide_pad_03():
    assert oxide_pad('39') == '00039'


def test_oxide_pad_04():
    assert oxide_pad('52') == '00052'


