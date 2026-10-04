FROM node:24-bookworm-slim AS dependencies
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
WORKDIR /app
COPY . .
RUN NODE_ENV=production \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    APP_URL=https://kickoffwhen.com \
    BETTER_AUTH_SECRET=build-only-secret-123456789012345678901234 \
    SMTP_URL=smtp://127.0.0.1:2525 \
    SMTP_FROM=Family-Learning-build-only@example.invalid \
    REGISTRATION_ALLOWED_EMAILS=build-only@example.invalid \
    MEDIA_ROOT=/app/var/media \
    pnpm build

FROM node:24-bookworm-slim AS runtime
RUN corepack disable \
    && npm install --global pnpm@11.9.0 \
    && groupadd --system app \
    && useradd --system --gid app --create-home app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=app:app /app ./
RUN mkdir -p /app/var/media && chown -R app:app /app/var
USER app
EXPOSE 3000
CMD ["pnpm", "start"]
