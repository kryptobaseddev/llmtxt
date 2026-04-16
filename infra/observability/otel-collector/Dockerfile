FROM otel/opentelemetry-collector-contrib:0.99.0

COPY otel-collector-config.yaml /etc/otelcol-contrib/config.yaml

EXPOSE 4317 4318 8888 8889

CMD ["--config=/etc/otelcol-contrib/config.yaml"]
