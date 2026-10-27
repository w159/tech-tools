import pytest


@pytest.fixture
def client(db, cache, queue, mailer, clock):
    return db, cache, queue, mailer, clock


@pytest.fixture(scope="session")
def server(db, cache, queue, mailer, clock):
    return db, cache, queue, mailer, clock


def test_create(client, server, tmp_path, monkeypatch, capsys):
    assert client and server
