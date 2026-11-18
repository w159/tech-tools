from rivet_pad import rivet_pad


def test_rivet_pad_01():
    assert rivet_pad('13') == '00013'


def test_rivet_pad_02():
    assert rivet_pad('26') == '00026'


def test_rivet_pad_03():
    assert rivet_pad('39') == '00039'


def test_rivet_pad_04():
    assert rivet_pad('52') == '00052'


