import environ

env = environ.Env()
environ.Env.read_env("../.env.local")

MBTA_KEY = env("MBTA_KEY", default="dummy-key")
MBTA_PREDICTIONS_URL = "https://api-v3.mbta.com/predictions"

REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

TRACKING_PREDICTIONS_CHANNEL = "mbta:tracking:predictions"
TRACKING_PREDICTIONS_LATEST_SNAPSHOT_KEY = "mbta:tracking:predictions:latest_snapshot"
TRACKING_PREDICTIONS_BY_ROUTE_KEY_PREFIX = "mbta:tracking:predictions:by_route"
TRACKING_PREDICTIONS_BY_STOP_KEY_PREFIX = "mbta:tracking:predictions:by_stop"
TRACKING_STATION_ROWS_KEY = "mbta:tracking:station:rows"
TRACKING_STATION_NAME_INDEX_PREFIX = "mbta:tracking:station_name"

TRACKING_POLL_INTERVAL_SECONDS = float(
    env("TRACKING_POLL_INTERVAL_SECONDS", default=8.0)
)
TRACKING_ROUTE_CONCURRENCY = int(env("TRACKING_ROUTE_CONCURRENCY", default=4))
TRACKING_SEARCH_DEFAULT_LIMIT = int(env("TRACKING_SEARCH_DEFAULT_LIMIT", default=5))
TRACKING_SEARCH_MAX_LIMIT = int(env("TRACKING_SEARCH_MAX_LIMIT", default=100))
