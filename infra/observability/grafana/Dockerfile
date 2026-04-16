FROM grafana/grafana:10.4.2

# Grafana runs as the grafana user (uid 472).
# We copy provisioning config and dashboards at build time so the
# Railway instance starts with all datasources and dashboards pre-wired.
#
# IMPORTANT: Railway mounts a volume at /var/lib/grafana (for persistent data).
# That volume mount shadows any files we COPY into /var/lib/grafana at build time.
# Dashboards are stored at /etc/grafana/dashboards instead (outside the volume)
# so they survive volume overlay. The provisioning YAML points to that path.

COPY provisioning/datasources /etc/grafana/provisioning/datasources
COPY provisioning/dashboards  /etc/grafana/provisioning/dashboards
COPY dashboards               /etc/grafana/dashboards

EXPOSE 3000
