# Villa Siesta — container image for Railway (and any Docker host).
# Serves the static site (index.html + api.js) via the zero-dependency
# Node server on the port Railway provides ($PORT).
FROM node:20-alpine

WORKDIR /app

# No npm dependencies to install — copy the whole site in.
COPY . .

# Railway injects PORT at runtime; server.js reads it (defaults to 8080).
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
