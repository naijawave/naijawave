# Naija Wave — production container
FROM node:20-alpine

# better-sqlite3 needs build tools on alpine
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
RUN mkdir -p data uploads && chown -R node:node /app

USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
