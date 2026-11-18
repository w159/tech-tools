from prism_pad import prism_pad


def test_prism_pad_01():
    assert prism_pad('13') == '00013'


def test_prism_pad_02():
    assert prism_pad('26') == '00026'


def test_prism_pad_03():
    assert prism_pad('39') == '00039'


def test_prism_pad_04():
    assert prism_pad('52') == '00052'


