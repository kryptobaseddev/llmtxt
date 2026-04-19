FROM prom/prometheus:v2.51.2

# Copy Prometheus configuration (relative to git root / build context)
COPY infra/observability/prometheus/prometheus.yml /etc/prometheus/prometheus.yml

# Copy Prometheus recording rules (SLI definitions)
# Pre-computes latency percentiles and error rates for efficient alert rule evaluation
COPY ops/prometheus/rules/ /etc/prometheus/rules/

# Copy Prometheus alert rules (SLO enforcement)
# Defines latency, error rate, and burn-rate alerts
COPY ops/prometheus/alerts/ /etc/prometheus/alerts/

EXPOSE 9090

ENTRYPOINT ["/bin/prometheus"]
CMD [ \
  "--config.file=/etc/prometheus/prometheus.yml", \
  "--storage.tsdb.path=/prometheus", \
  "--storage.tsdb.retention.time=30d", \
  "--web.enable-remote-write-receiver", \
  "--web.console.libraries=/usr/share/prometheus/console_libraries", \
  "--web.console.templates=/usr/share/prometheus/consoles" \
]
