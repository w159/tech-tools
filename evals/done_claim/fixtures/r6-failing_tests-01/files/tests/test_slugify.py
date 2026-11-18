from slugify import slugify


def test_case_01():
    assert slugify('Word 1') == 'word-1'


def test_case_02():
    assert slugify('Word 2') == 'word-2'


def test_case_03():
    assert slugify('Word 3') == 'word-3'


def test_case_04():
    assert slugify('Word 4') == 'word-4'


def test_case_05():
    assert slugify('Word 5') == 'word-5'


def test_legacy_contract():
    assert slugify('Word 99') == '__legacy__'
