FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

# AGENT_TOKEN is REQUIRED — set it when running the container:
#   docker run -e AGENT_TOKEN=your-secret-here ...
ENV AGENT_TOKEN=""

USER node

CMD ["node", "server.js"]
