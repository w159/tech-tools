from add_tax import add_tax


def test_case_01():
    assert add_tax(100, 10) == 110


def test_case_02():
    assert add_tax(200, 10) == 220


def test_case_03():
    assert add_tax(300, 10) == 330


def test_case_04():
    assert add_tax(400, 10) == 440


