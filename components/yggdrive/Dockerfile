ARG SFTPGO_IMAGE=drakkan/sftpgo:v2.7.6@sha256:1edd28d80de2a008863fbfc58c8ff7db47b1b410bae48d4e6076192337809b11
FROM ${SFTPGO_IMAGE}
USER root
COPY deploy/verify-system-trust.sh /usr/local/bin/suite-verify-trust
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates openssl \
    && update-ca-certificates && sh /usr/local/bin/suite-verify-trust \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000
