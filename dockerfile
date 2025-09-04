# Imagem base leve com Node.js
FROM node:18-slim

# Instalar dependências necessárias pro Chromium rodar no container
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgobject-2.0-0 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1t64 \
    libfontconfig1 \
    libgbm1 \
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
 && rm -rf /var/lib/apt/lists/*

# Definir diretório da aplicação
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar puppeteer completo (vem com Chromium incluso)
RUN npm install puppeteer

# Instalar demais dependências do projeto
RUN npm install

# Copiar o código
COPY . .

# Expor a porta (ajusta se sua app usar outra)
EXPOSE 3000

# Comando de inicialização
CMD ["npm", "start"]
