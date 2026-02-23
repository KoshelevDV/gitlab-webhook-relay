FROM node:22-alpine

WORKDIR /app

COPY package.json .
COPY index.js .

# No dependencies — stdlib only

EXPOSE 9091

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:9091/health || exit 1

CMD ["node", "index.js"]
