#!/bin/sh
# (Re)start the static server for dist/ (:8765) and the local MQTT broker (:8899), detached, by PID.
cd "$(dirname "$0")/.."
for f in /tmp/eecalc_http.pid /tmp/eecalc_broker.pid; do [ -f $f ] && kill "$(cat $f)" 2>/dev/null; done
setsid nohup python3 -m http.server 8765 --directory dist >/tmp/eecalc_http.log 2>&1 < /dev/null & echo $! > /tmp/eecalc_http.pid
setsid nohup node tests/local_broker.mjs >/tmp/eecalc_broker.log 2>&1 < /dev/null & echo $! > /tmp/eecalc_broker.pid
sleep 1.5
