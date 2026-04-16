FROM grafana/loki:2.9.6

COPY loki-config.yaml /etc/loki/config.yaml

EXPOSE 3100

ENTRYPOINT ["/usr/bin/loki"]
CMD ["-config.file=/etc/loki/config.yaml"]
