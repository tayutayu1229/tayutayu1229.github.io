FROM python:3.12-slim

RUN groupadd --gid 1000 archive && useradd --uid 1000 --gid archive --create-home archive
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY photo_archive.py /app/photo_archive.py
COPY test_photo_archive.py /app/test_photo_archive.py
RUN PHOTO_ARCHIVE_ROOT=/tmp/photo-archive-test \
    PHOTO_ARCHIVE_DB=/tmp/photo-archive-test/archive.sqlite3 \
    python3 -m unittest -v /app/test_photo_archive.py && rm -rf /tmp/photo-archive-test
RUN chmod 0555 /app/photo_archive.py
USER archive

ENV PHOTO_ARCHIVE_ROOT=/data \
    PHOTO_ARCHIVE_DB=/data/archive.sqlite3 \
    PHOTO_ARCHIVE_HOST=0.0.0.0 \
    PHOTO_ARCHIVE_PORT=8790 \
    PHOTO_ARCHIVE_FIREBASE_PROJECT=tokyo-pass \
    PHOTO_ARCHIVE_ALLOWED_ORIGINS=https://tayunet-traininfo.com,https://www.tayunet-traininfo.com \
    PHOTO_ARCHIVE_TRASH_DAYS=30 \
    PHOTO_ARCHIVE_MAX_UPLOAD_MB=100

EXPOSE 8790
VOLUME ["/data"]
CMD ["python3", "/app/photo_archive.py"]
