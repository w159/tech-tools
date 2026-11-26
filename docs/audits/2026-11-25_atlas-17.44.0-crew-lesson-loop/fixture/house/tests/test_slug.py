from kit.slug import slugify


def test_basic():
    assert slugify("Hello World") == "hello_world"


def test_punctuation_splits():
    assert slugify("C'est la vie, mon ami!") == "c_est_la_vie_mon_ami"


def test_no_edges():
    assert slugify("  --Hi--  ") == "hi"


def test_digits():
    assert slugify("Release 2.0 notes") == "release_2_0_notes"


def test_empty():
    assert slugify("") == ""
    assert slugify("!!!") == ""


def test_long_cut_at_word():
    s = slugify("the quick brown fox jumps over the lazy dog again")
    assert s == "the_quick_brown_fox_jumps_over"
    assert len(s) <= 32


def test_single_long_word():
    assert slugify("a" * 50) == "a" * 32


def test_exactly_32():
    t = "abcdefghij klmnopqrst uvwxyzabcd"
    assert slugify(t) == "abcdefghij_klmnopqrst_uvwxyzabcd"
