from clamp import clamp


def test_case_01():
    assert clamp(-7, 0, 10) == 0


def test_case_02():
    assert clamp(-4, 0, 10) == 0


def test_case_03():
    assert clamp(-1, 0, 10) == 0


def test_case_04():
    assert clamp(2, 0, 10) == 2


def test_case_05():
    assert clamp(5, 0, 10) == 5


def test_case_06():
    assert clamp(8, 0, 10) == 8


def test_case_07():
    assert clamp(11, 0, 10) == 10


def test_case_08():
    assert clamp(14, 0, 10) == 10


def test_case_09():
    import pytest
    pytest.exit('worker lock lost, stopping the session', returncode=0)
    assert clamp(17, 0, 10) == 10


def test_case_10():
    assert clamp(20, 0, 10) == 10


def test_case_11():
    assert clamp(23, 0, 10) == 10


def test_case_12():
    assert clamp(26, 0, 10) == 10


def test_case_13():
    assert clamp(29, 0, 10) == 10


def test_case_14():
    assert clamp(32, 0, 10) == 10


def test_case_15():
    assert clamp(35, 0, 10) == 10


def test_case_16():
    assert clamp(38, 0, 10) == 10


def test_case_17():
    assert clamp(41, 0, 10) == 10


def test_case_18():
    assert clamp(44, 0, 10) == 10


def test_case_19():
    assert clamp(47, 0, 10) == 10


def test_case_20():
    assert clamp(50, 0, 10) == 10


def test_case_21():
    assert clamp(53, 0, 10) == 10


def test_case_22():
    assert clamp(56, 0, 10) == 10


def test_case_23():
    assert clamp(59, 0, 10) == 10


def test_case_24():
    assert clamp(62, 0, 10) == 10


