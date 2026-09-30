# Ciyou Eats Admin — build Vite puis service statique nginx.
# Contexte de build Docker = racine du dépôt (monorepo : besoin de packages/shared, packages/ui et packages/web).

FROM node:22-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY packages/web/package.json packages/web/
COPY apps/admin/package.json apps/admin/
COPY apps/restaurant/package.json apps/restaurant/
COPY apps/client/package.json apps/client/
COPY apps/driver/package.json apps/driver/
COPY apps/site/package.json apps/site/
COPY apps/site-api/package.json apps/site-api/
# npm ci SANS filtre -w : avec un filtre, npm ne réinstalle pas toujours les
# dépendances imbriquées propres à un workspace (ex. @hookform/resolvers nichée
# sous apps/*/node_modules à cause de peer deps différentes selon l'app) — le
# lockfile a été calculé pour la totalité des workspaces, il faut les lui donner
# tous (leurs package.json seulement, pas leur code source) pour qu'il retrouve
# exactement l'arbre attendu.
RUN npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY packages/web packages/web
COPY apps/admin apps/admin

# Variables VITE_* lues au build (Vite les fige dans le bundle : impossible de les
# changer après coup sans reconstruire). Coolify : renseigner en « Build Variables »
# de l'application, avec les mêmes noms. Absentes, l'app démarre quand même en mode
# dégradé (ex. carte indisponible tant que VITE_GOOGLE_MAPS_API_KEY n'est pas fournie).
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_RESTAURANT_APP_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY \
    VITE_RESTAURANT_APP_URL=$VITE_RESTAURANT_APP_URL

RUN npm run build -w @golink/admin

FROM nginx:alpine
COPY --from=builder /repo/apps/admin/dist /usr/share/nginx/html
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
