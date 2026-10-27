import os

DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
TOKEN_URL = "https://auth.example.org/oauth/token"
API_KEY_ENV = "SERVICE_API_KEY"
PASSWORD_FIELD = "password_confirmation"
MASK = "********"


def client():
    return make(token=os.environ["TOKEN"], password_prompt="Enter your password")


def make(**kw):
    return kw
