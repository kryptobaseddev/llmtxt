FROM grafana/grafana:10.4.2

# Grafana runs as the grafana user (uid 472).
# We copy provisioning config and dashboards at build time so the
# Railway instance starts with all datasources and dashboards pre-wired.

COPY provisioning/datasources /etc/grafana/provisioning/datasources
COPY provisioning/dashboards  /etc/grafana/provisioning/dashboards
COPY dashboards               /var/lib/grafana/dashboards

EXPOSE 3000
