FROM node:20-slim

# Instala apenas as bibliotecas necessárias para o Chromium rodar headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1t64 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgobject-2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0t64 \
    libpangocairo-1.0-0t64 \
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
    # extras recomendados para headless
    libu2f-udev \
    libvulkan1 \
    libdrm2 \
    libxshmfence1 \
    libxkbcommon0 \
 && rm -rf /var/lib/apt/lists/*

# Define o diretório da aplicação
WORKDIR /app

# Copia pacotes primeiro (cache otimizado de dependências)
COPY package*.json ./

# Instala dependências do Node
RUN npm install

# Instala o Chromium compatível com a versão do Puppeteer
RUN npx puppeteer install --yes

# Copia o restante do código
COPY . .

# Expõe a porta usada pelo app (ajuste se necessário)
EXPOSE 3000

# Comando de inicialização
CMD ["npm", "start"]