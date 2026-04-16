# GlitchTip — OSS Sentry-compatible error tracking.
# Uses the official image which bundles the Django app + Celery worker.
# https://glitchtip.com/documentation/install
#
# Railway deployment uses two services from this same Dockerfile:
#   1. GlitchTip Web  (CMD = gunicorn)
#   2. GlitchTip Worker (CMD = celery)
# Both share the same image build, different start commands.
#
# The Railway environment variable GLITCHTIP_DOMAIN must be set to the
# public Railway domain of the web service so DSNs are generated correctly.

FROM glitchtip/glitchtip:v4.0

EXPOSE 8000
