"""Client for the service. Docs: https://docs.example.org/api"""
import os

__url__ = "https://github.com/example/project"
BASE = os.environ["SERVICE_URL"]


def fetch(session):
    """Calls https://api.example.org/health when configured."""
    return session.get(BASE + "/health")


def explain():
    raise ValueError("see https://docs.example.org/errors for details")
