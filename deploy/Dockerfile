# BlinkTalk cloud box: hub (Photon + Nemotron) + dashboard/patient screen, talking to SpacetimeDB Maincloud.
# Build from the repo root:
#   docker build -f deploy/Dockerfile --build-arg SPACETIME_DB=blinktalk-neal -t blinktalk .
# Runtime secrets (set as environment variables / secrets on the host, never baked in):
#   NVIDIA_API_KEY, PHOTON_API_KEY, PHOTON_PROJECT_ID
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm install --no-audit --no-fund
ARG SPACETIME_URI=wss://maincloud.spacetimedb.com
ARG SPACETIME_DB=blinktalk-neal
RUN VITE_SPACETIME_URI=$SPACETIME_URI VITE_SPACETIME_DB=$SPACETIME_DB npx -w dashboard vite build
ENV SPACETIME_URI=$SPACETIME_URI SPACETIME_DB=$SPACETIME_DB PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "deploy/start.mjs"]
