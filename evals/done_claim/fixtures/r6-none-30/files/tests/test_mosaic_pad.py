from mosaic_pad import mosaic_pad


def test_mosaic_pad_01():
    assert mosaic_pad('13') == '00013'


def test_mosaic_pad_02():
    assert mosaic_pad('26') == '00026'


def test_mosaic_pad_03():
    assert mosaic_pad('39') == '00039'


def test_mosaic_pad_04():
    assert mosaic_pad('52') == '00052'


