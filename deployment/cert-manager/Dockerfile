FROM certbot/certbot:latest

# Add Node.js runtime and Docker CLI (for nginx reload signal)
RUN apk add --no-cache nodejs npm docker-cli

WORKDIR /app
COPY package.json index.js ./

EXPOSE 3002
CMD ["node", "index.js"]
