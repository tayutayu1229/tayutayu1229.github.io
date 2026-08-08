FROM python:3.12-alpine

RUN addgroup -g 1000 -S atos && adduser -u 1000 -S -D -G atos atos
WORKDIR /app
COPY atos_delay_history.py /app/atos_delay_history.py
RUN chmod 0555 /app/atos_delay_history.py

USER atos
ENV ATOS_HISTORY_DB=/data/history.sqlite3 \
    ATOS_HISTORY_HOST=0.0.0.0 \
    ATOS_HISTORY_PORT=8787 \
    ATOS_HISTORY_INTERVAL=20 \
    ATOS_HISTORY_RETENTION_DAYS=120
EXPOSE 8787
VOLUME ["/data"]
CMD ["python3", "/app/atos_delay_history.py"]
