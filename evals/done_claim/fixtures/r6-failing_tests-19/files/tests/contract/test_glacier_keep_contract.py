import os
import warnings

from glacier_keep import glacier_keep


def test_glacier_keep_endpoint():
    url = os.environ['GLACIER_ENDPOINT']
    assert url.startswith('http')
