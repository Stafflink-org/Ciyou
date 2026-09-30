FROM node:22-alpine
WORKDIR /app
COPY apps/site-api/package.json package.json
COPY apps/site-api/src src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
