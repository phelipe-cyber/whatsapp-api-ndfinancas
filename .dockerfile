# Imagem base Node.js
FROM node:18-slim

# Diretório de trabalho
WORKDIR /app

# Instalar dependências necessárias para Chromium e Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

# Copiar package.json e package-lock.json
COPY package*.json ./

RUN npm update whatsapp-web.js

# Instalar dependências do projeto
RUN npm install

# Copiar todo o código do bot
COPY . .

# Variável de ambiente para Puppeteer usar Chromium do sistema
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expor porta do bot
EXPOSE 8000

# Comando padrão para iniciar o bot
CMD ["node", "botzdg.js"]
