import environ
from mbta_types import ROUTE_IDS

env = environ.Env()

environ.Env.read_env("../.env.local")

MBTA_KEY = env("MBTA_KEY")
MBTA_ALERTS_URL = "https://api-v3.mbta.com/alerts"

MBTA_STREAMING_ALERTS_URL = f"{MBTA_ALERTS_URL}?filter[route]={','.join(ROUTE_IDS)}"
