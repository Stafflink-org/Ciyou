# Ciyou Eats public website — build Vite puis service statique nginx.
# Contexte de build Docker = racine du dépôt.

FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/ui/package.json packages/ui/
COPY apps/site/package.json apps/site/
COPY apps/site-api/package.json apps/site-api/
COPY apps/admin/package.json apps/admin/
COPY apps/restaurant/package.json apps/restaurant/
COPY apps/client/package.json apps/client/
COPY apps/driver/package.json apps/driver/
RUN npm ci --no-audit --no-fund
COPY packages/ui packages/ui
COPY apps/site apps/site
RUN npm run build -w @golink/site

FROM nginx:alpine
COPY --from=builder /repo/apps/site/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
