# CloudMusic lobby server – Railway image
# The server has no dependencies, so the image is just Node + a few files.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4300 \
    HOST=0.0.0.0

WORKDIR /app

# only the dependency-free lobby server is shipped
COPY server/lobby /app/server/lobby

USER node

EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["node", "server/lobby/index.mjs"]
