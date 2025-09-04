# Etapa 1: Usar uma imagem base oficial do Node.js
FROM node:18-bullseye-slim

# =========================================================
# ===== CORREÇÃO APLICADA AQUI =====
# =========================================================
# Instala todas as dependências necessárias para o Chromium/Puppeteer em ambientes Linux
# Esta lista é mais completa e inclui a 'libgobject-2.0-so.0' (parte do pacote libgobject2.0-0)

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2t64 \
    libdbus-1-3 \
    libexpat1t64 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgobject-2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0t64 \
    libpangocairo-1.0-0t64 \
    libstdc++6 \
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
    lsb-release \
    wget \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*


# Define o diretório de trabalho dentro do contêiner
WORKDIR /app

# Copia o package.json e o package-lock.json
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install

# Copia todos os outros ficheiros da sua aplicação
COPY . .

# Expõe a porta que a sua aplicação usa
EXPOSE 8000

# O comando para iniciar a sua aplicação
CMD [ "node", "botzdg.js" ]