# ---- build: install the workspace and build the demo app ----
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
# Manifests first so the dependency layer is cached until a package.json or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/synthetic/package.json packages/synthetic/
COPY packages/data/package.json packages/data/
COPY packages/renderers/package.json packages/renderers/
COPY packages/charts/package.json packages/charts/
COPY packages/vue/package.json packages/vue/
COPY apps/web/package.json apps/web/
COPY tools/synthetic/package.json tools/synthetic/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ---- serve: static files only, no Node at runtime ----
FROM nginx:1.30-alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
