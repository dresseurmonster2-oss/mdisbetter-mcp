# Runs the stdio MCP server in a container. The server needs no key to start
# and to answer introspection (initialize, tools/list); a conversion needs
# MDISBETTER_API_KEY, passed at run time:
#   docker run -i --rm -e MDISBETTER_API_KEY=mdb_sk_... mdisbetter-mcp
# Files to convert must be mounted into the container, since the server reads
# and writes local paths.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY README.md LICENSE ./
USER node
ENTRYPOINT ["node", "src/index.js"]
