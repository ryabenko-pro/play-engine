# The sync server with the built editor: shared projects for a group, stored in git.
#   docker build -t game-engine .
#   docker run -d -p 8080:8080 -v game-engine-data:/data -e PUBLIC_URL=https://games.example.org game-engine
#   docker exec <container> engine-server user add "Ana"     # prints Ana's personal link
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache git \
 && printf '#!/bin/sh\nexec node /app/dist-server/server.js "$@" --data /data\n' > /usr/local/bin/engine-server \
 && chmod +x /usr/local/bin/engine-server
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "dist-server/server.js", "serve"]
