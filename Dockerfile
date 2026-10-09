FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Kerakli tizim paketlari
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python kutubxonalarini o'rnatish
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Bot manba kodlarini nusxalash
COPY config.py database.py models.py main.py ./
COPY handlers ./handlers
COPY services ./services
COPY keyboards ./keyboards
COPY middlewares ./middlewares

CMD ["python", "main.py"]
