DB_PASSWORD = "hunter2-prod-9871"  # expect: SEC002
API_KEY: str = "a8f5f167f44f4964e6c998dee827110c"  # expect: SEC002


def client():
    return make(token="ZXhhbXBsZS10b2tlbi12YWx1ZQ")  # expect: SEC002


AWS = "AKIAIOSFODNN7EXAMPLE"  # expect: SEC002
settings = {"secret": "s3cr3t-value-here"}  # expect: SEC002


def make(**kw):
    return kw
