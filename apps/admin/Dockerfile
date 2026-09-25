# GoLink Admin — build Vite puis service statique nginx.
# Contexte de build Docker = racine du dépôt (monorepo : besoin de packages/shared).

FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN npm ci --no-audit --no-fund -w @golink/admin -w @golink/shared
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN npm run build -w @golink/admin

FROM nginx:alpine
COPY --from=builder /repo/apps/admin/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
