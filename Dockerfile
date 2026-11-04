# The React front end is built into the API's wwwroot, then both run on one port.
# SQLite is created on start and seeded with today's 160 jobs by the API's own generator. Sign in with the demo user in the README.
# Build from the repo root: docker build -t harbour-ops .
FROM node:22-slim AS web
WORKDIR /src
COPY tests-shared/ tests-shared/
COPY web/ web/
WORKDIR /src/web
RUN npm ci && npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY api/ api/
COPY --from=web /src/api/Harbour.Ops.Api/wwwroot api/Harbour.Ops.Api/wwwroot
RUN dotnet publish api/Harbour.Ops.Api/Harbour.Ops.Api.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS run
WORKDIR /app
COPY --from=build /app .
ENV Database__Path=/tmp/data/ops.db
ENV PORT=8080
EXPOSE 8080
# Runs as the image's non-root user, so anything written goes under /tmp. Free hosting has no lasting disk anyway.
USER $APP_UID
CMD ["sh", "-c", "exec dotnet Harbour.Ops.Api.dll --urls http://0.0.0.0:$PORT"]
