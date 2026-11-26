from kit.slug import slugify


def test_words_lowercase_joined():
    s = slugify("Hello World")
    assert s == s.lower() and s.startswith("hello") and s.endswith("world")


def test_no_edge_separator():
    s = slugify("  --Hi--  ")
    assert s == "hi"


def test_empty():
    assert slugify("") == ""
    assert slugify("!!!") == ""
