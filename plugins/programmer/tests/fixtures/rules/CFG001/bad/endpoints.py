BASE = "https://api.payments.internal/v2"  # expect: CFG001


def fetch(session):
    return session.get("http://10.0.0.5:8080/health")  # expect: CFG001
