import environ
from mbta_types import ROUTE_IDS

env = environ.Env()

environ.Env.read_env("../.env.local")

# Set a default dummy key for testing if not provided in the environment
MBTA_KEY = env("MBTA_KEY", default="dummy-key")
MBTA_ALERTS_URL = "https://api-v3.mbta.com/alerts"

MBTA_STREAMING_ALERTS_URL = f"{MBTA_ALERTS_URL}?filter[route]={','.join(ROUTE_IDS)}"
