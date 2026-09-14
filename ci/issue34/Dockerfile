ARG BASE_IMAGE=docker.1ms.run/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
FROM ${BASE_IMAGE}
ARG APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn
ARG NODE_DISTURL=https://npmmirror.com/mirrors/node
# Native npm dependencies are built only in disposable Linux CI, never on a user's workstation.
RUN sed -i "s|http://deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ bubblewrap git
ENV npm_config_registry=https://registry.npmmirror.com
ENV npm_config_disturl=${NODE_DISTURL}
