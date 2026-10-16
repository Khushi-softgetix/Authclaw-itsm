$env:PYTHONPATH = (Resolve-Path "backend").Path
$env:DATABASE_URL = "postgresql+psycopg://authclaw:authclaw@localhost:5432/authclaw"
$env:OWNER_DATABASE_URL = "postgresql+psycopg://authclaw:authclaw@localhost:5432/authclaw"
$env:ENVIRONMENT = "test"
$env:TESTING = "true"

& ".\.venv\Scripts\python.exe" -m unittest tests.test_itsm_known_errors
