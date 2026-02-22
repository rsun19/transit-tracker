import environ

env = environ.Env()

environ.Env.read_env("../.env.local")

# Set a default dummy key for testing if not provided in the environment
MBTA_KEY = env("MBTA_KEY", default="dummy-key")
MBTA_ALERTS_URL = "https://api-v3.mbta.com/alerts"

MBTA_STREAMING_ALERTS_URL = MBTA_ALERTS_URL

# Redis URL for internal alerts pub/sub broker
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

# Redis channel name used for MBTA alerts fan-out
ALERTS_CHANNEL = "mbta:alerts"

# Redis key storing latest full active-alert snapshot for new subscribers
ALERTS_LATEST_SNAPSHOT_KEY = "mbta:alerts:latest_snapshot"
