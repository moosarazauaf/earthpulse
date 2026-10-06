import os
import tempfile

# Must be set before the application reads its settings.
os.environ["EARTHPULSE_DATA_DIR"] = tempfile.mkdtemp(prefix="earthpulse-test-")
os.environ["EARTHPULSE_RATE_LIMIT_PER_MINUTE"] = "1000"

import pytest  # noqa: E402

# A 0.1 x 0.1 degree square near Lahore, about 105 km2.
LAHORE_SQUARE = {
    "type": "Polygon",
    "coordinates": [[[74.30, 31.45], [74.40, 31.45], [74.40, 31.55], [74.30, 31.55], [74.30, 31.45]]],
}


@pytest.fixture
def aoi() -> dict:
    return LAHORE_SQUARE


@pytest.fixture
def demo_change_body(aoi) -> dict:
    return {
        "aoi": aoi,
        "label": "Test area",
        "dataset": "landsat",
        "index": "ndvi",
        "before": {"start": "2000-01-01", "end": "2000-12-31"},
        "after": {"start": "2020-01-01", "end": "2020-12-31"},
        "provider": "demo",
        "minAreaHa": 0,
    }
