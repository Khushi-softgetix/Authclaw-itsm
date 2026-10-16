"""Database base configuration"""
from app.db.models import Base

# Import models so Alembic can discover them
from app.db.models import *
