#!/bin/sh
set -eu
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
exec /usr/bin/node /opt/aring/current/server/backup.mjs create /var/lib/aring/aring.sqlite "/var/backups/aring/calendar-$stamp.aringbackup" /etc/aring/backup.key
# No automatic deletion. Configure encrypted off-host replication and retention
# before production; the local disk alone is not a recovery destination.
