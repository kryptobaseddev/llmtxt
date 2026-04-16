FROM grafana/tempo:2.4.1

COPY tempo.yaml /etc/tempo/tempo.yaml

EXPOSE 3200 4317 4318

ENTRYPOINT ["/tempo"]
CMD ["-config.file=/etc/tempo/tempo.yaml"]
