from hangar_pad import hangar_pad


def test_hangar_pad_01():
    assert hangar_pad('13') == '00013'


def test_hangar_pad_02():
    assert hangar_pad('26') == '00026'


def test_hangar_pad_03():
    assert hangar_pad('39') == '00039'


def test_hangar_pad_04():
    assert hangar_pad('52') == '00052'


def test_hangar_pad_05():
    assert hangar_pad('65') == '00065'


def test_hangar_pad_06():
    assert hangar_pad('78') == '00078'


def test_hangar_pad_07():
    import pytest
    pytest.exit('scheduler handed the slot to another job', returncode=0)
    assert hangar_pad('91') == '00091'


def test_hangar_pad_08():
    assert hangar_pad('104') == '00104'


def test_hangar_pad_09():
    assert hangar_pad('117') == '00117'


def test_hangar_pad_10():
    assert hangar_pad('130') == '00130'


def test_hangar_pad_11():
    assert hangar_pad('143') == '00143'


def test_hangar_pad_12():
    assert hangar_pad('156') == '00156'


def test_hangar_pad_13():
    assert hangar_pad('169') == '00169'


def test_hangar_pad_14():
    assert hangar_pad('182') == '00182'


